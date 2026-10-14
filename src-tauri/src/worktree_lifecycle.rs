use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::fs::{expand_home, path_to_js};
use crate::worktrees::contains_working_dir;

#[derive(Default)]
struct Lifecycle {
    reservations: Mutex<Vec<(PathBuf, bool)>>,
}

static LIFECYCLE: Lifecycle = Lifecycle {
    reservations: Mutex::new(Vec::new()),
};

/// Held from before process creation through host registration, or across the
/// entire removal. The registry mutex is only held while acquiring/releasing.
pub(crate) struct Reservation<'a> {
    lifecycle: &'a Lifecycle,
    path: PathBuf,
    removing: bool,
}

impl Lifecycle {
    fn reserve(&self, path: &Path, removing: bool) -> Result<Reservation<'_>, String> {
        let path = match path.canonicalize() {
            Ok(path) => path,
            // Git can remove a registered worktree whose folder is missing.
            Err(_) if removing => path.to_path_buf(),
            Err(error) => return Err(format!("Cannot open working directory: {error}")),
        };
        let mut reservations = self.reservations.lock().unwrap_or_else(|e| e.into_inner());
        if reservations.iter().any(|(other, exclusive)| {
            (removing || *exclusive)
                && (contains_working_dir(&path, other) || contains_working_dir(other, &path))
        }) {
            return Err(
                "This working copy is starting a process or being deleted. Try again when it finishes."
                    .into(),
            );
        }
        reservations.push((path.clone(), removing));
        Ok(Reservation {
            lifecycle: self,
            path,
            removing,
        })
    }
}

impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        let mut reservations = self
            .lifecycle
            .reservations
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(index) = reservations
            .iter()
            .position(|(path, removing)| *path == self.path && *removing == self.removing)
        {
            reservations.swap_remove(index);
        }
    }
}

pub(crate) fn reserve_spawn(path: &Path) -> Result<Reservation<'static>, String> {
    LIFECYCLE.reserve(path, false)
}

pub(crate) fn reserve_removal(path: &Path) -> Result<Reservation<'static>, String> {
    LIFECYCLE.reserve(path, true)
}

// Per-worktree environment: every linked worktree gets its own port, and a
// project can run a setup command in each new one.

pub(crate) const DEFAULT_PORT_RANGE: [u16; 2] = [4100, 4199];
/// Committed with the project, read from the main checkout.
const SHARED_CONFIG: &str = ".irgatos/worktree.json";
/// This clone's overrides from Project Settings. Lives in the Git common dir so
/// it never shows up as a change.
const LOCAL_CONFIG: &str = "irgatos/worktree.json";
/// Both live in the linked worktree's own Git dir, which Git deletes with it.
const PORT_FILE: &str = "irgatos-port";
const SETUP_LOG: &str = "irgatos-setup.log";
const SETUP_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const SETUP_OUTPUT_TAIL: u64 = 4096;
const MAX_PORT_RANGE: u32 = 10_000;
pub(crate) const SETUP_EVENT: &str = "worktree-setup";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port_range: Option<[u16; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<String>,
}

impl WorktreeConfig {
    fn is_empty(&self) -> bool {
        self.port_range.is_none() && self.setup.is_none()
    }

    /// Local fields win; an empty local setup turns the shared one off.
    fn merged(shared: &Self, local: &Self) -> Self {
        Self {
            port_range: local
                .port_range
                .or(shared.port_range)
                .or(Some(DEFAULT_PORT_RANGE)),
            setup: local
                .setup
                .clone()
                .or_else(|| shared.setup.clone())
                .filter(|setup| !setup.trim().is_empty()),
        }
    }
}

fn port_range_from_value(value: &Value) -> Result<[u16; 2], String> {
    let pair = match value {
        Value::String(text) => {
            let (start, end) = text
                .split_once('-')
                .ok_or_else(|| format!("portRange \"{text}\" should look like \"4100-4199\""))?;
            (
                start.trim().parse::<u64>().ok(),
                end.trim().parse::<u64>().ok(),
            )
        }
        Value::Array(items) if items.len() == 2 => (items[0].as_u64(), items[1].as_u64()),
        Value::Object(map) => (
            map.get("start").and_then(Value::as_u64),
            map.get("end").and_then(Value::as_u64),
        ),
        _ => (None, None),
    };
    match pair {
        (Some(start), Some(end)) => validate_port_range(start, end),
        _ => Err("portRange should be \"4100-4199\", [4100, 4199] or {\"start\", \"end\"}".into()),
    }
}

fn validate_port_range(start: u64, end: u64) -> Result<[u16; 2], String> {
    if start == 0 || end > u16::MAX as u64 || start > end {
        return Err(format!("Port range {start}-{end} is not valid"));
    }
    if end - start + 1 > MAX_PORT_RANGE as u64 {
        return Err(format!(
            "Port range {start}-{end} spans more than {MAX_PORT_RANGE} ports"
        ));
    }
    Ok([start as u16, end as u16])
}

fn setup_from_value(value: &Value) -> Result<Option<String>, String> {
    match value {
        Value::Null => Ok(None),
        Value::String(text) => Ok(Some(text.trim().to_owned())),
        Value::Array(items) => {
            let steps = items
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(|step| step.trim().to_owned())
                        .ok_or_else(|| "setup steps must be strings".to_string())
                })
                .collect::<Result<Vec<_>, _>>()?;
            let steps: Vec<_> = steps.into_iter().filter(|step| !step.is_empty()).collect();
            Ok(Some(steps.join(" && ")))
        }
        _ => Err("setup should be a command or a list of commands".into()),
    }
}

pub(crate) fn parse_config(text: &str) -> Result<WorktreeConfig, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("Invalid JSON: {e}"))?;
    let map = value
        .as_object()
        .ok_or("The worktree config should be a JSON object")?;
    Ok(WorktreeConfig {
        port_range: match map.get("portRange") {
            None | Some(Value::Null) => None,
            Some(range) => Some(port_range_from_value(range)?),
        },
        setup: match map.get("setup") {
            None => None,
            Some(setup) => setup_from_value(setup)?,
        },
    })
}

/// Where a checkout's Git metadata lives, found without running Git.
#[derive(Debug)]
struct GitLocation {
    root: PathBuf,
    /// The linked worktree's private Git dir; absent for the main checkout.
    worktree_git_dir: Option<PathBuf>,
    common_dir: PathBuf,
    /// Absent for worktrees of a bare repository.
    main_root: Option<PathBuf>,
}

fn locate(path: &Path) -> Option<GitLocation> {
    let start = path.canonicalize().ok()?;
    for dir in start.ancestors() {
        let dot_git = dir.join(".git");
        let Ok(meta) = std::fs::metadata(&dot_git) else {
            continue;
        };
        if meta.is_dir() {
            return Some(GitLocation {
                root: dir.to_path_buf(),
                worktree_git_dir: None,
                common_dir: dot_git,
                main_root: Some(dir.to_path_buf()),
            });
        }
        let text = std::fs::read_to_string(&dot_git).ok()?;
        let git_dir = dir.join(text.trim().strip_prefix("gitdir:")?.trim());
        let git_dir = git_dir.canonicalize().unwrap_or(git_dir);
        // Submodules also use a `.git` file, but only linked worktrees have `commondir`.
        let common = std::fs::read_to_string(git_dir.join("commondir")).ok()?;
        let common_dir = git_dir.join(common.trim());
        let common_dir = common_dir.canonicalize().unwrap_or(common_dir);
        let main_root = (common_dir.file_name()? == ".git")
            .then(|| common_dir.parent().map(Path::to_path_buf))
            .flatten();
        return Some(GitLocation {
            root: dir.to_path_buf(),
            worktree_git_dir: Some(git_dir),
            common_dir,
            main_root,
        });
    }
    None
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSettings {
    pub shared: WorktreeConfig,
    pub shared_path: Option<String>,
    pub shared_error: Option<String>,
    pub local: WorktreeConfig,
    pub effective: WorktreeConfig,
    pub default_port_range: [u16; 2],
}

fn read_config(path: &Path) -> (WorktreeConfig, Option<String>) {
    match std::fs::read_to_string(path) {
        Ok(text) => match parse_config(&text) {
            Ok(config) => (config, None),
            Err(error) => (WorktreeConfig::default(), Some(error)),
        },
        Err(_) => (WorktreeConfig::default(), None),
    }
}

fn settings_for(location: &GitLocation) -> WorktreeSettings {
    let shared_path = location
        .main_root
        .as_ref()
        .map(|root| root.join(SHARED_CONFIG));
    let (shared, shared_error) = shared_path.as_deref().map(read_config).unwrap_or_default();
    let (local, _) = read_config(&location.common_dir.join(LOCAL_CONFIG));
    WorktreeSettings {
        effective: WorktreeConfig::merged(&shared, &local),
        shared,
        shared_path: shared_path.as_deref().map(path_to_js),
        shared_error,
        local,
        default_port_range: DEFAULT_PORT_RANGE,
    }
}

fn save_local(location: &GitLocation, local: WorktreeConfig) -> Result<WorktreeSettings, String> {
    let local = WorktreeConfig {
        port_range: match local.port_range {
            Some([start, end]) => Some(validate_port_range(start as u64, end as u64)?),
            None => None,
        },
        setup: local.setup.map(|setup| setup.trim().to_owned()),
    };
    let path = location.common_dir.join(LOCAL_CONFIG);
    if local.is_empty() {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    } else {
        std::fs::create_dir_all(path.parent().ok_or("Invalid Git directory")?)
            .map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(&local).map_err(|e| e.to_string())?;
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
    }
    Ok(settings_for(location))
}

/// Stable 32-bit FNV-1a, so a worktree path lands on the same first choice
/// across runs and machines.
fn fnv1a(text: &str) -> u32 {
    text.bytes().fold(0x811c_9dc5u32, |hash, byte| {
        (hash ^ byte as u32).wrapping_mul(0x0100_0193)
    })
}

/// Start at the seed's slot and probe forward, wrapping once round the range.
pub(crate) fn pick_port(
    range: [u16; 2],
    taken: &HashSet<u16>,
    seed: &str,
    is_free: impl Fn(u16) -> bool,
) -> Option<u16> {
    let [start, end] = range;
    if start > end {
        return None;
    }
    let size = end as u32 - start as u32 + 1;
    let offset = fnv1a(seed) % size;
    (0..size)
        .map(|step| start + ((offset + step) % size) as u16)
        .find(|port| !taken.contains(port) && is_free(*port))
}

/// Nothing answers on loopback and the port can be bound. Connecting catches
/// servers on 0.0.0.0, which a loopback bind alone can miss on macOS.
fn port_is_free(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(50)).is_err()
        && TcpListener::bind(addr).is_ok()
}

fn read_port(path: &Path) -> Option<u16> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn sibling_ports(common_dir: &Path, own: &Path) -> HashSet<u16> {
    let Ok(entries) = std::fs::read_dir(common_dir.join("worktrees")) else {
        return HashSet::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|dir| dir.canonicalize().unwrap_or_else(|_| dir.clone()) != own)
        .filter_map(|dir| read_port(&dir.join(PORT_FILE)))
        .collect()
}

static PORT_ASSIGNMENT: Mutex<()> = Mutex::new(());

fn ensure_port_at(location: &GitLocation, is_free: impl Fn(u16) -> bool) -> Option<u16> {
    let git_dir = location.worktree_git_dir.as_ref()?;
    let range = settings_for(location).effective.port_range?;
    let _guard = PORT_ASSIGNMENT.lock().unwrap_or_else(|e| e.into_inner());
    let file = git_dir.join(PORT_FILE);
    // A kept port may be busy with this worktree's own server; never re-probe it.
    if let Some(port) = read_port(&file).filter(|port| (range[0]..=range[1]).contains(port)) {
        return Some(port);
    }
    let taken = sibling_ports(&location.common_dir, git_dir);
    let port = pick_port(range, &taken, &path_to_js(&location.root), is_free)?;
    std::fs::write(&file, port.to_string()).ok()?;
    Some(port)
}

/// The port this linked worktree owns, assigned on first use.
pub(crate) fn ensure_port(path: &Path) -> Option<u16> {
    ensure_port_at(&locate(path)?, port_is_free)
}

/// Variables every process started inside a linked worktree receives.
pub(crate) fn session_env(workdir: &Path) -> Vec<(&'static str, String)> {
    let Some(location) = locate(workdir) else {
        return Vec::new();
    };
    if location.worktree_git_dir.is_none() {
        return Vec::new();
    }
    let port = ensure_port_at(&location, port_is_free);
    session_env_at(&location, port)
}

/// Recorded port for a listed worktree. Listing never assigns one.
pub(crate) fn assigned_port(path: &Path) -> Option<u16> {
    read_port(&locate(path)?.worktree_git_dir?.join(PORT_FILE))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupStatus {
    Running,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupEvent {
    pub path: String,
    pub command: String,
    pub status: SetupStatus,
    pub exit_code: Option<i32>,
    pub output: String,
    pub log_path: Option<String>,
    pub port: Option<u16>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
}

static SETUP_RUNS: Mutex<Option<HashMap<String, SetupEvent>>> = Mutex::new(None);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

fn record_setup(event: &SetupEvent) {
    let mut runs = SETUP_RUNS.lock().unwrap_or_else(|e| e.into_inner());
    runs.get_or_insert_with(HashMap::new)
        .insert(event.path.clone(), event.clone());
}

fn setup_shell(command: &str) -> Command {
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
        // Its own group, so a timeout also stops the installers it started.
        cmd.process_group(0);
        cmd
    }
}

fn stop_setup(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn log_tail(path: &Path) -> String {
    let Ok(mut file) = std::fs::File::open(path) else {
        return String::new();
    };
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let _ = file.seek(SeekFrom::Start(len.saturating_sub(SETUP_OUTPUT_TAIL)));
    let mut bytes = Vec::new();
    let _ = file.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).trim().to_owned()
}

/// Run the setup command to completion inside the worktree, logging to its Git dir.
fn run_setup(
    location: &GitLocation,
    command: &str,
    port: Option<u16>,
    timeout: Duration,
) -> SetupEvent {
    let started_at = now_ms();
    let log_path = location
        .worktree_git_dir
        .as_ref()
        .map(|dir| dir.join(SETUP_LOG))
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("irgatos-setup-{}.log", uuid::Uuid::new_v4()))
        });
    let finish = |status, exit_code, output: String| SetupEvent {
        path: path_to_js(&location.root),
        command: command.to_owned(),
        status,
        exit_code,
        output,
        log_path: Some(path_to_js(&log_path)),
        port,
        started_at,
        finished_at: Some(now_ms()),
    };
    let log = match std::fs::File::create(&log_path) {
        Ok(log) => log,
        Err(error) => {
            return finish(
                SetupStatus::Failed,
                None,
                format!("Cannot write the setup log: {error}"),
            )
        }
    };
    let stderr = match log.try_clone() {
        Ok(stderr) => stderr,
        Err(error) => return finish(SetupStatus::Failed, None, error.to_string()),
    };
    let mut cmd = setup_shell(command);
    crate::harness::apply_gui_env(&mut cmd);
    cmd.current_dir(&location.root)
        .env("PATH", crate::harness::gui_search_path())
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(stderr);
    for (key, value) in session_env_at(location, port) {
        cmd.env(key, value);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            return finish(
                SetupStatus::Failed,
                None,
                format!("Failed to start setup: {error}"),
            )
        }
    };
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = log_tail(&log_path);
                return if status.success() {
                    finish(SetupStatus::Succeeded, status.code(), output)
                } else {
                    finish(SetupStatus::Failed, status.code(), output)
                };
            }
            Ok(None) if Instant::now() >= deadline => {
                stop_setup(&mut child);
                let output = log_tail(&log_path);
                return finish(
                    SetupStatus::Failed,
                    None,
                    format!(
                        "{output}\nStopped after {} minutes.",
                        timeout.as_secs() / 60
                    )
                    .trim()
                    .to_owned(),
                );
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => {
                stop_setup(&mut child);
                return finish(SetupStatus::Failed, None, error.to_string());
            }
        }
    }
}

fn session_env_at(location: &GitLocation, port: Option<u16>) -> Vec<(&'static str, String)> {
    let mut env = vec![("IRGATOS_WORKTREE", path_to_js(&location.root))];
    if let Some(main) = &location.main_root {
        env.push(("IRGATOS_MAIN_WORKTREE", path_to_js(main)));
    }
    if let Some(port) = port {
        env.push(("PORT", port.to_string()));
        env.push(("IRGATOS_PORT", port.to_string()));
    }
    env
}

/// Start the project's setup command in a new worktree on a background thread.
/// Progress arrives as `worktree-setup` events. Returns the command, if any.
pub(crate) fn start_setup(app: AppHandle, path: &Path) -> Option<String> {
    let location = locate(path)?;
    location.worktree_git_dir.as_ref()?;
    let command = settings_for(&location).effective.setup?;
    let port = ensure_port_at(&location, port_is_free);
    let running = SetupEvent {
        path: path_to_js(&location.root),
        command: command.clone(),
        status: SetupStatus::Running,
        exit_code: None,
        output: String::new(),
        log_path: None,
        port,
        started_at: now_ms(),
        finished_at: None,
    };
    {
        let mut runs = SETUP_RUNS.lock().unwrap_or_else(|e| e.into_inner());
        let runs = runs.get_or_insert_with(HashMap::new);
        if runs
            .get(&running.path)
            .is_some_and(|run| run.status == SetupStatus::Running)
        {
            return Some(command);
        }
        runs.insert(running.path.clone(), running.clone());
    }
    let _ = app.emit(SETUP_EVENT, &running);
    let job = command.clone();
    std::thread::spawn(move || {
        let done = run_setup(&location, &job, port, SETUP_TIMEOUT);
        record_setup(&done);
        let _ = app.emit(SETUP_EVENT, &done);
    });
    Some(command)
}

fn location_for(cwd: &str) -> Result<GitLocation, String> {
    locate(&expand_home(cwd)).ok_or_else(|| "This folder is not a Git repository".into())
}

#[tauri::command(async)]
pub fn worktree_settings(cwd: String) -> Result<WorktreeSettings, String> {
    Ok(settings_for(&location_for(&cwd)?))
}

#[tauri::command(async)]
pub fn worktree_settings_save(
    cwd: String,
    local: WorktreeConfig,
) -> Result<WorktreeSettings, String> {
    save_local(&location_for(&cwd)?, local)
}

/// The port processes in this working copy get, or null outside a linked worktree.
#[tauri::command(async)]
pub fn worktree_port(cwd: String) -> Option<u16> {
    ensure_port(&expand_home(&cwd))
}

#[tauri::command(async)]
pub fn worktree_setup_status(path: String) -> Option<SetupEvent> {
    let key = path_to_js(&locate(&expand_home(&path))?.root);
    let runs = SETUP_RUNS.lock().unwrap_or_else(|e| e.into_inner());
    runs.as_ref()?.get(&key).cloned()
}

#[tauri::command(async)]
pub fn worktree_setup_run(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let location = location_for(&path)?;
    if location.worktree_git_dir.is_none() {
        return Err("Setup commands only run in linked worktrees".into());
    }
    Ok(start_setup(app, &location.root))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removal_and_in_flight_spawns_exclude_each_other_until_guards_drop() {
        let root = std::env::temp_dir().join(format!("irgat-lifecycle-{}", uuid::Uuid::new_v4()));
        let child = root.join("src");
        let sibling = root.with_file_name(format!(
            "{}-other",
            root.file_name().unwrap().to_string_lossy()
        ));
        std::fs::create_dir_all(&child).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let lifecycle = Lifecycle::default();
        let first = lifecycle.reserve(&child, false).unwrap();
        let second = lifecycle.reserve(&child, false).unwrap();
        assert!(lifecycle.reserve(&root, true).is_err());
        drop(first);
        assert!(lifecycle.reserve(&root, true).is_err());
        drop(second);
        let removal = lifecycle.reserve(&root, true).unwrap();
        assert!(lifecycle.reserve(&child, false).is_err());
        assert!(lifecycle.reserve(&root.join("src/.."), false).is_err());
        assert!(lifecycle.reserve(&root, true).is_err());
        assert!(lifecycle.reserve(&sibling, false).is_ok());
        drop(removal);
        assert!(lifecycle.reserve(&child, false).is_ok());
        std::fs::remove_dir_all(&root).unwrap();
        assert!(lifecycle.reserve(&child, false).is_err());
        std::fs::remove_dir_all(&sibling).unwrap();
    }

    struct Repo(PathBuf);
    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// A main checkout plus two linked worktrees.
    fn repo() -> (Repo, PathBuf, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("irgat-worktree-env-{}", uuid::Uuid::new_v4()));
        let main = dir.join("repo");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-b", "main"]);
        git(&main, &["commit", "--allow-empty", "-m", "initial"]);
        let a = dir.join("repo-worktrees/a");
        let b = dir.join("repo-worktrees/b");
        git(&main, &["worktree", "add", "-b", "a", a.to_str().unwrap()]);
        git(&main, &["worktree", "add", "-b", "b", b.to_str().unwrap()]);
        (Repo(dir), main, a, b)
    }

    #[test]
    fn picks_a_stable_free_port_and_skips_taken_ones() {
        let range = [4100, 4109];
        let none = HashSet::new();
        let first = pick_port(range, &none, "/repo-worktrees/a", |_| true).unwrap();
        assert!((4100..=4109).contains(&first));
        assert_eq!(
            pick_port(range, &none, "/repo-worktrees/a", |_| true),
            Some(first)
        );

        let taken: HashSet<u16> = [first].into();
        let next = pick_port(range, &taken, "/repo-worktrees/a", |_| true).unwrap();
        assert_eq!(next, if first == 4109 { 4100 } else { first + 1 });

        let busy = pick_port(range, &none, "/repo-worktrees/a", |port| port != first).unwrap();
        assert_ne!(busy, first);

        let all: HashSet<u16> = (4100..=4109).collect();
        assert_eq!(pick_port(range, &all, "seed", |_| true), None);
        assert_eq!(pick_port([4200, 4200], &none, "seed", |_| true), Some(4200));
        assert_eq!(pick_port([4200, 4100], &none, "seed", |_| true), None);
    }

    #[test]
    fn parses_shared_config_shapes_and_rejects_bad_ranges() {
        let config =
            parse_config(r#"{"portRange":"4300-4399","setup":"pnpm install --offline"}"#).unwrap();
        assert_eq!(config.port_range, Some([4300, 4399]));
        assert_eq!(config.setup.as_deref(), Some("pnpm install --offline"));

        let config = parse_config(
            r#"{"portRange":[5000,5010],"setup":["cp .env.example .env"," ","pnpm i"]}"#,
        )
        .unwrap();
        assert_eq!(config.port_range, Some([5000, 5010]));
        assert_eq!(
            config.setup.as_deref(),
            Some("cp .env.example .env && pnpm i")
        );

        let config = parse_config(r#"{"portRange":{"start":6000,"end":6001}}"#).unwrap();
        assert_eq!(
            config,
            WorktreeConfig {
                port_range: Some([6000, 6001]),
                setup: None
            }
        );

        assert!(parse_config(r#"{"portRange":"4399-4300"}"#).is_err());
        assert!(parse_config(r#"{"portRange":[0,10]}"#).is_err());
        assert!(parse_config(r#"{"portRange":"1-70000"}"#).is_err());
        assert!(parse_config(r#"{"setup":42}"#).is_err());
        assert!(parse_config("[]").is_err());

        let shared = WorktreeConfig {
            port_range: Some([4300, 4399]),
            setup: Some("npm ci".into()),
        };
        assert_eq!(
            WorktreeConfig::merged(&shared, &WorktreeConfig::default()),
            shared
        );
        let local = WorktreeConfig {
            port_range: None,
            setup: Some(String::new()),
        };
        assert_eq!(
            WorktreeConfig::merged(&shared, &local),
            WorktreeConfig {
                port_range: Some([4300, 4399]),
                setup: None
            }
        );
        assert_eq!(
            WorktreeConfig::merged(&WorktreeConfig::default(), &WorktreeConfig::default())
                .port_range,
            Some(DEFAULT_PORT_RANGE)
        );
    }

    #[test]
    fn linked_worktrees_keep_distinct_ports_and_the_main_checkout_gets_none() {
        let (_repo, main, a, b) = repo();
        let main_location = locate(&main).unwrap();
        assert!(main_location.worktree_git_dir.is_none());
        assert!(session_env(&main).is_empty());
        assert_eq!(ensure_port_at(&main_location, |_| true), None);

        std::fs::create_dir_all(a.join("src")).unwrap();
        let in_a = locate(&a.join("src")).unwrap();
        assert_eq!(in_a.root, a.canonicalize().unwrap());
        assert_eq!(in_a.main_root, Some(main.canonicalize().unwrap()));

        let port_a = ensure_port_at(&in_a, |_| true).unwrap();
        assert!((DEFAULT_PORT_RANGE[0]..=DEFAULT_PORT_RANGE[1]).contains(&port_a));
        // Kept even when the port is now busy (its own dev server, say).
        assert_eq!(ensure_port_at(&in_a, |_| false), Some(port_a));
        assert_eq!(assigned_port(&a), Some(port_a));
        assert_eq!(assigned_port(&b), None);

        let port_b = ensure_port_at(&locate(&b).unwrap(), |_| true).unwrap();
        assert_ne!(port_a, port_b);

        let env: HashMap<_, _> = session_env(&a).into_iter().collect();
        assert_eq!(env.get("PORT"), Some(&port_a.to_string()));
        assert_eq!(env.get("IRGATOS_PORT"), Some(&port_a.to_string()));
        assert_eq!(
            env.get("IRGATOS_MAIN_WORKTREE"),
            Some(&path_to_js(&main.canonicalize().unwrap()))
        );

        // Moving the range reassigns ports outside it.
        std::fs::create_dir_all(main.join(".irgatos")).unwrap();
        std::fs::write(main.join(SHARED_CONFIG), r#"{"portRange":"4700-4701"}"#).unwrap();
        let moved = ensure_port_at(&in_a, |_| true).unwrap();
        assert!((4700..=4701).contains(&moved));
        let other = ensure_port_at(&locate(&b).unwrap(), |_| true).unwrap();
        assert_ne!(moved, other);
    }

    #[test]
    fn local_settings_override_the_shared_file_without_touching_the_checkout() {
        let (_repo, main, a, _b) = repo();
        std::fs::create_dir_all(main.join(".irgatos")).unwrap();
        std::fs::write(
            main.join(SHARED_CONFIG),
            r#"{"portRange":"4300-4399","setup":"npm ci"}"#,
        )
        .unwrap();
        let location = locate(&a).unwrap();
        let settings = settings_for(&location);
        assert_eq!(settings.effective.setup.as_deref(), Some("npm ci"));
        assert_eq!(settings.effective.port_range, Some([4300, 4399]));

        let saved = save_local(
            &location,
            WorktreeConfig {
                port_range: Some([5100, 5199]),
                setup: Some("  pnpm install --offline ".into()),
            },
        )
        .unwrap();
        assert_eq!(saved.effective.port_range, Some([5100, 5199]));
        assert_eq!(
            saved.effective.setup.as_deref(),
            Some("pnpm install --offline")
        );
        assert!(location.common_dir.join(LOCAL_CONFIG).is_file());
        // Seen from the main checkout too.
        assert_eq!(settings_for(&locate(&main).unwrap()).local, saved.local);

        assert!(save_local(
            &location,
            WorktreeConfig {
                port_range: Some([10, 1]),
                setup: None
            }
        )
        .is_err());
        let cleared = save_local(&location, WorktreeConfig::default()).unwrap();
        assert!(!location.common_dir.join(LOCAL_CONFIG).exists());
        assert_eq!(cleared.effective.setup.as_deref(), Some("npm ci"));

        std::fs::write(main.join(SHARED_CONFIG), "{not json").unwrap();
        let broken = settings_for(&location);
        assert!(broken.shared_error.is_some());
        assert_eq!(broken.effective.port_range, Some(DEFAULT_PORT_RANGE));
    }

    #[cfg(unix)]
    #[test]
    fn setup_runs_in_the_worktree_with_its_port_and_reports_failures() {
        let (_repo, _main, a, _b) = repo();
        let location = locate(&a).unwrap();
        let done = run_setup(
            &location,
            "printf '%s %s' \"$PORT\" \"$IRGATOS_PORT\" > port.txt && echo installed",
            Some(4142),
            Duration::from_secs(30),
        );
        assert_eq!(done.status, SetupStatus::Succeeded, "{}", done.output);
        assert_eq!(
            std::fs::read_to_string(a.join("port.txt")).unwrap(),
            "4142 4142"
        );
        assert_eq!(done.output, "installed");
        assert!(Path::new(done.log_path.as_deref().unwrap())
            .starts_with(location.worktree_git_dir.as_ref().unwrap()));

        let failed = run_setup(
            &location,
            "echo nope >&2; exit 3",
            None,
            Duration::from_secs(30),
        );
        assert_eq!(failed.status, SetupStatus::Failed);
        assert_eq!(failed.exit_code, Some(3));
        assert_eq!(failed.output, "nope");

        let slow = run_setup(&location, "sleep 5", None, Duration::from_millis(300));
        assert_eq!(slow.status, SetupStatus::Failed);
        assert!(slow.output.contains("Stopped after"));
    }
}
