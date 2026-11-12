use codex_plus_core::{
    fastaiapi_media::{self as media, SPEC},
    fastaiapi_platform as panels, managed_mcp, paths,
    settings::SettingsStore,
};
use serde_json::{Value, json};
use std::path::PathBuf;
use tauri::Manager;

static CONNECT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
pub async fn fastaiapi_video_test(
    app: tauri::AppHandle,
    action: String,
    body: Value,
) -> Result<Value, String> {
    if action == "capabilities" {
        return Ok(json!(media::video_test_models(panels::selected())));
    }
    let workspace = body["workspace"].as_str().map(PathBuf::from);
    let result = media::video_test(&paths::default_app_state_dir(), &action, body)
        .await
        .map_err(|error| error.to_string())?;
    if result["state"] == "downloaded"
        && let (Some(root), Some(id), Some(files)) = (
            workspace.and_then(|path| path.canonicalize().ok()),
            result["request_id"].as_str(),
            result["files"].as_array(),
        )
    {
        let output = root.join("outputs").join(format!("fastaiapi-{id}"));
        for file in files.iter().filter_map(Value::as_str) {
            if let Ok(path) = std::fs::canonicalize(file)
                && path.parent() == Some(output.as_path())
                && matches!(
                    path.file_name().and_then(|name| name.to_str()),
                    Some("video.mp4" | "video.webm")
                )
            {
                app.asset_protocol_scope()
                    .allow_file(path)
                    .map_err(|_| "视频已下载，但无法打开本地预览")?;
            }
        }
    }
    Ok(result)
}

/// 仅注册媒体工具；模型路由和 Codex 的登录配置由原有切换逻辑维护。
#[tauri::command]
pub async fn fastaiapi_media_tool(
    action: String,
    platform: Option<String>,
    api_key: Option<String>,
) -> Result<Value, String> {
    let home = codex_plus_core::codex_home::default_codex_home_dir();
    let exe = std::env::current_exe().map_err(|_| "无法定位媒体工具程序")?;
    let state = paths::default_app_state_dir();
    let registration =
        || managed_mcp::status(&SPEC, &home, &exe, &state).map_err(|error| error.to_string());
    match action.as_str() {
        "status" => {
            let status = registration()?;
            Ok(json!({"registered":status.registered && !status.disabled,"message":status.message}))
        }
        "connect" | "ensure" => {
            let _guard = CONNECT_LOCK.lock().await;
            let status = registration()?;
            if status.status == "conflict" {
                return Err(status.message);
            }
            let platform = panels::resolve(platform.as_deref())?;
            panels::ensure_current(platform).await?;
            let origin = panels::origin(platform).await;
            media::validate_media_origin(platform, origin).map_err(|error| error.to_string())?;
            if action == "ensure" {
                if status.disabled {
                    return Err("媒体工具已停用，可在 MCP 与 Skills 中重新启用。".into());
                }
                media::enable_native().map_err(|_| "无法保存媒体工具本地配置")?;
                codex_plus_core::fastaiapi_media_env::restore_group_route(platform, origin)?;
                if status.registered {
                    return Ok(json!({"registered":true}));
                }
            } else {
                media::enable_native().map_err(|_| "无法保存媒体工具本地配置")?;
                if let Some(key) = api_key {
                    panels::account(platform, "media_manual", "", json!({"api_key":key})).await?;
                } else if !media::has_saved_route(platform, origin) {
                    panels::account(platform, "media_setup", "", json!({})).await?;
                }
                media::verify_connection(platform, origin)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            crate::agent_collaboration_commands::connect_codex(
                &SPEC,
                &SettingsStore::default(),
                &home,
                &exe,
                &state,
            )
            .map_err(|error| error.to_string())?;
            let status = registration()?;
            Ok(json!({"registered":status.registered && !status.disabled,
                "message":"媒体工具已注册。"}))
        }
        _ => Err("未知的媒体工具操作".into()),
    }
}
