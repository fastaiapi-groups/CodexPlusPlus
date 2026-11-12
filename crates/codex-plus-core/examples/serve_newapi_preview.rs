//! 临时网页联调桥：仅监听回环，校验 Origin；凭据从无回显标准输入读取。
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
#[tokio::main]
async fn main() {
    println!("网页接口桥已就绪：http://127.0.0.1:1440；不打开 App，不应用 Codex 配置");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:1440")
        .await
        .unwrap();
    loop {
        let (mut stream, _) = listener.accept().await.unwrap();
        tokio::spawn(async move {
            let result = async {
                let mut bytes = Vec::new();
                let mut buffer = [0u8; 8192];
                let (headers, offset) = loop {
                    let count = stream.read(&mut buffer).await.map_err(|_| "读取失败")?;
                    if count == 0 {
                        return Err("连接关闭".to_string());
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    if bytes.len() > 1_048_576 {
                        return Err("请求过大".into());
                    }
                    if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        break (
                            String::from_utf8_lossy(&bytes[..index]).to_string(),
                            index + 4,
                        );
                    }
                };
                let allowed = headers
                    .lines()
                    .any(|h| h.eq_ignore_ascii_case("origin: http://127.0.0.1:1439"));
                if !allowed {
                    return Err("来源不允许".into());
                }
                if headers.starts_with("OPTIONS ") {
                    return Ok(json!({}));
                }
                if !headers.starts_with("POST /invoke ") {
                    return Err("路由不允许".into());
                }
                let length = headers
                    .lines()
                    .find_map(|h| {
                        let (k, v) = h.split_once(':')?;
                        (k.eq_ignore_ascii_case("content-length"))
                            .then(|| v.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if length > 1_048_576 {
                    return Err("请求过大".into());
                }
                while bytes.len() < offset + length {
                    let count = stream.read(&mut buffer).await.map_err(|_| "读取失败")?;
                    if count == 0 {
                        return Err("连接关闭".into());
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let request: Value = serde_json::from_slice(&bytes[offset..offset + length])
                    .map_err(|_| "请求格式无效")?;
                let args = &request["args"];
                let platform =
                    codex_plus_core::fastaiapi_platform::resolve(args["platform"].as_str())?;
                match request["command"].as_str().unwrap_or("") {
                    "fastaiapi_account" => {
                        let action = args["action"].as_str().unwrap_or("");
                        if matches!(
                            action,
                            "pay"
                                | "duocai_pay"
                                | "redeem"
                                | "recharge_create_order"
                                | "recharge_checkout"
                                | "recharge_recheck"
                        ) {
                            return Err(
                                "网页联调不创建充值订单或兑换额度，请在正式客户端操作。".into()
                            );
                        }
                        if action == "configuration" {
                            return Ok(json!({}));
                        }
                        if action == "apply_model_binding" {
                            return Ok(json!({"preview":true}));
                        }
                        codex_plus_core::fastaiapi_platform::account(
                            platform,
                            action,
                            args["id"].as_str().unwrap_or(""),
                            args.get("body").cloned().unwrap_or(json!({})),
                        )
                        .await
                    }
                    "fastaiapi_models" => Ok(json!(
                        codex_plus_core::fastaiapi_platform::key_and_models(
                            platform,
                            args["keyId"].as_i64().unwrap_or(0)
                        )
                        .await?
                        .1
                    )),
                    "fastaiapi_qr" => Ok(json!(codex_plus_core::fastaiapi::qr_image(
                        args["text"].as_str().unwrap_or("")
                    )?)),
                    "fastaiapi_configure" => Ok(json!({"preview":true})),
                    "open_external_url" => Ok(json!({"preview":true})),
                    _ => Err("网页联调命令未开放".into()),
                }
            }
            .await;
            let value = match result {
                Ok(data) => json!({"ok":true,"data":data}),
                Err(error) => json!({"ok":false,"error":error}),
            };
            let body = value.to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://127.0.0.1:1439\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
        });
    }
}
