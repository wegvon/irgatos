//! MCP servers shared by every agent. The user adds a remote server once in
//! Settings > MCP, with its sign-in (the Executor key Mail already uses, or a
//! key saved in the Vault), and every agent Irgatos starts gets it, whatever
//! harness runs it.
//!
//! Agents never see the key. Each one gets a local stdio server instead,
//! `Irgatos mcp-bridge <id>`, which hands every JSON-RPC message to the app
//! over loopback; the app sends it upstream over Streamable HTTP with the
//! key added, and streams the answers back. A per-run token keeps other
//! local programs off the bridge.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

const CONFIG_FILE: &str = "shared-mcp.json";
pub const BRIDGE_COMMAND: &str = "mcp-bridge";
const ENDPOINT_ENV: &str = "IRGAT_MCP_ENDPOINT";
const TOKEN_ENV: &str = "IRGAT_MCP_TOKEN";
const MAX_SERVERS: usize = 24;
const MAX_NAME_CHARS: usize = 48;
const MAX_MESSAGE_BYTES: u64 = 8_000_000;
/// Tool calls can run long (Executor runs code), so reads wait this long.
const UPSTREAM_READ_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const UPSTREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PROTOCOL_VERSION_FALLBACK: &str = "2025-06-18";

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Auth {
    #[default]
    None,
    /// The API key saved for Mail on the Mail page.
    Executor,
    /// A key saved in Settings > Vault, sent as a Bearer token.
    Vault {
        #[serde(rename = "secretId")]
        secret_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default = "enabled_default")]
    pub enabled: bool,
}

fn enabled_default() -> bool {
    true
}

#[derive(Default, Deserialize, Serialize)]
struct Config {
    #[serde(default)]
    servers: Vec<Server>,
}

/// What a harness needs to start the bridge for one server.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSpec {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

struct Bridge {
    endpoint: String,
    token: String,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn load(dir: &Path) -> Config {
    std::fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(dir: &Path, config: &Config) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    crate::state_file::write_json_atomic(&dir.join(CONFIG_FILE), config, true)
}

/// Harnesses take the name as a tool prefix, so keep it to a safe slug.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= MAX_NAME_CHARS
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn checked_url(raw: &str) -> Result<String, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "Enter the server's full URL")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("MCP servers are reached over HTTPS (HTTP only on localhost)".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Put the sign-in in the Vault, not in the URL".into());
    }
    Ok(url.to_string())
}

fn validate(server: &Server, others: &[Server]) -> Result<(), String> {
    if !valid_name(&server.name) {
        return Err(format!(
            "Use letters, numbers, - and _ for the name (up to {MAX_NAME_CHARS})"
        ));
    }
    if others
        .iter()
        .any(|other| other.id != server.id && other.name.eq_ignore_ascii_case(&server.name))
    {
        return Err(format!("{} is already a shared server", server.name));
    }
    if let Auth::Vault { secret_id } = &server.auth {
        if secret_id.trim().is_empty() {
            return Err("Pick a Vault key".into());
        }
        if !server.url.starts_with("https://") {
            return Err("Vault keys are sent to HTTPS servers only".into());
        }
    }
    Ok(())
}

fn upsert(config: &mut Config, mut server: Server) -> Result<Server, String> {
    server.name = server.name.trim().to_string();
    server.url = checked_url(&server.url)?;
    if server.id.trim().is_empty() {
        server.id = uuid::Uuid::new_v4().simple().to_string();
    }
    validate(&server, &config.servers)?;
    match config.servers.iter_mut().find(|s| s.id == server.id) {
        Some(existing) => *existing = server.clone(),
        None => {
            if config.servers.len() >= MAX_SERVERS {
                return Err("Too many shared servers".into());
            }
            config.servers.push(server.clone());
        }
    }
    Ok(server)
}

fn launch_specs(servers: &[Server], exe: &str, bridge: &Bridge) -> Vec<LaunchSpec> {
    servers
        .iter()
        .filter(|server| server.enabled)
        .map(|server| LaunchSpec {
            name: server.name.clone(),
            command: exe.to_string(),
            args: vec![BRIDGE_COMMAND.to_string(), server.id.clone()],
            env: vec![
                (ENDPOINT_ENV.to_string(), bridge.endpoint.clone()),
                (TOKEN_ENV.to_string(), bridge.token.clone()),
            ],
        })
        .collect()
}

/// The bridge launch for every enabled shared server; empty before the
/// bridge listens or when nothing is shared.
pub fn specs(app: &AppHandle) -> Vec<LaunchSpec> {
    let (Some(bridge), Ok(dir), Ok(exe)) = (BRIDGE.get(), data_dir(app), std::env::current_exe())
    else {
        return Vec::new();
    };
    launch_specs(&load(&dir).servers, &exe.to_string_lossy(), bridge)
}

#[tauri::command]
pub fn shared_mcp_list(app: AppHandle) -> Result<Vec<Server>, String> {
    Ok(load(&data_dir(&app)?).servers)
}

#[tauri::command]
pub fn shared_mcp_save(app: AppHandle, server: Server) -> Result<Server, String> {
    let dir = data_dir(&app)?;
    let mut config = load(&dir);
    let saved = upsert(&mut config, server)?;
    save(&dir, &config)?;
    Ok(saved)
}

#[tauri::command]
pub fn shared_mcp_remove(app: AppHandle, id: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let mut config = load(&dir);
    config.servers.retain(|server| server.id != id);
    save(&dir, &config)
}

#[tauri::command]
pub fn shared_mcp_specs(app: AppHandle) -> Vec<LaunchSpec> {
    specs(&app)
}

/// The Executor Mail is connected to, ready to share: its MCP URL. None
/// until Mail has an endpoint and a key.
#[tauri::command]
pub fn shared_mcp_executor_url(app: AppHandle) -> Option<String> {
    crate::mail::executor_mcp_url(&app)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    server_name: String,
    tools: usize,
}

/// Signs in and lists the tools, the way an agent would.
#[tauri::command]
pub async fn shared_mcp_test(app: AppHandle, id: String) -> Result<TestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let server = find(&app, &id)?;
        let upstream = Upstream::new(app.clone(), server);
        let init = upstream.call(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION_FALLBACK,
                "capabilities": {},
                "clientInfo": {"name": "irgatos", "version": "1"}
            }
        }))?;
        let init = response_for(&init, 1)?;
        upstream.call(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))?;
        let tools = upstream.call(&json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}))?;
        let tools = response_for(&tools, 2)?;
        upstream.close();
        Ok(TestResult {
            server_name: init
                .pointer("/serverInfo/name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            tools: tools
                .get("tools")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn response_for(messages: &[Value], id: i64) -> Result<Value, String> {
    let message = messages
        .iter()
        .find(|m| m.get("id").and_then(Value::as_i64) == Some(id))
        .ok_or("The server did not answer")?;
    if let Some(error) = message.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("The server returned an error")
            .to_string());
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

fn find(app: &AppHandle, id: &str) -> Result<Server, String> {
    load(&data_dir(app)?)
        .servers
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| "This shared MCP server was removed in Irgatos".into())
}

/// The header value that signs a request in, fetched for every request so a
/// changed or removed key takes effect at once.
fn authorization(app: &AppHandle, server: &Server) -> Result<Option<Zeroizing<String>>, String> {
    let key = match &server.auth {
        Auth::None => return Ok(None),
        Auth::Executor => crate::mail::executor_key(app)?
            .map(Zeroizing::new)
            .ok_or("Connect Executor on the Mail page first")?,
        Auth::Vault { secret_id } => crate::secrets::mcp_value(app, secret_id, &server.url)?,
    };
    Ok(Some(Zeroizing::new(format!("Bearer {}", key.trim()))))
}

type Signer = Box<dyn Fn() -> Result<Option<Zeroizing<String>>, String> + Send + Sync>;

/// One agent's connection to one upstream server: the MCP session it opened.
struct Upstream {
    sign: Signer,
    server: Server,
    agent: ureq::Agent,
    session: Mutex<Option<String>>,
    protocol: Mutex<Option<String>>,
}

impl Upstream {
    fn new(app: AppHandle, server: Server) -> Self {
        let signed = server.clone();
        Self::with_signer(server, Box::new(move || authorization(&app, &signed)))
    }

    fn with_signer(server: Server, sign: Signer) -> Self {
        Self {
            sign,
            server,
            agent: ureq::AgentBuilder::new()
                .timeout_connect(UPSTREAM_CONNECT_TIMEOUT)
                .timeout_read(UPSTREAM_READ_TIMEOUT)
                .build(),
            session: Mutex::new(None),
            protocol: Mutex::new(None),
        }
    }

    fn request(&self, method: &str) -> Result<ureq::Request, String> {
        let mut request = self
            .agent
            .request(method, &self.server.url)
            .set("Accept", "application/json, text/event-stream");
        if let Some(value) = (self.sign)()? {
            request = request.set("Authorization", value.as_str());
        }
        if let Some(session) = self
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            request = request.set("Mcp-Session-Id", &session);
        }
        if let Some(protocol) = self
            .protocol
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            request = request.set("MCP-Protocol-Version", &protocol);
        }
        Ok(request)
    }

    /// Sends one message and passes each message that comes back to `emit`,
    /// as it arrives.
    fn send(&self, message: &Value, emit: &mut dyn FnMut(Value)) -> Result<(), String> {
        let response = self
            .request("POST")?
            .set("Content-Type", "application/json")
            .send_string(&message.to_string());
        let response = match response {
            Ok(response) => response,
            Err(ureq::Error::Status(401 | 403, _)) if self.server.auth == Auth::None => {
                return Err(format!(
                    "{} needs a sign-in; pick one for it in Irgatos Settings > MCP",
                    self.server.name
                ))
            }
            Err(ureq::Error::Status(401 | 403, _)) => {
                return Err(format!(
                    "{} rejected the sign-in saved in Irgatos",
                    self.server.name
                ))
            }
            Err(ureq::Error::Status(404, _)) if self.session_id().is_some() => {
                *self.session.lock().unwrap_or_else(|e| e.into_inner()) = None;
                return Err(format!(
                    "{} ended this MCP session; restart the chat",
                    self.server.name
                ));
            }
            Err(ureq::Error::Status(status, _)) => {
                return Err(format!("{} answered HTTP {status}", self.server.name))
            }
            Err(_) => return Err(format!("Could not reach {}", self.server.name)),
        };
        if let Some(session) = response.header("mcp-session-id") {
            *self.session.lock().unwrap_or_else(|e| e.into_inner()) = Some(session.to_string());
        }
        if response.status() == 202 {
            return Ok(());
        }
        let streaming = response.content_type() == "text/event-stream";
        let reader = response.into_reader().take(MAX_MESSAGE_BYTES);
        let mut emit_one = |value: Value| {
            if let Some(version) = value
                .pointer("/result/protocolVersion")
                .and_then(Value::as_str)
            {
                *self.protocol.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(version.to_string());
            }
            emit(value);
        };
        if streaming {
            read_events(BufReader::new(reader), &mut emit_one)
        } else {
            let mut body = String::new();
            BufReader::new(reader)
                .read_to_string(&mut body)
                .map_err(|_| format!("{} sent an unreadable answer", self.server.name))?;
            if body.trim().is_empty() {
                return Ok(());
            }
            match serde_json::from_str::<Value>(&body) {
                Ok(Value::Array(batch)) => batch.into_iter().for_each(&mut emit_one),
                Ok(value) => emit_one(value),
                Err(_) => return Err(format!("{} sent an unreadable answer", self.server.name)),
            }
            Ok(())
        }
    }

    fn call(&self, message: &Value) -> Result<Vec<Value>, String> {
        let mut out = Vec::new();
        self.send(message, &mut |value| out.push(value))?;
        Ok(out)
    }

    fn session_id(&self) -> Option<String> {
        self.session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Ends the upstream session, as the spec asks of a client that leaves.
    fn close(&self) {
        if self.session_id().is_some() {
            if let Ok(request) = self.request("DELETE") {
                let _ = request.timeout(Duration::from_secs(5)).call();
            }
        }
    }
}

/// Server-sent events: each event's `data:` lines joined are one message.
fn read_events(reader: impl BufRead, emit: &mut dyn FnMut(Value)) -> Result<(), String> {
    let mut data = String::new();
    let mut flush = |data: &mut String| {
        if let Ok(value) = serde_json::from_str::<Value>(data) {
            emit(value);
        }
        data.clear();
    };
    for line in reader.lines() {
        let line = line.map_err(|_| "The MCP server's stream broke off".to_string())?;
        let line = line.strip_suffix('\r').unwrap_or(&line);
        if line.is_empty() {
            flush(&mut data);
        } else if let Some(chunk) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(chunk.strip_prefix(' ').unwrap_or(chunk));
        }
    }
    if !data.is_empty() {
        flush(&mut data);
    }
    Ok(())
}

/// A JSON-RPC error for a request the upstream could not answer, so the
/// agent does not wait forever.
fn error_reply(message: &Value, error: &str) -> Option<Value> {
    let id = message.get("id")?;
    message.get("method")?;
    Some(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": error}}))
}

#[derive(Deserialize)]
struct Hello {
    token: String,
    server: String,
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .to_string();
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let _ = BRIDGE.set(Bridge { endpoint, token });
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || serve(stream, app));
        }
    });
    Ok(())
}

fn serve(stream: TcpStream, app: AppHandle) {
    let Some(bridge) = BRIDGE.get() else { return };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    if (&mut reader).take(4096).read_line(&mut line).is_err() {
        return;
    }
    let server = match serde_json::from_str::<Hello>(&line) {
        Ok(hello) if constant_time_eq(hello.token.as_bytes(), bridge.token.as_bytes()) => {
            find(&app, &hello.server)
        }
        _ => return,
    };
    let server = match server {
        Ok(server) if server.enabled => server,
        Ok(server) => return eprintln!("shared MCP: {} is turned off", server.name),
        Err(error) => return eprintln!("shared MCP: {error}"),
    };
    let scrub_app = app.clone();
    relay(
        reader,
        Upstream::new(app, server),
        // Agents read these into the model: no saved secret goes back.
        Arc::new(move |value: &mut Value| crate::secrets::scrub_for_model(&scrub_app, value)),
    );
}

/// Passes each line from the bridge upstream and every answer back, until
/// the bridge hangs up.
fn relay(
    mut reader: BufReader<TcpStream>,
    upstream: Upstream,
    scrub: Arc<dyn Fn(&mut Value) + Send + Sync>,
) {
    let _ = reader.get_ref().set_read_timeout(None);
    let Ok(writer) = reader.get_ref().try_clone() else {
        return;
    };
    let writer = Arc::new(Mutex::new(writer));
    let write = move |mut value: Value| {
        scrub(&mut value);
        if let Ok(mut writer) = writer.lock() {
            let _ = writeln!(writer, "{value}");
            let _ = writer.flush();
        }
    };
    let upstream = Arc::new(upstream);
    let mut line = String::new();
    loop {
        line.clear();
        match (&mut reader).take(MAX_MESSAGE_BYTES).read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        let handshake = message.get("method").and_then(Value::as_str) == Some("initialize");
        let run = {
            let upstream = upstream.clone();
            let write = write.clone();
            move || {
                let mut answered = false;
                let mut emit = |value: Value| {
                    answered |= value.get("id").is_some() && value.get("id") == message.get("id");
                    write(value)
                };
                if let Err(error) = upstream.send(&message, &mut emit) {
                    // A stream that broke after the answer needs no second one.
                    if let Some(reply) = error_reply(&message, &error).filter(|_| !answered) {
                        write(reply);
                    }
                }
            }
        };
        // The handshake sets up the session the rest needs, so it finishes
        // first; everything after may run side by side.
        if handshake {
            run();
        } else {
            std::thread::spawn(run);
        }
    }
    upstream.close();
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `Irgatos mcp-bridge <id>`: the stdio MCP server an agent starts. It only
/// relays lines between the agent and the app.
pub fn run_bridge(args: Vec<String>) -> i32 {
    let fail = |message: &str| {
        eprintln!("irgatos mcp-bridge: {message}");
        1
    };
    let Some(server) = args.first() else {
        return fail("usage: mcp-bridge <server id>");
    };
    let (Ok(endpoint), Ok(token)) = (std::env::var(ENDPOINT_ENV), std::env::var(TOKEN_ENV)) else {
        return fail("start this from an agent Irgatos launched");
    };
    let Ok(address) = endpoint.parse::<SocketAddr>() else {
        return fail("invalid Irgatos endpoint");
    };
    if !address.ip().is_loopback() {
        return fail("Irgatos is only reached on localhost");
    }
    let mut stream = match TcpStream::connect_timeout(&address, Duration::from_secs(3)) {
        Ok(stream) => stream,
        Err(error) => return fail(&format!("cannot reach Irgatos ({error}); is it running?")),
    };
    if writeln!(stream, "{}", json!({"token": token, "server": server})).is_err() {
        return fail("Irgatos closed the connection");
    }
    let Ok(mut upload) = stream.try_clone() else {
        return fail("cannot open the connection");
    };
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut std::io::stdin().lock(), &mut upload);
        let _ = upload.shutdown(std::net::Shutdown::Write);
    });
    let mut stdout = std::io::stdout().lock();
    for line in BufReader::new(stream).lines() {
        let Ok(line) = line else { break };
        if writeln!(stdout, "{line}")
            .and_then(|_| stdout.flush())
            .is_err()
        {
            break;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(name: &str, url: &str, auth: Auth) -> Server {
        Server {
            id: String::new(),
            name: name.into(),
            url: url.into(),
            auth,
            enabled: true,
        }
    }

    #[test]
    fn saves_checked_servers_with_unique_names() {
        let mut config = Config::default();
        let saved = upsert(
            &mut config,
            server(
                "executor",
                "https://executor.example.com/mcp",
                Auth::Executor,
            ),
        )
        .unwrap();
        assert_eq!(saved.id.len(), 32);
        assert!(upsert(
            &mut config,
            server("Executor", "https://other.example/mcp", Auth::None)
        )
        .unwrap_err()
        .contains("already"));
        assert!(upsert(
            &mut config,
            server("bad name", "https://x.example", Auth::None)
        )
        .is_err());
        assert!(upsert(
            &mut config,
            server("plain", "http://x.example/mcp", Auth::None)
        )
        .is_err());
        assert!(upsert(
            &mut config,
            server("local", "http://localhost:4788/mcp", Auth::None)
        )
        .is_ok());
        assert!(upsert(
            &mut config,
            server("creds", "https://user:pw@x.example/mcp", Auth::None)
        )
        .is_err());
        let mut renamed = saved.clone();
        renamed.name = "exec".into();
        upsert(&mut config, renamed).unwrap();
        assert_eq!(config.servers.len(), 2);
        assert_eq!(config.servers[0].name, "exec");
    }

    #[test]
    fn vault_keys_only_go_to_https() {
        let mut config = Config::default();
        let auth = Auth::Vault {
            secret_id: "abc".into(),
        };
        assert!(upsert(
            &mut config,
            server("local", "http://localhost:1/mcp", auth.clone())
        )
        .is_err());
        assert!(upsert(&mut config, server("remote", "https://x.example/mcp", auth)).is_ok());
    }

    #[test]
    fn auth_round_trips_through_json() {
        let parsed: Server = serde_json::from_value(json!({
            "id": "1", "name": "n", "url": "https://x.example",
            "auth": {"kind": "vault", "secretId": "s"}
        }))
        .unwrap();
        assert_eq!(
            parsed.auth,
            Auth::Vault {
                secret_id: "s".into()
            }
        );
        assert!(parsed.enabled);
        let none: Server =
            serde_json::from_value(json!({"id": "1", "name": "n", "url": "https://x.example"}))
                .unwrap();
        assert_eq!(none.auth, Auth::None);
        assert_eq!(
            serde_json::to_value(Auth::Executor).unwrap(),
            json!({"kind": "executor"})
        );
    }

    #[test]
    fn launches_only_enabled_servers_through_the_bridge() {
        let bridge = Bridge {
            endpoint: "127.0.0.1:9".into(),
            token: "t".into(),
        };
        let mut off = server("off", "https://x.example", Auth::None);
        off.enabled = false;
        let mut on = server("on", "https://x.example", Auth::None);
        on.id = "id1".into();
        let specs = launch_specs(&[off, on], "/A/Irgatos", &bridge);
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].name, "on");
        assert_eq!(specs[0].command, "/A/Irgatos");
        assert_eq!(specs[0].args, vec!["mcp-bridge", "id1"]);
        assert!(specs[0].env.contains(&(TOKEN_ENV.into(), "t".into())));
    }

    #[test]
    fn reads_event_streams_message_by_message() {
        let raw = "event: message\ndata: {\"id\":1,\ndata: \"result\":{}}\n\n: ping\n\ndata: {\"id\":2}\r\n\r\ndata: not json\n\ndata: {\"id\":3}";
        let mut seen = Vec::new();
        read_events(raw.as_bytes(), &mut |v| seen.push(v)).unwrap();
        assert_eq!(
            seen,
            vec![
                json!({"id":1,"result":{}}),
                json!({"id":2}),
                json!({"id":3})
            ]
        );
    }

    #[test]
    fn errors_answer_requests_but_not_notifications() {
        let reply = error_reply(&json!({"id": 7, "method": "tools/call"}), "down").unwrap();
        assert_eq!(reply["id"], 7);
        assert_eq!(reply["error"]["message"], "down");
        assert!(error_reply(&json!({"method": "notifications/initialized"}), "down").is_none());
        assert!(error_reply(&json!({"id": 7, "result": {}}), "down").is_none());
    }

    /// A Streamable HTTP server that wants a sign-in and a session, and
    /// answers in JSON, as an event stream, with 202 or with an error.
    fn mock_upstream() -> (String, Arc<Mutex<Vec<String>>>) {
        let http = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}/mcp", http.server_addr().to_ip().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for mut request in http.incoming_requests() {
                let header = |name: &str| {
                    request
                        .headers()
                        .iter()
                        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
                        .map(|h| h.value.to_string())
                };
                let auth = header("Authorization");
                let session = header("Mcp-Session-Id");
                let protocol = header("MCP-Protocol-Version");
                let mut body = String::new();
                let _ = request.as_reader().read_to_string(&mut body);
                let message: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let method = message["method"].as_str().unwrap_or_default().to_string();
                log.lock().unwrap().push(format!(
                    "{} {method} {}",
                    request.method(),
                    protocol.unwrap_or_default()
                ));
                let respond = |status: u16, kind: &str, text: String| {
                    tiny_http::Response::from_string(text)
                        .with_status_code(status)
                        .with_header(tiny_http::Header::from_bytes("Content-Type", kind).unwrap())
                };
                if auth.as_deref() != Some("Bearer k") {
                    let _ = request.respond(respond(401, "text/plain", String::new()));
                    continue;
                }
                if method == "initialize" {
                    let reply = json!({"jsonrpc": "2.0", "id": message["id"], "result": {
                        "protocolVersion": "2025-06-18", "serverInfo": {"name": "mock"}}});
                    let _ = request.respond(
                        respond(200, "application/json", reply.to_string()).with_header(
                            tiny_http::Header::from_bytes("Mcp-Session-Id", "s1").unwrap(),
                        ),
                    );
                    continue;
                }
                if session.as_deref() != Some("s1") {
                    let _ = request.respond(respond(400, "text/plain", String::new()));
                    continue;
                }
                let response = match method.as_str() {
                    "" => respond(200, "text/plain", String::new()),
                    "notifications/initialized" => respond(202, "text/plain", String::new()),
                    "tools/list" => respond(
                        200,
                        "text/event-stream",
                        format!(
                            "data: {}\n\ndata: {}\n\n",
                            json!({"jsonrpc": "2.0", "method": "notifications/progress"}),
                            json!({"jsonrpc": "2.0", "id": message["id"],
                                "result": {"tools": [{"name": "execute", "description": "uses k"}]}})
                        ),
                    ),
                    _ => respond(500, "text/plain", "boom".into()),
                };
                let _ = request.respond(response);
            }
        });
        (url, seen)
    }

    #[test]
    fn relays_a_session_with_the_key_added_and_scrubbed() {
        let (url, seen) = mock_upstream();
        let upstream = Upstream::with_signer(
            server("mock", &url, Auth::None),
            Box::new(|| Ok(Some(Zeroizing::new("Bearer k".to_string())))),
        );
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut agent = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (app_side, _) = listener.accept().unwrap();
        let relayed = std::thread::spawn(move || {
            relay(
                BufReader::new(app_side),
                upstream,
                Arc::new(|value: &mut Value| {
                    let text = value.to_string().replace("uses k", "uses [hidden]");
                    *value = serde_json::from_str(&text).unwrap();
                }),
            )
        });
        let mut answers = BufReader::new(agent.try_clone().unwrap()).lines();
        let mut next = || serde_json::from_str::<Value>(&answers.next().unwrap().unwrap()).unwrap();
        writeln!(
            agent,
            "{}",
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})
        )
        .unwrap();
        assert_eq!(next()["result"]["serverInfo"]["name"], "mock");
        writeln!(
            agent,
            "{}",
            json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        )
        .unwrap();
        writeln!(
            agent,
            "{}",
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})
        )
        .unwrap();
        assert_eq!(next()["method"], "notifications/progress");
        let tools = next();
        assert_eq!(tools["id"], 2);
        assert_eq!(tools["result"]["tools"][0]["description"], "uses [hidden]");
        writeln!(
            agent,
            "{}",
            json!({"jsonrpc":"2.0","id":3,"method":"tools/call"})
        )
        .unwrap();
        let failed = next();
        assert_eq!(failed["id"], 3);
        assert_eq!(failed["error"]["message"], "mock answered HTTP 500");
        agent.shutdown(std::net::Shutdown::Both).unwrap();
        relayed.join().unwrap();
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen[0], "POST initialize ");
        assert!(seen.contains(&"POST tools/list 2025-06-18".to_string()));
        assert_eq!(seen.last().unwrap(), "DELETE  2025-06-18");
    }

    #[test]
    fn a_rejected_key_comes_back_as_an_error_not_a_hang() {
        let (url, _) = mock_upstream();
        let upstream = Upstream::with_signer(
            server("mock", &url, Auth::Executor),
            Box::new(|| Ok(Some(Zeroizing::new("Bearer wrong".to_string())))),
        );
        let messages = upstream.call(&json!({"jsonrpc":"2.0","id":1,"method":"initialize"}));
        assert_eq!(
            messages.unwrap_err(),
            "mock rejected the sign-in saved in Irgatos"
        );
        let unsigned =
            Upstream::with_signer(server("mock", &url, Auth::None), Box::new(|| Ok(None)));
        let messages = unsigned.call(&json!({"jsonrpc":"2.0","id":1,"method":"initialize"}));
        assert!(messages.unwrap_err().contains("needs a sign-in"));
    }

    #[test]
    fn compares_tokens_in_full() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}
