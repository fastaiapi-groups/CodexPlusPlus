use codex_plus_core::{
    fastaiapi_media::{self as media, SPEC},
    fastaiapi_platform as panels, managed_mcp, paths,
    settings::SettingsStore,
};
use serde_json::{Value, json};

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
        "connect" => {
            let status = registration()?;
            if status.status == "conflict" {
                return Err(status.message);
            }
            let platform = panels::resolve(platform.as_deref())?;
            panels::ensure_current(platform).await?;
            let origin = panels::origin(platform).await;
            media::validate_media_origin(platform, origin).map_err(|error| error.to_string())?;
            media::enable_native().map_err(|_| "无法保存媒体工具本地配置")?;
            if let Some(key) = api_key {
                panels::account(platform, "media_manual", "", json!({"api_key":key})).await?;
            } else if !media::has_saved_route(platform, origin) {
                panels::account(platform, "media_setup", "", json!({})).await?;
            }
            media::verify_connection(platform, origin)
                .await
                .map_err(|error| error.to_string())?;
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
                "message":"媒体工具已连接，重新打开 Codex 会话后可在对话中调用。"}))
        }
        _ => Err("未知的媒体工具操作".into()),
    }
}
