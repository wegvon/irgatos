//! Voice input for the composer.
//!
//! macOS records through AVAudioEngine and transcribes with the Speech
//! framework. Recognition is pinned on-device whenever the language model is
//! installed, so audio never leaves the machine; Apple's servers are used only
//! when the user allows them for a language that has no local model. An
//! OpenAI-compatible transcription endpoint (a cloud API, or a whisper.cpp
//! server on localhost) is an opt-in alternative that receives the recording
//! once capture stops. Other platforms report voice as unsupported.
//!
//! Voice mode reads agent replies back with the macOS system voice.

use std::sync::mpsc;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::notifications::Permission;

#[cfg(target_os = "macos")]
mod apple;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod audio;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod qwen;
mod speech;
mod summary;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod transcription;

/// The fixed voice services, for the service status chip.
pub(crate) fn speech_endpoint(provider: &str) -> Option<&'static str> {
    serde_json::from_value::<speech::SpeechProvider>(serde_json::json!(provider))
        .ok()
        .map(speech::SpeechProvider::endpoint)
}

pub(crate) const TRANSCRIPTION_ENDPOINT: &str = qwen::ENDPOINT;

static SPEAKER: speech::Speaker = speech::Speaker::new();

/// Every capture event goes out on one channel; the payload names its capture.
pub const EVENT: &str = "irgat:voice";

const KEY_FILE: &str = "voice-transcription-key";
const LIVE_KEY_FILE: &str = "voice-live-gemini-key";
/// Where a Gemini key is looked for when none is saved, in this order.
const LIVE_KEY_ENV: [&str; 2] = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VoiceEvent {
    /// Input loudness from 0 to 1, a few dozen times a second.
    Level { capture: String, level: f32 },
    /// The whole transcript so far; each one replaces the last.
    Partial { capture: String, text: String },
    /// Ends the capture. Empty when nothing was said.
    Final { capture: String, text: String },
    /// Ends the capture without a transcript.
    Error { capture: String, message: String },
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub type Sink = Arc<dyn Fn(VoiceEvent) + Send + Sync>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Apple,
    Cloud,
    #[default]
    Qwen,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudOptions {
    pub endpoint: String,
    pub model: String,
    /// ISO-639-1 hint such as "tr"; empty lets the service detect it.
    #[serde(default)]
    pub language: String,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    pub capture: String,
    #[serde(default)]
    pub engine: Engine,
    /// BCP-47 identifier such as "tr-TR"; empty follows the system language.
    #[serde(default)]
    pub locale: String,
    /// Lets Apple's servers transcribe a language with no on-device model.
    #[serde(default)]
    pub allow_server: bool,
    #[serde(default)]
    pub cloud: Option<CloudOptions>,
    /// Filled in on the Rust side; the key never crosses into the webview.
    #[serde(skip)]
    pub cloud_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub supported: bool,
    /// A bundle configuration issue that would make TCC terminate the process.
    pub setup_error: Option<String>,
    pub microphone: Permission,
    pub speech: Permission,
    /// Whether the requested language transcribes without a network.
    pub on_device: bool,
    /// Whether Apple's recognizer handles the requested language at all.
    pub language_available: bool,
    /// The language the recognizer resolved to, such as "en-US".
    pub locale: Option<String>,
    pub cloud_key: bool,
}

#[tauri::command]
pub async fn voice_status(app: AppHandle, locale: Option<String>) -> VoiceStatus {
    let cloud_key = read_key(&app).ok().flatten().is_some();
    platform::status(&app, locale.unwrap_or_default(), cloud_key).await
}

/// Raises the macOS prompts that are still undecided: the microphone always,
/// speech recognition only for the Apple engine, which is the one that uses it.
#[tauri::command]
pub async fn voice_request_access(
    app: AppHandle,
    engine: Option<Engine>,
    locale: Option<String>,
) -> VoiceStatus {
    platform::request_access(&app, engine.unwrap_or_default()).await;
    voice_status(app, locale).await
}

#[tauri::command]
pub async fn voice_start(app: AppHandle, mut options: StartOptions) -> Result<(), String> {
    if options.capture.trim().is_empty() {
        return Err("missing capture id".into());
    }
    if options.engine == Engine::Cloud {
        let cloud = options
            .cloud
            .as_ref()
            .ok_or("Set up the transcription service in Settings › Voice")?;
        transcription::validate_endpoint(&cloud.endpoint)?;
        if cloud.model.trim().is_empty() {
            return Err("Choose a transcription model in Settings › Voice".into());
        }
        options.cloud_key = read_key(&app)?;
    }
    let sink = event_sink(&app);
    platform::privacy_usage_descriptions()?;
    platform::start(&app, options, sink).await
}

/// Stops listening; the transcript arrives as a final event.
#[tauri::command]
pub async fn voice_stop(app: AppHandle, capture: String) {
    platform::stop(&app, capture).await;
}

/// Stops listening and discards the transcript.
#[tauri::command]
pub async fn voice_cancel(app: AppHandle, capture: String) {
    platform::cancel(&app, capture).await;
}

/// Stores the transcription service key next to the other integration
/// tokens, readable only by this user. An empty key removes it.
#[tauri::command]
pub fn voice_set_cloud_key(app: AppHandle, key: String) -> Result<bool, String> {
    store_secret(&key_path(&app)?, &key)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveKeyStatus {
    /// A key saved in Settings, which wins over the environment.
    stored: bool,
    /// The variable a key was found in: the app's own environment first,
    /// then the login shell's, since Finder-launched apps inherit neither.
    env: Option<&'static str>,
}

/// Whether a Live voice call has a Gemini key, and where it comes from.
#[tauri::command]
pub async fn voice_live_key_status(app: AppHandle) -> Result<LiveKeyStatus, String> {
    let stored = read_secret(&secret_path(&app, LIVE_KEY_FILE)?)?.is_some();
    let env = tauri::async_runtime::spawn_blocking(|| live_env_key(env_value))
        .await
        .map_err(|error| error.to_string())?
        .map(|(name, _)| name);
    Ok(LiveKeyStatus { stored, env })
}

/// Stores the Gemini key beside the transcription key. An empty key removes it.
#[tauri::command]
pub fn voice_set_live_key(app: AppHandle, key: String) -> Result<bool, String> {
    store_secret(&secret_path(&app, LIVE_KEY_FILE)?, &key)
}

/// The key a Live call opens its socket with. The Live API takes it in the
/// WebSocket URL, so unlike the transcription key it has to reach the webview.
#[tauri::command]
pub async fn voice_live_key(app: AppHandle) -> Result<Option<String>, String> {
    live_key(&app).await
}

async fn live_key(app: &AppHandle) -> Result<Option<String>, String> {
    if let Some(key) = read_secret(&secret_path(app, LIVE_KEY_FILE)?)? {
        return Ok(Some(key));
    }
    tauri::async_runtime::spawn_blocking(|| live_env_key(env_value).map(|(_, key)| key))
        .await
        .map_err(|error| error.to_string())
}

/// A few spoken sentences for an agent reply, written by Gemini with the Live
/// voice key. Nothing without a key, so voice mode uses its own excerpt.
#[tauri::command]
pub async fn voice_summarize(
    app: AppHandle,
    text: String,
    locale: Option<String>,
) -> Result<Option<String>, String> {
    let Some(key) = live_key(&app).await? else {
        return Ok(None);
    };
    if text.trim().is_empty() {
        return Ok(None);
    }
    let locale = locale.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || summary::summarize(&key, &text, &locale))
        .await
        .map_err(|error| error.to_string())?
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| crate::harness::login_shell_env(name))
}

/// The first Gemini key variable that holds a value.
fn live_env_key(lookup: impl Fn(&str) -> Option<String>) -> Option<(&'static str, String)> {
    LIVE_KEY_ENV.into_iter().find_map(|name| {
        let value = lookup(name)?;
        let value = value.trim();
        (!value.is_empty()).then(|| (name, value.to_string()))
    })
}

fn secret_path(app: &AppHandle, file: &str) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(file))
}

/// Writes `key` readable only by this user, or removes the file when empty.
pub(crate) fn store_secret(path: &std::path::Path, key: &str) -> Result<bool, String> {
    let key = key.trim();
    if key.is_empty() {
        return match std::fs::remove_file(path) {
            Ok(()) => Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.to_string()),
        };
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    crate::linear::write_secret_file(path, key)?;
    Ok(true)
}

pub(crate) fn read_secret(path: &std::path::Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw.trim().to_string()).filter(|key| !key.is_empty())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Opens the Privacy & Security pane where a declined permission is turned back on.
#[tauri::command]
pub fn voice_open_privacy_settings(pane: String) -> Result<(), String> {
    platform::open_privacy_settings(&pane)
}

/// Reads `text` aloud, interrupting anything already speaking. A
/// `irgat:voice-speech` event names the utterance when it ends.
#[tauri::command]
pub fn voice_speak(
    app: AppHandle,
    id: String,
    text: String,
    provider: Option<speech::SpeechProvider>,
) -> Result<(), String> {
    let text = speech::speakable(&text);
    if text.is_empty() {
        return Err("Nothing to read aloud".into());
    }
    SPEAKER.speak(provider.unwrap_or_default(), id, text, move |ended| {
        let _ = app.emit(speech::EVENT, ended);
    })
}

/// Stops reading aloud; with an id, only if that utterance is still speaking.
#[tauri::command]
pub fn voice_stop_speaking(id: Option<String>) {
    SPEAKER.stop_if(id.as_deref());
}

fn event_sink(app: &AppHandle) -> Sink {
    let app = app.clone();
    Arc::new(move |event| {
        let _ = app.emit(EVENT, event);
    })
}

fn key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    secret_path(app, KEY_FILE)
}

fn read_key(app: &AppHandle) -> Result<Option<String>, String> {
    read_secret(&key_path(app)?)
}

/// Runs AppKit-bound work on the main thread and hands back its result.
/// The Speech framework delivers recognition results on the main queue, so
/// keeping every capture call there leaves its state on a single thread.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(work());
    })
    .ok()?;
    wait(rx).await
}

/// Permission prompts answer whenever the user does, so this has no timeout.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
async fn wait<T: Send + 'static>(rx: mpsc::Receiver<T>) -> Option<T> {
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok())
        .await
        .ok()
        .flatten()
}

#[cfg(target_os = "macos")]
mod platform {
    use tauri::AppHandle;

    use super::{apple, on_main, wait, Engine, Permission, Sink, StartOptions, VoiceStatus};

    pub(super) async fn status(app: &AppHandle, locale: String, cloud_key: bool) -> VoiceStatus {
        if let Err(error) = privacy_usage_descriptions() {
            return VoiceStatus {
                supported: false,
                setup_error: Some(error),
                microphone: Permission::Unsupported,
                speech: Permission::Unsupported,
                on_device: false,
                language_available: false,
                locale: None,
                cloud_key,
            };
        }
        let language = on_main(app, move || apple::language(&locale))
            .await
            .unwrap_or_default();
        VoiceStatus {
            supported: true,
            setup_error: None,
            microphone: apple::microphone_permission(),
            speech: apple::speech_permission(),
            on_device: language.on_device,
            language_available: language.available,
            locale: language.locale,
            cloud_key,
        }
    }

    pub(super) async fn request_access(_app: &AppHandle, engine: Engine) {
        if privacy_usage_descriptions().is_err() {
            return;
        }
        if apple::microphone_permission() == Permission::Prompt {
            wait(apple::request_microphone()).await;
        }
        if engine == Engine::Apple && apple::speech_permission() == Permission::Prompt {
            wait(apple::request_speech()).await;
        }
    }

    pub(super) async fn start(
        app: &AppHandle,
        options: StartOptions,
        sink: Sink,
    ) -> Result<(), String> {
        on_main(app, move || apple::start(options, sink))
            .await
            .unwrap_or_else(|| Err("Could not start listening".into()))
    }

    pub(super) fn privacy_usage_descriptions() -> Result<(), String> {
        apple::privacy_usage_descriptions()
    }

    pub(super) async fn stop(app: &AppHandle, capture: String) {
        on_main(app, move || apple::stop(&capture)).await;
    }

    pub(super) async fn cancel(app: &AppHandle, capture: String) {
        on_main(app, move || apple::cancel(&capture)).await;
    }

    pub(super) fn open_privacy_settings(pane: &str) -> Result<(), String> {
        let anchor = match pane {
            "speech" => "Privacy_SpeechRecognition",
            _ => "Privacy_Microphone",
        };
        std::process::Command::new("open")
            .arg(format!(
                "x-apple.systempreferences:com.apple.preference.security?{anchor}"
            ))
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::AppHandle;

    use super::{Engine, Permission, Sink, StartOptions, VoiceStatus};

    const UNSUPPORTED: &str = "Voice input is available on macOS for now";

    pub(super) async fn status(_app: &AppHandle, _locale: String, cloud_key: bool) -> VoiceStatus {
        VoiceStatus {
            supported: false,
            setup_error: None,
            microphone: Permission::Unsupported,
            speech: Permission::Unsupported,
            on_device: false,
            language_available: false,
            locale: None,
            cloud_key,
        }
    }

    pub(super) fn privacy_usage_descriptions() -> Result<(), String> {
        Ok(())
    }

    pub(super) async fn request_access(_app: &AppHandle, _engine: Engine) {}

    pub(super) async fn start(
        _app: &AppHandle,
        _options: StartOptions,
        _sink: Sink,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    pub(super) async fn stop(_app: &AppHandle, _capture: String) {}

    pub(super) async fn cancel(_app: &AppHandle, _capture: String) {}

    pub(super) fn open_privacy_settings(_pane: &str) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_key_prefers_gemini_over_google() {
        let both = |name: &str| Some(format!("{name}-value"));
        assert_eq!(
            live_env_key(both),
            Some(("GEMINI_API_KEY", "GEMINI_API_KEY-value".to_string()))
        );
        let google_only = |name: &str| (name == "GOOGLE_API_KEY").then(|| " g-key \n".to_string());
        assert_eq!(
            live_env_key(google_only),
            Some(("GOOGLE_API_KEY", "g-key".to_string()))
        );
    }

    #[test]
    fn live_key_skips_blank_variables() {
        let blank =
            |name: &str| Some(if name == "GEMINI_API_KEY" { "  " } else { "g" }.to_string());
        assert_eq!(
            live_env_key(blank),
            Some(("GOOGLE_API_KEY", "g".to_string()))
        );
        assert_eq!(live_env_key(|_: &str| None), None);
    }

    #[test]
    fn live_key_file_round_trips_and_removes() {
        let dir = std::env::temp_dir().join(format!(
            "irgat-live-key-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = dir.join(LIVE_KEY_FILE);
        assert_eq!(read_secret(&path).unwrap(), None);
        assert!(store_secret(&path, "  AIza-test \n").unwrap());
        assert_eq!(read_secret(&path).unwrap().as_deref(), Some("AIza-test"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(!store_secret(&path, "").unwrap());
        assert_eq!(read_secret(&path).unwrap(), None);
        assert!(!store_secret(&path, " ").unwrap(), "removing twice is fine");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn live_key_status_serializes_for_the_webview() {
        let status = LiveKeyStatus {
            stored: false,
            env: Some("GEMINI_API_KEY"),
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({ "stored": false, "env": "GEMINI_API_KEY" })
        );
    }

    #[test]
    fn events_serialize_with_a_kind_tag() {
        let event = VoiceEvent::Partial {
            capture: "c1".into(),
            text: "hello".into(),
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({ "kind": "partial", "capture": "c1", "text": "hello" })
        );
    }

    #[test]
    fn start_options_default_to_the_qwen_engine() {
        let options: StartOptions = serde_json::from_value(serde_json::json!({
            "capture": "c1",
            "cloudKey": "smuggled",
        }))
        .unwrap();
        assert_eq!(options.engine, Engine::Qwen);
        assert!(options.locale.is_empty());
        assert!(!options.allow_server);
        assert_eq!(
            options.cloud_key, None,
            "the key is never read from the webview"
        );
    }

    #[test]
    fn start_options_read_the_cloud_service() {
        let options: StartOptions = serde_json::from_value(serde_json::json!({
            "capture": "c2",
            "engine": "cloud",
            "cloud": {
                "endpoint": "http://127.0.0.1:8080/v1/audio/transcriptions",
                "model": "whisper-1",
            },
        }))
        .unwrap();
        assert_eq!(options.engine, Engine::Cloud);
        let cloud = options.cloud.unwrap();
        assert_eq!(cloud.model, "whisper-1");
        assert!(cloud.language.is_empty());
    }

    #[test]
    fn status_serializes_in_camel_case() {
        let status = VoiceStatus {
            supported: true,
            setup_error: None,
            microphone: Permission::Granted,
            speech: Permission::Prompt,
            on_device: true,
            language_available: true,
            locale: Some("tr-TR".into()),
            cloud_key: false,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({
                "supported": true,
                "setupError": null,
                "microphone": "granted",
                "speech": "prompt",
                "onDevice": true,
                "languageAvailable": true,
                "locale": "tr-TR",
                "cloudKey": false,
            })
        );
    }

    #[test]
    fn status_serializes_a_setup_error() {
        let status = VoiceStatus {
            supported: false,
            setup_error: Some("Missing privacy description".into()),
            microphone: Permission::Unsupported,
            speech: Permission::Unsupported,
            on_device: false,
            language_available: false,
            locale: None,
            cloud_key: false,
        };
        assert_eq!(
            serde_json::to_value(status).unwrap()["setupError"],
            "Missing privacy description"
        );
    }
}
