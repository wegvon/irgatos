//! The message the user is likely to type next, guessed from the end of a
//! chat with the same cheap Gemini model as the spoken summary. The composer
//! shows it as grey text that Tab takes; nothing is ever sent on its own.

use std::time::Duration;

use serde_json::{json, Value};

use super::summary::{clip_to, generate};

/// A suggestion that arrives later than this is no longer wanted.
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);
/// The reply's lead and ending carry what the user reacts to.
const MAX_REPLY_CHARS: usize = 8_000;
/// Earlier user messages only show how the user writes.
const MAX_PROMPT_CHARS: usize = 600;
const MAX_PROMPTS: usize = 3;
/// A prediction longer than this is a paragraph, not a next message.
const MAX_SUGGESTION_CHARS: usize = 240;
/// What the model answers when nothing is likely to follow.
const NOTHING: &str = "NONE";

const INSTRUCTION: &str = "You predict the next message a user will type to \
their AI assistant in a chat, so it can be offered as a suggestion they accept \
with one key. Write that message as the user would: first person, the same \
language, tone and brevity as the user's own messages (when they write \
Turkish, write Turkish). One short message, at most 20 words, plain text, no \
quotes or markdown. Make it the most likely useful next step: if the reply \
asks the user something, answer it, choosing the option the assistant \
recommends or the obvious yes; otherwise ask for the natural next step, such \
as testing, applying, continuing, or explaining a point. Use only names, \
files and facts that appear in the chat. If the work is plainly finished and \
nothing is likely to follow, output exactly NONE. Output only the message.";

pub fn suggest(key: &str, prompts: &[String], reply: &str) -> Result<Option<String>, String> {
    if reply.trim().is_empty() {
        return Ok(None);
    }
    Ok(generate(key, &request(prompts, reply), HTTP_TIMEOUT)?.and_then(|text| tidy(&text)))
}

fn request(prompts: &[String], reply: &str) -> Value {
    let recent = prompts
        .iter()
        .filter(|prompt| !prompt.trim().is_empty())
        .rev()
        .take(MAX_PROMPTS)
        .collect::<Vec<_>>();
    let mut chat = String::new();
    for prompt in recent.into_iter().rev() {
        chat.push_str(&format!(
            "<user>\n{}\n</user>\n",
            clip_to(prompt, MAX_PROMPT_CHARS)
        ));
    }
    chat.push_str(&format!(
        "<assistant>\n{}\n</assistant>\n\nThe user's next message:",
        clip_to(reply, MAX_REPLY_CHARS)
    ));
    json!({
        "systemInstruction": { "parts": [{ "text": INSTRUCTION }] },
        "contents": [{ "role": "user", "parts": [{ "text": chat }] }],
        "generationConfig": { "temperature": 0.3, "maxOutputTokens": 80 },
    })
}

/// One line without wrapping quotes, or nothing for NONE and runaway answers.
fn tidy(text: &str) -> Option<String> {
    let line = text
        .trim()
        .trim_matches(|c: char| matches!(c, '"' | '\'' | '“' | '”' | '«' | '»' | '`'))
        .trim();
    let line = line.strip_prefix("User:").unwrap_or(line).trim();
    if line.is_empty()
        || line.trim_end_matches('.').eq_ignore_ascii_case(NOTHING)
        || line.chars().count() > MAX_SUGGESTION_CHARS
    {
        return None;
    }
    Some(line.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_keeps_the_last_prompts_in_order_before_the_reply() {
        let prompts = ["alpha", "bravo", " ", "charlie", "delta"].map(String::from);
        let body = request(&prompts, "Done. Should I push?");
        let chat = body["contents"][0]["parts"][0]["text"].as_str().unwrap();
        assert!(!chat.contains("alpha"));
        let (two, three, four) = (
            chat.find("bravo").unwrap(),
            chat.find("charlie").unwrap(),
            chat.find("delta").unwrap(),
        );
        assert!(two < three && three < four);
        assert!(chat.find("Should I push?").unwrap() > four);
        let instruction = body["systemInstruction"]["parts"][0]["text"]
            .as_str()
            .unwrap();
        assert!(instruction.contains("exactly NONE"));
    }

    #[test]
    fn tidy_drops_quotes_and_labels() {
        assert_eq!(
            tidy("  \"Evet, pushla.\"\n").as_deref(),
            Some("Evet, pushla.")
        );
        assert_eq!(
            tidy("User: run the tests").as_deref(),
            Some("run the tests")
        );
    }

    #[test]
    fn tidy_is_nothing_for_none_empty_or_long_text() {
        assert_eq!(tidy("NONE"), None);
        assert_eq!(tidy("none."), None);
        assert_eq!(tidy("  "), None);
        assert_eq!(tidy(&"x".repeat(MAX_SUGGESTION_CHARS + 1)), None);
    }

    #[test]
    fn suggest_needs_a_reply() {
        assert_eq!(suggest("key", &[], "  "), Ok(None));
    }
}
