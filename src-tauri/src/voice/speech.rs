//! Speech services generate WAV audio; the local player only plays the resulting file.
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

pub const EVENT: &str = "irgat:voice-speech";
const MAX_AUDIO_BYTES: u64 = 32 * 1024 * 1024;
const POLL: Duration = Duration::from_millis(40);

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpeechProvider {
    #[default]
    Drama,
    Ema,
    Kahya,
}

impl SpeechProvider {
    fn endpoint(self) -> &'static str {
        match self {
            Self::Drama => "https://drama.turel.se/v1/audio/speech",
            Self::Ema => "https://ema.turel.se/v1/tts",
            Self::Kahya => "https://tts.turel.se/api/tts",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Drama => "Drama",
            Self::Ema => "EMA Lightning",
            Self::Kahya => "Kahya TTS",
        }
    }

    fn chunk_limit(self) -> usize {
        match self {
            // Drama caps generation at 512 tokens; short chunks leave room to finish.
            Self::Drama => 60,
            Self::Ema | Self::Kahya => 2000,
        }
    }

    fn body(self, text: &str) -> serde_json::Value {
        match self {
            Self::Drama => serde_json::json!({
                "input": text, "response_format": "wav", "max_new_tokens": 512
            }),
            Self::Ema => serde_json::json!({ "text": text, "speed": 1.0, "seed": 42 }),
            Self::Kahya => serde_json::json!({ "text": text, "seed": 42 }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEnded {
    pub id: String,
    pub interrupted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct Playback {
    child: Mutex<Option<Child>>,
    interrupted: AtomicBool,
}

pub struct Speaker {
    current: Mutex<Option<(String, Arc<Playback>)>>,
}

impl Speaker {
    pub const fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }

    pub fn speak(
        &'static self,
        provider: SpeechProvider,
        id: String,
        text: String,
        on_end: impl FnOnce(SpeechEnded) + Send + 'static,
    ) -> Result<(), String> {
        if !cfg!(target_os = "macos") {
            return Err("Speech playback is available on macOS for now".into());
        }
        self.speak_at(
            provider,
            provider.endpoint().into(),
            "/usr/bin/afplay".into(),
            id,
            text,
            on_end,
        );
        Ok(())
    }

    fn speak_at(
        &'static self,
        provider: SpeechProvider,
        endpoint: String,
        player: String,
        id: String,
        text: String,
        on_end: impl FnOnce(SpeechEnded) + Send + 'static,
    ) {
        let playback = Arc::new(Playback {
            child: Mutex::new(None),
            interrupted: AtomicBool::new(false),
        });
        let mut current = self.lock();
        if let Some((_, previous)) = current.take() {
            stop(&previous);
        }
        *current = Some((id.clone(), playback.clone()));
        drop(current);
        std::thread::spawn(move || {
            let result = (|| {
                for text in speech_chunks(&text, provider.chunk_limit()) {
                    if playback.interrupted.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    let audio = generate(provider, &endpoint, text)?;
                    {
                        // Stop cannot race between the cancellation check and spawn.
                        let mut child = playback.child.lock().unwrap_or_else(|p| p.into_inner());
                        if playback.interrupted.load(Ordering::Acquire) {
                            return Ok(());
                        }
                        *child = Some(
                            Command::new(&player)
                                .arg(audio.path())
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .spawn()
                                .map_err(|error| format!("Could not play speech audio: {error}"))?,
                        );
                    }
                    loop {
                        let status = playback
                            .child
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .as_mut()
                            .expect("player started")
                            .try_wait()
                            .map_err(|error| format!("Speech playback failed: {error}"))?;
                        if let Some(status) = status {
                            if !status.success() && !playback.interrupted.load(Ordering::Acquire) {
                                return Err("Speech audio could not be played".into());
                            }
                            break;
                        }
                        std::thread::sleep(POLL);
                    }
                }
                Ok(())
            })();
            let interrupted = playback.interrupted.load(Ordering::Acquire);
            {
                let mut current = self.lock();
                if current
                    .as_ref()
                    .is_some_and(|(_, active)| Arc::ptr_eq(active, &playback))
                {
                    *current = None;
                }
            }
            on_end(SpeechEnded {
                id,
                interrupted,
                error: if interrupted { None } else { result.err() },
            });
        });
    }

    pub fn stop_if(&self, id: Option<&str>) {
        let mut current = self.lock();
        if current
            .as_ref()
            .is_some_and(|(active, _)| id.is_none_or(|id| id == active))
        {
            if let Some((_, playback)) = current.take() {
                stop(&playback);
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<(String, Arc<Playback>)>> {
        self.current.lock().unwrap_or_else(|p| p.into_inner())
    }
}

fn stop(playback: &Playback) {
    let mut child = playback.child.lock().unwrap_or_else(|p| p.into_inner());
    playback.interrupted.store(true, Ordering::Release);
    if let Some(child) = child.as_mut() {
        let _ = child.kill();
    }
}

fn speech_chunks(mut text: &str, limit: usize) -> Vec<&str> {
    let mut chunks = Vec::new();
    text = text.trim();
    while let Some((limit, _)) = text.char_indices().nth(limit) {
        let end = text[..limit]
            .rfind(char::is_whitespace)
            .filter(|i| *i > 0)
            .unwrap_or(limit);
        chunks.push(text[..end].trim());
        text = text[end..].trim_start();
    }
    if !text.is_empty() {
        chunks.push(text);
    }
    chunks
}

fn generate(
    provider: SpeechProvider,
    endpoint: &str,
    text: &str,
) -> Result<tempfile::NamedTempFile, String> {
    let body = provider.body(text);
    let response = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(120))
        .redirects(0)
        .build()
        .post(endpoint)
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|error| match error {
            ureq::Error::Status(429, _) => {
                format!("{} is busy. Try again shortly.", provider.name())
            }
            error => format!("{}: {error}", provider.name()),
        })?;
    let limit = if provider == SpeechProvider::Kahya {
        MAX_AUDIO_BYTES.div_ceil(3) * 4 + 1024
    } else {
        MAX_AUDIO_BYTES
    };
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("{} audio download failed: {error}", provider.name()))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{} audio is too large", provider.name()));
    }
    if provider == SpeechProvider::Kahya {
        #[derive(Deserialize)]
        struct KahyaResponse {
            wav_b64: String,
        }
        let response: KahyaResponse = serde_json::from_slice(&bytes)
            .map_err(|error| format!("Kahya TTS returned invalid audio: {error}"))?;
        bytes = STANDARD
            .decode(response.wav_b64)
            .map_err(|error| format!("Kahya TTS returned invalid audio: {error}"))?;
    }
    if bytes.len() as u64 > MAX_AUDIO_BYTES
        || bytes.len() < 44
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return Err(format!("{} returned invalid WAV audio", provider.name()));
    }
    let mut file = tempfile::Builder::new()
        .prefix("irgat-speech-")
        .suffix(".wav")
        .tempfile()
        .map_err(|error| error.to_string())?;
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(file)
}

pub fn speakable(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || c.is_whitespace())
        .collect::<String>()
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc;

    fn server(audio: Vec<u8>) -> (String, mpsc::Receiver<serde_json::Value>, mpsc::Sender<()>) {
        server_response(audio, "200 OK")
    }

    fn server_response(
        audio: Vec<u8>,
        status: &'static str,
    ) -> (String, mpsc::Receiver<serde_json::Value>, mpsc::Sender<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1/audio/speech", listener.local_addr().unwrap());
        let (sent, request) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut received = Vec::new();
            let mut buffer = [0; 4096];
            let end = loop {
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                received.extend_from_slice(&buffer[..n]);
                if let Some(i) = received.windows(4).position(|s| s == b"\r\n\r\n") {
                    break i + 4;
                }
            };
            let headers = String::from_utf8_lossy(&received[..end]).into_owned();
            assert!(headers.starts_with("POST /v1/audio/speech "));
            assert!(headers
                .to_lowercase()
                .contains("content-type: application/json"));
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    line.to_lowercase()
                        .strip_prefix("content-length:")
                        .map(|s| s.trim().parse().unwrap())
                })
                .unwrap();
            while received.len() - end < length {
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                received.extend_from_slice(&buffer[..n]);
            }
            sent.send(serde_json::from_slice(&received[end..end + length]).unwrap())
                .unwrap();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                audio.len()
            )
            .unwrap();
            stream.write_all(&audio).unwrap();
        });
        (endpoint, request, release)
    }

    fn wav() -> Vec<u8> {
        let mut bytes = vec![0; 44];
        bytes[..4].copy_from_slice(b"RIFF");
        bytes[8..12].copy_from_slice(b"WAVE");
        bytes
    }

    #[test]
    fn drama_request_downloads_private_audio_and_cleans_it_up() {
        let (endpoint, request, release) = server(wav());
        let worker =
            std::thread::spawn(move || generate(SpeechProvider::Drama, &endpoint, "Merhaba"));
        assert_eq!(
            request.recv_timeout(Duration::from_secs(5)).unwrap(),
            serde_json::json!({
                "input": "Merhaba", "response_format": "wav", "max_new_tokens": 512
            })
        );
        release.send(()).unwrap();
        let file = worker.join().unwrap().unwrap();
        let path = file.path().to_path_buf();
        assert!(path.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                file.as_file().metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(file);
        assert!(!path.exists());
    }

    #[test]
    fn ema_and_kahya_requests_decode_their_audio_formats() {
        for (provider, audio, body) in [
            (
                SpeechProvider::Ema,
                wav(),
                serde_json::json!({
                    "text": "Türkçe bir deneme", "speed": 1.0, "seed": 42
                }),
            ),
            (
                SpeechProvider::Kahya,
                serde_json::to_vec(&serde_json::json!({
                    "wav_b64": STANDARD.encode(wav()), "sample_rate": 48000
                }))
                .unwrap(),
                serde_json::json!({
                    "text": "Türkçe bir deneme", "seed": 42
                }),
            ),
        ] {
            let (endpoint, request, release) = server(audio);
            let worker =
                std::thread::spawn(move || generate(provider, &endpoint, "Türkçe bir deneme"));
            assert_eq!(request.recv_timeout(Duration::from_secs(5)).unwrap(), body);
            release.send(()).unwrap();
            let file = worker.join().unwrap().unwrap();
            assert_eq!(std::fs::read(file.path()).unwrap(), wav());
        }
    }

    #[test]
    fn busy_and_malformed_service_responses_are_reported() {
        for (provider, audio, status, expected) in [
            (
                SpeechProvider::Ema,
                Vec::new(),
                "429 Too Many Requests",
                "EMA Lightning is busy",
            ),
            (
                SpeechProvider::Kahya,
                b"not JSON".to_vec(),
                "200 OK",
                "invalid audio",
            ),
            (
                SpeechProvider::Kahya,
                br#"{"wav_b64":"invalid!"}"#.to_vec(),
                "200 OK",
                "invalid audio",
            ),
            (
                SpeechProvider::Kahya,
                serde_json::to_vec(&serde_json::json!({
                    "wav_b64": STANDARD.encode("not a WAV")
                }))
                .unwrap(),
                "200 OK",
                "invalid WAV",
            ),
        ] {
            let (endpoint, request, release) = server_response(audio, status);
            let worker = std::thread::spawn(move || generate(provider, &endpoint, "Merhaba"));
            request.recv_timeout(Duration::from_secs(5)).unwrap();
            release.send(()).unwrap();
            assert!(worker.join().unwrap().unwrap_err().contains(expected));
        }
    }

    #[test]
    fn stopping_during_generation_prevents_playback() {
        let speaker = Box::leak(Box::new(Speaker::new()));
        let (endpoint, request, release) = server(wav());
        let (tx, rx) = mpsc::channel();
        speaker.speak_at(
            SpeechProvider::Drama,
            endpoint,
            "/nonexistent/player".into(),
            "a".into(),
            "Hi".into(),
            move |end| {
                tx.send(end).unwrap();
            },
        );
        request.recv_timeout(Duration::from_secs(5)).unwrap();
        speaker.stop_if(Some("stale"));
        assert!(speaker.lock().is_some());
        speaker.stop_if(Some("a"));
        release.send(()).unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            SpeechEnded {
                id: "a".into(),
                interrupted: true,
                error: None
            }
        );
        assert!(speaker.lock().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn playback_finishes_and_can_be_interrupted_by_a_new_reply() {
        use std::os::unix::fs::PermissionsExt;
        let mut player = tempfile::NamedTempFile::new().unwrap();
        writeln!(player, "#!/bin/sh\nexec sleep 30").unwrap();
        std::fs::set_permissions(player.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let speaker = Box::leak(Box::new(Speaker::new()));
        let (endpoint, request, release) = server(wav());
        let (tx, rx) = mpsc::channel();
        let first_tx = tx.clone();
        speaker.speak_at(
            SpeechProvider::Drama,
            endpoint,
            player.path().to_string_lossy().into_owned(),
            "first".into(),
            "Hi".into(),
            move |end| {
                first_tx.send(end).unwrap();
            },
        );
        request.recv_timeout(Duration::from_secs(5)).unwrap();
        release.send(()).unwrap();
        let start = std::time::Instant::now();
        loop {
            if speaker
                .lock()
                .as_ref()
                .is_some_and(|(_, playback)| playback.child.lock().unwrap().is_some())
            {
                break;
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(POLL);
        }
        let (endpoint, request, release) = server(wav());
        speaker.speak_at(
            SpeechProvider::Drama,
            endpoint,
            "/bin/cat".into(),
            "second".into(),
            "Hi".into(),
            move |end| {
                tx.send(end).unwrap();
            },
        );
        let first = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(first.id, "first");
        assert!(first.interrupted);
        assert!(first.error.is_none());
        request.recv_timeout(Duration::from_secs(5)).unwrap();
        release.send(()).unwrap();
        let second = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(second.id, "second");
        assert!(!second.interrupted);
        assert!(second.error.is_none());
        assert!(speaker.lock().is_none());
    }

    #[test]
    fn invalid_audio_and_player_failures_reach_the_caller() {
        for audio in [b"not a wave file".to_vec(), wav()] {
            let speaker = Box::leak(Box::new(Speaker::new()));
            let (endpoint, request, release) = server(audio);
            let (tx, rx) = mpsc::channel();
            speaker.speak_at(
                SpeechProvider::Drama,
                endpoint,
                "/nonexistent/player".into(),
                "a".into(),
                "Hi".into(),
                move |end| {
                    tx.send(end).unwrap();
                },
            );
            request.recv_timeout(Duration::from_secs(5)).unwrap();
            release.send(()).unwrap();
            let ended = rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(!ended.interrupted);
            assert!(ended.error.is_some());
        }
    }

    #[test]
    fn long_replies_are_split_at_words_with_no_text_lost() {
        let text = "Bugün uygulamadaki sohbetleri düzenledim. Artık seçeneklere tıklayarak yanıt verebilirsin. Türkçe sesli yanıtlar da hazır.";
        let chunks = speech_chunks(text, 60);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|text| text.chars().count() <= 60));
        assert_eq!(chunks.join(" "), text);
        let long_word = "ş".repeat(145);
        let parts = speech_chunks(&long_word, 60);
        assert_eq!(
            parts.iter().map(|s| s.chars().count()).collect::<Vec<_>>(),
            [60, 60, 25]
        );
        assert_eq!(parts.concat(), long_word);
        for provider in [SpeechProvider::Ema, SpeechProvider::Kahya] {
            let text = "ş".repeat(4001);
            let parts = speech_chunks(&text, provider.chunk_limit());
            assert_eq!(
                parts.iter().map(|s| s.chars().count()).collect::<Vec<_>>(),
                [2000, 2000, 1]
            );
            assert_eq!(parts.concat(), text);
        }
    }

    #[test]
    fn control_characters_are_not_spoken() {
        assert_eq!(speakable("  hi\u{7}\tthere\n "), "hi\tthere");
    }
}
