use anyhow::{Context, Result, bail, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use super::connection::{Connection, https_url};
use crate::{fastaiapi::model_kind, fastaiapi_platform::Platform};

const MAX_INLINE: usize = 10 * 1024 * 1024;
const MAX_GROK_INLINE: usize = 100 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Generate {
    pub workspace: PathBuf,
    pub request_id: String,
    pub prompt: String,
    pub model: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub audios: Vec<String>,
    #[serde(default)]
    pub videos: Vec<String>,
    pub size: Option<String>,
    pub seconds: Option<u32>,
    pub ratio: Option<String>,
    pub resolution: Option<String>,
    pub mode: Option<String>,
}

pub(super) fn valid_model_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/-".contains(&b))
}

impl Generate {
    pub fn model(&self, connection: &Connection, kind: &str) -> Result<String> {
        let default = if kind == "image" {
            "gpt-image-2"
        } else {
            "minimax-h3"
        };
        let model = self
            .model
            .as_deref()
            .or_else(|| connection.defaults[kind].as_str())
            .unwrap_or(default);
        let model = if model == "grok" {
            "grok-imagine-video-1.5"
        } else {
            model
        };
        ensure!(
            valid_model_id(model) && model_kind(model) == kind,
            "请选择对应类型的有效模型"
        );
        Ok(model.to_owned())
    }

    pub fn build(
        &self,
        platform: Platform,
        kind: &str,
        model: &str,
        root: &Path,
    ) -> Result<(&'static str, Value)> {
        let prompt = self.prompt.trim();
        ensure!(
            !prompt.is_empty() && prompt.len() <= 64 * 1024,
            "请提供非空且不超过 64 KiB 的提示词"
        );
        if kind == "image" {
            ensure!(self.images.len() <= 4, "生图最多支持四张参考图");
            ensure!(
                self.audios.is_empty()
                    && self.videos.is_empty()
                    && self.seconds.is_none()
                    && self.ratio.is_none()
                    && self.resolution.is_none()
                    && self.mode.is_none(),
                "图片工具不接受视频参数"
            );
            let size = self.size.as_deref().unwrap_or("1024x1024");
            ensure!(
                [
                    "1024x1024",
                    "720x1280",
                    "1280x720",
                    "1248x832",
                    "1152x864",
                    "864x1152",
                    "832x1248",
                    "2048x2048",
                    "1440x2560",
                    "2560x1440",
                    "2496x1664",
                    "2304x1728",
                    "1728x2304",
                    "1664x2496",
                    "2160x3840",
                    "3840x2160"
                ]
                .contains(&size),
                "请选择支持的图片尺寸"
            );
            let mut budget = MAX_INLINE;
            let images = encode_all(root, &self.images, "image", false, &mut budget)?;
            let mut body = json!({"model":model,"prompt":prompt,"size":size,"n":1,"response_format":"b64_json"});
            let path = if images.is_empty() {
                "/v1/images/generations"
            } else {
                body["images"] = json!(images);
                "/v1/images/edits"
            };
            return Ok((path, body));
        }
        ensure!(self.size.is_none(), "视频请使用比例和分辨率参数");
        let ratio = self.ratio.as_deref().unwrap_or("16:9");
        ensure!(
            matches!(ratio, "16:9" | "9:16"),
            "视频比例必须为 16:9 或 9:16"
        );
        let grok = model == "grok-imagine-video-1.5";
        let h3 = model.starts_with("minimax-h3");
        let seconds = self.seconds.unwrap_or(if grok { 6 } else { 5 });
        let resolution =
            self.resolution
                .as_deref()
                .unwrap_or(if h3 && platform == Platform::NewApi {
                    "480p"
                } else {
                    "720p"
                });
        if grok {
            ensure!(
                self.videos.is_empty() && resolution == "720p",
                "Grok 只支持 720p，不能传参考视频"
            );
            let mode = self.mode.as_deref().unwrap_or("first-frame");
            ensure!(
                [6, 12, 18, 24, 30].contains(&seconds),
                "Grok 时长支持 6、12、18、24、30 秒"
            );
            match mode {
                "first-frame" => ensure!(
                    self.images.len() <= 1 && self.audios.is_empty(),
                    "Grok 首帧模式最多一张图且不能传音频"
                ),
                "reference" => ensure!(
                    seconds == 6 && self.images.len() <= 6 && self.audios.len() <= 3,
                    "Grok 参考模式为 6 秒，最多六张图和三个音频"
                ),
                _ => bail!("Grok 模式应为 first-frame 或 reference"),
            }
            let mut budget = MAX_GROK_INLINE;
            let images = encode_all(root, &self.images, "image", false, &mut budget)?;
            let audios = encode_all(root, &self.audios, "audio", false, &mut budget)?;
            let mut body = json!({"model":model,"prompt":prompt,"duration":seconds,"resolution":resolution,"aspect_ratio":ratio});
            if mode == "first-frame" {
                if let Some(first) = images.first() {
                    body["image"] = json!({"b64":first});
                }
            } else {
                for (kind, sources) in [("reference_images", images), ("reference_audios", audios)]
                {
                    if !sources.is_empty() {
                        body[kind] = json!(
                            sources
                                .iter()
                                .map(|value| json!({"b64":value}))
                                .collect::<Vec<_>>()
                        );
                    }
                }
            }
            return Ok(("/v1/videos", body));
        }
        ensure!(self.mode.is_none(), "此模型不接受 Grok 模式参数");
        ensure!(
            platform == Platform::NewApi || model == "minimax-h3",
            "SubAPI 仅支持已适配的 H3 与 Grok 视频模型"
        );
        ensure!(
            !h3 || !self.images.is_empty(),
            "MiniMax H3 至少需要一张参考图"
        );
        ensure!(
            (1..=if h3 { 15 } else { 60 }).contains(&seconds),
            "视频时长超出适配范围"
        );
        ensure!(
            self.images.len() <= 9 && self.audios.len() <= 3 && self.videos.len() <= 3,
            "参考素材数量超过限制"
        );
        ensure!(
            platform != Platform::NewApi || self.videos.is_empty(),
            "New API 视频适配器不接受参考视频"
        );
        let mut budget = MAX_INLINE;
        let images = encode_all(root, &self.images, "image", true, &mut budget)?;
        let audios = encode_all(root, &self.audios, "audio", true, &mut budget)?;
        let videos = encode_all(root, &self.videos, "video", true, &mut budget)?;
        let prompt = if h3 {
            bind_prompt(prompt, &images, &videos, &audios)
        } else {
            prompt.to_owned()
        };
        let body = if platform == Platform::SubApi {
            ensure!(resolution == "720p", "SubAPI H3 当前使用 720p");
            let mut content = vec![json!({"type":"text","text":prompt})];
            for (kind, references) in [("image", images), ("video", videos), ("audio", audios)] {
                for source in references {
                    let is_data = source.starts_with("data:");
                    let field = format!("{kind}_{}", if is_data { "b64" } else { "url" });
                    let value = if is_data {
                        json!(source)
                    } else {
                        json!({"url":source})
                    };
                    content.push(
                        json!({"type":field,"role":format!("reference_{kind}"),(field):value}),
                    );
                }
            }
            json!({"model":model,"content":content,"resolution":resolution,"ratio":ratio,"duration":seconds})
        } else {
            let (w, h) = match (h3, resolution) {
                (_, "480p") => (864, 480),
                (false, "720p") => (1280, 720),
                (_, "768p") => (1376, 768),
                (true, "1080p") => (1920, 1088),
                (false, "1080p") => (1920, 1080),
                _ => bail!("所选视频模型不支持此分辨率"),
            };
            let size = if ratio == "9:16" {
                format!("{h}x{w}")
            } else {
                format!("{w}x{h}")
            };
            let mut body = json!({"model":model,"prompt":prompt,"seconds":seconds,"size":size});
            if !images.is_empty() {
                body["reference_images"] = json!(images);
            }
            if !audios.is_empty() {
                body["reference_audios"] = json!(audios);
            }
            body
        };
        ensure!(
            serde_json::to_vec(&body)?.len() <= MAX_INLINE,
            "媒体请求超过 10 MiB，请缩小素材或使用 HTTPS 素材地址"
        );
        Ok(("/v1/videos", body))
    }
}

fn bind_prompt(prompt: &str, images: &[String], videos: &[String], audios: &[String]) -> String {
    let mut bindings = String::new();
    for (english, chinese, count) in [
        ("Picture", "图像", images.len()),
        ("Video", "视频", videos.len()),
        ("Audio", "音频", audios.len()),
    ] {
        for number in 1..=count {
            bindings.push_str(&format!(
                "<{english} {number}> corresponds to @{chinese}{number}.\n"
            ));
        }
    }
    format!("Reference bindings (numbered independently per media type):\n{bindings}\n{prompt}")
}

fn encode_all(
    root: &Path,
    sources: &[String],
    kind: &str,
    remote: bool,
    budget: &mut usize,
) -> Result<Vec<String>> {
    sources
        .iter()
        .map(|source| {
            if source.contains("://") {
                ensure!(remote && source.len() <= 4096, "此模型要求本地参考素材");
                https_url(source)?;
                return Ok(source.clone());
            }
            let path = root
                .join(source)
                .canonicalize()
                .map_err(|_| anyhow::anyhow!("参考素材不存在或不可读"))?;
            ensure!(
                path.starts_with(root),
                "参考素材须位于当前项目内，请先把附件保存到项目"
            );
            let metadata = path.metadata()?;
            ensure!(metadata.is_file(), "参考素材须是普通文件");
            let ext = path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let mime = match (kind, ext.as_str()) {
                ("image", "png") => "image/png",
                ("image", "jpg" | "jpeg") => "image/jpeg",
                ("image", "webp") => "image/webp",
                ("image", "gif") => "image/gif",
                ("image", "avif") => "image/avif",
                ("image", "bmp") => "image/bmp",
                ("audio", "mp3" | "mpeg") => "audio/mpeg",
                ("audio", "wav") => "audio/wav",
                ("audio", "flac") => "audio/flac",
                ("audio", "aac") => "audio/aac",
                ("audio", "m4a") => "audio/mp4",
                ("audio", "ogg" | "oga") => "audio/ogg",
                ("audio", "webm") => "audio/webm",
                ("video", "mp4" | "mov" | "webm") => match ext.as_str() {
                    "mov" => "video/quicktime",
                    "webm" => "video/webm",
                    _ => "video/mp4",
                },
                _ => bail!("参考素材格式不受支持"),
            };
            let prefix = format!("data:{mime};base64,");
            let max_raw = budget.saturating_sub(prefix.len()) / 4 * 3;
            ensure!(
                metadata.len() > 0 && metadata.len() <= max_raw as u64,
                "参考素材为空或超出请求大小限制"
            );
            let mut data = Vec::new();
            File::open(path)?
                .take(max_raw as u64 + 1)
                .read_to_end(&mut data)?;
            ensure!(
                !data.is_empty() && data.len() <= max_raw,
                "参考素材超出请求大小限制"
            );
            if kind == "image" {
                let expected = match ext.as_str() {
                    "jpeg" => "jpg",
                    other => other,
                };
                ensure!(
                    image_extension(&data).ok() == Some(expected),
                    "参考图内容与文件格式不符"
                );
            }
            let value = prefix + &STANDARD.encode(data);
            *budget -= value.len();
            Ok(value)
        })
        .collect()
}

pub(super) fn image_extension(bytes: &[u8]) -> Result<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("webp");
    }
    if bytes.get(4..12) == Some(b"ftypavif") || bytes.get(4..12) == Some(b"ftypavis") {
        return Ok("avif");
    }
    if bytes.starts_with(b"BM") && bytes.len() > 14 {
        return Ok("bmp");
    }
    bail!("返回文件不是可识别的图片")
}

pub(super) fn job_id(value: &Value) -> Result<&str> {
    let id = value["id"]
        .as_str()
        .or_else(|| value["task_id"].as_str())
        .context("平台未返回任务 ID")?;
    ensure!(
        !id.is_empty()
            && id.len() <= 512
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)),
        "平台任务 ID 格式无效"
    );
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(root: &Path) -> Generate {
        serde_json::from_value(json!({
            "workspace":root,"request_id":"00000000-0000-4000-8000-000000000001","prompt":"一只猫回头",
            "images":["frame.png"],"seconds":5
        })).unwrap()
    }

    #[test]
    fn h3_uses_the_platform_specific_payload() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::write(root.join("frame.png"), b"\x89PNG\r\n\x1a\nfixture").unwrap();
        let args = args(&root);
        let (path, new) = args
            .build(Platform::NewApi, "video", "minimax-h3", &root)
            .unwrap();
        assert_eq!(path, "/v1/videos");
        assert_eq!(new["seconds"], 5);
        assert_eq!(new["size"], "864x480");
        assert!(
            new["reference_images"][0]
                .as_str()
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
        assert!(new.get("content").is_none());
        let (_, sub) = args
            .build(Platform::SubApi, "video", "minimax-h3", &root)
            .unwrap();
        assert_eq!(sub["duration"], 5);
        assert_eq!(sub["content"][1]["type"], "image_b64");
        assert_eq!(sub["resolution"], "720p");
        let args = Generate {
            seconds: Some(3),
            ..args
        };
        let (_, short) = args
            .build(Platform::NewApi, "video", "minimax-h3-x", &root)
            .unwrap();
        assert_eq!(short["model"], "minimax-h3-x");
        assert_eq!(short["seconds"], 3);
    }

    #[test]
    fn image_edits_reject_project_escape_and_preserve_reference_payload() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("project");
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let mut args = args(&root);
        args.seconds = None;
        std::fs::write(temp.path().join("private.png"), b"\x89PNG\r\n\x1a\nfixture").unwrap();
        args.images = vec!["../private.png".into()];
        assert!(
            args.build(Platform::NewApi, "image", "gpt-image-2", &root)
                .is_err()
        );
        std::fs::write(root.join("frame.png"), b"\x89PNG\r\n\x1a\nfixture").unwrap();
        args.images = vec!["frame.png".into()];
        let (path, body) = args
            .build(Platform::NewApi, "image", "gpt-image-2", &root)
            .unwrap();
        assert_eq!(path, "/v1/images/edits");
        assert_eq!(body["size"], "1024x1024");
        assert!(
            body["images"][0]
                .as_str()
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
    }

    #[test]
    fn h3_requires_a_reference_and_grok_keeps_its_own_contract() {
        let mut args = args(Path::new("."));
        args.images.clear();
        assert!(
            args.build(Platform::NewApi, "video", "minimax-h3", Path::new("."))
                .is_err()
        );
        assert!(
            args.build(
                Platform::NewApi,
                "video",
                "grok-imagine-video-1.5",
                Path::new(".")
            )
            .is_err()
        );
        args.seconds = Some(6);
        let (_, grok) = args
            .build(
                Platform::NewApi,
                "video",
                "grok-imagine-video-1.5",
                Path::new("."),
            )
            .unwrap();
        assert_eq!(grok["duration"], 6);
        assert_eq!(grok["resolution"], "720p");
        assert!(grok.get("seconds").is_none());
    }
}
