//! 媒体环境变量的用户级持久化。只使用 FASTAIAPI_*，不覆盖其他供应商的 OPENAI_*。
use crate::fastaiapi_platform::Platform;
use serde_json::{Value, json};
use std::process::Command;
pub const KEY_NAMES: [&str; 3] = [
    "FASTAIAPI_API_KEY",
    "FASTAIAPI_GROK_API_KEY",
    "FASTAIAPI_H3_API_KEY",
];
pub fn service(_route: usize) -> String {
    "com.fastaiapi.codexplusplus.newapi.media".into()
}
pub fn descriptor_path() -> std::path::PathBuf {
    crate::relay_config::default_codex_home_dir().join("skills/fastaiapi-media/connection.json")
}
pub fn load(_route: usize) -> Option<Value> {
    load_for(Platform::NewApi)
}
pub fn load_for(platform: Platform) -> Option<Value> {
    let names = if platform == Platform::NewApi {
        vec![
            platform.service("media"),
            "com.fastaiapi.codexplusplus.newapi.1.media".into(),
            "com.fastaiapi.codexplusplus.newapi.0.media".into(),
        ]
    } else {
        vec![platform.service("media")]
    };
    names.into_iter().find_map(|name| {
        crate::fastaiapi_secret_store::load(&name).and_then(|v| serde_json::from_slice(&v).ok())
    })
}

pub fn write_descriptor(route: usize) -> Result<(), String> {
    write_descriptor_for(Platform::NewApi, crate::fastaiapi::ORIGINS[route])
}
pub fn is_active(platform: Platform) -> bool {
    std::fs::read(descriptor_path())
        .ok()
        .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
        .is_some_and(|v| v["service"] == platform.service("media"))
}
fn write_descriptor_for(platform: Platform, origin: &str) -> Result<(), String> {
    let path = descriptor_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法创建媒体连接目录")?;
    let value = json!({"platform": platform.id(), "origin": origin, "service": platform.service("media"), "account": crate::fastaiapi_secret_store::account(), "managed": true});
    let pending = path.with_extension("pending");
    std::fs::write(&pending, value.to_string()).map_err(|_| "无法保存媒体路线")?;
    std::fs::rename(pending, path).map_err(|_| "无法更新媒体路线".into())
}
pub fn store(route: usize, key: &str) -> Result<Value, String> {
    store_for(Platform::NewApi, crate::fastaiapi::ORIGINS[route], key)
}
pub fn store_for(platform: Platform, origin: &str, key: &str) -> Result<Value, String> {
    if !platform.origins().contains(&origin) {
        return Err("媒体路线无效".into());
    }
    if !crate::fastaiapi_secret_store::save(
        &platform.service("media"),
        json!({"origin": origin, "api_key": key})
            .to_string()
            .as_bytes(),
    ) {
        return Err("系统凭据库权限不足，无法保存媒体 Key；请允许钥匙串访问或手动配置。".into());
    }
    write_descriptor_for(platform, origin)?;
    let warning = export(key, origin).err();
    Ok(
        json!({"configured": true, "environment_configured": warning.is_none(), "warning": warning, "origin": origin}),
    )
}
pub fn user_value(name: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/bin/launchctl")
            .args(["getenv", name])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let value = String::from_utf8(output.stdout).ok()?.trim().to_owned();
        return (!value.is_empty()).then_some(value);
    }
    #[cfg(windows)]
    {
        return crate::windows_integration::read_current_user_string_values("Environment")
            .ok()?
            .into_iter()
            .find(|(k, _)| k == name)
            .and_then(|(_, v)| v);
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        std::env::var(name).ok()
    }
}
pub fn matches(key: &str, origin: &str) -> bool {
    KEY_NAMES
        .iter()
        .all(|name| user_value(name).as_deref() == Some(key))
        && user_value("FASTAIAPI_BASE_URL").as_deref() == Some(origin)
}
fn export(key: &str, origin: &str) -> Result<(), String> {
    for (name, value) in KEY_NAMES
        .iter()
        .map(|name| (*name, key))
        .chain(std::iter::once(("FASTAIAPI_BASE_URL", origin)))
    {
        #[cfg(target_os = "macos")]
        {
            let output = Command::new("/bin/launchctl")
                .args(["setenv", name, value])
                .output()
                .map_err(|_| "无法写入用户环境变量；请检查系统权限后点击一键修复。")?;
            if !output.status.success() {
                return Err(
                    "系统拒绝写入环境变量；Key 已安全保存，请允许权限后点击一键修复。".into(),
                );
            }
        }
        #[cfg(windows)]
        crate::windows_integration::set_current_user_string_value("Environment", name, value)
            .map_err(|_| "用户环境变量写入失败，请检查权限后点击一键修复。")?;
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = (name, value);
            return Err("当前系统请手动设置 FASTAIAPI_* 用户环境变量。".into());
        }
    }
    #[cfg(target_os = "macos")]
    install_login_restore()?;
    Ok(())
}
#[cfg(target_os = "macos")]
fn install_login_restore() -> Result<(), String> {
    // 登录时只恢复用户级环境，不打开 GUI。plist 不含任何密钥。
    let exe = std::env::current_exe().map_err(|_| "无法定位环境恢复程序")?;
    // cargo 示例只用于检查，不把临时测试二进制注册成开机项。
    if exe.to_string_lossy().contains("/examples/") {
        return Ok(());
    }
    let escape = |value: &str| {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let state = crate::paths::default_app_state_dir();
    let contents = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.fastaiapi.codexplusplus.media-environment</string><key>ProgramArguments</key><array><string>{}</string><string>--sync-media-environment</string></array><key>EnvironmentVariables</key><dict><key>CODEX_PLUS_STATE_DIR</key><string>{}</string></dict><key>RunAtLoad</key><true/></dict></plist>"#,
        escape(&exe.to_string_lossy()),
        escape(&state.to_string_lossy())
    );
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .ok_or("无法定位用户目录")?;
    let directory = home.join("Library/LaunchAgents");
    std::fs::create_dir_all(&directory)
        .map_err(|_| "无法保存登录环境恢复项，请检查用户目录权限。")?;
    std::fs::write(
        directory.join("com.fastaiapi.codexplusplus.media-environment.plist"),
        contents,
    )
    .map_err(|_| "无法保存登录环境恢复项，请检查用户目录权限。".into())
}
pub fn restore() -> Result<(), String> {
    let descriptor: Value =
        serde_json::from_slice(&std::fs::read(descriptor_path()).map_err(|_| "尚未配置媒体连接")?)
            .map_err(|_| "媒体连接配置无效")?;
    let platform = Platform::parse(descriptor["platform"].as_str().unwrap_or("newapi"))?;
    let origin = descriptor["origin"]
        .as_str()
        .filter(|origin| platform.origins().contains(origin))
        .ok_or("媒体路线无效")?;
    if descriptor["service"] != platform.service("media") {
        return Err("媒体凭据来源无效".into());
    }
    let secret = load_for(platform).ok_or("系统凭据库不可用，请在应用中修复媒体连接")?;
    export(secret["api_key"].as_str().ok_or("媒体 Key 缺失")?, origin)
}
