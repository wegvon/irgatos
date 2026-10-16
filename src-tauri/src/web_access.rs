//! Browser access: the running app serves a small web page so its chats can
//! be followed and answered from any browser on the user's own devices.
//!
//! The page is a thin client. Every API call is relayed to the main window,
//! which answers from the live session state, so the browser and the app
//! always show the same thing: there is only one Irgatos.
//!
//! Who may connect: loopback and Tailscale addresses only (100.64.0.0/10 and
//! fd7a:115c:a1e0::/48), and every request needs the access token, sent as a
//! cookie set by `/?token=…` or as `Authorization: Bearer …`. Writes also
//! need an `X-Irgatos-Web` header, which a cross-site form cannot send.

use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

pub const PORT: u16 = 47620;
const EVENT: &str = "web-access-request";
const WINDOW: &str = "main";
const CONFIG_FILE: &str = "web-access.json";
const TOKEN_FILE: &str = "web-access.token";
const COOKIE: &str = "irgatos_web";
const WRITE_HEADER: &str = "X-Irgatos-Web";
const MAX_BODY_BYTES: usize = 256 * 1024;
const MAX_IN_FLIGHT: usize = 16;
const REPLY_TIMEOUT: Duration = Duration::from_secs(20);
const RECV_POLL: Duration = Duration::from_millis(250);
/// The page is the app's own `web.html` build, served from its bundled assets.
const PAGE: &str = "web.html";
/// Files the page loads besides its hashed `/assets/…` bundles.
const PUBLIC_FILES: [&str; 2] = ["/web.webmanifest", "/irgat.png"];
const PAGE_CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/// Reads relayed with GET; everything else changes state and needs POST.
const READ_ACTIONS: [&str; 5] = ["overview", "session", "projects", "ideas", "services"];
const WRITE_ACTIONS: [&str; 9] = [
    "send",
    "approval",
    "answer",
    "stop",
    "newChat",
    "ideaAdd",
    "ideaUpdate",
    "ideaMove",
    "ideaDelete",
];

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    enabled: bool,
}

struct Running {
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
struct Inner {
    token: String,
    running: Option<Running>,
    error: Option<String>,
    pending: HashMap<String, mpsc::Sender<Value>>,
}

#[derive(Default)]
pub struct WebAccess {
    inner: Arc<Mutex<Inner>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebAccessStatus {
    enabled: bool,
    running: bool,
    port: u16,
    token: String,
    error: Option<String>,
    /// Addresses to open, the Tailscale one first when this Mac has one.
    urls: Vec<String>,
    tailscale: bool,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn read_config(dir: &Path) -> Config {
    crate::state_file::read_json_or_recover::<Config>(&dir.join(CONFIG_FILE))
        .ok()
        .and_then(|(config, _)| config)
        .unwrap_or_default()
}

fn load_token(dir: &Path) -> Result<String, String> {
    let path = dir.join(TOKEN_FILE);
    if let Ok(token) = std::fs::read_to_string(&path) {
        let token = token.trim().to_string();
        if valid_token(&token) {
            return Ok(token);
        }
    }
    let token = new_token();
    crate::voice::store_secret(&path, &token)?;
    Ok(token)
}

fn valid_token(token: &str) -> bool {
    (32..=128).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Loopback, or an address Tailscale hands out to devices on the tailnet.
fn allowed_peer(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            v4.is_loopback() || (a == 100 && (b & 0xC0) == 64)
        }
        IpAddr::V6(v6) => {
            let s = v6.segments();
            v6.is_loopback() || (s[0] == 0xfd7a && s[1] == 0x115c && s[2] == 0xa1e0)
        }
    }
}

/// Constant-time comparison, so response timing says nothing about the token.
fn same_token(given: &str, token: &str) -> bool {
    given.len() == token.len()
        && given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

fn header<'a>(request: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

fn cookie_token(cookies: &str) -> Option<&str> {
    cookies.split(';').find_map(|pair| {
        let (name, value) = pair.trim().split_once('=')?;
        (name == COOKIE).then_some(value)
    })
}

fn presented_token(request: &tiny_http::Request) -> Option<String> {
    if let Some(bearer) = header(request, "Authorization").and_then(|v| v.strip_prefix("Bearer ")) {
        return Some(bearer.trim().to_string());
    }
    header(request, "Cookie")
        .and_then(cookie_token)
        .map(str::to_string)
}

fn query_param(url: &str, name: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

fn query_object(url: &str) -> Value {
    let mut object = serde_json::Map::new();
    if let Some((_, query)) = url.split_once('?') {
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if key != "token" {
                object.insert(key.into_owned(), Value::String(value.into_owned()));
            }
        }
    }
    Value::Object(object)
}

/// How one request should be answered, decided before anything is relayed.
#[derive(Debug, PartialEq)]
enum Route {
    Page,
    /// A bundled file the page needs: public, like the page itself.
    Static(String),
    /// `/?token=…` with the right token: set the cookie and drop the token from the URL.
    Login,
    Api {
        action: String,
        write: bool,
    },
    Reject(u16, &'static str),
}

/// Hashed Vite bundles and the few public files; nothing else of the app.
fn static_path(path: &str) -> bool {
    if PUBLIC_FILES.contains(&path) {
        return true;
    }
    path.strip_prefix("/assets/").is_some_and(|name| {
        !name.is_empty()
            && !name.starts_with('.')
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    })
}

fn route(
    method: &str,
    url: &str,
    peer: Option<IpAddr>,
    token: &str,
    presented: Option<&str>,
    write_header: bool,
) -> Route {
    if !peer.is_some_and(allowed_peer) {
        return Route::Reject(403, "Only this Mac and your Tailscale devices can connect.");
    }
    let path = url.split('?').next().unwrap_or_default();
    let get = method.eq_ignore_ascii_case("GET");
    if path == "/" && get {
        // A wrong token still gets the page, which then asks for it again.
        if query_param(url, "token").is_some_and(|given| same_token(&given, token)) {
            return Route::Login;
        }
        return Route::Page;
    }
    if get && static_path(path) {
        return Route::Static(path.to_string());
    }
    let Some(action) = path.strip_prefix("/api/") else {
        return Route::Reject(404, "Not found");
    };
    if !presented.is_some_and(|given| same_token(given, token)) {
        return Route::Reject(401, "Sign in with the access token from Irgatos Settings.");
    }
    if READ_ACTIONS.contains(&action) {
        return if get {
            Route::Api {
                action: action.into(),
                write: false,
            }
        } else {
            Route::Reject(405, "Use GET")
        };
    }
    if WRITE_ACTIONS.contains(&action) {
        if !method.eq_ignore_ascii_case("POST") {
            return Route::Reject(405, "Use POST");
        }
        if !write_header {
            return Route::Reject(403, "Missing X-Irgatos-Web header");
        }
        return Route::Api {
            action: action.into(),
            write: true,
        };
    }
    Route::Reject(404, "Not found")
}

fn respond(request: tiny_http::Request, status: u16, content_type: &str, body: String) {
    respond_bytes(request, status, content_type, body.into_bytes(), &[]);
}

fn respond_bytes(
    request: tiny_http::Request,
    status: u16,
    content_type: &str,
    body: Vec<u8>,
    extra: &[(&str, &str)],
) {
    let mut response = tiny_http::Response::from_data(body).with_status_code(status);
    let cache = extra
        .iter()
        .find(|(name, _)| *name == "Cache-Control")
        .map_or("no-store", |(_, value)| *value);
    for (name, value) in [
        ("Content-Type", content_type),
        ("Cache-Control", cache),
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "DENY"),
        ("Referrer-Policy", "no-referrer"),
    ]
    .into_iter()
    .chain(
        extra
            .iter()
            .copied()
            .filter(|(name, _)| *name != "Cache-Control"),
    ) {
        if let Ok(header) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response = response.with_header(header);
        }
    }
    let _ = request.respond(response);
}

fn respond_json(request: tiny_http::Request, status: u16, body: Value) {
    respond(
        request,
        status,
        "application/json; charset=utf-8",
        body.to_string(),
    );
}

fn login(request: tiny_http::Request, token: &str) {
    let mut response = tiny_http::Response::empty(302);
    let cookie = format!("{COOKIE}={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict");
    for (name, value) in [
        ("Set-Cookie", cookie.as_str()),
        ("Location", "/"),
        ("Cache-Control", "no-store"),
        ("Referrer-Policy", "no-referrer"),
    ] {
        if let Ok(header) = tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response = response.with_header(header);
        }
    }
    let _ = request.respond(response);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayEvent {
    id: String,
    action: String,
    input: Value,
}

/// Hands one API call to the main window and waits for its answer.
fn relay(app: &AppHandle, inner: &Arc<Mutex<Inner>>, action: String, input: Value) -> Value {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = mpsc::channel();
    if let Ok(mut state) = inner.lock() {
        state.pending.insert(id.clone(), tx);
    }
    let delivered = app.get_webview_window(WINDOW).is_some()
        && app
            .emit_to(
                WINDOW,
                EVENT,
                RelayEvent {
                    id: id.clone(),
                    action,
                    input,
                },
            )
            .is_ok();
    let reply = if delivered {
        rx.recv_timeout(REPLY_TIMEOUT).unwrap_or_else(|_| {
            json!({"ok": false, "error": "Irgatos did not answer in time. Is its window open on the Mac?"})
        })
    } else {
        json!({"ok": false, "error": "The Irgatos window is closed on the Mac."})
    };
    if let Ok(mut state) = inner.lock() {
        state.pending.remove(&id);
    }
    reply
}

/// Keys of the bundled frontend, so a missing file is a 404 rather than the
/// resolver's fallback to the app's own `index.html`.
fn bundled(app: &AppHandle, path: &str) -> bool {
    static KEYS: std::sync::OnceLock<std::collections::HashSet<String>> =
        std::sync::OnceLock::new();
    let keys = KEYS.get_or_init(|| {
        app.asset_resolver()
            .iter()
            .map(|(key, _)| format!("/{}", key.trim_start_matches('/')))
            .collect()
    });
    keys.contains(path)
}

fn serve_asset(request: tiny_http::Request, app: &AppHandle, path: &str) {
    let asset = bundled(app, path)
        .then(|| app.asset_resolver().get(path.to_string()))
        .flatten();
    let Some(asset) = asset else {
        return respond_json(request, 404, json!({"ok": false, "error": "Not found"}));
    };
    let page = path.ends_with(".html");
    let mime = if page {
        "text/html; charset=utf-8".to_string()
    } else if path.ends_with(".webmanifest") {
        "application/manifest+json".to_string()
    } else {
        asset.mime_type.clone()
    };
    let headers: &[(&str, &str)] = if page {
        &[("Content-Security-Policy", PAGE_CSP)]
    } else if path.starts_with("/assets/") {
        // Vite names bundles by content hash, so a cached copy never goes stale.
        &[("Cache-Control", "public, max-age=31536000, immutable")]
    } else {
        &[("Cache-Control", "public, max-age=3600")]
    };
    respond_bytes(request, 200, &mime, asset.bytes, headers);
}

fn serve(mut request: tiny_http::Request, app: &AppHandle, inner: &Arc<Mutex<Inner>>) {
    let token = match inner.lock() {
        Ok(state) => state.token.clone(),
        Err(_) => return respond_json(request, 500, json!({"ok": false, "error": "Unavailable"})),
    };
    let peer = request.remote_addr().map(SocketAddr::ip);
    let presented = presented_token(&request);
    let route = route(
        request.method().as_str(),
        request.url(),
        peer,
        &token,
        presented.as_deref(),
        header(&request, WRITE_HEADER).is_some(),
    );
    match route {
        Route::Page => serve_asset(request, app, &format!("/{PAGE}")),
        Route::Static(path) => serve_asset(request, app, &path),
        Route::Login => login(request, &token),
        Route::Reject(status, error) => {
            respond_json(request, status, json!({"ok": false, "error": error}))
        }
        Route::Api { action, write } => {
            let input = if write {
                let mut bytes = Vec::new();
                let read = request
                    .as_reader()
                    .take(MAX_BODY_BYTES as u64 + 1)
                    .read_to_end(&mut bytes);
                if read.is_err() || bytes.len() > MAX_BODY_BYTES {
                    return respond_json(
                        request,
                        413,
                        json!({"ok": false, "error": "Request too large"}),
                    );
                }
                match serde_json::from_slice::<Value>(&bytes) {
                    Ok(value) if value.is_object() => value,
                    _ => {
                        return respond_json(
                            request,
                            400,
                            json!({"ok": false, "error": "Send a JSON object"}),
                        )
                    }
                }
            } else {
                query_object(request.url())
            };
            let reply = relay(app, inner, action, input);
            let status = if reply.get("ok").and_then(Value::as_bool) == Some(true) {
                200
            } else {
                422
            };
            respond_json(request, status, reply);
        }
    }
}

fn start(app: &AppHandle, inner: &Arc<Mutex<Inner>>) -> Result<Running, String> {
    // Every address, so Tailscale devices can reach it; `allowed_peer` keeps
    // everyone else out before the token is even looked at.
    let server = tiny_http::Server::http(("0.0.0.0", PORT))
        .map_err(|error| format!("Port {PORT} is not free: {error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = stop.clone();
    let in_flight = Arc::new(AtomicUsize::new(0));
    let app = app.clone();
    let inner = inner.clone();
    std::thread::Builder::new()
        .name("web-access".into())
        .spawn(move || {
            while !stopping.load(Ordering::SeqCst) {
                let request = match server.recv_timeout(RECV_POLL) {
                    Ok(Some(request)) => request,
                    Ok(None) => continue,
                    Err(_) => {
                        std::thread::sleep(RECV_POLL);
                        continue;
                    }
                };
                // Relayed calls wait on the window; run them beside the listener.
                if in_flight.fetch_add(1, Ordering::SeqCst) >= MAX_IN_FLIGHT {
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                    respond_json(
                        request,
                        503,
                        json!({"ok": false, "error": "Busy, try again"}),
                    );
                    continue;
                }
                let (app, inner, in_flight) = (app.clone(), inner.clone(), in_flight.clone());
                std::thread::spawn(move || {
                    serve(request, &app, &inner);
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                });
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(Running { stop })
}

fn apply(app: &AppHandle, host: &WebAccess, enabled: bool) {
    let Ok(mut state) = host.inner.lock() else {
        return;
    };
    if !enabled {
        if let Some(running) = state.running.take() {
            running.stop.store(true, Ordering::SeqCst);
        }
        state.error = None;
        return;
    }
    if state.running.is_some() {
        return;
    }
    drop(state);
    let started = start(app, &host.inner);
    if let Ok(mut state) = host.inner.lock() {
        match started {
            Ok(running) => {
                state.running = Some(running);
                state.error = None;
            }
            Err(error) => state.error = Some(error),
        }
    }
}

/// This Mac's Tailscale IPv4 address, read from the interface list.
fn tailscale_ip() -> Option<String> {
    let output = std::process::Command::new("/sbin/ifconfig").output().ok()?;
    tailscale_ip_in(&String::from_utf8_lossy(&output.stdout))
}

fn tailscale_ip_in(ifconfig: &str) -> Option<String> {
    ifconfig.lines().find_map(|line| {
        let address = line
            .trim()
            .strip_prefix("inet ")?
            .split_whitespace()
            .next()?;
        let ip: IpAddr = address.parse().ok()?;
        (allowed_peer(ip) && !ip.is_loopback()).then(|| address.to_string())
    })
}

fn status(app: &AppHandle, host: &WebAccess) -> Result<WebAccessStatus, String> {
    let dir = data_dir(app)?;
    let enabled = read_config(&dir).enabled;
    let state = host
        .inner
        .lock()
        .map_err(|_| "Browser access unavailable")?;
    let tailscale = tailscale_ip();
    let mut urls = Vec::new();
    if let Some(ip) = &tailscale {
        urls.push(format!("http://{ip}:{PORT}/"));
    }
    urls.push(format!("http://127.0.0.1:{PORT}/"));
    Ok(WebAccessStatus {
        enabled,
        running: state.running.is_some(),
        port: PORT,
        token: state.token.clone(),
        error: state.error.clone(),
        urls,
        tailscale: tailscale.is_some(),
    })
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let dir = data_dir(app)?;
    let host = WebAccess::default();
    if let Ok(mut state) = host.inner.lock() {
        state.token = load_token(&dir)?;
    }
    let enabled = read_config(&dir).enabled;
    if enabled {
        apply(app, &host, true);
    }
    app.manage(host);
    Ok(())
}

#[tauri::command]
pub fn web_access_status(
    app: AppHandle,
    host: State<'_, WebAccess>,
) -> Result<WebAccessStatus, String> {
    status(&app, &host)
}

#[tauri::command]
pub fn web_access_set_enabled(
    app: AppHandle,
    host: State<'_, WebAccess>,
    enabled: bool,
) -> Result<WebAccessStatus, String> {
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::state_file::write_json_atomic(&dir.join(CONFIG_FILE), &Config { enabled }, true)?;
    apply(&app, &host, enabled);
    status(&app, &host)
}

/// A new token signs every browser out.
#[tauri::command]
pub fn web_access_rotate_token(
    app: AppHandle,
    host: State<'_, WebAccess>,
) -> Result<WebAccessStatus, String> {
    let dir = data_dir(&app)?;
    let token = new_token();
    crate::voice::store_secret(&dir.join(TOKEN_FILE), &token)?;
    if let Ok(mut state) = host.inner.lock() {
        state.token = token;
    }
    status(&app, &host)
}

#[tauri::command]
pub fn web_access_reply(
    window: WebviewWindow,
    host: State<'_, WebAccess>,
    id: String,
    response: Value,
) -> Result<(), String> {
    if window.label() != WINDOW {
        return Ok(());
    }
    let mut state = host
        .inner
        .lock()
        .map_err(|_| "Browser access unavailable")?;
    if let Some(reply) = state.pending.remove(&id) {
        let _ = reply.send(response);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    fn ip(s: &str) -> Option<IpAddr> {
        Some(s.parse().unwrap())
    }

    #[test]
    fn only_loopback_and_tailscale_peers_get_in() {
        for ok in [
            "127.0.0.1",
            "::1",
            "100.64.0.1",
            "100.101.102.103",
            "100.127.255.255",
            "fd7a:115c:a1e0::1",
            "::ffff:100.100.1.1",
        ] {
            assert!(allowed_peer(ok.parse().unwrap()), "{ok}");
        }
        for no in [
            "192.168.1.10",
            "10.0.0.2",
            "100.63.255.255",
            "100.128.0.1",
            "8.8.8.8",
            "fe80::1",
            "fd7a:115c:a1e1::1",
        ] {
            assert!(!allowed_peer(no.parse().unwrap()), "{no}");
        }
    }

    #[test]
    fn strangers_are_refused_before_the_token_is_checked() {
        assert_eq!(
            route("GET", "/", ip("192.168.1.5"), TOKEN, Some(TOKEN), false),
            Route::Reject(403, "Only this Mac and your Tailscale devices can connect.")
        );
        assert!(matches!(
            route("GET", "/", None, TOKEN, None, false),
            Route::Reject(403, _)
        ));
    }

    #[test]
    fn page_is_public_but_api_needs_the_token() {
        let peer = ip("100.80.1.2");
        assert_eq!(route("GET", "/", peer, TOKEN, None, false), Route::Page);
        assert!(matches!(
            route("GET", "/api/overview", peer, TOKEN, None, false),
            Route::Reject(401, _)
        ));
        assert!(matches!(
            route(
                "GET",
                "/api/overview",
                peer,
                TOKEN,
                Some("0123456789abcdef0123456789abcdee"),
                false
            ),
            Route::Reject(401, _)
        ));
        assert_eq!(
            route("GET", "/api/overview", peer, TOKEN, Some(TOKEN), false),
            Route::Api {
                action: "overview".into(),
                write: false
            }
        );
    }

    #[test]
    fn token_in_url_logs_in_only_when_right() {
        let peer = ip("127.0.0.1");
        assert_eq!(
            route("GET", &format!("/?token={TOKEN}"), peer, TOKEN, None, false),
            Route::Login
        );
        assert_eq!(
            route("GET", "/?token=nope", peer, TOKEN, None, false),
            Route::Page
        );
    }

    #[test]
    fn writes_need_post_and_the_header() {
        let peer = ip("127.0.0.1");
        assert!(matches!(
            route("GET", "/api/send", peer, TOKEN, Some(TOKEN), true),
            Route::Reject(405, _)
        ));
        assert!(matches!(
            route("POST", "/api/send", peer, TOKEN, Some(TOKEN), false),
            Route::Reject(403, _)
        ));
        assert_eq!(
            route("POST", "/api/approval", peer, TOKEN, Some(TOKEN), true),
            Route::Api {
                action: "approval".into(),
                write: true
            }
        );
        assert!(matches!(
            route("POST", "/api/overview", peer, TOKEN, Some(TOKEN), true),
            Route::Reject(405, _)
        ));
        assert!(matches!(
            route("POST", "/api/delete", peer, TOKEN, Some(TOKEN), true),
            Route::Reject(404, _)
        ));
    }

    #[test]
    fn serves_only_bundles_and_public_files_without_the_token() {
        let peer = ip("100.80.1.2");
        assert_eq!(
            route("GET", "/assets/web-Ab12_x.js", peer, TOKEN, None, false),
            Route::Static("/assets/web-Ab12_x.js".into())
        );
        assert_eq!(
            route("GET", "/web.webmanifest", peer, TOKEN, None, false),
            Route::Static("/web.webmanifest".into())
        );
        for path in [
            "/assets/../index.html",
            "/assets/.env",
            "/assets/",
            "/index.html",
            "/assets/a/b.js",
        ] {
            assert!(
                matches!(
                    route("GET", path, peer, TOKEN, None, false),
                    Route::Reject(404, _)
                ),
                "{path}"
            );
        }
        assert!(matches!(
            route(
                "GET",
                "/assets/web.js",
                ip("192.168.1.2"),
                TOKEN,
                None,
                false
            ),
            Route::Reject(403, _)
        ));
    }

    #[test]
    fn reads_the_cookie_and_query() {
        assert_eq!(cookie_token("a=1; irgatos_web=abc; b=2"), Some("abc"));
        assert_eq!(cookie_token("other=1"), None);
        assert_eq!(
            query_object("/api/session?id=s1&token=x"),
            json!({"id": "s1"})
        );
    }

    #[test]
    fn finds_the_tailscale_address() {
        let ifconfig = "lo0: flags\n\tinet 127.0.0.1 netmask 0xff000000\nen0: flags\n\tinet 192.168.1.20 netmask\nutun4: flags\n\tinet 100.88.7.6 --> 100.88.7.6 netmask 0xffffffff\n";
        assert_eq!(tailscale_ip_in(ifconfig), Some("100.88.7.6".into()));
        assert_eq!(tailscale_ip_in("en0:\n\tinet 10.0.0.1 netmask\n"), None);
    }

    #[test]
    fn tokens_compare_exactly() {
        assert!(same_token(TOKEN, TOKEN));
        assert!(!same_token(&TOKEN[1..], TOKEN));
        assert!(valid_token(&new_token()));
    }
}
