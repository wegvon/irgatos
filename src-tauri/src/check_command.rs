//! Runs a short, user-configured shell check in a project folder: the
//! Completion Gate validator that follows an agent turn, and the shell guard
//! of a Habit. The result carries the exit code and the tail of the combined
//! output, so a failure can go back to the agent as-is.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Enough for a compiler's first errors without flooding an agent's context.
const OUTPUT_TAIL_BYTES: u64 = 12 * 1024;
const MAX_COMMAND_CHARS: usize = 4_000;
const MIN_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const POLL: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Passed,
    Failed,
    TimedOut,
    Cancelled,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub status: CheckStatus,
    pub exit_code: Option<i32>,
    /// The end of stdout and stderr together, in the order they were written.
    pub output: String,
    /// Bytes dropped from the front of `output`.
    pub truncated: u64,
    pub duration_ms: u64,
}

static RUNS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

fn register(run_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let mut runs = RUNS.lock().unwrap_or_else(|e| e.into_inner());
    runs.get_or_insert_with(HashMap::new)
        .insert(run_id.to_owned(), flag.clone());
    flag
}

fn unregister(run_id: &str) {
    let mut runs = RUNS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(runs) = runs.as_mut() {
        runs.remove(run_id);
    }
}

fn cancel(run_id: &str) -> bool {
    let runs = RUNS.lock().unwrap_or_else(|e| e.into_inner());
    match runs.as_ref().and_then(|runs| runs.get(run_id)) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

fn shell(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(command);
        crate::hide_window_console(&mut cmd);
        cmd
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c").arg(command);
        // Its own group, so a timeout also stops the compilers it started.
        cmd.process_group(0);
        cmd
    }
}

fn stop(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn tail(path: &Path) -> (String, u64) {
    let Ok(mut file) = std::fs::File::open(path) else {
        return (String::new(), 0);
    };
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let skipped = len.saturating_sub(OUTPUT_TAIL_BYTES);
    let _ = file.seek(SeekFrom::Start(skipped));
    let mut bytes = Vec::new();
    let _ = file.read_to_end(&mut bytes);
    (String::from_utf8_lossy(&bytes).trim().to_owned(), skipped)
}

fn clamp_timeout(timeout_ms: u64) -> Duration {
    Duration::from_millis(timeout_ms).clamp(MIN_TIMEOUT, MAX_TIMEOUT)
}

/// Runs `command` through the platform shell in `cwd` until it exits, the
/// timeout passes, or `cancelled` is set. Never panics on a bad command.
pub(crate) fn run_check(
    cwd: &Path,
    command: &str,
    timeout: Duration,
    cancelled: &AtomicBool,
    gui_env: bool,
) -> CheckResult {
    let started = Instant::now();
    let finish = |status, exit_code, output: String, truncated| CheckResult {
        status,
        exit_code,
        output,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    };
    let command = command.trim();
    if command.is_empty() {
        return finish(CheckStatus::Error, None, "No command to run.".into(), 0);
    }
    if command.chars().count() > MAX_COMMAND_CHARS {
        return finish(
            CheckStatus::Error,
            None,
            format!("The command is longer than {MAX_COMMAND_CHARS} characters."),
            0,
        );
    }
    if !cwd.is_dir() {
        return finish(
            CheckStatus::Error,
            None,
            format!("The folder {} does not exist.", cwd.display()),
            0,
        );
    }
    let log_path = std::env::temp_dir().join(format!("irgatos-check-{}.log", uuid::Uuid::new_v4()));
    let result = run_logged(
        cwd, command, timeout, cancelled, gui_env, &log_path, &finish,
    );
    let _ = std::fs::remove_file(&log_path);
    result
}

fn run_logged(
    cwd: &Path,
    command: &str,
    timeout: Duration,
    cancelled: &AtomicBool,
    gui_env: bool,
    log_path: &Path,
    finish: &dyn Fn(CheckStatus, Option<i32>, String, u64) -> CheckResult,
) -> CheckResult {
    let log = match std::fs::File::create(log_path) {
        Ok(log) => log,
        Err(error) => {
            return finish(
                CheckStatus::Error,
                None,
                format!("Cannot capture the output: {error}"),
                0,
            )
        }
    };
    let stderr = match log.try_clone() {
        Ok(stderr) => stderr,
        Err(error) => return finish(CheckStatus::Error, None, error.to_string(), 0),
    };
    let mut cmd = shell(command);
    if gui_env {
        crate::harness::apply_gui_env(&mut cmd);
    }
    cmd.current_dir(cwd)
        // Test runners stay out of watch mode and skip prompts.
        .env("CI", "1")
        .env("IRGATOS_CHECK", "1")
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(stderr);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            return finish(
                CheckStatus::Error,
                None,
                format!("Failed to start the command: {error}"),
                0,
            )
        }
    };
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let (output, truncated) = tail(log_path);
                let outcome = if status.success() {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Failed
                };
                return finish(outcome, status.code(), output, truncated);
            }
            Ok(None) if cancelled.load(Ordering::SeqCst) => {
                stop(&mut child);
                let (output, truncated) = tail(log_path);
                return finish(CheckStatus::Cancelled, None, output, truncated);
            }
            Ok(None) if Instant::now() >= deadline => {
                stop(&mut child);
                let (output, truncated) = tail(log_path);
                return finish(CheckStatus::TimedOut, None, output, truncated);
            }
            Ok(None) => std::thread::sleep(POLL),
            Err(error) => {
                stop(&mut child);
                return finish(CheckStatus::Error, None, error.to_string(), 0);
            }
        }
    }
}

/// Runs a check off the main thread. `run_id` lets `check_command_cancel`
/// stop it early.
#[tauri::command(async)]
pub fn check_command_run(
    cwd: String,
    command: String,
    timeout_ms: u64,
    run_id: Option<String>,
) -> CheckResult {
    let cwd = crate::fs::expand_home(&cwd);
    let timeout = clamp_timeout(timeout_ms);
    match run_id.filter(|id| !id.is_empty()) {
        Some(run_id) => {
            let flag = register(&run_id);
            let result = run_check(&cwd, &command, timeout, &flag, true);
            unregister(&run_id);
            result
        }
        None => run_check(&cwd, &command, timeout, &AtomicBool::new(false), true),
    }
}

/// False when no check with that id is running.
#[tauri::command]
pub fn check_command_cancel(run_id: String) -> bool {
    cancel(&run_id)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn run(command: &str, timeout: Duration) -> CheckResult {
        let dir = std::env::temp_dir();
        run_check(&dir, command, timeout, &AtomicBool::new(false), false)
    }

    #[test]
    fn passes_on_exit_zero() {
        let result = run("echo all good", Duration::from_secs(10));
        assert_eq!(result.status, CheckStatus::Passed);
        assert_eq!(result.exit_code, Some(0));
        assert_eq!(result.output, "all good");
        assert_eq!(result.truncated, 0);
    }

    #[test]
    fn fails_with_code_and_both_streams() {
        let result = run(
            "echo 'src/a.ts(3,1): error TS2304'; echo oops >&2; exit 3",
            Duration::from_secs(10),
        );
        assert_eq!(result.status, CheckStatus::Failed);
        assert_eq!(result.exit_code, Some(3));
        assert!(result.output.contains("error TS2304"));
        assert!(result.output.contains("oops"));
    }

    #[test]
    fn marks_ci_so_runners_do_not_watch() {
        let result = run(
            "test \"$CI\" = 1 && test \"$IRGATOS_CHECK\" = 1",
            Duration::from_secs(10),
        );
        assert_eq!(result.status, CheckStatus::Passed);
    }

    #[test]
    fn stops_at_the_timeout() {
        let started = Instant::now();
        let result = run("echo started; sleep 20", Duration::from_millis(300));
        assert_eq!(result.status, CheckStatus::TimedOut);
        assert_eq!(result.exit_code, None);
        assert_eq!(result.output, "started");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn stops_children_with_the_shell() {
        let marker = std::env::temp_dir().join(format!("irgatos-check-{}", uuid::Uuid::new_v4()));
        let command = format!("(sleep 1; touch '{}') & wait", marker.display());
        let result = run(&command, Duration::from_millis(200));
        assert_eq!(result.status, CheckStatus::TimedOut);
        std::thread::sleep(Duration::from_millis(1500));
        assert!(
            !marker.exists(),
            "the background child outlived the timeout"
        );
    }

    #[test]
    fn cancels_by_run_id() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        let flag = register(&id);
        let canceller = {
            let id = id.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                cancel(&id)
            })
        };
        let result = run_check(
            &std::env::temp_dir(),
            "sleep 20",
            Duration::from_secs(30),
            &flag,
            false,
        );
        unregister(&id);
        assert!(canceller.join().unwrap());
        assert_eq!(result.status, CheckStatus::Cancelled);
        assert!(!cancel(&id));
    }

    #[test]
    fn keeps_only_the_end_of_long_output() {
        let result = run(
            "i=0; while [ $i -lt 3000 ]; do echo \"line $i of noisy output\"; i=$((i+1)); done; exit 1",
            Duration::from_secs(20),
        );
        assert_eq!(result.status, CheckStatus::Failed);
        assert!(result.truncated > 0);
        assert!(result.output.len() as u64 <= OUTPUT_TAIL_BYTES);
        assert!(result.output.ends_with("line 2999 of noisy output"));
    }

    #[test]
    fn rejects_bad_input_without_running() {
        assert_eq!(
            run("   ", Duration::from_secs(1)).status,
            CheckStatus::Error
        );
        let long = "x".repeat(MAX_COMMAND_CHARS + 1);
        assert_eq!(
            run(&long, Duration::from_secs(1)).status,
            CheckStatus::Error
        );
        let missing = std::env::temp_dir().join("irgatos-check-missing-dir");
        let result = run_check(
            &missing,
            "true",
            Duration::from_secs(1),
            &AtomicBool::new(false),
            false,
        );
        assert_eq!(result.status, CheckStatus::Error);
        assert!(result.output.contains("does not exist"));
    }

    #[test]
    fn clamps_the_timeout() {
        assert_eq!(clamp_timeout(0), MIN_TIMEOUT);
        assert_eq!(clamp_timeout(u64::MAX), MAX_TIMEOUT);
        assert_eq!(clamp_timeout(90_000), Duration::from_secs(90));
    }
}
