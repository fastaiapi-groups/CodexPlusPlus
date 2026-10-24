//! FastAiApi 账户接口。固定来源、禁用重定向，凭据由原生层和系统凭据库管理。
use serde_json::{Value, json};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

static TOKEN: OnceLock<Mutex<String>> = OnceLock::new();
fn token() -> &'static Mutex<String> {
    TOKEN.get_or_init(|| Mutex::new(crate::fastaiapi_session::load().unwrap_or_default()))
}

fn route(action: &str, id: &str) -> Result<(&'static str, String), String> {
    let fixed = match action {
        "settings" => ("GET", "/api/v1/settings/public"),
        "login" => ("POST", "/api/v1/auth/login"),
        "register" => ("POST", "/api/v1/auth/register"),
        "verify" => ("POST", "/api/v1/auth/send-verify-code"),
        "me" => ("GET", "/api/v1/auth/me"),
        "keys" => ("GET", "/api/v1/keys?page=1&page_size=100"),
        "feedback" => ("POST", "/fastaiapi/api/feedback"),
        "groups" => ("GET", "/api/v1/groups/available"),
        "create_key" => ("POST", "/api/v1/keys"),
        "packages" => ("GET", "/fastaiapi/api/recharge/packages"),
        "orders" => ("GET", "/fastaiapi/api/recharge/orders"),
        "create_order" => ("POST", "/fastaiapi/api/recharge/orders"),
        "order" | "checkout" | "recheck" => {
            if id.is_empty()
                || id.len() > 80
                || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
            {
                return Err("订单号无效".into());
            }
            let suffix = match action {
                "checkout" => "/checkout",
                "recheck" => "/recheck",
                _ => "",
            };
            return Ok((
                if action == "order" { "GET" } else { "POST" },
                format!("/fastaiapi/api/recharge/orders/{id}{suffix}"),
            ));
        }
        _ => return Err("不支持的账户操作".into()),
    };
    Ok((fixed.0, fixed.1.to_owned()))
}

// 本地联调仅允许固定回环地址；发布版默认使用平台域名上的独立中转路由。
fn request_url(path: &str, local_feedback: bool) -> String {
    if path == "/fastaiapi/api/feedback" && local_feedback {
        format!("http://127.0.0.1:6099{path}")
    } else {
        format!("https://fastaiapi.cloud{path}")
    }
}

async fn request(method: &str, path: &str, body: &Value, bearer: &str) -> Result<Value, String> {
    let local_feedback = path == "/fastaiapi/api/feedback"
        && std::env::var("FASTAIAPI_FEEDBACK_LOCAL").as_deref() == Ok("1");
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(35))
        .redirect(reqwest::redirect::Policy::none());
    // 回环联调不经过系统代理，避免代理把本地服务请求转发到远端。
    let builder = if local_feedback { builder.no_proxy() } else { builder };
    let client = builder.build()
        .map_err(|_| "无法初始化网络连接")?;
    let mut request = client.request(
        method.parse().map_err(|_| "请求方法无效")?,
        request_url(path, local_feedback),
    );
    if !bearer.is_empty() {
        request = request.bearer_auth(bearer);
    }
    if method == "POST" {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "无法连接 FastAiApi，请检查网络后重试")?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("FastAiApi 请求失败（HTTP {}）", status.as_u16()));
    }
    let data: Value = response.json().await.map_err(|_| "平台返回格式无效")?;
    if data.get("code").is_some_and(|v| v.as_i64() != Some(0)) {
        return Err("平台未接受该操作，请核对输入或在平台网站查看详情".into());
    }
    Ok(data.get("data").cloned().unwrap_or(data))
}

fn take_remember_preference(body: &mut Value) -> bool {
    body.as_object_mut()
        .and_then(|obj| obj.remove("remember_password"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

pub async fn account(action: &str, id: &str, mut body: Value) -> Result<Value, String> {
    if action == "remembered_login" {
        return Ok(crate::fastaiapi_credentials::load());
    }
    if action == "forget_login" {
        crate::fastaiapi_credentials::clear()?;
        return Ok(json!({}));
    }
    // 本地偏好不传给平台；只有认证成功后才保存密码。
    let remember = take_remember_preference(&mut body);
    if action == "logout" {
        crate::fastaiapi_session::clear()?;
        *token().lock().map_err(|_| "账户状态不可用")? = String::new();
        return Ok(json!({}));
    }
    let (method, path) = route(action, id)?;
    let bearer = token().lock().map_err(|_| "账户状态不可用")?.clone();
    let public = matches!(
        action,
        "settings" | "login" | "register" | "verify" | "packages"
    );
    if !public && bearer.is_empty() {
        return Err("请先登录 FastAiApi".into());
    }
    let mut data = request(method, &path, &body, if public { "" } else { &bearer }).await?;
    if matches!(action, "login" | "register") {
        let access = data["access_token"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("登录需要额外验证，请在平台网站完成")?;
        *token().lock().map_err(|_| "账户状态不可用")? = access.to_owned();
        let persistent = crate::fastaiapi_session::save(access);
        let remembered = if remember {
            crate::fastaiapi_credentials::save(
                body["email"].as_str().unwrap_or(""),
                body["password"].as_str().unwrap_or(""),
            )
        } else {
            crate::fastaiapi_credentials::clear()?;
            false
        };
        data = data["user"].clone();
        data["session_persistent"] = json!(persistent);
        data["password_remembered"] = json!(remembered);
    }
    if action == "create_key" {
        if let Some(obj) = data.as_object_mut() {
            obj.remove("key");
        }
    }
    if action == "keys" {
        if let Some(items) = data["items"].as_array_mut() {
            for key in items {
                if let Some(obj) = key.as_object_mut() {
                    obj.remove("key");
                }
            }
        }
    }
    Ok(data)
}

pub async fn key_and_models(key_id: i64) -> Result<(String, Vec<String>), String> {
    if key_id <= 0 {
        return Err("请选择有效的 API Key".into());
    }
    let bearer = token().lock().map_err(|_| "账户状态不可用")?.clone();
    if bearer.is_empty() {
        return Err("请先登录".into());
    }
    let key = request(
        "GET",
        &format!("/api/v1/keys/{key_id}"),
        &Value::Null,
        &bearer,
    )
    .await?;
    let secret = key["key"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("该 Key 无法用于自动配置")?
        .to_owned();
    let models = request("GET", "/v1/models", &Value::Null, &secret).await?;
    let rows = models
        .as_array()
        .or_else(|| models["data"].as_array())
        .ok_or("模型列表格式无效")?;
    let mut ids: Vec<String> = rows
        .iter()
        .filter_map(|m| m["id"].as_str().map(str::to_owned))
        .filter(|id| is_conversation_model(id))
        .collect();
    ids.sort();
    ids.dedup();
    if let Some(index) = ids.iter().position(|id| id == "gpt-5.6-sol") {
        let preferred = ids.remove(index);
        ids.insert(0, preferred);
    }
    Ok((secret, ids))
}

// 媒体和内部审核模型不能写入 Codex 的对话默认模型。
fn is_conversation_model(id: &str) -> bool {
    let lower = id.to_ascii_lowercase();
    !id.trim().is_empty()
        && ![
            "image",
            "video",
            "audio",
            "tts",
            "embedding",
            "realtime",
            "auto-review",
            "reserve",
        ]
        .iter()
        .any(|kind| lower.contains(kind))
}

pub fn qr_image(text: &str) -> Result<String, String> {
    use base64::Engine;
    let code = qrcode::QrCode::new(text).map_err(|_| "支付二维码无效")?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(280, 280)
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remember_password_is_opt_in_and_never_forwarded() {
        for (flag, expected) in [
            (json!(true), true),
            (json!(false), false),
            (json!("true"), false),
        ] {
            let mut body = json!({"email": "test@example.com", "password": "test-only", "remember_password": flag});
            assert_eq!(take_remember_preference(&mut body), expected);
            assert!(body.get("remember_password").is_none());
            assert_eq!(body["password"], "test-only");
        }
        assert!(!take_remember_preference(&mut json!({})));
    }
    #[test]
    fn conversation_models_exclude_media_and_internal_routes() {
        for id in [
            "codex-auto-review",
            "gpt-image-2",
            "gpt-reserve",
            "text-embedding-3",
            "gpt-realtime",
            "",
        ] {
            assert!(!is_conversation_model(id), "{id}");
        }
        for id in ["gpt-5.6-sol", "deepseek-v4-pro", "glm-5", "custom-chat"] {
            assert!(is_conversation_model(id), "{id}");
        }
    }
    #[test]
    fn rejects_arbitrary_routes_and_order_paths() {
        assert_eq!(request_url("/fastaiapi/api/feedback", true), "http://127.0.0.1:6099/fastaiapi/api/feedback");
        assert_eq!(request_url("/api/v1/auth/me", true), "https://fastaiapi.cloud/api/v1/auth/me");
        assert_eq!(request_url("/fastaiapi/api/feedback", false), "https://fastaiapi.cloud/fastaiapi/api/feedback");
        assert_eq!(route("feedback", "").unwrap(), ("POST", "/fastaiapi/api/feedback".into()));
        assert!(route("delete", "").is_err());
        for id in ["../auth", "a/b", "a?token=x", ""] {
            assert!(route("checkout", id).is_err());
        }
        assert_eq!(
            route("checkout", "RA123").unwrap().1,
            "/fastaiapi/api/recharge/orders/RA123/checkout"
        );
    }
    #[test]
    fn payment_qr_is_generated_locally() {
        assert!(
            qr_image("https://example.com/pay")
                .unwrap()
                .starts_with("data:image/svg+xml;base64,")
        );
    }
}
