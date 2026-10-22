//! Qwen streaming protocol: 16 kHz mono float32 PCM, without a WAV header.
use super::{audio, Sink, VoiceEvent};
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, SyncSender},
    Arc,
};
use std::time::Duration;

pub const ENDPOINT: &str = "https://qasr.turel.se";

pub struct Stream {
    pub sender: SyncSender<Vec<f32>>,
    cancelled: Arc<AtomicBool>,
}

impl Stream {
    pub fn start(capture: String, sample_rate: f64, sink: Sink) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Vec<f32>>(512);
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancel = cancelled.clone();
        std::thread::spawn(move || {
            let result = run(ENDPOINT, sample_rate, receiver, &cancel, |text| {
                sink(VoiceEvent::Partial {
                    capture: capture.clone(),
                    text,
                });
            });
            if cancel.load(Ordering::Acquire) {
                return;
            }
            sink(match result {
                Ok(text) => VoiceEvent::Final { capture, text },
                Err(message) => VoiceEvent::Error { capture, message },
            });
        });
        Self { sender, cancelled }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

#[derive(Deserialize)]
struct Started {
    session_id: String,
}
#[derive(Deserialize)]
struct Transcript {
    text: String,
}

fn run(
    endpoint: &str,
    sample_rate: f64,
    receiver: mpsc::Receiver<Vec<f32>>,
    cancelled: &AtomicBool,
    partial: impl Fn(String),
) -> Result<String, String> {
    let agent = client();
    let session = start_session(&agent, endpoint)?;
    let finish_url = session_url(endpoint, "finish", &session)?;
    let chunk_url = session_url(endpoint, "chunk", &session)?;
    let samples_per_chunk = sample_rate.round().max(1.0) as usize;
    let result = (|| {
        let mut pending = Vec::new();
        while !cancelled.load(Ordering::Acquire) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(samples) => pending.extend(samples),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            while pending.len() >= samples_per_chunk {
                if cancelled.load(Ordering::Acquire) {
                    return Ok(());
                }
                let tail = pending.split_off(samples_per_chunk);
                send_chunk(&agent, chunk_url.as_str(), &pending, sample_rate, &partial)?;
                pending = tail;
            }
        }
        if !cancelled.load(Ordering::Acquire) && !pending.is_empty() {
            send_chunk(&agent, chunk_url.as_str(), &pending, sample_rate, &partial)?;
        }
        Ok::<_, String>(())
    })();
    // Every started session is closed, including cancellation and chunk errors.
    let finish = finish_session(&agent, finish_url.as_str());
    result?;
    finish
}

fn finish_session(agent: &ureq::Agent, url: &str) -> Result<String, String> {
    let response = agent
        .post(url)
        .call()
        .map_err(|error| format!("Qwen ASR: {error}"))?;
    response
        .into_string()
        .map_err(|e| e.to_string())
        .and_then(|body| serde_json::from_str::<Transcript>(&body).map_err(|e| e.to_string()))
        .map(|reply| reply.text)
        .map_err(|_| "Qwen ASR returned an invalid transcript".to_string())
}

fn client() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .redirects(0)
        .build()
}

fn start_session(agent: &ureq::Agent, endpoint: &str) -> Result<String, String> {
    let start = agent
        .post(&format!("{endpoint}/api/start"))
        .call()
        .map_err(|error| format!("Qwen ASR: {error}"))?;
    let started: Started = serde_json::from_str(&start.into_string().map_err(|e| e.to_string())?)
        .map_err(|_| "Qwen ASR returned an invalid session".to_string())?;
    Ok(started.session_id)
}

fn session_url(endpoint: &str, step: &str, session: &str) -> Result<url::Url, String> {
    let mut url =
        url::Url::parse(&format!("{endpoint}/api/{step}")).map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("session_id", session);
    Ok(url)
}

/// Dictation from the browser companion: the phone records and sends 16 kHz
/// pieces through the Mac, so the Qwen session lives between calls.
pub struct Relay {
    endpoint: String,
}

impl Relay {
    pub fn new() -> Self {
        Self::at(ENDPOINT)
    }

    fn at(endpoint: &str) -> Self {
        Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
        }
    }

    pub fn start(&self) -> Result<String, String> {
        start_session(&client(), &self.endpoint)
    }

    /// The transcript so far, after this piece.
    pub fn chunk(&self, session: &str, samples: &[f32]) -> Result<String, String> {
        let url = session_url(&self.endpoint, "chunk", session)?;
        let text = std::cell::RefCell::new(String::new());
        send_chunk(&client(), url.as_str(), samples, 16_000.0, &|partial| {
            *text.borrow_mut() = partial;
        })?;
        Ok(text.into_inner())
    }

    pub fn finish(&self, session: &str) -> Result<String, String> {
        let url = session_url(&self.endpoint, "finish", session)?;
        finish_session(&client(), url.as_str())
    }
}

fn send_chunk(
    agent: &ureq::Agent,
    url: &str,
    samples: &[f32],
    sample_rate: f64,
    partial: &impl Fn(String),
) -> Result<(), String> {
    let pcm = audio::resample(samples, sample_rate, 16_000.0);
    let bytes: Vec<u8> = pcm
        .iter()
        .flat_map(|value| {
            (if value.is_finite() {
                value.clamp(-1.0, 1.0)
            } else {
                0.0
            })
            .to_le_bytes()
        })
        .collect();
    let response = agent
        .post(url)
        .set("Content-Type", "application/octet-stream")
        .send_bytes(&bytes)
        .map_err(|error| format!("Qwen ASR: {error}"))?;
    let reply: Transcript =
        serde_json::from_str(&response.into_string().map_err(|e| e.to_string())?)
            .map_err(|_| "Qwen ASR returned an invalid transcript".to_string())?;
    partial(reply.text);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn sends_float32_chunks_in_order_and_finishes_the_session() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for (path, reply) in [
                ("/api/start", r#"{"session_id":"test-session"}"#),
                (
                    "/api/chunk?session_id=test-session",
                    r#"{"text":"Merhaba"}"#,
                ),
                (
                    "/api/chunk?session_id=test-session",
                    r#"{"text":"Merhaba dünya"}"#,
                ),
                (
                    "/api/finish?session_id=test-session",
                    r#"{"text":"Merhaba dünya."}"#,
                ),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut received = Vec::new();
                let mut buffer = [0u8; 8192];
                let header_end = loop {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    received.extend_from_slice(&buffer[..count]);
                    if let Some(index) = received.windows(4).position(|part| part == b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&received[..header_end]).into_owned();
                assert!(headers.starts_with(&format!("POST {path} ")));
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .map(|s| s.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                while received.len() - header_end < length {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    received.extend_from_slice(&buffer[..count]);
                }
                if path.contains("/chunk") {
                    assert!(headers.to_lowercase().contains("application/octet-stream"));
                    assert_eq!(length, 64_000);
                    assert_eq!(
                        f32::from_le_bytes(
                            received[header_end..header_end + 4].try_into().unwrap()
                        ),
                        0.25
                    );
                }
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", reply.len(), reply).unwrap();
            }
        });
        let (tx, rx) = mpsc::sync_channel(4);
        tx.send(vec![0.25; 96_000]).unwrap();
        drop(tx);
        let partials = std::sync::Mutex::new(Vec::new());
        let result = run(&endpoint, 48_000.0, rx, &AtomicBool::new(false), |text| {
            partials.lock().unwrap().push(text)
        })
        .unwrap();
        assert_eq!(result, "Merhaba dünya.");
        assert_eq!(*partials.lock().unwrap(), ["Merhaba", "Merhaba dünya"]);
        server.join().unwrap();
    }

    /// Answers each expected request in turn and reports the chunk sizes.
    fn scripted(
        replies: Vec<(&'static str, &'static str)>,
    ) -> (String, std::thread::JoinHandle<Vec<usize>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut sizes = Vec::new();
            for (path, reply) in replies {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut received = Vec::new();
                let mut buffer = [0u8; 8192];
                let header_end = loop {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    received.extend_from_slice(&buffer[..count]);
                    if let Some(index) = received.windows(4).position(|part| part == b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&received[..header_end]).into_owned();
                assert!(headers.starts_with(&format!("POST {path} ")), "{headers}");
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .map(|s| s.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                while received.len() - header_end < length {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    received.extend_from_slice(&buffer[..count]);
                }
                sizes.push(length);
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", reply.len(), reply).unwrap();
            }
            sizes
        });
        (endpoint, server)
    }

    #[test]
    fn the_relay_keeps_the_session_between_calls() {
        let (endpoint, server) = scripted(vec![
            ("/api/start", r#"{"session_id":"phone"}"#),
            ("/api/chunk?session_id=phone", r#"{"text":"Merhaba"}"#),
            ("/api/finish?session_id=phone", r#"{"text":"Merhaba."}"#),
        ]);
        let relay = Relay::at(&endpoint);
        let session = relay.start().unwrap();
        assert_eq!(session, "phone");
        assert_eq!(relay.chunk(&session, &[0.5; 16_000]).unwrap(), "Merhaba");
        assert_eq!(relay.finish(&session).unwrap(), "Merhaba.");
        // 16 kHz float32 goes on as it came.
        assert_eq!(server.join().unwrap(), [0, 64_000, 0]);
    }
}
