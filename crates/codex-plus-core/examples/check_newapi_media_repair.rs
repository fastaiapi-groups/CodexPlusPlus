//! 仅污染一项测试环境变量，立即使用真实账户的一键修复恢复；不撤销任何用户 Key。
use serde_json::json;
#[tokio::main]
async fn main() {
    let result=async {
        let before=codex_plus_core::fastaiapi::account("keys","",json!({})).await?;
        let output=std::process::Command::new("/bin/launchctl").args(["setenv","FASTAIAPI_API_KEY","codex-test-invalid-key"]).output().map_err(|_| "无法设置测试变量")?;
        if !output.status.success(){return Err("系统拒绝测试变量".to_string());}
        let detected=codex_plus_core::fastaiapi::account("media_status","",json!({})).await;
        // 不论状态检查是否成功，始终先恢复环境，再断言检测结果。
        let repaired=codex_plus_core::fastaiapi::account("media_setup","",json!({})).await?;
        let after=codex_plus_core::fastaiapi::account("keys","",json!({})).await?;
        let ready=codex_plus_core::fastaiapi::account("media_status","",json!({})).await?;
        let detected=detected?;
        assert_eq!(detected["state"],"environment_mismatch");
        assert_eq!(ready["state"],"ready");
        assert_eq!(before["items"].as_array().unwrap().len(),after["items"].as_array().unwrap().len());
        println!("{}",json!({"invalid_environment_detected":true,"repair_succeeded":repaired["environment_configured"],"reused_existing_default_key":true}));
        Ok::<(),String>(())
    }.await;
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
