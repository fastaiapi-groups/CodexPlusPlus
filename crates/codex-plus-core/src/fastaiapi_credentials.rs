//! 用户主动勾选后，单独保存账号密码；退出会话不删除记住的账号。
use serde_json::{Value, json};
const SERVICE: &str = "com.fastaiapi.codexplusplus.remembered-login";

pub fn load() -> Value {
    crate::fastaiapi_secret_store::load(SERVICE)
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_else(|| json!({}))
}

pub fn save(email: &str, password: &str) -> bool {
    let bytes = json!({"email": email, "password": password}).to_string();
    crate::fastaiapi_secret_store::save(SERVICE, bytes.as_bytes())
}

pub fn clear() -> Result<(), String> {
    crate::fastaiapi_secret_store::clear(SERVICE)
}
