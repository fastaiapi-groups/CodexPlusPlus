//! 只读检查内置路线；不读取或输出账户凭据，不执行注册、充值或生成。
#[tokio::main]
async fn main() {
    match codex_plus_core::fastaiapi::account("test_routes", "", serde_json::json!({})).await {
        Ok(value) => println!("{}", serde_json::to_string_pretty(&value).unwrap()),
        Err(error) => eprintln!("{error}"),
    }
}
