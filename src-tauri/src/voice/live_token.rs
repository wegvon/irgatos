//! One-use Gemini Live tokens, so a phone can open a Live call itself while
//! the API key stays on this Mac. The API's defaults fit a call: the token
//! starts one session within a minute, and that session may run 30 minutes.
//! https://ai.google.dev/gemini-api/docs/ephemeral-tokens

use std::time::Duration;

use serde_json::{json, Value};

const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

pub fn create(key: &str) -> Result<String, String> {
    let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
    match agent
        .post(ENDPOINT)
        .set("x-goog-api-key", key)
        .set("Content-Type", "application/json")
        .send_string(&json!({ "uses": 1 }).to_string())
    {
        Ok(response) => {
            let raw = response
                .into_string()
                .map_err(|_| "Gemini sent an unreadable reply".to_string())?;
            token_name(&raw).ok_or_else(|| "Gemini sent no live token".into())
        }
        Err(ureq::Error::Status(400, _))
        | Err(ureq::Error::Status(401, _))
        | Err(ureq::Error::Status(403, _)) => Err("Gemini rejected the API key".into()),
        Err(ureq::Error::Status(status, _)) => Err(format!("Gemini answered {status}")),
        Err(_) => Err("Could not reach Gemini".into()),
    }
}

/// The token is the created resource's name, `auth_tokens/…`.
fn token_name(raw: &str) -> Option<String> {
    let reply: Value = serde_json::from_str(raw).ok()?;
    let name = reply.get("name")?.as_str()?.trim();
    (name.starts_with("auth_tokens/") && name.len() <= 512).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_token_from_the_created_resource() {
        assert_eq!(
            token_name(r#"{"name":"auth_tokens/abc123","uses":1}"#).as_deref(),
            Some("auth_tokens/abc123")
        );
        assert_eq!(token_name(r#"{"name":"models/x"}"#), None);
        assert_eq!(token_name("{}"), None);
        assert_eq!(token_name("not json"), None);
    }
}
