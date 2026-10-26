//! Voice mode's spoken summary of an agent reply: one short Gemini call that
//! keeps what was done, what it changed and what the user has to answer.
//! The webview falls back to its own excerpt when this has nothing to say.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL: &str = "gemini-2.5-flash-lite";
/// Past this the reply is read from the screen anyway, so speaking waits less.
const HTTP_TIMEOUT: Duration = Duration::from_secs(6);
/// Long replies are mostly code and logs; the lead and the ending carry the gist.
const MAX_INPUT_CHARS: usize = 12_000;

const INSTRUCTION: &str = "You turn a coding agent's reply into what a voice \
assistant says aloud to the user. Write at most two short spoken sentences, \
under 30 words in total, in the same language as the reply, even when the reply \
is already short. Say the outcome: what was done and its effect, or for a \
progress note, what the agent is doing now. Add the next step the user must take, \
if any. If the reply asks the user anything, always end with that question. \
Leave out greetings, the name or title the reply addresses the user by, code, \
file paths, identifiers, URLs, line numbers, lists and markdown. Output only \
the sentences.";

pub fn summarize(key: &str, text: &str, locale: &str) -> Result<Option<String>, String> {
    generate(key, &request(text, locale), HTTP_TIMEOUT)
}

/// One `generateContent` call with the cheap model; the reply's text, if any.
/// Next-prompt suggestions share it with the spoken summary.
pub(super) fn generate(
    key: &str,
    body: &Value,
    timeout: Duration,
) -> Result<Option<String>, String> {
    let url = format!("{ENDPOINT}/{MODEL}:generateContent");
    let agent = ureq::AgentBuilder::new().timeout(timeout).build();
    match agent
        .post(&url)
        .set("x-goog-api-key", key)
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
    {
        Ok(response) => {
            let raw = response
                .into_string()
                .map_err(|_| "Gemini sent an unreadable reply".to_string())?;
            Ok(parse_reply(&raw))
        }
        Err(ureq::Error::Status(400, _))
        | Err(ureq::Error::Status(401, _))
        | Err(ureq::Error::Status(403, _)) => Err("Gemini rejected the API key".into()),
        Err(ureq::Error::Status(status, _)) => Err(format!("Gemini answered {status}")),
        Err(_) => Err("Could not reach Gemini".into()),
    }
}

fn request(text: &str, locale: &str) -> Value {
    let mut instruction = INSTRUCTION.to_string();
    if !locale.trim().is_empty() {
        instruction.push_str(&format!(
            " The user's voice language is {}; use it only if the reply's language is unclear.",
            locale.trim()
        ));
    }
    json!({
        "systemInstruction": { "parts": [{ "text": instruction }] },
        "contents": [{ "role": "user", "parts": [{ "text": clip(text) }] }],
        "generationConfig": { "temperature": 0.2, "maxOutputTokens": 120 },
    })
}

/// Keeps the start and the end of a long reply, where questions usually sit.
fn clip(text: &str) -> String {
    clip_to(text, MAX_INPUT_CHARS)
}

pub(super) fn clip_to(text: &str, max: usize) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    if chars.len() <= max {
        return chars.into_iter().collect();
    }
    let half = max / 2;
    let head: String = chars[..half].iter().collect();
    let tail: String = chars[chars.len() - half..].iter().collect();
    format!("{head}\n\n[…]\n\n{tail}")
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    candidates: Vec<Candidate>,
}

#[derive(Deserialize)]
struct Candidate {
    content: Option<Content>,
}

#[derive(Deserialize)]
struct Content {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Deserialize)]
struct Part {
    #[serde(default)]
    text: String,
}

fn parse_reply(raw: &str) -> Option<String> {
    let reply: Reply = serde_json::from_str(raw).ok()?;
    let text = reply
        .candidates
        .into_iter()
        .next()?
        .content?
        .parts
        .into_iter()
        .map(|part| part.text)
        .collect::<String>();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_carries_the_instruction_and_the_reply() {
        let body = request("Fixed the build.", "tr-TR");
        let instruction = body["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap();
        assert!(instruction.contains("always end with that question"));
        assert!(instruction.contains("under 30 words"));
        assert!(instruction.contains("tr-TR"));
        assert_eq!(body["contents"][0]["parts"][0]["text"], "Fixed the build.");
        assert!(!request("x", " ").to_string().contains("voice language"));
    }

    #[test]
    fn clip_keeps_both_ends_of_a_long_reply() {
        let text = format!("start{}end?", "x".repeat(MAX_INPUT_CHARS * 2));
        let clipped = clip(&text);
        assert!(clipped.starts_with("start"));
        assert!(clipped.ends_with("end?"));
        assert!(clipped.chars().count() < MAX_INPUT_CHARS + 20);
        assert_eq!(clip("  short  "), "short");
    }

    #[test]
    fn parse_reply_joins_parts_and_flattens_whitespace() {
        let raw = r#"{"candidates":[{"content":{"parts":[
            {"text":"I fixed the build.\n"},{"text":"  Should I push it?"}]}}]}"#;
        assert_eq!(
            parse_reply(raw).as_deref(),
            Some("I fixed the build. Should I push it?")
        );
    }

    #[test]
    fn parse_reply_is_nothing_without_text() {
        assert_eq!(parse_reply(r#"{"candidates":[]}"#), None);
        assert_eq!(
            parse_reply(r#"{"candidates":[{"finishReason":"SAFETY"}]}"#),
            None
        );
        assert_eq!(parse_reply("not json"), None);
    }
}
