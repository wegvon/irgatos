//! A loopback-only HTTP endpoint that lets scripts, CI jobs and other local
//! tools fire an Irgat habit: `POST /habits/<token>`. Each habit that opts in
//! has its own random token, which is the only credential. The listener runs
//! only while at least one token exists, and every request becomes a
//! `habit-webhook` event that the app's scheduler acts on.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const HABIT_WEBHOOK_EVENT: &str = "habit-webhook";
/// Stable across launches so saved trigger commands keep working.
pub const PREFERRED_PORT: u16 = 47615;
const MAX_BODY_BYTES: usize = 16 * 1024;
const MIN_INTERVAL: Duration = Duration::from_secs(2);
const MAX_TOKENS: usize = 500;
const RECV_POLL: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitWebhookEvent {
    pub token: String,
    /// The request body, when there was one, as text.
    pub payload: Option<String>,
    pub received_at: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitWebhookInfo {
    /// None while no habit has a trigger, or when the port could not open.
    pub port: Option<u16>,
    pub error: Option<String>,
}

#[derive(Default)]
struct Registry {
    tokens: HashSet<String>,
    last_hit: HashMap<String, Instant>,
}

struct Running {
    port: u16,
    stop: Arc<AtomicBool>,
}

static REGISTRY: Mutex<Option<Registry>> = Mutex::new(None);
static RUNNING: Mutex<Option<Running>> = Mutex::new(None);

/// Tokens come from the app; anything else is not worth a lookup.
pub(crate) fn valid_token(token: &str) -> bool {
    (24..=128).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

/// Only loopback names may address the listener, which keeps a web page that
/// rebinds its own DNS name to 127.0.0.1 from reaching it.
fn loopback_host(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    let host = host.trim().to_ascii_lowercase();
    ["127.0.0.1", "localhost", "[::1]"]
        .iter()
        .any(|name| host == *name || host == format!("{name}:{port}"))
}

#[derive(Debug, PartialEq, Eq)]
struct Reply {
    status: u16,
    body: &'static str,
}

const fn reply(status: u16, body: &'static str) -> Reply {
    Reply { status, body }
}

/// Decides one request. Pure apart from the rate-limit clock in `registry`.
fn decide(
    registry: &mut Registry,
    method: &str,
    path: &str,
    host: Option<&str>,
    port: u16,
    body_len: Option<usize>,
    now: Instant,
) -> Result<String, Reply> {
    if !loopback_host(host, port) {
        return Err(reply(403, "{\"error\":\"forbidden host\"}"));
    }
    let path = path.split('?').next().unwrap_or_default();
    let Some(token) = path.strip_prefix("/habits/") else {
        return Err(reply(404, "{\"error\":\"not found\"}"));
    };
    if !valid_token(token) || !registry.tokens.contains(token) {
        return Err(reply(404, "{\"error\":\"unknown trigger\"}"));
    }
    if !method.eq_ignore_ascii_case("POST") {
        return Err(reply(405, "{\"error\":\"use POST\"}"));
    }
    if body_len.is_some_and(|len| len > MAX_BODY_BYTES) {
        return Err(reply(413, "{\"error\":\"body over 16 KB\"}"));
    }
    if let Some(last) = registry.last_hit.get(token) {
        if now.duration_since(*last) < MIN_INTERVAL {
            return Err(reply(429, "{\"error\":\"too many requests\"}"));
        }
    }
    registry.last_hit.insert(token.to_owned(), now);
    Ok(token.to_owned())
}

fn with_registry<T>(f: impl FnOnce(&mut Registry) -> T) -> T {
    let mut guard = REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(Registry::default))
}

fn read_body(request: &mut tiny_http::Request) -> Result<Option<String>, Reply> {
    let mut bytes = Vec::new();
    let read = request
        .as_reader()
        .take(MAX_BODY_BYTES as u64 + 1)
        .read_to_end(&mut bytes);
    if read.is_err() {
        return Err(reply(400, "{\"error\":\"unreadable body\"}"));
    }
    if bytes.len() > MAX_BODY_BYTES {
        return Err(reply(413, "{\"error\":\"body over 16 KB\"}"));
    }
    let text = String::from_utf8_lossy(&bytes).trim().to_owned();
    Ok((!text.is_empty()).then_some(text))
}

fn respond(request: tiny_http::Request, outcome: Reply) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).ok();
    let mut response =
        tiny_http::Response::from_string(outcome.body).with_status_code(outcome.status);
    if let Some(header) = header {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

fn serve(
    mut request: tiny_http::Request,
    port: u16,
    on_event: &(dyn Fn(HabitWebhookEvent) + Send + Sync),
) {
    let host = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Host"))
        .map(|header| header.value.as_str().to_owned());
    let decided = with_registry(|registry| {
        decide(
            registry,
            request.method().as_str(),
            request.url(),
            host.as_deref(),
            port,
            request.body_length(),
            Instant::now(),
        )
    });
    let token = match decided {
        Ok(token) => token,
        Err(outcome) => return respond(request, outcome),
    };
    let payload = match read_body(&mut request) {
        Ok(payload) => payload,
        Err(outcome) => return respond(request, outcome),
    };
    on_event(HabitWebhookEvent {
        token,
        payload,
        received_at: now_ms(),
    });
    respond(request, reply(202, "{\"ok\":true}"));
}

fn bind() -> Result<tiny_http::Server, String> {
    tiny_http::Server::http(("127.0.0.1", PREFERRED_PORT))
        .or_else(|_| tiny_http::Server::http(("127.0.0.1", 0)))
        .map_err(|error| format!("Could not open a local port: {error}"))
}

fn start(on_event: Arc<dyn Fn(HabitWebhookEvent) + Send + Sync>) -> Result<Running, String> {
    let server = bind()?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or("The listener has no TCP port")?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = stop.clone();
    std::thread::Builder::new()
        .name("habit-webhook".into())
        .spawn(move || {
            while !stopping.load(Ordering::SeqCst) {
                match server.recv_timeout(RECV_POLL) {
                    Ok(Some(request)) => serve(request, port, on_event.as_ref()),
                    Ok(None) => {}
                    Err(_) => std::thread::sleep(RECV_POLL),
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(Running { port, stop })
}

/// Replaces the accepted tokens and starts or stops the listener to match.
pub(crate) fn sync(
    tokens: Vec<String>,
    on_event: impl Fn(HabitWebhookEvent) + Send + Sync + 'static,
) -> HabitWebhookInfo {
    let tokens: HashSet<String> = tokens
        .into_iter()
        .filter(|token| valid_token(token))
        .take(MAX_TOKENS)
        .collect();
    let wanted = !tokens.is_empty();
    with_registry(|registry| {
        registry.last_hit.retain(|token, _| tokens.contains(token));
        registry.tokens = tokens;
    });
    let mut running = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    if !wanted {
        if let Some(current) = running.take() {
            current.stop.store(true, Ordering::SeqCst);
        }
        return HabitWebhookInfo::default();
    }
    if let Some(current) = running.as_ref() {
        return HabitWebhookInfo {
            port: Some(current.port),
            error: None,
        };
    }
    match start(Arc::new(on_event)) {
        Ok(started) => {
            let port = started.port;
            *running = Some(started);
            HabitWebhookInfo {
                port: Some(port),
                error: None,
            }
        }
        Err(error) => HabitWebhookInfo {
            port: None,
            error: Some(error),
        },
    }
}

/// The app passes every habit trigger token it knows; an empty list closes
/// the port.
#[tauri::command]
pub fn habit_webhook_sync(app: AppHandle, tokens: Vec<String>) -> HabitWebhookInfo {
    sync(tokens, move |event| {
        let _ = app.emit(HABIT_WEBHOOK_EVENT, event);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;
    use std::sync::mpsc;

    const TOKEN: &str = "abcdefghijklmnopqrstuvwx1234";

    fn registry() -> Registry {
        Registry {
            tokens: HashSet::from([TOKEN.to_owned()]),
            last_hit: HashMap::new(),
        }
    }

    fn call(registry: &mut Registry, method: &str, path: &str, host: &str) -> Result<String, u16> {
        decide(
            registry,
            method,
            path,
            Some(host),
            4000,
            Some(10),
            Instant::now(),
        )
        .map_err(|reply| reply.status)
    }

    #[test]
    fn accepts_a_known_token_from_loopback() {
        let mut registry = registry();
        let path = format!("/habits/{TOKEN}?source=ci");
        assert_eq!(
            call(&mut registry, "POST", &path, "127.0.0.1:4000"),
            Ok(TOKEN.to_owned())
        );
    }

    #[test]
    fn rejects_foreign_hosts_paths_methods_and_tokens() {
        let mut registry = registry();
        let path = format!("/habits/{TOKEN}");
        assert_eq!(
            call(&mut registry, "POST", &path, "evil.example:4000"),
            Err(403)
        );
        assert_eq!(
            call(&mut registry, "POST", &path, "127.0.0.1:9999"),
            Err(403)
        );
        assert_eq!(
            call(&mut registry, "POST", "/other", "localhost:4000"),
            Err(404)
        );
        assert_eq!(
            call(
                &mut registry,
                "POST",
                "/habits/unknownunknownunknown12345",
                "localhost"
            ),
            Err(404)
        );
        assert_eq!(
            call(&mut registry, "POST", "/habits/short", "localhost"),
            Err(404)
        );
        assert_eq!(
            call(&mut registry, "GET", &path, "localhost:4000"),
            Err(405)
        );
    }

    #[test]
    fn rate_limits_each_token() {
        let mut registry = registry();
        let path = format!("/habits/{TOKEN}");
        let start = Instant::now();
        let mut at = |offset: Duration| {
            decide(
                &mut registry,
                "POST",
                &path,
                Some("[::1]:4000"),
                4000,
                None,
                start + offset,
            )
            .map_err(|reply| reply.status)
        };
        assert!(at(Duration::ZERO).is_ok());
        assert_eq!(at(Duration::from_millis(500)), Err(429));
        assert!(at(Duration::from_secs(3)).is_ok());
    }

    #[test]
    fn refuses_large_bodies_up_front() {
        let mut registry = registry();
        let result = decide(
            &mut registry,
            "POST",
            &format!("/habits/{TOKEN}"),
            Some("localhost"),
            4000,
            Some(MAX_BODY_BYTES + 1),
            Instant::now(),
        );
        assert_eq!(result.map_err(|reply| reply.status), Err(413));
    }

    #[test]
    fn validates_token_shape() {
        assert!(valid_token(TOKEN));
        assert!(valid_token(&"a".repeat(128)));
        assert!(!valid_token(&"a".repeat(129)));
        assert!(!valid_token("has spaces in it but long enough"));
        assert!(!valid_token("../../../../../etc/passwd/xx"));
    }

    fn post(port: u16, path: &str, body: &str) -> u16 {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(
            stream,
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut status = String::new();
        BufReader::new(stream).read_line(&mut status).unwrap();
        status
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0)
    }

    #[test]
    fn serves_triggers_and_closes_when_no_tokens_remain() {
        let (sender, events) = mpsc::channel();
        let sender = Mutex::new(sender);
        let info = sync(vec![TOKEN.to_owned(), "bad token".into()], move |event| {
            let _ = sender.lock().unwrap().send(event);
        });
        let port = info.port.expect("listener port");
        assert_eq!(info.error, None);
        assert_eq!(
            post(port, &format!("/habits/{TOKEN}"), "{\"ref\":\"main\"}"),
            202
        );
        let event = events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event.token, TOKEN);
        assert_eq!(event.payload.as_deref(), Some("{\"ref\":\"main\"}"));
        assert_eq!(post(port, "/habits/nope-nope-nope-nope-nope-nope", ""), 404);

        let again = sync(vec![TOKEN.to_owned()], |_| {});
        assert_eq!(again.port, Some(port));

        assert_eq!(sync(Vec::new(), |_| {}), HabitWebhookInfo::default());
        std::thread::sleep(RECV_POLL * 3);
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }
}
