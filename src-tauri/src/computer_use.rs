use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::dirs_home;
use crate::harness::{exec_output, first_binary, which_via_login_shell};

const BINARY: &str = "cua-driver";
const APP_BUNDLE: &str = "CuaDriver.app";

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUsePermissions {
    accessibility: Option<bool>,
    screen_recording: Option<bool>,
    detail: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseStatus {
    binary_path: Option<String>,
    app_bundle: bool,
    version: Option<String>,
    telemetry_enabled: Option<bool>,
    telemetry_source: Option<String>,
    permissions: Option<ComputerUsePermissions>,
}

/// The app bundle comes first: macOS ties Accessibility and Screen Recording
/// grants to its stable `com.trycua.driver` identity, so they survive driver
/// updates and Irgatos rebuilds.
fn candidates(home: Option<&Path>, from_shell: Option<PathBuf>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if cfg!(target_os = "macos") {
        paths.push(Path::new("/Applications").join(APP_BUNDLE));
        if let Some(home) = home {
            paths.push(home.join("Applications").join(APP_BUNDLE));
        }
        paths = paths
            .into_iter()
            .map(|app| app.join("Contents/MacOS").join(BINARY))
            .collect();
    }
    paths.extend(from_shell);
    if let Some(home) = home {
        paths.push(home.join(".local/bin").join(BINARY));
    }
    paths.push(PathBuf::from("/opt/homebrew/bin").join(BINARY));
    paths.push(PathBuf::from("/usr/local/bin").join(BINARY));
    paths
}

fn resolve_binary() -> Option<PathBuf> {
    let home = dirs_home().map(PathBuf::from);
    first_binary(candidates(home.as_deref(), which_via_login_shell(BINARY)))
}

fn inside_app_bundle(path: &Path) -> bool {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    resolved
        .components()
        .any(|part| part.as_os_str() == APP_BUNDLE)
}

fn run(binary: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
    let output = exec_output(&binary.to_string_lossy(), &args, None, timeout)?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("{} {}", stderr.trim(), stdout).trim().to_owned())
}

fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().next()?.trim();
    let version = line.strip_prefix(BINARY).unwrap_or(line).trim();
    (!version.is_empty()).then(|| version.to_owned())
}

fn parse_telemetry(output: &str) -> (Option<bool>, Option<String>) {
    let Ok(value) = serde_json::from_str::<Value>(output) else {
        return (None, None);
    };
    (
        value.get("enabled").and_then(Value::as_bool),
        value
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_owned),
    )
}

/// `permissions status --json` only reports booleans when the driver's own
/// daemon answers; otherwise it returns `status: "unknown"` with a reason.
fn parse_permissions(output: &str) -> ComputerUsePermissions {
    let Ok(value) = serde_json::from_str::<Value>(output) else {
        return ComputerUsePermissions {
            detail: Some("Could not read the permission status.".into()),
            ..Default::default()
        };
    };
    ComputerUsePermissions {
        accessibility: value.get("accessibility").and_then(Value::as_bool),
        screen_recording: value.get("screen_recording").and_then(Value::as_bool),
        detail: value
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_owned),
    }
}

fn status() -> ComputerUseStatus {
    let Some(binary) = resolve_binary() else {
        return ComputerUseStatus::default();
    };
    let quick = Duration::from_secs(5);
    let version = run(&binary, &["--version"], quick)
        .ok()
        .and_then(|output| parse_version(&output));
    let (telemetry_enabled, telemetry_source) =
        run(&binary, &["telemetry", "status", "--json"], quick)
            .map(|output| parse_telemetry(&output))
            .unwrap_or((None, None));
    let permissions = cfg!(target_os = "macos").then(|| {
        match run(
            &binary,
            &["permissions", "status", "--json"],
            Duration::from_secs(10),
        ) {
            Ok(output) => parse_permissions(&output),
            Err(error) => ComputerUsePermissions {
                detail: Some(error),
                ..Default::default()
            },
        }
    });
    ComputerUseStatus {
        app_bundle: inside_app_bundle(&binary),
        binary_path: Some(binary.to_string_lossy().into_owned()),
        version,
        telemetry_enabled,
        telemetry_source,
        permissions,
    }
}

fn require_binary() -> Result<PathBuf, String> {
    resolve_binary().ok_or_else(|| "Cua Driver is not installed".to_owned())
}

#[tauri::command]
pub async fn computer_use_status() -> Result<ComputerUseStatus, String> {
    tauri::async_runtime::spawn_blocking(status)
        .await
        .map_err(|e| e.to_string())
}

/// Persists the opt-out in the driver's own config. The MCP entry's env vars
/// only reach the stdio adapter; on macOS the tool calls run in a
/// LaunchServices-started daemon that does not inherit them.
#[tauri::command]
pub async fn computer_use_disable_telemetry() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let binary = require_binary()?;
        run(&binary, &["telemetry", "disable"], Duration::from_secs(10)).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `permissions grant` launches CuaDriver.app so the prompts and the System
/// Settings entries belong to the driver, not to Irgatos. It waits while the
/// user answers them.
#[tauri::command]
pub async fn computer_use_grant_permissions() -> Result<ComputerUseStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let binary = require_binary()?;
        run(
            &binary,
            &["permissions", "grant"],
            Duration::from_secs(5 * 60),
        )?;
        Ok(status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_app_bundle_over_path_installs() {
        let home = Path::new("/Users/me");
        let paths = candidates(Some(home), Some(PathBuf::from("/custom/bin/cua-driver")));
        let shell = paths
            .iter()
            .position(|path| path == Path::new("/custom/bin/cua-driver"))
            .unwrap();
        if cfg!(target_os = "macos") {
            assert_eq!(
                paths[0],
                Path::new("/Applications/CuaDriver.app/Contents/MacOS/cua-driver")
            );
            assert_eq!(
                paths[1],
                Path::new("/Users/me/Applications/CuaDriver.app/Contents/MacOS/cua-driver")
            );
            assert_eq!(shell, 2);
        } else {
            assert_eq!(shell, 0);
        }
        assert!(paths.contains(&home.join(".local/bin/cua-driver")));
    }

    #[test]
    fn detects_binaries_inside_the_app_bundle() {
        assert!(inside_app_bundle(Path::new(
            "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
        )));
        assert!(!inside_app_bundle(Path::new(
            "/opt/homebrew/bin/cua-driver"
        )));
    }

    #[test]
    fn parses_version_output() {
        assert_eq!(
            parse_version("cua-driver 0.35.0\n").as_deref(),
            Some("0.35.0")
        );
        assert_eq!(parse_version("0.35.0").as_deref(), Some("0.35.0"));
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn parses_telemetry_status() {
        assert_eq!(
            parse_telemetry(r#"{"enabled": false, "source": "persisted"}"#),
            (Some(false), Some("persisted".into()))
        );
        assert_eq!(parse_telemetry("Telemetry: enabled"), (None, None));
    }

    #[test]
    fn parses_granted_and_unknown_permissions() {
        assert_eq!(
            parse_permissions(r#"{"accessibility": true, "screen_recording": false}"#),
            ComputerUsePermissions {
                accessibility: Some(true),
                screen_recording: Some(false),
                detail: None,
            }
        );
        assert_eq!(
            parse_permissions(
                r#"{"daemon_running": false, "status": "unknown", "reason": "No daemon"}"#
            ),
            ComputerUsePermissions {
                accessibility: None,
                screen_recording: None,
                detail: Some("No daemon".into()),
            }
        );
    }
}
