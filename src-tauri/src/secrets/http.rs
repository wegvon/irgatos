//! `secrets.http`: the one place a `{{secret:NAME}}` placeholder turns into
//! its value. Everything here decides whether it may: the request must go
//! over HTTPS to a host the value is bound to, the placeholder may only sit
//! where the user allowed (a header, the URL, the body), and it can never
//! choose the host itself. Redirects are not followed, so a value cannot be
//! carried on to another host either.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::vault::SecretMeta;

pub const PLACES: [&str; 3] = ["header", "url", "body"];
const MAX_HEADERS: usize = 30;
const MAX_BODY_BYTES: usize = 1_000_000;
const MAX_RESPONSE_BYTES: u64 = 1_000_000;
const DEFAULT_MAX_CHARS: usize = 20_000;
const MAX_CHARS: usize = 100_000;
const DEFAULT_TIMEOUT: u64 = 30;
// The app CLI waits 40 seconds for an answer.
const MAX_TIMEOUT: u64 = 35;
const METHODS: [&str; 6] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

fn placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\{\{\s*secret:([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}").expect("valid pattern")
    })
}

/// Anything that looks like a placeholder but is not a well-formed one.
fn loose_placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\{\{\s*secret\s*:").expect("valid pattern"))
}

pub fn names_in(text: &str) -> Vec<String> {
    placeholder()
        .captures_iter(text)
        .map(|c| c[1].to_string())
        .collect()
}

pub fn has_placeholder(text: &str) -> bool {
    loose_placeholder().is_match(text)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HttpInput {
    #[serde(default)]
    pub method: Option<String>,
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub json: Option<Value>,
    #[serde(default)]
    pub purpose: Option<String>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub max_chars: Option<usize>,
}

/// Where a request goes, read from the URL as the agent wrote it.
#[derive(Debug, PartialEq)]
pub struct Target {
    pub host: String,
    pub port: Option<u16>,
}

/// The request with placeholders still in it, checked for shape.
pub struct Template {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    /// The body is JSON, so values go in JSON-escaped.
    pub body_is_json: bool,
    pub target: Target,
    /// Each secret named, with where it appears.
    pub uses: BTreeMap<String, BTreeSet<&'static str>>,
    pub purpose: Option<String>,
    pub timeout: u64,
    pub max_chars: usize,
}

/// The request as it goes out, values filled in.
pub struct Prepared {
    pub method: String,
    pub url: Zeroizing<String>,
    pub headers: Vec<(String, Zeroizing<String>)>,
    pub body: Option<Zeroizing<String>>,
    pub timeout: u64,
}

pub fn template(input: HttpInput) -> Result<Template, String> {
    let method = input
        .method
        .as_deref()
        .unwrap_or("GET")
        .trim()
        .to_ascii_uppercase();
    if !METHODS.contains(&method.as_str()) {
        return Err(format!("method must be one of {}", METHODS.join(", ")));
    }
    if input.headers.len() > MAX_HEADERS {
        return Err(format!("At most {MAX_HEADERS} headers"));
    }
    if input.body.is_some() && input.json.is_some() {
        return Err("Pass body or json, not both".into());
    }
    let target = target(&input.url)?;
    let mut uses: BTreeMap<String, BTreeSet<&'static str>> = BTreeMap::new();
    let mut note = |text: &str, place: &'static str| -> Result<(), String> {
        let names = names_in(text);
        if names.is_empty() && has_placeholder(text) {
            return Err("Malformed placeholder: write {{secret:NAME}}".into());
        }
        for name in names {
            uses.entry(name).or_default().insert(place);
        }
        Ok(())
    };
    note(&input.url, "url")?;
    let mut headers = Vec::new();
    let mut has_content_type = false;
    for (name, value) in &input.headers {
        let lower = name.trim().to_ascii_lowercase();
        if lower.is_empty()
            || !lower
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Invalid header name".into());
        }
        if ["host", "content-length", "transfer-encoding", "connection"].contains(&lower.as_str()) {
            return Err(format!("The {name} header is set by Irgatos"));
        }
        if value.contains(['\r', '\n']) {
            return Err("Header values cannot contain line breaks".into());
        }
        has_content_type |= lower == "content-type";
        note(value, "header")?;
        headers.push((name.trim().to_string(), value.clone()));
    }
    let (body, body_is_json) = match (input.body, input.json) {
        (Some(body), None) => (Some(body), false),
        (None, Some(value)) => {
            if !has_content_type {
                headers.push(("Content-Type".into(), "application/json".into()));
            }
            (
                Some(serde_json::to_string(&value).map_err(|e| e.to_string())?),
                true,
            )
        }
        _ => (None, false),
    };
    if let Some(body) = &body {
        if body.len() > MAX_BODY_BYTES {
            return Err("The body exceeds 1 MB".into());
        }
        note(body, "body")?;
    }
    if uses.is_empty() {
        return Err("secrets.http is only for requests that use a {{secret:NAME}} placeholder. Make other requests with your own tools.".into());
    }
    Ok(Template {
        method,
        url: input.url,
        headers,
        body,
        body_is_json,
        target,
        uses,
        purpose: input
            .purpose
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty()),
        timeout: input
            .timeout_seconds
            .unwrap_or(DEFAULT_TIMEOUT)
            .clamp(1, MAX_TIMEOUT),
        max_chars: input
            .max_chars
            .unwrap_or(DEFAULT_MAX_CHARS)
            .clamp(200, MAX_CHARS),
    })
}

/// The host and port of a request URL. A placeholder in the scheme, user
/// info, host or port is refused outright: a value must never decide where
/// it is sent.
pub fn target(url: &str) -> Result<Target, String> {
    let trimmed = url.trim();
    let Some(rest) = trimmed
        .get(..8)
        .filter(|scheme| scheme.eq_ignore_ascii_case("https://"))
        .map(|_| &trimmed[8..])
    else {
        return Err("Secrets are only sent over https://".into());
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains("{{") || authority.contains("}}") || has_placeholder(authority) {
        return Err(
            "A placeholder cannot be part of the host; the host must be written out".into(),
        );
    }
    if authority.contains('@') {
        return Err("URLs with a user name or password are refused".into());
    }
    let parsed = url::Url::parse(trimmed).map_err(|_| "Invalid URL")?;
    let host = parsed
        .host_str()
        .ok_or("The URL has no host")?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    Ok(Target {
        host,
        port: parsed.port(),
    })
}

/// A host pattern as the user may bind a value to: `api.stripe.com`,
/// `*.stripe.com` (any subdomain, not the bare domain) or `host:port`.
pub fn normalize_host(input: &str) -> Result<String, String> {
    let mut text = input.trim().to_ascii_lowercase();
    if let Some(rest) = text.strip_prefix("https://") {
        text = rest.to_string();
    }
    let text = text.trim_end_matches('/');
    let (host, port) = match text.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => {
            let port: u16 = port
                .parse()
                .map_err(|_| format!("Invalid port in {input}"))?;
            (host, Some(port))
        }
        _ => (text, None),
    };
    let host = host.trim_end_matches('.');
    let bare = host.strip_prefix("*.").unwrap_or(host);
    let valid = !bare.is_empty()
        && bare.len() <= 253
        && bare.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
        && !bare.starts_with('-');
    if !valid {
        return Err(format!("Not a host name: {input}"));
    }
    if host.starts_with("*.") && !bare.contains('.') {
        return Err(format!(
            "{input} is too broad; name the domain, such as *.example.com"
        ));
    }
    Ok(match port {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

pub fn host_allowed(target: &Target, patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| {
        let (host, port) = match pattern.rsplit_once(':') {
            Some((host, port)) => (host, port.parse::<u16>().ok()),
            None => (pattern.as_str(), None),
        };
        // A pattern without a port means the default HTTPS port only.
        let port_ok = match (port, target.port) {
            (None, None) => true,
            (Some(p), Some(t)) => p == t,
            (Some(443), None) => true,
            _ => false,
        };
        let host_ok = match host.strip_prefix("*.") {
            Some(domain) => target.host.ends_with(&format!(".{domain}")),
            None => target.host == host,
        };
        port_ok && host_ok
    })
}

/// Why a secret may not go into this request, if it may not.
pub fn refusal(meta: &SecretMeta, template: &Template, now: i64) -> Option<String> {
    let name = &meta.name;
    if !meta.usable_at(now) {
        return Some(format!("{name} has expired or been used up"));
    }
    if !host_allowed(&template.target, &meta.hosts) {
        return Some(format!(
            "{name} may only be sent to {}; this request goes to {}",
            meta.hosts.join(", "),
            template.target.host
        ));
    }
    let places = template.uses.get(name)?;
    if let Some(place) = places
        .iter()
        .find(|place| !meta.allow_in.iter().any(|a| a == *place))
    {
        return Some(format!(
            "{name} may only be placed in: {}; it was found in the {place}",
            meta.allow_in.join(", ")
        ));
    }
    if let Some(purpose) = &meta.purpose {
        if !template
            .purpose
            .as_deref()
            .is_some_and(|p| p.eq_ignore_ascii_case(purpose))
        {
            return Some(format!(
                "{name} may only be used for \"{purpose}\"; pass \"purpose\":\"{purpose}\" when that is what this request does"
            ));
        }
    }
    None
}

pub fn prepare(template: &Template, values: &HashMap<String, Zeroizing<String>>) -> Prepared {
    let fill = |text: &str, encode: fn(&str) -> String| -> Zeroizing<String> {
        Zeroizing::new(
            placeholder()
                .replace_all(text, |c: &regex::Captures<'_>| {
                    values
                        .get(&c[1])
                        .map(|value| encode(value))
                        .unwrap_or_default()
                })
                .into_owned(),
        )
    };
    Prepared {
        method: template.method.clone(),
        url: fill(&template.url, url_encode),
        headers: template
            .headers
            .iter()
            .map(|(name, value)| (name.clone(), fill(value, str::to_string)))
            .collect(),
        body: template.body.as_deref().map(|body| {
            if template.body_is_json {
                fill(body, json_escape)
            } else {
                fill(body, str::to_string)
            }
        }),
        timeout: template.timeout,
    }
}

fn url_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

fn json_escape(value: &str) -> String {
    let quoted = serde_json::to_string(value).unwrap_or_default();
    quoted[1..quoted.len().saturating_sub(1)].to_string()
}

/// Sends a prepared request. Error text may quote the URL, so the caller
/// scrubs it like any other output.
pub fn send(request: &Prepared) -> Result<Value, String> {
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(Duration::from_secs(request.timeout))
        .build();
    let mut call = agent.request(&request.method, &request.url);
    for (name, value) in &request.headers {
        call = call.set(name, value);
    }
    let result = match &request.body {
        Some(body) => call.send_string(body),
        None => call.call(),
    };
    let response = match result {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(error)) => return Err(format!("Request failed: {error}")),
    };
    let status = response.status();
    let mut headers = serde_json::Map::new();
    for name in response.headers_names() {
        if let Some(value) = response.header(&name) {
            headers.insert(name, json!(value));
        }
    }
    let content_type = response.content_type().to_string();
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_RESPONSE_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Could not read the response: {e}"))?;
    Ok(json!({
        "status": status,
        "headers": headers,
        "contentType": content_type,
        "body": String::from_utf8(bytes).ok(),
    }))
}

/// Clips the body a response returns to the model.
pub fn clip_body(response: &mut Value, max_chars: usize) {
    let Some(body) = response.get("body").and_then(Value::as_str) else {
        if response.get("body").is_some_and(Value::is_null) {
            response["note"] = json!("The response body is not text and was left out.");
        }
        return;
    };
    let total = body.chars().count();
    if total > max_chars {
        let clipped: String = body.chars().take(max_chars).collect();
        response["body"] = json!(clipped);
        response["truncated"] = json!({"totalChars": total, "shownChars": max_chars});
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(value: Value) -> HttpInput {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn placeholders_cannot_pick_the_host() {
        for url in [
            "https://{{secret:KEY}}.evil.com/x",
            "https://api.stripe.com.{{secret:KEY}}/",
            "https://{{secret:KEY}}@api.stripe.com/",
            "https://api.stripe.com:{{secret:KEY}}/",
        ] {
            assert!(target(url).is_err(), "{url}");
        }
        assert!(target("http://api.stripe.com/").is_err());
        assert!(target("https://user:pw@api.stripe.com/").is_err());
        assert_eq!(
            target("https://API.Stripe.com./v1?k={{secret:KEY}}").unwrap(),
            Target {
                host: "api.stripe.com".into(),
                port: None
            }
        );
    }

    #[test]
    fn host_patterns() {
        let t = |url: &str| target(url).unwrap();
        let exact = vec!["api.stripe.com".to_string()];
        let wild = vec!["*.stripe.com".to_string()];
        assert!(host_allowed(&t("https://api.stripe.com/v1"), &exact));
        assert!(!host_allowed(
            &t("https://api.stripe.com.evil.com/"),
            &exact
        ));
        assert!(!host_allowed(&t("https://evilapi.stripe.com/"), &exact));
        assert!(!host_allowed(&t("https://api.stripe.com:8443/"), &exact));
        assert!(host_allowed(&t("https://files.stripe.com/"), &wild));
        assert!(!host_allowed(&t("https://stripe.com/"), &wild));
        assert!(!host_allowed(&t("https://evilstripe.com/"), &wild));
        assert_eq!(
            normalize_host("https://API.stripe.com/").unwrap(),
            "api.stripe.com"
        );
        assert!(normalize_host("*").is_err());
        assert!(normalize_host("*.com").is_err());
        assert!(normalize_host("api.stripe.com/v1").is_err());
        assert_eq!(normalize_host("localhost:8443").unwrap(), "localhost:8443");
    }

    #[test]
    fn finds_each_place_a_secret_is_used() {
        let t = template(input(json!({
            "method": "post",
            "url": "https://api.stripe.com/v1/x?key={{secret:A_KEY}}",
            "headers": {"Authorization": "Bearer {{ secret:B_KEY }}"},
            "json": {"token": "{{secret:A_KEY}}"}
        })))
        .unwrap();
        assert_eq!(t.method, "POST");
        assert_eq!(
            t.uses
                .get("A_KEY")
                .unwrap()
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            vec!["body", "url"]
        );
        assert_eq!(
            t.uses
                .get("B_KEY")
                .unwrap()
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            vec!["header"]
        );
    }

    #[test]
    fn refuses_requests_without_placeholders_or_with_bad_ones() {
        assert!(template(input(json!({"url": "https://example.com"}))).is_err());
        assert!(template(input(
            json!({"url": "https://example.com", "headers": {"X": "{{secret: bad name}}"}})
        ))
        .is_err());
        assert!(template(input(
            json!({"url": "https://example.com", "headers": {"Host": "{{secret:A}}"}})
        ))
        .is_err());
        assert!(template(input(
            json!({"url": "https://example.com", "headers": {"X": "a\r\nB: {{secret:A}}"}})
        ))
        .is_err());
    }

    #[test]
    fn fills_values_encoded_for_their_place() {
        let t = template(input(json!({
            "url": "https://example.com/?q={{secret:K}}",
            "headers": {"X-Key": "{{secret:K}}"},
            "json": {"k": "{{secret:K}}"}
        })))
        .unwrap();
        let values = HashMap::from([("K".to_string(), Zeroizing::new("a b\"&c".to_string()))]);
        let p = prepare(&t, &values);
        assert_eq!(p.url.as_str(), "https://example.com/?q=a%20b%22%26c");
        assert_eq!(p.headers[0].1.as_str(), "a b\"&c");
        assert_eq!(
            p.body.as_deref().map(|b| b.as_str()),
            Some(r#"{"k":"a b\"&c"}"#)
        );
    }
}
