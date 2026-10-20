use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

use crate::dirs_home;
use crate::harness::{exec_output, first_binary, which_via_login_shell};

const BINARY: &str = "cua-driver";
const APP_BUNDLE: &str = "CuaDriver.app";

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUsePermissions {
    accessibility: Option<bool>,
    screen_recording: Option<bool>,
    detail: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseStatus {
    binary_path: Option<String>,
    app_bundle: bool,
    version: Option<String>,
    telemetry_enabled: Option<bool>,
    telemetry_source: Option<String>,
    permissions: Option<ComputerUsePermissions>,
}

/// The app bundle comes first: macOS ties Accessibility and Screen Recording
/// grants to its stable `com.trycua.driver` identity, so they survive driver
/// updates and Irgatos rebuilds.
fn candidates(home: Option<&Path>, from_shell: Option<PathBuf>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(target_os = "macos") {
        paths.push(Path::new("/Applications").join(APP_BUNDLE));
        if let Some(home) = home {
            paths.push(home.join("Applications").join(APP_BUNDLE));
        }
        paths = paths
            .into_iter()
            .map(|app| app.join("Contents/MacOS").join(BINARY))
            .collect();
    }
    paths.extend(from_shell);
    if let Some(home) = home {
        paths.push(home.join(".local/bin").join(BINARY));
    }
    paths.push(PathBuf::from("/opt/homebrew/bin").join(BINARY));
    paths.push(PathBuf::from("/usr/local/bin").join(BINARY));
    paths
}

fn resolve_binary() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    first_binary(candidates(home.as_deref(), which_via_login_shell(BINARY)))
}

fn inside_app_bundle(path: &Path) -> bool {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    resolved
        .components()
        .any(|part| part.as_os_str() == APP_BUNDLE)
}

fn run(binary: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
    let output = exec_output(&binary.to_string_lossy(), &args, None, timeout)?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("{} {}", stderr.trim(), stdout).trim().to_owned())
}

fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().next()?.trim();
    let version = line.strip_prefix(BINARY).unwrap_or(line).trim();
    (!version.is_empty()).then(|| version.to_owned())
}

fn parse_telemetry(output: &str) -> (Option<bool>, Option<String>) {
    let Ok(value) = serde_json::from_str::<Value>(output) else {
        return (None, None);
    };
    (
        value.get("enabled").and_then(Value::as_bool),
        value
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_owned),
    )
}

/// `permissions status --json` only reports booleans when the driver's own
/// daemon answers; otherwise it returns `status: "unknown"` with a reason.
fn parse_permissions(output: &str) -> ComputerUsePermissions {
    let Ok(value) = serde_json::from_str::<Value>(output) else {
        return ComputerUsePermissions {
            detail: Some("Could not read the permission status.".into()),
            ..Default::default()
        };
    };
    ComputerUsePermissions {
        accessibility: value.get("accessibility").and_then(Value::as_bool),
        screen_recording: value.get("screen_recording").and_then(Value::as_bool),
        detail: value
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_owned),
    }
}

fn status() -> ComputerUseStatus {
    let Some(binary) = resolve_binary() else {
        return ComputerUseStatus::default();
    };
    let quick = Duration::from_secs(5);
    let version = run(&binary, &["--version"], quick)
        .ok()
        .and_then(|output| parse_version(&output));
    let (telemetry_enabled, telemetry_source) =
        run(&binary, &["telemetry", "status", "--json"], quick)
            .map(|output| parse_telemetry(&output))
            .unwrap_or((None, None));
    let permissions = cfg!(target_os = "macos").then(|| {
        match run(
            &binary,
            &["permissions", "status", "--json"],
            Duration::from_secs(10),
        ) {
            Ok(output) => parse_permissions(&output),
            Err(error) => ComputerUsePermissions {
                detail: Some(error),
                ..Default::default()
            },
        }
    });
    ComputerUseStatus {
        app_bundle: inside_app_bundle(&binary),
        binary_path: Some(binary.to_string_lossy().into_owned()),
        version,
        telemetry_enabled,
        telemetry_source,
        permissions,
    }
}

fn require_binary() -> Result<PathBuf, String> {
    resolve_binary().ok_or_else(|| "Cua Driver is not installed".to_owned())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AppWindow {
    pid: u32,
    window_id: u64,
    app_name: String,
    #[serde(default)]
    title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSelection {
    window: AppWindow,
    allow_control: bool,
}

struct WindowGrant {
    selection: WindowSelection,
    revoked: AtomicBool,
    ready: AtomicBool,
    operation: Mutex<()>,
    images: tempfile::TempDir,
}

fn selections() -> &'static Mutex<HashMap<String, Arc<WindowGrant>>> {
    static SELECTIONS: OnceLock<Mutex<HashMap<String, Arc<WindowGrant>>>> = OnceLock::new();
    SELECTIONS.get_or_init(Mutex::default)
}

fn daemon_not_running(error: &str) -> bool {
    error.contains("daemon is not running")
}

fn app_bundle_of(binary: &Path) -> Option<PathBuf> {
    let resolved = std::fs::canonicalize(binary).unwrap_or_else(|_| binary.to_path_buf());
    resolved
        .ancestors()
        .find(|path| path.file_name().is_some_and(|name| name == APP_BUNDLE))
        .map(Path::to_path_buf)
}

/// One-shot `call` needs the driver's daemon, which stops on logout, restart
/// or a driver update. Start it the way the driver's own `mcp` adapter does:
/// through LaunchServices, so it keeps CuaDriver.app's Accessibility and
/// Screen Recording grants. The lock keeps parallel calls from starting two.
fn call_starting_daemon(
    binary: &Path,
    call: impl Fn() -> Result<String, String>,
) -> Result<String, String> {
    static STARTING: Mutex<()> = Mutex::new(());
    let first = call();
    let Err(error) = &first else { return first };
    if !cfg!(target_os = "macos") || !daemon_not_running(error) {
        return first;
    }
    let Some(app) = app_bundle_of(binary) else {
        return Err("Cua Driver is not running. Open CuaDriver.app once".into());
    };
    let _starting = STARTING.lock().map_err(|e| e.to_string())?;
    match call() {
        Err(error) if daemon_not_running(&error) => {}
        other => return other,
    }
    let app = app.to_string_lossy().into_owned();
    run(
        Path::new("/usr/bin/open"),
        &["-n", "-g", &app, "--args", "serve"],
        Duration::from_secs(10),
    )
    .map_err(|e| format!("Could not start Cua Driver: {e}"))?;
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        std::thread::sleep(Duration::from_millis(250));
        match call() {
            Err(error) if daemon_not_running(&error) && std::time::Instant::now() < deadline => {}
            Err(error) if daemon_not_running(&error) => {
                return Err("Cua Driver did not start".into())
            }
            other => return other,
        }
    }
}

fn call_driver(tool: &str, args: Value) -> Result<Value, String> {
    let binary = require_binary()?;
    let encoded = args.to_string();
    let output = call_starting_daemon(&binary, || {
        run(&binary, &["call", tool, &encoded], Duration::from_secs(30))
    })?;
    let value: Value = serde_json::from_str(&output)
        .map_err(|_| "Cua Driver returned an unreadable response".to_owned())?;
    if value.get("isError").and_then(Value::as_bool) == Some(true) || value.get("error").is_some() {
        return Err(value.to_string());
    }
    Ok(value)
}

fn windows() -> Result<Vec<AppWindow>, String> {
    parse_windows(call_driver("list_windows", json!({}))?)
}

fn parse_windows(value: Value) -> Result<Vec<AppWindow>, String> {
    let windows = value
        .get("windows")
        .and_then(Value::as_array)
        .ok_or("Cua Driver did not return a window list")?;
    // shortcut: omit tiny or hidden unnamed helpers; revisit for utility windows below 100×80.
    let windows: Vec<Value> = windows
        .iter()
        .filter(|w| {
            w["layer"].as_i64().unwrap_or(0) == 0
                && w["bounds"]["width"].as_f64().unwrap_or(0.0) >= 100.0
                && w["bounds"]["height"].as_f64().unwrap_or(0.0) >= 80.0
                && (w["is_on_screen"].as_bool() == Some(true)
                    || w["title"].as_str().is_some_and(|t| !t.trim().is_empty()))
        })
        .cloned()
        .collect();
    let windows: Vec<AppWindow> = serde_json::from_value(Value::Array(windows))
        .map_err(|e| format!("Could not read windows: {e}"))?;
    Ok(windows
        .into_iter()
        .filter(|w| {
            w.pid > 0
                && w.window_id > 0
                && !matches!(w.app_name.as_str(), "Cua Driver" | "ChatGPT Computer Use")
        })
        .collect())
}

fn live_window(expected: &AppWindow) -> Result<AppWindow, String> {
    windows()?
        .into_iter()
        .find(|w| {
            w.pid == expected.pid
                && w.window_id == expected.window_id
                && w.app_name == expected.app_name
        })
        .ok_or_else(|| {
            "The shared window was closed or replaced. Select it again with @.".to_owned()
        })
}

#[tauri::command]
pub async fn computer_use_windows() -> Result<Vec<AppWindow>, String> {
    // Every @ mention lists windows; without the optional driver there are none to offer.
    tauri::async_runtime::spawn_blocking(|| match resolve_binary() {
        Some(_) => windows(),
        None => Ok(Vec::new()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn computer_use_select(
    session_id: String,
    window: AppWindow,
    allow_control: bool,
) -> Result<WindowSelection, String> {
    if session_id.is_empty() {
        return Err("Choose a chat first".into());
    }
    let selection = WindowSelection {
        window,
        allow_control,
    };
    let grant = Arc::new(WindowGrant {
        selection: selection.clone(),
        revoked: AtomicBool::new(false),
        ready: AtomicBool::new(false),
        operation: Mutex::new(()),
        images: tempfile::Builder::new()
            .prefix("irgatos-window-")
            .tempdir()
            .map_err(|e| e.to_string())?,
    });
    // Reserve before awaiting the driver, so Stop also revokes an in-flight selection.
    if let Some(old) = selections()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id.clone(), grant.clone())
    {
        old.revoked.store(true, Ordering::SeqCst);
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = live_window(&selection.window) {
            let mut selections = selections().lock().map_err(|e| e.to_string())?;
            if selections
                .get(&session_id)
                .is_some_and(|current| Arc::ptr_eq(current, &grant))
            {
                selections.remove(&session_id);
            }
            return Err(error);
        }
        if grant.revoked.load(Ordering::SeqCst) {
            return Err("Window sharing was stopped".into());
        }
        grant.ready.store(true, Ordering::SeqCst);
        Ok(selection)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn computer_use_selected(session_id: String) -> Result<Option<WindowSelection>, String> {
    Ok(selections()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .filter(|g| g.ready.load(Ordering::SeqCst) && !g.revoked.load(Ordering::SeqCst))
        .map(|g| g.selection.clone()))
}

#[tauri::command]
pub fn computer_use_revoke(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    use tauri::Emitter;
    revoke_selection(&session_id)?;
    app.emit("computer-use-stopped", session_id)
        .map_err(|e| e.to_string())
}

fn revoke_selection(session_id: &str) -> Result<(), String> {
    if let Some(grant) = selections()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(session_id)
    {
        grant.revoked.store(true, Ordering::SeqCst);
    }
    Ok(())
}

// Keep target selection in the UI: the agent CLI can only read or act on an existing grant.
fn scoped_args(selection: &WindowSelection, tool: &str, args: Value) -> Result<Value, String> {
    let allowed: &[&str] = match tool {
        "get_window_state" => &["query"],
        "click" => &[
            "x",
            "y",
            "element_index",
            "snapshot_id",
            "element_token",
            "button",
            "count",
            "modifier",
            "action",
            "delivery_mode",
        ],
        "type_text" => &[
            "text",
            "x",
            "y",
            "element_index",
            "snapshot_id",
            "element_token",
            "delivery_mode",
        ],
        "scroll" => &[
            "direction",
            "amount",
            "by",
            "x",
            "y",
            "element_index",
            "snapshot_id",
            "element_token",
            "delivery_mode",
        ],
        "press_key" => &[
            "key",
            "modifiers",
            "x",
            "y",
            "element_index",
            "snapshot_id",
            "element_token",
            "delivery_mode",
        ],
        "hotkey" => &[
            "keys",
            "x",
            "y",
            "element_index",
            "snapshot_id",
            "element_token",
            "delivery_mode",
        ],
        _ => return Err("Unsupported window action".into()),
    };
    if tool != "get_window_state" && !selection.allow_control {
        return Err(
            "This window is read only. Ask the user to enable Allow control in the chat.".into(),
        );
    }
    let mut args = args
        .as_object()
        .cloned()
        .ok_or("Arguments must be an object")?;
    if let Some(key) = args.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("Unsupported argument: {key}"));
    }
    args.insert("pid".into(), json!(selection.window.pid));
    args.insert("window_id".into(), json!(selection.window.window_id));
    Ok(Value::Object(args))
}

#[tauri::command]
pub async fn computer_use_call(
    session_id: String,
    tool: String,
    args: Value,
) -> Result<Value, String> {
    let grant = selections()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or("No window is shared. Ask the user to select one with @ in this chat.")?;
    if !grant.ready.load(Ordering::SeqCst) {
        return Err("Window selection is still being checked".into());
    }
    let mut args = scoped_args(&grant.selection, &tool, args)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = grant
            .operation
            .try_lock()
            .map_err(|_| "Another window action is still running")?;
        live_window(&grant.selection.window)?;
        if grant.revoked.load(Ordering::SeqCst) {
            return Err("Window sharing was stopped".into());
        }
        if tool == "get_window_state" {
            args["max_elements"] = json!(500);
            args["max_depth"] = json!(20);
            args["screenshot_out_file"] = json!(grant.images.path().join("window.png"));
        }
        let result = call_driver(&tool, args)?;
        if grant.revoked.load(Ordering::SeqCst) {
            return Err("Window sharing was stopped".into());
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn computer_use_status() -> Result<ComputerUseStatus, String> {
    tauri::async_runtime::spawn_blocking(status)
        .await
        .map_err(|e| e.to_string())
}

/// Persists the opt-out in the driver's own config. The MCP entry's env vars
/// only reach the stdio adapter; on macOS the tool calls run in a
/// LaunchServices-started daemon that does not inherit them.
#[tauri::command]
pub async fn computer_use_disable_telemetry() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let binary = require_binary()?;
        run(&binary, &["telemetry", "disable"], Duration::from_secs(10)).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `permissions grant` launches CuaDriver.app so the prompts and the System
/// Settings entries belong to the driver, not to Irgatos. It waits while the
/// user answers them.
#[tauri::command]
pub async fn computer_use_grant_permissions() -> Result<ComputerUseStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let binary = require_binary()?;
        run(
            &binary,
            &["permissions", "grant"],
            Duration::from_secs(5 * 60),
        )?;
        Ok(status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn selection(allow_control: bool) -> WindowSelection {
        WindowSelection {
            window: AppWindow {
                pid: 42,
                window_id: 19,
                app_name: "TextEdit".into(),
                title: "Scratch".into(),
            },
            allow_control,
        }
    }

    #[test]
    fn picker_keeps_document_titles_and_omits_helper_surfaces() {
        let entry = |id, app, title, width, height, visible| {
            json!({"pid":42,"window_id":id,"app_name":app,"title":title,
                "bounds":{"width":width,"height":height},"layer":0,"is_on_screen":visible})
        };
        let windows = parse_windows(json!({"windows":[
            entry(1, "Google Chrome", "Window", 66, 20, true),
            entry(2, "Google Chrome", "", 5120, 30, false),
            entry(3, "Google Chrome", "Irgatos computer-use test", 1900, 1296, true),
            entry(4, "Google Chrome", "", 1540, 498, false),
            entry(5, "TextEdit", "", 600, 400, true),
            entry(6, "TextEdit", "Document", 600, 400, false)
        ]}))
        .unwrap();
        assert_eq!(
            windows.iter().map(|w| w.window_id).collect::<Vec<_>>(),
            [3, 5, 6]
        );
        assert_eq!(windows[0].title, "Irgatos computer-use test");
    }

    #[test]
    #[ignore = "Open tests/browser/computer-control.html in Chrome first; reads the real desktop window list"]
    fn live_window_picker_omits_browser_helper_windows() {
        let windows = windows().unwrap();
        assert!(windows
            .iter()
            .any(|w| w.title == "Irgatos computer-use test"));
        for window in windows.iter().filter(|w| w.app_name == "Google Chrome") {
            assert!(
                !window.title.is_empty() && window.title != "Window",
                "Browser helper window should not be selectable: {window:?}"
            );
        }
    }

    #[test]
    #[ignore = "Open tests/browser/computer-control.html in Chrome first; uses the real desktop driver"]
    fn live_shared_window_can_read_type_click_and_revoke() {
        tauri::async_runtime::block_on(async {
            let window = windows()
                .unwrap()
                .into_iter()
                .find(|w| w.title == "Irgatos computer-use test")
                .expect("Open the isolated computer-control test page in Chrome");
            let session = "computer-use-smoke".to_owned();
            computer_use_select(session.clone(), window.clone(), false)
                .await
                .unwrap();
            let state = computer_use_call(session.clone(), "get_window_state".into(), json!({}))
                .await
                .unwrap();
            let screenshot = state["screenshot_file_path"]
                .as_str()
                .expect("window screenshot");
            assert!(Path::new(screenshot).is_file());
            assert!(state["tree_markdown"]
                .as_str()
                .unwrap()
                .contains("Test message"));
            assert!(computer_use_call(
                session.clone(),
                "type_text".into(),
                json!({"text":"blocked"})
            )
            .await
            .is_err());
            computer_use_select(session.clone(), window, true)
                .await
                .unwrap();
            let state = computer_use_call(session.clone(), "get_window_state".into(), json!({}))
                .await
                .unwrap();
            let input = state["elements"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| {
                    e["label"].as_str() == Some("Test message")
                        && e["role"].as_str().is_some_and(|r| r.contains("TextField"))
                })
                .expect("test text field");
            let token = input["element_token"].clone();
            computer_use_call(session.clone(), "type_text".into(), json!({"text":"Irgatos verified", "element_token":token, "delivery_mode":"foreground"})).await.unwrap();
            let state = computer_use_call(session.clone(), "get_window_state".into(), json!({}))
                .await
                .unwrap();
            let button = state["elements"]
                .as_array()
                .unwrap()
                .iter()
                .find(|e| {
                    e["label"].as_str() == Some("Verify message")
                        && e["role"].as_str().is_some_and(|r| r.contains("Button"))
                })
                .expect("test button");
            computer_use_call(
                session.clone(),
                "click".into(),
                json!({"element_token":button["element_token"], "delivery_mode":"foreground"}),
            )
            .await
            .unwrap();
            let state = computer_use_call(session.clone(), "get_window_state".into(), json!({}))
                .await
                .unwrap();
            assert!(state["tree_markdown"]
                .as_str()
                .unwrap()
                .contains("Irgatos verified"));
            computer_use_call(
                session.clone(),
                "scroll".into(),
                json!({"direction":"down","amount":2}),
            )
            .await
            .unwrap();
            revoke_selection(&session).unwrap();
            assert!(
                computer_use_call(session, "get_window_state".into(), json!({}))
                    .await
                    .is_err()
            );
        });
    }

    #[test]
    fn shared_window_actions_cannot_override_the_target_or_write_arbitrary_files() {
        for (key, value) in [
            ("pid", json!(99)),
            ("window_id", json!(99)),
            ("target", json!({"kind":"desktop"})),
            ("scope", json!("desktop")),
            ("screenshot_out_file", json!("/tmp/other")),
            ("debug_image_out", json!("/tmp/other")),
        ] {
            assert!(
                scoped_args(&selection(true), "click", json!({key:value})).is_err(),
                "{key}"
            );
        }
        assert!(scoped_args(&selection(true), "kill_app", json!({})).is_err());
        assert_eq!(
            scoped_args(&selection(true), "click", json!({"x":10,"y":20})).unwrap(),
            json!({"x":10,"y":20,"pid":42,"window_id":19})
        );
    }

    #[test]
    fn daemon_start_targets_the_driver_app_bundle() {
        assert_eq!(
            app_bundle_of(Path::new(
                "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
            )),
            Some(PathBuf::from("/Applications/CuaDriver.app"))
        );
        assert_eq!(
            app_bundle_of(Path::new("/opt/homebrew/bin/cua-driver")),
            None
        );
        assert!(daemon_not_running(
            "Cua Driver daemon is not running on /Users/me/Library/Caches/cua-driver/cua-driver.sock."
        ));
        assert!(!daemon_not_running(
            "Cua Driver returned an unreadable response"
        ));
    }

    #[test]
    fn calls_that_reach_the_daemon_are_not_retried() {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let result = call_starting_daemon(Path::new("/opt/homebrew/bin/cua-driver"), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err("window not found".into())
        });
        assert_eq!(result.unwrap_err(), "window not found");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn read_only_windows_reject_every_input_action() {
        for tool in ["click", "type_text", "scroll", "press_key", "hotkey"] {
            assert!(scoped_args(&selection(false), tool, json!({}))
                .unwrap_err()
                .contains("read only"));
        }
        assert!(scoped_args(
            &selection(false),
            "get_window_state",
            json!({"query":"text"})
        )
        .is_ok());
        assert!(scoped_args(&selection(true), "click", json!([])).is_err());
    }

    #[test]
    fn stopping_revokes_pending_and_existing_session_grants() {
        let grant = Arc::new(WindowGrant {
            selection: selection(true),
            revoked: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            operation: Mutex::new(()),
            images: tempfile::tempdir().unwrap(),
        });
        selections()
            .lock()
            .unwrap()
            .insert("pending-test".into(), grant.clone());
        assert!(computer_use_selected("pending-test".into())
            .unwrap()
            .is_none());
        revoke_selection("pending-test").unwrap();
        assert!(grant.revoked.load(Ordering::SeqCst));
        assert!(computer_use_selected("pending-test".into())
            .unwrap()
            .is_none());
        tauri::async_runtime::block_on(async {
            assert!(
                computer_use_call("pending-test".into(), "click".into(), json!({}))
                    .await
                    .is_err()
            );
        });
    }

    #[test]
    fn prefers_the_app_bundle_over_path_installs() {
        let home = Path::new("/Users/me");
        let paths = candidates(Some(home), Some(PathBuf::from("/custom/bin/cua-driver")));
        let shell = paths
            .iter()
            .position(|path| path == Path::new("/custom/bin/cua-driver"))
            .unwrap();
        if cfg!(target_os = "macos") {
            assert_eq!(
                paths[0],
                Path::new("/Applications/CuaDriver.app/Contents/MacOS/cua-driver")
            );
            assert_eq!(
                paths[1],
                Path::new("/Users/me/Applications/CuaDriver.app/Contents/MacOS/cua-driver")
            );
            assert_eq!(shell, 2);
        } else {
            assert_eq!(shell, 0);
        }
        assert!(paths.contains(&home.join(".local/bin/cua-driver")));
    }

    #[test]
    fn detects_binaries_inside_the_app_bundle() {
        assert!(inside_app_bundle(Path::new(
            "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
        )));
        assert!(!inside_app_bundle(Path::new(
            "/opt/homebrew/bin/cua-driver"
        )));
    }

    #[test]
    fn parses_version_output() {
        assert_eq!(
            parse_version("cua-driver 0.35.0\n").as_deref(),
            Some("0.35.0")
        );
        assert_eq!(parse_version("0.35.0").as_deref(), Some("0.35.0"));
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn parses_telemetry_status() {
        assert_eq!(
            parse_telemetry(r#"{"enabled": false, "source": "persisted"}"#),
            (Some(false), Some("persisted".into()))
        );
        assert_eq!(parse_telemetry("Telemetry: enabled"), (None, None));
    }

    #[test]
    fn parses_granted_and_unknown_permissions() {
        assert_eq!(
            parse_permissions(r#"{"accessibility": true, "screen_recording": false}"#),
            ComputerUsePermissions {
                accessibility: Some(true),
                screen_recording: Some(false),
                detail: None,
            }
        );
        assert_eq!(
            parse_permissions(
                r#"{"daemon_running": false, "status": "unknown", "reason": "No daemon"}"#
            ),
            ComputerUsePermissions {
                accessibility: None,
                screen_recording: None,
                detail: Some("No daemon".into()),
            }
        );
    }
}
