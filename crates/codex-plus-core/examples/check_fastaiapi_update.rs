//! 只检查官网更新与签名，不下载或执行安装程序。
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let current = std::env::args().nth(1).unwrap_or_else(|| env!("CARGO_PKG_VERSION").into());
    let result = codex_plus_core::update::check_for_update(&current).await?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
