//! An in-app browser drawn as a native child view over a placeholder in the
//! workspace. It is a plain Wry webview rather than a Tauri webview, so pages
//! get no Tauri IPC, initialization scripts or app protocols, and existing
//! `WebviewWindow` handling stays valid for windows that host one.

use std::{cell::RefCell, collections::HashMap};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, Url, WebviewWindow};
use wry::{
    dpi::{PhysicalPosition, PhysicalSize},
    NewWindowResponse, PageLoadEvent, Rect, WebView, WebViewBuilder,
};

const EVENT: &str = "inline-browser";

/// Stable id for the browser's WKWebsiteDataStore, so its cookies and storage
/// persist apart from the app UI's default store (macOS 14+; older systems
/// fall back to the default store).
#[cfg(target_os = "macos")]
const DATA_STORE_ID: [u8; 16] = *b"monocode-browser";

thread_local! {
    // Wry views must be created, used and dropped on the main thread.
    static VIEWS: RefCell<HashMap<(String, String), WebView>> = RefCell::default();
    #[cfg(not(target_os = "macos"))]
    static CONTEXT: RefCell<Option<wry::WebContext>> = const { RefCell::new(None) };
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserEvent {
    id: String,
    kind: &'static str,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    /// `window.innerWidth`, so CSS pixels convert with the app's UI zoom.
    viewport_width: f64,
}

impl BrowserBounds {
    fn physical(&self, window_width: u32, window_height: u32) -> Result<Rect, String> {
        if ![self.x, self.y, self.width, self.height, self.viewport_width]
            .iter()
            .all(|n| n.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.viewport_width <= 0.0
        {
            return Err("Invalid browser bounds".into());
        }
        let (max_w, max_h) = (f64::from(window_width), f64::from(window_height));
        let scale = max_w / self.viewport_width;
        let x = (self.x * scale).min(max_w);
        let y = (self.y * scale).min(max_h);
        Ok(Rect {
            position: PhysicalPosition::new(x, y).into(),
            size: PhysicalSize::new(
                (self.width * scale).min(max_w - x),
                (self.height * scale).min(max_h - y),
            )
            .into(),
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserAction {
    Navigate(String),
    Back,
    Forward,
    Reload,
}

/// Tauri serves the app and its custom protocols from `*.localhost` hosts on
/// Windows and Linux.
fn is_app_host(host: &str) -> bool {
    host.ends_with(".localhost")
}

/// Addresses the user or a page may open as the top-level document.
fn allowed_url(value: &str, app_origin: Option<&Url>) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Enter an HTTP or HTTPS address")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Only HTTP and HTTPS addresses can be opened".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Addresses with credentials can't be opened".into());
    }
    if url.host_str().is_some_and(is_app_host)
        || app_origin.is_some_and(|origin| origin.origin() == url.origin())
    {
        return Err("MonoCode's own pages can't be opened in the browser".into());
    }
    Ok(url)
}

/// Navigations a loaded page may start, including subframes.
fn allowed_navigation(value: &str, app_origin: Option<&Url>) -> bool {
    match Url::parse(value) {
        Ok(url) if matches!(url.scheme(), "about" | "data" | "blob") => true,
        _ => allowed_url(value, app_origin).is_ok(),
    }
}

fn window_size(window: &WebviewWindow) -> Result<(u32, u32), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;
    Ok((size.width, size.height))
}

async fn on_main<T: Send + 'static>(
    window: WebviewWindow,
    task: impl FnOnce(WebviewWindow) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let owner = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(task(owner));
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?
}

fn emit(window: &WebviewWindow, id: &str, kind: &'static str, url: String) {
    let _ = window.emit_to(
        window.label(),
        EVENT,
        BrowserEvent {
            id: id.to_string(),
            kind,
            url,
        },
    );
}

fn configure<'a>(
    builder: WebViewBuilder<'a>,
    window: &WebviewWindow,
    id: &str,
    url: &Url,
    rect: Rect,
    app_origin: Option<Url>,
) -> WebViewBuilder<'a> {
    let nav = (window.clone(), id.to_string(), app_origin.clone());
    let load = (window.clone(), id.to_string());
    let title = (window.clone(), id.to_string());
    let popup = (window.clone(), id.to_string(), app_origin);
    let download = (window.clone(), id.to_string());
    builder
        .with_url(url.as_str())
        .with_bounds(rect)
        .with_focused(false)
        .with_navigation_handler(move |value| {
            let allowed = allowed_navigation(&value, nav.2.as_ref());
            if !allowed {
                emit(&nav.0, &nav.1, "blocked", value);
            }
            allowed
        })
        .with_on_page_load_handler(move |event, url| {
            let kind = match event {
                PageLoadEvent::Started => "loading",
                PageLoadEvent::Finished => "loaded",
            };
            emit(&load.0, &load.1, kind, url);
        })
        .with_document_title_changed_handler(move |value| {
            emit(&title.0, &title.1, "title", value);
        })
        // New windows open in the same view; the panel navigates to them.
        .with_new_window_req_handler(move |value, _| {
            if allowed_url(&value, popup.2.as_ref()).is_ok() {
                emit(&popup.0, &popup.1, "popup", value);
            }
            NewWindowResponse::Deny
        })
        .with_download_started_handler(move |value, _| {
            emit(&download.0, &download.1, "download", value);
            false
        })
}

#[cfg(target_os = "macos")]
fn build_view(
    window: &WebviewWindow,
    id: &str,
    url: &Url,
    rect: Rect,
    app_origin: Option<Url>,
) -> Result<WebView, String> {
    use wry::WebViewBuilderExtDarwin;
    configure(WebViewBuilder::new(), window, id, url, rect, app_origin)
        .with_data_store_identifier(DATA_STORE_ID)
        .build_as_child(window)
        .map_err(|e| e.to_string())
}

/// Linux supports child views on X11 only; Wayland sessions get an error.
#[cfg(not(target_os = "macos"))]
fn build_view(
    window: &WebviewWindow,
    id: &str,
    url: &Url,
    rect: Rect,
    app_origin: Option<Url>,
) -> Result<WebView, String> {
    let data_dir = window
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("browser");
    CONTEXT.with(|context| {
        let mut context = context.borrow_mut();
        let context = context.get_or_insert_with(|| wry::WebContext::new(Some(data_dir)));
        configure(
            WebViewBuilder::new_with_web_context(context),
            window,
            id,
            url,
            rect,
            app_origin,
        )
        .build_as_child(window)
        .map_err(|e| e.to_string())
    })
}

/// Show the browser at `url`, creating its view on first use.
#[tauri::command]
pub async fn browser_open(
    window: WebviewWindow,
    id: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    on_main(window, move |window| {
        let app_origin = window.config().build.dev_url.clone();
        let url = allowed_url(&url, app_origin.as_ref())?;
        let (width, height) = window_size(&window)?;
        let rect = bounds.physical(width, height)?;
        let key = (window.label().to_string(), id.clone());
        VIEWS.with(|views| {
            if let Some(view) = views.borrow().get(&key) {
                view.set_bounds(rect).map_err(|e| e.to_string())?;
                view.set_visible(true).map_err(|e| e.to_string())?;
                return view.load_url(url.as_str()).map_err(|e| e.to_string());
            }
            let view = build_view(&window, &id, &url, rect, app_origin)?;
            views.borrow_mut().insert(key, view);
            Ok(())
        })
    })
    .await
}

/// Move the view over its placeholder, or hide it when `bounds` is absent.
#[tauri::command]
pub async fn browser_set_bounds(
    window: WebviewWindow,
    id: String,
    bounds: Option<BrowserBounds>,
) -> Result<(), String> {
    on_main(window, move |window| {
        let size = window_size(&window)?;
        VIEWS.with(|views| {
            let views = views.borrow();
            let Some(view) = views.get(&(window.label().to_string(), id)) else {
                return Ok(());
            };
            match bounds {
                Some(bounds) => {
                    view.set_bounds(bounds.physical(size.0, size.1)?)
                        .map_err(|e| e.to_string())?;
                    view.set_visible(true).map_err(|e| e.to_string())
                }
                None => view.set_visible(false).map_err(|e| e.to_string()),
            }
        })
    })
    .await
}

#[tauri::command]
pub async fn browser_action(
    window: WebviewWindow,
    id: String,
    action: BrowserAction,
) -> Result<(), String> {
    on_main(window, move |window| {
        VIEWS.with(|views| {
            let views = views.borrow();
            let view = views
                .get(&(window.label().to_string(), id))
                .ok_or("The browser is closed")?;
            let result = match action {
                BrowserAction::Navigate(value) => {
                    let url = allowed_url(&value, window.config().build.dev_url.as_ref())?;
                    view.load_url(url.as_str())
                }
                BrowserAction::Back => view.evaluate_script("history.back()"),
                BrowserAction::Forward => view.evaluate_script("history.forward()"),
                BrowserAction::Reload => view.reload(),
            };
            result.map_err(|e| e.to_string())
        })
    })
    .await
}

#[tauri::command]
pub async fn browser_close(window: WebviewWindow, id: String) -> Result<(), String> {
    on_main(window, move |window| {
        VIEWS.with(|views| views.borrow_mut().remove(&(window.label().to_string(), id)));
        Ok(())
    })
    .await
}

/// Drop a closed window's views. Runs on the main thread from the event loop.
pub fn window_closed(label: &str) {
    VIEWS.with(|views| views.borrow_mut().retain(|(owner, _), _| owner != label));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_web_addresses_outside_the_app() {
        let app = Url::parse("http://localhost:1420").unwrap();
        for value in [
            "https://example.com",
            "http://localhost:3000",
            "http://127.0.0.1:8080/a",
            "http://[::1]:5173/a",
        ] {
            assert!(allowed_url(value, Some(&app)).is_ok(), "{value}");
        }
        for value in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tauri://localhost",
            "https://tauri.localhost",
            "http://asset.localhost/a",
            "http://ipc.localhost/cmd",
            "http://localhost:1420/app",
            "https://user:pass@example.com",
            "data:text/html,hi",
            "about:blank",
            "not a url",
        ] {
            assert!(allowed_url(value, Some(&app)).is_err(), "{value}");
        }
    }

    #[test]
    fn pages_may_load_inline_documents_but_not_app_or_file_urls() {
        let app = Url::parse("http://localhost:1420").unwrap();
        for value in [
            "about:blank",
            "about:srcdoc",
            "data:text/html,hi",
            "https://a.test",
        ] {
            assert!(allowed_navigation(value, Some(&app)), "{value}");
        }
        for value in [
            "file:///etc/passwd",
            "tauri://localhost",
            "http://localhost:1420/",
            "monoartifact://x",
        ] {
            assert!(!allowed_navigation(value, Some(&app)), "{value}");
        }
    }

    #[test]
    fn bounds_scale_with_ui_zoom_and_stay_inside_the_window() {
        let bounds = BrowserBounds {
            x: 100.0,
            y: 50.0,
            width: 2000.0,
            height: 300.0,
            viewport_width: 1000.0,
        };
        let rect = bounds.physical(2000, 1200).unwrap();
        let wry::dpi::Position::Physical(position) = rect.position else {
            panic!("physical position");
        };
        let wry::dpi::Size::Physical(size) = rect.size else {
            panic!("physical size");
        };
        assert_eq!((position.x, position.y), (200, 100));
        assert_eq!((size.width, size.height), (1800, 600));

        let empty = BrowserBounds {
            width: 0.0,
            ..bounds
        };
        assert!(empty.physical(2000, 1200).is_err());
    }
}
