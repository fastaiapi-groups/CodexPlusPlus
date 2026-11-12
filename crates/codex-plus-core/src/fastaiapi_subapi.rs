//! SubAPI 用户面适配。只使用用户 JWT；不使用管理员接口或向其他平台发送凭据。
use crate::fastaiapi::{Session, data, registration_username};
use crate::fastaiapi_platform::Platform;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};
const PLATFORM: Platform = Platform::SubApi;
const ORIGIN: &str = "https://fastaiapi.cloud";
pub(crate) const LEGACY_SESSION: &str = "com.fastaiapi.codexplusplus.session";
pub(crate) const LEGACY_REMEMBERED_LOGIN: &str = "com.fastaiapi.codexplusplus.remembered-login";
#[derive(Default, Serialize, Deserialize)]
struct LoginSession {
    access_token: String,
    refresh_token: String,
    #[serde(skip)]
    pending: Option<Value>,
}
struct State {
    origin: String,
    loaded: bool,
    session: LoginSession,
}
static STATE: OnceLock<tokio::sync::Mutex<State>> = OnceLock::new();
fn state() -> &'static tokio::sync::Mutex<State> {
    STATE.get_or_init(|| {
        tokio::sync::Mutex::new(State {
            origin: ORIGIN.into(),
            loaded: false,
            session: LoginSession::default(),
        })
    })
}
fn error_message(status: u16, value: &Value) -> String {
    let reason = format!(
        "{} {}",
        value["reason"].as_str().unwrap_or(""),
        value["message"].as_str().unwrap_or("")
    )
    .to_lowercase();
    if reason.contains("captcha") || reason.contains("turnstile") {
        "平台要求人机验证，请前往平台网站完成；不会绕过验证。".into()
    } else if reason.contains("code")
        && (reason.contains("verify") || reason.contains("verification") || reason.contains("totp"))
    {
        "验证码不正确或已过期，请重新核对。".into()
    } else if status == 401 {
        "登录已过期或邮箱、密码不正确，请重新登录 SubAPI。".into()
    } else if status == 403 {
        "SubAPI 拒绝访问，请检查账号、分组权限或前往平台完成额外验证。".into()
    } else if status == 429 {
        "操作过于频繁，请稍后重试。".into()
    } else {
        format!("SubAPI 未接受该操作（HTTP {status}），请检查输入、权限或前往平台网站查看。")
    }
}
async fn send(
    origin: &str,
    token: &str,
    method: &str,
    path: &str,
    body: &Value,
) -> Result<(u16, Value), String> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30));
    if origin.starts_with("http://127.0.0.1:") {
        builder = builder.no_proxy();
    }
    let client = builder.build().map_err(|_| "无法初始化网络连接")?;
    let mut request = client
        .request(
            method.parse().map_err(|_| "请求方法无效")?,
            format!("{origin}{path}"),
        )
        .header("Origin", origin)
        .header("Referer", format!("{origin}/"));
    if !token.is_empty() {
        request = request.bearer_auth(token);
    }
    if matches!(method, "POST" | "PUT") {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "无法连接 SubAPI 当前路线，请检查网络或稍后重试")?;
    let status = response.status().as_u16();
    let raw: Value = response
        .json()
        .await
        .map_err(|_| format!("SubAPI 响应格式无效（HTTP {status}）"))?;
    Ok((status, raw))
}
fn unpack(status: u16, value: Value) -> Result<Value, String> {
    if !(200..300).contains(&status) || value.get("code").is_some_and(|c| c != 0) {
        return Err(error_message(status, &value));
    }
    Ok(data(value))
}
fn persist(s: &State) -> bool {
    if s.origin != ORIGIN {
        return false;
    }
    crate::fastaiapi_secret_store::save(
        &PLATFORM.service("session"),
        &serde_json::to_vec(&s.session).unwrap_or_default(),
    )
}
fn load_session(mut load: impl FnMut(&str) -> Option<Vec<u8>>) -> LoginSession {
    if let Some(current) = load(&PLATFORM.service("session")) {
        return serde_json::from_slice(&current).unwrap_or_default();
    }
    // 1.11.5 只保存 FastAiAPI access token。旧版没有可供迁移的 refresh token。
    let access_token = load(LEGACY_SESSION)
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default();
    LoginSession {
        access_token,
        ..LoginSession::default()
    }
}

async fn ensure_loaded(s: &mut State) -> Result<(), String> {
    if !s.loaded {
        s.session = tokio::time::timeout(
            Duration::from_secs(6),
            tokio::task::spawn_blocking(|| load_session(crate::fastaiapi_secret_store::load)),
        )
        .await
        .map_err(|_| "系统凭据库未响应，请允许钥匙串访问或重新登录")?
        .map_err(|_| "无法恢复 SubAPI 登录")?;
        s.loaded = true;
    }
    Ok(())
}
async fn request(s: &mut State, method: &str, path: &str, body: Value) -> Result<Value, String> {
    let (mut status, mut raw) =
        send(&s.origin, &s.session.access_token, method, path, &body).await?;
    // 只在明确未认证时刷新并重放；不重试网络失败或不确定的写操作。
    if status == 401 && !s.session.refresh_token.is_empty() {
        let (code, value) = send(
            &s.origin,
            "",
            "POST",
            "/api/v1/auth/refresh",
            &json!({"refresh_token":s.session.refresh_token}),
        )
        .await?;
        let refreshed = unpack(code, value)?;
        s.session.access_token = refreshed["access_token"]
            .as_str()
            .filter(|t| !t.is_empty())
            .ok_or("登录已过期，请重新登录 SubAPI")?
            .into();
        if let Some(token) = refreshed["refresh_token"].as_str() {
            s.session.refresh_token = token.into();
        }
        persist(s);
        (status, raw) = send(&s.origin, &s.session.access_token, method, path, &body).await?;
    }
    unpack(status, raw)
}
fn user_view(raw: &Value) -> Value {
    json!({"email":raw["email"],"username":raw["username"],"balance":raw["balance"],"currency":"USD"})
}
fn group_rows(raw: &Value) -> Vec<Value> {
    raw.as_array().into_iter().flatten().filter(|g|g["status"].as_str().is_none_or(|s|s=="active")).map(|g|json!({
        "id":g["id"].as_i64().map(|id|id.to_string()),"name":g["name"],"description":g["description"],
        "platform":g["platform"],"rate_multiplier":g["rate_multiplier"],
        "recommended":g["name"].as_str().is_some_and(|n|n.eq_ignore_ascii_case("default")) || g["platform"] == "openai" || g["platform"] == "composite"
    })).collect()
}
// Go JSON 时间为 RFC3339；统一转成 epoch，避免本地时区影响到期判断。
fn timestamp(value: &str) -> Option<i64> {
    if !value.is_ascii() || value.len() < 20 {
        return None;
    }
    let number = |a: usize, b: usize| value.get(a..b)?.parse::<i64>().ok();
    let (mut year, month, day, hour, minute, second) = (
        number(0, 4)?,
        number(5, 7)?,
        number(8, 10)?,
        number(11, 13)?,
        number(14, 16)?,
        number(17, 19)?,
    );
    if &value[4..5] != "-"
        || &value[7..8] != "-"
        || &value[10..11] != "T"
        || &value[13..14] != ":"
        || &value[16..17] != ":"
        || !(1..=12).contains(&month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    if !(1..=max_day).contains(&day) {
        return None;
    }
    let tail = &value[19..];
    let zone = if let Some(fraction) = tail.strip_prefix('.') {
        let i = fraction.find(|c: char| !c.is_ascii_digit())?;
        if i == 0 {
            return None;
        }
        &fraction[i..]
    } else {
        tail
    };
    let offset = if zone == "Z" {
        0
    } else {
        if zone.len() != 6 || !matches!(&zone[0..1], "+" | "-") || &zone[3..4] != ":" {
            return None;
        }
        let h = zone[1..3].parse::<i64>().ok()?;
        let m = zone[4..6].parse::<i64>().ok()?;
        if h > 23 || m > 59 {
            return None;
        }
        (h * 3600 + m * 60) * if zone.starts_with('-') { -1 } else { 1 }
    };
    year -= i64::from(month <= 2);
    let era = year.div_euclid(400);
    let y = year - era * 400;
    let days = era * 146097 + y * 365 + y / 4 - y / 100
        + (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5
        + day
        - 1
        - 719468;
    Some(days * 86400 + hour * 3600 + minute * 60 + second - offset)
}
fn key_view(raw: &Value) -> Value {
    let quota = raw["quota"].as_f64().unwrap_or(0.0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let active = raw["expires_at"]
        .as_str()
        .is_none_or(|date| timestamp(date).is_some_and(|t| t > now))
        && raw["status"] == "active"
        && (quota <= 0.0 || raw["quota_used"].as_f64().unwrap_or(0.0) < quota);
    json!({"id":raw["id"],"name":raw["name"],"group":raw["group"]["name"],"group_id":raw["group_id"],"status":if active {"active"}else{"inactive"}})
}
async fn keys(s: &mut State) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for page in 1..=100 {
        let raw = request(
            s,
            "GET",
            &format!("/api/v1/keys?page={page}&page_size=100"),
            Value::Null,
        )
        .await?;
        let items = raw["items"].as_array().ok_or("SubAPI Key 列表格式无效")?;
        out.extend(items.iter().map(key_view));
        if items.len() < 100
            || raw["total"]
                .as_u64()
                .is_some_and(|total| out.len() as u64 >= total)
        {
            return Ok(out);
        }
    }
    Err("Key 数量过多，请在平台中整理后重试".into())
}
async fn key_secret(s: &mut State, id: i64) -> Result<String, String> {
    if id <= 0 {
        return Err("请选择有效的 API Key".into());
    }
    let raw = request(s, "GET", &format!("/api/v1/keys/{id}"), Value::Null).await?;
    raw["key"]
        .as_str()
        .filter(|k| !k.is_empty() && !k.contains('*') && !k.contains('•'))
        .map(str::to_owned)
        .ok_or("无法读取 SubAPI Key，请检查权限或手动配置".into())
}
async fn models(origin: &str, key: &str) -> Result<Vec<String>, String> {
    let raw = data(
        crate::fastaiapi::send(
            origin,
            &mut Session::default(),
            "GET",
            "/v1/models",
            Value::Null,
            Some(key),
        )
        .await?,
    );
    let mut ids: Vec<String> = raw
        .as_array()
        .ok_or("模型列表格式无效")?
        .iter()
        .filter_map(|m| m["id"].as_str().map(str::to_owned))
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}
async fn create_key(s: &mut State, body: &Value) -> Result<Value, String> {
    group_key(s, body, false).await
}

async fn group_key(s: &mut State, body: &Value, reuse: bool) -> Result<Value, String> {
    let id = body["group_id"]
        .as_str()
        .and_then(|id| id.parse::<i64>().ok())
        .filter(|id| *id > 0)
        .ok_or("请选择有效分组")?;
    let groups = request(s, "GET", "/api/v1/groups/available", Value::Null).await?;
    if !groups
        .as_array()
        .is_some_and(|gs| gs.iter().any(|g| g["id"] == id))
    {
        return Err("当前账号无权使用该分组".into());
    }
    let name = body["name"].as_str().unwrap_or("Codex++ FastAiApi");
    if reuse
        && let Some(key) = keys(s).await?.into_iter().find(|key| {
            key["status"] == "active"
                && key["group_id"] == id
                && (body["dedicated"] != true || key["name"] == name)
        })
    {
        return Ok(key);
    }
    Ok(key_view(
        &request(
            s,
            "POST",
            "/api/v1/keys",
            json!({"name":name,"group_id":id}),
        )
        .await?,
    ))
}
async fn setup_media(s: &mut State) -> Result<Value, String> {
    let groups = group_rows(&request(s, "GET", "/api/v1/groups/available", Value::Null).await?);
    let preferred = groups
        .iter()
        .find(|g| {
            g["name"]
                .as_str()
                .is_some_and(|n| n.eq_ignore_ascii_case("default"))
        })
        .or_else(|| groups.iter().find(|g| g["recommended"] == true))
        .or_else(|| (groups.len() == 1).then(|| &groups[0]))
        .ok_or("请选择有媒体权限的分组，创建 Key 后手动配置媒体连接。")?;
    let list = keys(s).await?;
    for item in list.iter().filter(|k| {
        k["status"] == "active"
            && k["group_id"].as_i64().map(|id| id.to_string()).as_deref()
                == preferred["id"].as_str()
    }) {
        let key = key_secret(s, item["id"].as_i64().ok_or("Key 标识无效")?).await?;
        match models(&s.origin, &key).await {
            Ok(_) => {
                let mut value = crate::fastaiapi_media_env::store_for(PLATFORM, &s.origin, &key)?;
                crate::fastaiapi_media_env::set_pricing_key_id(PLATFORM, item["id"].as_i64())?;
                value["key_id"] = item["id"].clone();
                return Ok(value);
            }
            Err(error) if error.contains("HTTP 401") || error.contains("HTTP 403") => continue,
            Err(error) => return Err(error),
        }
    }
    let item = create_key(
        s,
        &json!({"group_id":preferred["id"],"name":"Codex++ FastAiApi"}),
    )
    .await?;
    let key = key_secret(s, item["id"].as_i64().ok_or("Key 已创建，请刷新后选择")?).await?;
    models(&s.origin, &key).await?;
    let mut value = crate::fastaiapi_media_env::store_for(PLATFORM, &s.origin, &key)?;
    crate::fastaiapi_media_env::set_pricing_key_id(PLATFORM, item["id"].as_i64())?;
    value["key_id"] = item["id"].clone();
    Ok(value)
}
async fn finish_login(s: &mut State, raw: Value, registration: bool) -> Result<Value, String> {
    s.session.access_token = raw["access_token"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or("登录需要额外验证，请前往平台网站")?
        .into();
    s.session.refresh_token = raw["refresh_token"].as_str().unwrap_or("").into();
    s.loaded = true;
    let pending = s.session.pending.take().unwrap_or(json!({}));
    let persistent = persist(s);
    let remembered = if pending["remember_password"] == true {
        crate::fastaiapi_secret_store::save(
            &PLATFORM.service("remembered-login"),
            json!({"email":pending["email"],"password":pending["password"]})
                .to_string()
                .as_bytes(),
        )
    } else {
        crate::fastaiapi_secret_store::clear(LEGACY_REMEMBERED_LOGIN)?;
        crate::fastaiapi_secret_store::clear(&PLATFORM.service("remembered-login"))?;
        false
    };
    let mut warning = None;
    if registration {
        let username = registration_username(pending["email"].as_str().unwrap_or(""))?;
        if request(s, "PUT", "/api/v1/user", json!({"username":username}))
            .await
            .is_err()
        {
            warning = Some("注册成功，用户名自动设置未完成，可在平台资料页修改。");
        }
    }
    let mut view = user_view(&request(s, "GET", "/api/v1/auth/me", Value::Null).await?);
    view["session_persistent"] = json!(persistent);
    view["password_remembered"] = json!(remembered);
    view["warning"] = json!(warning);

    Ok(view)
}
fn order_view(raw: &Value) -> Value {
    json!({"id":raw["id"],"out_trade_no":raw["out_trade_no"],"amount":raw["amount"],"pay_amount":raw["pay_amount"],"currency":raw["currency"],"status":raw["status"],"order_type":raw["order_type"]})
}
fn valid_order(id: &str) -> Result<i64, String> {
    id.parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or("订单号无效".into())
}

fn recharge_route(action: &str, id: &str) -> Result<(&'static str, String), String> {
    const BASE: &str = "/hub/home/services/api/recharge";
    let (method, path) = match action {
        "recharge_packages" => ("GET", format!("{BASE}/packages")),
        "recharge_channels" => ("GET", format!("{BASE}/channel-status")),
        "recharge_orders" => ("GET", format!("{BASE}/orders")),
        "recharge_create_order" => ("POST", format!("{BASE}/orders")),
        "recharge_order" | "recharge_checkout" | "recharge_recheck" => {
            if id.is_empty()
                || id.len() > 80
                || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
            {
                return Err("订单号无效".into());
            }
            match action {
                "recharge_checkout" => ("POST", format!("{BASE}/orders/{id}/checkout")),
                "recharge_recheck" => ("POST", format!("{BASE}/orders/{id}/recheck")),
                _ => ("GET", format!("{BASE}/orders/{id}")),
            }
        }
        _ => return Err("不支持的充值操作".into()),
    };
    Ok((method, path))
}

pub async fn account(action: &str, id: &str, body: Value) -> Result<Value, String> {
    if action == "settings" || action == "test_routes" {
        let start = Instant::now();
        let result = async {
            let (status, raw) =
                send(ORIGIN, "", "GET", "/api/v1/settings/public", &Value::Null).await?;
            unpack(status, raw)
        }
        .await;
        if action == "test_routes" {
            return Ok(
                json!([{"id":0,"latency_ms":if result.is_ok(){Some(start.elapsed().as_millis() as u64)}else{None},"error":result.err()}]),
            );
        }
        let raw = result?;
        return Ok(
            json!({"registration_enabled":raw["registration_enabled"],"email_verify_enabled":raw["email_verify_enabled"],"invitation_code_enabled":raw["invitation_code_enabled"],
            "captcha_required":raw["turnstile_enabled"]==true || raw["captcha_enabled"]==true || raw["tencent_captcha_enabled"]==true || raw["aliyun_captcha_enabled"]==true}),
        );
    }
    if action == "select_route" {
        return if body["route"] == 0 {
            Ok(json!({}))
        } else {
            Err("路线无效".into())
        };
    }
    let mut s = state().lock().await;
    match action {
        "remembered_login" => {
            drop(s);
            let current = crate::fastaiapi_secret_store::load_with_timeout(
                PLATFORM.service("remembered-login"),
            )
            .await?;
            let remembered = match current {
                Some(value) => Some(value),
                None => {
                    crate::fastaiapi_secret_store::load_with_timeout(LEGACY_REMEMBERED_LOGIN.into())
                        .await?
                }
            };
            return Ok(remembered
                .and_then(|v| serde_json::from_slice::<Value>(&v).ok())
                .unwrap_or(json!({})));
        }
        "forget_login" => {
            crate::fastaiapi_secret_store::clear(LEGACY_REMEMBERED_LOGIN)?;
            crate::fastaiapi_secret_store::clear(&PLATFORM.service("remembered-login"))?;
            return Ok(json!({}));
        }
        "verify" => {
            let (status, raw) = send(
                &s.origin,
                "",
                "POST",
                "/api/v1/auth/send-verify-code",
                &json!({"email":body["email"]}),
            )
            .await?;
            unpack(status, raw)?;
            return Ok(json!({}));
        }
        "login" | "register" => {
            let email = body["email"].as_str().unwrap_or("").trim();
            registration_username(email)?;
            s.session = LoginSession::default();
            s.loaded = true;
            let login_body = json!({"email":email,"password":body["password"],"verify_code":body["verify_code"],"invitation_code":body["invitation_code"]});
            let path = if action == "register" {
                "/api/v1/auth/register"
            } else {
                "/api/v1/auth/login"
            };
            let (status, raw) = send(&s.origin, "", "POST", path, &login_body).await?;
            let raw = unpack(status, raw)?;
            s.session.pending = Some(body);
            if raw["requires_2fa"] == true {
                s.session.pending.as_mut().unwrap()["temp_token"] = raw["temp_token"].clone();
                return Ok(json!({"requires_2fa":true}));
            }
            return finish_login(&mut s, raw, action == "register").await;
        }
        "login_2fa" => {
            let token = s
                .session
                .pending
                .as_ref()
                .and_then(|p| p["temp_token"].as_str())
                .ok_or("验证已过期，请重新登录")?;
            let (status, raw) = send(
                &s.origin,
                "",
                "POST",
                "/api/v1/auth/login/2fa",
                &json!({"temp_token":token,"totp_code":body["totp_code"]}),
            )
            .await?;
            return finish_login(&mut s, unpack(status, raw)?, false).await;
        }
        _ => {}
    }
    ensure_loaded(&mut s).await?;
    if action == "logout" {
        let _ = send(
            &s.origin,
            "",
            "POST",
            "/api/v1/auth/logout",
            &json!({"refresh_token":s.session.refresh_token}),
        )
        .await;
        crate::fastaiapi_secret_store::clear(LEGACY_SESSION)?;
        crate::fastaiapi_secret_store::clear(&PLATFORM.service("session"))?;
        crate::fastaiapi_secret_store::clear(&PLATFORM.service("media"))?;
        s.session = LoginSession::default();
        let warning = crate::fastaiapi_media_env::clear_group_credentials(PLATFORM).err();
        return Ok(json!({"warning":warning}));
    }
    if s.session.access_token.is_empty() {
        return Err("请先登录 SubAPI".into());
    }
    match action {
        "me" => Ok(user_view(
            &request(&mut s, "GET", "/api/v1/auth/me", Value::Null).await?,
        )),
        "keys" => Ok(json!({"items":keys(&mut s).await?})),
        "groups" => Ok(json!(group_rows(
            &request(&mut s, "GET", "/api/v1/groups/available", Value::Null).await?
        ))),
        "create_key" => create_key(&mut s, &body).await,
        "ensure_group_key" => group_key(&mut s, &body, true).await,
        "subscriptions" => request(&mut s, "GET", "/api/v1/subscriptions", Value::Null).await,
        "recharge_packages"
        | "recharge_channels"
        | "recharge_orders"
        | "recharge_create_order"
        | "recharge_order"
        | "recharge_checkout"
        | "recharge_recheck" => {
            let (method, path) = recharge_route(action, id)?;
            request(&mut s, method, &path, body).await
        }
        "checkout_info" => {
            request(&mut s, "GET", "/api/v1/payment/checkout-info", Value::Null).await
        }
        "orders" => {
            let raw = request(
                &mut s,
                "GET",
                "/api/v1/payment/orders/my?page=1&page_size=30",
                Value::Null,
            )
            .await?;
            Ok(
                json!({"items":raw["items"].as_array().into_iter().flatten().map(order_view).collect::<Vec<_>>()}),
            )
        }
        "order" => {
            let id = valid_order(id)?;
            Ok(order_view(
                &request(
                    &mut s,
                    "GET",
                    &format!("/api/v1/payment/orders/{id}"),
                    Value::Null,
                )
                .await?,
            ))
        }
        "pay" => {
            let amount = body["amount"]
                .as_f64()
                .filter(|v| v.is_finite() && *v > 0.0)
                .ok_or("充值金额无效")?;
            let result=request(&mut s,"POST","/api/v1/payment/orders",json!({"amount":amount,"payment_type":body["payment_type"],"order_type":body["order_type"].as_str().unwrap_or("balance"),"plan_id":body["plan_id"],"is_mobile":false,"payment_source":"hosted_redirect","return_url":format!("{ORIGIN}/payment/result")})).await?;
            Ok(
                json!({"order_id":result["order_id"],"pay_url":result["pay_url"],"qr_code":result["qr_code"],"pay_amount":result["pay_amount"],"currency":result["currency"],"result_type":result["result_type"]}),
            )
        }
        "redeem" => {
            request(
                &mut s,
                "POST",
                "/api/v1/redeem",
                json!({"code":body["key"]}),
            )
            .await?;
            Ok(json!({}))
        }
        "group_model_catalogs" => {
            let groups =
                group_rows(&request(&mut s, "GET", "/api/v1/groups/available", Value::Null).await?);
            let plaza = request(&mut s, "GET", "/api/v1/model-plaza", Value::Null)
                .await
                .unwrap_or_default();
            let catalogs = groups
                .iter()
                .filter_map(|group| {
                    let id = group["id"].as_str()?;
                    let catalog = pricing_view(&plaza, &json!(id.parse::<i64>().ok()?));
                    catalog["group"]
                        .is_string()
                        .then(|| (id.to_owned(), catalog))
                })
                .collect::<serde_json::Map<String, Value>>();
            Ok(json!({"groups":groups,"catalogs":catalogs}))
        }
        "group_model_pricing" => {
            let group_id = body["group_id"]
                .as_str()
                .and_then(|id| id.parse::<i64>().ok())
                .filter(|id| *id > 0)
                .ok_or("请选择有效分组")?;
            let groups = request(&mut s, "GET", "/api/v1/groups/available", Value::Null).await?;
            if !group_rows(&groups)
                .iter()
                .any(|group| group["id"] == body["group_id"])
            {
                return Err("当前账号无权使用该分组".into());
            }
            let plaza = request(&mut s, "GET", "/api/v1/model-plaza", Value::Null).await?;
            Ok(pricing_view(&plaza, &json!(group_id)))
        }
        "model_pricing" | "media_pricing" => {
            let key_id = if action == "media_pricing" {
                let key_id = crate::fastaiapi_media_env::pricing_key_id(PLATFORM)?;
                let actual = key_secret(&mut s, key_id).await?;
                let saved =
                    crate::fastaiapi_media_env::load_for(PLATFORM).ok_or("请先配置媒体 Key")?;
                if saved["api_key"] != actual {
                    return Err("媒体 Key 已变更，请一键修复后查看价格".into());
                }
                key_id
            } else {
                valid_order(id)?
            };
            let key = request(
                &mut s,
                "GET",
                &format!("/api/v1/keys/{key_id}"),
                Value::Null,
            )
            .await?;
            let plaza = request(&mut s, "GET", "/api/v1/model-plaza", Value::Null).await?;
            Ok(pricing_view(&plaza, &key["group_id"]))
        }
        "media_setup" => setup_media(&mut s).await,
        "media_status" => crate::fastaiapi::media_status_for(PLATFORM, &s.origin).await,
        "media_select" => {
            if let Some(id) = body["key_id"].as_i64() {
                let key =
                    request(&mut s, "GET", &format!("/api/v1/keys/{id}"), Value::Null).await?;
                if key["group_id"].as_i64().map(|id| id.to_string()).as_deref()
                    != body["group_id"].as_str()
                {
                    return Err("Key 所属分组已变更，请刷新后重试".into());
                }
                let secret = key_secret(&mut s, id).await?;
                let ids = models(&s.origin, &secret).await?;
                crate::fastaiapi_media_env::select_group_model(
                    PLATFORM, &s.origin, &body, &secret, &ids,
                )
            } else {
                crate::fastaiapi::select_media_model(PLATFORM, &s.origin, &body).await
            }
        }
        "media_test" => crate::fastaiapi::media_test_for(PLATFORM, &s.origin, &body).await,
        "media_manual" => {
            let key = body["api_key"]
                .as_str()
                .unwrap_or("")
                .trim()
                .trim_start_matches("Bearer ");
            if key.is_empty() || key.chars().any(char::is_whitespace) {
                return Err("请输入完整的 API Key".into());
            }
            models(&s.origin, key).await?;
            crate::fastaiapi_media_env::store_for(PLATFORM, &s.origin, key)
        }
        _ => Err("SubAPI 不支持该账户操作".into()),
    }
}
fn pricing_view(plaza: &Value, group_id: &Value) -> Value {
    let group = plaza["groups"]
        .as_array()
        .and_then(|gs| gs.iter().find(|g| g["id"] == *group_id));
    let Some(g) = group else {
        return json!({"models":[],"currency":"USD"});
    };
    let rate = g["user_rate_multiplier"]
        .as_f64()
        .or_else(|| g["rate_multiplier"].as_f64())
        .unwrap_or(1.0);
    let models:Vec<Value>=g["models"].as_array().into_iter().flatten().map(|m|{
        let p=&m["pricing"];
        let tier=|label:Value,p:&Value| json!({"label":label,"input":p["input_price"].as_f64().map(|v|v*rate*1_000_000.0),"output":p["output_price"].as_f64().map(|v|v*rate*1_000_000.0),"cache":p["cache_read_price"].as_f64().map(|v|v*rate*1_000_000.0)});
        let tiers=if p["billing_mode"]=="token" {if g["long_context_pricing_enabled"]==true && p["intervals"].as_array().is_some_and(|a|!a.is_empty()) {p["intervals"].as_array().unwrap().iter().map(|i|tier(i["tier_label"].as_str().map(|s|json!(s)).unwrap_or(json!("阶梯价")),i)).collect::<Vec<_>>()}else{vec![tier(json!("标准价"),p)]}}else{vec![]};
        let mode = p["billing_mode"].as_str().unwrap_or("");
        let media_rate = match mode {
            "image" if g["image_rate_independent"] == true => g["image_rate_multiplier"].as_f64().unwrap_or(1.0),
            _ => rate,
        };
        let request_price = |value: &Value| value.as_f64().filter(|price| price.is_finite() && *price >= 0.0).map(|price| price * media_rate);
        let fixed = matches!(mode, "image" | "per_request");
        let unit_tiers: Vec<Value> = p["intervals"].as_array().into_iter().flatten()
            .filter_map(|interval| Some(json!({"label":interval["tier_label"], "price":request_price(&interval["per_request_price"])?})))
            .collect();
        let unit_price = (fixed && unit_tiers.is_empty()).then(|| request_price(&p["per_request_price"])).flatten();
        json!({"model":m["name"],"description":m["description"],"vendor_icon":m["platform"],
            "time_pricing":m.get("time_pricing").is_some_and(|v|v.is_object()),"tiers":tiers,
            "unit_price":unit_price,"unit_tiers":if fixed {unit_tiers} else {vec![]},
            "billing_unit":if mode == "image" {"image"} else if fixed {"call"} else {"token"}})
    }).collect();
    json!({"group":g["name"],"rate_multiplier":rate,"currency":"USD","models":models})
}
pub async fn key_and_models(id: i64) -> Result<(String, Vec<String>), String> {
    let mut s = state().lock().await;
    ensure_loaded(&mut s).await?;
    if s.session.access_token.is_empty() {
        return Err("请先登录 SubAPI".into());
    }
    let key = key_secret(&mut s, id).await?;
    let ids = models(&s.origin, &key).await?;
    Ok((key, ids))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_json, header, method, path},
    };

    #[tokio::test]
    async fn legacy_fastai_access_token_authenticates_the_new_subapi_panel() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/auth/me"))
            .and(header("Authorization", "Bearer legacy-test-token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"code":0,"data":{"email":"upgrade-test@example.invalid","balance":12}}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        let session =
            load_session(|name| (name == LEGACY_SESSION).then(|| b"legacy-test-token".to_vec()));
        let mut state = State {
            origin: server.uri(),
            loaded: true,
            session,
        };
        let account = request(&mut state, "GET", "/api/v1/auth/me", Value::Null)
            .await
            .unwrap();
        assert_eq!(user_view(&account)["email"], "upgrade-test@example.invalid");
        assert!(state.session.refresh_token.is_empty());
    }

    #[test]
    fn current_session_entry_takes_priority_over_the_legacy_token() {
        let session = load_session(|name| {
            assert_eq!(name, PLATFORM.service("session"));
            Some(serde_json::to_vec(&LoginSession::default()).unwrap())
        });
        assert!(session.access_token.is_empty());
    }

    #[test]
    fn fastai_recharge_uses_the_website_service_for_new_and_existing_orders() {
        assert_eq!(
            recharge_route("recharge_packages", "").unwrap(),
            ("GET", "/hub/home/services/api/recharge/packages".into())
        );
        assert_eq!(
            recharge_route("recharge_channels", "").unwrap(),
            (
                "GET",
                "/hub/home/services/api/recharge/channel-status".into()
            )
        );
        for (action, verb, suffix) in [
            ("recharge_orders", "GET", ""),
            ("recharge_create_order", "POST", ""),
            ("recharge_order", "GET", "/RA123"),
            ("recharge_checkout", "POST", "/RA123/checkout"),
            ("recharge_recheck", "POST", "/RA123/recheck"),
        ] {
            assert_eq!(
                recharge_route(action, "RA123").unwrap(),
                (
                    verb,
                    format!("/hub/home/services/api/recharge/orders{suffix}")
                )
            );
        }
        assert!(recharge_route("recharge_checkout", "../RA123").is_err());
    }

    #[test]
    fn image_plaza_uses_group_model_price_and_independent_image_rate() {
        let plaza = json!({"groups":[
            {"id":2,"name":"default","rate_multiplier":1,"models":[
                {"name":"gpt-image-2","platform":"openai","pricing":{"billing_mode":"image","per_request_price":0.02}}
            ]},
            {"id":3,"name":"studio","user_rate_multiplier":3,"image_rate_independent":true,"image_rate_multiplier":2,"models":[
                {"name":"gpt-image-2","platform":"openai","pricing":{"billing_mode":"image","per_request_price":0.2,"intervals":[
                    {"tier_label":"1K","per_request_price":0},{"tier_label":"4K","per_request_price":0.4}
                ]}}
            ]}
        ]});
        assert_eq!(
            pricing_view(&plaza, &json!(2))["models"][0]["unit_price"],
            0.02
        );
        let studio = pricing_view(&plaza, &json!(3));
        assert!(studio["models"][0]["unit_price"].is_null());
        assert_eq!(
            studio["models"][0]["unit_tiers"],
            json!([{"label":"1K","price":0.0},{"label":"4K","price":0.8}])
        );
        assert_eq!(studio["models"][0]["billing_unit"], "image");
    }

    fn test_state(server: &MockServer) -> State {
        State {
            origin: server.uri(),
            loaded: true,
            session: LoginSession {
                access_token: "test-user-token".into(),
                refresh_token: "test-refresh-token".into(),
                pending: None,
            },
        }
    }
    #[test]
    fn key_expiry_respects_utc_offsets() {
        assert_eq!(timestamp("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(timestamp("1970-01-01T08:00:00.123+08:00"), Some(0));
        assert_eq!(timestamp("2000-02-29T00:00:00Z"), Some(951782400));
        assert_eq!(timestamp("2001-02-29T00:00:00Z"), None);
        assert_eq!(
            key_view(&json!({"status":"active","expires_at":"2000-01-01T00:00:00Z"}))["status"],
            "inactive"
        );
        assert_eq!(
            key_view(&json!({"status":"active","expires_at":"2999-01-01T00:00:00Z"}))["status"],
            "active"
        );
    }
    #[test]
    fn views_keep_subapi_units_and_never_return_credentials() {
        assert_eq!(
            user_view(&json!({"email":"user@example.test","balance":12.5}))["balance"],
            12.5
        );
        let key = key_view(
            &json!({"id":7,"key":"sk-private","name":"test","status":"active","group_id":2,"group":{"name":"default"},"quota":10,"quota_used":10}),
        );
        assert_eq!(key["status"], "inactive");
        assert!(key.get("key").is_none());
        assert_eq!(key["group"], "default");
        let groups = group_rows(
            &json!([{"id":2,"name":"My group","platform":"openai","status":"active","rate_multiplier":0.5}]),
        );
        assert_eq!(groups[0]["id"], "2");
        assert_eq!(groups[0]["recommended"], true);
        let order = order_view(
            &json!({"id":1,"pay_amount":20,"currency":"NZD","resume_token":"private","client_secret":"private"}),
        );
        assert_eq!(order["currency"], "NZD");
        assert!(!order.to_string().contains("private"));
    }
    #[test]
    fn pricing_uses_user_rate_and_per_million_units() {
        let value = pricing_view(
            &json!({"groups":[{"id":2,"name":"default","rate_multiplier":2,"user_rate_multiplier":0.5,"models":[{"name":"text-test","pricing":{"billing_mode":"token","input_price":0.000002,"output_price":0.000008,"cache_read_price":0.000001}}]}]}),
            &json!(2),
        );
        assert_eq!(value["models"][0]["tiers"][0]["input"], 1.0);
        assert_eq!(value["models"][0]["tiers"][0]["output"], 4.0);
        assert!(
            pricing_view(&json!({"groups":[]}), &json!(2))["models"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn errors_never_echo_secrets() {
        for status in [400, 401, 403, 429, 500] {
            let error = unpack(
                status,
                json!({"code":status,"message":"sk-private-password"}),
            )
            .unwrap_err();
            assert!(!error.contains("sk-private"));
        }
        assert!(valid_order("1/../../keys").is_err());
    }
    #[tokio::test]
    async fn expired_access_token_refreshes_once_then_replays_with_new_token() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/auth/me"))
            .and(header("authorization", "Bearer test-user-token"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({"code":401})))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST")).and(path("/api/v1/auth/refresh")).and(body_json(json!({"refresh_token":"test-refresh-token"})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"code":0,"data":{"access_token":"renewed-test-token","refresh_token":"renewed-refresh"}}))).expect(1).mount(&server).await;
        Mock::given(method("GET"))
            .and(path("/api/v1/auth/me"))
            .and(header("authorization", "Bearer renewed-test-token"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(
                    json!({"code":0,"data":{"email":"user@example.test","balance":5}}),
                ),
            )
            .expect(1)
            .mount(&server)
            .await;
        let mut s = test_state(&server);
        let user = request(&mut s, "GET", "/api/v1/auth/me", Value::Null)
            .await
            .unwrap();
        assert_eq!(user["balance"], 5);
        assert_eq!(s.session.refresh_token, "renewed-refresh");
        for request in server.received_requests().await.unwrap() {
            assert!(!request.headers.contains_key("New-Api-User"));
            assert!(!request.headers.contains_key("Cookie"));
        }
    }
    #[tokio::test]
    async fn key_creation_checks_user_group_and_strips_returned_secret() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/groups/available"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"code":0,"data":[{"id":2,"name":"default"}]})),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST")).and(path("/api/v1/keys")).and(body_json(json!({"name":"Dedicated","group_id":2})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"code":0,"data":{"id":7,"key":"sk-private","name":"Dedicated","status":"active","group_id":2}}))).expect(1).mount(&server).await;
        let mut s = test_state(&server);
        assert!(
            create_key(&mut s, &json!({"group_id":"999","name":"Denied"}))
                .await
                .is_err()
        );
        let value = create_key(&mut s, &json!({"group_id":"2","name":"Dedicated"}))
            .await
            .unwrap();
        assert_eq!(value["id"], 7);
        assert!(value.get("key").is_none());
    }
    #[tokio::test]
    async fn group_key_is_created_once_and_reused_across_picker_types() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/groups/available"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"code":0,"data":[{"id":2,"name":"default"}]})),
            )
            .mount(&server)
            .await;
        let listed_key = json!({"id":7,"key":"fixture-secret","name":"Dedicated","status":"active","group_id":2});
        let created = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let for_list = created.clone();
        let key_for_list = listed_key.clone();
        Mock::given(method("GET"))
            .and(path("/api/v1/keys"))
            .respond_with(move |_: &wiremock::Request| {
                let items = if for_list.load(std::sync::atomic::Ordering::SeqCst) {
                    vec![key_for_list.clone()]
                } else {
                    vec![
                        json!({"id":1,"status":"inactive","group_id":2}),
                        json!({"id":3,"status":"active","group_id":3}),
                    ]
                };
                ResponseTemplate::new(200).set_body_json(json!({"code":0,"data":{"items":items}}))
            })
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/v1/keys"))
            .respond_with(move |_: &wiremock::Request| {
                created.store(true, std::sync::atomic::Ordering::SeqCst);
                ResponseTemplate::new(200).set_body_json(json!({"code":0,"data":listed_key}))
            })
            .expect(1)
            .mount(&server)
            .await;
        let mut s = test_state(&server);
        let image = group_key(&mut s, &json!({"group_id":"2","name":"Dedicated"}), true)
            .await
            .unwrap();
        let text = group_key(&mut s, &json!({"group_id":"2","name":"Text"}), true)
            .await
            .unwrap();
        assert_eq!(image["id"], 7);
        assert_eq!(text, image);
        assert!(text.get("key").is_none());
    }

    #[tokio::test]
    async fn model_discovery_uses_model_key_without_account_jwt() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("authorization", "Bearer sk-model-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"}]}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        assert_eq!(
            models(&server.uri(), "sk-model-test").await.unwrap(),
            vec!["a-model", "z-model"]
        );
        let requests = server.received_requests().await.unwrap();
        assert!(!requests[0].headers.contains_key("Cookie"));
        assert!(!requests[0].headers.contains_key("New-Api-User"));
    }
    #[tokio::test]
    async fn uncertain_payment_submission_is_never_retried() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/v1/payment/orders"))
            .respond_with(
                ResponseTemplate::new(503)
                    .set_body_json(json!({"code":503,"message":"private-response"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let mut s = test_state(&server);
        assert!(
            request(
                &mut s,
                "POST",
                "/api/v1/payment/orders",
                json!({"amount":10})
            )
            .await
            .is_err()
        );
    }
}
