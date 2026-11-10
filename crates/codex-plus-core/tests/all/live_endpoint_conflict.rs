//! issue #2666：切换时实时配置的 endpoint 被外部改过，回填停下后要能显式选择
//! 「导入为新供应商」或「放弃实时改动」继续切换，而不是只给一句报错把人卡住。
use codex_plus_core::relay_config::relay_profile_api_key;
use codex_plus_core::relay_switch::{
    LiveConflictResolution, LiveEndpointConflict, switch_relay_profile_in_home_resolving_conflict,
};
use codex_plus_core::settings::{BackendSettings, RelayMode, RelayProfile, SettingsStore};

const EXTERNAL_URL: &str = "https://external.example/v1";

#[test]
fn saved_official_account_is_not_backfilled_into_stale_api_profile() {
    let (_temp, store, home, mut next) = fixture();
    let live_auth = r#"{"auth_mode":"chatgpt","tokens":{"account_id":"saved-official-account","access_token":"fixture-access"}}"#;
    std::fs::write(home.join("config.toml"), "model = \"gpt-test\"\n").unwrap();
    std::fs::write(home.join("auth.json"), live_auth).unwrap();
    next.relay_profiles.push(RelayProfile {
        id: "official".into(),
        relay_mode: RelayMode::Official,
        official_mix_api_key: false,
        auth_contents: live_auth.into(),
        ..RelayProfile::default()
    });
    let original_api = profile(&next, "a").clone();
    let result = switch_relay_profile_in_home_resolving_conflict(
        &store,
        &home,
        next,
        "a",
        LiveConflictResolution::Stop,
    )
    .expect("已保存的官方账号应识别为另一供应商，而不是报缺少 endpoint");
    let previous = profile(&result.0.settings, "a");
    assert_eq!(
        relay_profile_api_key(previous),
        relay_profile_api_key(&original_api)
    );
    assert_eq!(
        codex_plus_core::relay_config::relay_profile_base_url(previous),
        "https://a.example/v1"
    );
    assert_eq!(previous.model, original_api.model);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(
            &profile(&result.0.settings, "official").auth_contents
        ).unwrap(),
        serde_json::from_str::<serde_json::Value>(live_auth).unwrap()
    );
    assert!(
        std::fs::read_to_string(home.join("config.toml"))
            .unwrap().contains("https://b.example/v1")
    );
    assert!(result.0.backup_path.is_some(), "切换仍应保留实时文件备份");
    assert_eq!(
        std::fs::read_to_string(
            std::path::Path::new(result.0.backup_path.as_ref().unwrap()).join("auth.json")
        ).unwrap(),
        live_auth
    );
}

#[test]
fn unknown_or_mixed_official_account_keeps_missing_endpoint_protection() {
    for auth in [
        r#"{"auth_mode":"chatgpt","tokens":{"account_id":"unknown-account","access_token":"fixture"}}"#,
        r#"{"auth_mode":"chatgpt","OPENAI_API_KEY":"fixture-api","tokens":{"account_id":"saved-account","access_token":"fixture"}}"#,
    ] {
        let (_temp, store, home, mut next) = fixture();
        std::fs::write(home.join("config.toml"), "model = \"gpt-test\"\n").unwrap();
        std::fs::write(home.join("auth.json"), auth).unwrap();
        next.relay_profiles.push(RelayProfile {
            id: "official".into(),
            relay_mode: RelayMode::Official,
            auth_contents: r#"{"auth_mode":"chatgpt","tokens":{"account_id":"saved-account","access_token":"fixture"}}"#.into(),
            ..RelayProfile::default()
        });
        assert!(
            switch_relay_profile_in_home_resolving_conflict(
                &store, &home, next, "a", LiveConflictResolution::Stop,
            ).is_err()
        );
        assert_eq!(std::fs::read_to_string(home.join("auth.json")).unwrap(), auth);
        assert_eq!(store.load().unwrap().active_relay_id, "a");
    }
}

fn pure_profile(id: &str, base_url: &str, key: &str) -> RelayProfile {
    RelayProfile {
        id: id.to_string(),
        name: id.to_uppercase(),
        relay_mode: RelayMode::PureApi,
        config_contents: format!(
            r#"model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "{base_url}"
"#
        ),
        auth_contents: format!(r#"{{"OPENAI_API_KEY":"{key}"}}"#),
        ..RelayProfile::default()
    }
}

/// 已保存 A、B 两个供应商，当前是 A；实时文件被外部工具改成了另一个地址和 Key。
fn fixture() -> (tempfile::TempDir, SettingsStore, std::path::PathBuf, BackendSettings) {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("codex");
    std::fs::create_dir(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        format!(
            r#"model_provider = "custom"

[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "{EXTERNAL_URL}"
"#
        ),
    )
    .unwrap();
    std::fs::write(home.join("auth.json"), r#"{"OPENAI_API_KEY":"sk-external"}"#).unwrap();
    let store = SettingsStore::new(temp.path().join("settings.json"));
    let original = BackendSettings {
        active_relay_id: "a".to_string(),
        relay_profiles: vec![
            pure_profile("a", "https://a.example/v1", "sk-a"),
            pure_profile("b", "https://b.example/v1", "sk-b"),
        ],
        ..BackendSettings::default()
    };
    store.save(&original).unwrap();
    let mut next = BackendSettings {
        active_relay_id: "b".to_string(),
        relay_profiles: original.relay_profiles.clone(),
        ..BackendSettings::default()
    };
    next.settings_revision = store.revision().unwrap();
    (temp, store, home, next)
}

fn profile<'a>(settings: &'a BackendSettings, id: &str) -> &'a RelayProfile {
    settings.relay_profiles.iter().find(|profile| profile.id == id).unwrap()
}

#[test]
fn default_resolution_stops_with_typed_conflict_and_touches_nothing() {
    let (_temp, store, home, next) = fixture();
    let live_before = std::fs::read_to_string(home.join("config.toml")).unwrap();

    let error = switch_relay_profile_in_home_resolving_conflict(
        &store,
        &home,
        next,
        "a",
        LiveConflictResolution::Stop,
    )
    .expect_err("endpoint 被外部改过时默认必须停下");

    let conflict = error
        .downcast_ref::<LiveEndpointConflict>()
        .expect("管理器要靠这个类型弹窗，不能退化成纯文本错误");
    assert_eq!(conflict.profile_id, "a");
    assert!(conflict.message.contains("回填当前供应商配置失败（供应商：a）"), "{}", conflict.message);
    assert!(conflict.message.contains("endpoint 已改变"), "{}", conflict.message);
    let stored = store.load().unwrap();
    assert_eq!(stored.active_relay_id, "a");
    assert_eq!(stored.relay_profiles.len(), 2);
    assert_eq!(std::fs::read_to_string(home.join("config.toml")).unwrap(), live_before);
}

#[test]
fn import_resolution_saves_live_as_new_profile_and_keeps_previous_snapshot() {
    let (_temp, store, home, next) = fixture();

    let (result, outcome) = switch_relay_profile_in_home_resolving_conflict(
        &store,
        &home,
        next,
        "a",
        LiveConflictResolution::ImportAsNewProfile,
    )
    .expect("选择导入后应完成切换");

    let imported_id = outcome.imported_profile_id.expect("要返回新供应商 id");
    assert!(outcome.live_backup_path.is_none());
    let stored = store.load().unwrap();
    assert_eq!(stored.active_relay_id, "b");
    assert_eq!(result.settings.active_relay_id, "b");
    assert_eq!(stored.relay_profiles.len(), 3);
    let imported = profile(&stored, &imported_id);
    assert_eq!(imported.name, "A（实时配置）");
    assert_eq!(imported.relay_mode, RelayMode::PureApi);
    assert!(imported.config_contents.contains(EXTERNAL_URL), "{}", imported.config_contents);
    assert_eq!(relay_profile_api_key(imported), "sk-external");
    let previous = profile(&stored, "a");
    assert!(previous.config_contents.contains("https://a.example/v1"));
    assert!(!previous.config_contents.contains(EXTERNAL_URL));
    assert_eq!(relay_profile_api_key(previous), "sk-a");
    let live = std::fs::read_to_string(home.join("config.toml")).unwrap();
    assert!(live.contains("https://b.example/v1"), "{live}");
}

#[test]
fn discard_resolution_backs_up_live_files_and_keeps_previous_snapshot() {
    let (_temp, store, home, next) = fixture();

    let (_, outcome) = switch_relay_profile_in_home_resolving_conflict(
        &store,
        &home,
        next,
        "a",
        LiveConflictResolution::DiscardLiveChanges,
    )
    .expect("选择放弃后应完成切换");

    assert!(outcome.imported_profile_id.is_none());
    let backup = std::path::PathBuf::from(outcome.live_backup_path.expect("放弃前必须先备份"));
    assert!(
        std::fs::read_to_string(backup.join("config.toml")).unwrap().contains(EXTERNAL_URL),
        "备份里要有被放弃的实时配置"
    );
    assert_eq!(
        std::fs::read_to_string(backup.join("auth.json")).unwrap(),
        r#"{"OPENAI_API_KEY":"sk-external"}"#
    );
    let stored = store.load().unwrap();
    assert_eq!(stored.active_relay_id, "b");
    assert_eq!(stored.relay_profiles.len(), 2, "放弃不应新增供应商");
    let previous = profile(&stored, "a");
    assert!(previous.config_contents.contains("https://a.example/v1"));
    assert_eq!(relay_profile_api_key(previous), "sk-a");
    let live = std::fs::read_to_string(home.join("config.toml")).unwrap();
    assert!(live.contains("https://b.example/v1"), "{live}");
}

#[test]
fn resolution_wire_names_match_manager_frontend() {
    // 前端 LiveConflictResolution 直接发这两个字面量；字段缺省必须等于照旧停下。
    let parse = |value: &str| serde_json::from_value::<LiveConflictResolution>(serde_json::json!(value)).unwrap();
    assert_eq!(parse("importAsNewProfile"), LiveConflictResolution::ImportAsNewProfile);
    assert_eq!(parse("discardLiveChanges"), LiveConflictResolution::DiscardLiveChanges);
    assert_eq!(parse("stop"), LiveConflictResolution::Stop);
    assert_eq!(LiveConflictResolution::default(), LiveConflictResolution::Stop);
}
