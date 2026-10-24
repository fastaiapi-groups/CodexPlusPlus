//! 安装验收专用：只操作带固定标记的隔离测试目录及合成凭据，不接触真实账号。
#[path = "../src/fastaiapi_secret_store.rs"]
mod fastaiapi_secret_store;
#[path = "../src/fastaiapi_session.rs"]
mod fastaiapi_session;
#[path = "../src/fastaiapi_credentials.rs"]
mod fastaiapi_credentials;

use anyhow::{Context, ensure};
use codex_plus_core::settings::{BackendSettings, SettingsStore};
use serde_json::json;
use std::{fs, path::PathBuf};

fn main() -> anyhow::Result<()> {
    let root = PathBuf::from(std::env::var_os("CODEX_PLUS_STATE_DIR").context("必须指定隔离状态目录")?);
    ensure!(root.is_absolute() && root.file_name().and_then(|s| s.to_str()) == Some("upgrade-test-state"), "只允许专用测试目录");
    ensure!(std::env::var_os("CODEX_HOME").map(PathBuf::from) == Some(root.join("codex-home")), "必须隔离 Codex 配置目录");
    let action = std::env::args().nth(1).context("seed/verify/logout/forget")?;
    let store = SettingsStore::new(root.join("settings.json"));
    match action.as_str() {
        "seed" => {
            fs::create_dir_all(&root)?;
            let mut settings = BackendSettings::default();
            settings.codex_app_auto_takeover = false;
            settings.relay_profiles[0].name = "升级保留测试".into();
            settings.relay_profiles[0].model = "gpt-6.1-sol".into();
            settings.relay_profiles[0].base_url = "https://fastaiapi.cloud/v1".into();
            settings.relay_profiles[0].api_key = "synthetic-upgrade-test-key".into();
            store.save(&settings)?;
            fs::create_dir_all(root.join("codex-home"))?;
            fs::write(root.join("codex-home/config.toml"), "model = \"gpt-6.1-sol\"\nmodel_provider = \"upgrade-test\"\n")?;
            fs::write(root.join("codex-home/auth.json"), json!({"OPENAI_API_KEY":"synthetic-upgrade-test-key"}).to_string())?;
            fs::write(root.join("watcher.disabled"), b"upgrade-test")?;
            ensure!(fastaiapi_session::save("synthetic-upgrade-test-session"), "系统凭据库写入失败");
            ensure!(fastaiapi_credentials::save("upgrade-test@example.invalid", "synthetic-upgrade-test-password"), "记住账号写入失败");
        }
        "verify" => {
            let settings = store.load()?;
            let profile = settings.active_relay_profile();
            ensure!(profile.name == "升级保留测试" && profile.model == "gpt-6.1-sol" && profile.api_key == "synthetic-upgrade-test-key", "模型配置没有保留");
            ensure!(fastaiapi_session::load().as_deref() == Some("synthetic-upgrade-test-session"), "登录会话没有跨进程保留");
            let remembered = fastaiapi_credentials::load();
            ensure!(remembered["email"] == "upgrade-test@example.invalid" && remembered["password"] == "synthetic-upgrade-test-password", "记住的账号没有保留");
            ensure!(root.join("watcher.disabled").is_file(), "用户启动偏好没有保留");
        }
        "logout" => {
            fastaiapi_session::clear().map_err(anyhow::Error::msg)?;
            ensure!(fastaiapi_session::load().is_none(), "退出登录未生效");
            ensure!(fastaiapi_credentials::load()["email"] == "upgrade-test@example.invalid", "退出登录误删记住的账号");
        }
        "forget" => {
            fastaiapi_session::clear().map_err(anyhow::Error::msg)?;
            fastaiapi_credentials::clear().map_err(anyhow::Error::msg)?;
            ensure!(fastaiapi_credentials::load() == json!({}), "忘记账号未生效");
            fastaiapi_credentials::clear().map_err(anyhow::Error::msg)?;
        }
        _ => anyhow::bail!("未知验收动作"),
    }
    println!("UPGRADE_STATE_{}_OK", action.to_uppercase());
    Ok(())
}
