//! 面板选择与分发。平台身份随请求传递，切换页面不改变已应用的模型或媒体连接。
use crate::settings::{RelayMode, RelayProfile};
use serde_json::{Value, json};

#[derive(Default)]
struct PlatformLock(Option<Platform>);
impl PlatformLock {
    fn check(&self, platform: Platform) -> Result<(), String> {
        if self.0.is_some_and(|current| current != platform) {
            return Err("已登录当前平台，请退出登录后再选择平台。".into());
        }
        Ok(())
    }
    fn record(&mut self, platform: Platform, action: &str, result: &Value) {
        match action {
            "login" | "register" | "login_2fa" | "me" if result["requires_2fa"] != true => {
                self.0 = Some(platform)
            }
            "logout" => self.0 = None,
            _ => {}
        }
    }
}
static SESSION_PLATFORM: tokio::sync::Mutex<PlatformLock> =
    tokio::sync::Mutex::const_new(PlatformLock(None));

pub async fn ensure_current(platform: Platform) -> Result<(), String> {
    SESSION_PLATFORM.lock().await.check(platform)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    NewApi,
    SubApi,
}
impl Platform {
    pub const BUILT_INS: [Self; 2] = [Self::NewApi, Self::SubApi];

    pub fn parse(id: &str) -> Result<Self, String> {
        match id {
            "newapi" => Ok(Self::NewApi),
            "subapi" => Ok(Self::SubApi),
            _ => Err("平台无效".into()),
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            Self::NewApi => "newapi",
            Self::SubApi => "subapi",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::NewApi => "TuMeiAPI",
            Self::SubApi => "FastAiAPI",
        }
    }
    pub fn origins(self) -> &'static [&'static str] {
        match self {
            Self::NewApi => &crate::fastaiapi::ORIGINS,
            Self::SubApi => &crate::fastaiapi_subapi::ORIGINS,
        }
    }
    fn primary_origin(self) -> &'static str {
        match self {
            Self::NewApi => self.origins()[crate::fastaiapi::DEFAULT_ROUTE],
            Self::SubApi => self.origins()[0],
        }
    }
    pub fn profile_prefix(self) -> String {
        format!("fastaiapi-{}-", self.id())
    }
    pub fn profile_id(self, key_id: i64) -> String {
        format!("{}{key_id}", self.profile_prefix())
    }
    pub fn service(self, kind: &str) -> String {
        format!("com.fastaiapi.codexplusplus.{}.{kind}", self.id())
    }
}
/// 识别账号面板生成的供应商，旧版共用的 fastaiapi-<key> ID 需结合原始服务地址。
fn managed_profile_platform(profile: &RelayProfile) -> Option<Platform> {
    if profile.relay_mode != RelayMode::PureApi {
        return None;
    }
    for platform in Platform::BUILT_INS {
        if profile
            .id
            .strip_prefix(&platform.profile_prefix())
            .is_some_and(is_managed_key_suffix)
        {
            return Some(platform);
        }
    }
    let suffix = profile.id.strip_prefix("fastaiapi-")?;
    if !is_managed_key_suffix(suffix) {
        return None;
    }
    let endpoint = if profile.upstream_base_url.is_empty() {
        crate::relay_config::relay_profile_base_url(profile)
    } else {
        profile.upstream_base_url.clone()
    };
    let url = reqwest::Url::parse(endpoint.trim()).ok()?;
    let origin = url.origin().ascii_serialization();
    Platform::BUILT_INS
        .into_iter()
        .find(|platform| platform.origins().contains(&origin.as_str()))
}

fn is_managed_key_suffix(suffix: &str) -> bool {
    suffix
        .split('-')
        .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

fn is_builtin_name(name: &str) -> bool {
    Platform::BUILT_INS
        .into_iter()
        .any(|platform| name.trim().eq_ignore_ascii_case(platform.name()))
}

pub(crate) fn normalize_gateway_provider_brand(profile: &mut RelayProfile, source: &str) {
    let Some(source_id) = source.strip_prefix("codex:") else {
        return;
    };
    // 网关有独立 ID，导入来源才是原账号配置的 ID。
    let gateway_id = std::mem::replace(&mut profile.id, source_id.to_owned());
    normalize_managed_profile_brand(profile);
    profile.id = gateway_id;
}

/// 只迁移旧的内置品牌标签，保留自定义名称、地址、Key 和供应商 ID。
pub(crate) fn normalize_managed_profile_brand(profile: &mut RelayProfile) {
    let Some(platform) = managed_profile_platform(profile) else {
        return;
    };
    let name = platform.name();
    if is_builtin_name(&profile.name) {
        profile.name = name.into();
    }
    for key in &mut profile.api_keys {
        if key.id == "account" && is_builtin_name(&key.name) {
            key.name = name.into();
        }
    }
    let Ok(mut config) = profile.config_contents.parse::<toml_edit::DocumentMut>() else {
        return;
    };
    let provider = config
        .get("model_provider")
        .and_then(toml_edit::Item::as_str)
        .unwrap_or("custom")
        .to_owned();
    let Some(label) = config
        .get_mut("model_providers")
        .and_then(|providers| providers.get_mut(&provider))
        .and_then(|entry| entry.get_mut("name"))
    else {
        return;
    };
    if label
        .as_str()
        .is_some_and(|old| old != name && is_builtin_name(old))
    {
        *label = toml_edit::value(name);
        profile.config_contents = config.to_string();
    }
}

fn selection_path() -> std::path::PathBuf {
    crate::paths::default_app_state_dir().join("account-platform")
}
pub fn selected() -> Platform {
    selected_in(&crate::paths::default_app_state_dir())
}
pub(crate) fn selected_in(state_dir: &std::path::Path) -> Platform {
    std::fs::read_to_string(state_dir.join("account-platform"))
        .ok()
        .and_then(|s| Platform::parse(s.trim()).ok())
        .unwrap_or(Platform::NewApi)
}
pub fn resolve(id: Option<&str>) -> Result<Platform, String> {
    id.map(Platform::parse).unwrap_or_else(|| Ok(selected()))
}
pub async fn route(platform: Platform) -> usize {
    match platform {
        Platform::NewApi => crate::fastaiapi::selected_route().await,
        Platform::SubApi => crate::fastaiapi_subapi::selected_route().await,
    }
}
pub async fn origin(platform: Platform) -> &'static str {
    platform.origins()[route(platform).await]
}
pub async fn account(
    platform: Platform,
    action: &str,
    id: &str,
    body: Value,
) -> Result<Value, String> {
    if action == "feedback" {
        let origin = if std::env::var("FASTAIAPI_FEEDBACK_LOCAL").as_deref() == Ok("1") {
            "http://127.0.0.1:6099"
        } else {
            "https://fastaiapi.cloud"
        };
        return Ok(crate::fastaiapi::data(
            crate::fastaiapi::send(
                origin,
                &mut crate::fastaiapi::Session::default(),
                "POST",
                "/fastaiapi/api/feedback",
                body,
                None,
            )
            .await?,
        ));
    }
    if action == "select_platform" {
        let next = Platform::parse(body["platform"].as_str().unwrap_or(""))?;
        let lock = SESSION_PLATFORM.lock().await;
        lock.check(next)?;
        let path = selection_path();
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法保存平台选择")?;
        std::fs::write(path, next.id()).map_err(|_| "无法保存平台选择")?;
        return routes(next).await;
    }
    if action == "routes" {
        let path = selection_path();
        let platform = if platform == Platform::NewApi && !path.exists() {
            let _lock = SESSION_PLATFORM.lock().await;
            if path.exists() {
                selected()
            } else if legacy_fastai_login_exists().await {
                std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法保存平台选择")?;
                crate::settings::atomic_write(&path, Platform::SubApi.id().as_bytes())
                    .map_err(|_| "无法保存平台选择")?;
                Platform::SubApi
            } else {
                platform
            }
        } else {
            platform
        };
        return routes(platform).await;
    }
    // 与平台切换串行化，认证成功后立即固定平台，包括恢复已有会话。
    let mut lock = SESSION_PLATFORM.lock().await;
    lock.check(platform)?;
    let result = match platform {
        Platform::NewApi => crate::fastaiapi::account(action, id, body).await,
        Platform::SubApi => crate::fastaiapi_subapi::account(action, id, body).await,
    }?;
    lock.record(platform, action, &result);
    Ok(result)
}
async fn legacy_fastai_login_exists() -> bool {
    use crate::fastaiapi_subapi::{LEGACY_REMEMBERED_LOGIN, LEGACY_SESSION};
    let (newapi, session, remembered) = tokio::join!(
        crate::fastaiapi_secret_store::load_with_timeout(Platform::NewApi.service("session")),
        crate::fastaiapi_secret_store::load_with_timeout(LEGACY_SESSION.into()),
        crate::fastaiapi_secret_store::load_with_timeout(LEGACY_REMEMBERED_LOGIN.into()),
    );
    matches!(newapi, Ok(None))
        && [session, remembered]
            .into_iter()
            .any(|value| value.ok().flatten().is_some_and(|bytes| !bytes.is_empty()))
}
async fn routes(platform: Platform) -> Result<Value, String> {
    let platforms = Platform::BUILT_INS
        .map(|item| json!({"id":item.id(),"name":item.name(),"origin":item.primary_origin()}));
    Ok(json!({"platform":platform.id(), "platforms":platforms,
        "selected":route(platform).await, "items":platform.origins().iter().enumerate().map(|(id,origin)|json!({"id":id,"name":format!("路线{}",id+1),"origin":origin})).collect::<Vec<_>>()}))
}
pub async fn key_and_models(
    platform: Platform,
    key_id: i64,
) -> Result<(String, Vec<String>), String> {
    ensure_current(platform).await?;
    match platform {
        Platform::NewApi => crate::fastaiapi::key_and_models(key_id).await,
        Platform::SubApi => crate::fastaiapi_subapi::key_and_models(key_id).await,
    }
}
pub async fn configure_media(platform: Platform, key_id: i64) -> Result<Value, String> {
    let (key, _) = key_and_models(platform, key_id).await?;
    let result = crate::fastaiapi_media_env::store_for(platform, origin(platform).await, &key)?;
    crate::fastaiapi_media_env::set_pricing_key_id(platform, Some(key_id))?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authentication_pins_platform_until_logout_but_not_route_changes() {
        for action in ["login", "register", "login_2fa", "me"] {
            let mut lock = PlatformLock::default();
            assert!(lock.check(Platform::SubApi).is_ok());
            lock.record(Platform::NewApi, action, &json!({"email":"test"}));
            assert!(lock.check(Platform::SubApi).is_err());
            assert!(lock.check(Platform::NewApi).is_ok());
            lock.record(Platform::NewApi, "select_route", &json!({}));
            assert!(lock.check(Platform::SubApi).is_err());
            lock.record(Platform::NewApi, "logout", &json!({}));
            assert!(lock.check(Platform::SubApi).is_ok());
        }
        let mut lock = PlatformLock::default();
        lock.record(Platform::SubApi, "login", &json!({"requires_2fa":true}));
        assert!(lock.check(Platform::NewApi).is_ok());
    }
    #[tokio::test]
    async fn routes_expose_only_the_two_builtin_channel_names() {
        let view = routes(Platform::SubApi).await.unwrap();
        assert_eq!(
            view["platforms"],
            json!([
                {"id":"newapi","name":"TuMeiAPI","origin":"https://tumeiapi.com"},
                {"id":"subapi","name":"FastAiAPI","origin":"https://fastaiapi.cloud"}
            ])
        );
        assert_eq!(view["items"][0]["origin"], "https://fastaiapi.cloud");
        assert_eq!(
            view["items"][1],
            json!({"id":1,"name":"路线2","origin":"http://8.137.194.180:88"})
        );
    }

    #[test]
    fn managed_profile_brand_migrates_both_generations_without_touching_user_labels() {
        use crate::settings::RelayApiKey;
        for (id, host, expected) in [
            ("fastaiapi-newapi-7", "tumeiapi.com", "TuMeiAPI"),
            ("fastaiapi-8", "fastaiapi.cloud", "FastAiAPI"),
            ("fastaiapi-subapi-9", "fastaiapi.cloud", "FastAiAPI"),
        ] {
            let mut profile = RelayProfile {
                id: id.into(),
                name: "FastAiApi".into(),
                upstream_base_url: format!("https://{host}/v1"),
                relay_mode: RelayMode::PureApi,
                config_contents: "model_provider = \"custom\"\n[model_providers.custom]\nname = \"FastAiApi\"\n[model_providers.other]\nname = \"Keep\"\n".into(),
                api_keys: vec![RelayApiKey { id: "account".into(), name: "FastAiApi".into(), api_key: "fixture".into() }],
                ..Default::default()
            };
            normalize_managed_profile_brand(&mut profile);
            assert_eq!(profile.id, id);
            assert_eq!(profile.upstream_base_url, format!("https://{host}/v1"));
            assert_eq!(profile.name, expected);
            assert_eq!(profile.api_keys[0].name, expected);
            assert_eq!(profile.api_keys[0].api_key, "fixture");
            let config = profile
                .config_contents
                .parse::<toml_edit::DocumentMut>()
                .unwrap();
            assert_eq!(
                config["model_providers"]["custom"]["name"].as_str(),
                Some(expected)
            );
            assert_eq!(
                config["model_providers"]["other"]["name"].as_str(),
                Some("Keep")
            );

            profile.name = "手工命名".into();
            normalize_managed_profile_brand(&mut profile);
            assert_eq!(profile.name, "手工命名");
            profile.id = "user-import".into();
            profile.name = "FastAiApi".into();
            normalize_managed_profile_brand(&mut profile);
            assert_eq!(profile.name, "FastAiApi");
        }
    }

    #[test]
    fn imported_gateway_brands_keep_gateway_identity_and_source() {
        let mut relay = RelayProfile {
            id: "fastaiapi-2".into(),
            name: "FastAiApi".into(),
            upstream_base_url: "https://tumeiapi.com/v1".into(),
            relay_mode: RelayMode::PureApi,
            ..Default::default()
        };
        normalize_gateway_provider_brand(&mut relay, "codex:fastaiapi-newapi-116");
        assert_eq!(relay.name, "TuMeiAPI");
        assert_eq!(relay.id, "fastaiapi-2");
        relay.name = "FastAiApi".into();
        relay.upstream_base_url = "https://fastaiapi.cloud/v1".into();
        normalize_gateway_provider_brand(&mut relay, "codex:fastaiapi-411");
        assert_eq!(relay.name, "FastAiAPI");
        normalize_gateway_provider_brand(&mut relay, "codex:manual-provider");
        assert_eq!(relay.name, "FastAiAPI");
    }

    #[test]
    fn platform_identity_is_separate_from_routes() {
        assert_ne!(
            Platform::NewApi.service("session"),
            Platform::SubApi.service("session")
        );
        assert_ne!(
            Platform::NewApi.profile_id(1),
            Platform::SubApi.profile_id(1)
        );
        assert_eq!(
            Platform::NewApi.profile_id(1),
            crate::fastaiapi::profile_id(2, 1)
        );
        assert_eq!(Platform::NewApi.origins().len(), 3);
        assert_eq!(
            Platform::SubApi.origins(),
            ["https://fastaiapi.cloud", "http://8.137.194.180:88"]
        );
        assert!(Platform::parse("https://untrusted.example").is_err());
    }
}
