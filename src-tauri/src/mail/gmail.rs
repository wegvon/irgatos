//! Gmail API shapes as Irgatos shows them: thread summaries, readable
//! message bodies and the RFC 822 reply a draft carries. Pure, so the wire
//! parsing is tested without Executor or Google.

use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;

use super::html_text::{decode_entities, html_text};
use crate::untrusted_text::{clean_text, HiddenPart};

/// Bodies longer than this are cut for the view and for agents.
pub const MAX_BODY_CHARS: usize = 40_000;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub subject: String,
    /// Sender of the latest message.
    pub from: String,
    pub snippet: String,
    /// Milliseconds since the epoch of the latest message.
    pub date: i64,
    pub unread: bool,
    pub in_inbox: bool,
    pub message_count: usize,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub from: String,
    pub to: String,
    pub cc: String,
    pub date: i64,
    pub subject: String,
    pub body: String,
    pub unread: bool,
    pub attachments: Vec<String>,
    /// Text in the mail a person cannot see; never part of `body`.
    pub hidden: Vec<HiddenPart>,
    #[serde(skip)]
    pub message_id_header: String,
    #[serde(skip)]
    pub references: String,
    #[serde(skip)]
    pub reply_to: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub to: String,
    pub body: String,
    pub updated: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub subject: String,
    pub unread: bool,
    pub in_inbox: bool,
    pub messages: Vec<Message>,
    pub drafts: Vec<Draft>,
    /// The mailbox's own address, so the view can tell sent from received.
    pub me: String,
}

fn header(message: &Value, name: &str) -> String {
    message
        .pointer("/payload/headers")
        .and_then(Value::as_array)
        .and_then(|headers| {
            headers.iter().find(|h| {
                h.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
        })
        .and_then(|h| h.get("value"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn labels(message: &Value) -> Vec<&str> {
    message
        .get("labelIds")
        .and_then(Value::as_array)
        .map(|ids| ids.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

fn internal_date(message: &Value) -> i64 {
    match message.get("internalDate") {
        Some(Value::String(raw)) => raw.parse().unwrap_or(0),
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        _ => 0,
    }
}

fn messages(thread: &Value) -> Vec<&Value> {
    thread
        .get("messages")
        .and_then(Value::as_array)
        .map(|list| list.iter().collect())
        .unwrap_or_default()
}

fn without_drafts<'a>(list: &[&'a Value]) -> Vec<&'a Value> {
    list.iter()
        .copied()
        .filter(|m| !labels(m).contains(&"DRAFT"))
        .collect()
}

fn has_label(list: &[&Value], label: &str) -> bool {
    list.iter().any(|m| labels(m).contains(&label))
}

/// A list row from a `users.threads.get` answer (any format with headers).
pub fn summary(thread: &Value) -> Option<ThreadSummary> {
    let id = thread.get("id")?.as_str()?.to_string();
    let all = messages(thread);
    let sent = without_drafts(&all);
    let list = if sent.is_empty() { all } else { sent };
    let first = list.first()?;
    let last = list.last()?;
    let subject = header(first, "Subject");
    Some(ThreadSummary {
        id,
        subject: if subject.is_empty() {
            "(no subject)".into()
        } else {
            subject
        },
        from: header(last, "From"),
        snippet: decode_entities(last.get("snippet").and_then(Value::as_str).unwrap_or("")),
        date: internal_date(last),
        unread: has_label(&list, "UNREAD"),
        in_inbox: has_label(&list, "INBOX"),
        message_count: list.len(),
    })
}

/// A whole thread from a `users.threads.get` answer in `full` format.
pub fn thread(thread: &Value, drafts: Vec<Draft>, me: &str) -> Option<Thread> {
    let id = thread.get("id")?.as_str()?.to_string();
    // Drafts live in the thread too; they are shown as drafts, not messages.
    let sent = without_drafts(&messages(thread));
    let messages: Vec<Message> = sent.iter().map(|m| message(m)).collect();
    let subject = messages
        .first()
        .map(|m| m.subject.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "(no subject)".into());
    Some(Thread {
        id,
        subject,
        unread: has_label(&sent, "UNREAD"),
        in_inbox: has_label(&sent, "INBOX"),
        messages,
        drafts,
        me: me.to_string(),
    })
}

pub fn message(m: &Value) -> Message {
    let mut attachments = Vec::new();
    if let Some(payload) = m.get("payload") {
        collect_attachments(payload, &mut attachments);
    }
    let mut hidden = Vec::new();
    let subject = clean_text(&header(m, "Subject"), &mut hidden);
    let text = m
        .get("payload")
        .map(|payload| body(payload, &mut hidden))
        .unwrap_or_default();
    Message {
        id: m
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        from: header(m, "From"),
        to: header(m, "To"),
        cc: header(m, "Cc"),
        date: internal_date(m),
        subject,
        body: text,
        unread: labels(m).contains(&"UNREAD"),
        attachments,
        hidden,
        message_id_header: header(m, "Message-ID"),
        references: header(m, "References"),
        reply_to: header(m, "Reply-To"),
    }
}

/// A draft from a `users.drafts.get` answer in `full` format.
pub fn draft(value: &Value) -> Option<Draft> {
    let id = value.get("id")?.as_str()?.to_string();
    let m = value.get("message")?;
    Some(Draft {
        id,
        to: header(m, "To"),
        body: m
            .get("payload")
            .map(|payload| body(payload, &mut Vec::new()))
            .unwrap_or_default(),
        updated: internal_date(m),
    })
}

fn collect_attachments(part: &Value, out: &mut Vec<String>) {
    let name = part
        .get("filename")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !name.is_empty() {
        out.push(name.to_string());
    }
    for child in part
        .get("parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        collect_attachments(child, out);
    }
}

fn part_text(part: &Value, mime: &str) -> Option<String> {
    let kind = part.get("mimeType").and_then(Value::as_str).unwrap_or("");
    let is_attachment = part
        .get("filename")
        .and_then(Value::as_str)
        .is_some_and(|name| !name.is_empty());
    if kind.eq_ignore_ascii_case(mime) && !is_attachment {
        if let Some(data) = part.pointer("/body/data").and_then(Value::as_str) {
            return decode_base64url(data);
        }
    }
    part.get("parts")
        .and_then(Value::as_array)?
        .iter()
        .find_map(|child| part_text(child, mime))
}

/// The readable text of a payload: plain text when the sender gave it,
/// otherwise what a person sees of the HTML. What they cannot see (comments,
/// invisible styles and characters, base64 text) goes to `hidden` instead.
pub fn body(payload: &Value, hidden: &mut Vec<HiddenPart>) -> String {
    let text = match part_text(payload, "text/plain") {
        Some(text) => text,
        None => part_text(payload, "text/html")
            .map(|html| {
                let (text, found) = html_text(&html);
                hidden.extend(found);
                text
            })
            .unwrap_or_default(),
    };
    let text = clean_text(&text, hidden);
    hidden.truncate(crate::untrusted_text::MAX_PARTS);
    truncate(text.trim(), MAX_BODY_CHARS)
}

pub fn truncate(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((at, _)) => format!("{}\n[…truncated]", &text[..at]),
        None => text.to_string(),
    }
}

fn decode_base64url(data: &str) -> Option<String> {
    let clean: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = URL_SAFE_NO_PAD
        .decode(clean.trim_end_matches('='))
        .or_else(|_| URL_SAFE.decode(&clean))
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).replace("\r\n", "\n"))
}

/// The bare address in `Name <a@b>` (or the whole value when it has none).
pub fn address(value: &str) -> String {
    match (value.rfind('<'), value.rfind('>')) {
        (Some(start), Some(end)) if start < end => value[start + 1..end].trim().to_lowercase(),
        _ => value.trim().to_lowercase(),
    }
}

/// Who a reply goes to: the latest message someone else sent, by its
/// Reply-To when present. Falls back to the latest recipient of a thread
/// the user started.
pub fn reply_recipient(messages: &[Message], me: &str) -> String {
    let me = me.trim().to_lowercase();
    if let Some(m) = messages.iter().rev().find(|m| address(&m.from) != me) {
        return if m.reply_to.is_empty() {
            m.from.clone()
        } else {
            m.reply_to.clone()
        };
    }
    messages.last().map(|m| m.to.clone()).unwrap_or_default()
}

fn encode_header(value: &str) -> String {
    let value = value.replace(['\r', '\n'], " ");
    if value.is_ascii() {
        value
    } else {
        format!("=?UTF-8?B?{}?=", STANDARD.encode(value.as_bytes()))
    }
}

pub fn reply_subject(subject: &str) -> String {
    let trimmed = subject.trim();
    let lower = trimmed.to_lowercase();
    if lower.starts_with("re:") || lower.starts_with("ynt:") {
        trimmed.to_string()
    } else {
        format!("Re: {trimmed}")
    }
}

/// The RFC 822 reply to `thread`, base64url-encoded for `message.raw`.
pub fn reply_raw(thread: &Thread, to: &str, body: &str) -> Result<String, String> {
    let to = to.replace(['\r', '\n'], " ");
    if to.trim().is_empty() {
        return Err("This thread has no one to reply to".into());
    }
    let last = thread.messages.last();
    let in_reply_to = last
        .map(|m| m.message_id_header.clone())
        .unwrap_or_default();
    let references = last
        .map(|m| {
            [m.references.as_str(), m.message_id_header.as_str()]
                .iter()
                .filter(|s| !s.is_empty())
                .copied()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    let mut mime = String::new();
    mime.push_str(&format!("To: {}\r\n", to.trim()));
    mime.push_str(&format!(
        "Subject: {}\r\n",
        encode_header(&reply_subject(&thread.subject))
    ));
    if !in_reply_to.is_empty() {
        mime.push_str(&format!("In-Reply-To: {in_reply_to}\r\n"));
    }
    if !references.is_empty() {
        mime.push_str(&format!(
            "References: {}\r\n",
            references.replace(['\r', '\n'], " ")
        ));
    }
    mime.push_str("MIME-Version: 1.0\r\n");
    mime.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\n");
    mime.push_str("Content-Transfer-Encoding: base64\r\n\r\n");
    let encoded = STANDARD.encode(body.replace("\r\n", "\n").replace('\n', "\r\n").as_bytes());
    for chunk in encoded.as_bytes().chunks(76) {
        mime.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        mime.push_str("\r\n");
    }
    Ok(URL_SAFE.encode(mime.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn b64(text: &str) -> String {
        URL_SAFE_NO_PAD.encode(text.as_bytes())
    }

    fn sample_thread() -> Value {
        json!({
            "id": "t1",
            "messages": [
                {
                    "id": "m1",
                    "labelIds": ["INBOX"],
                    "internalDate": "1000",
                    "snippet": "Merhaba &amp; selam",
                    "payload": {
                        "mimeType": "multipart/alternative",
                        "headers": [
                            {"name": "From", "value": "Ayşe <ayse@example.com>"},
                            {"name": "To", "value": "turel@example.com"},
                            {"name": "Subject", "value": "Fatura"},
                            {"name": "Message-ID", "value": "<a1@example.com>"}
                        ],
                        "parts": [
                            {"mimeType": "text/plain", "body": {"data": b64("Faturayı\r\ngönderir misin?")}},
                            {"mimeType": "text/html", "body": {"data": b64("<p>ignored</p>")}},
                            {"mimeType": "application/pdf", "filename": "fatura.pdf", "body": {"attachmentId": "x"}}
                        ]
                    }
                },
                {
                    "id": "m2",
                    "labelIds": ["INBOX", "UNREAD"],
                    "internalDate": "2000",
                    "snippet": "Hatırlatma",
                    "payload": {
                        "mimeType": "text/html",
                        "headers": [
                            {"name": "from", "value": "Ayşe <ayse@example.com>"},
                            {"name": "Reply-To", "value": "muhasebe@example.com"},
                            {"name": "Message-ID", "value": "<a2@example.com>"},
                            {"name": "References", "value": "<a1@example.com>"}
                        ],
                        "body": {"data": b64("<html><head><style>p{}</style></head><body><p>Hatırlatma</p><br>Teşekkürler&nbsp;&#x21;</body></html>")}
                    }
                },
                {
                    "id": "d1",
                    "labelIds": ["DRAFT"],
                    "internalDate": "3000",
                    "payload": {"mimeType": "text/plain", "headers": [], "body": {"data": b64("taslak")}}
                }
            ]
        })
    }

    #[test]
    fn summarizes_a_thread() {
        let s = summary(&sample_thread()).unwrap();
        assert_eq!(s.subject, "Fatura");
        assert_eq!(s.from, "Ayşe <ayse@example.com>");
        assert_eq!(s.snippet, "Hatırlatma");
        assert!(s.unread);
        assert!(s.in_inbox);
        assert_eq!(s.message_count, 2, "a draft is not a message");
        assert_eq!(s.date, 2000);
    }

    #[test]
    fn reads_plain_text_first_and_html_otherwise() {
        let t = thread(&sample_thread(), vec![], "turel@example.com").unwrap();
        assert_eq!(t.messages.len(), 2, "drafts are not messages");
        assert_eq!(t.messages[0].body, "Faturayı\ngönderir misin?");
        assert_eq!(t.messages[0].attachments, vec!["fatura.pdf"]);
        assert_eq!(t.messages[1].body, "Hatırlatma\n\nTeşekkürler !");
        assert!(!t.messages[0].unread && t.messages[1].unread);
        assert!(t.unread);
    }

    #[test]
    fn replies_to_reply_to_of_latest_other_sender() {
        let t = thread(&sample_thread(), vec![], "turel@example.com").unwrap();
        assert_eq!(
            reply_recipient(&t.messages, "Turel@Example.com"),
            "muhasebe@example.com"
        );
        let mine = vec![Message {
            from: "Turel <turel@example.com>".into(),
            to: "bob@example.com".into(),
            ..t.messages[0].clone()
        }];
        assert_eq!(
            reply_recipient(&mine, "turel@example.com"),
            "bob@example.com"
        );
    }

    #[test]
    fn builds_a_threaded_utf8_reply() {
        let t = thread(&sample_thread(), vec![], "turel@example.com").unwrap();
        let raw = reply_raw(&t, "muhasebe@example.com", "Tamam,\ngönderiyorum.").unwrap();
        let mime = String::from_utf8(URL_SAFE.decode(raw).unwrap()).unwrap();
        assert!(mime.contains("To: muhasebe@example.com\r\n"));
        assert!(mime.contains("Subject: Re: Fatura\r\n"));
        assert!(mime.contains("In-Reply-To: <a2@example.com>\r\n"));
        assert!(mime.contains("References: <a1@example.com> <a2@example.com>\r\n"));
        let body = mime.split("\r\n\r\n").nth(1).unwrap().replace("\r\n", "");
        assert_eq!(
            String::from_utf8(STANDARD.decode(body).unwrap()).unwrap(),
            "Tamam,\r\ngönderiyorum."
        );
    }

    #[test]
    fn encodes_non_ascii_subjects_and_drops_header_breaks() {
        assert_eq!(encode_header("a\r\nBcc: x"), "a  Bcc: x");
        assert!(encode_header("Ödeme").starts_with("=?UTF-8?B?"));
        assert_eq!(reply_subject("RE: x"), "RE: x");
        assert_eq!(reply_subject("Ynt: x"), "Ynt: x");
    }

    #[test]
    fn rejects_a_reply_without_recipient() {
        let t = thread(&sample_thread(), vec![], "me@x").unwrap();
        assert!(reply_raw(&t, "  ", "x").is_err());
    }

    #[test]
    fn reads_a_draft() {
        let d = draft(&json!({
            "id": "r1",
            "message": {"internalDate": "5", "payload": {"mimeType": "text/plain", "headers": [{"name": "To", "value": "a@b"}], "body": {"data": b64("hi")}}}
        }))
        .unwrap();
        assert_eq!(
            d,
            Draft {
                id: "r1".into(),
                to: "a@b".into(),
                body: "hi".into(),
                updated: 5
            }
        );
    }

    #[test]
    fn truncates_by_characters() {
        assert_eq!(truncate("çok", 2), "ço\n[…truncated]");
        assert_eq!(truncate("ok", 2), "ok");
        assert_eq!(
            decode_entities("&gt; &gt; Türel Bey &amp; ekip"),
            "> > Türel Bey & ekip"
        );
        assert_eq!(decode_entities("&ü çok"), "&ü çok");
    }
}
