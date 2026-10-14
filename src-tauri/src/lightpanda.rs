//! Lightpanda, an optional headless browser for agents. It is AGPL-3.0-only,
//! so Irgatos never links or bundles it: the user installs it on `PATH`, or
//! Irgatos downloads the official release binary into `~/.irgatos/bin` on
//! request and only ever runs it as a separate process.

use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dirs_home;
use crate::harness::{
    exec_output_env, first_binary, prepare_child, spawn_managed, which_via_login_shell,
};

const BINARY: &str = "lightpanda";
const RELEASE_BASE: &str = "https://github.com/lightpanda-io/browser/releases/download/nightly";
pub(crate) const TELEMETRY_ENV: (&str, &str) = ("LIGHTPANDA_DISABLE_TELEMETRY", "true");
pub(crate) const CDP_ENV: &str = "IRGATOS_LIGHTPANDA_CDP_URL";
pub(crate) const CDP_ENV_ALIAS: &str = "LIGHTPANDA_CDP_URL";
const INSTALL_PROGRESS: &str = "lightpanda:install-progress";
const SIDECAR_HOST: Ipv4Addr = Ipv4Addr::LOCALHOST;
/// The nightly binaries are ~90 MB; anything far larger is not a release.
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const LOG_LINES: usize = 40;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    running: bool,
    port: Option<u16>,
    cdp_url: Option<String>,
    pid: Option<u32>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightpandaStatus {
    binary_path: Option<String>,
    /// Installed by Irgatos into `~/.irgatos/bin`, so it can update it too.
    managed: bool,
    version: Option<String>,
    install_path: Option<String>,
    release_asset: Option<String>,
    download_url: Option<String>,
    sidecar: SidecarStatus,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    received: u64,
    total: Option<u64>,
}

fn install_dir(home: &Path) -> PathBuf {
    home.join(".irgatos/bin")
}

fn legacy_install_dir(home: &Path) -> PathBuf {
    home.join(".monocode/bin")
}

fn candidates(home: Option<&Path>, from_path: Option<PathBuf>) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = from_path.into_iter().collect();
    paths.push(PathBuf::from("/opt/homebrew/bin").join(BINARY));
    paths.push(PathBuf::from("/usr/local/bin").join(BINARY));
    if let Some(home) = home {
        paths.push(install_dir(home).join(BINARY));
        paths.push(legacy_install_dir(home).join(BINARY));
    }
    paths
}

fn home() -> Option<PathBuf> {
    dirs_home().map(PathBuf::from)
}

fn resolve_binary() -> Option<PathBuf> {
    let home = home();
    first_binary(candidates(home.as_deref(), which_via_login_shell(BINARY)))
}

fn is_managed(binary: &Path, home: Option<&Path>) -> bool {
    home.is_some_and(|home| binary.starts_with(install_dir(home)))
}

fn release_asset_for(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("lightpanda-aarch64-macos"),
        ("macos", "x86_64") => Some("lightpanda-x86_64-macos"),
        ("linux", "x86_64") => Some("lightpanda-x86_64-linux"),
        ("linux", "aarch64") => Some("lightpanda-aarch64-linux"),
        _ => None,
    }
}

fn release_asset() -> Option<&'static str> {
    release_asset_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn download_url(asset: &str) -> String {
    format!("{RELEASE_BASE}/{asset}")
}

fn parse_version(output: &str) -> Option<String> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let version = line.strip_prefix(BINARY).unwrap_or(line).trim();
    (!version.is_empty()).then(|| version.to_owned())
}

/// Every Lightpanda invocation goes through here so telemetry is never on.
fn run(binary: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let args: Vec<String> = args.iter().map(|arg| (*arg).to_owned()).collect();
    let output = exec_output_env(
        &binary.to_string_lossy(),
        &args,
        None,
        &[TELEMETRY_ENV],
        timeout,
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("{} {}", stderr.trim(), stdout).trim().to_owned())
}

fn read_version(binary: &Path) -> Result<String, String> {
    let output = run(binary, &["version"], Duration::from_secs(20))?;
    parse_version(&output).ok_or_else(|| "Lightpanda did not report a version".to_owned())
}

fn cdp_url(port: u16) -> String {
    format!("ws://{SIDECAR_HOST}:{port}")
}

fn serve_args(port: u16) -> Vec<String> {
    vec![
        "serve".into(),
        "--host".into(),
        SIDECAR_HOST.to_string(),
        "--port".into(),
        port.to_string(),
    ]
}

fn validate_port(port: Option<u16>) -> Result<Option<u16>, String> {
    match port {
        Some(port) if port < 1024 => Err("Choose a port from 1024 to 65535".into()),
        other => Ok(other),
    }
}

fn free_port() -> Result<u16, String> {
    TcpListener::bind((SIDECAR_HOST, 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .map_err(|e| format!("No free local port: {e}"))
}

struct Sidecar {
    child: Child,
    port: u16,
}

impl Sidecar {
    fn status(&self) -> SidecarStatus {
        SidecarStatus {
            running: true,
            port: Some(self.port),
            cdp_url: Some(cdp_url(self.port)),
            pid: Some(self.child.id()),
        }
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Default)]
pub struct LightpandaHost {
    sidecar: Mutex<Option<Sidecar>>,
}

impl LightpandaHost {
    /// Drops a sidecar that exited on its own so status never reports a dead
    /// endpoint to agents.
    fn live(slot: &mut Option<Sidecar>) -> Option<&mut Sidecar> {
        let exited = !matches!(slot.as_mut()?.child.try_wait(), Ok(None));
        if exited {
            *slot = None;
        }
        slot.as_mut()
    }

    fn status(&self) -> SidecarStatus {
        let Ok(mut slot) = self.sidecar.lock() else {
            return SidecarStatus::default();
        };
        Self::live(&mut slot)
            .map(|sidecar| sidecar.status())
            .unwrap_or_default()
    }

    fn cdp_url(&self) -> Option<String> {
        self.status().cdp_url
    }

    fn start(&self, binary: &Path, port: Option<u16>) -> Result<SidecarStatus, String> {
        let mut slot = self.sidecar.lock().map_err(|e| e.to_string())?;
        if let Some(sidecar) = Self::live(&mut slot) {
            if port.is_none() || port == Some(sidecar.port) {
                return Ok(sidecar.status());
            }
            sidecar.stop();
            *slot = None;
        }
        let port = match validate_port(port)? {
            Some(port) => port,
            None => free_port()?,
        };
        let sidecar = spawn_sidecar(binary, port)?;
        let status = sidecar.status();
        *slot = Some(sidecar);
        Ok(status)
    }

    pub fn stop(&self) {
        if let Ok(mut slot) = self.sidecar.lock() {
            slot.take();
        }
    }
}

fn sidecar_command(binary: &Path, port: u16) -> Command {
    let program = binary.to_string_lossy().into_owned();
    let mut cmd = Command::new(&program);
    cmd.args(serve_args(port))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    prepare_child(&mut cmd, &program);
    cmd.env(TELEMETRY_ENV.0, TELEMETRY_ENV.1);
    cmd
}

fn spawn_sidecar(binary: &Path, port: u16) -> Result<Sidecar, String> {
    let mut child = spawn_managed(&mut sidecar_command(binary, port))
        .map_err(|e| format!("Failed to start Lightpanda: {e}"))?;
    let logs = Arc::new(Mutex::new(VecDeque::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let logs = Arc::clone(&logs);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut logs) = logs.lock() {
                    if logs.len() == LOG_LINES {
                        logs.pop_front();
                    }
                    logs.push_back(line);
                }
            }
        });
    }
    let mut sidecar = Sidecar { child, port };
    let addr = SocketAddr::from((SIDECAR_HOST, port));
    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        if let Ok(Some(status)) = sidecar.child.try_wait() {
            // Give the reader a moment to drain the last lines.
            thread::sleep(Duration::from_millis(50));
            let tail = logs
                .lock()
                .map(|logs| logs.iter().cloned().collect::<Vec<_>>().join("\n"))
                .unwrap_or_default();
            let detail = if tail.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", tail.trim())
            };
            return Err(format!("Lightpanda exited ({status}){detail}"));
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok() {
            return Ok(sidecar);
        }
        if Instant::now() >= deadline {
            sidecar.stop();
            return Err(format!(
                "Lightpanda did not open {addr} within {}s",
                READY_TIMEOUT.as_secs()
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn apply_cdp_env(cmd: &mut Command, url: Option<&str>) {
    cmd.env_remove(CDP_ENV);
    if let Some(url) = url {
        cmd.env(CDP_ENV, url).env(CDP_ENV_ALIAS, url);
    }
}

/// Agent sessions started while the sidecar runs, including Irgat and Habit
/// runs, can reach it without knowing the port.
pub fn configure_child(app: &AppHandle, cmd: &mut Command) {
    let url = app
        .try_state::<LightpandaHost>()
        .and_then(|host| host.cdp_url());
    apply_cdp_env(cmd, url.as_deref());
}

#[cfg(target_os = "macos")]
fn strip_quarantine(path: &Path) {
    let _ = Command::new("/usr/bin/xattr")
        .args(["-d", "com.apple.quarantine"])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(target_os = "macos"))]
fn strip_quarantine(_path: &Path) {}

#[cfg(unix)]
fn make_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Writes the download next to the target and swaps it in only once it runs,
/// so a broken download never replaces a working binary.
fn install_from_reader(
    reader: &mut dyn Read,
    total: Option<u64>,
    dir: &Path,
    on_progress: &mut dyn FnMut(u64, Option<u64>),
) -> Result<(PathBuf, String), String> {
    if total.is_some_and(|total| total > MAX_DOWNLOAD) {
        return Err("The Lightpanda download is unexpectedly large".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let target = dir.join(BINARY);
    let partial = dir.join(format!(".{BINARY}.download-{}", std::process::id()));
    let result = (|| {
        let mut file = fs::File::create(&partial).map_err(|e| e.to_string())?;
        let mut received = 0u64;
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
            if read == 0 {
                break;
            }
            received += read as u64;
            if received > MAX_DOWNLOAD {
                return Err("The Lightpanda download is unexpectedly large".to_owned());
            }
            file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
            on_progress(received, total);
        }
        if total.is_some_and(|total| total != received) {
            return Err(format!(
                "The download stopped early ({received} of {} bytes)",
                total.unwrap_or_default()
            ));
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        make_executable(&partial).map_err(|e| e.to_string())?;
        strip_quarantine(&partial);
        let version = read_version(&partial)
            .map_err(|e| format!("The downloaded Lightpanda does not run: {e}"))?;
        fs::rename(&partial, &target).map_err(|e| e.to_string())?;
        Ok((target.clone(), version))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn download_to(
    dir: &Path,
    on_progress: &mut dyn FnMut(u64, Option<u64>),
) -> Result<(PathBuf, String), String> {
    let asset = release_asset().ok_or("Lightpanda has no build for this platform")?;
    let agent = ureq::AgentBuilder::new()
        .https_only(true)
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .build();
    let response = agent
        .get(&download_url(asset))
        .call()
        .map_err(|e| format!("Could not download Lightpanda: {e}"))?;
    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());
    install_from_reader(&mut response.into_reader(), total, dir, on_progress)
}

fn download(app: &AppHandle) -> Result<(), String> {
    let home = home().ok_or("Could not find your home folder")?;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut on_progress = |received: u64, total: Option<u64>| {
        if last_emit.elapsed() >= Duration::from_millis(150) || Some(received) == total {
            last_emit = Instant::now();
            let _ = app.emit(INSTALL_PROGRESS, InstallProgress { received, total });
        }
    };
    download_to(&install_dir(&home), &mut on_progress).map(|_| ())
}

fn status(host: &LightpandaHost) -> LightpandaStatus {
    let home = home();
    let asset = release_asset();
    let mut status = LightpandaStatus {
        install_path: home.as_deref().map(|home| {
            install_dir(home)
                .join(BINARY)
                .to_string_lossy()
                .into_owned()
        }),
        release_asset: asset.map(str::to_owned),
        download_url: asset.map(download_url),
        sidecar: host.status(),
        ..Default::default()
    };
    if let Some(binary) = resolve_binary() {
        status.managed = is_managed(&binary, home.as_deref());
        status.version = read_version(&binary).ok();
        status.binary_path = Some(binary.to_string_lossy().into_owned());
    }
    status
}

fn require_binary() -> Result<PathBuf, String> {
    resolve_binary().ok_or_else(|| "Lightpanda is not installed".to_owned())
}

#[tauri::command]
pub async fn lightpanda_status(app: AppHandle) -> Result<LightpandaStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&app.state::<LightpandaHost>()))
        .await
        .map_err(|e| e.to_string())
}

/// Downloads the official nightly release binary for this machine into
/// `~/.irgatos/bin`. A newer download replaces an older managed one.
#[tauri::command]
pub async fn lightpanda_install(app: AppHandle) -> Result<LightpandaStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        download(&app)?;
        Ok(status(&app.state::<LightpandaHost>()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lightpanda_sidecar_start(
    app: AppHandle,
    port: Option<u16>,
) -> Result<SidecarStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let binary = require_binary()?;
        app.state::<LightpandaHost>().start(&binary, port)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn lightpanda_sidecar_stop(host: State<'_, LightpandaHost>) -> SidecarStatus {
    host.stop();
    host.status()
}

#[tauri::command]
pub fn lightpanda_sidecar_status(host: State<'_, LightpandaHost>) -> SidecarStatus {
    host.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(cmd: &Command, key: &str) -> Option<Option<String>> {
        cmd.get_envs().find_map(|(name, value)| {
            (name == std::ffi::OsStr::new(key))
                .then(|| value.map(|value| value.to_string_lossy().into_owned()))
        })
    }

    #[test]
    fn looks_on_path_then_homebrew_then_irgatos_then_legacy() {
        let home = Path::new("/Users/me");
        let paths = candidates(Some(home), Some(PathBuf::from("/custom/bin/lightpanda")));
        assert_eq!(
            paths,
            vec![
                PathBuf::from("/custom/bin/lightpanda"),
                PathBuf::from("/opt/homebrew/bin/lightpanda"),
                PathBuf::from("/usr/local/bin/lightpanda"),
                PathBuf::from("/Users/me/.irgatos/bin/lightpanda"),
                PathBuf::from("/Users/me/.monocode/bin/lightpanda"),
            ]
        );
        assert_eq!(candidates(None, None).len(), 2);
    }

    #[test]
    fn marks_only_irgatos_installs_as_managed() {
        let home = Path::new("/Users/me");
        assert!(is_managed(
            Path::new("/Users/me/.irgatos/bin/lightpanda"),
            Some(home)
        ));
        assert!(!is_managed(
            Path::new("/Users/me/.monocode/bin/lightpanda"),
            Some(home)
        ));
        assert!(!is_managed(
            Path::new("/opt/homebrew/bin/lightpanda"),
            Some(home)
        ));
        assert!(!is_managed(Path::new("/x/lightpanda"), None));
    }

    #[test]
    fn picks_the_official_release_asset_for_each_platform() {
        assert_eq!(
            release_asset_for("macos", "aarch64"),
            Some("lightpanda-aarch64-macos")
        );
        assert_eq!(
            release_asset_for("linux", "x86_64"),
            Some("lightpanda-x86_64-linux")
        );
        assert_eq!(
            release_asset_for("macos", "x86_64"),
            Some("lightpanda-x86_64-macos")
        );
        assert_eq!(
            release_asset_for("linux", "aarch64"),
            Some("lightpanda-aarch64-linux")
        );
        assert_eq!(release_asset_for("windows", "x86_64"), None);
        assert_eq!(
            download_url("lightpanda-aarch64-macos"),
            "https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos"
        );
    }

    #[test]
    fn parses_version_output() {
        assert_eq!(
            parse_version("1.1.0-nightly.10552+dd2cd5d7f\n").as_deref(),
            Some("1.1.0-nightly.10552+dd2cd5d7f")
        );
        assert_eq!(
            parse_version("\nlightpanda 0.2.0").as_deref(),
            Some("0.2.0")
        );
        assert_eq!(parse_version("  \n"), None);
    }

    #[test]
    fn serves_cdp_on_loopback_only() {
        assert_eq!(
            serve_args(9333),
            vec!["serve", "--host", "127.0.0.1", "--port", "9333"]
        );
        assert_eq!(cdp_url(9333), "ws://127.0.0.1:9333");
    }

    #[test]
    fn sidecar_runs_with_telemetry_disabled() {
        let cmd = sidecar_command(Path::new("/opt/homebrew/bin/lightpanda"), 9333);
        assert_eq!(
            env_of(&cmd, "LIGHTPANDA_DISABLE_TELEMETRY"),
            Some(Some("true".into()))
        );
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy()).collect();
        assert_eq!(args, ["serve", "--host", "127.0.0.1", "--port", "9333"]);
    }

    #[test]
    fn rejects_privileged_ports() {
        assert!(validate_port(Some(80)).is_err());
        assert_eq!(validate_port(Some(9333)), Ok(Some(9333)));
        assert_eq!(validate_port(None), Ok(None));
        assert!(free_port().unwrap() > 0);
    }

    #[test]
    fn exposes_the_cdp_url_only_while_the_sidecar_runs() {
        let mut cmd = Command::new("true");
        apply_cdp_env(&mut cmd, Some("ws://127.0.0.1:9333"));
        assert_eq!(
            env_of(&cmd, CDP_ENV),
            Some(Some("ws://127.0.0.1:9333".into()))
        );
        assert_eq!(
            env_of(&cmd, CDP_ENV_ALIAS),
            Some(Some("ws://127.0.0.1:9333".into()))
        );

        let mut cmd = Command::new("true");
        apply_cdp_env(&mut cmd, None);
        assert_eq!(env_of(&cmd, CDP_ENV), Some(None));
        assert_eq!(env_of(&cmd, CDP_ENV_ALIAS), None);
    }

    #[test]
    fn a_stopped_host_reports_nothing() {
        let host = LightpandaHost::default();
        assert_eq!(host.status(), SidecarStatus::default());
        assert_eq!(host.cdp_url(), None);
        host.stop();
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "irgatos-lightpanda-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        make_executable(&path).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn installs_a_download_that_runs_and_reports_progress() {
        let dir = TempDir::new();
        let body =
            b"#!/bin/sh\n[ \"$LIGHTPANDA_DISABLE_TELEMETRY\" = true ] || exit 3\necho 1.1.0-test\n";
        let mut seen = Vec::new();
        let (path, version) = install_from_reader(
            &mut &body[..],
            Some(body.len() as u64),
            dir.path(),
            &mut |received, total| seen.push((received, total)),
        )
        .unwrap();
        assert_eq!(path, dir.path().join("lightpanda"));
        assert_eq!(version, "1.1.0-test");
        assert_eq!(
            seen.last(),
            Some(&(body.len() as u64, Some(body.len() as u64)))
        );
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(leftovers, vec![std::ffi::OsString::from("lightpanda")]);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_old_binary_when_the_download_is_broken() {
        let dir = TempDir::new();
        let old = script(dir.path(), "lightpanda", "echo 1.0.0");
        let body = b"#!/bin/sh\nexit 1\n";
        let error =
            install_from_reader(&mut &body[..], None, dir.path(), &mut |_, _| {}).unwrap_err();
        assert!(error.contains("does not run"), "{error}");
        assert_eq!(read_version(&old).unwrap(), "1.0.0");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);

        let error =
            install_from_reader(&mut &body[..], Some(999), dir.path(), &mut |_, _| {}).unwrap_err();
        assert!(error.contains("stopped early"), "{error}");
        let error = install_from_reader(
            &mut &body[..],
            Some(MAX_DOWNLOAD + 1),
            dir.path(),
            &mut |_, _| {},
        )
        .unwrap_err();
        assert!(error.contains("unexpectedly large"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn reports_why_the_sidecar_exited() {
        let dir = TempDir::new();
        let binary = script(dir.path(), "lightpanda", "echo \"port taken\" >&2; exit 7");
        let host = LightpandaHost::default();
        let port = free_port().unwrap();
        let error = host.start(&binary, Some(port)).err().unwrap();
        assert!(error.contains("port taken"), "{error}");
        assert!(!host.status().running);
    }

    #[cfg(unix)]
    #[test]
    fn starts_reuses_and_stops_a_listening_sidecar() {
        if Command::new("python3").arg("--version").output().is_err() {
            return;
        }
        let dir = TempDir::new();
        // Stands in for `lightpanda serve --host H --port P`.
        let binary = script(
            dir.path(),
            "lightpanda",
            "[ \"$LIGHTPANDA_DISABLE_TELEMETRY\" = true ] || exit 3\n\
             exec python3 -c 'import socket,sys,time\n\
s=socket.socket(); s.bind((sys.argv[1], int(sys.argv[2]))); s.listen()\n\
time.sleep(60)' \"$3\" \"$5\"",
        );
        let host = LightpandaHost::default();
        let started = host.start(&binary, None).unwrap();
        assert!(started.running);
        let port = started.port.unwrap();
        assert_eq!(started.cdp_url, Some(format!("ws://127.0.0.1:{port}")));
        assert_eq!(host.cdp_url(), started.cdp_url);
        assert_eq!(host.start(&binary, None).unwrap().pid, started.pid);
        host.stop();
        assert!(!host.status().running);
        assert_eq!(host.cdp_url(), None);
    }

    /// `LIGHTPANDA_TEST_BINARY=/path/to/lightpanda cargo test -- --ignored`
    #[test]
    #[ignore]
    fn drives_a_real_lightpanda() {
        let binary = PathBuf::from(std::env::var("LIGHTPANDA_TEST_BINARY").unwrap());
        assert!(read_version(&binary).is_ok());
        let host = LightpandaHost::default();
        let started = host.start(&binary, None).unwrap();
        assert!(started.running);
        host.stop();
    }

    #[test]
    #[ignore]
    fn downloads_the_official_release() {
        let dir = TempDir::new();
        let (path, version) = download_to(dir.path(), &mut |_, _| {}).unwrap();
        assert!(path.ends_with("lightpanda"));
        assert!(!version.is_empty());
    }
}
