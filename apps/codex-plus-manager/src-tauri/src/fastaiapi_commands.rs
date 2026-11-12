use codex_plus_core::fastaiapi_platform::{self as panels, Platform};
use codex_plus_core::settings::{
    RelayApiKey, RelayMode, RelayProfile, SettingsStore, atomic_write,
};
use serde_json::{Value, json};

static ACCOUNT_CHANGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
pub async fn fastaiapi_account(
    action: String,
    id: Option<String>,
    body: Option<Value>,
    platform: Option<String>,
) -> Result<Value, String> {
    let platform = panels::resolve(platform.as_deref())?;
    let _change = if matches!(
        action.as_str(),
        "apply_model_binding"
            | "select_route"
            | "select_platform"
            | "logout"
            | "login"
            | "login_2fa"
            | "register"
    ) {
        Some(ACCOUNT_CHANGE.lock().await)
    } else {
        None
    };
    if action != "select_platform" && action != "routes" && action != "feedback" {
        panels::ensure_current(platform).await?;
    }
    if action == "configuration" {
        let settings = SettingsStore::default()
            .load()
            .map_err(|_| "无法读取本地配置")?;
        let prefix = platform.profile_prefix();
        let saved_id =
            std::fs::read_to_string(account_selection_path(platform)).unwrap_or_default();
        let profile = account_configuration(
            &settings.relay_profiles,
            &settings.active_relay_id,
            &saved_id,
            platform,
        );
        return Ok(profile.map(|p| json!({"profile_id": p.id, "model": p.model, "key_id": p.id.strip_prefix(&prefix).and_then(|id| id.rsplit('-').next()).and_then(|id| id.parse::<i64>().ok())})).unwrap_or(json!({})));
    }
    if action == "select_route" {
        let mut result = panels::account(platform, &action, "", body.unwrap_or(json!({}))).await?;
        if let Err(error) = update_account_route(platform, panels::origin(platform).await) {
            result["configuration_warning"] = json!(error);
        }
        return Ok(result);
    }
    if action == "apply_model_binding" {
        return apply_model_binding(platform, body.unwrap_or_default()).await;
    }
    panels::account(
        platform,
        &action,
        id.as_deref().unwrap_or(""),
        body.unwrap_or(json!({})),
    )
    .await
}

fn key_in_group(key: &Value, platform: Platform, group: &str) -> bool {
    key["status"] == "active"
        && match platform {
            Platform::NewApi => {
                key["group"]
                    .as_str()
                    .filter(|name| !name.is_empty())
                    .unwrap_or("default")
                    == group
            }
            Platform::SubApi => key["group_id"]
                .as_i64()
                .is_some_and(|id| id.to_string() == group),
        }
}

async fn apply_model_binding(platform: Platform, mut body: Value) -> Result<Value, String> {
    let route = panels::route(platform).await;
    if body["route"].as_u64() != Some(route as u64) {
        return Err("路线已切换，请重新选择模型".into());
    }
    let kind = body["kind"]
        .as_str()
        .filter(|kind| matches!(*kind, "text" | "image" | "video"))
        .ok_or("模型类型无效")?
        .to_owned();
    let model = body["model"]
        .as_str()
        .filter(|model| codex_plus_core::fastaiapi::model_kind(model) == kind)
        .ok_or("请选择对应类型的模型")?
        .to_owned();
    if kind != "text" {
        super::fastaiapi_media_commands::fastaiapi_media_tool(
            "ensure".into(),
            Some(platform.id().into()),
            None,
        )
        .await?;
    }
    let preferred = body["key_id"].as_i64().unwrap_or_default();
    let Some(group) = body["group_id"].as_str() else {
        if kind == "text" {
            return fastaiapi_configure(preferred, model, Some(platform.id().into())).await;
        }
        body["key_id"] = Value::Null;
        return panels::account(platform, "media_select", "", body).await;
    };
    let keys = panels::account(platform, "keys", "", Value::Null).await?;
    let mut candidates: Vec<_> = keys["items"]
        .as_array()
        .ok_or("无法读取账号 Key")?
        .iter()
        .filter(|key| key_in_group(key, platform, group))
        .cloned()
        .collect();
    candidates.sort_by_key(|key| key["id"].as_i64() != Some(preferred));
    let mut selected = None;
    let mut probe_error = None;
    for key in candidates {
        let Some(id) = key["id"].as_i64() else {
            continue;
        };
        match panels::key_and_models(platform, id).await {
            Ok((secret, models)) if models.contains(&model) => {
                selected = Some((key, id, secret, models));
                break;
            }
            Ok(_) => {}
            Err(error) => probe_error = Some(error),
        }
    }
    let (key, id, secret, models) = match selected {
        Some(selection) => selection,
        None => {
            if let Some(error) = probe_error {
                return Err(error);
            }
            let key = panels::account(
                platform,
                "ensure_group_key",
                "",
                json!({
                    "group_id":group,"name":format!("Codex++ {}", platform.name()),"dedicated":true
                }),
            )
            .await?;
            let id = key["id"].as_i64().ok_or("无法读取分组 Key")?;
            let (secret, models) = panels::key_and_models(platform, id).await?;
            if !models.contains(&model) {
                return Err("此分组的专用 Key 未开放所选模型，请在平台检查模型权限。".into());
            }
            (key, id, secret, models)
        }
    };
    if kind == "text" {
        apply_text_model(platform, id, model, secret, models).await?;
    } else {
        body["key_id"] = json!(id);
        panels::account(platform, "media_select", "", body).await?;
    }
    Ok(json!({"key":key}))
}
// 查看另一个平台时恢复它最后保存的选择，不将当前平台的同编号 Key 当作配置。
fn account_configuration<'a>(
    profiles: &'a [RelayProfile],
    active: &str,
    saved: &str,
    platform: Platform,
) -> Option<&'a RelayProfile> {
    let prefix = platform.profile_prefix();
    let matching = |id: &str| {
        profiles
            .iter()
            .find(|p| p.id == id && p.id.starts_with(&prefix))
    };
    matching(active)
        .or_else(|| matching(saved))
        .or_else(|| profiles.iter().rev().find(|p| p.id.starts_with(&prefix)))
}
fn account_selection_path(platform: Platform) -> std::path::PathBuf {
    codex_plus_core::paths::default_app_state_dir()
        .join(format!("account-{}-profile", platform.id()))
}
fn update_account_route(platform: Platform, origin: &str) -> Result<(), String> {
    let mut settings = SettingsStore::default()
        .load()
        .map_err(|_| "无法读取账户模型配置")?;
    let previous = settings.active_relay_id.clone();
    let Some(index) = settings.relay_profiles.iter().position(|profile| {
        profile.id == previous && profile.id.starts_with(&platform.profile_prefix())
    }) else {
        return Ok(());
    };
    let profile = settings.relay_profiles[index].clone();
    let models = profile.model_list.lines().map(str::to_owned).collect();
    settings.relay_profiles[index] = account_profile(
        platform,
        profile.clone(),
        profile.id.clone(),
        profile.api_key.clone(),
        profile.model.clone(),
        models,
        origin,
    )?;
    let result =
        crate::commands::switch_relay_profile(crate::commands::RelayProfileSwitchRequest {
            settings,
            previous_active_relay_id: previous,
            live_conflict_resolution: Default::default(),
        });
    if result.status != "ok" {
        return Err(result.message);
    }
    Ok(())
}

#[tauri::command]
pub fn fastaiapi_qr(text: String) -> Result<String, String> {
    codex_plus_core::fastaiapi::qr_image(&text)
}
#[tauri::command]
pub async fn fastaiapi_models(
    key_id: i64,
    platform: Option<String>,
) -> Result<Vec<String>, String> {
    Ok(
        panels::key_and_models(panels::resolve(platform.as_deref())?, key_id)
            .await?
            .1,
    )
}
#[tauri::command]
pub async fn fastaiapi_configure(
    key_id: i64,
    model: String,
    platform: Option<String>,
) -> Result<Value, String> {
    let platform = panels::resolve(platform.as_deref())?;
    let route = panels::route(platform).await;
    let (key, models) = panels::key_and_models(platform, key_id).await?;
    if panels::route(platform).await != route {
        return Err("路线已切换，请重新选择模型".into());
    }
    apply_text_model(platform, key_id, model, key, models).await
}

async fn apply_text_model(
    platform: Platform,
    key_id: i64,
    model: String,
    key: String,
    models: Vec<String>,
) -> Result<Value, String> {
    let models: Vec<String> = models
        .into_iter()
        .filter(|id| codex_plus_core::fastaiapi::model_kind(id) == "text")
        .collect();
    if !models.contains(&model) {
        return Err("请选择该 Key 可用的模型".into());
    }
    let mut settings = SettingsStore::default()
        .load()
        .map_err(|_| "无法读取本地配置")?;
    let previous = settings.active_relay_id.clone();
    let profile_id = platform.profile_id(key_id);
    // 切换模型只更新账户连接信息，保留该供应商已有的上下文等高级配置。
    let existing = settings
        .relay_profiles
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .unwrap_or_default();
    let profile = account_profile(
        platform,
        existing,
        profile_id.clone(),
        key,
        model.clone(),
        models,
        panels::origin(platform).await,
    )?;
    let selection = account_selection_path(platform);
    let previous_selection = match std::fs::read(&selection) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(_) => return Err("无法读取已保存的平台选择".into()),
    };
    atomic_write(&selection, profile_id.as_bytes()).map_err(|_| "无法保存平台选择")?;
    settings.active_relay_id = profile.id.clone();
    settings.relay_profiles.retain(|p| p.id != profile.id);
    settings.relay_profiles.push(profile);
    let result =
        crate::commands::switch_relay_profile(crate::commands::RelayProfileSwitchRequest {
            settings,
            previous_active_relay_id: previous,
            live_conflict_resolution: Default::default(),
        });
    if result.status != "ok" {
        atomic_write(&selection, &previous_selection)
            .map_err(|_| format!("{}；无法恢复已保存的平台选择", result.message))?;
        return Err(result.message);
    }
    Ok(json!({"model":model,"message":format!("已配置 {}，可启动 Codex", platform.name())}))
}

#[tauri::command]
pub async fn fastaiapi_media_configure(
    key_id: i64,
    platform: Option<String>,
) -> Result<Value, String> {
    panels::configure_media(panels::resolve(platform.as_deref())?, key_id).await
}

fn account_profile(
    platform: Platform,
    existing: RelayProfile,
    profile_id: String,
    key: String,
    model: String,
    models: Vec<String>,
    origin: &str,
) -> Result<RelayProfile, String> {
    // 配置模板优先于 profile.model；显式选模型时必须同步更新，保留其他高级项。
    let mut config = existing
        .config_contents
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| "已有供应商配置格式无效，请先修复配置后再切换模型")?;
    config["model"] = toml_edit::value(model.as_str());
    let provider = config
        .get("model_provider")
        .and_then(|v| v.as_str())
        .unwrap_or("custom")
        .to_owned();
    if config
        .get("model_providers")
        .and_then(|v| v.get(&provider))
        .is_some()
    {
        config["model_providers"][&provider]["base_url"] = toml_edit::value(format!("{origin}/v1"));
    }
    Ok(RelayProfile {
        id: profile_id,
        name: platform.name().into(),
        model,
        base_url: format!("{origin}/v1"),
        upstream_base_url: format!("{origin}/v1"),
        api_key: key.clone(),
        api_keys: vec![RelayApiKey {
            id: "account".into(),
            name: platform.name().into(),
            api_key: key,
        }],
        active_api_key_id: "account".into(),
        relay_mode: RelayMode::PureApi,
        model_list: models.join("\n"),
        config_contents: config.to_string(),
        ..existing
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_model_selection_is_scoped_to_platform() {
        let profiles = vec![
            RelayProfile {
                id: "fastaiapi-newapi-7".into(),
                model: "new-model".into(),
                ..Default::default()
            },
            RelayProfile {
                id: "fastaiapi-subapi-7".into(),
                model: "sub-model".into(),
                ..Default::default()
            },
        ];
        assert_eq!(
            account_configuration(
                &profiles,
                "fastaiapi-subapi-7",
                "fastaiapi-newapi-7",
                Platform::NewApi
            )
            .unwrap()
            .model,
            "new-model"
        );
        assert_eq!(
            account_configuration(&profiles, "fastaiapi-newapi-7", "", Platform::SubApi)
                .unwrap()
                .model,
            "sub-model"
        );
        assert!(
            account_configuration(
                &profiles[..1],
                "fastaiapi-newapi-7",
                "fastaiapi-newapi-7",
                Platform::SubApi
            )
            .is_none()
        );
        assert_eq!(
            account_configuration(
                &profiles,
                "fastaiapi-official",
                "fastaiapi-newapi-7",
                Platform::NewApi
            )
            .unwrap()
            .id,
            "fastaiapi-newapi-7"
        );
    }
    #[test]
    fn model_switch_preserves_context_settings() {
        let existing = RelayProfile {
            config_contents: "model = \"gpt-old\"\nmodel_reasoning_effort = \"high\"\n".into(),
            context_window: "200000".into(),
            auto_compact_limit: "160000".into(),
            model_windows: r#"{"gpt-5.6-sol":"200000"}"#.into(),
            ..Default::default()
        };
        let updated = account_profile(
            Platform::NewApi,
            existing,
            "fastaiapi-test".into(),
            "test-only".into(),
            "gpt-5.6-sol".into(),
            vec!["gpt-5.6-sol".into()],
            "http://8.137.194.180:90",
        )
        .unwrap();
        assert_eq!(updated.base_url, "http://8.137.194.180:90/v1");
        assert_eq!(updated.name, "TuMeiAPI");
        assert_eq!(updated.api_keys[0].name, "TuMeiAPI");
        assert_eq!(updated.context_window, "200000");
        assert_eq!(updated.auto_compact_limit, "160000");
        assert!(updated.model_windows.contains("200000"));
        assert_eq!(updated.model, "gpt-5.6-sol");
        assert_eq!(
            codex_plus_core::relay_config::relay_profile_model(&updated),
            "gpt-5.6-sol"
        );
        assert!(
            updated
                .config_contents
                .contains("model_reasoning_effort = \"high\"")
        );
        assert!(!updated.config_contents.contains("gpt-old"));
    }
    #[test]
    fn selected_route_replaces_template_endpoint() {
        let existing = RelayProfile { config_contents: "model_provider = \"custom\"\n[model_providers.custom]\nbase_url = \"https://old.invalid/v1\"\n".into(), ..Default::default() };
        let updated = account_profile(
            Platform::NewApi,
            existing,
            "fastaiapi-newapi-1-1".into(),
            "test-only".into(),
            "gpt-test".into(),
            vec!["gpt-test".into()],
            "https://tumeiapi.com",
        )
        .unwrap();
        assert_eq!(
            codex_plus_core::relay_config::relay_profile_base_url(&updated),
            "https://tumeiapi.com/v1"
        );
    }
}
