//! 平台会话仅存系统凭据库，不保存密码，不向前端返回 token。
const SERVICE: &str = "com.fastaiapi.codexplusplus.session";

pub fn load() -> Option<String> {
    crate::fastaiapi_secret_store::load(SERVICE).and_then(|bytes| String::from_utf8(bytes).ok())
}

pub fn save(token: &str) -> bool {
    crate::fastaiapi_secret_store::save(SERVICE, token.as_bytes())
}

pub fn clear() -> Result<(), String> {
    crate::fastaiapi_secret_store::clear(SERVICE)
}
