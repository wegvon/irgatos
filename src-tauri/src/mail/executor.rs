//! Gmail through the user's Executor (executor.sh): Irgatos never holds a
//! Google credential, only an Executor API key. Each call runs one fixed
//! TypeScript script on Executor's `POST /api/executions`; values reach the
//! script as JSON literals, never as code.

use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

const HTTP_TIMEOUT: Duration = Duration::from_secs(90);

/// The connection's tool prefix found last time, so later calls skip the
/// catalog search. Cleared when the endpoint or key changes.
static GMAIL_PREFIX: Mutex<Option<String>> = Mutex::new(None);

pub fn forget_connection() {
    if let Ok(mut prefix) = GMAIL_PREFIX.lock() {
        *prefix = None;
    }
}

/// `https://host`, from whatever the user pasted: the console URL, the MCP
/// URL or the API root.
pub fn normalize_endpoint(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let mut url = url::Url::parse(trimmed)
        .map_err(|_| "Enter the Executor URL, such as https://executor.example.com")?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
        return Err("The Executor URL must start with https://".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    let base = match (path.strip_suffix("/mcp"), path.strip_suffix("/api")) {
        // A console link such as /<org>/mcp keeps nothing but the origin.
        (Some(rest), _) if rest.split('/').filter(|s| !s.is_empty()).count() == 1 => "",
        (Some(rest), _) | (_, Some(rest)) => rest,
        _ => path.as_str(),
    }
    .to_string();
    url.set_path(&base);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// Shared by every script: unwraps `{ ok, data }` tool results and finds the
/// Gmail connection by a tool only Gmail has.
const PRELUDE: &str = r#"
const unwrap = (result, what) => {
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok) return result.data;
    const error = result.error || {};
    throw new Error(what + ": " + (error.message || JSON.stringify(error)));
  }
  return result;
};
const findGmail = async () => {
  if (KNOWN_PREFIX) return KNOWN_PREFIX;
  const found = unwrap(await tools.search({ query: "gmail users threads list", limit: 25 }), "search");
  const paths = ((found && found.items) || []).map((item) => String(item.path || "").replace(/^tools\./, ""));
  const hit = paths.find((path) => path.endsWith("users.threads.list"));
  if (!hit) throw new Error("NO_GMAIL");
  return hit.slice(0, -"users.threads.list".length);
};
const prefix = await findGmail();
const gmail = async (op, args) => unwrap(await tools[prefix + op](args), op);
"#;

pub struct Executor {
    pub endpoint: String,
    pub key: String,
}

impl Executor {
    /// Runs `body` after the prelude with `input` bound as `INPUT`.
    pub fn run(&self, body: &str, input: Value) -> Result<Value, String> {
        let known = GMAIL_PREFIX.lock().ok().and_then(|p| p.clone());
        let code = format!(
            "const INPUT = {};\nconst KNOWN_PREFIX = {};\n{PRELUDE}\nconst result = await (async () => {{\n{body}\n}})();\nreturn {{ prefix, result }};",
            serde_json::to_string(&input).map_err(|e| e.to_string())?,
            serde_json::to_string(&known).map_err(|e| e.to_string())?,
        );
        let value = self
            .post(&code)
            .and_then(|answer| completed_result(&answer));
        // A renamed or removed connection is found again on the next call.
        // Never retried here: the failed call may have sent mail already.
        let value = value.inspect_err(|_| forget_connection())?;
        if let Some(prefix) = value.get("prefix").and_then(Value::as_str) {
            if let Ok(mut known) = GMAIL_PREFIX.lock() {
                *known = Some(prefix.to_string());
            }
        }
        Ok(value.get("result").cloned().unwrap_or(Value::Null))
    }

    fn post(&self, code: &str) -> Result<Value, String> {
        let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
        // Irgatos only runs its own fixed scripts, and the user is the one
        // acting here, so approval-gated Gmail tools run without a second
        // prompt. Sending is still only reachable from the Send button.
        let payload = json!({ "code": code, "autoApprove": true });
        let result = agent
            .post(&format!("{}/api/executions", self.endpoint))
            .set("Authorization", &format!("Bearer {}", self.key.trim()))
            .set("Content-Type", "application/json")
            .send_string(&payload.to_string());
        let response = match result {
            Ok(response) => response,
            Err(ureq::Error::Status(401 | 403, _)) => {
                return Err("Executor rejected the API key".into());
            }
            Err(ureq::Error::Status(404, _)) => {
                return Err("This URL is not an Executor server".into());
            }
            Err(ureq::Error::Status(status, response)) => {
                let body = response.into_string().unwrap_or_default();
                return Err(format!("Executor answered {status}: {}", short(&body)));
            }
            Err(_) => return Err("Could not reach Executor".into()),
        };
        let body = response
            .into_string()
            .map_err(|_| "Executor returned an unreadable response".to_string())?;
        serde_json::from_str(&body).map_err(|_| "Executor returned an unreadable response".into())
    }
}

fn short(text: &str) -> String {
    let text = text.trim();
    match text.char_indices().nth(300) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_string(),
    }
}

/// The script's return value from an execution answer, or why there is none.
pub fn completed_result(answer: &Value) -> Result<Value, String> {
    match answer.get("status").and_then(Value::as_str) {
        Some("completed") => {}
        Some("paused") => {
            return Err(
                "Executor is waiting for an approval it did not get. Allow these Gmail tools in Executor's policies.".into(),
            );
        }
        _ => return Err(format!("Executor answered: {}", short(&answer.to_string()))),
    }
    let structured = answer.get("structured").cloned().unwrap_or(Value::Null);
    let failed = answer
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || structured.get("status").and_then(Value::as_str) == Some("error");
    if failed {
        let error = structured
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                answer
                    .get("text")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_default();
        if error.contains("NO_GMAIL") {
            return Err("Executor has no Gmail connection. Add Gmail in Executor first.".into());
        }
        return Err(format!(
            "Gmail: {}",
            short(error.trim_start_matches("Error: "))
        ));
    }
    Ok(structured.get("result").cloned().unwrap_or(Value::Null))
}

pub const LIST: &str = r#"
const list = await gmail("users.threads.list", {
  userId: "me",
  q: INPUT.query,
  maxResults: 25,
  ...(INPUT.pageToken ? { pageToken: INPUT.pageToken } : {}),
});
const threads = await Promise.all(
  ((list && list.threads) || []).map((thread) =>
    gmail("users.threads.get", { userId: "me", id: thread.id, format: "metadata" })
  )
);
return { threads, nextPageToken: (list && list.nextPageToken) || null };
"#;

/// The thread, the mailbox address and the drafts that belong to it.
pub const READ: &str = r#"
const [thread, profile, drafts] = await Promise.all([
  gmail("users.threads.get", { userId: "me", id: INPUT.threadId, format: "full" }),
  gmail("users.getProfile", { userId: "me" }),
  gmail("users.drafts.list", { userId: "me", maxResults: 100 }),
]);
const mine = ((drafts && drafts.drafts) || []).filter(
  (draft) => draft.message && draft.message.threadId === INPUT.threadId
);
const full = await Promise.all(
  mine.map((draft) => gmail("users.drafts.get", { userId: "me", id: draft.id, format: "full" }))
);
return { thread, me: (profile && profile.emailAddress) || "", drafts: full };
"#;

pub const SAVE_DRAFT: &str = r#"
const message = { raw: INPUT.raw, threadId: INPUT.threadId };
const saved = INPUT.draftId
  ? await gmail("users.drafts.update", { userId: "me", id: INPUT.draftId, body: { id: INPUT.draftId, message } })
  : await gmail("users.drafts.create", { userId: "me", body: { message } });
return gmail("users.drafts.get", { userId: "me", id: saved.id, format: "full" });
"#;

pub const SEND_DRAFT: &str = r#"
return gmail("users.drafts.send", { userId: "me", body: { id: INPUT.draftId } });
"#;

pub const MODIFY: &str = r#"
await gmail("users.threads.modify", {
  userId: "me",
  id: INPUT.threadId,
  body: { removeLabelIds: INPUT.remove },
});
return true;
"#;

pub const CHECK: &str = r#"
return gmail("users.getProfile", { userId: "me" });
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pasted_urls() {
        for raw in [
            "https://executor.zvc.net",
            "https://executor.zvc.net/",
            "https://executor.zvc.net/mcp",
            "https://executor.zvc.net/api/",
            "https://executor.zvc.net/org_123/mcp",
        ] {
            assert_eq!(
                normalize_endpoint(raw).unwrap(),
                "https://executor.zvc.net",
                "{raw}"
            );
        }
        assert_eq!(
            normalize_endpoint("http://localhost:4788").unwrap(),
            "http://localhost:4788"
        );
        assert_eq!(
            normalize_endpoint("https://host/executor").unwrap(),
            "https://host/executor"
        );
        assert_eq!(normalize_endpoint(" ").unwrap(), "");
        assert!(normalize_endpoint("ftp://x").is_err());
        assert!(normalize_endpoint("executor").is_err());
    }

    #[test]
    fn reads_completed_results() {
        let answer = json!({
            "status": "completed",
            "text": "{}",
            "structured": {"status": "completed", "result": {"prefix": "p.", "result": 3}},
            "isError": false
        });
        assert_eq!(completed_result(&answer).unwrap()["result"], 3);
    }

    #[test]
    fn explains_failures() {
        let paused = json!({"status": "paused", "text": "approve", "structured": {}});
        assert!(completed_result(&paused).unwrap_err().contains("approval"));
        let missing = json!({
            "status": "completed",
            "structured": {"status": "error", "error": "Error: NO_GMAIL"},
            "isError": true
        });
        assert!(completed_result(&missing)
            .unwrap_err()
            .contains("no Gmail connection"));
        let failed = json!({
            "status": "completed",
            "structured": {"status": "error", "error": "users.drafts.send: Insufficient scope"},
            "isError": true
        });
        assert_eq!(
            completed_result(&failed).unwrap_err(),
            "Gmail: users.drafts.send: Insufficient scope"
        );
    }
}
