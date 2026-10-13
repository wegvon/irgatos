use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::dirs_home;

const DASHBOARD_SERVICE: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService";
const STATUS_TIMEOUT: Duration = Duration::from_secs(10);
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const PLAN_INFO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_ERROR_CHARS: usize = 160;

/// Where the Cursor CLI keeps its session on macOS unless
/// `AGENT_CLI_CREDENTIAL_STORE=file` moves it to `auth.json`.
#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICE: &str = "cursor-access-token";
#[cfg(target_os = "macos")]
const KEYCHAIN_ACCOUNT: &str = "cursor-user";
#[cfg(target_os = "macos")]
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(5);

const SIGN_IN_HINT: &str = "Cursor CLI is not signed in. Run `agent login`.";
const REJECTED_HINT: &str =
    "Cursor rejected the CLI session. Run any `agent` command to refresh it, or `agent login`.";
const API_KEY_HINT: &str =
    "Cursor reports plan usage only for `agent login` sign-ins, not API keys.";
const NO_PLAN_USAGE_HINT: &str = "Cursor does not report included usage for this plan.";

/// The current billing cycle as Cursor's dashboard reports it to its own
/// CLI `/usage` view. Money is in US cents, exactly as the service sends it.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsage {
    pub plan: Option<String>,
    pub plan_percent_used: f64,
    pub auto_percent_used: Option<f64>,
    pub api_percent_used: Option<f64>,
    pub included_used_cents: Option<f64>,
    pub included_limit_cents: Option<f64>,
    pub on_demand_used_cents: Option<f64>,
    pub on_demand_limit_cents: Option<f64>,
    pub billing_cycle_start_ms: Option<i64>,
    pub billing_cycle_end_ms: Option<i64>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageFetch {
    /// `ok`, `unavailable` (see `reason`) or `error`.
    pub status: String,
    /// `not-installed`, `not-signed-in` or `unsupported` when unavailable.
    pub reason: Option<String>,
    pub http_status: Option<u16>,
    pub usage: Option<CursorUsage>,
    pub error: Option<String>,
}

fn unavailable(reason: &str, message: &str) -> CursorUsageFetch {
    CursorUsageFetch {
        status: "unavailable".into(),
        reason: Some(reason.into()),
        http_status: None,
        usage: None,
        error: Some(message.into()),
    }
}

fn failed(http_status: Option<u16>, message: String) -> CursorUsageFetch {
    CursorUsageFetch {
        status: "error".into(),
        reason: None,
        http_status,
        usage: None,
        error: Some(message),
    }
}

/// Plan usage for the account the Cursor CLI is signed in to, read the way
/// the CLI's own `/usage` reads it. `agent status` decides whether there is
/// a session; the token comes from the CLI's own credential store, stays in
/// this process, is never refreshed here, and only goes to Cursor.
#[tauri::command]
pub async fn fetch_cursor_usage(
    command: String,
    binary_path: Option<String>,
) -> Result<CursorUsageFetch, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_sync(&command, binary_path.as_deref()))
        .await
        .map_err(|e| e.to_string())
}

fn fetch_sync(command: &str, binary_path: Option<&str>) -> CursorUsageFetch {
    if !crate::harness::is_resolved_harness_binary(command, Some("cursor"), binary_path) {
        return unavailable("not-installed", "Cursor CLI not found");
    }
    let args = ["status", "--format", "json"].map(String::from);
    let output = match crate::harness::exec_output(command, &args, None, STATUS_TIMEOUT) {
        Ok(output) => output,
        Err(error) => {
            return failed(
                None,
                if error.ends_with("timed out") {
                    "Cursor CLI status timed out".into()
                } else {
                    "Could not run the Cursor CLI".into()
                },
            )
        }
    };
    let status_token = match parse_status_output(
        output.status.success(),
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    ) {
        StatusOutcome::SignedIn { token } => token,
        StatusOutcome::SignedOut => return unavailable("not-signed-in", SIGN_IN_HINT),
        StatusOutcome::Unsupported => {
            return unavailable(
                "unsupported",
                "This Cursor CLI cannot report its sign-in. Update it with `agent update`.",
            )
        }
        StatusOutcome::Failed(message) => return failed(None, message),
    };

    let token = match status_token.map(Ok).unwrap_or_else(read_cli_session) {
        Ok(token) => token,
        Err(SessionError::ApiKeyOnly) => return unavailable("unsupported", API_KEY_HINT),
        Err(SessionError::Unreadable(message)) => return failed(None, message),
    };

    let response = match dashboard_call("GetCurrentPeriodUsage", &token, HTTP_TIMEOUT) {
        Ok(response) => response,
        Err(DashboardError::Status(status)) => return http_failure(status),
        Err(DashboardError::Transport(message)) => {
            return failed(None, format!("Cursor usage request failed: {message}"))
        }
    };
    // Plan name and the fallback cycle end are niceties: a slow or failed
    // lookup keeps the usage.
    let plan_info = dashboard_call("GetPlanInfo", &token, PLAN_INFO_TIMEOUT).ok();
    match usage_outcome(&response, plan_info.as_ref()) {
        Some(Ok(usage)) => CursorUsageFetch {
            status: "ok".into(),
            reason: None,
            http_status: Some(200),
            usage: Some(usage),
            error: None,
        },
        Some(Err(())) => unavailable("unsupported", NO_PLAN_USAGE_HINT),
        None => failed(Some(200), "Cursor usage response was unexpected".into()),
    }
}

fn http_failure(status: u16) -> CursorUsageFetch {
    if status == 401 || status == 403 {
        let mut result = unavailable("not-signed-in", REJECTED_HINT);
        result.http_status = Some(status);
        return result;
    }
    failed(
        Some(status),
        format!("Cursor usage request failed ({status})"),
    )
}

enum DashboardError {
    Status(u16),
    Transport(String),
}

fn dashboard_call(method: &str, token: &str, timeout: Duration) -> Result<Value, DashboardError> {
    // The bearer token must never follow a redirect or travel over plain HTTP.
    let agent = ureq::AgentBuilder::new()
        .timeout(timeout)
        .https_only(true)
        .redirects(0)
        .build();
    let response = agent
        .post(&format!("{DASHBOARD_SERVICE}/{method}"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .set("Connect-Protocol-Version", "1")
        .send_string("{}");
    match response {
        Ok(response) if (200..300).contains(&response.status()) => {
            let text = response
                .into_string()
                .map_err(|e| DashboardError::Transport(e.to_string()))?;
            serde_json::from_str(&text)
                .map_err(|_| DashboardError::Transport("response was not JSON".into()))
        }
        Ok(response) => Err(DashboardError::Status(response.status())),
        Err(ureq::Error::Status(status, response)) => {
            let _ = response.into_string();
            Err(DashboardError::Status(status))
        }
        Err(error) => Err(DashboardError::Transport(error.kind().to_string())),
    }
}

#[derive(Debug, PartialEq)]
enum StatusOutcome {
    /// Older CLI builds also printed the session token itself.
    SignedIn {
        token: Option<String>,
    },
    SignedOut,
    Unsupported,
    Failed(String),
}

/// Read `agent status --format json`. Nothing from stdout is ever echoed into
/// an error, because older builds put credentials there.
fn parse_status_output(success: bool, stdout: &str, stderr: &str) -> StatusOutcome {
    if let Some(value) = json_object(stdout) {
        let token = value
            .get("auth")
            .and_then(|auth| auth.get("accessToken"))
            .or_else(|| value.get("accessToken"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .map(String::from);
        let authenticated = ["isAuthenticated", "authenticated", "loggedIn"]
            .iter()
            .find_map(|key| value.get(key).and_then(Value::as_bool))
            .or_else(|| {
                value
                    .get("status")
                    .and_then(Value::as_str)
                    .map(|status| status == "authenticated")
            });
        return match authenticated {
            Some(true) => StatusOutcome::SignedIn { token },
            Some(false) => StatusOutcome::SignedOut,
            None if token.is_some() => StatusOutcome::SignedIn { token },
            None => StatusOutcome::Unsupported,
        };
    }

    let stderr_lower = stderr.to_ascii_lowercase();
    let stdout_lower = stdout.to_ascii_lowercase();
    let mentions = |needle: &str| stderr_lower.contains(needle) || stdout_lower.contains(needle);
    if mentions("not logged in") || mentions("not authenticated") || mentions("not signed in") {
        return StatusOutcome::SignedOut;
    }
    if mentions("unknown option") || mentions("unknown argument") || mentions("unexpected argument")
    {
        return StatusOutcome::Unsupported;
    }
    let detail = stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(MAX_ERROR_CHARS).collect::<String>());
    match (success, detail) {
        (_, Some(detail)) => StatusOutcome::Failed(format!("Cursor CLI status failed: {detail}")),
        (true, None) => StatusOutcome::Failed("Cursor CLI status was not JSON".into()),
        (false, None) => StatusOutcome::Failed("Cursor CLI status failed".into()),
    }
}

/// The JSON object in CLI output, tolerating a banner line before it.
fn json_object(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end < start {
        return None;
    }
    serde_json::from_str::<Value>(&text[start..=end])
        .ok()
        .filter(Value::is_object)
}

#[derive(Debug, PartialEq)]
enum SessionError {
    ApiKeyOnly,
    Unreadable(String),
}

/// The access token the Cursor CLI stored at sign-in: the macOS Keychain
/// first, then the `auth.json` its file store writes on every platform.
fn read_cli_session() -> Result<String, SessionError> {
    #[cfg(target_os = "macos")]
    if let Some(token) = read_keychain_token() {
        return Ok(token);
    }
    let raw = cli_auth_file()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .ok_or_else(|| SessionError::Unreadable(unreadable_session_message().into()))?;
    parse_auth_file(&raw)
}

fn unreadable_session_message() -> &'static str {
    if cfg!(target_os = "macos") {
        "Cursor CLI is signed in, but MonoCode could not read its session from the login Keychain."
    } else {
        "Cursor CLI is signed in, but MonoCode could not read its session file."
    }
}

fn parse_auth_file(raw: &str) -> Result<String, SessionError> {
    let value: Value = serde_json::from_str(raw.trim())
        .map_err(|_| SessionError::Unreadable("Cursor CLI session file is not JSON".into()))?;
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
    };
    match (text("accessToken"), text("apiKey")) {
        (Some(token), _) => Ok(token.to_string()),
        (None, Some(_)) => Err(SessionError::ApiKeyOnly),
        (None, None) => Err(SessionError::Unreadable(
            unreadable_session_message().into(),
        )),
    }
}

/// Mirrors the CLI's file store: `~/.cursor` on macOS, `%APPDATA%\Cursor` on
/// Windows, and `$XDG_CONFIG_HOME/cursor` (default `~/.config/cursor`) elsewhere.
fn cli_auth_file() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    if cfg!(target_os = "macos") {
        return Some(home?.join(".cursor/auth.json"));
    }
    if cfg!(windows) {
        let app_data = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| home.map(|home| home.join("AppData/Roaming")))?;
        return Some(app_data.join("Cursor/auth.json"));
    }
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".config")))?;
    Some(config.join("cursor/auth.json"))
}

/// The CLI writes this item with `/usr/bin/security`, so reading it back
/// through the same tool normally needs no prompt. A prompt nobody answers
/// runs into the timeout and reads as no session.
#[cfg(target_os = "macos")]
fn read_keychain_token() -> Option<String> {
    let args = [
        "find-generic-password",
        "-a",
        KEYCHAIN_ACCOUNT,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
    ]
    .map(String::from);
    let output =
        crate::harness::exec_output("/usr/bin/security", &args, None, KEYCHAIN_TIMEOUT).ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!token.is_empty()).then_some(token)
}

/// `Some(Err(()))` when Cursor answered but reports no included usage for the
/// plan, which its own CLI shows as "not available for this plan".
fn usage_outcome(usage: &Value, plan_info: Option<&Value>) -> Option<Result<CursorUsage, ()>> {
    if !usage.is_object() {
        return None;
    }
    if usage.get("planUsage").is_none() {
        return Some(Err(()));
    }
    let mut parsed = parse_current_period_usage(usage)?;
    let info = plan_info.and_then(|value| value.get("planInfo"));
    parsed.plan = info
        .and_then(|info| info.get("planName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(String::from);
    if parsed.billing_cycle_end_ms.is_none() {
        parsed.billing_cycle_end_ms = info
            .and_then(|info| info.get("billingCycleEnd"))
            .and_then(timestamp_ms);
    }
    Some(Ok(parsed))
}

/// `GetCurrentPeriodUsage`. Protobuf JSON sends int64 fields as strings, so
/// every number is read from either form. Like the CLI, the plan percentage
/// falls back to included spend over the limit; with neither, the response
/// is rejected rather than shown as 0%.
fn parse_current_period_usage(value: &Value) -> Option<CursorUsage> {
    let plan = value.get("planUsage")?;
    let used = number(plan, "includedSpend")
        .or_else(|| number(plan, "totalSpend"))
        .or_else(|| number(plan, "used"));
    let limit = number(plan, "limit").filter(|limit| *limit > 0.0);
    let percent = number(plan, "totalPercentUsed").or_else(|| match (used, limit) {
        (Some(used), Some(limit)) => Some(used / limit * 100.0),
        _ => None,
    })?;
    let spend = value.get("spendLimitUsage");
    Some(CursorUsage {
        plan: None,
        plan_percent_used: percent.clamp(0.0, 100.0),
        auto_percent_used: number(plan, "autoPercentUsed"),
        api_percent_used: number(plan, "apiPercentUsed"),
        included_used_cents: used,
        included_limit_cents: limit,
        on_demand_used_cents: spend.and_then(|spend| number(spend, "individualUsed")),
        on_demand_limit_cents: spend
            .and_then(|spend| number(spend, "individualLimit"))
            .filter(|limit| *limit > 0.0),
        billing_cycle_start_ms: value.get("billingCycleStart").and_then(timestamp_ms),
        billing_cycle_end_ms: value.get("billingCycleEnd").and_then(timestamp_ms),
    })
}

fn number(value: &Value, key: &str) -> Option<f64> {
    match value.get(key)? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|number| number.is_finite())
}

/// Epoch seconds or milliseconds, as a number or numeric string, or RFC 3339.
/// Zero is Cursor's "unknown".
fn timestamp_ms(value: &Value) -> Option<i64> {
    let numeric = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    };
    if let Some(number) = numeric {
        if !number.is_finite() || number <= 0.0 {
            return None;
        }
        // 1e10 sits between second-epoch (< 2286) and millisecond-epoch (> 2001).
        return Some(if number > 10_000_000_000.0 {
            number
        } else {
            number * 1000.0
        } as i64);
    }
    let parsed = OffsetDateTime::parse(value.as_str()?.trim(), &Rfc3339).ok()?;
    i64::try_from(parsed.unix_timestamp_nanos() / 1_000_000).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// `agent status --format json` from Cursor CLI 2026.10.01.
    const STATUS_SIGNED_OUT: &str = r#"{
  "status": "unauthenticated",
  "isAuthenticated": false,
  "hasAccessToken": false,
  "hasRefreshToken": false,
  "message": "Not logged in"
}"#;
    const STATUS_SIGNED_IN: &str = r#"{
  "status": "authenticated",
  "isAuthenticated": true,
  "hasAccessToken": true,
  "hasRefreshToken": true,
  "userInfo": { "email": "ada@example.com", "userId": 1 }
}"#;
    const STATUS_PARTIAL: &str = r#"{"status":"partially-authenticated","isAuthenticated":false,"hasAccessToken":true,"hasRefreshToken":false,"message":"Partially authenticated (missing refresh token)"}"#;

    #[test]
    fn current_cli_status_reports_sign_in_without_a_token() {
        assert_eq!(
            parse_status_output(true, STATUS_SIGNED_IN, ""),
            StatusOutcome::SignedIn { token: None }
        );
        assert_eq!(
            parse_status_output(true, STATUS_SIGNED_OUT, ""),
            StatusOutcome::SignedOut
        );
        assert_eq!(
            parse_status_output(true, STATUS_PARTIAL, ""),
            StatusOutcome::SignedOut
        );
    }

    #[test]
    fn older_cli_status_with_token_is_used_directly() {
        let stdout =
            r#"{"authenticated":true,"auth":{"accessToken":"cli-access","refreshToken":"secret"}}"#;
        assert_eq!(
            parse_status_output(true, stdout, ""),
            StatusOutcome::SignedIn {
                token: Some("cli-access".into())
            }
        );
    }

    #[test]
    fn status_json_tolerates_a_banner_line() {
        let stdout = format!("Update available: 2026.10.08\n{STATUS_SIGNED_IN}\n");
        assert_eq!(
            parse_status_output(true, &stdout, ""),
            StatusOutcome::SignedIn { token: None }
        );
    }

    #[test]
    fn text_and_unknown_status_shapes() {
        assert_eq!(
            parse_status_output(false, "", "Error: Not logged in"),
            StatusOutcome::SignedOut
        );
        assert_eq!(
            parse_status_output(false, "", "error: unknown option '--format'"),
            StatusOutcome::Unsupported
        );
        assert_eq!(
            parse_status_output(true, r#"{"version":"x"}"#, ""),
            StatusOutcome::Unsupported
        );
    }

    #[test]
    fn unparseable_status_fails_without_echoing_stdout() {
        assert_eq!(
            parse_status_output(true, "Logged in as someone token=abc", ""),
            StatusOutcome::Failed("Cursor CLI status was not JSON".into())
        );
        let StatusOutcome::Failed(message) = parse_status_output(false, "", &"x".repeat(400))
        else {
            panic!("expected failure");
        };
        assert!(message.len() < 220);
    }

    #[test]
    fn reads_the_cli_auth_file() {
        assert_eq!(
            parse_auth_file(r#"{"accessToken":"tok","refreshToken":"r"}"#),
            Ok("tok".into())
        );
        assert_eq!(
            parse_auth_file(r#"{"apiKey":"key_123"}"#),
            Err(SessionError::ApiKeyOnly)
        );
        assert!(matches!(
            parse_auth_file(r#"{"accessToken":"  "}"#),
            Err(SessionError::Unreadable(_))
        ));
        assert!(matches!(
            parse_auth_file("nope"),
            Err(SessionError::Unreadable(_))
        ));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn auth_file_follows_xdg_config_home() {
        let previous = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", "/tmp/xdg-test");
        assert_eq!(
            cli_auth_file(),
            Some(PathBuf::from("/tmp/xdg-test/cursor/auth.json"))
        );
        match previous {
            Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
            None => std::env::remove_var("XDG_CONFIG_HOME"),
        }
    }

    fn usage_fixture() -> Value {
        json!({
            "billingCycleStart": "1790812800000",
            "billingCycleEnd": "1793491200000",
            "planUsage": {
                "totalSpend": 1300,
                "includedSpend": 1240,
                "bonusSpend": 60,
                "limit": 2000,
                "autoPercentUsed": 12.5,
                "apiPercentUsed": "49.5",
                "totalPercentUsed": 62
            },
            "spendLimitUsage": { "individualLimit": "5000", "individualUsed": "0", "limitType": "user" }
        })
    }

    #[test]
    fn parses_current_period_usage_in_cents() {
        let usage = parse_current_period_usage(&usage_fixture()).unwrap();
        assert_eq!(usage.plan_percent_used, 62.0);
        assert_eq!(usage.auto_percent_used, Some(12.5));
        assert_eq!(usage.api_percent_used, Some(49.5));
        assert_eq!(usage.included_used_cents, Some(1240.0));
        assert_eq!(usage.included_limit_cents, Some(2000.0));
        assert_eq!(usage.on_demand_used_cents, Some(0.0));
        assert_eq!(usage.on_demand_limit_cents, Some(5000.0));
        assert_eq!(usage.billing_cycle_start_ms, Some(1_790_812_800_000));
        assert_eq!(usage.billing_cycle_end_ms, Some(1_793_491_200_000));
    }

    #[test]
    fn falls_back_to_included_spend_over_limit_like_the_cli() {
        let usage = parse_current_period_usage(&json!({
            "billingCycleEnd": "2026-11-01T00:00:00.000Z",
            "planUsage": { "includedSpend": "500", "limit": "2000" }
        }))
        .unwrap();
        assert_eq!(usage.plan_percent_used, 25.0);
        assert_eq!(usage.auto_percent_used, None);
        assert_eq!(usage.on_demand_limit_cents, None);
        assert_eq!(usage.billing_cycle_end_ms, Some(1_793_491_200_000));
    }

    #[test]
    fn rejects_usage_without_a_plan_percentage() {
        assert_eq!(
            parse_current_period_usage(&json!({ "planUsage": { "limit": 0 } })),
            None
        );
        assert_eq!(
            parse_current_period_usage(&json!({ "planUsage": { "totalPercentUsed": "NaN" } })),
            None
        );
    }

    #[test]
    fn zero_spend_limit_hides_the_on_demand_limit() {
        let usage = parse_current_period_usage(&json!({
            "billingCycleEnd": "0",
            "planUsage": { "totalPercentUsed": 5 },
            "spendLimitUsage": { "individualLimit": 0, "individualUsed": 0 }
        }))
        .unwrap();
        assert_eq!(usage.on_demand_limit_cents, None);
        assert_eq!(usage.billing_cycle_end_ms, None);
    }

    #[test]
    fn usage_outcome_adds_plan_info_and_flags_plans_without_usage() {
        let info = json!({ "planInfo": { "planName": "Pro", "billingCycleEnd": "1793491200000" } });
        let Some(Ok(usage)) = usage_outcome(&usage_fixture(), Some(&info)) else {
            panic!("expected usage");
        };
        assert_eq!(usage.plan.as_deref(), Some("Pro"));

        let mut no_end = usage_fixture();
        no_end["billingCycleEnd"] = json!("0");
        let Some(Ok(usage)) = usage_outcome(&no_end, Some(&info)) else {
            panic!("expected usage");
        };
        assert_eq!(usage.billing_cycle_end_ms, Some(1_793_491_200_000));

        let Some(Ok(usage)) = usage_outcome(&usage_fixture(), None) else {
            panic!("expected usage");
        };
        assert_eq!(usage.plan, None);

        assert_eq!(
            usage_outcome(&json!({ "billingCycleEnd": "1" }), None),
            Some(Err(()))
        );
        assert_eq!(usage_outcome(&json!([]), None), None);
        assert_eq!(usage_outcome(&json!({ "planUsage": {} }), None), None);
    }

    #[test]
    fn rejected_session_maps_to_not_signed_in() {
        let result = http_failure(401);
        assert_eq!(result.status, "unavailable");
        assert_eq!(result.reason.as_deref(), Some("not-signed-in"));
        let result = http_failure(503);
        assert_eq!(result.status, "error");
        assert_eq!(result.reason, None);
    }

    #[test]
    fn unresolved_binary_is_not_installed() {
        let result = fetch_sync("/nonexistent/cursor-agent", None);
        assert_eq!(result.status, "unavailable");
        assert_eq!(result.reason.as_deref(), Some("not-installed"));
    }
}
