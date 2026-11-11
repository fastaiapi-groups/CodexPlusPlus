use anyhow::{Context, Result, bail, ensure};
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::{fastaiapi_media_env, fastaiapi_platform::Platform, fastaiapi_secret_store, paths};

const MARKER: &str = "fastaiapi-media-native.json";
const MAX_JSON: usize = 48 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Scope {
    descriptor: PathBuf,
    account: String,
}

pub fn native_enabled() -> bool {
    paths::default_app_state_dir().join(MARKER).is_file()
}

pub fn enable_native() -> Result<()> {
    let scope = Scope {
        descriptor: fastaiapi_media_env::descriptor_path(),
        account: fastaiapi_secret_store::account(),
    };
    let path = paths::default_app_state_dir().join(MARKER);
    if path.is_file() && fs::read(&path)? == serde_json::to_vec(&scope)? {
        return Ok(());
    }
    crate::settings::atomic_write(&path, &serde_json::to_vec(&scope)?)
}

pub fn validate_media_origin(platform: Platform, origin: &str) -> Result<()> {
    ensure!(
        platform.origins().contains(&origin),
        "媒体路线不属于当前平台"
    );
    ensure!(
        origin.starts_with("https://"),
        "媒体工具需要 HTTPS。请先选择当前平台的 HTTPS 路线。"
    );
    Ok(())
}

pub(super) struct Connection {
    pub platform: Platform,
    pub origin: String,
    pub key: String,
    pub defaults: Value,
}

impl Connection {
    pub fn fingerprint(&self) -> String {
        format!("{:x}", Sha256::digest(self.key.as_bytes()))
    }
}

pub(super) async fn load(state: &Path, pinned: Option<(Platform, &str)>) -> Result<Connection> {
    let scope: Scope =
        read_json(&state.join(MARKER), 16 * 1024).context("请先在 Codex++ 中连接媒体工具")?;
    let descriptor: Value = read_json(&scope.descriptor, 256 * 1024)
        .context("媒体连接尚未配置，请在 Codex++ 中检查连接")?;
    ensure!(
        descriptor["account"] == scope.account,
        "媒体连接属于另一应用实例"
    );
    let current = Platform::parse(descriptor["platform"].as_str().unwrap_or(""))
        .map_err(anyhow::Error::msg)?;
    ensure!(
        descriptor["service"] == current.service("media"),
        "媒体凭据引用无效"
    );
    let (platform, origin) = match pinned {
        Some((platform, origin)) => (platform, origin.to_owned()),
        None => (
            current,
            descriptor["origin"].as_str().unwrap_or("").to_owned(),
        ),
    };
    validate_media_origin(platform, &origin)?;
    if pinned.is_none() {
        let selected = crate::fastaiapi_platform::selected_in(state);
        let route = if selected == Platform::NewApi {
            crate::fastaiapi::saved_route(state)
        } else {
            0
        };
        ensure!(
            selected == platform && selected.origins()[route] == origin,
            "平台或路线已切换，请在 Codex++ 中连接当前 HTTPS 路线"
        );
    }
    let names = fastaiapi_media_env::credential_services(platform);
    let account = scope.account;
    let secret = tokio::time::timeout(
        Duration::from_secs(8),
        tokio::task::spawn_blocking(move || {
            names.into_iter().find_map(|service| {
                fastaiapi_secret_store::load_in_account(&service, &account)
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            })
        }),
    )
    .await
    .context("系统凭据库未响应，请检查系统授权")??
    .context("媒体 Key 不可读，请在 Codex++ 中配置或检查系统授权")?;
    let saved_origin = secret["origin"].as_str().unwrap_or("");
    ensure!(
        platform.origins().contains(&saved_origin),
        "媒体凭据与平台不匹配"
    );
    if pinned.is_none() {
        ensure!(
            saved_origin == origin,
            "媒体凭据与当前路线不匹配，请重新连接"
        );
    }
    let key = secret["api_key"]
        .as_str()
        .filter(|key| !key.is_empty() && !key.chars().any(char::is_whitespace))
        .context("系统凭据库中的媒体 Key 无效")?;
    Ok(Connection {
        platform,
        origin,
        key: key.to_owned(),
        defaults: descriptor["model_defaults"][platform.id()].clone(),
    })
}

pub(super) fn read_json<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> Result<T> {
    use std::io::Read;
    ensure!(fs::metadata(path)?.is_file(), "配置或回执须为普通文件");
    let file = fs::File::open(path)?;
    ensure!(file.metadata()?.is_file(), "配置或回执须为普通文件");
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "配置或回执超出大小限制");
    serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("配置或回执不是有效 JSON"))
}

pub(super) fn client() -> Result<Client> {
    Ok(Client::builder()
        .connect_timeout(Duration::from_secs(12))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .user_agent("CodexPlusPlus/FastAiApi-Media")
        .build()?)
}

pub(super) async fn request(
    client: &Client,
    connection: &Connection,
    method: Method,
    path: &str,
    body: Option<&Value>,
    intent: Option<&str>,
) -> Result<Value> {
    let timeout = if method == Method::GET { 20 } else { 300 };
    let mut request = client
        .request(method, format!("{}{path}", connection.origin))
        .timeout(Duration::from_secs(timeout))
        .bearer_auth(&connection.key);
    if let Some(body) = body {
        request = request.json(body);
    }
    if let Some(intent) = intent {
        request = request.header("Idempotency-Key", intent);
    }
    let response = request
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("媒体接口网络失败或超时"))?;
    ensure!(
        response.status().is_success(),
        "媒体接口返回 HTTP {}",
        response.status().as_u16()
    );
    let value: Value = serde_json::from_slice(&limited_body(response, MAX_JSON).await?)
        .map_err(|_| anyhow::anyhow!("媒体接口返回无效 JSON"))?;
    ensure!(value.is_object(), "媒体接口返回格式无效");
    Ok(value)
}

pub(super) async fn limited_body(mut response: reqwest::Response, cap: usize) -> Result<Vec<u8>> {
    ensure!(
        response
            .content_length()
            .is_none_or(|size| size <= cap as u64),
        "响应超过大小限制"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("下载中断"))?
    {
        ensure!(chunk.len() <= cap - bytes.len(), "响应超过大小限制");
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) async fn models(client: &Client, connection: &Connection) -> Result<Vec<String>> {
    let value = request(client, connection, Method::GET, "/v1/models", None, None).await?;
    let entries = value["data"].as_array().context("模型目录格式无效")?;
    Ok(entries
        .iter()
        .filter_map(|entry| entry["id"].as_str())
        .filter(|id| super::protocol::valid_model_id(id))
        .take(2000)
        .map(str::to_owned)
        .collect())
}

pub async fn verify_connection(platform: Platform, origin: &str) -> Result<()> {
    let connection = active_connection(platform, origin).await?;
    models(&client()?, &connection).await?;
    Ok(())
}

pub(super) fn https_url(text: &str) -> Result<Url> {
    let url = Url::parse(text).map_err(|_| anyhow::anyhow!("地址不是有效 URL"))?;
    ensure!(
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none(),
        "媒体地址必须使用无内嵌凭据的 HTTPS"
    );
    let host = url.host_str().unwrap_or("").trim_end_matches('.');
    ensure!(
        host.contains('.')
            && !host.ends_with(".localhost")
            && !host.ends_with(".local")
            && host.parse::<std::net::IpAddr>().is_err(),
        "媒体地址须使用公网 HTTPS 域名"
    );
    Ok(url)
}

pub(super) async fn download(
    client: &Client,
    connection: &Connection,
    location: &str,
    cap: usize,
) -> Result<Vec<u8>> {
    tokio::time::timeout(
        Duration::from_secs(60),
        download_inner(client, connection, location, cap),
    )
    .await
    .context("媒体下载超时，请继续下载原任务")?
}

async fn download_inner(
    client: &Client,
    connection: &Connection,
    location: &str,
    cap: usize,
) -> Result<Vec<u8>> {
    let base = https_url(&connection.origin)?;
    let mut url = base
        .join(location)
        .map_err(|_| anyhow::anyhow!("媒体下载地址无效"))?;
    for _ in 0..5 {
        url = https_url(url.as_str())?;
        let mut request = client.get(url.clone());
        if url.origin() == base.origin() {
            request = request.bearer_auth(&connection.key);
        }
        let response = request
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("媒体下载失败"))?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .context("下载重定向缺少地址")?;
            url = url
                .join(location)
                .map_err(|_| anyhow::anyhow!("下载重定向地址无效"))?;
            continue;
        }
        if !response.status().is_success() {
            bail!("媒体下载返回 HTTP {}", response.status().as_u16());
        }
        return limited_body(response, cap).await;
    }
    bail!("媒体下载重定向过多")
}

pub fn has_saved_route(platform: Platform, origin: &str) -> bool {
    read_json::<Value>(&fastaiapi_media_env::descriptor_path(), 256 * 1024).is_ok_and(
        |descriptor| {
            descriptor["platform"] == platform.id()
                && descriptor["origin"] == origin
                && descriptor["service"] == platform.service("media")
                && descriptor["account"] == fastaiapi_secret_store::account()
        },
    )
}

pub(crate) async fn active_connection(platform: Platform, origin: &str) -> Result<Connection> {
    validate_media_origin(platform, origin)?;
    let connection = load(&paths::default_app_state_dir(), None).await?;
    ensure!(
        connection.platform == platform && connection.origin == origin,
        "请连接当前平台及路线"
    );
    Ok(connection)
}

pub(crate) async fn status_for(platform: Platform, origin: &str) -> Value {
    use serde_json::json;
    let result = async {
        let active = active_connection(platform,origin).await?;
        let ids = models(&client()?, &active).await?;
        let defaults = fastaiapi_media_env::model_defaults(platform);
        let video = defaults["video_model"].as_str().unwrap_or("minimax-h3");
        let available = ids.iter().any(|id| id == video);
        Ok::<_,anyhow::Error>(json!({"state":"ready","message":"系统凭据与媒体路线已连接","models":ids,
            "image_model":defaults["image_model"],"video_model":video,"default_video_model":video,"default_video_available":available}))
    }.await;
    result.unwrap_or_else(|error| json!({"state":"needs_connection","message":error.to_string()}))
}

pub(crate) async fn current_key(platform: Platform, origin: &str) -> Result<String> {
    Ok(active_connection(platform, origin).await?.key)
}
