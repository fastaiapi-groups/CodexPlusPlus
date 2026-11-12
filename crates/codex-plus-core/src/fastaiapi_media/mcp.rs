//! 本地 stdio 边界。stdout 只承载 JSON-RPC，工具从不返回系统凭据。
use anyhow::{Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    io::{BufRead, Read, Write},
    path::{Path, PathBuf},
};

use super::{connection, runs};

const MAX_LINE: u64 = 256 * 1024;
const INSTRUCTIONS: &str = "使用当前选中的 TuMeiAPI 或 FastAiAPI 线路生成图片和视频，按对应平台计费。仅在用户明确请求生成时提交。优先使用用户指定的精确模型，否则跟随 Codex++ 默认模型。每次生成使用一个新的 UUID 作为 request_id，重试、查询或恢复必须复用该 ID。视频提交后用 video_status 查询并在成功后用 download_video 保存；用 list_runs 找回当前项目最近任务。遇到 submitting 或 submission_unknown 时查询原任务或按已核实的平台任务 ID 恢复，不得另起生成。MiniMax H3 支持纯文字生成，参考素材按型号选填，素材须位于用户指定的项目内或使用受支持的 HTTPS 参考地址。产物写入该项目的 outputs 子目录。工具不会要求用户粘贴 Key 到对话中。";

pub fn run(args: &[OsString]) -> Result<()> {
    let [flag, state] = args else {
        bail!("媒体 MCP 需要 --state-dir 参数");
    };
    ensure!(flag == "--state-dir", "媒体 MCP 启动参数无效");
    let state = PathBuf::from(state);
    ensure!(
        state.is_absolute() && state.is_dir(),
        "媒体 MCP 状态目录无效"
    );
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let client = connection::client()?;
    let result = serve(&state, &client, &runtime);
    runtime.shutdown_timeout(std::time::Duration::from_secs(1));
    result
}

fn serve(state: &Path, client: &reqwest::Client, runtime: &tokio::runtime::Runtime) -> Result<()> {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    let mut line = Vec::new();
    loop {
        line.clear();
        let size = input
            .by_ref()
            .take(MAX_LINE + 1)
            .read_until(b'\n', &mut line)?;
        if size == 0 {
            break;
        }
        if size as u64 > MAX_LINE {
            // 丢弃到这一帧结尾，避免把剩余字节误当另一条请求。
            if line.last() != Some(&b'\n') {
                input.skip_until(b'\n')?;
            }
            write_response(
                &mut output,
                &rpc_error(Value::Null, -32600, "MCP 请求超过大小限制"),
            )?;
            continue;
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let response = match serde_json::from_slice::<Value>(&line) {
            Ok(request) => runtime.block_on(handle(state, client, request)),
            Err(_) => Some(rpc_error(Value::Null, -32700, "MCP 请求 JSON 无效")),
        };
        if let Some(response) = response {
            write_response(&mut output, &response)?;
        }
    }
    Ok(())
}

fn write_response(output: &mut impl Write, response: &Value) -> Result<()> {
    serde_json::to_writer(&mut *output, response)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}

async fn handle(state: &Path, client: &reqwest::Client, request: Value) -> Option<Value> {
    if request["jsonrpc"] != "2.0" || !request["method"].is_string() {
        return Some(rpc_error(Value::Null, -32600, "无效的 MCP 请求"));
    }
    let id = request.get("id")?.clone();
    let result = match request["method"].as_str()? {
        "initialize" => {
            let requested = request["params"]["protocolVersion"]
                .as_str()
                .unwrap_or("2024-11-05");
            let version = match requested {
                "2024-11-05" | "2025-03-26" | "2025-06-18" | "2025-11-25" => requested,
                _ => "2025-11-25",
            };
            json!({"protocolVersion":version,"capabilities":{"tools":{}},"serverInfo":{"name":"FastAiApi Media","version":env!("CARGO_PKG_VERSION")},"instructions":INSTRUCTIONS})
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools": tools()}),
        "tools/call" => {
            let Some(name) = request["params"]["name"].as_str() else {
                return Some(rpc_error(id, -32602, "缺少工具名称"));
            };
            let args = request["params"]
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match call(state, client, name, args).await {
                Ok(value) => {
                    json!({"isError":false,"content":[{"type":"text","text":value.to_string()}]})
                }
                Err(error) => {
                    json!({"isError":true,"content":[{"type":"text","text":error.to_string()}]})
                }
            }
        }
        _ => return Some(rpc_error(id, -32601, "此 MCP 方法未实现")),
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}

fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value)
        .map_err(|_| anyhow::anyhow!("工具参数不符合定义，请检查必填字段和类型"))
}

pub(super) async fn call(
    state: &Path,
    client: &reqwest::Client,
    name: &str,
    args: Value,
) -> Result<Value> {
    match name {
        "connection_status" | "list_models" => {
            ensure!(
                args.as_object().is_some_and(|object| object.is_empty()),
                "此工具不需要参数"
            );
            let active = connection::load(state, None, None).await?;
            if name == "list_models" {
                let lists = connection::models_by_kind(state, client, &active).await;
                ensure!(
                    lists.contains_key("image") || lists.contains_key("video"),
                    "无法读取媒体模型，请检查路线和分组 Key"
                );
                let models = ["image", "video"]
                    .iter()
                    .filter_map(|kind| lists.get(*kind))
                    .filter_map(Value::as_array)
                    .flatten()
                    .collect::<Vec<_>>();
                return Ok(
                    json!({"platform":active.platform.id(),"origin":active.origin,"models":models}),
                );
            }
            Ok(
                json!({"credential_readable":true,"platform":active.platform.id(),"origin":active.origin,
                "defaults":{"image":active.defaults["image"].as_str().unwrap_or("gpt-image-2"),
                "video":active.defaults["video"].as_str().unwrap_or("minimax-h3")}}),
            )
        }
        "generate_image" => runs::generate(state, client, "image", parse(args)?).await,
        "submit_video" => runs::generate(state, client, "video", parse(args)?).await,
        "video_status" => runs::lookup(state, client, parse(args)?, false).await,
        "download_video" => runs::lookup(state, client, parse(args)?, true).await,
        "recover_video" => runs::recover(state, client, parse(args)?).await,
        "list_runs" => {
            #[derive(serde::Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {
                workspace: PathBuf,
            }
            runs::list(state, &parse::<Args>(args)?.workspace)
        }
        _ => bail!("未知的媒体工具"),
    }
}

fn tool(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
    read_only: bool,
) -> Value {
    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false},
        "annotations":{"readOnlyHint":read_only,"destructiveHint":false,"openWorldHint":true}})
}

fn tools() -> Vec<Value> {
    let string = json!({"type":"string"});
    let refs = json!({"type":"array","items":{"type":"string"}});
    let workspace = json!({"type":"string","description":"用户当前项目的已存在绝对目录"});
    let request = json!({"type":"string","description":"任务 UUID。后续查询及重试复用同一个值"});
    let lookup = json!({"workspace":workspace,"request_id":request});
    let required = ["workspace", "request_id"];
    vec![
        tool(
            "connection_status",
            "检查本机媒体凭据是否可读，返回平台、路线和默认模型。",
            json!({}),
            &[],
            true,
        ),
        tool(
            "list_models",
            "查询当前媒体 Key 可用的图片和视频模型。",
            json!({}),
            &[],
            true,
        ),
        tool(
            "generate_image",
            "按当前平台计费生成或编辑一张图片，成功时返回本地文件路径。",
            json!({"workspace":workspace,"request_id":request,"prompt":string,"model":string,"images":refs,"size":string}),
            &["workspace", "request_id", "prompt"],
            false,
        ),
        tool(
            "submit_video",
            "按当前平台计费提交视频任务，保存回执并返回任务 ID。参考图和视频时长按模型及模式限制。",
            json!({"workspace":workspace,"request_id":request,"prompt":string,"model":string,
                "images":refs,"audios":refs,"videos":refs,"seconds":{"type":"integer","minimum":1,"maximum":60},
                "ratio":{"enum":["16:9","9:16"]},"resolution":{"enum":["480p","720p","768p","1080p"]},
                "mode":{"enum":["first-frame","reference"],"description":"仅 Grok 支持。默认首帧模式。"}}),
            &["workspace", "request_id", "prompt"],
            false,
        ),
        tool(
            "video_status",
            "查询已提交视频的最新状态，更新本地回执。",
            lookup.clone(),
            &required,
            false,
        ),
        tool(
            "download_video",
            "查询原任务并下载已完成的视频到当前项目。",
            lookup,
            &required,
            false,
        ),
        tool(
            "recover_video",
            "用原平台核实过的任务 ID 恢复不确定的提交，或导入项目中的旧 receipt.json。不重新提交。",
            json!({"workspace":workspace,"request_id":request,"job_id":string,"legacy_receipt":string}),
            &required,
            false,
        ),
        tool(
            "list_runs",
            "列出当前项目最近的本地媒体任务，用于恢复上次生成。",
            json!({"workspace":workspace}),
            &["workspace"],
            true,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn exposes_media_tools_without_credentials_at_startup() {
        let client = connection::client().unwrap();
        let reply = handle(
            Path::new("unconfigured"),
            &client,
            json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
        )
        .await
        .unwrap();
        let tools = reply["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|t| t["name"] == "generate_image"));
        assert!(tools.iter().any(|t| t["name"] == "submit_video"));
        assert!(tools.iter().any(|t| t["name"] == "recover_video"));
        let reply = handle(Path::new("unconfigured"),&client,json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"connection_status","arguments":{"api_key":"fixture-secret"}}})).await.unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert!(!reply.to_string().contains("fixture-secret"));
    }
}
