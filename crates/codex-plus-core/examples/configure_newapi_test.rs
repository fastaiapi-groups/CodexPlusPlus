//! 手动集成检查：凭据从标准输入读取，不放在命令行或日志中。
use serde_json::{Value, json};
#[tokio::main]
async fn main() {
    let mut line = String::new();
    std::io::stdin()
        .read_line(&mut line)
        .expect("需要标准输入 JSON");
    let login: Value = serde_json::from_str(&line).expect("需要登录 JSON");
    let result=async {
        codex_plus_core::fastaiapi::account("select_route","",json!({"route":1})).await?;
        let user=codex_plus_core::fastaiapi::account("login","",login).await?;
        println!("{}",json!({"logged_in":true,"balance":user["balance"],"currency":user["currency"],"media_setup":user["media_setup"]}));
        let status=codex_plus_core::fastaiapi::account("media_status","",json!({})).await?;
        println!("{}",serde_json::to_string_pretty(&status).unwrap());
        Ok::<(),String>(())
    }.await;
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
