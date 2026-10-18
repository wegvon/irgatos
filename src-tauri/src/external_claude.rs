//! Claude Code sessions running outside Irgatos: in a terminal, an editor or
//! Claude Desktop. Claude Code keeps one `~/.claude/sessions/<pid>.json` per
//! live session with its name, folder, busy/idle state and the Unix socket it
//! takes messages from peers on. Irgatos lists them in Fleet, lets a Irgat post
//! a message into an idle one with `claude.send`, and reads the session's
//! answer back from its transcript (`~/.claude/projects/<dir>/<id>.jsonl`).
//! Sessions Irgatos started itself are left out: they are already its own.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const POLL: Duration = Duration::from_secs(2);
const MAX_WAIT_SECS: u64 = 60 * 60;
const MAX_MESSAGE_CHARS: usize = 240_000;

/// One entry of Claude Code's live-session registry, as it writes it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryEntry {
    pid: u32,
    session_id: Option<String>,
    cwd: Option<String>,
    name: Option<String>,
    status: Option<String>,
    status_updated_at: Option<i64>,
    started_at: Option<i64>,
    messaging_socket_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalClaudeSession {
    session_id: String,
    pid: u32,
    cwd: String,
    name: Option<String>,
    /// `busy` or `idle`, as Claude Code reports it.
    status: String,
    status_updated_at: Option<i64>,
    started_at: Option<i64>,
    /// It has a peer inbox, so a Irgat can message it.
    can_message: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalClaudeSent {
    /// Transcript length before the message, where the answer is looked for.
    offset: u64,
    sent_at: i64,
}

fn claude_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|dir| !dir.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    crate::dirs_home().map(|home| Path::new(&home).join(".claude"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    if pid <= 0 {
        return false;
    }
    // Signal 0 only checks; EPERM still means the process exists.
    let found = unsafe { libc::kill(pid, 0) } == 0;
    found || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn pid_alive(_pid: u32) -> bool {
    false
}

/// Every process's parent, read once per listing.
fn parent_pids() -> HashMap<u32, u32> {
    let Ok(output) = std::process::Command::new("ps")
        .args(["-A", "-o", "pid=,ppid="])
        .output()
    else {
        return HashMap::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
        })
        .collect()
}

fn descends_from(pid: u32, ancestor: u32, parents: &HashMap<u32, u32>) -> bool {
    let mut current = pid;
    for _ in 0..64 {
        if current == ancestor {
            return true;
        }
        match parents.get(&current) {
            Some(&parent) if parent != current && parent > 1 => current = parent,
            _ => return false,
        }
    }
    false
}

fn read_registry(dir: &Path) -> Vec<RegistryEntry> {
    let Ok(entries) = std::fs::read_dir(dir.join("sessions")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .filter_map(|path| serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok())
        .collect()
}

/// Live sessions not started by `own_pid`, newest first.
fn scan(
    dir: &Path,
    own_pid: u32,
    alive: impl Fn(u32) -> bool,
    parents: &HashMap<u32, u32>,
) -> Vec<(ExternalClaudeSession, RegistryEntry)> {
    let mut sessions: Vec<_> = read_registry(dir)
        .into_iter()
        .filter(|entry| alive(entry.pid) && !descends_from(entry.pid, own_pid, parents))
        .filter_map(|entry| {
            let session = ExternalClaudeSession {
                session_id: entry.session_id.clone().filter(|id| !id.is_empty())?,
                pid: entry.pid,
                cwd: entry.cwd.clone().unwrap_or_default(),
                name: entry.name.clone().filter(|name| !name.trim().is_empty()),
                status: entry.status.clone().unwrap_or_else(|| "idle".into()),
                status_updated_at: entry.status_updated_at,
                started_at: entry.started_at,
                can_message: entry.messaging_socket_path.is_some(),
            };
            Some((session, entry))
        })
        .collect();
    sessions.sort_by_key(|(session, _)| std::cmp::Reverse(session.started_at));
    sessions
}

fn live(dir: &Path) -> Vec<(ExternalClaudeSession, RegistryEntry)> {
    scan(dir, std::process::id(), pid_alive, &parent_pids())
}

fn find(dir: &Path, session_id: &str) -> Option<(ExternalClaudeSession, RegistryEntry)> {
    live(dir)
        .into_iter()
        .find(|(session, _)| session.session_id == session_id)
}

/// The token Claude Code wants from peers where its inbox requires one; it
/// leaves it in `sessions/<pid>.<hash>.key`. Sent when present, never shown.
fn peer_token(dir: &Path, pid: u32) -> Option<String> {
    let prefix = format!("{pid}.");
    std::fs::read_dir(dir.join("sessions"))
        .ok()?
        .flatten()
        .find_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if !name.starts_with(&prefix) || !name.ends_with(".key") {
                return None;
            }
            let value: Value = serde_json::from_slice(&std::fs::read(entry.path()).ok()?).ok()?;
            value["peerToken"].as_str().map(str::to_string)
        })
}

/// `projects/<dir>/<session>.jsonl`, wherever Claude Code put that folder.
fn transcript_path(dir: &Path, session_id: &str) -> Option<PathBuf> {
    let file = format!("{session_id}.jsonl");
    std::fs::read_dir(dir.join("projects"))
        .ok()?
        .flatten()
        .map(|entry| entry.path().join(&file))
        .find(|path| path.is_file())
}

fn file_len(path: Option<&Path>) -> u64 {
    path.and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len())
        .unwrap_or_default()
}

#[cfg(unix)]
fn post(socket: &str, token: Option<&str>, text: &str) -> std::io::Result<()> {
    let mut stream = std::os::unix::net::UnixStream::connect(socket)?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    // One write: the inbox closes a connection that sends no complete line soon.
    let mut frames = String::new();
    if let Some(token) = token {
        frames.push_str(&json!({ "type": "auth", "token": token }).to_string());
        frames.push('\n');
    }
    frames.push_str(
        &json!({ "type": "user", "message": { "role": "user", "content": text } }).to_string(),
    );
    frames.push('\n');
    stream.write_all(frames.as_bytes())?;
    stream.flush()
}

#[cfg(not(unix))]
fn post(_socket: &str, _token: Option<&str>, _text: &str) -> std::io::Result<()> {
    Err(std::io::Error::other("unsupported on this platform"))
}

fn send(dir: &Path, session_id: &str, text: &str) -> Result<ExternalClaudeSent, String> {
    if text.trim().is_empty() || text.chars().count() > MAX_MESSAGE_CHARS {
        return Err("The message is empty or too long".into());
    }
    let (session, entry) =
        find(dir, session_id).ok_or("That Claude Code session is no longer running")?;
    let socket = entry.messaging_socket_path.ok_or(
        "That Claude Code session does not take messages; it may need a newer Claude Code",
    )?;
    if session.status == "busy" {
        return Err("That Claude Code session is busy; try again when it finishes".into());
    }
    let offset = file_len(transcript_path(dir, session_id).as_deref());
    let sent_at = now_ms();
    post(&socket, peer_token(dir, entry.pid).as_deref(), text)
        .map_err(|error| format!("Could not reach that Claude Code session: {error}"))?;
    Ok(ExternalClaudeSent { offset, sent_at })
}

/// The text of an assistant transcript line, when it says something.
fn assistant_text(line: &Value) -> Option<String> {
    if line["type"] != "assistant" || line["isSidechain"] == true {
        return None;
    }
    let content = &line["message"]["content"];
    let text = match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    Some(text).filter(|text| !text.trim().is_empty())
}

/// Whether the transcript after `offset` holds the message carrying `marker`,
/// and the last thing the assistant said after it.
fn reply_since(path: &Path, offset: u64, marker: &str) -> (bool, Option<String>) {
    let Ok(mut file) = std::fs::File::open(path) else {
        return (false, None);
    };
    // A rewritten (shorter) transcript is read from the start.
    let start = if file_len(Some(path)) < offset {
        0
    } else {
        offset
    };
    let mut appended = String::new();
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_to_string(&mut appended).is_err() {
        return (false, None);
    }
    let Some(at) = appended.find(marker) else {
        return (false, None);
    };
    let after = appended[at..].split_once('\n').map_or("", |(_, rest)| rest);
    let reply = after
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find_map(|line| assistant_text(&line));
    (true, reply)
}

fn wait_reply(
    dir: &Path,
    session_id: &str,
    marker: &str,
    offset: u64,
    sent_at: i64,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut transcript = None;
    loop {
        let current = find(dir, session_id);
        if transcript.is_none() {
            transcript = transcript_path(dir, session_id);
        }
        let (seen, reply) = transcript
            .as_deref()
            .map(|path| reply_since(path, offset, marker))
            .unwrap_or_default();
        match current {
            None => {
                return reply
                    .ok_or_else(|| "The Claude Code session closed before it answered".into())
            }
            Some((session, _)) => {
                let settled = session.status == "idle"
                    && session.status_updated_at.is_some_and(|at| at >= sent_at);
                if seen && settled {
                    if let Some(reply) = reply {
                        return Ok(reply);
                    }
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("The Claude Code session did not answer in time".into());
        }
        std::thread::sleep(POLL);
    }
}

#[tauri::command]
pub async fn external_claude_sessions() -> Vec<ExternalClaudeSession> {
    tauri::async_runtime::spawn_blocking(|| {
        claude_dir()
            .map(|dir| live(&dir).into_iter().map(|(session, _)| session).collect())
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn external_claude_send(
    session_id: String,
    text: String,
) -> Result<ExternalClaudeSent, String> {
    tauri::async_runtime::spawn_blocking(move || {
        send(&claude_dir().ok_or("No home folder")?, &session_id, &text)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Waits for the answer to a message `external_claude_send` posted.
#[tauri::command]
pub async fn external_claude_wait_reply(
    session_id: String,
    marker: String,
    offset: u64,
    sent_at: i64,
    timeout_secs: u64,
) -> Result<String, String> {
    if marker.trim().len() < 8 {
        return Err("Invalid marker".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        wait_reply(
            &claude_dir().ok_or("No home folder")?,
            &session_id,
            &marker,
            offset,
            sent_at,
            Duration::from_secs(timeout_secs.clamp(1, MAX_WAIT_SECS)),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry(dir: &Path, pid: u32, body: Value) {
        std::fs::create_dir_all(dir.join("sessions")).unwrap();
        std::fs::write(dir.join(format!("sessions/{pid}.json")), body.to_string()).unwrap();
    }

    #[test]
    fn lists_live_sessions_not_started_by_irgatos() {
        let dir = tempfile::tempdir().unwrap();
        registry(
            dir.path(),
            10,
            json!({"pid":10,"sessionId":"a","cwd":"/w/api","name":"api","status":"busy","startedAt":1,"messagingSocketPath":"/tmp/a.sock"}),
        );
        registry(
            dir.path(),
            11,
            json!({"pid":11,"sessionId":"b","cwd":"/w/web","status":"idle","startedAt":2}),
        );
        registry(
            dir.path(),
            12,
            json!({"pid":12,"sessionId":"dead","startedAt":3}),
        );
        registry(
            dir.path(),
            13,
            json!({"pid":13,"sessionId":"ours","startedAt":4}),
        );
        std::fs::write(
            dir.path().join("sessions/10.abc.key"),
            r#"{"peerToken":"t"}"#,
        )
        .unwrap();
        // 13 is a grandchild of Irgatos (pid 1000) through a shell.
        let parents = HashMap::from([(13, 500), (500, 1000), (1000, 1), (10, 1), (11, 77)]);
        let found = scan(dir.path(), 1000, |pid| pid != 12, &parents);
        let ids: Vec<_> = found.iter().map(|(s, _)| s.session_id.as_str()).collect();
        assert_eq!(ids, ["b", "a"]);
        assert!(found[1].0.can_message && !found[0].0.can_message);
        assert_eq!(found[0].0.name, None);
        assert_eq!(peer_token(dir.path(), 10).as_deref(), Some("t"));
        assert_eq!(peer_token(dir.path(), 11), None);
    }

    #[test]
    fn reads_the_last_answer_after_the_marker() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        let lines = [
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"old"}]}}),
            json!({"type":"user","message":{"content":"hi <irgat_message id=\"irgatos-m1\">"}}),
            json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}),
            json!({"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"sub"}]}}),
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"first"}]}}),
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"final"}]}}),
        ];
        let text: String = lines.iter().map(|l| format!("{l}\n")).collect();
        std::fs::write(&path, &text).unwrap();
        assert_eq!(
            reply_since(&path, 0, "irgatos-m1"),
            (true, Some("final".into()))
        );
        assert_eq!(reply_since(&path, 0, "irgatos-m2"), (false, None));
        let after_marker = text.find("first").unwrap() as u64;
        assert_eq!(
            reply_since(&path, after_marker, "irgatos-m1"),
            (false, None)
        );
        // A transcript shorter than the offset was rewritten: read it all.
        assert!(reply_since(&path, 1 << 30, "irgatos-m1").0);
    }

    #[cfg(unix)]
    #[test]
    fn posts_a_user_frame_and_waits_for_the_answer() {
        use std::io::BufRead;
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("s.sock");
        let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        // A live process that Irgatos (this test) did not start.
        let pid = std::os::unix::process::parent_id();
        let entry = |status: &str, at: i64| {
            json!({"pid":pid,"sessionId":"s1","cwd":"/w","status":status,"statusUpdatedAt":at,
                   "messagingSocketPath":socket.to_str().unwrap()})
        };
        registry(dir.path(), pid, entry("busy", 0));
        assert!(send(dir.path(), "s1", "hi").unwrap_err().contains("busy"));
        registry(dir.path(), pid, entry("idle", 0));
        std::fs::create_dir_all(dir.path().join("projects/-w")).unwrap();
        let transcript = dir.path().join("projects/-w/s1.jsonl");
        std::fs::write(&transcript, "{\"type\":\"summary\"}\n").unwrap();

        let sent = send(dir.path(), "s1", "hello irgatos-abc").unwrap();
        assert_eq!(sent.offset, 19);
        let (stream, _) = listener.accept().unwrap();
        let frame: Value = serde_json::from_str(
            &std::io::BufReader::new(stream)
                .lines()
                .next()
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            frame,
            json!({"type":"user","message":{"role":"user","content":"hello irgatos-abc"}})
        );

        let mut log = std::fs::OpenOptions::new()
            .append(true)
            .open(&transcript)
            .unwrap();
        writeln!(
            log,
            "{}",
            json!({"type":"user","message":{"content":"hello irgatos-abc"}})
        )
        .unwrap();
        writeln!(
            log,
            "{}",
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}})
        )
        .unwrap();
        // Still busy, then idle again after the message.
        registry(dir.path(), pid, entry("busy", sent.sent_at));
        let short = Duration::from_millis(10);
        assert!(wait_reply(
            dir.path(),
            "s1",
            "irgatos-abc",
            sent.offset,
            sent.sent_at,
            short
        )
        .is_err());
        registry(dir.path(), pid, entry("idle", sent.sent_at + 1));
        assert_eq!(
            wait_reply(
                dir.path(),
                "s1",
                "irgatos-abc",
                sent.offset,
                sent.sent_at,
                short
            )
            .unwrap(),
            "done"
        );
    }

    #[test]
    fn ancestry_stops_on_cycles_and_init() {
        let parents = HashMap::from([(5, 6), (6, 5), (7, 1)]);
        assert!(!descends_from(5, 9, &parents));
        assert!(!descends_from(7, 9, &parents));
        assert!(descends_from(9, 9, &parents));
    }
}
