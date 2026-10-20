//! Splits a message body into what its sender wrote and the earlier
//! conversation it quotes underneath ("On … wrote:", Outlook's
//! "From: / Sent:" block, trailing "> " lines). The thread already shows
//! each earlier message on its own, so the view folds the quote away.

const ATTRIBUTION_ENDINGS: &[&str] = &[
    "wrote:",
    "yazdı:",
    "schrieb:",
    "a écrit :",
    "a écrit:",
    "escribió:",
    "escreveu:",
    "ha scritto:",
    "schreef:",
];

const ATTRIBUTION_STARTS: &[&str] = &["on ", "le ", "am ", "el ", "em ", "il ", "op "];

const FROM_LABELS: &[&str] = &["from:", "kimden:", "von:", "de:", "da:", "van:"];

const SENT_LABELS: &[&str] = &[
    "sent:",
    "date:",
    "gönderildi:",
    "gönderilme tarihi:",
    "tarih:",
    "gesendet:",
    "datum:",
    "envoyé :",
    "envoyé:",
    "enviado:",
    "inviato:",
    "verzonden:",
];

/// `(new text, quoted earlier conversation)`. The quote is empty when there
/// is none, or when the whole body would be quote.
pub fn split_quoted(text: &str) -> (String, String) {
    let lines: Vec<&str> = text.lines().collect();
    let Some(cut) = quote_start(&lines) else {
        return (text.to_string(), String::new());
    };
    let new = lines[..cut].join("\n");
    if new.trim().is_empty() {
        return (text.to_string(), String::new());
    }
    (
        new.trim_end().to_string(),
        lines[cut..].join("\n").trim().to_string(),
    )
}

fn quote_start(lines: &[&str]) -> Option<usize> {
    let tail_quoted = trailing_quote_start(lines);
    for i in 0..lines.len() {
        if Some(i) == tail_quoted || is_attribution(lines, i) {
            return Some(i);
        }
        if is_header_block(lines, i) {
            match previous_line(lines, i) {
                Some(p) if is_forward_marker(lines[p]) => continue,
                Some(p) if is_separator(lines[p]) => return Some(p),
                _ => return Some(i),
            }
        }
        if is_original_message(lines[i]) {
            return Some(i);
        }
    }
    None
}

/// The first line of a closing run of `>` lines (blank lines allowed).
fn trailing_quote_start(lines: &[&str]) -> Option<usize> {
    let mut start = None;
    for (i, line) in lines.iter().enumerate().rev() {
        let line = line.trim_start();
        if line.starts_with('>') {
            start = Some(i);
        } else if !line.is_empty() {
            break;
        }
    }
    start
}

fn is_attribution(lines: &[&str], i: usize) -> bool {
    let line = lines[i].trim();
    if looks_like_attribution(line) {
        return true;
    }
    // Gmail wraps a long "On …" line so "wrote:" lands on the next one.
    let lower = line.to_lowercase();
    let starts_well = ATTRIBUTION_STARTS.iter().any(|s| lower.starts_with(s))
        || line.starts_with(|c: char| c.is_ascii_digit());
    match lines.get(i + 1).map(|l| l.trim()) {
        Some(next) if starts_well && next.chars().count() < 60 => {
            looks_like_attribution(&format!("{line} {next}"))
        }
        _ => false,
    }
}

fn looks_like_attribution(line: &str) -> bool {
    if line.chars().count() > 400 {
        return false;
    }
    let lower = line.to_lowercase();
    if !ATTRIBUTION_ENDINGS.iter().any(|e| lower.ends_with(e)) {
        return false;
    }
    let has_digit = line.chars().any(|c| c.is_ascii_digit());
    let named = line.contains('@')
        || line.contains('<')
        || ATTRIBUTION_STARTS.iter().any(|s| lower.starts_with(s));
    has_digit && named
}

fn label_line(line: &str) -> String {
    line.trim()
        .trim_start_matches('*')
        .trim_start()
        .to_lowercase()
}

fn is_header_block(lines: &[&str], i: usize) -> bool {
    let first = label_line(lines[i]);
    if !FROM_LABELS.iter().any(|l| first.starts_with(l)) {
        return false;
    }
    lines.iter().skip(i + 1).take(4).any(|line| {
        let line = label_line(line);
        SENT_LABELS.iter().any(|l| line.starts_with(l))
    })
}

fn previous_line(lines: &[&str], i: usize) -> Option<usize> {
    (0..i).rev().find(|&p| !lines[p].trim().is_empty())
}

fn is_separator(line: &str) -> bool {
    let line = line.trim();
    (line.chars().count() >= 5 && line.chars().all(|c| c == '_' || c == '-'))
        || is_original_message(line)
}

fn is_original_message(line: &str) -> bool {
    let lower = line.trim().trim_matches('-').trim().to_lowercase();
    matches!(
        lower.as_str(),
        "original message" | "orijinal ileti" | "ursprüngliche nachricht" | "message d'origine"
    )
}

fn is_forward_marker(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("forwarded message") || lower.contains("iletilen ileti")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_gmail_attribution_wrapped_over_two_lines() {
        let text = "Thanks, see you then.\n\nTurel\n\nOn Fri, Oct 16, 2026 at 12:04 Eglė Beinorienė <egle.b@ipxo.com<mailto:egle.b@ipxo.com>>\nwrote:\n> Dear Turel,\n> Hello";
        let (new, quoted) = split_quoted(text);
        assert_eq!(new, "Thanks, see you then.\n\nTurel");
        assert!(quoted.starts_with("On Fri, Oct 16"));
        assert!(quoted.ends_with("> Hello"));
    }

    #[test]
    fn folds_single_line_attribution() {
        let text = "Yes.\nOn Mon, Jan 5, 2026 at 9:00 AM John Smith wrote:\nearlier";
        assert_eq!(
            split_quoted(text),
            (
                "Yes.".into(),
                "On Mon, Jan 5, 2026 at 9:00 AM John Smith wrote:\nearlier".into()
            )
        );
    }

    #[test]
    fn folds_turkish_gmail_attribution() {
        let text =
            "Tamam.\n\n16 Eki 2026 Cum, 12:04 tarihinde Ali <ali@x.com> şunu yazdı:\n> Merhaba";
        assert_eq!(split_quoted(text).0, "Tamam.");
    }

    #[test]
    fn folds_outlook_header_block_from_its_separator() {
        let text = "Dear Turel,\n\nPlease send the list.\n\nipxo.com<https://www.ipxo.com/>\n________________________________\nFrom: Turel Ozdil <t@zvc.net>\nSent: Saturday, October 17, 2026 7:06 PM\nTo: Eglė <egle.b@ipxo.com>\nSubject: Re: Inquiry\n\nHello Eglė,";
        let (new, quoted) = split_quoted(text);
        assert_eq!(
            new,
            "Dear Turel,\n\nPlease send the list.\n\nipxo.com<https://www.ipxo.com/>"
        );
        assert!(quoted.starts_with("________________________________\nFrom: Turel"));
        assert!(quoted.ends_with("Hello Eglė,"));
    }

    #[test]
    fn folds_header_block_without_separator_and_bold_labels() {
        let text = "Ok\n\n*From:* A <a@b.com>\n*Date:* Mon\n*To:* me\n\nold";
        assert_eq!(split_quoted(text).0, "Ok");
    }

    #[test]
    fn folds_original_message_marker() {
        let text = "Noted.\n-----Original Message-----\nFrom: x\nold";
        assert_eq!(split_quoted(text).0, "Noted.");
    }

    #[test]
    fn folds_trailing_angle_quotes_only() {
        let text = "> question one\nanswer one\n\nbye\n> old line\n>\n> another";
        let (new, quoted) = split_quoted(text);
        assert_eq!(new, "> question one\nanswer one\n\nbye");
        assert_eq!(quoted, "> old line\n>\n> another");
    }

    #[test]
    fn keeps_forwarded_messages_in_the_body() {
        let text = "FYI\n\n---------- Forwarded message ---------\nFrom: A <a@b.com>\nDate: Mon\nSubject: x\n\nthe content";
        assert_eq!(split_quoted(text), (text.to_string(), String::new()));
    }

    #[test]
    fn keeps_bodies_that_are_only_quote() {
        let text = "On Mon, Jan 5, 2026 John <j@x.com> wrote:\n> hi";
        assert_eq!(split_quoted(text), (text.to_string(), String::new()));
    }

    #[test]
    fn leaves_plain_text_alone() {
        let text = "My colleague wrote:\nfrom: here to there\nnothing quoted";
        assert_eq!(split_quoted(text), (text.to_string(), String::new()));
    }
}
