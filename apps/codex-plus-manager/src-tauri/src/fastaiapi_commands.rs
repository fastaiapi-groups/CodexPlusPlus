use codex_plus_core::settings::{RelayApiKey, RelayMode, RelayProfile, SettingsStore};
use serde_json::{Value, json};

#[tauri::command]
pub async fn fastaiapi_account(
    action: String,
    id: Option<String>,
    body: Option<Value>,
) -> Result<Value, String> {
    if action == "configuration" {
        let settings = SettingsStore::default()
            .load()
            .map_err(|_| "无法读取本地配置")?;
        let prefix = "fastaiapi-newapi-";
        let profile = settings
            .relay_profiles
            .iter()
            .find(|p| p.id == settings.active_relay_id && p.id.starts_with(prefix));
        return Ok(profile.map(|p| json!({"model": p.model, "key_id": p.id.strip_prefix(prefix).and_then(|id| id.rsplit('-').next()).and_then(|id| id.parse::<i64>().ok())})).unwrap_or(json!({})));
    }
    if action == "select_route" {
        let mut result =
            codex_plus_core::fastaiapi::account(&action, "", body.unwrap_or(json!({}))).await?;
        let route = codex_plus_core::fastaiapi::selected_route().await;
        if let Err(error) = update_account_route(codex_plus_core::fastaiapi::ORIGINS[route]) {
            result["configuration_warning"] = json!(error);
        }
        return Ok(result);
    }
    codex_plus_core::fastaiapi::account(
        &action,
        id.as_deref().unwrap_or(""),
        body.unwrap_or(json!({})),
    )
    .await
}
fn update_account_route(origin: &str) -> Result<(), String> {
    let mut settings = SettingsStore::default()
        .load()
        .map_err(|_| "无法读取账户模型配置")?;
    let previous = settings.active_relay_id.clone();
    let Some(index) = settings
        .relay_profiles
        .iter()
        .position(|profile| profile.id == previous && profile.id.starts_with("fastaiapi-newapi-"))
    else {
        return Ok(());
    };
    let profile = settings.relay_profiles[index].clone();
    let models = profile.model_list.lines().map(str::to_owned).collect();
    settings.relay_profiles[index] = account_profile(
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
pub async fn fastaiapi_models(key_id: i64) -> Result<Vec<String>, String> {
    Ok(codex_plus_core::fastaiapi::key_and_models(key_id).await?.1)
}
#[tauri::command]
pub async fn fastaiapi_configure(key_id: i64, model: String) -> Result<Value, String> {
    let route = codex_plus_core::fastaiapi::selected_route().await;
    let (key, models) = codex_plus_core::fastaiapi::key_and_models(key_id).await?;
    if codex_plus_core::fastaiapi::selected_route().await != route {
        return Err("路线已切换，请重新选择模型".into());
    }
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
    let profile_id = codex_plus_core::fastaiapi::profile_id(route, key_id);
    // 切换模型只更新账户连接信息，保留该供应商已有的上下文等高级配置。
    let existing = settings
        .relay_profiles
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .unwrap_or_default();
    let profile = account_profile(
        existing,
        profile_id,
        key,
        model.clone(),
        models,
        codex_plus_core::fastaiapi::ORIGINS[route],
    )?;
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
        return Err(result.message);
    }
    install_media_skill()?;
    Ok(json!({"model": model, "message": "已配置 FastAiApi，可启动 Codex"}))
}

#[tauri::command]
pub async fn fastaiapi_media_configure(key_id: i64) -> Result<Value, String> {
    install_media_skill()?;
    codex_plus_core::fastaiapi::configure_media(key_id).await
}

fn account_profile(
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
        name: "FastAiApi".into(),
        model,
        base_url: format!("{origin}/v1"),
        upstream_base_url: format!("{origin}/v1"),
        api_key: key.clone(),
        api_keys: vec![RelayApiKey {
            id: "account".into(),
            name: "FastAiApi".into(),
            api_key: key,
        }],
        active_api_key_id: "account".into(),
        relay_mode: RelayMode::PureApi,
        model_list: models.join("\n"),
        config_contents: config.to_string(),
        ..existing
    })
}

pub fn install_media_skill() -> Result<(), String> {
    let root =
        codex_plus_core::relay_config::default_codex_home_dir().join("skills/fastaiapi-media");
    install_media_skill_at(&root)
}

fn install_media_skill_at(root: &std::path::Path) -> Result<(), String> {
    use std::hash::Hasher;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    for (name, bytes) in MEDIA_FILES {
        hash.write(name.as_bytes());
        hash.write(bytes);
    }
    let version = format!("{:016x}", hash.finish());
    let marker = root.join(".codex-plus-bundle");
    if std::fs::read_to_string(&marker).ok().as_deref() == Some(&version)
        && MEDIA_FILES
            .iter()
            .all(|(name, _)| root.join(name).is_file())
    {
        return Ok(());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "系统时间无效")?
        .as_nanos();
    let backup = root.with_file_name(format!("fastaiapi-media-backup-{stamp}"));
    for (name, bytes) in MEDIA_FILES {
        let path = root.join(name);
        if path.is_file() {
            let existing = std::fs::read(&path).map_err(|_| "无法读取旧媒体技能")?;
            if existing == *bytes {
                continue;
            }
            let previous = backup.join(name);
            std::fs::create_dir_all(previous.parent().unwrap())
                .map_err(|_| "无法备份旧媒体技能")?;
            std::fs::write(previous, existing).map_err(|_| "无法备份旧媒体技能")?;
        }
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法创建媒体技能目录")?;
        let pending = path.with_extension("bundle-pending");
        std::fs::write(&pending, bytes).map_err(|_| "无法写入媒体技能")?;
        std::fs::rename(pending, path).map_err(|_| "无法更新媒体技能")?;
    }
    std::fs::write(marker, version).map_err(|_| "无法记录媒体技能版本")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
            existing,
            "fastaiapi-test".into(),
            "test-only".into(),
            "gpt-5.6-sol".into(),
            vec!["gpt-5.6-sol".into()],
            "http://8.137.194.180:90",
        )
        .unwrap();
        assert_eq!(updated.base_url, "http://8.137.194.180:90/v1");
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
    #[test]
    fn bundled_skill_installs_complete_and_preserves_user_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("fastaiapi-media");
        install_media_skill_at(&root).unwrap();
        assert!(root.join("scripts/media_api.py").is_file());
        assert!(root.join("SKILL.md").is_file());
        std::fs::write(root.join("SKILL.md"), "user edit").unwrap();
        install_media_skill_at(&root).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("SKILL.md")).unwrap(),
            "user edit"
        );
    }
}

const MEDIA_FILES: &[(&str, &[u8])] = &[
    (
        "SKILL.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/SKILL.md"),
    ),
    (
        "references/grok.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/grok.md"),
    ),
    (
        "references/h3-base.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/h3-base.md"),
    ),
    (
        "references/h3-reference.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/h3-reference.md"),
    ),
    (
        "references/h3.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/h3.md"),
    ),
    (
        "references/images.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/images.md"),
    ),
    (
        "references/setup.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/setup.md"),
    ),
    (
        "references/sources.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/sources.md"),
    ),
    (
        "references/workflow.md",
        include_bytes!("../../../../integrations/fastaiapi/media-api/references/workflow.md"),
    ),
    (
        "scripts/common.py",
        include_bytes!("../../../../integrations/fastaiapi/media-api/scripts/common.py"),
    ),
    (
        "scripts/grok.py",
        include_bytes!("../../../../integrations/fastaiapi/media-api/scripts/grok.py"),
    ),
    (
        "scripts/h3.py",
        include_bytes!("../../../../integrations/fastaiapi/media-api/scripts/h3.py"),
    ),
    (
        "scripts/media_api.py",
        include_bytes!("../../../../integrations/fastaiapi/media-api/scripts/media_api.py"),
    ),
    (
        "scripts/test_media_api.py",
        include_bytes!("../../../../integrations/fastaiapi/media-api/scripts/test_media_api.py"),
    ),
];
