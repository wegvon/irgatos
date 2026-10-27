//! `browser.*` app actions: let the agent of any turn running in Irgatos see
//! and use the window's in-app browser, the same one the user has beside the
//! chat. Page work (read, click, type, scroll, eval, screenshot) runs here on
//! the active view, in an isolated script world page scripts can't reach.
//! What the browser panel owns (opening a page, its tabs, whether it is shown)
//! is relayed to the window's UI, which answers with `browser_agent_reply`.
//!
//! Everything a page returns is untrusted: replies are size-bounded and parsed
//! strictly, and the usage text tells the agent page text is data.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, SystemTime},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::browser::{on_main, VIEWS};
use crate::browser_picker::{encode_png, platform, shrink};

const AGENT_JS: &str = include_str!("browser_agent.js");
const REQUEST_EVENT: &str = "browser-agent-request";
/// Tells the window's UI an agent is using its Browser, so the user can watch.
const ACTING_EVENT: &str = "browser-agent-acting";
const TAKEN_OVER: &str = "The user took over the Browser and is using it now. Wait until they hand it back, or ask them in the chat; don't retry in a loop.";
/// The view the panel draws until the UI names another (a tab).
const DEFAULT_VIEW: &str = "main";
const PAGE_TIMEOUT: Duration = Duration::from_secs(10);
const RELAY_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a click or submit gets to start a navigation before we report.
const SETTLE: Duration = Duration::from_millis(800);
const MAX_REPLY_BYTES: usize = 512 * 1024;
const MAX_SCRIPT_BYTES: usize = 32 * 1024;
const SCREENSHOT_EDGE: u32 = 1600;
const NO_PAGE: &str = "The Browser has no page open. Open one with browser.open {\"url\":\"...\"}.";

pub const AGENT_ACTIONS: [&str; 13] = [
    "browser.state",
    "browser.read",
    "browser.open",
    "browser.back",
    "browser.forward",
    "browser.reload",
    "browser.click",
    "browser.type",
    "browser.scroll",
    "browser.eval",
    "browser.screenshot",
    "browser.tabs",
    "browser.tab",
];

type ViewKey = (String, String);

thread_local! {
    // The agent's script world per view, kept alive so refs from browser.read
    // survive until the page navigates.
    static WORLDS: RefCell<HashMap<ViewKey, Rc<platform::World>>> = RefCell::default();
}

/// Window label -> the view id of its active browser tab.
fn active_views() -> &'static Mutex<HashMap<String, String>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    ACTIVE.get_or_init(Default::default)
}

/// Windows whose user took the Browser over: agents' actions are refused.
fn held() -> &'static Mutex<HashSet<String>> {
    static HELD: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    HELD.get_or_init(Default::default)
}

fn is_held(window: &str) -> bool {
    held().lock().map(|set| set.contains(window)).unwrap_or(true)
}

/// The user takes the window's Browser over from agents, or hands it back.
#[tauri::command]
pub fn browser_set_agent_hold(window: WebviewWindow, held_now: bool) -> Result<(), String> {
    let mut set = held().lock().map_err(|_| "Browser unavailable")?;
    if held_now {
        set.insert(window.label().to_string());
    } else {
        set.remove(window.label());
    }
    Ok(())
}

type Reply = mpsc::Sender<Result<Value, String>>;

fn pending() -> &'static Mutex<HashMap<String, Reply>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Reply>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn active_view(window: &str) -> String {
    active_views()
        .lock()
        .ok()
        .and_then(|views| views.get(window).cloned())
        .unwrap_or_else(|| DEFAULT_VIEW.into())
}

/// The UI names the native view that agents act on, e.g. after a tab switch.
#[tauri::command]
pub fn browser_set_agent_view(window: WebviewWindow, id: String) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 {
        return Err("Invalid browser view".into());
    }
    active_views()
        .lock()
        .map_err(|_| "Browser unavailable")?
        .insert(window.label().to_string(), id);
    Ok(())
}

/// The UI's answer to a relayed action.
#[tauri::command]
pub fn browser_agent_reply(id: String, result: Option<Value>, error: Option<String>) {
    let reply = pending().lock().ok().and_then(|mut map| map.remove(&id));
    if let Some(reply) = reply {
        let _ = reply.send(match error {
            Some(error) => Err(error),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
}

/// A short read of the active page for the app's own context hint.
#[tauri::command]
pub async fn browser_page_excerpt(
    window: WebviewWindow,
    max_chars: usize,
) -> Result<Value, String> {
    let max = max_chars.clamp(200, 6000);
    run_page(
        window,
        format!("read({})", json!({ "maxChars": max, "elements": false })),
    )
    .await
}

/// Drop a closed window's agent state. Runs on the main thread.
pub fn window_closed(label: &str) {
    WORLDS.with(|worlds| worlds.borrow_mut().retain(|(owner, _), _| owner != label));
    if let Ok(mut views) = active_views().lock() {
        views.remove(label);
    }
    if let Ok(mut set) = held().lock() {
        set.remove(label);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActingNotice {
    session_id: String,
    action: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayRequest {
    id: String,
    action: String,
    input: Value,
}

/// How long `browser.eval` stays off in a window after a vault login was
/// filled there, so the agent cannot read the field back.
const EVAL_PAUSE: Duration = Duration::from_secs(120);

fn eval_paused() -> &'static Mutex<HashMap<String, SystemTime>> {
    static PAUSED: OnceLock<Mutex<HashMap<String, SystemTime>>> = OnceLock::new();
    PAUSED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Fills a vault login into the active page of the window's Browser, for
/// `secrets.login`. The page script checks the host itself, at fill time.
pub fn fill_login(
    app: &AppHandle,
    window_label: &str,
    username: &str,
    password: &str,
    hosts: &[String],
    submit: bool,
) -> Result<Value, String> {
    let window = app
        .get_webview_window(window_label)
        .ok_or("The Irgatos window for this chat is closed")?;
    if is_held(window_label) {
        return Err(TAKEN_OVER.into());
    }
    let call = format!(
        "fillLogin({}, {}, {}, {})",
        json!(username),
        json!(password),
        json!(hosts),
        json!({ "submit": submit })
    );
    if let Ok(mut paused) = eval_paused().lock() {
        paused.insert(window_label.to_string(), SystemTime::now());
    }
    tauri::async_runtime::block_on(async move {
        let result = run_page(window.clone(), call).await?;
        if submit {
            settled(window, result).await
        } else {
            Ok(result)
        }
    })
}

/// The active page's address, for checking where a login would go.
pub fn page_url(app: &AppHandle, window_label: &str) -> Result<String, String> {
    let window = app
        .get_webview_window(window_label)
        .ok_or("The Irgatos window for this chat is closed")?;
    if is_held(window_label) {
        return Err(TAKEN_OVER.into());
    }
    let page = tauri::async_runtime::block_on(run_page(window, "page()".into()))?;
    page.get("url")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| NO_PAGE.to_string())
}

fn eval_pause_left(window_label: &str) -> Option<Duration> {
    let paused = eval_paused().lock().ok()?;
    let since = paused.get(window_label)?.elapsed().ok()?;
    EVAL_PAUSE.checked_sub(since).filter(|left| !left.is_zero())
}

pub fn agent_action(
    app: &AppHandle,
    session: &str,
    window_label: &str,
    action: &str,
    input: &Value,
) -> Result<Value, String> {
    let window = app
        .get_webview_window(window_label)
        .ok_or("The Irgatos window for this chat is closed")?;
    if is_held(window_label) {
        return Err(TAKEN_OVER.into());
    }
    let notice = ActingNotice {
        session_id: session.into(),
        action: action.into(),
    };
    let _ = window.emit_to(window_label, ACTING_EVENT, notice);
    tauri::async_runtime::block_on(dispatch(window, action, input))
}

async fn dispatch(window: WebviewWindow, action: &str, input: &Value) -> Result<Value, String> {
    let field = |key: &str| input.get(key).cloned().unwrap_or(Value::Null);
    match action {
        "browser.state" | "browser.open" | "browser.tabs" | "browser.tab" => {
            relay(&window, action, input)
        }
        "browser.read" => {
            let options = json!({
                "offset": field("offset"),
                "maxChars": field("maxChars"),
                "elements": input.get("elements").and_then(Value::as_bool).unwrap_or(true),
            });
            run_page(window, format!("read({options})")).await
        }
        "browser.click" => {
            let target = target_of(input)?;
            let result = run_page(window.clone(), format!("click({target})")).await?;
            settled(window, result).await
        }
        "browser.type" => {
            let target = target_of(input)?;
            let text = input
                .get("text")
                .and_then(Value::as_str)
                .ok_or("browser.type takes {\"ref\":3,\"text\":\"...\",\"submit\":false}")?;
            let options = json!({
                "submit": input.get("submit").and_then(Value::as_bool).unwrap_or(false),
                "clear": input.get("clear").and_then(Value::as_bool).unwrap_or(true),
            });
            let call = format!("type({target}, {}, {options})", json!(text));
            let result = run_page(window.clone(), call).await?;
            settled(window, result).await
        }
        "browser.scroll" => {
            let options = json!({
                "direction": field("direction"),
                "amount": field("amount"),
                "ref": field("ref"),
                "selector": field("selector"),
                "text": field("text"),
            });
            run_page(window, format!("scroll({options})")).await
        }
        "browser.eval" => {
            if let Some(left) = eval_pause_left(window.label()) {
                return Err(format!(
                    "browser.eval is paused for {} s: a password from the vault was just filled in this Browser. Use browser.read, click and type meanwhile.",
                    left.as_secs().max(1)
                ));
            }
            let script = input
                .get("script")
                .and_then(Value::as_str)
                .filter(|script| !script.trim().is_empty())
                .ok_or("browser.eval takes {\"script\":\"return document.title\"}")?;
            if script.len() > MAX_SCRIPT_BYTES {
                return Err("Scripts are limited to 32 KiB".into());
            }
            run_page(window, format!("evaluate(() => {{\n{script}\n}})")).await
        }
        "browser.screenshot" => screenshot(window).await,
        "browser.back" | "browser.forward" | "browser.reload" => {
            let script = match action {
                "browser.back" => "history.back()",
                "browser.forward" => "history.forward()",
                _ => "location.reload()",
            };
            on_main(window.clone(), move |window| {
                with_active_view(&window, |view| {
                    view.evaluate_script(script).map_err(|e| e.to_string())
                })
            })
            .await?;
            settled(window, json!({})).await
        }
        _ => Err(format!("Unknown browser action {action}")),
    }
}

/// `ref`, `selector` or `text` from the input, as the page script's target.
fn target_of(input: &Value) -> Result<Value, String> {
    let mut target = serde_json::Map::new();
    for key in ["ref", "selector", "text"] {
        if let Some(value) = input.get(key).filter(|v| !v.is_null()) {
            target.insert(key.into(), value.clone());
            break;
        }
    }
    if target.is_empty() {
        return Err("Give the element as ref (from browser.read), selector or text".into());
    }
    Ok(Value::Object(target))
}

/// Give a click or submit time to navigate, then report where the page is.
async fn settled(window: WebviewWindow, mut result: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| std::thread::sleep(SETTLE))
        .await
        .map_err(|e| e.to_string())?;
    // A page mid-navigation may not answer yet; the action itself succeeded.
    if let Ok(page) = run_page(window, "page()".into()).await {
        if let (Some(out), Some(page)) = (result.as_object_mut(), page.as_object()) {
            out.extend(page.clone());
        }
    }
    Ok(result)
}

fn with_active_view<T>(
    window: &WebviewWindow,
    task: impl FnOnce(&wry::WebView) -> Result<T, String>,
) -> Result<T, String> {
    let key = (window.label().to_string(), active_view(window.label()));
    VIEWS.with(|views| task(views.borrow().get(&key).ok_or(NO_PAGE)?))
}

/// Call `__irgatAgent.<call>` in the active view and unwrap its reply.
async fn run_page(window: WebviewWindow, call: String) -> Result<Value, String> {
    let rx = on_main(window, move |window| {
        let key = (window.label().to_string(), active_view(window.label()));
        let (tx, rx) = mpsc::channel();
        VIEWS.with(|views| {
            let views = views.borrow();
            let view = views.get(&key).ok_or(NO_PAGE)?;
            let world = WORLDS.with(|worlds| -> Result<_, String> {
                let mut worlds = worlds.borrow_mut();
                if let Some(world) = worlds.get(&key) {
                    return Ok(world.clone());
                }
                let world = Rc::new(platform::World::new(view)?);
                worlds.insert(key.clone(), world.clone());
                Ok(world)
            })?;
            let script = format!("{AGENT_JS}\n;globalThis.__irgatAgent.{call}");
            world.evaluate(view, &script, move |raw| {
                let _ = tx.send(raw);
            })
        })?;
        Ok(rx)
    })
    .await?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(PAGE_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "The page didn't respond. It may still be loading; try again.".to_string())?
        .ok_or("The page didn't answer. It may still be loading; try again.")?;
    parse_reply(&raw)
}

fn parse_reply(raw: &str) -> Result<Value, String> {
    if raw.len() > MAX_REPLY_BYTES {
        return Err("The page's answer was too large".into());
    }
    let reply: Value = serde_json::from_str(raw).map_err(|_| "The page's answer was unreadable")?;
    match reply.get("ok").and_then(Value::as_bool) {
        Some(true) => Ok(reply.get("result").cloned().unwrap_or(Value::Null)),
        _ => Err(reply
            .get("error")
            .and_then(Value::as_str)
            .map(|e| e.chars().take(500).collect())
            .unwrap_or_else(|| "The page action failed".into())),
    }
}

/// Ask the window's UI to do what the browser panel owns, and wait for it.
fn relay(window: &WebviewWindow, action: &str, input: &Value) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel();
    pending()
        .lock()
        .map_err(|_| "Browser unavailable")?
        .insert(id.clone(), tx);
    let request = RelayRequest {
        id: id.clone(),
        action: action.into(),
        input: input.clone(),
    };
    let result = match window.emit_to(window.label(), REQUEST_EVENT, request) {
        Err(_) => Err("The Irgatos window didn't take the request".to_string()),
        Ok(()) => rx
            .recv_timeout(RELAY_TIMEOUT)
            .unwrap_or_else(|_| Err("The browser didn't answer in time".into())),
    };
    if let Ok(mut map) = pending().lock() {
        map.remove(&id);
    }
    result
}

/// A PNG of the visible page, written to a temp file the agent can open.
async fn screenshot(window: WebviewWindow) -> Result<Value, String> {
    let rx = on_main(window, move |window| {
        let (tx, rx) = mpsc::channel();
        with_active_view(&window, move |view| {
            platform::snapshot(view, move |image| {
                let _ = tx.send(image);
            })
        })?;
        Ok(rx)
    })
    .await?;
    let image = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(PAGE_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "The browser didn't respond".to_string())??;
    tauri::async_runtime::spawn_blocking(move || {
        let image = shrink(image, SCREENSHOT_EDGE);
        let (width, height) = (image.width, image.height);
        let png = encode_png(&image)?;
        let dir = std::env::temp_dir().join("irgatos-browser-shots");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        prune(&dir);
        let path = dir.join(format!("page-{}.png", uuid::Uuid::new_v4().simple()));
        std::fs::write(&path, &png).map_err(|e| e.to_string())?;
        Ok(json!({
            "path": path.to_string_lossy(),
            "width": width,
            "height": height,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Screenshots are for the turn that took them; drop ones older than an hour.
fn prune(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = SystemTime::now() - Duration::from_secs(3600);
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| modified < cutoff);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwraps_page_replies() {
        assert_eq!(
            parse_reply(r#"{"ok":true,"result":{"url":"https://a.test"}}"#).unwrap(),
            json!({"url": "https://a.test"})
        );
        assert_eq!(
            parse_reply(r#"{"ok":false,"error":"No element matches #x"}"#).unwrap_err(),
            "No element matches #x"
        );
        assert!(parse_reply("not json").is_err());
        assert!(parse_reply(&"x".repeat(MAX_REPLY_BYTES + 1)).is_err());
    }

    #[test]
    fn picks_one_target() {
        assert_eq!(
            target_of(&json!({"ref": 3, "text": "ignored"})).unwrap(),
            json!({"ref": 3})
        );
        assert_eq!(
            target_of(&json!({"selector": "#go"})).unwrap(),
            json!({"selector": "#go"})
        );
        assert!(target_of(&json!({"ref": null})).is_err());
        assert!(target_of(&json!({})).is_err());
    }

    #[test]
    fn a_taken_over_window_is_held_until_handed_back() {
        assert!(!is_held("hold-test"));
        held().lock().unwrap().insert("hold-test".into());
        assert!(is_held("hold-test"));
        assert!(!is_held("other-window"));
        held().lock().unwrap().remove("hold-test");
        assert!(!is_held("hold-test"));
    }

    #[test]
    fn defaults_to_the_main_view() {
        assert_eq!(active_view("never-seen"), DEFAULT_VIEW);
    }
}
