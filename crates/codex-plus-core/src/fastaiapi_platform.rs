//! 面板选择与分发。平台身份随请求传递，切换页面不改变已应用的模型或媒体连接。
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    NewApi,
    SubApi,
}
impl Platform {
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
            Self::NewApi => "New API",
            Self::SubApi => "SubAPI",
        }
    }
    pub fn origins(self) -> &'static [&'static str] {
        match self {
            Self::NewApi => &crate::fastaiapi::ORIGINS,
            Self::SubApi => &["https://fastaiapi.cloud"],
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
fn selection_path() -> std::path::PathBuf {
    crate::paths::default_app_state_dir().join("account-platform")
}
pub fn selected() -> Platform {
    std::fs::read_to_string(selection_path())
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
        Platform::SubApi => 0,
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
        let path = selection_path();
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法保存平台选择")?;
        std::fs::write(path, next.id()).map_err(|_| "无法保存平台选择")?;
        return routes(next).await;
    }
    if action == "routes" {
        return routes(platform).await;
    }
    match platform {
        Platform::NewApi => crate::fastaiapi::account(action, id, body).await,
        Platform::SubApi => crate::fastaiapi_subapi::account(action, id, body).await,
    }
}
async fn routes(platform: Platform) -> Result<Value, String> {
    Ok(
        json!({"platform":platform.id(), "platforms":[{"id":"newapi","name":"New API"},{"id":"subapi","name":"SubAPI"}],
        "selected":route(platform).await, "items":platform.origins().iter().enumerate().map(|(id,origin)|json!({"id":id,"name":format!("路线{}",id+1),"origin":origin})).collect::<Vec<_>>()}),
    )
}
pub async fn key_and_models(
    platform: Platform,
    key_id: i64,
) -> Result<(String, Vec<String>), String> {
    match platform {
        Platform::NewApi => crate::fastaiapi::key_and_models(key_id).await,
        Platform::SubApi => crate::fastaiapi_subapi::key_and_models(key_id).await,
    }
}
pub async fn configure_media(platform: Platform, key_id: i64) -> Result<Value, String> {
    let (key, _) = key_and_models(platform, key_id).await?;
    crate::fastaiapi_media_env::store_for(platform, origin(platform).await, &key)
}
#[cfg(test)]
mod tests {
    use super::*;
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
        assert_eq!(Platform::SubApi.origins(), ["https://fastaiapi.cloud"]);
        assert!(Platform::parse("https://untrusted.example").is_err());
    }
}
