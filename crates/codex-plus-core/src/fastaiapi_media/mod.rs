//! FastAiApi 媒体工具：应用内置的本地 MCP，不依赖 Python 或用户环境变量。
mod connection;
mod mcp;
mod protocol;
mod runs;
mod video_models;

use crate::managed_mcp::ManagedMcp;
pub(crate) use connection::{current_key, status_for};
pub use connection::{
    enable_native, has_saved_route, native_enabled, validate_media_origin, verify_connection,
};
pub use mcp::run;
pub use video_models::video_test_models;

pub(crate) async fn test_image_data(
    platform: crate::fastaiapi_platform::Platform,
    origin: &str,
    key: &str,
    location: &str,
) -> anyhow::Result<String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let data = connection::download_for_route(
        &connection::client()?,
        platform,
        origin,
        key,
        location,
        18_000_000,
    )
    .await?;
    let mime = match protocol::image_extension(&data)? {
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(data)))
}

/// 桌面测试复用 MCP 的提交、查询和下载回执。
pub async fn video_test(
    state: &std::path::Path,
    action: &str,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    anyhow::ensure!(
        matches!(action, "submit_video" | "video_status" | "download_video"),
        "未知的视频测试操作"
    );
    mcp::call(state, &connection::client()?, action, args).await
}

pub const MCP_FLAG: &str = "--fastaiapi-media-mcp";

pub const SPEC: ManagedMcp = ManagedMcp {
    server_id: "fastaiapi_media",
    flag: MCP_FLAG,
    label: "FastAiApi 媒体工具",
    comment: "Managed by Codex++: FastAiApi media MCP",
    lock_file: ".fastaiapi-media-mcp.lock",
    backup_dir: ".fastaiapi-media-mcp-backups",
    legacy: &[],
    tool_timeout_sec: Some(420),
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_only_adds_the_media_command_and_preserves_existing_config() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().canonicalize().unwrap();
        let executable = std::env::current_exe().unwrap();
        let path = home.join("config.toml");
        let base = "model_provider = \"openai\"\n\n[mcp_servers.other]\ncommand = \"other-tool\"\n";
        std::fs::write(&path, base).unwrap();
        let auth = home.join("auth.json");
        std::fs::write(&auth, b"fixture-auth").unwrap();
        let receipt = crate::managed_mcp::install(&SPEC, &home, &executable, &home).unwrap();
        assert!(receipt.changed);
        let raw = std::fs::read_to_string(path).unwrap();
        let config = raw.parse::<toml_edit::DocumentMut>().unwrap();
        assert_eq!(config["model_provider"].as_str(), Some("openai"));
        assert_eq!(
            config["mcp_servers"]["other"]["command"].as_str(),
            Some("other-tool")
        );
        let media = &config["mcp_servers"][SPEC.server_id];
        assert_eq!(media["tool_timeout_sec"].as_float(), Some(420.0));
        assert!(media.get("env").is_none());
        assert!(media.get("env_vars").is_none());
        assert_eq!(std::fs::read(auth).unwrap(), b"fixture-auth");
        assert!(
            !crate::managed_mcp::install(&SPEC, &home, &executable, &home)
                .unwrap()
                .changed
        );
    }

    #[test]
    fn accepts_only_routes_built_into_the_selected_platform() {
        use crate::fastaiapi_platform::Platform;
        assert!(validate_media_origin(Platform::NewApi, "http://8.137.194.180:90").is_ok());
        assert!(validate_media_origin(Platform::NewApi, "http://tumeiapi.com").is_err());
        assert!(validate_media_origin(Platform::NewApi, "https://fastaiapi.cloud").is_err());
        assert!(validate_media_origin(Platform::NewApi, "https://tumeiapi.com").is_ok());
    }
}
