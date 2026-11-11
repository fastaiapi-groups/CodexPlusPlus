use anyhow::{Context, Result, bail, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use fs2::FileExt;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

use super::{
    connection::{self, Connection},
    protocol::{self, Generate},
};
use crate::fastaiapi_platform::Platform;

const MAX_IMAGE: usize = 32 * 1024 * 1024;
const MAX_VIDEO: usize = 200 * 1024 * 1024;
const RECEIPT_LIMIT: u64 = 128 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Lookup {
    pub workspace: PathBuf,
    pub request_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Recover {
    pub workspace: PathBuf,
    pub request_id: String,
    pub job_id: Option<String>,
    pub legacy_receipt: Option<PathBuf>,
}

#[derive(Serialize, Deserialize)]
struct Receipt {
    version: u8,
    request_id: String,
    workspace: PathBuf,
    platform: String,
    origin: String,
    key_fingerprint: String,
    kind: String,
    model: String,
    state: String,
    job_id: Option<String>,
    progress: Option<f64>,
    files: Vec<PathBuf>,
    created: u64,
}

impl Receipt {
    fn result(&self) -> Value {
        json!({
            "request_id": self.request_id, "model": self.model, "state": self.state,
            "job_id": self.job_id, "progress": self.progress, "files": self.files,
        })
    }

    fn update_remote(&mut self, response: &Value, id: &str) -> Result<()> {
        if response.get("id").is_some() || response.get("task_id").is_some() {
            ensure!(protocol::job_id(response)? == id, "平台响应不是原任务");
        }
        if let Some(model) = response["model"].as_str() {
            ensure!(model == self.model, "平台返回的模型与原任务不同");
        }
        self.state = match response["status"].as_str() {
            Some("completed" | "succeeded" | "success") => "succeeded",
            Some("failed" | "canceled" | "cancelled") => "failed",
            Some(
                status @ ("queued" | "dispatching" | "running" | "retrying" | "in_progress"
                | "pending" | "processing"),
            ) => status,
            _ => bail!("平台未返回可识别的任务状态，请继续查询原任务"),
        }
        .to_owned();
        self.progress = response["progress"].as_f64();
        self.job_id = Some(id.to_owned());
        Ok(())
    }
}

struct Run {
    id: String,
    workspace: PathBuf,
    path: PathBuf,
    _lock: File,
}

impl Run {
    fn open(state: &Path, workspace: &Path, id: &str) -> Result<Self> {
        let id = Uuid::parse_str(id)
            .map_err(|_| anyhow::anyhow!("request_id 须为 UUID"))?
            .to_string();
        let workspace = workspace_dir(workspace)?;
        let root = private_directory(&state.join("fastaiapi-media-runs"))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join(format!("{id}.lock")))?;
        lock.try_lock_exclusive()
            .map_err(|_| anyhow::anyhow!("这个任务正在处理，请稍后查询原任务"))?;
        Ok(Self {
            path: root.join(format!("{id}.json")),
            id,
            workspace,
            _lock: lock,
        })
    }

    fn load(&self) -> Result<Option<Receipt>> {
        if !self.path.exists() {
            return Ok(None);
        }
        let receipt: Receipt = connection::read_json(&self.path, RECEIPT_LIMIT)?;
        ensure!(
            receipt.version == 1
                && receipt.request_id == self.id
                && receipt.workspace == self.workspace,
            "该任务回执不属于当前项目"
        );
        Ok(Some(receipt))
    }

    fn save(&self, receipt: &Receipt) -> Result<()> {
        let bytes = serde_json::to_vec(receipt)?;
        crate::settings::atomic_write_with(&self.path, |file| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))?;
            }
            file.write_all(&bytes)
        })
    }

    fn create(&self, connection: &Connection, kind: &str, model: String, state: &str) -> Receipt {
        Receipt {
            version: 1,
            request_id: self.id.clone(),
            workspace: self.workspace.clone(),
            platform: connection.platform.id().into(),
            origin: connection.origin.clone(),
            key_fingerprint: connection.fingerprint(),
            kind: kind.into(),
            model,
            state: state.into(),
            job_id: None,
            progress: None,
            files: Vec::new(),
            created: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        }
    }

    fn write_output(&self, stem: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf> {
        let outputs = private_directory(&self.workspace.join("outputs"))?;
        ensure!(outputs.starts_with(&self.workspace), "产物目录不在当前项目");
        let dir = private_directory(&outputs.join(format!("fastaiapi-{}", self.id)))?;
        ensure!(dir.starts_with(&outputs), "产物目录不在当前项目");
        let path = dir.join(format!("{stem}.{ext}"));
        match fs::symlink_metadata(&path) {
            Ok(_) => bail!("产物文件已存在，未覆盖原文件"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        // 使用随机暂存文件，再原子发布。即使其他程序同时创建同名文件，
        // 也不会覆盖它；中断期间仅暂存文件可能不完整。
        let staging = dir.join(format!(".media-{}.part", Uuid::new_v4()));
        let result = (|| -> Result<()> {
            let mut options = OpenOptions::new();
            options.create_new(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&staging)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            publish_new_file(&staging, &path).context("无法原子保存产物，请检查项目目录与文件系统")?;
            Ok(())
        })();
        let _ = fs::remove_file(&staging);
        result?;
        Ok(path)
    }
}

#[cfg(target_os = "macos")]
fn publish_new_file(staging: &Path, path: &Path) -> Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let source = CString::new(staging.as_os_str().as_bytes())?;
    let target = CString::new(path.as_os_str().as_bytes())?;
    // SAFETY: 路径均为有效且在调用期间存活的 NUL 终止字符串。
    let result = unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };
    if result != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(windows)]
fn publish_new_file(staging: &Path, path: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW},
        core::PCWSTR,
    };
    let source = staging
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let target = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    // SAFETY: 缓冲区在调用期间存活。不指定 REPLACE_EXISTING。
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )?
    };
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn publish_new_file(staging: &Path, path: &Path) -> Result<()> {
    fs::hard_link(staging, path)?;
    Ok(())
}

fn workspace_dir(path: &Path) -> Result<PathBuf> {
    ensure!(path.is_absolute(), "请提供当前项目的绝对目录");
    let root = path.canonicalize().context("项目目录不存在或不可读")?;
    ensure!(root.is_dir(), "项目路径须为目录");
    Ok(root)
}

fn private_directory(path: &Path) -> Result<PathBuf> {
    if !path.exists() {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(path)?;
    }
    ensure!(
        fs::symlink_metadata(path)?.file_type().is_dir(),
        "媒体目录不能是符号链接或普通文件"
    );
    Ok(path.canonicalize()?)
}

async fn pinned_connection(state: &Path, receipt: &Receipt) -> Result<Connection> {
    let platform = Platform::parse(&receipt.platform).map_err(anyhow::Error::msg)?;
    let connection = connection::load(state, Some((platform, &receipt.origin))).await?;
    ensure!(
        connection.fingerprint() == receipt.key_fingerprint,
        "原任务的媒体 Key 已变更，请恢复原平台 Key 或到平台查询原任务"
    );
    Ok(connection)
}

pub(super) async fn generate(
    state: &Path,
    client: &Client,
    kind: &str,
    args: Generate,
) -> Result<Value> {
    let run = Run::open(state, &args.workspace, &args.request_id)?;
    if let Some(receipt) = run.load()? {
        ensure!(receipt.kind == kind, "该 request_id 已用于另一类媒体任务");
        let mut result = receipt.result();
        result["message"] = json!("此请求已有回执，未再次提交。结果不明确时请查询或恢复原任务。");
        return Ok(result);
    }
    let connection = connection::load(state, None).await?;
    let model = args.model(&connection, kind)?;
    let (path, body) = args.build(connection.platform, kind, &model, &run.workspace)?;
    ensure!(
        connection::models(client, &connection)
            .await?
            .contains(&model),
        "当前媒体 Key 未开放指定模型，请检查模型权限"
    );
    // 先确认项目目录可写，再发出可能计费的请求。
    let outputs = private_directory(&run.workspace.join("outputs"))?;
    private_directory(&outputs.join(format!("fastaiapi-{}", run.id)))?;
    let mut receipt = run.create(&connection, kind, model, "submitting");
    run.save(&receipt)?;
    let result = submit(&run, &mut receipt, client, &connection, path, &body).await;
    if let Err(error) = result {
        receipt.state = "submission_unknown".into();
        run.save(&receipt)?;
        let mut result = receipt.result();
        result["message"] = json!(format!(
            "提交结果待核实。请保留该 request_id，勿重新生成。{error}"
        ));
        return Ok(result);
    }
    run.save(&receipt)?;
    Ok(receipt.result())
}

async fn submit(
    run: &Run,
    receipt: &mut Receipt,
    client: &Client,
    connection: &Connection,
    path: &str,
    body: &Value,
) -> Result<()> {
    let intent = format!("media-api-{}", run.id);
    let response = connection::request(
        client,
        connection,
        Method::POST,
        path,
        Some(body),
        receipt
            .model
            .starts_with("minimax-h3")
            .then_some(intent.as_str()),
    )
    .await?;
    ensure!(
        response["error"].is_null(),
        "媒体平台报告错误，请到平台核实"
    );
    if receipt.kind == "video" {
        receipt.job_id = Some(protocol::job_id(&response)?.to_owned());
        receipt.state = "submitted".into();
        return Ok(());
    }
    let items = response["data"].as_array().context("图片响应缺少 data")?;
    ensure!(items.len() == 1, "图片接口未返回预期的单张图片");
    let item = &items[0];
    let bytes = if let Some(encoded) = item["b64_json"].as_str() {
        let encoded = if encoded.starts_with("data:") {
            encoded.split_once(',').map(|(_, b)| b).unwrap_or("")
        } else {
            encoded
        };
        ensure!(
            encoded.len() <= MAX_IMAGE.div_ceil(3) * 4,
            "图片超过大小限制"
        );
        STANDARD
            .decode(encoded)
            .map_err(|_| anyhow::anyhow!("图片 Base64 格式无效"))?
    } else {
        connection::download(
            client,
            connection,
            item["url"].as_str().context("图片响应缺少内容")?,
            MAX_IMAGE,
        )
        .await?
    };
    let ext = protocol::image_extension(&bytes)?;
    receipt.files.push(run.write_output("image", ext, &bytes)?);
    receipt.state = "downloaded".into();
    Ok(())
}

pub(super) async fn lookup(
    state: &Path,
    client: &Client,
    args: Lookup,
    download: bool,
) -> Result<Value> {
    let run = Run::open(state, &args.workspace, &args.request_id)?;
    let mut receipt = run
        .load()?
        .context("找不到该任务，请检查 request_id 或导入旧任务回执")?;
    ensure!(receipt.kind == "video", "此操作只适用于视频任务");
    if receipt.state == "downloaded" && receipt.files.iter().all(|file| file.is_file()) {
        return Ok(receipt.result());
    }
    let id = receipt
        .job_id
        .clone()
        .context("尚无平台任务 ID，请核实后用 recover_video 恢复原任务")?;
    let connection = pinned_connection(state, &receipt).await?;
    protocol::job_id(&json!({"id":id}))?;
    let path = format!("/v1/videos/{id}");
    let response = connection::request(client, &connection, Method::GET, &path, None, None).await?;
    receipt.update_remote(&response, &id)?;
    run.save(&receipt)?;
    if download && receipt.state == "succeeded" {
        let fallback = format!("{path}/content");
        let location = ["output_url", "content_url", "video_url", "url"]
            .iter()
            .find_map(|field| response[*field].as_str())
            .unwrap_or(&fallback);
        let bytes = connection::download(client, &connection, location, MAX_VIDEO).await?;
        let ext = if bytes.get(4..8) == Some(b"ftyp") {
            "mp4"
        } else if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
            "webm"
        } else {
            bail!("下载结果不是可识别的 MP4 或 WebM 视频");
        };
        receipt.files = vec![run.write_output("video", ext, &bytes)?];
        receipt.state = "downloaded".into();
        run.save(&receipt)?;
    }
    Ok(receipt.result())
}

pub(super) async fn recover(state: &Path, client: &Client, args: Recover) -> Result<Value> {
    let run = Run::open(state, &args.workspace, &args.request_id)?;
    let (mut receipt, connection, old_id) = if let Some(receipt) = run.load()? {
        ensure!(receipt.kind == "video", "该回执不是视频任务");
        let connection = pinned_connection(state, &receipt).await?;
        let old_id = receipt.job_id.clone();
        (receipt, connection, old_id)
    } else {
        let legacy = args
            .legacy_receipt
            .as_ref()
            .context("请提供原任务的旧 receipt.json")?;
        let path = run.workspace.join(legacy).canonicalize()?;
        ensure!(path.starts_with(&run.workspace), "旧回执须位于当前项目");
        let old: Value = connection::read_json(&path, RECEIPT_LIMIT)?;
        ensure!(
            old["schema"] == 2 && old["kind"] == "video",
            "旧回执格式无效"
        );
        let origin = old["origin"].as_str().context("旧回执没有原始路线")?;
        let platform = [Platform::NewApi, Platform::SubApi]
            .into_iter()
            .find(|platform| platform.origins().contains(&origin))
            .context("旧任务不属于受支持的托管路线")?;
        let model = old["model"]
            .as_str()
            .filter(|model| {
                protocol::valid_model_id(model) && crate::fastaiapi::model_kind(model) == "video"
            })
            .context("旧回执的视频模型无效")?;
        let connection = connection::load(state, Some((platform, origin))).await?;
        let receipt = run.create(&connection, "video", model.to_owned(), "submitted");
        (
            receipt,
            connection,
            old["job_id"].as_str().map(str::to_owned),
        )
    };
    let id = args
        .job_id
        .or_else(|| old_id.clone())
        .context("请提供在原平台核实过的任务 ID")?;
    ensure!(
        old_id.as_ref().is_none_or(|old| old == &id),
        "此回执已绑定另一个任务"
    );
    protocol::job_id(&json!({"id":id}))?;
    let value = connection::request(
        client,
        &connection,
        Method::GET,
        &format!("/v1/videos/{id}"),
        None,
        None,
    )
    .await?;
    receipt.update_remote(&value, &id)?;
    run.save(&receipt)?;
    Ok(receipt.result())
}

pub(super) fn list(state: &Path, workspace: &Path) -> Result<Value> {
    let root = workspace_dir(workspace)?;
    let path = state.join("fastaiapi-media-runs");
    if !path.is_dir() {
        return Ok(json!({"runs":[]}));
    }
    let mut receipts: Vec<Receipt> = fs::read_dir(path)?
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        .filter_map(|entry| connection::read_json(&entry.path(), RECEIPT_LIMIT).ok())
        .filter(|receipt: &Receipt| receipt.version == 1 && receipt.workspace == root)
        .collect();
    receipts.sort_by_key(|receipt| std::cmp::Reverse(receipt.created));
    Ok(json!({"runs": receipts.iter().take(20).map(Receipt::result).collect::<Vec<_>>() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{header, method, path},
    };

    fn fixture(origin: String) -> Connection {
        Connection {
            platform: Platform::NewApi,
            origin,
            key: "fixture-secret".into(),
            defaults: json!({}),
        }
    }

    #[tokio::test]
    async fn video_submission_saves_id_and_repeated_request_does_not_send_again() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/videos"))
            .and(header("authorization", "Bearer fixture-secret"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id":"video_original"})))
            .expect(1)
            .mount(&server)
            .await;
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().canonicalize().unwrap();
        let id = Uuid::new_v4().to_string();
        let run = Run::open(temp.path(), &workspace, &id).unwrap();
        let conn = fixture(server.uri());
        let mut receipt = run.create(&conn, "video", "minimax-h3".into(), "submitting");
        run.save(&receipt).unwrap();
        let client = Client::builder().no_proxy().build().unwrap();
        submit(
            &run,
            &mut receipt,
            &client,
            &conn,
            "/v1/videos",
            &json!({"model":"minimax-h3"}),
        )
        .await
        .unwrap();
        run.save(&receipt).unwrap();
        assert!(
            !fs::read_to_string(&run.path)
                .unwrap()
                .contains("fixture-secret")
        );
        drop(run);
        let args =
            serde_json::from_value(json!({"workspace":workspace,"request_id":id,"prompt":"retry"}))
                .unwrap();
        let result = generate(temp.path(), &client, "video", args).await.unwrap();
        assert_eq!(result["job_id"], "video_original");
        server.verify().await;
    }

    #[tokio::test]
    async fn image_result_is_written_without_overwriting_existing_artifact() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/images/generations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"data":[{"b64_json":STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture")}]}),
            ))
            .expect(1)
            .mount(&server)
            .await;
        let temp = tempfile::tempdir().unwrap();
        let run = Run::open(temp.path(), temp.path(), &Uuid::new_v4().to_string()).unwrap();
        let conn = fixture(server.uri());
        let mut receipt = run.create(&conn, "image", "gpt-image-2".into(), "submitting");
        let client = Client::builder().no_proxy().build().unwrap();
        submit(
            &run,
            &mut receipt,
            &client,
            &conn,
            "/v1/images/generations",
            &json!({}),
        )
        .await
        .unwrap();
        assert_eq!(receipt.state, "downloaded");
        assert!(receipt.files[0].ends_with("image.png"));
        assert!(run.write_output("image", "png", b"overwrite").is_err());
        assert_eq!(
            fs::read(&receipt.files[0]).unwrap(),
            b"\x89PNG\r\n\x1a\nfixture"
        );
    }

    #[test]
    fn rejects_wrong_task_or_model_without_mutating_the_original_receipt() {
        let temp = tempfile::tempdir().unwrap();
        let run = Run::open(temp.path(), temp.path(), &Uuid::new_v4().to_string()).unwrap();
        let mut receipt = run.create(
            &fixture("https://tumeiapi.com".into()),
            "video",
            "minimax-h3".into(),
            "submitted",
        );
        assert!(
            receipt
                .update_remote(&json!({"id":"other","status":"success"}), "original")
                .is_err()
        );
        assert!(
            receipt
                .update_remote(
                    &json!({"id":"original","model":"other","status":"success"}),
                    "original"
                )
                .is_err()
        );
        assert_eq!(receipt.state, "submitted");
        assert!(
            receipt
                .update_remote(
                    &json!({"id":"original","status":"completed","progress":100}),
                    "original"
                )
                .is_ok()
        );
        assert_eq!(receipt.state, "succeeded");
        assert_eq!(receipt.origin, "https://tumeiapi.com");
    }
}
