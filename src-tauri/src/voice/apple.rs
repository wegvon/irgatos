//! AVAudioEngine capture and Speech framework recognition.
//!
//! Every function here runs on the main thread: recognition results arrive on
//! the main queue, so the active capture lives in a main-thread slot and needs
//! no locking. Only the input tap runs elsewhere, on the audio render thread;
//! it shares nothing with the slot but the request it feeds and the recording
//! buffer behind a mutex.

use std::cell::RefCell;
use std::ptr::NonNull;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObjectProtocol};
use objc2::{sel, AnyThread};
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
use objc2_avf_audio::{AVAudioEngine, AVAudioPCMBuffer, AVAudioTime};
use objc2_foundation::{NSBundle, NSError, NSLocale, NSString};
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
    SFSpeechRecognitionTaskHint, SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
};

use super::audio::{LevelMeter, RECORDING_LIMIT_SECONDS};
use super::transcription::{self, Recording, Service};
use super::{Engine, Permission, Sink, StartOptions, VoiceEvent};

/// Frames per tap callback; about 21 ms at 48 kHz.
const TAP_FRAMES: u32 = 1024;

/// The request ended before anyone spoke.
const ASSISTANT_DOMAIN: &str = "kAFAssistantErrorDomain";
const NO_SPEECH: isize = 1110;

struct Capture {
    id: String,
    engine: Retained<AVAudioEngine>,
    recognition: Option<Recognition>,
    recording: Option<Arc<Mutex<Vec<f32>>>>,
    sample_rate: f64,
    service: Option<Service>,
    sink: Sink,
    /// Latest partial, kept so a recognizer that errors after Stop still
    /// leaves the user with what they saw.
    heard: String,
    stopping: bool,
}

struct Recognition {
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
    task: Retained<SFSpeechRecognitionTask>,
    _recognizer: Retained<SFSpeechRecognizer>,
}

thread_local! {
    static ACTIVE: RefCell<Option<Capture>> = const { RefCell::new(None) };
    /// The last finished capture. Its task can still be inside the result
    /// handler that finished it, so it is released on the next start instead.
    static RETIRED: RefCell<Option<Capture>> = const { RefCell::new(None) };
}

const MICROPHONE_USAGE_KEY: &str = "NSMicrophoneUsageDescription";
const SPEECH_USAGE_KEY: &str = "NSSpeechRecognitionUsageDescription";

/// TCC aborts the process rather than returning an error when either
/// description is missing. Check the running bundle before calling its APIs.
pub(super) fn privacy_usage_descriptions() -> Result<(), String> {
    let bundle = NSBundle::mainBundle();
    for key in [MICROPHONE_USAGE_KEY, SPEECH_USAGE_KEY] {
        let key_string = NSString::from_str(key);
        let present = bundle
            .objectForInfoDictionaryKey(&key_string)
            .and_then(|value| {
                value
                    .downcast_ref::<NSString>()
                    .map(|value| value.to_string())
            })
            .is_some_and(|value| !value.trim().is_empty());
        if !present {
            return Err(format!(
                "Voice input is unavailable because this app bundle is missing {key}. Quit MonoCode, rebuild the app, and try again."
            ));
        }
    }
    Ok(())
}

pub(super) fn microphone_permission() -> Permission {
    let Some(audio) = (unsafe { AVMediaTypeAudio }) else {
        return Permission::Unsupported;
    };
    match unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) } {
        AVAuthorizationStatus::NotDetermined => Permission::Prompt,
        AVAuthorizationStatus::Authorized => Permission::Granted,
        _ => Permission::Denied,
    }
}

pub(super) fn speech_permission() -> Permission {
    match unsafe { SFSpeechRecognizer::authorizationStatus() } {
        SFSpeechRecognizerAuthorizationStatus::NotDetermined => Permission::Prompt,
        SFSpeechRecognizerAuthorizationStatus::Authorized => Permission::Granted,
        _ => Permission::Denied,
    }
}

/// The handler runs on an arbitrary queue once the user answers.
pub(super) fn request_microphone() -> mpsc::Receiver<()> {
    let (tx, rx) = mpsc::channel();
    let Some(audio) = (unsafe { AVMediaTypeAudio }) else {
        let _ = tx.send(());
        return rx;
    };
    let handler = RcBlock::new(move |_granted: Bool| {
        let _ = tx.send(());
    });
    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &handler) };
    rx
}

pub(super) fn request_speech() -> mpsc::Receiver<()> {
    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |_status: SFSpeechRecognizerAuthorizationStatus| {
        let _ = tx.send(());
    });
    unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
    rx
}

#[derive(Default)]
pub(super) struct Language {
    pub available: bool,
    pub on_device: bool,
    pub locale: Option<String>,
}

pub(super) fn language(locale: &str) -> Language {
    let Some(recognizer) = recognizer(locale) else {
        return Language::default();
    };
    Language {
        available: unsafe { recognizer.isAvailable() },
        on_device: unsafe { recognizer.supportsOnDeviceRecognition() },
        locale: Some(
            unsafe { recognizer.locale() }
                .localeIdentifier()
                .to_string(),
        ),
    }
}

fn recognizer(locale: &str) -> Option<Retained<SFSpeechRecognizer>> {
    let locale = locale.trim();
    unsafe {
        if locale.is_empty() {
            SFSpeechRecognizer::init(SFSpeechRecognizer::alloc())
        } else {
            let locale = NSLocale::localeWithLocaleIdentifier(&NSString::from_str(locale));
            SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale)
        }
    }
}

pub(super) fn start(options: StartOptions, sink: Sink) -> Result<(), String> {
    if let Some(previous) = ACTIVE.with(|slot| slot.borrow_mut().take()) {
        abort(previous);
    }
    RETIRED.with(|slot| slot.borrow_mut().take());

    match microphone_permission() {
        Permission::Granted => {}
        Permission::Prompt => return Err("MonoCode needs microphone access first".into()),
        _ => {
            return Err(
                "Microphone access is off for MonoCode. Turn it on in System Settings › Privacy & Security › Microphone".into(),
            )
        }
    }

    let engine = unsafe { AVAudioEngine::new() };
    let input = unsafe { engine.inputNode() };
    let format = unsafe { input.outputFormatForBus(0) };
    let sample_rate = unsafe { format.sampleRate() };
    if sample_rate <= 0.0 || unsafe { format.channelCount() } == 0 {
        return Err("No microphone is connected".into());
    }

    let recognition = match options.engine {
        Engine::Apple => Some(recognize(&options, sink.clone())?),
        Engine::Cloud => None,
    };
    let recording = (options.engine == Engine::Cloud).then(|| Arc::new(Mutex::new(Vec::new())));
    let service = options.cloud.as_ref().map(|cloud| Service {
        endpoint: cloud.endpoint.clone(),
        model: cloud.model.clone(),
        language: cloud.language.clone(),
        key: options.cloud_key.clone(),
    });

    let tap = {
        let request = recognition.as_ref().map(|r| r.request.clone());
        let recording = recording.clone();
        let limit = RECORDING_LIMIT_SECONDS * sample_rate as usize;
        let meter = Mutex::new(LevelMeter::new());
        let sink = sink.clone();
        let capture = options.capture.clone();
        RcBlock::new(
            move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                let buffer = unsafe { buffer.as_ref() };
                if let Some(request) = &request {
                    unsafe { request.appendAudioPCMBuffer(buffer) };
                }
                let samples = first_channel(buffer);
                if let Some(recording) = &recording {
                    if let Ok(mut recorded) = recording.lock() {
                        let room = limit.saturating_sub(recorded.len());
                        recorded.extend_from_slice(&samples[..samples.len().min(room)]);
                    }
                }
                let level = meter
                    .lock()
                    .ok()
                    .and_then(|mut meter| meter.push(&samples, Instant::now()));
                if let Some(level) = level {
                    sink(VoiceEvent::Level {
                        capture: capture.clone(),
                        level,
                    });
                }
            },
        )
    };
    unsafe {
        input.installTapOnBus_bufferSize_format_block(
            0,
            TAP_FRAMES,
            Some(&format),
            RcBlock::as_ptr(&tap),
        );
        engine.prepare();
    }
    if let Err(error) = unsafe { engine.startAndReturnError() } {
        unsafe { input.removeTapOnBus(0) };
        if let Some(recognition) = &recognition {
            unsafe { recognition.task.cancel() };
        }
        return Err(format!(
            "Could not open the microphone: {}",
            error.localizedDescription()
        ));
    }

    ACTIVE.with(|slot| {
        *slot.borrow_mut() = Some(Capture {
            id: options.capture,
            engine,
            recognition,
            recording,
            sample_rate,
            service,
            sink,
            heard: String::new(),
            stopping: false,
        });
    });
    Ok(())
}

fn recognize(options: &StartOptions, sink: Sink) -> Result<Recognition, String> {
    match speech_permission() {
        Permission::Granted => {}
        Permission::Prompt => return Err("MonoCode needs speech recognition access first".into()),
        _ => return Err(
            "Speech recognition is off for MonoCode. Turn it on in System Settings › Privacy & Security › Speech Recognition".into(),
        ),
    }
    let recognizer = recognizer(&options.locale).ok_or(
        "Speech recognition does not support this language. Pick another one in Settings › Voice",
    )?;
    if !unsafe { recognizer.isAvailable() } {
        return Err("Speech recognition is not available right now".into());
    }
    let on_device = unsafe { recognizer.supportsOnDeviceRecognition() };
    if !on_device && !options.allow_server {
        let name = unsafe { recognizer.locale() }
            .localeIdentifier()
            .to_string();
        return Err(format!(
            "On-device recognition for {name} is not installed. Add the language under System Settings › Keyboard › Dictation, or allow Apple's servers in Settings › Voice"
        ));
    }

    let request = unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
    unsafe {
        request.setShouldReportPartialResults(true);
        request.setRequiresOnDeviceRecognition(on_device);
        request.setTaskHint(SFSpeechRecognitionTaskHint::Dictation);
        // macOS 13 and later.
        if request.respondsToSelector(sel!(setAddsPunctuation:)) {
            request.setAddsPunctuation(true);
        }
    }

    let capture = options.capture.clone();
    let handler = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
            on_result(&capture, &sink, result, error);
        },
    );
    let task = unsafe { recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler) };
    Ok(Recognition {
        request,
        task,
        _recognizer: recognizer,
    })
}

/// Runs on the main queue, the recognizer's default.
fn on_result(
    capture: &str,
    sink: &Sink,
    result: *mut SFSpeechRecognitionResult,
    error: *mut NSError,
) {
    // A cancelled or replaced capture still gets a closing callback.
    let live = ACTIVE.with(|slot| {
        slot.borrow()
            .as_ref()
            .is_some_and(|active| active.id == capture)
    });
    if !live {
        return;
    }
    if let Some(result) = unsafe { result.as_ref() } {
        let text = unsafe { result.bestTranscription().formattedString() }.to_string();
        if unsafe { result.isFinal() } {
            retire(capture);
            sink(VoiceEvent::Final {
                capture: capture.into(),
                text,
            });
        } else {
            ACTIVE.with(|slot| {
                if let Some(active) = slot.borrow_mut().as_mut() {
                    active.heard.clone_from(&text);
                }
            });
            sink(VoiceEvent::Partial {
                capture: capture.into(),
                text,
            });
        }
        return;
    }
    let Some(error) = (unsafe { error.as_ref() }) else {
        return;
    };
    let Some(finished) = retire(capture) else {
        return;
    };
    let no_speech = error.code() == NO_SPEECH && error.domain().to_string() == ASSISTANT_DOMAIN;
    let event = if no_speech || (finished.stopping && !finished.heard.is_empty()) {
        VoiceEvent::Final {
            capture: capture.into(),
            text: finished.heard,
        }
    } else {
        VoiceEvent::Error {
            capture: capture.into(),
            message: error.localizedDescription().to_string(),
        }
    };
    sink(event);
}

/// Ends capture and waits for the transcript.
pub(super) fn stop(capture: &str) {
    let recording = ACTIVE.with(|slot| {
        let mut slot = slot.borrow_mut();
        let active = slot.as_mut().filter(|active| active.id == capture)?;
        if active.stopping {
            return None;
        }
        active.stopping = true;
        silence(&active.engine);
        if let Some(recognition) = &active.recognition {
            unsafe { recognition.request.endAudio() };
            return None;
        }
        let samples = active
            .recording
            .as_ref()
            .and_then(|recording| recording.lock().ok().map(|mut r| std::mem::take(&mut *r)))
            .unwrap_or_default();
        Some((
            Recording {
                samples,
                sample_rate: active.sample_rate,
            },
            active.service.take(),
            active.sink.clone(),
        ))
    });
    let Some((recording, service, sink)) = recording else {
        return;
    };
    retire(capture);
    let capture = capture.to_string();
    std::thread::spawn(move || {
        let event = match service.map(|service| transcription::transcribe(&service, recording)) {
            Some(Ok(text)) => VoiceEvent::Final { capture, text },
            Some(Err(message)) => VoiceEvent::Error { capture, message },
            None => VoiceEvent::Error {
                capture,
                message: "Set up the transcription service in Settings › Voice".into(),
            },
        };
        sink(event);
    });
}

/// Ends capture and drops whatever was heard.
pub(super) fn cancel(capture: &str) {
    let active = ACTIVE.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.as_ref().is_some_and(|active| active.id == capture) {
            slot.take()
        } else {
            None
        }
    });
    if let Some(active) = active {
        abort(active);
    }
}

fn abort(capture: Capture) {
    silence(&capture.engine);
    if let Some(recognition) = &capture.recognition {
        unsafe { recognition.task.cancel() };
    }
    RETIRED.with(|slot| *slot.borrow_mut() = Some(capture));
}

struct Finished {
    heard: String,
    stopping: bool,
}

fn retire(capture: &str) -> Option<Finished> {
    let finished = ACTIVE.with(|slot| {
        let mut slot = slot.borrow_mut();
        if slot.as_ref().is_some_and(|active| active.id == capture) {
            slot.take()
        } else {
            None
        }
    })?;
    silence(&finished.engine);
    let summary = Finished {
        heard: finished.heard.clone(),
        stopping: finished.stopping,
    };
    RETIRED.with(|slot| *slot.borrow_mut() = Some(finished));
    Some(summary)
}

/// Releases the microphone, which also clears the menu bar's recording dot.
fn silence(engine: &AVAudioEngine) {
    unsafe {
        if engine.isRunning() {
            engine.stop();
        }
        engine.inputNode().removeTapOnBus(0);
    }
}

/// Channel 0 of a float buffer, de-interleaved when the format interleaves.
fn first_channel(buffer: &AVAudioPCMBuffer) -> Vec<f32> {
    unsafe {
        let channels = buffer.floatChannelData();
        if channels.is_null() {
            return Vec::new();
        }
        let data = (*channels).as_ptr();
        let frames = buffer.frameLength() as usize;
        let stride = buffer.stride().max(1);
        (0..frames).map(|frame| *data.add(frame * stride)).collect()
    }
}
