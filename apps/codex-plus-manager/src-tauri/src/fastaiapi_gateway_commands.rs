//! 多分组自动换 Key（opt-in）。
//!
//! Codex 一份配置只带一个 Key，换到别的分组的模型会被平台拒绝。这里把当前平台每个分组的
//! Key 同步成 Codex++ 网关池里的一个上游，再让 Codex 接入网关：之后在 Codex 里换模型，
//! 网关按模型名选到对应分组的 Key。只复用上游网关的现成能力，不改它的路由。

use codex_plus_core::fastaiapi_platform::{self as panels, Platform};
use codex_plus_core::gateway::apply::{self, ApplyContext, ProviderInput};
use codex_plus_core::gateway::route;
use codex_plus_core::gateway::store::{GatewaySettings, GatewayStore};
use codex_plus_core::settings::{RelayProtocol, SettingsStore};
use codex_plus_core::tools::ToolId;
use serde_json::{Value, json};

/// 网关供应商的来源标记：`fastaiapi:<平台>:<分组>`，据此识别并更新自己同步进去的上游。
fn source_prefix(platform: Platform) -> String {
    format!("fastaiapi:{}:", platform.id())
}

fn context() -> ApplyContext {
    ApplyContext::default_paths(
        codex_plus_core::resident_helper::resident_helper_port()
            .unwrap_or_else(codex_plus_core::protocol_proxy::protocol_proxy_port),
    )
}

fn text(error: anyhow::Error) -> String {
    format!("{error:#}")
}

/// 当前平台同步进网关的上游 id。
fn synced_ids(gateway: &GatewaySettings, platform: Platform) -> Vec<String> {
    let prefix = source_prefix(platform);
    gateway
        .providers
        .iter()
        .filter(|provider| provider.enabled && provider.source.starts_with(&prefix))
        .map(|provider| provider.relay.id.clone())
        .collect()
}

/// Codex 绑定实际在用的当前平台分组上游。池里有但被绑定排除的不算：
/// 两个平台都同步过时，Codex 同一时间只用其中一个平台的分组。
fn in_use_ids(gateway: &GatewaySettings, platform: Platform) -> Vec<String> {
    let Some(binding) = gateway.active_binding(&ToolId::Codex) else {
        return Vec::new();
    };
    synced_ids(gateway, platform)
        .into_iter()
        .filter(|id| !binding.pool_exclude.contains(id))
        .collect()
}

/// Codex 已接入网关，并且正在用当前平台同步的分组。
pub(crate) fn enabled(platform: Platform) -> bool {
    GatewayStore::default()
        .load()
        .is_ok_and(|gateway| !in_use_ids(&gateway, platform).is_empty())
}

/// 自动换 Key 开着时 Codex 的默认文字模型（网关绑定的主模型）。
pub(crate) fn default_model(platform: Platform) -> Option<String> {
    let gateway = GatewayStore::default().load().ok()?;
    let binding = gateway.active_binding(&ToolId::Codex)?;
    if in_use_ids(&gateway, platform).is_empty() {
        return None;
    }
    Some(route::binding_default_model(&gateway, binding)).filter(|model| !model.is_empty())
}

/// 用户是否关掉了自动换 Key。没有这个文件就是默认开启。
fn preference_path(platform: Platform) -> std::path::PathBuf {
    codex_plus_core::paths::default_app_state_dir().join(format!("account-{}-auto-key", platform.id()))
}
fn wanted(platform: Platform) -> bool {
    std::fs::read_to_string(preference_path(platform)).map_or(true, |value| value.trim() != "off")
}
fn remember(platform: Platform, on: bool) -> Result<(), String> {
    codex_plus_core::settings::atomic_write(
        &preference_path(platform),
        if on { b"on" } else { b"off" },
    )
    .map_err(|_| "无法保存自动换 Key 的开关".to_owned())
}

fn status(platform: Platform) -> Result<Value, String> {
    let gateway = GatewayStore::default().load().map_err(text)?;
    let ids = in_use_ids(&gateway, platform);
    let on = !ids.is_empty();
    let model = gateway
        .binding(&ToolId::Codex)
        .map(|binding| route::binding_default_model(&gateway, binding))
        .unwrap_or_default();
    Ok(json!({"enabled":on,"groups":ids.len(),"model":model,"wanted":wanted(platform)}))
}

/// 自动换 Key 开着时切换默认文字模型：只改网关绑定的主模型，Codex 仍走网关。
pub(crate) fn set_default_model(model: &str) -> Result<(), String> {
    let ctx = context();
    let gateway = ctx.gateway.load().map_err(text)?;
    let mut binding = gateway
        .active_binding(&ToolId::Codex)
        .cloned()
        .ok_or("Codex 尚未接入网关")?;
    if !route::model_is_routable(&gateway, &binding, model) {
        return Err("所选模型不在已同步的分组里，请先重新同步分组 Key。".into());
    }
    binding.model = model.to_owned();
    apply::enable_binding(&ctx, &ToolId::Codex, binding).map_err(text)?;
    Ok(())
}

/// 平台目录没标类型、通用规则也认不出的图片 / 视频模型（Gemini 生图的 nano-banana、
/// 魔法视频的 mx-h3）。它们不能对话，不放进 Codex 的模型列表。
fn media_by_name(model: &str) -> bool {
    let lower = model.to_ascii_lowercase();
    lower.contains("banana") || lower.starts_with("mx-h3")
}

/// 分组目录里的文字模型：优先用平台列出的 `model_ids`，没有时退回价格表里的模型名。
fn group_text_models(catalog: &Value) -> Vec<String> {
    let mut models: Vec<String> = match catalog["model_ids"].as_array() {
        Some(ids) => ids.iter().filter_map(|id| id.as_str()).map(str::to_owned).collect(),
        None => catalog["models"]
            .as_array()
            .map(|rows| {
                rows.iter()
                    .filter_map(|row| row["model"].as_str())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    };
    // 类型以平台目录标注为准（「香蕉分组」「魔法视频分组」的模型名看不出是图片 / 视频），没标注再按名字猜。
    let kind = |model: &str| {
        catalog["models"]
            .as_array()
            .and_then(|rows| rows.iter().find(|row| row["model"] == model))
            .and_then(|row| row["kind"].as_str())
            .unwrap_or_else(|| codex_plus_core::fastaiapi::model_kind(model))
            .to_owned()
    };
    models.retain(|model| kind(model) == "text" && !media_by_name(model));
    models.sort();
    models.dedup();
    models
}

async fn sync(platform: Platform) -> Result<Value, String> {
    let route_before = panels::route(platform).await;
    let origin = panels::origin(platform).await;
    let groups = panels::account(platform, "groups", "", Value::Null).await?;
    let mut groups: Vec<(String, String)> = groups
        .as_array()
        .ok_or("无法读取模型分组")?
        .iter()
        .filter_map(|group| {
            let id = group["id"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| group["id"].as_i64().map(|id| id.to_string()))?;
            Some((id.clone(), group["name"].as_str().unwrap_or(&id).to_owned()))
        })
        .collect();
    // 同一模型多个分组都有时，网关按池内顺序优先用靠前的：New API 的 auto Key 会跨分组路由，排最前，
    // 其次 default。
    groups.sort_by_key(|(_, name)| match name.as_str() {
        "auto" if platform == Platform::NewApi => 0,
        "default" => 1,
        _ => 2,
    });
    // 模型以分组目录为准：New API 的 /v1/models 不按 Key 的分组过滤，每把 Key 都返回同一份列表。
    let catalogs = panels::account(platform, "group_model_catalogs", "", Value::Null).await?;
    let store = GatewayStore::default();
    let prefix = source_prefix(platform);
    let (mut synced, mut models_total, mut skipped) = (0usize, 0usize, Vec::new());
    let mut kept: Vec<String> = Vec::new();
    let mut order: Vec<String> = Vec::new();
    for (group, name) in groups {
        // 目录这次没取到（平台接口瞬时失败）不等于分组没有文字模型：保留上次同步的上游，不动它。
        // New API 的分组模型以 `model_ids` 为准，缺了它说明这次没列出来，价格表里的模型不完整。
        let catalog = catalogs["catalogs"].get(&group);
        if catalog.is_none()
            || (platform == Platform::NewApi
                && !catalog.is_some_and(|catalog| catalog["model_ids"].is_array()))
        {
            kept.push(format!("{prefix}{group}"));
            skipped.push(format!("{name}：分组模型目录暂时取不到，沿用上次同步的结果"));
            continue;
        }
        let models = group_text_models(&catalogs["catalogs"][&group]);
        if models.is_empty() {
            // 没有文字模型的分组（纯图片 / 视频）不需要进 Codex，也不为它建 Key。
            continue;
        }
        // 复用分组自己的可用 Key，没有才创建一把。必须是该分组的 Key（`exact`）：
        // New API 的 auto Key 只能用 auto 覆盖的模型，拿它调其它分组的模型会被平台拒绝。
        let key = match panels::account(
            platform,
            "ensure_group_key",
            "",
            json!({"group_id":group,"name":format!("Codex++ {}", platform.name()),"exact":true}),
        )
        .await
        {
            Ok(key) => key,
            Err(error) => {
                skipped.push(format!("{name}：{error}"));
                continue;
            }
        };
        let Some(id) = key["id"].as_i64() else {
            skipped.push(format!("{name}：无法读取分组 Key"));
            continue;
        };
        let secret = match panels::key_and_models(platform, id).await {
            Ok((secret, _)) => secret,
            Err(error) => {
                skipped.push(format!("{name}：{error}"));
                continue;
            }
        };
        if panels::route(platform).await != route_before {
            return Err("路线已切换，请重新开启".into());
        }
        let input = ProviderInput {
            name: format!("{} {name}", platform.name()),
            base_url: format!("{origin}/v1"),
            protocol: RelayProtocol::Responses,
            keys: vec![secret],
            model: models[0].clone(),
            model_list: models.join("\n"),
            ..Default::default()
        };
        let source = format!("{prefix}{group}");
        kept.push(source.clone());
        let existing = store.load().map_err(text)?.providers.iter().find_map(|p| {
            (p.source == source).then(|| p.relay.id.clone())
        });
        order.push(match existing {
            Some(id) => {
                apply::update_provider(&store, &id, &input).map_err(text)?;
                id
            }
            None => apply::create_provider(&store, &input, &source, None).map_err(text)?.1,
        });
        synced += 1;
        models_total += models.len();
    }
    // 上次同步过、这次已不在（分组下线或不再有文字模型）的上游要清掉，否则换模型会选到无效的 Key。
    if synced > 0 {
        let stale: Vec<String> = store
            .load()
            .map_err(text)?
            .providers
            .iter()
            .filter(|p| p.source.starts_with(&prefix) && !kept.contains(&p.source))
            .map(|p| p.relay.id.clone())
            .collect();
        for id in stale {
            if let Err(error) = apply::delete_provider(&store, &id) {
                skipped.push(format!("{id}：{}", text(error)));
            }
        }
    }
    // 已存在的上游更新后位置不变，这里按本次顺序（auto、default 在前）重排。
    apply::reorder_providers(&store, &order).map_err(text)?;
    if synced == 0 {
        return Err(format!(
            "没有可同步的分组。{}",
            skipped.first().cloned().unwrap_or_default()
        ));
    }
    Ok(json!({"groups":synced,"models":models_total,"skipped":skipped}))
}

/// Codex 绑定里要排除的上游：当前平台同步的分组一律放行，另一个平台同步的分组一律排除
/// （两个平台的同名模型不能混着用）。首次接入时连池里其它供应商也排除，不悄悄带进 Codex；
/// 已接入时保留用户原来对其它供应商的选择。
fn scoped_excludes(
    gateway: &GatewaySettings,
    platform: Platform,
    current: &[String],
    already_enabled: bool,
) -> Vec<String> {
    let ours = source_prefix(platform);
    gateway
        .providers
        .iter()
        .filter(|provider| {
            if provider.source.starts_with(&ours) {
                false
            } else if provider.source.starts_with("fastaiapi:") {
                true
            } else {
                !already_enabled || current.contains(&provider.relay.id)
            }
        })
        .map(|provider| provider.relay.id.clone())
        .collect()
}

fn connect(platform: Platform, preferred: &str) -> Result<(), String> {
    let ctx = context();
    let gateway = ctx.gateway.load().map_err(text)?;
    let mut binding = gateway.binding(&ToolId::Codex).cloned().unwrap_or_default();
    binding.pool_exclude = scoped_excludes(&gateway, platform, &binding.pool_exclude, binding.enabled);
    if !preferred.is_empty() && route::model_is_routable(&gateway, &binding, preferred) {
        binding.model = preferred.to_owned();
    } else if !route::model_is_routable(&gateway, &binding, &binding.model) {
        binding.model = String::new();
    }
    apply::enable_binding(&ctx, &ToolId::Codex, binding).map_err(text)?;
    if crate::commands::sync_resident_helper().is_none() {
        return Err("已写入网关配置，但本地网关没能启动，请查看诊断日志".into());
    }
    Ok(())
}

/// `action`：`status` 查询、`enable` 同步分组 Key 并接入网关、`disable` 断开并恢复直连。
#[tauri::command]
pub async fn fastaiapi_auto_key(
    action: String,
    platform: Option<String>,
    model: Option<String>,
) -> Result<Value, String> {
    let platform = panels::resolve(platform.as_deref())?;
    match action.as_str() {
        "status" => status(platform),
        "enable" => {
            panels::ensure_current(platform).await?;
            let mut result = sync(platform).await?;
            connect(platform, model.as_deref().unwrap_or_default())?;
            remember(platform, true)?;
            result["status"] = status(platform)?;
            Ok(result)
        }
        "disable" => {
            let settings = SettingsStore::default()
                .load()
                .map_err(|_| "无法读取本地配置")?;
            remember(platform, false)?;
            if GatewayStore::default()
                .load()
                .is_ok_and(|gateway| gateway.active_binding(&ToolId::Codex).is_some())
            {
                apply::disable_binding(&context(), &settings, &ToolId::Codex).map_err(text)?;
                // 走网关期间切过线路的话，恢复出来的直连配置还指着旧线路，这里对齐到当前线路。
                super::fastaiapi_commands::update_account_route(
                    platform,
                    panels::origin(platform).await,
                )?;
            }
            status(platform)
        }
        _ => Err("未知操作".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_text_models_follow_the_catalog_and_drop_media_models() {
        let catalog = json!({
            "model_ids": ["gpt-6-sol", "sd-2-c1", "gemini-nano-banana-2.1", "mx-h3", "claude-opus-5"],
            "models": [{"model":"sd-2-c1","kind":"video"},{"model":"gpt-6-sol","kind":"text"}]
        });
        assert_eq!(group_text_models(&catalog), ["claude-opus-5", "gpt-6-sol"]);
        // 没有 model_ids 时退回价格表里的模型名。
        let priced = json!({"models":[{"model":"glm-5.3-flash","kind":"text"},{"model":"gpt-image-2","kind":"image"}]});
        assert_eq!(group_text_models(&priced), ["glm-5.3-flash"]);
        assert!(group_text_models(&Value::Null).is_empty());
    }

    #[test]
    fn binding_only_uses_the_current_platform_groups() {
        let provider = |source: &str, id: &str| {
            let relay = codex_plus_core::settings::RelayProfile {
                id: id.into(),
                ..Default::default()
            };
            json!({"source":source,"relay":relay})
        };
        let gateway: GatewaySettings = serde_json::from_value(json!({"providers":[
            provider("fastaiapi:newapi:auto", "tumei-auto"),
            provider("fastaiapi:subapi:2", "fast-gpt"),
            provider("codex:x", "other"),
            provider("", "mine"),
        ]}))
        .unwrap();
        // 首次接入：只留当前平台。
        assert_eq!(
            scoped_excludes(&gateway, Platform::SubApi, &[], false),
            ["tumei-auto", "other", "mine"]
        );
        // 池里有另一个平台的分组但被绑定排除时，不算那个平台「已开启」。
        let mut bound = gateway.clone();
        bound.bindings.insert(
            "codex".into(),
            codex_plus_core::gateway::store::AgentBinding {
                enabled: true,
                pool_exclude: vec!["tumei-auto".into()],
                ..Default::default()
            },
        );
        assert!(in_use_ids(&bound, Platform::NewApi).is_empty());
        assert_eq!(in_use_ids(&bound, Platform::SubApi), ["fast-gpt"]);
        // 已接入后换平台：另一个平台的分组排除，用户原来放行的供应商继续放行。
        assert_eq!(
            scoped_excludes(&gateway, Platform::NewApi, &["tumei-auto".into(), "other".into()], true),
            ["fast-gpt", "other"]
        );
    }
}
