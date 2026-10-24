//! 用户主动勾选后，单独保存账号密码；退出会话不删除记住的账号。
use serde_json::{Value, json};

#[cfg(target_os = "macos")]
const SERVICE: &str = "com.fastaiapi.codexplusplus.remembered-login";
#[cfg(target_os = "macos")]
fn account() -> String {
    std::env::var("CODEX_PLUS_STATE_DIR").unwrap_or_else(|_| "default".into())
}

pub fn load() -> Value {
    #[cfg(target_os = "macos")]
    if let Ok(bytes) = security_framework::passwords::get_generic_password(SERVICE, &account()) {
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
            return value;
        }
    }
    json!({})
}

pub fn save(email: &str, password: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        let bytes = json!({"email": email, "password": password}).to_string();
        security_framework::passwords::set_generic_password(SERVICE, &account(), bytes.as_bytes())
            .is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (email, password);
        false
    }
}

pub fn clear() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Err(error) = security_framework::passwords::delete_generic_password(SERVICE, &account())
    {
        if error.code() != -25300 {
            return Err("无法清除记住的账号密码，请允许钥匙串访问后重试".into());
        }
    }
    Ok(())
}
