//! Output scrubbing: what goes back to a model, or into a saved chat, is
//! scanned for the values the user handed over and for well-known secret
//! shapes (API key prefixes, Authorization headers, private keys, env dumps).
//! Each match becomes `[REDACTED]`.

use std::sync::OnceLock;

use base64::Engine;
use regex::Regex;
use serde_json::Value;

pub const REDACTED: &str = "[REDACTED]";
/// Shorter values would wipe ordinary words out of every output.
pub const MIN_VALUE_CHARS: usize = 4;

/// Replaces every value (and its common encodings) with `[REDACTED]`.
pub fn values(text: &str, values: &[&str]) -> String {
    let mut out = text.to_string();
    for value in values {
        if value.chars().count() < MIN_VALUE_CHARS {
            continue;
        }
        for form in encodings(value) {
            if out.contains(form.as_str()) {
                out = out.replace(form.as_str(), REDACTED);
            }
        }
    }
    out
}

/// Values first, then the well-known formats.
pub fn all(text: &str, secret_values: &[&str]) -> String {
    known_formats(&values(text, secret_values))
}

/// Applies `scrub` to every string in a JSON value, keys included.
pub fn json(value: &mut Value, scrub: &dyn Fn(&str) -> String) {
    match value {
        Value::String(text) => {
            let clean = scrub(text);
            if clean != *text {
                *text = clean;
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| json(item, scrub)),
        Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                let clean = scrub(&key);
                let mut item = map.remove(&key).unwrap_or(Value::Null);
                if sensitive_key(&key) && item.as_str().is_some_and(|text| !text.is_empty()) {
                    item = Value::String(REDACTED.into());
                } else {
                    json(&mut item, scrub);
                }
                map.insert(clean, item);
            }
        }
        _ => {}
    }
}

/// A JSON key or header name whose string value is a secret by its name:
/// `set-cookie`, `Authorization`, `client_secret`, `api_key` and the like.
pub fn sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace('-', "_");
    const EXACT: [&str; 6] = [
        "authorization",
        "proxy_authorization",
        "cookie",
        "set_cookie",
        "x_api_key",
        "api_key",
    ];
    const PARTS: [&str; 9] = [
        "secret",
        "password",
        "passwd",
        "apikey",
        "api_key",
        "access_token",
        "refresh_token",
        "private_key",
        "auth_token",
    ];
    EXACT.contains(&key.as_str()) || PARTS.iter().any(|part| key.contains(part))
}

/// The value as it may appear in output: raw, base64 (as in a Basic auth
/// header or an encoded dump), percent-encoded and JSON-escaped.
fn encodings(value: &str) -> Vec<String> {
    let mut forms = vec![value.to_string()];
    let engines = [
        base64::engine::general_purpose::STANDARD.encode(value),
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value),
        base64::engine::general_purpose::STANDARD_NO_PAD.encode(value),
    ];
    if value.len() >= 6 {
        forms.extend(engines);
    }
    let percent: String = url::form_urlencoded::byte_serialize(value.as_bytes()).collect();
    forms.push(percent);
    if let Ok(quoted) = serde_json::to_string(value) {
        forms.push(quoted[1..quoted.len() - 1].to_string());
    }
    forms.sort();
    forms.dedup();
    // Longest first, so an encoding that contains the raw value goes whole.
    forms.sort_by_key(|form| std::cmp::Reverse(form.len()));
    forms
}

struct Rule {
    pattern: Regex,
    /// Replacement; `$1`… keep the label in front of the secret.
    with: &'static str,
}

fn rules() -> &'static [Rule] {
    static RULES: OnceLock<Vec<Rule>> = OnceLock::new();
    RULES.get_or_init(|| {
        let rule = |pattern: &str, with: &'static str| Rule {
            pattern: Regex::new(pattern).expect("valid redaction pattern"),
            with,
        };
        vec![
            rule(
                r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\z)",
                REDACTED,
            ),
            // curl -v, HTTP dumps and header maps: keep the header name.
            rule(
                r#"(?im)\b((?:proxy-)?authorization|x-api-key|api-key|x-auth-token|x-access-token|private-token|cookie|set-cookie)("?\s*[:=]\s*"?)[^\r\n"]+"#,
                "$1$2[REDACTED]",
            ),
            rule(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}", "$1 [REDACTED]"),
            // KEY=value lines, as `env`, `printenv` or `set` print them.
            rule(
                r"(?im)^(\s*(?:export\s+|declare -x\s+)?[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?|AUTH)[A-Za-z0-9_]*=)(.+)$",
                "$1[REDACTED]",
            ),
            // "api_key": "…" in JSON or YAML-ish output.
            rule(
                r#"(?i)("?[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api_?key|apikey|access_?key|private_?key|client_?secret)[A-Za-z0-9_.-]*"?\s*[:=]\s*")([^"\r\n]{4,})(")"#,
                "$1[REDACTED]$3",
            ),
            // https://user:password@host
            rule(r"(?i)\b([a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+@", "$1[REDACTED]@"),
            rule(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}", REDACTED),
            rule(r"\bwhsec_[A-Za-z0-9]{10,}", REDACTED),
            rule(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}", REDACTED),
            rule(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}", REDACTED),
            rule(r"\bgithub_pat_[A-Za-z0-9_]{20,}", REDACTED),
            rule(r"\bglpat-[A-Za-z0-9_-]{20,}", REDACTED),
            rule(r"\bxox[abposr]-[A-Za-z0-9-]{10,}", REDACTED),
            rule(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", REDACTED),
            rule(r"\bAIza[0-9A-Za-z_-]{35}", REDACTED),
            rule(r"\bnpm_[A-Za-z0-9]{36}\b", REDACTED),
            rule(
                r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
                REDACTED,
            ),
        ]
    })
}

pub fn known_formats(text: &str) -> String {
    let mut out = std::borrow::Cow::Borrowed(text);
    for rule in rules() {
        if rule.pattern.is_match(&out) {
            out = std::borrow::Cow::Owned(rule.pattern.replace_all(&out, rule.with).into_owned());
        }
    }
    out.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fake values only; none of these is a real credential.
    const VALUE: &str = "Zx9-FAKE-not-a-real-key-123";

    #[test]
    fn removes_the_value_and_its_encodings() {
        let b64 = base64::engine::general_purpose::STANDARD.encode(VALUE);
        let basic = base64::engine::general_purpose::STANDARD.encode(format!("user:{VALUE}"));
        let text = format!(
            "raw {VALUE} b64 {b64} url {} json {}",
            url::form_urlencoded::byte_serialize(VALUE.as_bytes()).collect::<String>(),
            serde_json::to_string(VALUE).unwrap()
        );
        let out = values(&text, &[VALUE]);
        assert!(!out.contains(VALUE), "{out}");
        assert!(!out.contains(&b64), "{out}");
        assert!(out.matches(REDACTED).count() >= 4, "{out}");
        // A Basic header built around the value is caught by its shape.
        let header = all(&format!("Authorization: Basic {basic}"), &[VALUE]);
        assert!(!header.contains(&basic), "{header}");
    }

    #[test]
    fn env_dump_is_scrubbed() {
        let dump = "HOME=/Users/turel\nSTRIPE_KEY=sk_test_FAKE0000000000000000\nGITHUB_TOKEN=ghp_FAKEFAKEFAKEFAKEFAKEFAKE00\nexport DB_PASSWORD=hunter2hunter2\nPATH=/usr/bin\nMY_VALUE=Zx9-FAKE-not-a-real-key-123";
        let out = all(dump, &[VALUE]);
        assert!(out.contains("HOME=/Users/turel"));
        assert!(out.contains("PATH=/usr/bin"));
        assert!(out.contains("STRIPE_KEY=[REDACTED]"), "{out}");
        assert!(out.contains("GITHUB_TOKEN=[REDACTED]"), "{out}");
        assert!(out.contains("DB_PASSWORD=[REDACTED]"), "{out}");
        assert!(out.contains("MY_VALUE=[REDACTED]"), "{out}");
        for leaked in ["sk_test_FAKE", "ghp_FAKE", "hunter2", VALUE] {
            assert!(!out.contains(leaked), "{leaked} leaked: {out}");
        }
    }

    #[test]
    fn curl_verbose_output_is_scrubbed() {
        let curl = "*   Trying 1.2.3.4:443...\n> GET /v1/charges HTTP/2\n> Host: api.stripe.com\n> authorization: Bearer sk_live_FAKE00000000000000\n> X-Api-Key: abcdefghijklmnop\n> Cookie: session=abcdef123456\n< HTTP/2 200\n< set-cookie: sid=xyz987654321; Path=/\n{\"id\":\"ch_1\",\"client_secret\":\"pi_FAKE_secret_abcdef\"}";
        let out = known_formats(curl);
        assert!(out.contains("> Host: api.stripe.com"));
        assert!(out.contains("< HTTP/2 200"));
        for leaked in [
            "sk_live_FAKE",
            "abcdefghijklmnop",
            "session=abcdef",
            "xyz987654321",
            "pi_FAKE_secret",
        ] {
            assert!(!out.contains(leaked), "{leaked} leaked: {out}");
        }
        assert!(
            out.to_lowercase().contains("authorization: [redacted]"),
            "{out}"
        );
    }

    #[test]
    fn known_prefixes_private_keys_and_urls() {
        let text = "aws AKIAFAKEFAKEFAKEFAKE slack xoxb-0000-FAKE-token and key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIFAKE\n-----END RSA PRIVATE KEY-----\nurl https://bob:pa55word@db.example.com/x jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.FAKEsignature00";
        let out = known_formats(text);
        for leaked in ["AKIAFAKE", "xoxb-", "MIIFAKE", "pa55word", "eyJhbGci"] {
            assert!(!out.contains(leaked), "{leaked} leaked: {out}");
        }
        assert!(
            out.contains("https://bob:[REDACTED]@db.example.com/x"),
            "{out}"
        );
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let text = "Build passed in 12s. 3 files changed; tokens used: 1200. See https://example.com/docs?page=2";
        assert_eq!(all(text, &["abc"]), text);
    }

    #[test]
    fn sensitive_keys_lose_their_values() {
        let mut value = serde_json::json!({
            "headers": {"Set-Cookie": "sid=abc123def456", "content-type": "text/plain"},
            "client_secret": "pi_FAKE", "maxTokens": "1200", "access_token": "",
        });
        json(&mut value, &|text| all(text, &[]));
        assert_eq!(value["headers"]["Set-Cookie"], REDACTED);
        assert_eq!(value["headers"]["content-type"], "text/plain");
        assert_eq!(value["client_secret"], REDACTED);
        assert_eq!(value["maxTokens"], "1200");
        assert_eq!(value["access_token"], "");
    }

    #[test]
    fn scrubs_inside_json() {
        let mut value = serde_json::json!({
            "ok": true,
            "result": {"body": format!("echo {VALUE}"), "list": [VALUE]},
            VALUE: 1,
        });
        json(&mut value, &|text| all(text, &[VALUE]));
        let text = value.to_string();
        assert!(!text.contains(VALUE), "{text}");
    }
}
