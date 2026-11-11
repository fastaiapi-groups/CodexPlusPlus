//! FastAiApi 媒体工具：应用内置的本地 MCP，不依赖 Python 或用户环境变量。
mod connection;
mod mcp;
mod protocol;
mod runs;

use crate::managed_mcp::ManagedMcp;
pub(crate) use connection::{current_key, status_for};
pub use connection::{
    enable_native, has_saved_route, native_enabled, validate_media_origin, verify_connection,
};
pub use mcp::run;

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
    fn rejects_plain_http_and_routes_from_another_platform() {
        use crate::fastaiapi_platform::Platform;
        assert!(validate_media_origin(Platform::NewApi, "http://8.137.194.180:90").is_err());
        assert!(validate_media_origin(Platform::NewApi, "https://fastaiapi.cloud").is_err());
        assert!(validate_media_origin(Platform::NewApi, "https://tumeiapi.com").is_ok());
    }
}
