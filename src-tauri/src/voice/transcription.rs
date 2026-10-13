//! The opt-in transcription service: one WAV upload to an endpoint that
//! speaks OpenAI's `/v1/audio/transcriptions` shape. That covers OpenAI,
//! Groq and similar APIs, and a whisper.cpp `whisper-server` started with
//! `--inference-path /v1/audio/transcriptions`, which keeps audio on the Mac.

use std::time::Duration;

use serde::Deserialize;
use url::Url;

use super::audio;

const HTTP_TIMEOUT: Duration = Duration::from_secs(90);

pub struct Recording {
    pub samples: Vec<f32>,
    pub sample_rate: f64,
}

pub struct Service {
    pub endpoint: String,
    pub model: String,
    pub language: String,
    pub key: Option<String>,
}

/// An http endpoint is only accepted on this machine, so a key and a
/// recording never cross the network unencrypted.
pub fn validate_endpoint(endpoint: &str) -> Result<Url, String> {
    let url = Url::parse(endpoint.trim())
        .map_err(|_| "The transcription endpoint is not a valid URL".to_string())?;
    match url.scheme() {
        "https" => Ok(url),
        "http" if is_loopback(&url) => Ok(url),
        "http" => Err("Use https for a transcription endpoint on another machine".into()),
        _ => Err("The transcription endpoint must be an http(s) URL".into()),
    }
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

pub fn transcribe(service: &Service, recording: Recording) -> Result<String, String> {
    let url = validate_endpoint(&service.endpoint)?;
    let samples = audio::resample(
        &recording.samples,
        recording.sample_rate,
        f64::from(audio::UPLOAD_SAMPLE_RATE),
    );
    // Under a quarter second is a tap on the button, not speech.
    if samples.len() < audio::UPLOAD_SAMPLE_RATE as usize / 4 {
        return Ok(String::new());
    }
    let wav = audio::wav(&samples, audio::UPLOAD_SAMPLE_RATE);
    let boundary = format!("irgat-{}", uuid::Uuid::new_v4().simple());
    let mut fields = vec![("model", service.model.trim()), ("response_format", "json")];
    if !service.language.trim().is_empty() {
        fields.push(("language", service.language.trim()));
    }
    let body = multipart(&boundary, &fields, &wav);

    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    let mut request = agent.post(url.as_str()).set(
        "Content-Type",
        &format!("multipart/form-data; boundary={boundary}"),
    );
    if let Some(key) = service.key.as_deref() {
        request = request.set("Authorization", &format!("Bearer {key}"));
    }
    match request.send_bytes(&body) {
        Ok(response) => {
            let raw = response
                .into_string()
                .map_err(|_| "The transcription service sent an unreadable reply".to_string())?;
            parse_reply(&raw)
        }
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => {
            Err("The transcription service rejected the API key".into())
        }
        Err(ureq::Error::Status(status, response)) => {
            let raw = response.into_string().unwrap_or_default();
            Err(service_error(status, &raw))
        }
        Err(_) => Err("Could not reach the transcription service".into()),
    }
}

fn multipart(boundary: &str, fields: &[(&str, &str)], wav: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(wav.len() + 512);
    for (name, value) in fields {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(wav);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

#[derive(Deserialize)]
struct Reply {
    text: String,
}

fn parse_reply(raw: &str) -> Result<String, String> {
    serde_json::from_str::<Reply>(raw)
        .map(|reply| reply.text.trim().to_string())
        .map_err(|_| "The transcription service sent an unexpected reply".into())
}

fn service_error(status: u16, raw: &str) -> String {
    #[derive(Deserialize)]
    struct Body {
        error: Detail,
    }
    #[derive(Deserialize)]
    struct Detail {
        message: String,
    }
    match serde_json::from_str::<Body>(raw) {
        Ok(body) if !body.error.message.trim().is_empty() => {
            format!("Transcription failed: {}", body.error.message.trim())
        }
        _ => format!("Transcription failed (HTTP {status})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_need_https_unless_they_are_local() {
        assert!(validate_endpoint("https://api.openai.com/v1/audio/transcriptions").is_ok());
        assert!(validate_endpoint("http://127.0.0.1:8080/v1/audio/transcriptions").is_ok());
        assert!(validate_endpoint("http://localhost:8080/inference").is_ok());
        assert!(validate_endpoint("http://[::1]:8080/inference").is_ok());
        assert!(validate_endpoint("http://192.168.1.4:8080/inference").is_err());
        assert!(validate_endpoint("http://localhost.example.com/inference").is_err());
        assert!(validate_endpoint("ftp://localhost/inference").is_err());
        assert!(validate_endpoint("not a url").is_err());
    }

    #[test]
    fn multipart_carries_fields_then_the_file() {
        let body = multipart("b", &[("model", "whisper-1")], b"RIFF");
        let text = String::from_utf8_lossy(&body);
        assert!(text.starts_with(
            "--b\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n"
        ));
        assert!(text.contains(
            "name=\"file\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\nRIFF\r\n"
        ));
        assert!(text.ends_with("\r\n--b--\r\n"));
    }

    #[test]
    fn replies_and_errors_are_read_from_json() {
        assert_eq!(
            parse_reply(r#"{"text":" Merhaba dünya. "}"#),
            Ok("Merhaba dünya.".into())
        );
        assert!(parse_reply("<html>").is_err());
        assert_eq!(
            service_error(400, r#"{"error":{"message":"Invalid file format."}}"#),
            "Transcription failed: Invalid file format."
        );
        assert_eq!(
            service_error(502, "Bad gateway"),
            "Transcription failed (HTTP 502)"
        );
    }

    #[test]
    fn a_tap_on_the_button_is_not_uploaded() {
        let service = Service {
            // Nothing listens here; an upload attempt would fail the test.
            endpoint: "http://127.0.0.1:9/v1/audio/transcriptions".into(),
            model: "whisper-1".into(),
            language: String::new(),
            key: None,
        };
        let recording = Recording {
            samples: vec![0.0; 4_800],
            sample_rate: 48_000.0,
        };
        assert_eq!(transcribe(&service, recording), Ok(String::new()));
    }
}
