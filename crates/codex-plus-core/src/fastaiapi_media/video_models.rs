use crate::fastaiapi_platform::Platform;
use serde::Serialize;
use std::collections::BTreeMap;

const H3_MODELS: [&str; 5] = [
    "minimax-h3",
    "minimax-h3-x",
    "minimax-h3-u17",
    "minimax-h3-u24",
    "minimax-h3-u32",
];
const GROK: &str = "grok-imagine-video-1.5";

#[derive(Serialize)]
pub struct VideoMode {
    pub id: Option<&'static str>,
    pub seconds: Vec<u32>,
    pub default_seconds: u32,
    pub max_images: usize,
}

// TuMeiAPI 公开视频契约：https://tumeiapi.com/help/magic-video/gpu-video-api.md
// 这里只列已接入相应请求格式、且已知时长和图片上限的型号。
pub(super) fn modes(platform: Platform, model: &str) -> Vec<VideoMode> {
    if model == GROK {
        return vec![
            VideoMode {
                id: Some("first-frame"),
                seconds: vec![6, 12, 18, 24, 30],
                default_seconds: 6,
                max_images: 1,
            },
            VideoMode {
                id: Some("reference"),
                seconds: vec![6],
                default_seconds: 6,
                max_images: 6,
            },
        ];
    }

    let (min_seconds, default_seconds, max_images) = match (platform, model) {
        (Platform::NewApi, "minimax-h3-x") => (2, 3, 9),
        (Platform::NewApi, "minimax-h3-u17") => (5, 5, 0),
        (Platform::NewApi, "minimax-h3" | "minimax-h3-u24" | "minimax-h3-u32") => (5, 5, 9),
        // SubAPI 保留其现有 H3 时长范围。
        (Platform::SubApi, "minimax-h3") => (1, 5, 9),
        _ => return vec![],
    };
    vec![VideoMode {
        id: None,
        seconds: (min_seconds..=15).collect(),
        default_seconds,
        max_images,
    }]
}

pub fn video_test_models(platform: Platform) -> BTreeMap<&'static str, Vec<VideoMode>> {
    H3_MODELS
        .into_iter()
        .chain([GROK])
        .filter_map(|model| {
            let modes = modes(platform, model);
            (!modes.is_empty()).then_some((model, modes))
        })
        .collect()
}
