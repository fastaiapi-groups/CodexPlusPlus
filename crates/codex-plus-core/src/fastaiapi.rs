//! New API 账户适配。白名单路线共用同一后台会话；完整密钥不经过前端。
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

pub const ORIGINS: [&str; 3] = [
    "http://8.137.194.180:90",
    "https://tumeiapi.com",
    "https://newapi.fastaiapi.cloud",
];
#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct Session {
    #[serde(default)]
    cookie: String,
    #[serde(default)]
    bearer: String,
    #[serde(default)]
    user_id: i64,
}
struct State {
    route: usize,
    session_loaded: bool,
    session: Session,
}
static STATE: OnceLock<tokio::sync::Mutex<State>> = OnceLock::new();
fn route_path() -> std::path::PathBuf {
    crate::paths::default_app_state_dir().join("newapi-route")
}
fn service(_route: usize, kind: &str) -> String {
    format!("com.fastaiapi.codexplusplus.newapi.{kind}")
}
fn load_session(route: usize) -> Session {
    [
        service(route, "session"),
        "com.fastaiapi.codexplusplus.newapi.1.session".into(),
        "com.fastaiapi.codexplusplus.newapi.0.session".into(),
    ]
    .into_iter()
    .find_map(|name| {
        crate::fastaiapi_secret_store::load(&name).and_then(|v| serde_json::from_slice(&v).ok())
    })
    .unwrap_or_default()
}

fn state() -> &'static tokio::sync::Mutex<State> {
    STATE.get_or_init(|| {
        let route = std::fs::read_to_string(route_path())
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|i| *i < ORIGINS.len())
            .unwrap_or(0);
        tokio::sync::Mutex::new(State {
            route,
            session_loaded: false,
            session: Session::default(),
        })
    })
}
pub async fn selected_route() -> usize {
    state().lock().await.route
}
pub fn profile_id(_route: usize, key_id: i64) -> String {
    format!("fastaiapi-newapi-{key_id}")
}
fn business_error(value: &Value) -> String {
    let message = value["message"].as_str().unwrap_or("").to_lowercase();
    if message.contains("username already exists") || message.contains("用户名已存在") {
        "用户名已被使用（自动取邮箱 @ 前缀），请更换邮箱或登录已有账号。".into()
    } else if message.contains("verification code") || message.contains("验证码") {
        "邮箱验证码不正确、已过期或尚未填写，请核对后重试。".into()
    } else if message.contains("email address is already") || message.contains("邮箱已") {
        "该邮箱已被使用，请登录已有账号。".into()
    } else if message.contains("username or password") || message.contains("用户名或密码") {
        "邮箱、用户名或密码不正确，请核对后重试。".into()
    } else {
        "平台未接受该操作，请核对账号、验证码、权限或余额；如需额外验证请前往平台网站。".into()
    }
}

fn payload(value: Value) -> Result<Value, String> {
    if value["success"] == false
        || value.get("code").is_some_and(|v| v.as_i64() != Some(0))
        || (value.get("success").is_none()
            && value
                .get("message")
                .is_some_and(|m| m != "success" && m != ""))
    {
        // 不透传服务端响应，防止错误正文带出密码、Key 或签名链接。
        return Err(business_error(&value));
    }
    Ok(value)
}
pub(crate) fn data(value: Value) -> Value {
    value.get("data").cloned().unwrap_or(value)
}
fn merge_cookies(current: &str, headers: &reqwest::header::HeaderMap) -> String {
    let mut cookies = std::collections::BTreeMap::<String, String>::new();
    for pair in current.split("; ").chain(
        headers
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|s| s.split(';').next()),
    ) {
        if let Some((k, v)) = pair.split_once('=') {
            if !k.is_empty() {
                cookies.insert(k.to_owned(), v.to_owned());
            }
        }
    }
    cookies
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("CodexPlusPlus/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化网络连接".into())
}
pub(crate) async fn send(
    origin: &str,
    session: &mut Session,
    method: &str,
    path: &str,
    body: Value,
    model_key: Option<&str>,
) -> Result<Value, String> {
    let http = if origin.starts_with("http://127.0.0.1:") {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "无法初始化网络连接")?
    } else {
        client()?
    };
    let mut request = http.request(
        method.parse().map_err(|_| "请求方法无效")?,
        format!("{origin}{path}"),
    );
    if let Some(key) = model_key {
        request = request.bearer_auth(key);
    } else {
        request = request
            .header("Origin", origin)
            .header("Referer", format!("{origin}/"));
        if !session.cookie.is_empty() {
            request = request.header("Cookie", &session.cookie);
        }
        if !session.bearer.is_empty() {
            request = request.bearer_auth(&session.bearer);
        }
        if session.user_id > 0 {
            request = request.header("New-Api-User", session.user_id);
        }
    }
    if method == "POST" {
        if path.starts_with("/v1/") {
            request = request.timeout(Duration::from_secs(300));
        }
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "无法连接当前路线，请测试网络或切换路线")?;
    if !response.status().is_success() {
        return Err(format!(
            "当前路线请求失败（HTTP {}）",
            response.status().as_u16()
        ));
    }
    if model_key.is_none() {
        session.cookie = merge_cookies(&session.cookie, response.headers());
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "平台返回格式无效，请检查路线是否指向 new-api")?;
    if path.starts_with("/api/user/duocai/")
        && value["data"]["trade_no"]
            .as_str()
            .is_some_and(|id| valid_trade(id).is_ok())
    {
        return Ok(value);
    }
    payload(value)
}
async fn request(s: &mut State, method: &str, path: &str, body: Value) -> Result<Value, String> {
    let result = send(ORIGINS[s.route], &mut s.session, method, path, body, None).await?;
    if s.session.user_id > 0 {
        let _ = crate::fastaiapi_secret_store::save(
            &service(s.route, "session"),
            &serde_json::to_vec(&s.session).unwrap_or_default(),
        );
    }
    Ok(result)
}
fn signed_payment_url(value: &Value) -> Result<String, String> {
    let mut url = reqwest::Url::parse(value["url"].as_str().ok_or("平台未返回支付链接")?)
        .map_err(|_| "支付链接无效")?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("支付链接无效".into());
    }
    if let Some(params) = value["data"].as_object() {
        for (k, v) in params {
            if let Some(v) = v.as_str() {
                url.query_pairs_mut().append_pair(k, v);
            }
        }
    }
    Ok(url.to_string())
}
fn user_view(raw: &Value, status: &Value) -> Value {
    let unit = status["quota_per_unit"]
        .as_f64()
        .filter(|v| *v > 0.0)
        .unwrap_or(500_000.0);
    let display = status["quota_display_type"].as_str().unwrap_or("USD");
    let (currency, rate) = match display {
        "CNY" => ("CNY", status["usd_exchange_rate"].as_f64().unwrap_or(1.0)),
        "CUSTOM" => (
            status["custom_currency_symbol"].as_str().unwrap_or("额度"),
            status["custom_currency_exchange_rate"]
                .as_f64()
                .unwrap_or(1.0),
        ),
        "TOKENS" => ("tokens", unit),
        _ => ("USD", 1.0),
    };
    json!({"email": raw["email"].as_str().filter(|v| !v.is_empty()).unwrap_or(raw["username"].as_str().unwrap_or("")),
        "username": raw["username"], "balance": raw["quota"].as_f64().unwrap_or(0.0) / unit * rate, "currency": currency})
}
fn group_rows(raw: &Value) -> Vec<Value> {
    raw.as_object()
        .map(|obj| {
            obj.iter()
                .map(|(name, v)| {
                    json!({"id": name, "name": name,
        "description": v["desc"], "rate_multiplier": v["ratio"]})
                })
                .collect()
        })
        .unwrap_or_default()
}
fn key_view(raw: &Value) -> Value {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let active = raw["status"] == 1
        && raw["expired_time"]
            .as_i64()
            .is_none_or(|expiry| expiry < 0 || expiry > now)
        && (raw["unlimited_quota"] == true || raw["remain_quota"].as_i64().unwrap_or(1) > 0);
    json!({"id":raw["id"],"name":raw["name"],"group":raw["group"],"status":if active {"active"}else{"inactive"},
        "expired_time":raw["expired_time"],"unlimited_quota":raw["unlimited_quota"],"remain_quota":raw["remain_quota"]})
}

async fn keys(s: &mut State) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for page in 1..=100 {
        let raw = data(
            request(
                s,
                "GET",
                &format!("/api/token/?p={page}&page_size=100"),
                Value::Null,
            )
            .await?,
        );
        let items = raw["items"]
            .as_array()
            .or_else(|| raw.as_array())
            .ok_or("Key 列表格式无效")?;
        out.extend(items.iter().map(key_view));
        if items.len() < 100 || raw["total"].as_u64().is_some_and(|v| out.len() as u64 >= v) {
            return Ok(out);
        }
    }
    Err("Key 数量过多，请在平台中整理后重试".into())
}
async fn key_secret(s: &mut State, id: i64) -> Result<String, String> {
    if id <= 0 {
        return Err("请选择有效的 API Key".into());
    }
    // 新版 Key 只通过专用接口读取，不向 WebView 透传。
    let raw = data(
        match request(s, "POST", &format!("/api/token/{id}/key"), json!({})).await {
            Ok(value) => value,
            Err(error) if error.contains("HTTP 404") || error.contains("HTTP 405") => {
                request(s, "GET", &format!("/api/token/{id}"), Value::Null).await?
            }
            Err(error) => return Err(error),
        },
    );
    let key = raw["key"]
        .as_str()
        .or_else(|| raw.as_str())
        .filter(|k| !k.is_empty() && !k.contains('*') && !k.contains('•'))
        .ok_or("无法读取 Key，请检查平台版本与账号权限")?;
    Ok(if key.starts_with("sk-") {
        key.to_owned()
    } else {
        format!("sk-{key}")
    })
}
fn valid_trade(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("订单号无效".into());
    }
    Ok(())
}

pub(crate) fn registration_username(email: &str) -> Result<String, String> {
    email
        .split_once('@')
        .filter(|(name, domain)| !name.is_empty() && !domain.is_empty())
        .map(|(name, _)| name.to_owned())
        .ok_or("请输入有效邮箱".into())
}

async fn setup_default_media(s: &mut State) -> Result<Value, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let candidates = keys(s).await?;
    for item in candidates.iter().filter(|k| {
        k["group"] == "default"
            && k["status"] == "active"
            && k["expired_time"]
                .as_i64()
                .is_none_or(|expiry| expiry < 0 || expiry > now)
            && (k["unlimited_quota"] == true || k["remain_quota"].as_i64().unwrap_or(1) > 0)
    }) {
        let id = item["id"].as_i64().ok_or("Key 标识无效")?;
        let key = key_secret(s, id).await?;
        match send(
            ORIGINS[s.route],
            &mut Session::default(),
            "GET",
            "/v1/models",
            Value::Null,
            Some(&key),
        )
        .await
        {
            Ok(_) => {
                let mut result = crate::fastaiapi_media_env::store(s.route, &key)?;
                result["key_id"] = json!(id);
                return Ok(result);
            }
            Err(error) if error.contains("HTTP 401") || error.contains("HTTP 403") => continue,
            Err(error) => return Err(error),
        }
    }
    let groups = data(request(s, "GET", "/api/user/self/groups", Value::Null).await?);
    if groups.get("default").is_none() {
        return Err("账户未开放 default 分组，请联系管理员开放后重试。".into());
    }
    request(s,"POST","/api/token/",json!({"name":"Codex++ FastAiApi","group":"default","expired_time":-1,"unlimited_quota":true,"model_limits_enabled":false})).await?;
    let created = keys(s)
        .await?
        .into_iter()
        .find(|k| {
            k["group"] == "default"
                && k["name"] == "Codex++ FastAiApi"
                && !candidates.iter().any(|old| old["id"] == k["id"])
        })
        .ok_or("Key 已创建，请刷新列表后重试自动配置。")?;
    let id = created["id"].as_i64().ok_or("Key 标识无效")?;
    let key = key_secret(s, id).await?;
    send(
        ORIGINS[s.route],
        &mut Session::default(),
        "GET",
        "/v1/models",
        Value::Null,
        Some(&key),
    )
    .await?;
    let mut result = crate::fastaiapi_media_env::store(s.route, &key)?;
    result["key_id"] = json!(id);
    Ok(result)
}
async fn media_status(s: &mut State) -> Result<Value, String> {
    media_status_for(
        crate::fastaiapi_platform::Platform::NewApi,
        ORIGINS[s.route],
    )
    .await
}
pub(crate) async fn media_status_for(
    platform: crate::fastaiapi_platform::Platform,
    origin: &str,
) -> Result<Value, String> {
    let Some(secret) = crate::fastaiapi_media_env::load_for(platform) else {
        return Ok(
            json!({"state":"missing","message":"尚未配置媒体 Key，可一键配置 default 分组连接。"}),
        );
    };
    if !crate::fastaiapi_media_env::is_active(platform) {
        return Ok(
            json!({"state":"inactive","message":"媒体环境当前使用其他连接，点击一键配置可切换到当前平台。"}),
        );
    }
    let saved = secret["api_key"].as_str().unwrap_or("");
    if !crate::fastaiapi_media_env::matches(saved, origin) {
        return Ok(
            json!({"state":"environment_mismatch","message":"系统环境变量缺失或已变更，请点击一键修复。"}),
        );
    }
    match send(
        origin,
        &mut Session::default(),
        "GET",
        "/v1/models",
        Value::Null,
        Some(saved),
    )
    .await
    {
        Ok(value) => {
            let models = data(value);
            let ids: Vec<&str> = models
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str())
                .collect();
            Ok(
                json!({"state":"ready","message":"系统环境变量与 Key 已连接","models":ids,"default_video_model":"minimax-h3","default_video_available":ids.contains(&"minimax-h3")}),
            )
        }
        Err(error) if error.contains("HTTP 401") || error.contains("HTTP 403") => Ok(
            json!({"state":"invalid","message":"环境变量中的 API Key 已失效或被停用，请点击一键修复。"}),
        ),
        Err(error) => Ok(json!({"state":"network_error","message":error})),
    }
}
async fn media_test(s: &mut State, kind: &str) -> Result<Value, String> {
    media_test_for(
        crate::fastaiapi_platform::Platform::NewApi,
        ORIGINS[s.route],
        kind,
    )
    .await
}
pub(crate) async fn media_test_for(
    platform: crate::fastaiapi_platform::Platform,
    origin: &str,
    kind: &str,
) -> Result<Value, String> {
    if !matches!(kind, "text" | "image") {
        return Err("请选择文本或图片测试".into());
    }
    let secret = crate::fastaiapi_media_env::load_for(platform).ok_or("请先配置媒体 Key")?;
    let saved = secret["api_key"].as_str().ok_or("媒体 Key 缺失")?;
    let key = crate::fastaiapi_media_env::user_value("FASTAIAPI_API_KEY")
        .ok_or("环境变量缺失，请点击一键修复")?;
    if saved != key || !crate::fastaiapi_media_env::matches(&key, origin) {
        return Err("环境变量已变更，请先一键修复，再测试。".into());
    }
    let raw = data(
        send(
            origin,
            &mut Session::default(),
            "GET",
            "/v1/models",
            Value::Null,
            Some(&key),
        )
        .await?,
    );
    let ids: Vec<&str> = raw
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str())
        .collect();
    let model = if kind == "image" {
        ids.iter()
            .copied()
            .find(|id| *id == "gpt-image-2")
            .or_else(|| ids.iter().copied().find(|id| model_kind(id) == "image"))
    } else {
        ids.iter()
            .copied()
            .find(|id| *id == "gpt-6-sol")
            .or_else(|| ids.iter().copied().find(|id| model_kind(id) == "text"))
    }
    .ok_or("当前 Key 没有相应测试模型权限")?;
    let (path, body) = if kind == "image" {
        (
            "/v1/images/generations",
            json!({"model":model,"prompt":"A small blue circle centered on a white background, simple flat icon.","n":1,"size":"1024x1024","response_format":"b64_json"}),
        )
    } else {
        (
            "/v1/chat/completions",
            json!({"model":model,"messages":[{"role":"user","content":"Reply with OK only."}],"max_tokens":32,"stream":false}),
        )
    };
    let value = send(
        origin,
        &mut Session::default(),
        "POST",
        path,
        body,
        Some(&key),
    )
    .await?;
    if kind == "text" {
        if value["choices"][0]["message"]["content"]
            .as_str()
            .is_none_or(|text| text.trim().is_empty())
        {
            return Err("文本测试未返回有效内容".into());
        }
    } else if value["data"].as_array().is_none_or(|items| {
        items.is_empty()
            || !items.iter().any(|item| {
                item["b64_json"].as_str().is_some_and(|v| !v.is_empty())
                    || item["url"].as_str().is_some_and(|v| !v.is_empty())
            })
    }) {
        return Err("图片测试未返回有效图片".into());
    }
    Ok(
        json!({"ok":true,"kind":kind,"model":model,"message":if kind=="text" {"文本生成测试成功"} else {"图片生成测试成功"}}),
    )
}

pub async fn account(action: &str, id: &str, mut body: Value) -> Result<Value, String> {
    if action == "test_routes" {
        let results = futures_util::future::join_all(ORIGINS.iter().enumerate().map(|(id, origin)| async move {
            let start = Instant::now();
            let result = async {
                let response = client()?.get(format!("{origin}/api/status")).timeout(Duration::from_secs(8)).send().await.map_err(|_| "连接超时或网络不可达".to_string())?;
                if !response.status().is_success() { return Err(format!("HTTP {}", response.status().as_u16())); }
                let raw: Value = response.json().await.map_err(|_| "响应格式无效".to_string())?;
                if raw["success"] != true || !raw["data"].is_object() { return Err("未返回 new-api 状态".into()); }
                Ok::<_, String>(())
            }.await;
            json!({"id": id, "latency_ms": if result.is_ok() { Some(start.elapsed().as_millis() as u64) } else { None }, "error": result.err()})
        })).await;
        return Ok(json!(results));
    }
    if action == "settings" {
        let route = selected_route().await;
        let raw = data(
            send(
                ORIGINS[route],
                &mut Session::default(),
                "GET",
                "/api/status",
                Value::Null,
                None,
            )
            .await?,
        );
        return Ok(
            json!({"registration_enabled": raw["register_enabled"] == true && raw["password_register_enabled"] != false,
            "email_verify_enabled": raw["email_verification"], "invitation_code_enabled": true, "turnstile_check": raw["turnstile_check"]}),
        );
    }
    let mut s = state().lock().await;
    if action == "routes" {
        return Ok(
            json!({"selected": s.route, "items": ORIGINS.iter().enumerate().map(|(id, origin)| json!({"id": id, "name": format!("路线{}", id+1), "origin": origin})).collect::<Vec<_>>()}),
        );
    }
    if action == "select_route" {
        let route = body["route"]
            .as_u64()
            .filter(|i| *i < ORIGINS.len() as u64)
            .ok_or("路线无效")? as usize;
        let path = route_path();
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| "无法保存路线")?;
        std::fs::write(&path, route.to_string()).map_err(|_| "无法保存路线")?;
        s.route = route;
        if crate::fastaiapi_media_env::is_active(crate::fastaiapi_platform::Platform::NewApi)
            && s.session.user_id > 0
            && let Some(secret) = crate::fastaiapi_media_env::load(route)
        {
            if let Some(key) = secret["api_key"].as_str() {
                let _ = crate::fastaiapi_media_env::store(route, key);
            }
        }
        return Ok(json!({}));
    }
    let credential_service = service(s.route, "remembered-login");
    if action == "remembered_login" {
        return Ok(crate::fastaiapi_secret_store::load(&credential_service)
            .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
            .unwrap_or(json!({})));
    }
    if action == "forget_login" {
        crate::fastaiapi_secret_store::clear(&credential_service)?;
        return Ok(json!({}));
    }
    if action == "logout" {
        // 同时撤销远端会话；网络不可达时仍清除本机凭据。
        let _ = request(&mut s, "GET", "/api/user/logout", Value::Null).await;
        crate::fastaiapi_secret_store::clear(&service(s.route, "session"))?;
        for old in [
            "com.fastaiapi.codexplusplus.newapi.0.session",
            "com.fastaiapi.codexplusplus.newapi.1.session",
            "com.fastaiapi.codexplusplus.newapi.0.media",
            "com.fastaiapi.codexplusplus.newapi.1.media",
        ] {
            crate::fastaiapi_secret_store::clear(old)?;
        }
        crate::fastaiapi_secret_store::clear(&service(s.route, "media"))?;
        s.session = Session::default();
        return Ok(json!({}));
    }
    let remember = body
        .as_object_mut()
        .and_then(|o| o.remove("remember_password"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if action == "verify" {
        let mut url = reqwest::Url::parse("http://placeholder/api/verification").unwrap();
        url.query_pairs_mut()
            .append_pair("email", body["email"].as_str().unwrap_or(""));
        return Ok(data(
            request(
                &mut s,
                "GET",
                &format!("{}?{}", url.path(), url.query().unwrap()),
                Value::Null,
            )
            .await?,
        ));
    }
    if !matches!(action, "login" | "register") && !s.session_loaded {
        let route = s.route;
        s.session = tokio::time::timeout(
            Duration::from_secs(6),
            tokio::task::spawn_blocking(move || load_session(route)),
        )
        .await
        .map_err(|_| "系统凭据库未响应，请允许访问钥匙串或重新登录")?
        .map_err(|_| "无法恢复登录凭据")?;
        s.session_loaded = true;
    }
    if matches!(action, "login" | "register") {
        let login = body["email"].as_str().unwrap_or("").trim().to_owned();
        let username = if action == "register" {
            registration_username(&login)?
        } else {
            login.clone()
        };
        let password = body["password"].as_str().unwrap_or("").to_owned();
        s.session = Session::default();
        if action == "register" {
            request(
                &mut s,
                "POST",
                "/api/user/register",
                json!({"username": username, "email": login, "password": password,
                "verification_code": body["verify_code"], "aff_code": body["invitation_code"]}),
            )
            .await?;
        }
        let raw = data(request(&mut s, "POST", "/api/user/login", json!({"username": if action == "register" { &username } else { &login }, "password": password})).await?);
        let user = raw.get("user").unwrap_or(&raw);
        let user_id = user["id"]
            .as_i64()
            .filter(|i| *i > 0)
            .ok_or("登录需要额外验证，请在平台网站完成验证")?;
        s.session.user_id = user_id;
        s.session_loaded = true;
        s.session.bearer = raw["access_token"].as_str().unwrap_or("").to_owned();
        if s.session.cookie.is_empty() && s.session.bearer.is_empty() {
            return Err("平台未返回登录会话".into());
        }
        let persistent = crate::fastaiapi_secret_store::save(
            &service(s.route, "session"),
            &serde_json::to_vec(&s.session).unwrap_or_default(),
        );
        let remembered = if remember {
            crate::fastaiapi_secret_store::save(&credential_service, json!({"email": if action == "register" { &username } else { &login }, "password": password}).to_string().as_bytes())
        } else {
            crate::fastaiapi_secret_store::clear(&credential_service)?;
            false
        };
        let current_user = data(request(&mut s, "GET", "/api/user/self", Value::Null).await?);
        let status = data(request(&mut s, "GET", "/api/status", Value::Null).await?);
        let mut view = user_view(&current_user, &status);
        view["session_persistent"] = json!(persistent);
        view["password_remembered"] = json!(remembered);
        view["media_setup"] = match setup_default_media(&mut s).await {
            Ok(value) => value,
            Err(error) => json!({"configured":false,"warning":error}),
        };
        return Ok(view);
    }
    if s.session.user_id <= 0 {
        return Err("请先登录当前路线".into());
    }
    match action {
        "media_setup" => setup_default_media(&mut s).await,
        "media_status" => media_status(&mut s).await,
        "media_manual" => {
            let key = body["api_key"]
                .as_str()
                .unwrap_or("")
                .trim()
                .strip_prefix("Bearer ")
                .unwrap_or(body["api_key"].as_str().unwrap_or("").trim())
                .to_owned();
            if key.is_empty() || key.chars().any(char::is_whitespace) {
                return Err("请输入完整的 API Key".into());
            }
            send(
                ORIGINS[s.route],
                &mut Session::default(),
                "GET",
                "/v1/models",
                Value::Null,
                Some(&key),
            )
            .await?;
            crate::fastaiapi_media_env::store(s.route, &key)
        }
        "media_test" => media_test(&mut s, body["kind"].as_str().unwrap_or("text")).await,
        "me" => {
            // 新版 JWT 到期时通过同源 refresh cookie 恢复；旧版仍走 session cookie。
            let raw = match request(&mut s, "GET", "/api/user/self", Value::Null).await {
                Ok(v) => data(v),
                Err(e) => {
                    if s.session.bearer.is_empty() {
                        return Err(e);
                    }
                    let refreshed =
                        data(request(&mut s, "POST", "/api/user/auth/refresh", json!({})).await?);
                    s.session.bearer = refreshed["access_token"]
                        .as_str()
                        .ok_or("登录已过期，请重新登录")?
                        .into();
                    data(request(&mut s, "GET", "/api/user/self", Value::Null).await?)
                }
            };
            let status = data(request(&mut s, "GET", "/api/status", Value::Null).await?);
            Ok(user_view(&raw, &status))
        }
        "keys" => Ok(json!({"items": keys(&mut s).await?})),
        "groups" => Ok(json!(group_rows(&data(
            request(&mut s, "GET", "/api/user/self/groups", Value::Null).await?
        )))),
        "create_key" => {
            let group = body["group_id"].as_str().ok_or("请选择模型分组")?;
            let groups = data(request(&mut s, "GET", "/api/user/self/groups", Value::Null).await?);
            if groups.get(group).is_none() {
                return Err("该分组不可用".into());
            }
            let before = keys(&mut s).await?;
            let name = body["name"].as_str().unwrap_or("Codex++ FastAiApi");
            request(
                &mut s,
                "POST",
                "/api/token/",
                json!({"name": name, "group": group, "expired_time": -1,
                "unlimited_quota": true, "model_limits_enabled": false}),
            )
            .await?;
            keys(&mut s)
                .await?
                .into_iter()
                .rev()
                .find(|k| k["name"] == name && !before.iter().any(|b| b["id"] == k["id"]))
                .ok_or("Key 已创建，请刷新列表后选择".into())
        }
        "model_pricing" => {
            let id = id
                .parse::<i64>()
                .ok()
                .filter(|i| *i > 0)
                .ok_or("请选择有效的 API Key")?;
            let key = data(request(&mut s, "GET", &format!("/api/token/{id}"), Value::Null).await?);
            let pricing = request(&mut s, "GET", "/api/pricing", Value::Null).await?;
            let status = data(request(&mut s, "GET", "/api/status", Value::Null).await?);
            Ok(model_pricing(
                &pricing,
                key["group"]
                    .as_str()
                    .filter(|v| !v.is_empty())
                    .unwrap_or("default"),
                &status,
            ))
        }
        "topup_info" => Ok(data(
            request(&mut s, "GET", "/api/user/topup/info", Value::Null).await?,
        )),
        "orders" => Ok(data(
            request(
                &mut s,
                "GET",
                "/api/user/topup/self?p=1&page_size=30",
                Value::Null,
            )
            .await?,
        )),
        "quote" => Ok(data(
            request(&mut s, "POST", "/api/user/amount", body).await?,
        )),
        "redeem" => Ok(data(
            request(
                &mut s,
                "POST",
                "/api/user/topup",
                json!({"key": body["key"]}),
            )
            .await?,
        )),
        "pay" => {
            let result = request(&mut s, "POST", "/api/user/pay", body).await?;
            Ok(json!({"url": signed_payment_url(&result)?}))
        }
        "duocai_pay" => {
            // 不确定状态携带原订单，保留 request_id，禁止重建付款。
            let result = send(
                ORIGINS[s.route],
                &mut s.session,
                "POST",
                "/api/user/duocai/pay",
                body,
                None,
            )
            .await?;
            Ok(data(result))
        }
        "duocai_order" | "duocai_check" => {
            valid_trade(id)?;
            let suffix = if action == "duocai_check" {
                "/check"
            } else {
                ""
            };
            Ok(data(
                request(
                    &mut s,
                    if suffix.is_empty() { "GET" } else { "POST" },
                    &format!("/api/user/duocai/orders/{id}{suffix}"),
                    json!({}),
                )
                .await?,
            ))
        }
        "feedback" => {
            // 原反馈是独立服务；不把 new-api 会话发送给旧站点。
            let origin = if std::env::var("FASTAIAPI_FEEDBACK_LOCAL").as_deref() == Ok("1") {
                "http://127.0.0.1:6099"
            } else {
                "https://fastaiapi.cloud"
            };
            Ok(data(
                send(
                    origin,
                    &mut Session::default(),
                    "POST",
                    "/fastaiapi/api/feedback",
                    body,
                    None,
                )
                .await?,
            ))
        }
        _ => Err("不支持的账户操作".into()),
    }
}

fn model_pricing(raw: &Value, group: &str, status: &Value) -> Value {
    let rate = raw["group_ratio"][group].as_f64();
    let currency = if status["quota_display_type"] == "CNY" {
        "CNY"
    } else {
        "USD"
    };
    let fx = if currency == "CNY" {
        status["usd_exchange_rate"].as_f64().unwrap_or(1.0)
    } else {
        1.0
    };
    let models: Vec<Value> = raw["data"].as_array().into_iter().flatten().filter(|m| m["enable_groups"].as_array().is_some_and(|gs| gs.iter().any(|g| g == group || g == "all"))).map(|m| {
        let input = rate.zip(m["model_ratio"].as_f64()).map(|(r,v)| r*v*2.0*fx);
        let token_billed = m["quota_type"] == 0 && m["billing_mode"].as_str().is_none_or(|v| v == "" || v == "token");
        json!({"model": m["model_name"], "time_pricing": false, "tiers": if token_billed {vec![json!({"label": "标准价", "input": input,
            "output": input.zip(m["completion_ratio"].as_f64()).map(|(a,b)| a*b), "cache": input.zip(m["cache_ratio"].as_f64()).map(|(a,b)| a*b)})]} else {vec![]}})
    }).collect();
    json!({"group": group, "rate_multiplier": rate, "currency": currency, "models": models})
}

pub async fn key_and_models(key_id: i64) -> Result<(String, Vec<String>), String> {
    let mut s = state().lock().await;
    if s.session.user_id <= 0 {
        return Err("请先登录当前路线".into());
    }
    let secret = key_secret(&mut s, key_id).await?;
    let response = send(
        ORIGINS[s.route],
        &mut s.session,
        "GET",
        "/v1/models",
        Value::Null,
        Some(&secret),
    )
    .await?;
    let raw = data(response);
    let rows = raw.as_array().ok_or("模型列表格式无效")?;
    let mut ids: Vec<String> = rows
        .iter()
        .filter_map(|m| m["id"].as_str().map(str::to_owned))
        .collect();
    ids.sort();
    ids.dedup();
    Ok((secret, ids))
}
pub fn model_kind(id: &str) -> &'static str {
    let lower = id.to_ascii_lowercase();
    if [
        "video",
        "sora",
        "veo",
        "kling",
        "wan",
        "seedance",
        "minimax-h3",
        "ltx",
        "hunyuan",
        "sd2.5",
    ]
    .iter()
    .any(|v| lower.contains(v))
    {
        "video"
    } else if [
        "image",
        "dall-e",
        "flux",
        "midjourney",
        "stable-diffusion",
        "sdxl",
        "imagen",
        "ideogram",
    ]
    .iter()
    .any(|v| lower.contains(v))
    {
        "image"
    } else if [
        "audio",
        "tts",
        "embedding",
        "realtime",
        "whisper",
        "moderation",
        "auto-review",
        "reserve",
    ]
    .iter()
    .any(|v| lower.contains(v))
    {
        "other"
    } else {
        "text"
    }
}
pub async fn configure_media(key_id: i64) -> Result<Value, String> {
    let mut s = state().lock().await;
    if s.session.user_id <= 0 {
        return Err("请先登录当前路线".into());
    }
    let key = key_secret(&mut s, key_id).await?;
    crate::fastaiapi_media_env::store(s.route, &key)
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
    fn newapi_adapters_keep_groups_keys_and_currency() {
        assert_eq!(
            registration_username("alice+test@example.com").unwrap(),
            "alice+test"
        );
        assert!(registration_username("@example.com").is_err());
        let raw = json!({"id": 2, "username": "tester", "email": "", "quota": 1_000_000});
        let status = json!({"quota_per_unit": 500000, "quota_display_type": "CNY", "usd_exchange_rate": 7.2});
        let user = user_view(&raw, &status);
        assert_eq!(user["balance"], 14.4);
        assert_eq!(user["currency"], "CNY");
        assert_eq!(user["email"], "tester");
        assert_eq!(user_view(&raw, &json!({}))["balance"], 2.0);
        let groups = group_rows(
            &json!({"多模态视频": {"desc": "视频", "ratio": 1}, "default": {"ratio": 0.2}}),
        );
        assert!(groups.iter().any(|g| g["id"] == "多模态视频"));
        let key = key_view(&json!({"id": 4, "status": 1, "key": "secret", "group": "default"}));
        assert_eq!(key["status"], "active");
        assert!(key.get("key").is_none());
        assert_eq!(
            key_view(&json!({"status":1,"expired_time":1,"unlimited_quota":true}))["status"],
            "inactive"
        );
        assert_eq!(
            key_view(&json!({"status":1,"expired_time":-1,"remain_quota":0}))["status"],
            "inactive"
        );
        for route in 1..ORIGINS.len() {
            assert_eq!(profile_id(0, 1), profile_id(route, 1));
            assert_eq!(service(0, "session"), service(route, "session"));
        }
        assert_eq!(service(0, "session"), service(1, "session"));
    }
    #[test]
    fn newapi_prices_apply_group_and_exchange_rate_without_fabricating_prices() {
        let pricing = json!({"group_ratio": {"default": 0.2}, "data": [
            {"model_name": "chat", "enable_groups": ["default"], "quota_type": 0, "model_ratio": 2.5, "completion_ratio": 4, "cache_ratio": 0.1},
            {"model_name": "image", "enable_groups": ["default"], "quota_type": 1, "model_price": 0.2},
            {"model_name": "hidden", "enable_groups": ["other"], "quota_type": 0}]});
        let view = model_pricing(
            &pricing,
            "default",
            &json!({"quota_display_type": "CNY", "usd_exchange_rate": 7}),
        );
        assert_eq!(view["models"].as_array().unwrap().len(), 2);
        assert_eq!(view["models"][0]["tiers"][0]["input"], 7.0);
        assert_eq!(view["models"][0]["tiers"][0]["output"], 28.0);
        assert_eq!(view["models"][1]["tiers"], json!([]));
    }
    #[test]
    fn payment_and_response_validation() {
        assert!(payload(json!({"success": false,"data":{}})).is_err());
        assert!(payload(json!({"message":"failure"})).is_err());
        assert!(payload(json!({"message":"success","data":"10.00"})).is_ok());
        for id in ["../user", "a/b", "a?b", ""] {
            assert!(valid_trade(id).is_err());
        }
        let url = signed_payment_url(
            &json!({"url":"https://pay.example/submit", "data":{"sign":"a+b&c", "money":"10.00"}}),
        )
        .unwrap();
        assert!(url.contains("sign=a%2Bb%26c"));
        assert!(signed_payment_url(&json!({"url":"javascript:bad"})).is_err());
    }
    #[test]
    fn media_models_are_kept_separate_from_codex_default() {
        for id in ["gpt-image-2.5", "dall-e-3", "flux-pro"] {
            assert_eq!(model_kind(id), "image");
        }
        for id in ["grok-imagine-video-1.5", "sora-2", "minimax-h3", "veo3"] {
            assert_eq!(model_kind(id), "video");
        }
        assert_eq!(model_kind("gpt-6-sol"), "text");
    }
    #[tokio::test]
    async fn newapi_transport_keeps_model_key_separate_from_account_cookie() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = vec![0; 8192];
            let n = stream.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).to_lowercase();
            assert!(request.contains("authorization: bearer sk-model"));
            assert!(!request.contains("account-cookie"));
            assert!(!request.contains("new-api-user"));
            let body = r#"{"data":[{"id":"gpt-image-2"}]}"#;
            stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
        });
        let mut session = Session {
            cookie: "session=account-cookie".into(),
            bearer: "account-token".into(),
            user_id: 9,
        };
        let value = send(
            &origin,
            &mut session,
            "GET",
            "/v1/models",
            Value::Null,
            Some("sk-model"),
        )
        .await
        .unwrap();
        assert_eq!(value["data"][0]["id"], "gpt-image-2");
        task.await.unwrap();
    }
}
