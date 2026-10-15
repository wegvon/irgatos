//! Whether the remote services Irgatos leans on answer right now, for the
//! status chip in the bottom bar. The webview names services by id and the
//! URLs come from the app's own settings, so it cannot point a probe at an
//! arbitrary host. A probe is one unauthenticated GET on the service's
//! origin: any HTTP answer means the host is up, except the gateway errors a
//! proxy or tunnel returns when the service behind it is down.

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

const TIMEOUT: Duration = Duration::from_secs(6);
/// Slower than this reads as "slow", not "online".
const SLOW_AFTER: Duration = Duration::from_millis(2_000);

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Online,
    Slow,
    Offline,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    id: String,
    host: String,
    state: State,
    latency_ms: Option<u64>,
    /// Why it is offline, or the HTTP status a slow or odd answer carried.
    detail: Option<String>,
}

/// The URL behind a service id, when that service is set up.
fn endpoint(app: &AppHandle, id: &str) -> Option<String> {
    match id {
        "embed" => crate::semantic_index::status_endpoint(app),
        "executor" => crate::mail::status_endpoint(app),
        "asr" => Some(crate::voice::TRANSCRIPTION_ENDPOINT.to_string()),
        _ => id
            .strip_prefix("tts:")
            .and_then(crate::voice::speech_endpoint)
            .map(str::to_string),
    }
}

/// `https://host[:port]/`, the part a probe touches.
fn origin(raw: &str) -> Option<(url::Url, String)> {
    let mut url = url::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "https" | "http") {
        return None;
    }
    let host = url.host_str()?.to_string();
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    let _ = url.set_username("");
    let _ = url.set_password(None);
    Some((url, host))
}

/// Gateway answers: the proxy or tunnel is up but the service is not.
fn gateway_down(status: u16) -> bool {
    matches!(status, 502..=504 | 520..=530)
}

fn classify(answer: Result<u16, String>, took: Duration) -> (State, Option<String>) {
    match answer {
        Ok(status) if gateway_down(status) => (State::Offline, Some(format!("HTTP {status}"))),
        Ok(_) if took > SLOW_AFTER => (State::Slow, None),
        Ok(_) => (State::Online, None),
        Err(error) => (State::Offline, Some(error)),
    }
}

fn probe(id: String, raw: Option<String>) -> Option<ServiceStatus> {
    let (url, host) = origin(&raw?)?;
    let agent = ureq::AgentBuilder::new()
        .timeout(TIMEOUT)
        .redirects(0)
        .build();
    let started = Instant::now();
    let answer = match agent.get(url.as_str()).call() {
        Ok(response) => Ok(response.status()),
        Err(ureq::Error::Status(status, _)) => Ok(status),
        Err(ureq::Error::Transport(error)) => Err(match error.kind() {
            ureq::ErrorKind::Dns => "Host not found".to_string(),
            ureq::ErrorKind::ConnectionFailed => "Connection refused".to_string(),
            ureq::ErrorKind::Io => "No answer in time".to_string(),
            _ => error.to_string(),
        }),
    };
    let took = started.elapsed();
    let reached = answer.is_ok();
    let (state, detail) = classify(answer, took);
    Some(ServiceStatus {
        id,
        host,
        state,
        latency_ms: reached.then_some(took.as_millis() as u64),
        detail,
    })
}

/// Probes the named services side by side; ids that are not set up are left out.
#[tauri::command]
pub async fn service_status_check(app: AppHandle, ids: Vec<String>) -> Vec<ServiceStatus> {
    let mut ids = ids;
    ids.sort();
    ids.dedup();
    ids.truncate(16);
    let jobs: Vec<_> = ids
        .into_iter()
        .map(|id| {
            let raw = endpoint(&app, &id);
            tauri::async_runtime::spawn_blocking(move || probe(id, raw))
        })
        .collect();
    let mut out = Vec::new();
    for job in jobs {
        if let Ok(Some(status)) = job.await {
            out.push(status);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn serve(status: u16) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
            }
        });
        format!("http://{address}/v1/embeddings?x=1")
    }

    #[test]
    fn origin_drops_path_query_and_credentials() {
        let (url, host) = origin("https://user:pw@embed.turel.se/v1/embeddings?k=1#f").unwrap();
        assert_eq!(url.as_str(), "https://embed.turel.se/");
        assert_eq!(host, "embed.turel.se");
        assert!(origin("ftp://embed.turel.se").is_none());
        assert!(origin("not a url").is_none());
    }

    #[test]
    fn any_answer_is_up_but_gateway_errors_are_down() {
        let fast = Duration::from_millis(100);
        assert_eq!(classify(Ok(200), fast).0, State::Online);
        assert_eq!(classify(Ok(404), fast).0, State::Online);
        assert_eq!(classify(Ok(401), fast).0, State::Online);
        assert_eq!(classify(Ok(429), fast).0, State::Online);
        assert_eq!(classify(Ok(200), Duration::from_secs(3)).0, State::Slow);
        assert_eq!(classify(Ok(502), fast).0, State::Offline);
        assert_eq!(classify(Ok(530), fast).0, State::Offline);
        assert_eq!(classify(Err("x".into()), fast).0, State::Offline);
    }

    #[test]
    fn probes_the_origin_of_a_live_server() {
        let up = probe("embed".into(), Some(serve(404))).unwrap();
        assert_eq!(up.state, State::Online);
        assert!(up.latency_ms.is_some());
        let down = probe("embed".into(), Some(serve(502))).unwrap();
        assert_eq!(down.state, State::Offline);
        assert_eq!(down.detail.as_deref(), Some("HTTP 502"));
    }

    #[test]
    fn a_closed_port_is_offline() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let status = probe("embed".into(), Some(format!("http://{address}/"))).unwrap();
        assert_eq!(status.state, State::Offline);
        assert!(status.latency_ms.is_none());
    }

    #[test]
    fn unset_services_are_left_out() {
        assert!(probe("embed".into(), None).is_none());
    }
}
