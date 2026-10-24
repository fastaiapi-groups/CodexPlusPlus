//! 平台会话仅存系统凭据库，不保存密码，不向前端返回 token。
#[cfg(target_os = "macos")]
const SERVICE: &str = "com.fastaiapi.codexplusplus.session";

#[cfg(target_os = "macos")]
fn account() -> String {
    // 本地开发与正式安装互不覆盖会话。
    std::env::var("CODEX_PLUS_STATE_DIR").unwrap_or_else(|_| "default".into())
}

pub fn load() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::get_generic_password(SERVICE, &account())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub fn save(token: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::set_generic_password(SERVICE, &account(), token.as_bytes())
            .is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = token;
        false
    }
}

pub fn clear() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Err(error) = security_framework::passwords::delete_generic_password(SERVICE, &account())
    {
        if error.code() != -25300 {
            return Err("无法清除系统钥匙串中的会话，请允许钥匙串访问后重试".into());
        }
    }
    Ok(())
}
