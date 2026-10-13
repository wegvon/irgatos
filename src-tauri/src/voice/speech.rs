//! Reads agent replies aloud with the macOS system voice.
//!
//! `/usr/bin/say` speaks with whichever voice the user picked in System
//! Settings › Accessibility › Spoken Content unless a voice is named, needs no
//! extra framework, and stops the moment its process is killed, which is what
//! makes a reply easy to interrupt.

use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

pub const EVENT: &str = "monocode:voice-speech";

/// `say` accepts any rate, but outside this range speech stops being useful.
const RATE_RANGE: std::ops::RangeInclusive<u32> = 90..=400;
const POLL: Duration = Duration::from_millis(40);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEnded {
    pub id: String,
    /// Stopped early, by the user or by a newer utterance.
    pub interrupted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SystemVoice {
    pub name: String,
    /// BCP-47 such as "tr-TR".
    pub locale: String,
}

struct Utterance {
    id: String,
    child: Arc<Mutex<Child>>,
    interrupted: Arc<AtomicBool>,
}

/// One utterance at a time; starting another interrupts the current one.
pub struct Speaker {
    current: Mutex<Option<Utterance>>,
}

impl Speaker {
    pub const fn new() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }

    /// Feeds `text` to `command` on stdin. `on_end` runs once, off the
    /// caller's thread, when the process exits for any reason.
    pub fn speak(
        &'static self,
        mut command: Command,
        id: String,
        text: String,
        on_end: impl FnOnce(SpeechEnded) + Send + 'static,
    ) -> Result<(), String> {
        self.stop_if(None);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not start speech: {error}"))?;
        let stdin = child.stdin.take();
        let child = Arc::new(Mutex::new(child));
        let interrupted = Arc::new(AtomicBool::new(false));
        *self.lock() = Some(Utterance {
            id: id.clone(),
            child: child.clone(),
            interrupted: interrupted.clone(),
        });
        std::thread::spawn(move || {
            if let Some(mut stdin) = stdin {
                // A killed process closes the pipe; that is not an error here.
                let _ = stdin.write_all(text.as_bytes());
            }
            loop {
                let exited = child
                    .lock()
                    .map(|mut child| !matches!(child.try_wait(), Ok(None)))
                    .unwrap_or(true);
                if exited {
                    break;
                }
                std::thread::sleep(POLL);
            }
            {
                let mut current = self.lock();
                if current.as_ref().is_some_and(|utterance| utterance.id == id) {
                    *current = None;
                }
            }
            on_end(SpeechEnded {
                id,
                interrupted: interrupted.load(Ordering::SeqCst),
            });
        });
        Ok(())
    }

    /// Silences whatever is speaking, or only `id` when one is named. The
    /// utterance's `on_end` reports the interruption.
    pub fn stop_if(&self, id: Option<&str>) {
        let Some(utterance) = ({
            let mut current = self.lock();
            match (id, current.as_ref()) {
                (Some(id), Some(utterance)) if utterance.id != id => None,
                _ => current.take(),
            }
        }) else {
            return;
        };
        utterance.interrupted.store(true, Ordering::SeqCst);
        if let Ok(mut child) = utterance.child.lock() {
            let _ = child.kill();
        };
    }

    #[cfg(test)]
    pub fn speaking(&self) -> Option<String> {
        self.lock().as_ref().map(|utterance| utterance.id.clone())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Utterance>> {
        self.current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn say_command(voice: Option<&str>, rate: Option<u32>) -> Command {
    let mut command = Command::new("/usr/bin/say");
    if let Some(voice) = voice.map(str::trim).filter(|voice| !voice.is_empty()) {
        command.arg("-v").arg(voice);
    }
    if let Some(rate) = rate {
        let rate = rate.clamp(*RATE_RANGE.start(), *RATE_RANGE.end());
        command.arg("-r").arg(rate.to_string());
    }
    command.arg("-f").arg("-");
    command
}

/// Reads `say -v '?'`, one voice per line:
/// `Eddy (English (US)) en_US    # Hello! My name is Eddy.`
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_voices(listing: &str) -> Vec<SystemVoice> {
    let mut voices: Vec<SystemVoice> = listing
        .lines()
        .filter_map(|line| {
            let described = line.split_once('#').map_or(line, |(head, _)| head);
            let (name, locale) = described.trim_end().rsplit_once(char::is_whitespace)?;
            let name = name.trim();
            let valid = locale.len() >= 2
                && locale
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
            (valid && !name.is_empty()).then(|| SystemVoice {
                name: name.to_string(),
                locale: locale.replace('_', "-"),
            })
        })
        .collect();
    voices.dedup_by(|a, b| a.name == b.name);
    voices
}

/// Strips what a speech engine would read out literally.
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
    use std::sync::mpsc;

    fn speaker() -> &'static Speaker {
        Box::leak(Box::new(Speaker::new()))
    }

    fn shell(script: &str) -> Command {
        let mut command = Command::new("sh");
        command.arg("-c").arg(script);
        command
    }

    #[test]
    fn say_takes_text_on_stdin_with_a_bounded_rate() {
        let command = say_command(Some(" Yelda "), Some(1000));
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(command.get_program(), "/usr/bin/say");
        assert_eq!(args, ["-v", "Yelda", "-r", "400", "-f", "-"]);

        let plain = say_command(Some(""), None);
        assert_eq!(plain.get_args().count(), 2, "the system voice and rate");
    }

    #[test]
    fn voices_are_read_from_the_say_listing() {
        let listing = "\
Albert              en_US    # Hello! My name is Albert.
Eddy (English (US)) en_US    # Hello! My name is Eddy.
Yelda               tr_TR    # Merhaba, benim adım Yelda.
Yelda               tr_TR    # Duplicate line.

garbage
";
        assert_eq!(
            parse_voices(listing),
            vec![
                SystemVoice {
                    name: "Albert".into(),
                    locale: "en-US".into()
                },
                SystemVoice {
                    name: "Eddy (English (US))".into(),
                    locale: "en-US".into()
                },
                SystemVoice {
                    name: "Yelda".into(),
                    locale: "tr-TR".into()
                },
            ]
        );
    }

    #[test]
    fn an_utterance_that_finishes_is_not_interrupted() {
        let speaker = speaker();
        let (tx, rx) = mpsc::channel();
        speaker
            .speak(
                shell("cat > /dev/null"),
                "a".into(),
                "hello".into(),
                move |end| {
                    let _ = tx.send(end);
                },
            )
            .unwrap();
        let ended = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            ended,
            SpeechEnded {
                id: "a".into(),
                interrupted: false
            }
        );
        assert_eq!(speaker.speaking(), None);
    }

    #[test]
    fn stopping_or_speaking_again_interrupts_the_current_utterance() {
        let speaker = speaker();
        let (tx, rx) = mpsc::channel();
        let sender = tx.clone();
        speaker
            .speak(
                shell("exec sleep 30"),
                "first".into(),
                "one".into(),
                move |end| {
                    let _ = sender.send(end);
                },
            )
            .unwrap();
        assert_eq!(speaker.speaking().as_deref(), Some("first"));

        let sender = tx.clone();
        speaker
            .speak(
                shell("exec sleep 30"),
                "second".into(),
                "two".into(),
                move |end| {
                    let _ = sender.send(end);
                },
            )
            .unwrap();
        let first = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(first.id, "first");
        assert!(first.interrupted);
        assert_eq!(speaker.speaking().as_deref(), Some("second"));

        speaker.stop_if(Some("first"));
        assert_eq!(speaker.speaking().as_deref(), Some("second"), "a stale id");
        speaker.stop_if(Some("second"));
        let second = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(second.id, "second");
        assert!(second.interrupted);
        assert_eq!(speaker.speaking(), None);
    }

    #[test]
    fn a_missing_program_is_reported() {
        let error = speaker()
            .speak(
                Command::new("/nonexistent/say"),
                "x".into(),
                "hi".into(),
                |_| {},
            )
            .unwrap_err();
        assert!(error.starts_with("Could not start speech"));
    }

    #[test]
    fn control_characters_are_not_spoken() {
        assert_eq!(speakable("  hi\u{7}\tthere\n "), "hi\tthere");
    }
}
