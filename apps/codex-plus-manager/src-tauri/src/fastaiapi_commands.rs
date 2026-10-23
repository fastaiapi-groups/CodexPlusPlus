use codex_plus_core::settings::{RelayApiKey, RelayMode, RelayProfile, SettingsStore};
use serde_json::{Value, json};

#[tauri::command]
pub async fn fastaiapi_account(
    action: String,
    id: Option<String>,
    body: Option<Value>,
) -> Result<Value, String> {
    codex_plus_core::fastaiapi::account(
        &action,
        id.as_deref().unwrap_or(""),
        body.unwrap_or(json!({})),
    )
    .await
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
    let (key, models) = codex_plus_core::fastaiapi::key_and_models(key_id).await?;
    if !models.contains(&model) {
        return Err("请选择该 Key 可用的模型".into());
    }
    let mut settings = SettingsStore::default()
        .load()
        .map_err(|_| "无法读取本地配置")?;
    let previous = settings.active_relay_id.clone();
    let profile = RelayProfile {
        id: format!("fastaiapi-{key_id}"),
        name: "FastAiApi".into(),
        model: model.clone(),
        base_url: "https://fastaiapi.cloud/v1".into(),
        upstream_base_url: "https://fastaiapi.cloud/v1".into(),
        api_key: key.clone(),
        api_keys: vec![RelayApiKey {
            id: "account".into(),
            name: "FastAiApi".into(),
            api_key: key,
        }],
        active_api_key_id: "account".into(),
        relay_mode: RelayMode::PureApi,
        model_list: models.join("\n"),
        ..Default::default()
    };
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

pub fn install_media_skill() -> Result<(), String> {
    let root =
        codex_plus_core::relay_config::default_codex_home_dir().join("skills/fastaiapi-media");
    install_media_skill_at(&root)
}

fn install_media_skill_at(root: &std::path::Path) -> Result<(), String> {
    // 不覆盖已有技能；先写完暂存目录，再原子发布，避免半安装状态。
    if root.exists() {
        return Ok(());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "系统时间无效")?
        .as_nanos();
    let staging = root.with_file_name(format!(".fastaiapi-media-{stamp}"));
    for (name, bytes) in MEDIA_FILES {
        let path = staging.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法创建内置技能目录")?;
        std::fs::write(path, bytes).map_err(|_| "无法写入内置技能")?;
    }
    std::fs::rename(staging, root).map_err(|_| "无法发布内置技能")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_skill_installs_complete_and_preserves_user_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("fastaiapi-media");
        install_media_skill_at(&root).unwrap();
        assert!(root.join("scripts/media_api.py").is_file());
        assert!(root.join("references/h3.md").is_file());
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
