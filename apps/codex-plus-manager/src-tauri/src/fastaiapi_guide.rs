use serde::Deserialize;
use tauri::{
    LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
    webview::{NewWindowResponse, WebviewBuilder},
};

const LABEL: &str = "fastaiapi-guide";
const URL: &str = "https://tumeiapi.com/hub/home/help/image-api/";

#[derive(Deserialize)]
pub struct GuideBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn is_guide_page(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("tumeiapi.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/hub/home/help/")
}

#[tauri::command]
pub async fn fastaiapi_guide(
    webview: Webview,
    bounds: Option<GuideBounds>,
    close: Option<bool>,
    refresh: Option<bool>,
) -> Result<(), String> {
    if webview.label() != crate::MAIN_WINDOW_LABEL {
        return Err("仅主页面可打开使用教程".into());
    }

    let existing = webview.app_handle().get_webview(LABEL);
    if close == Some(true) {
        return existing.map_or(Ok(()), |guide| {
            guide.close().map_err(|error| error.to_string())
        });
    }
    let Some(bounds) = bounds else {
        return existing.map_or(Ok(()), |guide| {
            guide.hide().map_err(|error| error.to_string())
        });
    };
    if ![bounds.x, bounds.y, bounds.width, bounds.height]
        .into_iter()
        .all(f64::is_finite)
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width < 1.0
        || bounds.height < 1.0
    {
        return Err("教程显示区域无效".into());
    }

    let position = LogicalPosition::new(bounds.x, bounds.y);
    let size = LogicalSize::new(bounds.width, bounds.height);
    let update = || -> tauri::Result<()> {
        if let Some(guide) = existing {
            guide.set_bounds(Rect {
                position: position.into(),
                size: size.into(),
            })?;
            guide.show()?;
            if refresh == Some(true) {
                guide.reload()?;
            }
        } else {
            // 教程使用独立的顶层 WebView，遵守站点的 SAMEORIGIN 策略。
            // capabilities 不授予此远程来源任何 IPC 权限。
            let url = URL.parse().expect("invalid built-in tutorial URL");
            let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
                .incognito(true)
                .on_navigation(is_guide_page)
                .on_new_window(|_, _| NewWindowResponse::Deny);
            webview.window().add_child(builder, position, size)?;
        }
        Ok(())
    };
    update().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tutorial_navigation_only_allows_https_help_pages() {
        assert!(is_guide_page(&URL.parse().unwrap()));
        for url in [
            "https://tumeiapi.com/hub/home/help/codex/#start",
            "https://tumeiapi.com/hub/home/help/",
        ] {
            assert!(is_guide_page(&url.parse().unwrap()));
        }
        for url in [
            "http://tumeiapi.com/hub/home/help/image-api/",
            "https://tumeiapi.com:8443/hub/home/help/image-api/",
            "https://tumeiapi.com.attacker.test/hub/home/help/image-api/",
            "https://tumeiapi.com/api/",
            "tauri://localhost/index.html",
        ] {
            assert!(!is_guide_page(&url.parse().unwrap()));
        }
    }
}
