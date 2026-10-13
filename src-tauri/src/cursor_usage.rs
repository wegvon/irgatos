use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const DASHBOARD_SERVICE: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService";
const STATUS_TIMEOUT: Duration = Duration::from_secs(10);
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const PLAN_INFO_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_ERROR_CHARS: usize = 160;

const SIGN_IN_HINT: &str = "Cursor CLI is not signed in. Run `agent login`.";
const UPDATE_HINT: &str =
    "This Cursor CLI does not share its session with other apps. Update it with `agent update`.";

/// The current billing cycle as Cursor's dashboard reports it. Money is in
/// US cents, exactly as the service sends it.
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

/// Plan usage for the account the Cursor CLI is signed in to. The CLI hands
/// over its own access token through `status --format json`; the token stays
/// in this process, is never refreshed here, and only goes to Cursor.
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
    let session = parse_status_output(
        output.status.success(),
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    );
    let token = match session {
        StatusOutcome::Session { token } => token,
        StatusOutcome::SignedOut => return unavailable("not-signed-in", SIGN_IN_HINT),
        StatusOutcome::Unsupported => return unavailable("unsupported", UPDATE_HINT),
        StatusOutcome::Failed(message) => return failed(None, message),
    };

    let response = match dashboard_call("GetCurrentPeriodUsage", &token, HTTP_TIMEOUT) {
        Ok(response) => response,
        Err(DashboardError::Status(status)) => return http_failure(status),
        Err(DashboardError::Transport(message)) => {
            return failed(None, format!("Cursor usage request failed: {message}"))
        }
    };
    let Some(mut usage) = parse_current_period_usage(&response) else {
        return failed(Some(200), "Cursor usage response was unexpected".into());
    };
    // The plan name is a nicety: a slow or failed lookup keeps the usage.
    usage.plan = dashboard_call("GetPlanInfo", &token, PLAN_INFO_TIMEOUT)
        .ok()
        .and_then(|value| parse_plan_name(&value));
    CursorUsageFetch {
        status: "ok".into(),
        reason: None,
        http_status: Some(200),
        usage: Some(usage),
        error: None,
    }
}

fn http_failure(status: u16) -> CursorUsageFetch {
    if status == 401 || status == 403 {
        let mut result = unavailable(
            "not-signed-in",
            "Cursor rejected the CLI session. Run `agent login` again.",
        );
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
    Session {
        token: String,
    },
    SignedOut,
    /// Signed in, but this CLI build does not report its session token.
    Unsupported,
    Failed(String),
}

/// Read `agent status --format json`. Nothing from stdout is ever echoed into
/// an error, because a successful status carries credentials.
fn parse_status_output(success: bool, stdout: &str, stderr: &str) -> StatusOutcome {
    if let Some(value) = json_object(stdout) {
        let authenticated = ["authenticated", "isAuthenticated", "loggedIn"]
            .iter()
            .find_map(|key| value.get(key).and_then(Value::as_bool));
        if authenticated == Some(false) {
            return StatusOutcome::SignedOut;
        }
        let token = value
            .get("auth")
            .and_then(|auth| auth.get("accessToken"))
            .or_else(|| value.get("accessToken"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|token| !token.is_empty());
        if let Some(token) = token {
            return StatusOutcome::Session {
                token: token.to_string(),
            };
        }
        return if authenticated == Some(true) {
            StatusOutcome::Unsupported
        } else {
            StatusOutcome::SignedOut
        };
    }

    let stderr_lower = stderr.to_ascii_lowercase();
    let stdout_lower = stdout.to_ascii_lowercase();
    let mentions = |needle: &str| stderr_lower.contains(needle) || stdout_lower.contains(needle);
    if mentions("not logged in")
        || mentions("not authenticated")
        || mentions("not signed in")
        || mentions("agent login")
    {
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

/// `GetCurrentPeriodUsage`. Protobuf JSON sends int64 fields as strings, so
/// every number is read from either form. A response without a usable plan
/// percentage is rejected rather than shown as 0%.
fn parse_current_period_usage(value: &Value) -> Option<CursorUsage> {
    let plan = value.get("planUsage")?;
    let used = number(plan, "totalSpend").or_else(|| number(plan, "used"));
    let limit = number(plan, "limit").filter(|limit| *limit > 0.0);
    let percent = number(plan, "totalPercentUsed").or_else(|| match (used, limit) {
        (Some(used), Some(limit)) => Some(used / limit * 100.0),
        _ => None,
    })?;
    let spend = value.get("spendLimitUsage");
    let spend_number =
        |keys: &[&str]| spend.and_then(|spend| keys.iter().find_map(|key| number(spend, key)));
    let on_demand_limit =
        spend_number(&["individualLimit", "pooledLimit", "limit"]).filter(|limit| *limit > 0.0);
    Some(CursorUsage {
        plan: None,
        plan_percent_used: percent.clamp(0.0, 100.0),
        auto_percent_used: number(plan, "autoPercentUsed"),
        api_percent_used: number(plan, "apiPercentUsed"),
        included_used_cents: used,
        included_limit_cents: limit,
        on_demand_used_cents: on_demand_limit.and(spend_number(&[
            "individualUsed",
            "pooledUsed",
            "used",
        ])),
        on_demand_limit_cents: on_demand_limit,
        billing_cycle_start_ms: value.get("billingCycleStart").and_then(timestamp_ms),
        billing_cycle_end_ms: value.get("billingCycleEnd").and_then(timestamp_ms),
    })
}

fn parse_plan_name(value: &Value) -> Option<String> {
    value
        .get("planInfo")
        .and_then(|info| info.get("planName"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(String::from)
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
fn timestamp_ms(value: &Value) -> Option<i64> {
    let numeric = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    };
    if let Some(number) = numeric.filter(|number| number.is_finite() && *number > 0.0) {
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

    #[test]
    fn status_json_with_token_is_a_session() {
        let stdout = r#"{"authenticated":true,"email":"a@b.c","auth":{"accessToken":"cli-access","refreshToken":"secret"}}"#;
        assert_eq!(
            parse_status_output(true, stdout, ""),
            StatusOutcome::Session {
                token: "cli-access".into()
            }
        );
    }

    #[test]
    fn status_json_tolerates_a_banner_line() {
        let stdout =
            "Update available: 2026.10.08\n{\"authenticated\":true,\"accessToken\":\"t\"}\n";
        assert_eq!(
            parse_status_output(true, stdout, ""),
            StatusOutcome::Session { token: "t".into() }
        );
    }

    #[test]
    fn signed_out_status_is_not_signed_in() {
        assert_eq!(
            parse_status_output(true, r#"{"authenticated":false}"#, ""),
            StatusOutcome::SignedOut
        );
        assert_eq!(
            parse_status_output(false, "", "Error: Not logged in. Run `agent login`."),
            StatusOutcome::SignedOut
        );
        assert_eq!(
            parse_status_output(true, r#"{"auth":{"accessToken":"  "}}"#, ""),
            StatusOutcome::SignedOut
        );
    }

    #[test]
    fn signed_in_without_token_is_unsupported() {
        assert_eq!(
            parse_status_output(true, r#"{"authenticated":true,"email":"a@b.c"}"#, ""),
            StatusOutcome::Unsupported
        );
    }

    #[test]
    fn old_cli_without_format_flag_is_unsupported() {
        assert_eq!(
            parse_status_output(false, "", "error: unknown option '--format'"),
            StatusOutcome::Unsupported
        );
    }

    #[test]
    fn unparseable_status_fails_without_echoing_stdout() {
        let outcome = parse_status_output(true, "Logged in as someone token=abc", "");
        assert_eq!(
            outcome,
            StatusOutcome::Failed("Cursor CLI status was not JSON".into())
        );
        let long = "x".repeat(400);
        let StatusOutcome::Failed(message) = parse_status_output(false, "", &long) else {
            panic!("expected failure");
        };
        assert!(message.len() < 220);
    }

    #[test]
    fn parses_current_period_usage_in_cents() {
        let usage = parse_current_period_usage(&json!({
            "billingCycleStart": "1790812800000",
            "billingCycleEnd": "2026-11-01T00:00:00.000Z",
            "planUsage": {
                "totalSpend": 1240,
                "includedSpend": 1240,
                "limit": 2000,
                "autoPercentUsed": 12.5,
                "apiPercentUsed": "49.5",
                "totalPercentUsed": 62
            },
            "spendLimitUsage": { "individualLimit": "5000", "individualUsed": "0" }
        }))
        .unwrap();
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
    fn parses_the_used_limit_shape_and_derives_percent_only_from_real_numbers() {
        let usage = parse_current_period_usage(&json!({
            "planUsage": { "used": "500", "limit": "2000" }
        }))
        .unwrap();
        assert_eq!(usage.plan_percent_used, 25.0);
        assert_eq!(usage.on_demand_limit_cents, None);
        assert_eq!(usage.billing_cycle_end_ms, None);
    }

    #[test]
    fn rejects_usage_without_a_plan_percentage() {
        assert_eq!(parse_current_period_usage(&json!({})), None);
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
    fn zero_spend_limit_hides_on_demand() {
        let usage = parse_current_period_usage(&json!({
            "planUsage": { "totalPercentUsed": 5 },
            "spendLimitUsage": { "pooledLimit": 0, "pooledUsed": 0 }
        }))
        .unwrap();
        assert_eq!(usage.on_demand_limit_cents, None);
        assert_eq!(usage.on_demand_used_cents, None);
    }

    #[test]
    fn reads_plan_name() {
        assert_eq!(
            parse_plan_name(&json!({ "planInfo": { "planName": "Pro" } })).as_deref(),
            Some("Pro")
        );
        assert_eq!(parse_plan_name(&json!({ "planInfo": {} })), None);
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
