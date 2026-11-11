//! 媒体环境变量的用户级持久化。只使用 FASTAIAPI_*，不覆盖其他供应商的 OPENAI_*。
use crate::fastaiapi_platform::Platform;
use serde_json::{Value, json};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
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
pub(crate) fn credential_services(platform: Platform) -> Vec<String> {
    if platform == Platform::NewApi {
        vec![
            platform.service("media"),
            "com.fastaiapi.codexplusplus.newapi.1.media".into(),
            "com.fastaiapi.codexplusplus.newapi.0.media".into(),
        ]
    } else {
        vec![platform.service("media")]
    }
}
pub fn load_for(platform: Platform) -> Option<Value> {
    credential_services(platform).into_iter().find_map(|name| {
        crate::fastaiapi_secret_store::load(&name).and_then(|v| serde_json::from_slice(&v).ok())
    })
}

pub fn write_descriptor(route: usize) -> Result<(), String> {
    write_descriptor_for(
        Platform::NewApi,
        crate::fastaiapi::ORIGINS[route],
        true,
        None,
    )
}
pub fn is_active(platform: Platform) -> bool {
    std::fs::read(descriptor_path())
        .ok()
        .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
        .is_some_and(|v| v["service"] == platform.service("media"))
}
fn write_descriptor_for(
    platform: Platform,
    origin: &str,
    configured: bool,
    warning: Option<&str>,
) -> Result<(), String> {
    write_descriptor_at(&descriptor_path(), platform, origin, configured, warning)
}
fn write_descriptor_at(
    path: &std::path::Path,
    platform: Platform,
    origin: &str,
    configured: bool,
    warning: Option<&str>,
) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("媒体连接目录无效")?)
        .map_err(|_| "无法创建媒体连接目录，请检查用户目录权限后重试。")?;
    // 只有非敏感连接信息；写入失败保持旧文件，绝不把 Key 写入描述文件。
    let previous = std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or_else(|| json!({}));
    let value = json!({"platform": platform.id(), "origin": origin, "service": platform.service("media"), "account": crate::fastaiapi_secret_store::account(), "managed": true, "environment_configured": configured, "environment_warning": warning, "model_defaults": previous.get("model_defaults").filter(|v| v.is_object()).cloned().unwrap_or_else(||json!({})), "pricing_keys": previous.get("pricing_keys").filter(|v|v.is_object()).cloned().unwrap_or_else(||json!({}))});
    write_connection_at(path, &value)
}
fn write_connection_at(path: &std::path::Path, value: &Value) -> Result<(), String> {
    let pending = path.with_extension("pending");
    std::fs::write(&pending, value.to_string())
        .map_err(|_| "无法保存媒体连接，请检查目录写入权限后重试。")?;
    std::fs::rename(pending, path)
        .map_err(|_| "无法更新媒体连接，请检查目录权限或文件占用后重试。".into())
}
fn model_defaults_from(value: &Value, platform: Platform) -> Value {
    let defaults = &value["model_defaults"][platform.id()];
    json!({"image_model":defaults["image"].as_str().filter(|model| valid_model("image", model)).unwrap_or("gpt-image-2"),
        "video_model":defaults["video"].as_str().filter(|model| valid_model("video", model)).unwrap_or("minimax-h3")})
}
pub fn model_defaults(platform: Platform) -> Value {
    let descriptor = std::fs::read(descriptor_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or_else(|| json!({}));
    model_defaults_from(&descriptor, platform)
}
fn valid_model(kind: &str, model: &str) -> bool {
    matches!(kind, "image" | "video")
        && !model.is_empty()
        && model.len() <= 200
        && model
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"._:/-".contains(&ch))
        && crate::fastaiapi::model_kind(model) == kind
}
fn select_model_in(
    value: &mut Value,
    platform: Platform,
    origin: &str,
    kind: &str,
    model: &str,
    models: &[&str],
) -> Result<(), String> {
    if value["service"] != platform.service("media") || value["origin"] != origin {
        return Err("请先配置当前平台的媒体连接。".into());
    }
    if !valid_model(kind, model) || !models.contains(&model) {
        return Err("请选择当前媒体 Key 可用的对应类型模型。".into());
    }
    if platform == Platform::SubApi
        && kind == "video"
        && !["minimax-h3", "grok-imagine-video-1.5"].contains(&model)
    {
        return Err(
            "当前 SubAPI 视频适配器仅支持 minimax-h3 和 grok-imagine-video-1.5，请选择已适配型号。"
                .into(),
        );
    }
    if !value["model_defaults"].is_object() {
        value["model_defaults"] = json!({});
    }
    if !value["model_defaults"][platform.id()].is_object() {
        value["model_defaults"][platform.id()] = json!({});
    }
    value["model_defaults"][platform.id()][kind] = json!(model);
    Ok(())
}
pub fn select_model(
    platform: Platform,
    origin: &str,
    kind: &str,
    model: &str,
    models: &[&str],
) -> Result<Value, String> {
    let path = descriptor_path();
    let mut value: Value =
        serde_json::from_slice(&std::fs::read(&path).map_err(|_| "请先配置媒体连接")?)
            .map_err(|_| "媒体连接配置无效，请一键修复")?;
    select_model_in(&mut value, platform, origin, kind, model, models)?;
    write_connection_at(&path, &value)?;
    Ok(model_defaults_from(&value, platform))
}
pub fn pricing_key_id(platform: Platform) -> Result<i64, String> {
    let value: Value =
        serde_json::from_slice(&std::fs::read(descriptor_path()).map_err(|_| "请先配置媒体连接")?)
            .map_err(|_| "媒体连接无效")?;
    if value["service"] != platform.service("media") {
        return Err("请先配置当前平台媒体连接".into());
    }
    value["pricing_keys"][platform.id()]
        .as_i64()
        .filter(|id| *id > 0)
        .ok_or("未能确定媒体 Key 所属分组；请一键修复后查看价格，手动 Key 请到平台核对。".into())
}
pub fn set_pricing_key_id(platform: Platform, id: Option<i64>) -> Result<(), String> {
    let path = descriptor_path();
    let mut value: Value =
        serde_json::from_slice(&std::fs::read(&path).map_err(|_| "无法读取媒体配置")?)
            .map_err(|_| "媒体连接无效")?;
    if value["service"] != platform.service("media") {
        return Err("媒体连接与平台不匹配".into());
    }
    if !value["pricing_keys"].is_object() {
        value["pricing_keys"] = json!({});
    }
    value["pricing_keys"][platform.id()] = json!(id);
    write_connection_at(&path, &value)
}
pub fn credential_fallback(platform: Platform, origin: &str) -> bool {
    std::fs::read(descriptor_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|v| {
            v["service"] == platform.service("media")
                && v["origin"] == origin
                && v["environment_configured"] == false
        })
}
pub fn environment_warning(platform: Platform, origin: &str) -> Option<String> {
    let value: Value = serde_json::from_slice(&std::fs::read(descriptor_path()).ok()?).ok()?;
    if value["service"] != platform.service("media") || value["origin"] != origin {
        return None;
    }
    value["environment_warning"].as_str().map(str::to_owned)
}
pub fn store(route: usize, key: &str) -> Result<Value, String> {
    store_for(Platform::NewApi, crate::fastaiapi::ORIGINS[route], key)
}
/// 新连接默认走系统凭据库；已有旧连接由用户显式接入新工具时迁移。
pub(crate) fn use_native_on_save() -> bool {
    crate::fastaiapi_media::native_enabled() || !descriptor_path().exists()
}
pub fn store_for(platform: Platform, origin: &str, key: &str) -> Result<Value, String> {
    if !platform.origins().contains(&origin) {
        return Err("媒体路线无效".into());
    }
    if cfg!(not(any(target_os = "macos", windows))) {
        return Err(
            "当前系统暂不支持自动保存媒体凭据；请按媒体技能手册配置用户级 FASTAIAPI_* 环境变量。"
                .into(),
        );
    }
    let native = use_native_on_save();
    if native {
        crate::fastaiapi_media::validate_media_origin(platform, origin).map_err(|error| error.to_string())?;
        crate::fastaiapi_media::enable_native().map_err(|_| "无法保存媒体工具本地配置")?;
    }
    let same_key = load_for(platform).is_some_and(|value| value["api_key"] == key);
    if !crate::fastaiapi_secret_store::save(
        &platform.service("media"),
        json!({"origin": origin, "api_key": key})
            .to_string()
            .as_bytes(),
    ) {
        return Err("系统凭据库权限不足，无法保存媒体 Key；请在系统凭据库授权后重试（macOS 钥匙串／Windows 凭据管理器）。".into());
    }
    if native {
        write_descriptor_for(platform, origin, false, None)?;
        if !same_key {
            set_pricing_key_id(platform, None)?;
        }
        return Ok(json!({"configured":true,"transport":"mcp","origin":origin}));
    }
    // 先标记凭据库模式，防止写入一半或进程中断后使用继承的旧 Key。
    write_descriptor_for(
        platform,
        origin,
        false,
        Some("环境变量尚未配置完成，请点击一键修复。"),
    )?;
    let (configured, warning) = match export(key, origin) {
        Ok(()) => (true, persistence_warning()),
        Err(error) => (
            false,
            Some(format!(
                "{error} 媒体技能可尝试读取系统凭据库；请检查权限后点击一键修复。"
            )),
        ),
    };
    write_descriptor_for(platform, origin, configured, warning.as_deref())?;
    if !same_key {
        set_pricing_key_id(platform, None)?;
    }
    Ok(
        json!({"configured": true, "environment_configured": configured, "warning": warning, "origin": origin}),
    )
}

#[cfg(any(target_os = "macos", test))]
fn bounded_command(command: &mut Command, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::PermissionDenied => "系统拒绝执行环境命令，请检查用户权限。",
            std::io::ErrorKind::NotFound => "系统环境命令不存在，请检查系统组件。",
            _ => "无法启动系统环境命令，请检查系统环境。",
        })?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err("系统环境命令返回错误，请检查用户权限与环境服务。".into());
                }
                use std::io::Read;
                let mut bytes = Vec::new();
                if let Some(output) = child.stdout.take() {
                    output
                        .take(8193)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "无法读取系统环境命令结果")?;
                }
                if bytes.len() > 8192 {
                    return Err("系统环境变量内容过长，请一键修复。".into());
                }
                return Ok(bytes);
            }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("系统环境命令超时，请处理系统授权提示后重试。".into());
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("无法读取系统环境命令状态，请检查系统环境后重试。".into());
            }
        }
    }
}
fn read_user_value(name: &str) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = bounded_command(
            Command::new("/bin/launchctl").args(["getenv", name]),
            Duration::from_secs(3),
        )?;
        let value = String::from_utf8(output)
            .map_err(|_| "环境变量内容无效，请一键修复。")?
            .trim()
            .to_owned();
        Ok((!value.is_empty()).then_some(value))
    }
    #[cfg(windows)]
    {
        crate::windows_integration::read_current_user_string_values_checked("Environment")
            .map_err(|_| "无法读取用户环境变量，请检查注册表权限。".to_owned())
            .map(|values| {
                values
                    .into_iter()
                    .find(|(k, _)| k == name)
                    .and_then(|(_, v)| v)
            })
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Ok(std::env::var(name).ok())
    }
}
pub fn user_value(name: &str) -> Option<String> {
    read_user_value(name).ok().flatten()
}
pub fn matches(key: &str, origin: &str) -> bool {
    check_matches(key, origin).unwrap_or(false)
}
pub fn check_matches(key: &str, origin: &str) -> Result<bool, String> {
    for (name, value) in KEY_NAMES
        .iter()
        .map(|name| (*name, key))
        .chain(std::iter::once(("FASTAIAPI_BASE_URL", origin)))
    {
        if read_user_value(name)
            .map_err(|error| {
                format!(
                    "{} 请查看配置图文指引，处理后点击一键修复。",
                    failure_hint(&error)
                )
            })?
            .as_deref()
            != Some(value)
        {
            return Ok(false);
        }
    }
    Ok(true)
}
fn write_user_value(name: &str, value: Option<&str>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/bin/launchctl");
        if let Some(value) = value {
            command.args(["setenv", name, value]);
        } else {
            command.args(["unsetenv", name]);
        }
        bounded_command(&mut command, Duration::from_secs(3)).map(|_| ())
    }
    #[cfg(windows)]
    {
        let result = if let Some(value) = value {
            crate::windows_integration::set_current_user_string_value("Environment", name, value)
        } else {
            crate::windows_integration::delete_current_user_value_checked("Environment", name)
        };
        result.map_err(|_| "用户环境变量写入失败，请检查注册表权限。".into())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (name, value);
        Err("当前系统请手动设置 FASTAIAPI_* 用户环境变量。".into())
    }
}
fn failure_hint(error: &str) -> &'static str {
    // 只映射错误类别，不转发系统错误、命令参数或凭据内容。
    if error.contains("超时") {
        "系统环境命令超时。"
    } else if error.contains("不存在") {
        "系统环境命令不存在。"
    } else if error.contains("权限") || error.contains("拒绝") {
        "系统环境操作被拒绝或权限不足。"
    } else if error.contains("校验") {
        "环境变量写入后校验失败。"
    } else {
        "系统环境变量配置失败。"
    }
}
fn export_with(
    key: &str,
    origin: &str,
    mut read: impl FnMut(&str) -> Result<Option<String>, String>,
    mut write: impl FnMut(&str, Option<&str>) -> Result<(), String>,
) -> Result<(), String> {
    let desired: Vec<_> = KEY_NAMES
        .iter()
        .map(|name| (*name, key))
        .chain(std::iter::once(("FASTAIAPI_BASE_URL", origin)))
        .collect();
    // 全部快照读取成功才写入；失败时连失败的那项也恢复，避免系统已写入但返回错误。
    let previous = desired
        .iter()
        .map(|(name, _)| read(name))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            format!(
                "{} 无法读取原用户环境变量，尚未写入；请查看配置图文指引。",
                failure_hint(&error)
            )
        })?;
    let mut touched = 0;
    let result: Result<(), String> = (|| {
        for (name, value) in &desired {
            touched += 1;
            write(name, Some(value)).map_err(|error| failure_hint(&error).to_owned())?;
        }
        for (name, value) in &desired {
            if read(name)
                .map_err(|error| failure_hint(&error).to_owned())?
                .as_deref()
                != Some(*value)
            {
                return Err("环境变量写入后校验失败。".into());
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        let mut restored = true;
        for index in (0..touched).rev() {
            let (name, _) = desired[index];
            if write(name, previous[index].as_deref()).is_err()
                || read(name).ok() != Some(previous[index].clone())
            {
                restored = false;
            }
        }
        return Err(format!(
            "{} {}",
            failure_hint(&error),
            if restored {
                "已回滚本次修改，请查看配置图文指引。"
            } else {
                "部分旧值无法恢复；请按配置图文指引处理权限并一键修复，修复前不要手动使用 FASTAIAPI_*。"
            }
        ));
    }
    Ok(())
}
fn export(key: &str, origin: &str) -> Result<(), String> {
    export_with(key, origin, read_user_value, write_user_value)
}
fn persistence_warning() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        install_login_restore().err().map(|error| {
            format!("环境变量已生效，但登录恢复配置失败：{error} 下次系统登录后请重新一键修复。")
        })
    }
    #[cfg(windows)]
    {
        crate::windows_integration::broadcast_environment_change()
            .err()
            .map(|_| "用户环境变量已保存，但系统通知失败；请重新登录系统后再启动 Codex。".into())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        None
    }
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
    if crate::fastaiapi_media::native_enabled() {
        return Ok(());
    }
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
    if secret["origin"] != origin {
        return Err("媒体凭据与路线不匹配，请一键修复。".into());
    }
    let result = export(secret["api_key"].as_str().ok_or("媒体 Key 缺失")?, origin);
    write_descriptor_for(
        platform,
        origin,
        result.is_ok(),
        result.as_ref().err().map(String::as_str),
    )?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    fn snapshot() -> HashMap<String, String> {
        HashMap::from([
            ("FASTAIAPI_API_KEY".into(), "old-key".into()),
            ("FASTAIAPI_BASE_URL".into(), "https://old.invalid".into()),
            ("OPENAI_API_KEY".into(), "unrelated".into()),
        ])
    }
    fn set(values: &RefCell<HashMap<String, String>>, name: &str, value: Option<&str>) {
        if let Some(value) = value {
            values.borrow_mut().insert(name.into(), value.into());
        } else {
            values.borrow_mut().remove(name);
        }
    }
    #[test]
    fn transaction_verifies_all_values_and_preserves_other_providers() {
        let values = RefCell::new(snapshot());
        export_with(
            "new-key",
            "https://tumeiapi.com",
            |name| Ok(values.borrow().get(name).cloned()),
            |name, value| {
                set(&values, name, value);
                Ok(())
            },
        )
        .unwrap();
        for name in KEY_NAMES {
            assert_eq!(values.borrow().get(name).unwrap(), "new-key");
        }
        assert_eq!(
            values.borrow()["FASTAIAPI_BASE_URL"],
            "https://tumeiapi.com"
        );
        assert_eq!(values.borrow()["OPENAI_API_KEY"], "unrelated");
    }
    #[test]
    fn denied_snapshot_never_writes() {
        let result = export_with(
            "new-key",
            "https://tumeiapi.com",
            |_| Err("denied".into()),
            |_, _| panic!("must not write without a complete snapshot"),
        );
        assert!(result.unwrap_err().contains("尚未写入"));
    }
    #[test]
    fn partial_write_including_failed_item_is_rolled_back() {
        let original = snapshot();
        let values = RefCell::new(original.clone());
        let result = export_with(
            "new-key",
            "https://tumeiapi.com",
            |name| Ok(values.borrow().get(name).cloned()),
            |name, value| {
                set(&values, name, value);
                if name == KEY_NAMES[1] && value == Some("new-key") {
                    Err("denied".into())
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.unwrap_err().contains("已回滚"));
        assert_eq!(*values.borrow(), original);
    }
    #[test]
    fn silent_write_failure_is_detected_and_rolled_back() {
        let original = snapshot();
        let values = RefCell::new(original.clone());
        let result = export_with(
            "new-key",
            "https://tumeiapi.com",
            |name| Ok(values.borrow().get(name).cloned()),
            |name, value| {
                if name != KEY_NAMES[2] {
                    set(&values, name, value);
                }
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("已回滚"));
        assert_eq!(*values.borrow(), original);
    }
    #[test]
    fn rollback_denied_reports_incomplete_recovery_without_secrets() {
        let values = RefCell::new(snapshot());
        let error = export_with(
            "new-key",
            "https://tumeiapi.com",
            |name| Ok(values.borrow().get(name).cloned()),
            |name, value| {
                if name == KEY_NAMES[1] || value == Some("old-key") {
                    return Err("sensitive-backend-error".into());
                }
                set(&values, name, value);
                Ok(())
            },
        )
        .unwrap_err();
        assert!(error.contains("部分旧值无法恢复"));
        for secret in ["new-key", "old-key", "sensitive-backend-error"] {
            assert!(!error.contains(secret));
        }
    }
    #[test]
    fn descriptor_write_failure_is_reported_and_preserves_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connection.json");
        std::fs::write(&path, "existing").unwrap();
        // 模拟 pending 路径不可写；不触碰用户真实技能目录和凭据。
        std::fs::create_dir(path.with_extension("pending")).unwrap();
        let error =
            write_descriptor_at(&path, Platform::NewApi, "https://tumeiapi.com", false, None)
                .unwrap_err();
        assert!(error.contains("目录写入权限"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), "existing");
    }
    #[test]
    fn media_selections_are_type_checked_scoped_and_preserved_across_routes() {
        let mut value =
            json!({"service":Platform::NewApi.service("media"),"origin":"https://tumeiapi.com"});
        let models = ["gpt-image-2.5", "minimax-h3-f", "gpt-6-sol"];
        assert!(
            select_model_in(
                &mut value,
                Platform::NewApi,
                "https://tumeiapi.com",
                "image",
                "gpt-6-sol",
                &models
            )
            .is_err()
        );
        assert!(
            select_model_in(
                &mut value,
                Platform::NewApi,
                "https://tumeiapi.com",
                "video",
                "minimax-h3-x",
                &models
            )
            .is_err()
        );
        assert!(
            select_model_in(
                &mut value,
                Platform::SubApi,
                "https://fastaiapi.cloud",
                "image",
                "gpt-image-2.5",
                &models
            )
            .is_err()
        );
        select_model_in(
            &mut value,
            Platform::NewApi,
            "https://tumeiapi.com",
            "image",
            "gpt-image-2.5",
            &models,
        )
        .unwrap();
        select_model_in(
            &mut value,
            Platform::NewApi,
            "https://tumeiapi.com",
            "video",
            "minimax-h3-f",
            &models,
        )
        .unwrap();
        assert_eq!(
            model_defaults_from(&value, Platform::NewApi)["video_model"],
            "minimax-h3-f"
        );
        assert_eq!(
            model_defaults_from(&value, Platform::SubApi)["video_model"],
            "minimax-h3"
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connection.json");
        value["pricing_keys"] = json!({"newapi":116});
        std::fs::write(&path, value.to_string()).unwrap();
        write_descriptor_at(
            &path,
            Platform::NewApi,
            "https://newapi.fastaiapi.cloud",
            true,
            None,
        )
        .unwrap();
        let restored: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(
            model_defaults_from(&restored, Platform::NewApi)["image_model"],
            "gpt-image-2.5"
        );
        assert_eq!(restored["pricing_keys"]["newapi"], 116);
        assert!(!valid_model("image", "gpt-image-2;echo-secret"));
    }
    #[cfg(unix)]
    #[test]
    fn system_command_errors_and_timeout_are_bounded_and_sanitized() {
        assert!(
            bounded_command(
                &mut Command::new("/codex-plus-nonexistent-command"),
                Duration::from_millis(50)
            )
            .is_err()
        );
        let start = Instant::now();
        let error = bounded_command(
            Command::new("/bin/sleep").arg("2"),
            Duration::from_millis(50),
        )
        .unwrap_err();
        assert!(error.contains("超时"));
        assert!(start.elapsed() < Duration::from_secs(1));
        let error = bounded_command(
            Command::new("/bin/echo")
                .arg("sensitive-output")
                .arg("ignored"),
            Duration::from_secs(1),
        );
        assert!(error.is_ok());
    }
}
