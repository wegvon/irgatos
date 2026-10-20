//! Gmail through the user's Executor (executor.sh): Irgatos never holds a
//! Google credential, only an Executor API key. Each call runs one fixed
//! TypeScript script on Executor's `POST /api/executions`; values reach the
//! script as JSON literals, never as code.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const HTTP_TIMEOUT: Duration = Duration::from_secs(90);

/// One Gmail connection in Executor. `id` is its tool prefix, such as
/// `google.org.work.`, so it is only ever passed back, never shown.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
}

/// The Gmail connections found last time, so calls skip the catalog search.
/// Cleared when the endpoint or key changes, or a call fails.
static ACCOUNTS: Mutex<Option<Vec<Account>>> = Mutex::new(None);

pub fn forget_connection() {
    if let Ok(mut accounts) = ACCOUNTS.lock() {
        *accounts = None;
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

/// Shared by every script: unwraps `{ ok, data }` tool results and calls a
/// Gmail tool on one account. `ACCOUNT` is the account the call is for.
const PRELUDE: &str = r#"
const unwrap = (result, what) => {
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok) return result.data;
    const error = result.error || {};
    throw new Error(what + ": " + (error.message || JSON.stringify(error)));
  }
  return result;
};
const call = async (account, op, args) => unwrap(await tools[account + op](args), op);
const gmail = (op, args) => call(ACCOUNT, op, args);
"#;

pub struct Executor {
    pub endpoint: String,
    pub key: String,
}

impl Executor {
    /// Runs `body` after the prelude with `input` bound as `INPUT` and
    /// `account` (an id from [`Executor::accounts`]) as `ACCOUNT`.
    pub fn run(&self, body: &str, account: &str, input: Value) -> Result<Value, String> {
        let code = format!(
            "const INPUT = {};\nconst ACCOUNT = {};\n{PRELUDE}\nreturn await (async () => {{\n{body}\n}})();",
            serde_json::to_string(&input).map_err(|e| e.to_string())?,
            serde_json::to_string(account).map_err(|e| e.to_string())?,
        );
        // A renamed or removed connection is found again on the next call.
        // Never retried here: the failed call may have sent mail already.
        self.post(&code)
            .and_then(|answer| completed_result(&answer))
            .inspect_err(|_| forget_connection())
    }

    /// Every Gmail connection in Executor, with its address.
    pub fn accounts(&self) -> Result<Vec<Account>, String> {
        if let Some(known) = ACCOUNTS.lock().ok().and_then(|a| a.clone()) {
            return Ok(known);
        }
        let found = self.run(DISCOVER, "", json!({}))?;
        let accounts = parse_accounts(&found)?;
        if let Ok(mut known) = ACCOUNTS.lock() {
            *known = Some(accounts.clone());
        }
        Ok(accounts)
    }

    /// `id` when it names one of the Gmail connections, so a caller cannot
    /// point a script at any other tool.
    pub fn account(&self, id: &str) -> Result<String, String> {
        let accounts = self.accounts()?;
        if id.is_empty() {
            return accounts
                .first()
                .map(|a| a.id.clone())
                .ok_or_else(|| "Executor has no Gmail connection".into());
        }
        accounts
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.id.clone())
            .ok_or_else(|| "This Gmail account is no longer connected in Executor".into())
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

/// Accounts from the discovery script, one per mailbox.
fn parse_accounts(found: &Value) -> Result<Vec<Account>, String> {
    let mut accounts: Vec<Account> = Vec::new();
    for item in found.as_array().into_iter().flatten() {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        let email = item
            .get("email")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        // The same mailbox connected twice is one account.
        if accounts
            .iter()
            .any(|a| a.id == id || (!email.is_empty() && a.email.eq_ignore_ascii_case(&email)))
        {
            continue;
        }
        accounts.push(Account {
            id: id.to_string(),
            email,
        });
    }
    if accounts.is_empty() {
        return Err("Executor has no Gmail connection. Add Gmail in Executor first.".into());
    }
    accounts.sort_by_key(|a| a.email.to_lowercase());
    Ok(accounts)
}

/// Finds every Gmail connection: by the catalog search, and by asking each
/// saved connection for a tool only Gmail has.
const DISCOVER: &str = r#"
const strip = (path) => String(path || "").replace(/^tools\./, "");
const TOOL = "users.threads.list";
const prefixes = new Set();
const found = unwrap(await tools.search({ query: "gmail users threads list", limit: 100 }), "search");
for (const item of (found && found.items) || []) {
  const path = strip(item.path);
  if (path.endsWith(TOOL)) prefixes.add(path.slice(0, -TOOL.length));
}
try {
  const listed = unwrap(await tools.executor.coreTools.connections.list({}), "connections");
  for (const connection of (listed && listed.connections) || []) {
    const base = strip(connection.address);
    if (!base) continue;
    for (const candidate of [base + ".", base + ".gmail."]) {
      if (prefixes.has(candidate)) continue;
      try {
        const described = unwrap(await tools.describe.tool({ path: candidate + TOOL }), "describe");
        if (described && !described.error) prefixes.add(candidate);
      } catch (error) {}
    }
  }
} catch (error) {}
return Promise.all(
  [...prefixes].map(async (id) => {
    try {
      const profile = await call(id, "users.getProfile", { userId: "me" });
      return { id, email: (profile && profile.emailAddress) || "" };
    } catch (error) {
      return { id, email: "" };
    }
  })
);
"#;

/// Threads of several accounts at once. With `paged`, only accounts that
/// have a next page are read. One account failing does not hide the others.
pub const LIST: &str = r#"
return Promise.all(
  INPUT.accounts.map(async (account) => {
    const pageToken = INPUT.pageTokens[account];
    if (INPUT.paged && !pageToken) return { account, threads: [], next: null };
    try {
      const list = await call(account, "users.threads.list", {
        userId: "me",
        q: INPUT.query,
        maxResults: INPUT.perAccount,
        ...(pageToken ? { pageToken } : {}),
      });
      const threads = await Promise.all(
        ((list && list.threads) || []).map((thread) =>
          call(account, "users.threads.get", { userId: "me", id: thread.id, format: "metadata" })
        )
      );
      return { account, threads, next: (list && list.nextPageToken) || null };
    } catch (error) {
      return { account, threads: [], next: null, error: String((error && error.message) || error) };
    }
  })
);
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

/// Moves the whole thread to Gmail's Trash, from where Gmail deletes it
/// after 30 days. Never a permanent delete.
pub const TRASH: &str = r#"
await gmail("users.threads.trash", { userId: "me", id: INPUT.threadId });
return true;
"#;

/// Takes the thread back out of Trash: the Undo after a delete.
pub const UNTRASH: &str = r#"
await gmail("users.threads.untrash", { userId: "me", id: INPUT.threadId });
return true;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accounts_are_one_per_mailbox_sorted_by_address() {
        let found = json!([
            {"id": "google.org.work.", "email": "turel@work.com"},
            {"id": "google.org.home.", "email": "Turel@Gmail.com"},
            {"id": "google.org.again.", "email": "turel@gmail.com"},
            {"id": "google.org.broken.", "email": ""},
            {"email": "no-id@x"}
        ]);
        let accounts = parse_accounts(&found).unwrap();
        let ids: Vec<&str> = accounts.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(
            ids,
            ["google.org.broken.", "google.org.home.", "google.org.work."]
        );
        assert!(parse_accounts(&json!([])).is_err());
    }

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
