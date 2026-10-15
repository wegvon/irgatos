//! "Check for Updates" that works without a Tauri updater signing key or an
//! Apple Developer ID.
//!
//! Two feeds, both pinned to Irgatos's own repository:
//! - GitHub Releases: the latest release whose version (or, at the same
//!   version, whose commit) is ahead of this build. macOS installs it by
//!   swapping the `.app` bundle in place and relaunching.
//! - The source checkout this binary was built from: commits on its upstream
//!   branch (or local commits newer than the build). macOS installs those by
//!   fast-forwarding, rebuilding, and swapping the bundle the same way.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// Checked after any configured override.
pub const DEFAULT_REPOS: [&str; 1] = ["wegvon/irgatos"];
/// These owners ship a different app under the same asset names.
/// Never offer their releases, whatever a remote or override says.
const BLOCKED_OWNERS: [&str; 2] = ["cretou", "hardbeat920"];
const REPO_ENV: &str = "IRGATOS_UPDATE_REPO";
const API_BASE: &str = "https://api.github.com";
const USER_AGENT: &str = "Irgatos-Updater";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const PROGRESS_EVENT: &str = "self-update-progress";
const BUILD_COMMIT: Option<&str> = option_env!("IRGATOS_BUILD_COMMIT");
const BUILD_BRANCH: Option<&str> = option_env!("IRGATOS_BUILD_BRANCH");
const BUILD_MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");
const FETCH_TIMEOUT: Duration = Duration::from_secs(45);
const GIT_TIMEOUT: Duration = Duration::from_secs(20);
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const NPM_CI_TIMEOUT: Duration = Duration::from_secs(20 * 60);
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const BUILD_TIMEOUT: Duration = Duration::from_secs(60 * 60);

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub version: String,
    pub commit: Option<String>,
    pub branch: Option<String>,
    pub source_dir: Option<String>,
    pub install_path: Option<String>,
    pub platform: &'static str,
    pub arch: &'static str,
    pub default_repos: Vec<String>,
    /// Whether this platform can swap its own bundle (macOS only for now).
    pub can_self_install: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetKind {
    AppArchive,
    Dmg,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub kind: AssetKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub repo: String,
    pub tag: String,
    pub version: String,
    pub name: Option<String>,
    pub notes: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub commit: Option<String>,
    pub asset: Option<ReleaseAsset>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub dir: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub remote_slug: Option<String>,
    pub head: String,
    /// What an update would build: the upstream tip when it fast-forwards,
    /// otherwise the local HEAD.
    pub target: String,
    /// Commits in `target` that the running build does not have.
    pub new_commits: u32,
    pub behind: u32,
    pub ahead: u32,
    pub diverged: bool,
    pub dirty: bool,
    pub version: Option<String>,
    pub fetch_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    pub repo: String,
    pub branch: String,
    pub ahead_by: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub build: BuildInfo,
    pub repos: Vec<String>,
    pub release: Option<ReleaseInfo>,
    pub release_newer: bool,
    pub release_error: Option<String>,
    pub source: Option<SourceInfo>,
    pub source_newer: bool,
    pub source_error: Option<String>,
    /// Commits on the build's branch on GitHub when there is no local checkout.
    pub remote_branch: Option<RemoteBranch>,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    message: String,
    progress: Option<f64>,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn emit(app: &AppHandle, stage: &'static str, message: impl Into<String>, progress: Option<f64>) {
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            stage,
            message: message.into(),
            progress,
        },
    );
}

// ---------------------------------------------------------------------------
// Versions

#[derive(Debug, Clone, PartialEq, Eq)]
struct Version {
    core: (u64, u64, u64),
    pre: Option<String>,
}

fn parse_version(text: &str) -> Option<Version> {
    let text = text.trim().trim_start_matches(['v', 'V']);
    let text = text.split('+').next()?;
    let (core, pre) = match text.split_once('-') {
        Some((core, pre)) if !pre.is_empty() => (core, Some(pre.to_string())),
        Some(_) => return None,
        None => (text, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().map_or(Some(0), |part| part.parse().ok())?;
    let patch = parts.next().map_or(Some(0), |part| part.parse().ok())?;
    if parts.next().is_some() {
        return None;
    }
    Some(Version {
        core: (major, minor, patch),
        pre,
    })
}

fn compare_prerelease(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let mut left = left.split('.');
    let mut right = right.split('.');
    loop {
        match (left.next(), right.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(a), Some(b)) => {
                let order = match (a.parse::<u64>(), b.parse::<u64>()) {
                    (Ok(a), Ok(b)) => a.cmp(&b),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => a.cmp(b),
                };
                if order != Ordering::Equal {
                    return order;
                }
            }
        }
    }
}

/// Semantic-version order; `None` when either side is not a version.
fn compare_versions(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    use std::cmp::Ordering;
    let (left, right) = (parse_version(left)?, parse_version(right)?);
    Some(
        left.core
            .cmp(&right.core)
            .then_with(|| match (&left.pre, &right.pre) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(a), Some(b)) => compare_prerelease(a, b),
            }),
    )
}

// ---------------------------------------------------------------------------
// Repositories

fn valid_slug_part(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `owner/repo` from a slug, an https/ssh GitHub URL, or an scp-style remote.
fn normalize_slug(input: &str) -> Option<String> {
    let text = input.trim().trim_end_matches('/');
    let rest = if let Some(rest) = text.strip_prefix("git@github.com:") {
        rest
    } else if let Some(index) = text.find("github.com/") {
        &text[index + "github.com/".len()..]
    } else if text.contains(':') || text.contains('@') {
        return None;
    } else {
        text
    };
    let mut parts = rest.split('/');
    let owner = parts.next()?;
    let repo = parts.next()?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    // A bare slug must be exactly two segments; URLs may carry more (`/tree/…`).
    if rest == text && parts.next().is_some() {
        return None;
    }
    (valid_slug_part(owner) && valid_slug_part(repo)).then(|| format!("{owner}/{repo}"))
}

fn is_blocked(slug: &str) -> bool {
    let owner = slug.split('/').next().unwrap_or_default();
    BLOCKED_OWNERS
        .iter()
        .any(|blocked| owner.eq_ignore_ascii_case(blocked))
}

/// Override, then `IRGATOS_UPDATE_REPO`, then the defaults, then whatever the
/// checkout's remote points at — deduplicated, with the blocked upstream gone.
fn candidate_repos(
    configured: Option<&str>,
    env: Option<&str>,
    remote: Option<&str>,
) -> Vec<String> {
    let mut repos: Vec<String> = Vec::new();
    let defaults = DEFAULT_REPOS.iter().map(|repo| Some(*repo));
    for slug in [configured, env]
        .into_iter()
        .chain(defaults)
        .chain([remote])
        .flatten()
        .filter_map(normalize_slug)
    {
        if is_blocked(&slug) || repos.iter().any(|repo| repo.eq_ignore_ascii_case(&slug)) {
            continue;
        }
        repos.push(slug);
    }
    repos
}

/// A download URL must belong to the release the check found, so the
/// frontend cannot be talked into installing an arbitrary bundle.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_release_download(url: &str, repo: &str) -> bool {
    let Some(repo) = normalize_slug(repo) else {
        return false;
    };
    if is_blocked(&repo) {
        return false;
    }
    let prefix = format!("https://github.com/{repo}/releases/download/");
    url.len() > prefix.len() && url[..prefix.len()].eq_ignore_ascii_case(&prefix)
}

// ---------------------------------------------------------------------------
// GitHub

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(60))
        .user_agent(USER_AGENT)
        .build()
}

/// Optional: unauthenticated calls work for public repos, a token only lifts
/// the 60-requests-per-hour limit and opens private ones.
fn github_token() -> Option<String> {
    for key in ["IRGATOS_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"] {
        if let Some(value) = std::env::var(key).ok().filter(|v| !v.trim().is_empty()) {
            return Some(value.trim().to_string());
        }
    }
    let gh = crate::harness::resolve_gui_binary("gh")?;
    let mut cmd = Command::new(gh);
    cmd.args(["auth", "token", "--hostname", "github.com"])
        .env("GH_PROMPT_DISABLED", "1");
    crate::harness::apply_gui_env(&mut cmd);
    let output = output_with_timeout(cmd, Duration::from_secs(5)).ok()?;
    if !output.success {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!token.is_empty()).then_some(token)
}

fn api_get(agent: &ureq::Agent, token: Option<&str>, path: &str) -> Result<Option<Value>, String> {
    let mut request = agent
        .get(&format!("{API_BASE}{path}"))
        .set("Accept", "application/vnd.github+json")
        .set("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = token {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    match request.call() {
        Ok(response) => {
            let text = response
                .into_string()
                .map_err(|error| format!("GitHub response unreadable: {error}"))?;
            serde_json::from_str(&text)
                .map(Some)
                .map_err(|error| format!("GitHub returned invalid JSON: {error}"))
        }
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(ureq::Error::Status(status @ (403 | 429), response)) => {
            let reset = response
                .header("x-ratelimit-remaining")
                .filter(|remaining| *remaining == "0")
                .map(|_| " (rate limit reached; sign in with `gh auth login` to raise it)")
                .unwrap_or_default();
            Err(format!("GitHub refused the request ({status}){reset}"))
        }
        Err(ureq::Error::Status(status, _)) => Err(format!("GitHub returned HTTP {status}")),
        Err(error) => Err(format!("Couldn't reach GitHub: {error}")),
    }
}

fn is_commit_sha(text: &str) -> bool {
    text.len() == 40 && text.chars().all(|c| c.is_ascii_hexdigit())
}

/// The release workflow writes `Commit: <sha>` into the notes; a release
/// targeting a SHA directly carries it in `target_commitish`.
fn release_commit(body: &Value) -> Option<String> {
    let commitish = body.get("target_commitish").and_then(Value::as_str);
    if let Some(sha) = commitish.filter(|sha| is_commit_sha(sha)) {
        return Some(sha.to_ascii_lowercase());
    }
    body.get("body")
        .and_then(Value::as_str)?
        .lines()
        .filter_map(|line| {
            let line = line.trim().trim_start_matches(['-', '*', ' ']);
            let rest = line.strip_prefix("Commit:")?;
            Some(
                rest.trim_start_matches('*')
                    .trim()
                    .trim_matches('`')
                    .to_string(),
            )
        })
        .find(|sha| is_commit_sha(sha))
        .map(|sha| sha.to_ascii_lowercase())
}

fn arch_tokens(arch: &str) -> (&'static [&'static str], &'static [&'static str]) {
    if arch == "aarch64" {
        (&["aarch64", "arm64"], &["x64", "x86_64", "intel"])
    } else {
        (&["x64", "x86_64", "intel"], &["aarch64", "arm64"])
    }
}

/// Prefer the updater archive (no disk image to mount), then the DMG. A
/// `universal` build fits either machine; an unsuffixed name is the legacy
/// Apple Silicon naming (`Irgatos.app.tar.gz`).
fn select_mac_asset(assets: &[ReleaseAsset], arch: &str) -> Option<ReleaseAsset> {
    let (mine, others) = arch_tokens(arch);
    for kind in [AssetKind::AppArchive, AssetKind::Dmg] {
        let of_kind: Vec<&ReleaseAsset> = assets.iter().filter(|a| a.kind == kind).collect();
        let lower = |asset: &&ReleaseAsset| asset.name.to_ascii_lowercase();
        if let Some(asset) = of_kind
            .iter()
            .find(|a| mine.iter().any(|token| lower(a).contains(token)))
            .or_else(|| of_kind.iter().find(|a| lower(a).contains("universal")))
            .or_else(|| {
                (arch == "aarch64")
                    .then(|| {
                        of_kind
                            .iter()
                            .find(|a| !others.iter().any(|token| lower(a).contains(token)))
                    })
                    .flatten()
            })
        {
            return Some((*asset).clone());
        }
    }
    None
}

fn release_assets(body: &Value) -> Vec<ReleaseAsset> {
    body.get("assets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|asset| {
            let name = asset.get("name")?.as_str()?.to_string();
            let url = asset.get("browser_download_url")?.as_str()?.to_string();
            let size = asset.get("size").and_then(Value::as_u64).unwrap_or(0);
            let lower = name.to_ascii_lowercase();
            let kind = if lower.ends_with(".app.tar.gz") {
                AssetKind::AppArchive
            } else if lower.ends_with(".dmg") {
                AssetKind::Dmg
            } else {
                return None;
            };
            Some(ReleaseAsset {
                name,
                url,
                size,
                kind,
            })
        })
        .collect()
}

fn parse_release(queried: &str, body: &Value, arch: &str) -> Option<ReleaseInfo> {
    if body.get("draft").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let tag = body.get("tag_name")?.as_str()?.trim().to_string();
    let version = tag.trim_start_matches(['v', 'V']).to_string();
    parse_version(&version)?;
    let html_url = body
        .get("html_url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    // A renamed repo answers under its new name; report that one.
    let repo = normalize_slug(&html_url)
        .filter(|slug| !is_blocked(slug))
        .unwrap_or_else(|| queried.to_string());
    let text = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    Some(ReleaseInfo {
        repo,
        version,
        name: text("name"),
        notes: text("body"),
        published_at: text("published_at"),
        commit: release_commit(body),
        asset: select_mac_asset(&release_assets(body), arch),
        html_url,
        tag,
    })
}

fn latest_release(
    agent: &ureq::Agent,
    token: Option<&str>,
    repo: &str,
    arch: &str,
) -> Result<Option<ReleaseInfo>, String> {
    let Some(body) = api_get(agent, token, &format!("/repos/{repo}/releases/latest"))? else {
        return Ok(None);
    };
    Ok(parse_release(repo, &body, arch))
}

/// `ahead` when `head` contains `base` plus more commits.
fn compare_commits(
    agent: &ureq::Agent,
    token: Option<&str>,
    repo: &str,
    base: &str,
    head: &str,
) -> Result<Option<(String, u32)>, String> {
    let Some(body) = api_get(
        agent,
        token,
        &format!("/repos/{repo}/compare/{base}...{head}"),
    )?
    else {
        return Ok(None);
    };
    let status = body
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let ahead = body.get("ahead_by").and_then(Value::as_u64).unwrap_or(0);
    Ok(Some((status, u32::try_from(ahead).unwrap_or(u32::MAX))))
}

fn release_is_newer(
    release: &mut ReleaseInfo,
    current_version: &str,
    build_commit: Option<&str>,
    agent: &ureq::Agent,
    token: Option<&str>,
) -> bool {
    use std::cmp::Ordering;
    match compare_versions(&release.version, current_version) {
        Some(Ordering::Greater) => true,
        Some(Ordering::Equal) => {
            let Some(build) = build_commit else {
                return false;
            };
            if release.commit.is_none() {
                release.commit = api_get(
                    agent,
                    token,
                    &format!("/repos/{}/commits/{}", release.repo, release.tag),
                )
                .ok()
                .flatten()
                .and_then(|body| body.get("sha")?.as_str().map(str::to_string));
            }
            let Some(commit) = release.commit.as_deref() else {
                return false;
            };
            if commit.eq_ignore_ascii_case(build) {
                return false;
            }
            matches!(
                compare_commits(agent, token, &release.repo, build, commit),
                Ok(Some((status, _))) if status == "ahead"
            )
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Processes

struct Captured {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn spawn_reader<R: Read + Send + 'static>(mut pipe: R) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = pipe.read_to_end(&mut buffer);
        buffer
    })
}

fn output_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Captured, String> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Failed to run {program}: {error}"))?;
    let stdout = child.stdout.take().map(spawn_reader);
    let stderr = child.stderr.take().map(spawn_reader);
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program} timed out"));
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => return Err(format!("Failed to wait for {program}: {error}")),
        }
    };
    let join = |handle: Option<thread::JoinHandle<Vec<u8>>>| {
        handle.and_then(|h| h.join().ok()).unwrap_or_default()
    };
    Ok(Captured {
        success: status.success(),
        stdout: join(stdout),
        stderr: join(stderr),
    })
}

/// Runs `cmd`, handing each output line to `on_line`, and returns the last
/// lines as the error when it fails.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn run_streaming(
    mut cmd: Command,
    timeout: Duration,
    mut on_line: impl FnMut(&str),
) -> Result<(), String> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Failed to run {program}: {error}"))?;
    let (tx, rx) = mpsc::channel::<String>();
    let mut readers = Vec::new();
    for pipe in [
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let tx = tx.clone();
        readers.push(thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        }));
    }
    drop(tx);
    let deadline = Instant::now() + timeout;
    let mut tail: Vec<String> = Vec::new();
    let mut remember = |line: String, on_line: &mut dyn FnMut(&str)| {
        let line = line.trim_end().to_string();
        if line.trim().is_empty() {
            return;
        }
        on_line(&line);
        tail.push(line);
        if tail.len() > 25 {
            tail.remove(0);
        }
    };
    let status = loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(line) => remember(line, &mut on_line),
            Err(mpsc::RecvTimeoutError::Disconnected) => break child.wait(),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{program} timed out"));
        }
    };
    for reader in readers {
        let _ = reader.join();
    }
    while let Ok(line) = rx.try_recv() {
        remember(line, &mut on_line);
    }
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("{program} failed ({status}):\n{}", tail.join("\n"))),
        Err(error) => Err(format!("Failed to wait for {program}: {error}")),
    }
}

fn git_program() -> PathBuf {
    crate::harness::resolve_gui_binary("git").unwrap_or_else(|| PathBuf::from("git"))
}

fn git_command(dir: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new(git_program());
    cmd.arg("-C").arg(dir).args(args);
    crate::harness::apply_gui_env(&mut cmd);
    // Never stop for credentials: a background check has nobody to answer.
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C");
    cmd
}

fn git_with_timeout(dir: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let output = output_with_timeout(git_command(dir, args), timeout)?;
    if output.success {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("git {} failed", args.join(" "))
    } else {
        stderr
    })
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    git_with_timeout(dir, args, GIT_TIMEOUT)
}

// ---------------------------------------------------------------------------
// Source checkout

fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn is_irgatos_checkout(dir: &Path) -> bool {
    dir.join(".git").exists() && dir.join("src-tauri").join("tauri.conf.json").is_file()
}

/// The configured checkout, else the one this binary was compiled from when
/// it still exists on this machine (true for local builds, never for CI).
fn resolve_source_dir(configured: Option<&str>) -> Option<PathBuf> {
    let configured = configured
        .filter(|path| !path.trim().is_empty())
        .map(expand_home);
    let built_from = Path::new(BUILD_MANIFEST_DIR)
        .parent()
        .map(Path::to_path_buf);
    configured
        .into_iter()
        .chain(built_from)
        .find(|dir| is_irgatos_checkout(dir))
}

fn count(text: &str) -> u32 {
    text.trim().parse().unwrap_or(0)
}

fn package_version(json: &str) -> Option<String> {
    let value: Value = serde_json::from_str(json).ok()?;
    let version = value.get("version")?.as_str()?.trim();
    (!version.is_empty()).then(|| version.to_string())
}

fn source_state(dir: &Path, build_commit: Option<&str>, fetch: bool) -> Result<SourceInfo, String> {
    let branch = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if branch == "HEAD" {
        return Err("The source checkout is on a detached HEAD".into());
    }
    let remote = git(dir, &["config", &format!("branch.{branch}.remote")])
        .ok()
        .filter(|remote| !remote.is_empty() && remote != ".")
        .unwrap_or_else(|| "origin".to_string());
    let remote_branch = git(dir, &["config", &format!("branch.{branch}.merge")])
        .ok()
        .and_then(|merge| merge.strip_prefix("refs/heads/").map(str::to_string))
        .unwrap_or_else(|| branch.clone());
    let fetch_error = if fetch {
        git_with_timeout(
            dir,
            &["fetch", "--quiet", "--no-tags", &remote, &remote_branch],
            FETCH_TIMEOUT,
        )
        .err()
    } else {
        None
    };
    let upstream_ref = format!("refs/remotes/{remote}/{remote_branch}");
    let upstream = git(dir, &["rev-parse", "--verify", "--quiet", &upstream_ref])
        .ok()
        .map(|_| format!("{remote}/{remote_branch}"));
    let head = git(dir, &["rev-parse", "HEAD"])?;
    let (ahead, behind) = match &upstream {
        Some(upstream) => {
            let counts = git(
                dir,
                &[
                    "rev-list",
                    "--left-right",
                    "--count",
                    &format!("HEAD...{upstream}"),
                ],
            )?;
            let mut parts = counts.split_whitespace();
            (
                parts.next().map(count).unwrap_or(0),
                parts.next().map(count).unwrap_or(0),
            )
        }
        None => (0, 0),
    };
    let diverged = ahead > 0 && behind > 0;
    let target = match (&upstream, behind > 0 && ahead == 0) {
        (Some(upstream), true) => git(dir, &["rev-parse", upstream])?,
        _ => head.clone(),
    };
    let known_build = build_commit
        .filter(|commit| git(dir, &["cat-file", "-e", &format!("{commit}^{{commit}}")]).is_ok());
    let new_commits = match known_build {
        Some(build) => count(&git(
            dir,
            &["rev-list", "--count", &format!("{build}..{target}")],
        )?),
        None => behind,
    };
    let dirty = !git(dir, &["status", "--porcelain", "--untracked-files=no"])?.is_empty();
    let version = git(dir, &["show", &format!("{target}:package.json")])
        .ok()
        .and_then(|json| package_version(&json));
    let remote_slug = git(dir, &["remote", "get-url", &remote])
        .ok()
        .and_then(|url| normalize_slug(&url));
    Ok(SourceInfo {
        dir: dir.to_string_lossy().into_owned(),
        branch,
        upstream,
        remote_slug,
        head,
        target,
        new_commits,
        behind,
        ahead,
        diverged,
        dirty,
        version,
        fetch_error,
    })
}

// ---------------------------------------------------------------------------
// Install (macOS)

fn running_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .map(Path::to_path_buf)
}

/// Update in place when the app already lives in an Applications folder;
/// anything else (a DMG, a translocated download, a dev build) installs into
/// `/Applications` so the next launch from the Dock gets the new version.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn install_target(running: Option<&Path>, product: &str, home: Option<&Path>) -> PathBuf {
    if let Some(bundle) = running {
        let in_applications = bundle.parent().is_some_and(|parent| {
            parent == Path::new("/Applications")
                || home.is_some_and(|home| parent == home.join("Applications"))
        });
        if in_applications {
            return bundle.to_path_buf();
        }
    }
    PathBuf::from("/Applications").join(format!("{product}.app"))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn applescript_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', r"\\").replace('"', "\\\""))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn swap_script(source: &Path, target: &Path) -> String {
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Irgatos.app".into());
    let parent = target.parent().unwrap_or(Path::new("/Applications"));
    let pid = std::process::id();
    let staged = parent.join(format!(".{name}.incoming-{pid}"));
    let backup = parent.join(format!(".{name}.previous-{pid}"));
    let [source, target, staged, backup] = [source, target, staged.as_path(), backup.as_path()]
        .map(|p| shell_quote(&p.to_string_lossy()));
    format!(
        "set -e; rm -rf {staged} {backup}; /usr/bin/ditto {source} {staged}; \
         if [ -e {target} ]; then mv {target} {backup}; fi; \
         if ! mv {staged} {target}; then [ -e {backup} ] && mv {backup} {target}; exit 1; fi; \
         rm -rf {backup}"
    )
}

/// Copy `source` next to `target` first so the final swap is two renames on
/// one volume; a running app keeps executing from the renamed-away bundle.
#[cfg(target_os = "macos")]
fn swap_bundle(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let script = swap_script(source, target);
    let direct = Command::new("/bin/sh").arg("-c").arg(&script).output();
    match direct {
        Ok(output) if output.status.success() => return Ok(()),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("Permission denied") && !stderr.contains("Operation not permitted")
            {
                return Err(format!(
                    "Couldn't replace {}: {}",
                    target.display(),
                    stderr.trim()
                ));
            }
        }
        Err(error) => return Err(format!("Couldn't run the installer: {error}")),
    }
    // /Applications is admin-writable; a standard account needs a password.
    let apple = format!(
        "do shell script {} with administrator privileges",
        applescript_string(&script)
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(apple)
        .output()
        .map_err(|error| format!("Couldn't ask for administrator rights: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Couldn't replace {}: {}",
            target.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

#[cfg(target_os = "macos")]
fn bundle_identifier(bundle: &Path) -> Option<String> {
    let plist = bundle.join("Contents").join("Info.plist");
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier"])
        .arg(plist)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn certificate_requirement(bundle: &Path) -> Result<Option<String>, String> {
    let output = Command::new("/usr/bin/codesign")
        .args(["--display", "--verbose=2", "-r-"])
        .arg(bundle)
        .output()
        .map_err(|e| format!("Couldn't inspect the installed signature: {e}"))?;
    if !output.status.success() {
        return Err("Couldn't inspect the installed signing identity; update cancelled".into());
    }
    let details = String::from_utf8_lossy(&output.stderr);
    if details.lines().any(|line| line == "Signature=adhoc") {
        return Ok(None);
    }
    let requirements = String::from_utf8_lossy(&output.stdout);
    requirements
        .lines()
        .find_map(|line| line.trim_start_matches("# ").strip_prefix("designated => "))
        .filter(|requirement| !requirement.is_empty())
        .map(|requirement| Some(requirement.to_owned()))
        .ok_or_else(|| "The installed app has no readable signing requirement".into())
}

/// Keep a certificate-signed installation's identity; only legacy ad-hoc
/// installations may use the ad-hoc repair path.
#[cfg(target_os = "macos")]
fn prepare_bundle(app: &AppHandle, bundle: &Path) -> Result<(), String> {
    prepare_bundle_for_update(
        &app.config().identifier,
        bundle,
        running_bundle().as_deref(),
    )
}

#[cfg(target_os = "macos")]
fn prepare_bundle_for_update(
    expected: &str,
    bundle: &Path,
    current: Option<&Path>,
) -> Result<(), String> {
    match bundle_identifier(bundle) {
        Some(found) if found == expected => {}
        Some(found) => {
            return Err(format!(
                "The update is {found}, not {expected}; refusing to install it"
            ))
        }
        None => return Err(format!("{} is not an app bundle", bundle.display())),
    }
    let _ = Command::new("/usr/bin/xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(bundle)
        .status();
    let requirement = current.map(certificate_requirement).transpose()?.flatten();
    let mut verify = Command::new("/usr/bin/codesign");
    verify.args(["--verify", "--deep", "--strict"]);
    if let Some(requirement) = &requirement {
        verify.args(["--test-requirement", &format!("={requirement}")]);
    }
    let verified = verify
        .arg(bundle)
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    if !verified {
        if requirement.is_some() {
            return Err("The update's signature is invalid or uses a different signing identity. Rebuild with this installation's signing certificate; the installed app was kept.".into());
        }
        let signed = Command::new("/usr/bin/codesign")
            .args(["--force", "--deep", "--sign", "-"])
            .arg(bundle)
            .status()
            .is_ok_and(|status| status.success());
        if !signed {
            return Err("The update's code signature is broken and re-signing failed".into());
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn find_app(dir: &Path) -> Option<PathBuf> {
    let entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    let is_app =
        |path: &&PathBuf| path.is_dir() && path.extension().is_some_and(|ext| ext == "app");
    entries.iter().find(is_app).cloned().or_else(|| {
        entries
            .iter()
            .filter(|path| path.is_dir())
            .find_map(|path| find_app(path))
    })
}

#[cfg(target_os = "macos")]
fn download(app: &AppHandle, asset: &ReleaseAsset, dest: &Path) -> Result<(), String> {
    use std::io::Write;
    let response = agent()
        .get(&asset.url)
        .call()
        .map_err(|error| format!("Download failed: {error}"))?;
    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .or((asset.size > 0).then_some(asset.size));
    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(dest)
        .map_err(|error| format!("Couldn't create {}: {error}", dest.display()))?;
    let mut buffer = vec![0u8; 64 * 1024];
    let mut written: u64 = 0;
    let mut last_percent = -1.0;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Download interrupted: {error}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| format!("Couldn't write the download: {error}"))?;
        written += read as u64;
        if let Some(total) = total.filter(|total| *total > 0) {
            let percent = ((written as f64 / total as f64) * 100.0).min(100.0).floor();
            if percent > last_percent {
                last_percent = percent;
                emit(
                    app,
                    "downloading",
                    format!("Downloading {}", asset.name),
                    Some(percent),
                );
            }
        }
    }
    if let Some(total) = total.filter(|total| *total > 0) {
        if written != total {
            return Err(format!(
                "Download was cut short ({written} of {total} bytes)"
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn unpack(asset: &ReleaseAsset, file: &Path, work: &Path) -> Result<PathBuf, String> {
    let extracted = work.join("extracted");
    std::fs::create_dir_all(&extracted).map_err(|error| error.to_string())?;
    match asset.kind {
        AssetKind::AppArchive => {
            let status = Command::new("/usr/bin/tar")
                .arg("-xzf")
                .arg(file)
                .arg("-C")
                .arg(&extracted)
                .status()
                .map_err(|error| format!("Couldn't unpack the update: {error}"))?;
            if !status.success() {
                return Err("Couldn't unpack the update archive".into());
            }
            find_app(&extracted).ok_or_else(|| "The update archive has no .app inside".into())
        }
        AssetKind::Dmg => {
            let mount = work.join("mount");
            std::fs::create_dir_all(&mount).map_err(|error| error.to_string())?;
            let attached = Command::new("/usr/bin/hdiutil")
                .args([
                    "attach",
                    "-nobrowse",
                    "-readonly",
                    "-noautoopen",
                    "-mountpoint",
                ])
                .arg(&mount)
                .arg(file)
                .output()
                .map_err(|error| format!("Couldn't open the disk image: {error}"))?;
            if !attached.status.success() {
                return Err(format!(
                    "Couldn't open the disk image: {}",
                    String::from_utf8_lossy(&attached.stderr).trim()
                ));
            }
            let copied = find_app(&mount)
                .ok_or_else(|| "The disk image has no .app inside".to_string())
                .and_then(|app| {
                    let dest = extracted.join(app.file_name().unwrap_or_default());
                    let status = Command::new("/usr/bin/ditto")
                        .arg(&app)
                        .arg(&dest)
                        .status()
                        .map_err(|error| error.to_string())?;
                    if status.success() {
                        Ok(dest)
                    } else {
                        Err("Couldn't copy the app out of the disk image".into())
                    }
                });
            let _ = Command::new("/usr/bin/hdiutil")
                .args(["detach", "-force"])
                .arg(&mount)
                .status();
            copied
        }
    }
}

#[cfg(target_os = "macos")]
fn work_dir() -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!("irgatos-update-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Couldn't create a work folder: {error}"))?;
    Ok(dir)
}

#[cfg(target_os = "macos")]
fn product_name(app: &AppHandle) -> String {
    app.config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Irgatos".into())
}

#[cfg(target_os = "macos")]
fn install_bundle(app: &AppHandle, bundle: &Path) -> Result<PathBuf, String> {
    prepare_bundle(app, bundle)?;
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let target = install_target(
        running_bundle().as_deref(),
        &product_name(app),
        home.as_deref(),
    );
    emit(
        app,
        "installing",
        format!("Installing into {}", target.display()),
        None,
    );
    swap_bundle(bundle, &target)?;
    // The copy may have picked quarantine back up from the staging folder.
    let _ = Command::new("/usr/bin/xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(&target)
        .status();
    Ok(target)
}

#[cfg(target_os = "macos")]
fn install_release(app: &AppHandle, repo: &str, asset: &ReleaseAsset) -> Result<PathBuf, String> {
    if !is_release_download(&asset.url, repo) {
        return Err(format!(
            "{} is not a release download from {repo}",
            asset.url
        ));
    }
    let work = work_dir()?;
    let result = (|| {
        let file = work.join(&asset.name);
        emit(
            app,
            "downloading",
            format!("Downloading {}", asset.name),
            Some(0.0),
        );
        download(app, asset, &file)?;
        emit(app, "installing", "Unpacking the update", None);
        let bundle = unpack(asset, &file, &work)?;
        install_bundle(app, &bundle)
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}

#[cfg(target_os = "macos")]
fn built_bundle(dir: &Path, product: &str) -> Option<PathBuf> {
    let bundle = dir
        .join("target")
        .join("release")
        .join("bundle")
        .join("macos")
        .join(format!("{product}.app"));
    bundle.is_dir().then_some(bundle)
}

#[cfg(target_os = "macos")]
fn source_build_config(identity: Option<&str>) -> Result<String, String> {
    let mut config = serde_json::json!({"bundle":{"createUpdaterArtifacts":false}});
    if let Some(identity) = identity {
        let identity = identity.trim();
        if identity.is_empty() || identity == "-" {
            return Err("Configure a persistent code-signing identity; ad-hoc signing would reset macOS permissions".into());
        }
        config["bundle"]["macOS"] = serde_json::json!({"signingIdentity":identity});
    }
    Ok(config.to_string())
}

#[cfg(target_os = "macos")]
fn local_signing_identity() -> Result<Option<String>, String> {
    if let Ok(identity) = std::env::var("APPLE_SIGNING_IDENTITY") {
        return Ok(Some(identity));
    }
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(None);
    };
    match std::fs::read_to_string(PathBuf::from(home).join(".irgatos/macos-signing-identity")) {
        Ok(identity) => Ok(Some(identity)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Couldn't read the local signing identity: {error}")),
    }
}

#[cfg(target_os = "macos")]
fn install_source(app: &AppHandle, configured: Option<&str>) -> Result<PathBuf, String> {
    let identity = local_signing_identity()?;
    let build_config = source_build_config(identity.as_deref())?;
    if identity.is_none()
        && running_bundle()
            .map(|bundle| certificate_requirement(&bundle))
            .transpose()?
            .flatten()
            .is_some()
    {
        return Err("Set APPLE_SIGNING_IDENTITY to this installation's signing certificate before rebuilding".into());
    }
    let dir = resolve_source_dir(configured)
        .ok_or_else(|| "No Irgatos source checkout found on this Mac".to_string())?;
    emit(app, "pulling", format!("Fetching {}", dir.display()), None);
    let state = source_state(&dir, BUILD_COMMIT, true)?;
    if let Some(error) = &state.fetch_error {
        emit(
            app,
            "pulling",
            format!("Fetch failed, building local commits: {error}"),
            None,
        );
    }
    if state.diverged {
        return Err(format!(
            "{} has {} local commit(s) that {} doesn't, and is {} behind it. Merge or rebase it in a terminal first.",
            state.branch,
            state.ahead,
            state.upstream.as_deref().unwrap_or("its upstream"),
            state.behind
        ));
    }
    if let (true, Some(upstream)) = (state.behind > 0, state.upstream.as_deref()) {
        emit(
            app,
            "pulling",
            format!("Fast-forwarding {} to {upstream}", state.branch),
            None,
        );
        // --autostash keeps uncommitted edits (and Cargo's lockfile touch-ups).
        git_with_timeout(
            &dir,
            &["merge", "--ff-only", "--autostash", upstream],
            Duration::from_secs(120),
        )
        .map_err(|error| format!("Couldn't fast-forward {}: {error}", state.branch))?;
    }
    let head = git(&dir, &["rev-parse", "HEAD"])?;
    let lock_changed = head != state.head
        && git(
            &dir,
            &[
                "diff",
                "--name-only",
                &state.head,
                &head,
                "--",
                "package-lock.json",
            ],
        )
        .is_ok_and(|changed| !changed.is_empty());
    let npm = crate::harness::resolve_gui_binary("npm")
        .ok_or_else(|| "npm isn't installed or isn't on your login shell's PATH".to_string())?;
    let npm_command = |args: &[&str]| {
        let mut cmd = Command::new(&npm);
        cmd.args(args).current_dir(&dir);
        crate::harness::apply_gui_env(&mut cmd);
        cmd
    };
    if lock_changed || !dir.join("node_modules").is_dir() {
        emit(app, "building", "Installing npm dependencies", None);
        run_streaming(npm_command(&["ci"]), NPM_CI_TIMEOUT, |line| {
            emit(app, "building", line, None)
        })?;
    }
    emit(
        app,
        "building",
        "Building Irgatos (this takes a few minutes)",
        None,
    );
    // Preserve the local certificate without requiring a separate updater key.
    run_streaming(
        npm_command(&[
            "run",
            "tauri",
            "--",
            "build",
            "--bundles",
            "app",
            "--config",
            &build_config,
        ]),
        BUILD_TIMEOUT,
        |line| emit(app, "building", line, None),
    )?;
    let product = product_name(app);
    let bundle = built_bundle(&dir, &product).ok_or_else(|| {
        format!(
            "The build finished but {} wasn't produced",
            dir.join("target/release/bundle/macos")
                .join(format!("{product}.app"))
                .display()
        )
    })?;
    install_bundle(app, &bundle)
}

#[cfg(target_os = "macos")]
fn schedule_relaunch(bundle: &Path) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c")
        .arg(r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; sleep 0.5; exec /usr/bin/open "$2""#)
        .arg("irgatos-relaunch")
        .arg(std::process::id().to_string())
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    cmd.spawn()
        .map(|_| ())
        .map_err(|error| format!("Couldn't schedule the relaunch: {error}"))
}

struct InstallGuard;

impl InstallGuard {
    fn claim() -> Result<Self, String> {
        if INSTALLING.swap(true, Ordering::SeqCst) {
            return Err("An update is already being installed".into());
        }
        Ok(Self)
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// Commands

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    }
}

fn build_info(version: String, source_dir: Option<&str>) -> BuildInfo {
    BuildInfo {
        version,
        commit: BUILD_COMMIT.map(str::to_string),
        branch: BUILD_BRANCH.map(str::to_string),
        source_dir: resolve_source_dir(source_dir).map(|dir| dir.to_string_lossy().into_owned()),
        install_path: running_bundle().map(|bundle| bundle.to_string_lossy().into_owned()),
        platform: platform(),
        arch: arch(),
        default_repos: DEFAULT_REPOS.iter().map(|repo| repo.to_string()).collect(),
        can_self_install: cfg!(target_os = "macos"),
    }
}

fn check(version: String, repo: Option<&str>, source_dir: Option<&str>) -> UpdateCheck {
    let build = build_info(version, source_dir);
    let (source, source_error) = match build.source_dir.as_deref() {
        Some(dir) => match source_state(Path::new(dir), BUILD_COMMIT, true) {
            Ok(state) => (Some(state), None),
            Err(error) => (None, Some(error)),
        },
        None => (None, None),
    };
    let env_repo = std::env::var(REPO_ENV).ok();
    let repos = candidate_repos(
        repo,
        env_repo.as_deref(),
        source
            .as_ref()
            .and_then(|state| state.remote_slug.as_deref()),
    );
    let token = github_token();
    let agent = agent();
    let mut release = None;
    let mut release_error = None;
    for repo in &repos {
        match latest_release(&agent, token.as_deref(), repo, build.arch) {
            Ok(Some(found)) => {
                release = Some(found);
                break;
            }
            Ok(None) => {}
            Err(error) => {
                release_error.get_or_insert(error);
            }
        }
    }
    if release.is_some() {
        release_error = None;
    }
    let release_newer = release.as_mut().is_some_and(|release| {
        release_is_newer(
            release,
            &build.version,
            BUILD_COMMIT,
            &agent,
            token.as_deref(),
        )
    });
    let remote_branch = match (&source, BUILD_COMMIT, BUILD_BRANCH) {
        (None, Some(commit), Some(branch)) => repos.iter().find_map(|repo| {
            match compare_commits(&agent, token.as_deref(), repo, commit, branch) {
                Ok(Some((_, ahead_by))) => Some(RemoteBranch {
                    repo: repo.clone(),
                    branch: branch.to_string(),
                    ahead_by,
                }),
                _ => None,
            }
        }),
        _ => None,
    };
    let source_newer = source.as_ref().is_some_and(|state| state.new_commits > 0);
    UpdateCheck {
        build,
        repos,
        release,
        release_newer,
        release_error,
        source,
        source_newer,
        source_error,
        remote_branch,
    }
}

#[tauri::command]
pub fn self_update_info(app: AppHandle, source_dir: Option<String>) -> BuildInfo {
    build_info(
        app.package_info().version.to_string(),
        source_dir.as_deref(),
    )
}

#[tauri::command]
pub async fn self_update_check(
    app: AppHandle,
    repo: Option<String>,
    source_dir: Option<String>,
) -> Result<UpdateCheck, String> {
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        check(version, repo.as_deref(), source_dir.as_deref())
    })
    .await
    .map_err(|error| error.to_string())
}

/// Downloads and installs a release; resolves with the installed bundle path.
#[tauri::command]
pub async fn self_update_install_release(
    app: AppHandle,
    repo: String,
    asset: ReleaseAsset,
) -> Result<String, String> {
    let _guard = InstallGuard::claim()?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            install_release(&app, &repo, &asset).map(|path| path.to_string_lossy().into_owned())
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, repo, asset);
        Err("Installing release bundles is only supported on macOS".into())
    }
}

/// Fast-forwards the source checkout, rebuilds, and installs the bundle.
#[tauri::command]
pub async fn self_update_install_source(
    app: AppHandle,
    source_dir: Option<String>,
) -> Result<String, String> {
    let _guard = InstallGuard::claim()?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            install_source(&app, source_dir.as_deref())
                .map(|path| path.to_string_lossy().into_owned())
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, source_dir);
        Err("Building and installing from source is only supported on macOS".into())
    }
}

/// Quits through the normal quit flow, then reopens `bundle` once this
/// process is gone.
#[tauri::command]
pub fn self_update_relaunch(app: AppHandle, bundle: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let bundle = PathBuf::from(bundle);
        if bundle.extension().is_none_or(|ext| ext != "app") || !bundle.is_dir() {
            return Err(format!("{} is not an installed app", bundle.display()));
        }
        emit(&app, "relaunching", "Relaunching Irgatos", None);
        schedule_relaunch(&bundle)?;
        crate::window::request_quit(&app);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle;
        app.restart();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    #[cfg(target_os = "macos")]
    #[ignore = "Requires the approved persistent local signing identity in Keychain"]
    fn live_stable_signature_accepts_new_code_and_rejects_ad_hoc_updates() {
        let identity = std::fs::read_to_string(
            Path::new(&std::env::var("HOME").unwrap()).join(".irgatos/macos-signing-identity"),
        )
        .unwrap();
        let root = tempfile::tempdir().unwrap();
        let identifier = "com.irgatos.signing-test";
        let make_bundle = |name: &str, executable: &str, signer: &str| {
            let bundle = root.path().join(format!("{name}.app"));
            let contents = bundle.join("Contents");
            std::fs::create_dir_all(contents.join("MacOS")).unwrap();
            std::fs::write(contents.join("Info.plist"), format!(
                "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>CFBundleIdentifier</key><string>{identifier}</string><key>CFBundleExecutable</key><string>probe</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>"
            )).unwrap();
            std::fs::copy(executable, contents.join("MacOS/probe")).unwrap();
            let signed = Command::new("/usr/bin/codesign")
                .args(["--force", "--sign", signer, "--timestamp=none"])
                .arg(&bundle)
                .output()
                .unwrap();
            assert!(
                signed.status.success(),
                "{}",
                String::from_utf8_lossy(&signed.stderr)
            );
            bundle
        };
        let current = make_bundle("current", "/usr/bin/true", identity.trim());
        let update = make_bundle("update", "/usr/bin/false", identity.trim());
        let requirement = |bundle: &Path| {
            let output = Command::new("/usr/bin/codesign")
                .args(["--display", "-r-"])
                .arg(bundle)
                .output()
                .unwrap();
            assert!(output.status.success());
            String::from_utf8(output.stdout).unwrap()
        };
        assert_eq!(requirement(&current), requirement(&update));
        prepare_bundle_for_update(identifier, &update, Some(&current)).unwrap();
        let ad_hoc = make_bundle("ad-hoc", "/usr/bin/true", "-");
        assert!(prepare_bundle_for_update(identifier, &ad_hoc, Some(&current)).is_err());
        prepare_bundle_for_update(identifier, &update, Some(&ad_hoc)).unwrap();
        std::fs::write(update.join("Contents/MacOS/probe"), "tampered").unwrap();
        assert!(prepare_bundle_for_update(identifier, &update, Some(&current)).is_err());
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn source_rebuild_preserves_the_configured_signer_and_rejects_ad_hoc() {
        let config: Value =
            serde_json::from_str(&source_build_config(Some("  certificate-id\n")).unwrap())
                .unwrap();
        assert_eq!(
            config["bundle"]["macOS"]["signingIdentity"],
            "certificate-id"
        );
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], false);
        assert!(source_build_config(Some("-")).is_err());
        assert!(source_build_config(Some(" ")).is_err());
        let legacy: Value = serde_json::from_str(&source_build_config(None).unwrap()).unwrap();
        assert!(legacy["bundle"].get("macOS").is_none());
    }

    #[test]
    fn versions_compare_semantically() {
        assert_eq!(compare_versions("0.2.0", "0.1.9"), Some(Ordering::Greater));
        assert_eq!(
            compare_versions("v0.10.0", "0.9.0"),
            Some(Ordering::Greater)
        );
        assert_eq!(compare_versions("0.1", "0.1.0"), Some(Ordering::Equal));
        assert_eq!(
            compare_versions("v0.1.0", "0.1.0+abc"),
            Some(Ordering::Equal)
        );
        assert_eq!(
            compare_versions("0.1.0", "0.1.0-beta.2"),
            Some(Ordering::Greater)
        );
        assert_eq!(
            compare_versions("0.1.0-beta.10", "0.1.0-beta.2"),
            Some(Ordering::Greater)
        );
        assert_eq!(
            compare_versions("0.1.0-alpha", "0.1.0-1"),
            Some(Ordering::Greater)
        );
        assert_eq!(compare_versions("nightly", "0.1.0"), None);
        assert_eq!(compare_versions("0.1.0.4", "0.1.0"), None);
    }

    #[test]
    fn slugs_come_from_urls_remotes_and_plain_text() {
        for (input, expected) in [
            ("wegvon/irgatos", Some("wegvon/irgatos")),
            (" wegvon/irgatos ", Some("wegvon/irgatos")),
            (
                "https://github.com/turel/irgatos-fork.git",
                Some("turel/irgatos-fork"),
            ),
            (
                "https://x-access-token:abc@github.com/wegvon/irgatos",
                Some("wegvon/irgatos"),
            ),
            ("git@github.com:wegvon/irgatos.git", Some("wegvon/irgatos")),
            (
                "ssh://git@github.com/wegvon/irgatos.git",
                Some("wegvon/irgatos"),
            ),
            (
                "https://github.com/wegvon/irgatos/releases/tag/v0.2.0",
                Some("wegvon/irgatos"),
            ),
            ("https://gitlab.com/wegvon/irgatos.git", None),
            ("wegvon/irgatos/extra", None),
            ("wegvon", None),
            ("../etc", None),
        ] {
            assert_eq!(normalize_slug(input).as_deref(), expected, "{input}");
        }
    }

    #[test]
    fn the_upstream_is_never_a_candidate() {
        let repos = candidate_repos(
            Some("cretou/irgatos"),
            Some("CRETOU/irgatos"),
            Some("git@github.com:hardbeat920/irgatos.git"),
        );
        assert_eq!(repos, vec!["wegvon/irgatos"]);
        assert!(repos
            .iter()
            .all(|repo| !repo.to_ascii_lowercase().contains("cretou")));
        assert!(!is_release_download(
            "https://github.com/cretou/irgatos/releases/download/v1.0.0/Irgatos.app.tar.gz",
            "cretou/irgatos"
        ));
    }

    #[test]
    fn candidates_put_overrides_first_and_dedupe() {
        assert_eq!(
            candidate_repos(
                Some("turel/irgatos-fork"),
                None,
                Some("https://github.com/wegvon/irgatos.git")
            ),
            vec!["turel/irgatos-fork", "wegvon/irgatos"]
        );
        assert_eq!(
            candidate_repos(None, None, Some("git@github.com:someone/else.git")),
            vec!["wegvon/irgatos", "someone/else"]
        );
        assert_eq!(candidate_repos(None, None, None), DEFAULT_REPOS.to_vec());
    }

    #[test]
    fn downloads_must_come_from_the_checked_release() {
        let url = "https://github.com/wegvon/irgatos/releases/download/v0.2.0/Irgatos_0.2.0_aarch64.app.tar.gz";
        assert!(is_release_download(url, "wegvon/irgatos"));
        assert!(is_release_download(url, "WEGVON/Irgatos"));
        assert!(!is_release_download(url, "wegvon/irgatos-old"));
        assert!(!is_release_download(
            "https://evil.example/Irgatos.app.tar.gz",
            "wegvon/irgatos"
        ));
        assert!(!is_release_download(
            "https://github.com/wegvon/irgatos/releases/download/",
            "wegvon/irgatos"
        ));
    }

    fn asset(name: &str) -> ReleaseAsset {
        let kind = if name.ends_with(".dmg") {
            AssetKind::Dmg
        } else {
            AssetKind::AppArchive
        };
        ReleaseAsset {
            name: name.into(),
            url: format!("https://github.com/wegvon/irgatos/releases/download/v0.2.0/{name}"),
            size: 1,
            kind,
        }
    }

    #[test]
    fn picks_the_archive_for_this_architecture() {
        let assets = [
            asset("Irgatos_0.2.0_aarch64.dmg"),
            asset("Irgatos_0.2.0_x64.dmg"),
            asset("Irgatos_0.2.0_x64.app.tar.gz"),
            asset("Irgatos_0.2.0_aarch64.app.tar.gz"),
        ];
        assert_eq!(
            select_mac_asset(&assets, "aarch64").unwrap().name,
            "Irgatos_0.2.0_aarch64.app.tar.gz"
        );
        assert_eq!(
            select_mac_asset(&assets, "x86_64").unwrap().name,
            "Irgatos_0.2.0_x64.app.tar.gz"
        );
    }

    #[test]
    fn falls_back_to_dmg_universal_and_legacy_names() {
        let dmg_only = [
            asset("Irgatos_0.2.0_x64.dmg"),
            asset("Irgatos_0.2.0_aarch64.dmg"),
        ];
        assert_eq!(
            select_mac_asset(&dmg_only, "aarch64").unwrap().name,
            "Irgatos_0.2.0_aarch64.dmg"
        );
        let legacy = [asset("Irgatos.app.tar.gz"), asset("Irgatos_x64.app.tar.gz")];
        assert_eq!(
            select_mac_asset(&legacy, "aarch64").unwrap().name,
            "Irgatos.app.tar.gz"
        );
        assert_eq!(
            select_mac_asset(&legacy, "x86_64").unwrap().name,
            "Irgatos_x64.app.tar.gz"
        );
        let universal = [asset("Irgatos_0.2.0_universal.dmg")];
        assert!(select_mac_asset(&universal, "x86_64").is_some());
        let arm_only = [asset("Irgatos.app.tar.gz")];
        assert!(select_mac_asset(&arm_only, "x86_64").is_none());
    }

    #[test]
    fn parses_a_github_release() {
        let body = serde_json::json!({
            "tag_name": "v0.2.0",
            "name": "Irgatos 0.2.0",
            "body": "Notes\n\nCommit: 89B88053A1966EAE8B984D21441372041F5A7B63\n",
            "html_url": "https://github.com/wegvon/irgatos/releases/tag/v0.2.0",
            "target_commitish": "main",
            "draft": false,
            "published_at": "2026-10-14T00:00:00Z",
            "assets": [
                { "name": "Irgatos_0.2.0_aarch64.app.tar.gz", "size": 42,
                  "browser_download_url": "https://github.com/wegvon/irgatos/releases/download/v0.2.0/Irgatos_0.2.0_aarch64.app.tar.gz" },
                { "name": "Irgatos_0.2.0_aarch64.app.tar.gz.sig", "size": 1,
                  "browser_download_url": "https://github.com/wegvon/irgatos/releases/download/v0.2.0/Irgatos_0.2.0_aarch64.app.tar.gz.sig" },
                { "name": "latest.json", "size": 1,
                  "browser_download_url": "https://github.com/wegvon/irgatos/releases/download/v0.2.0/latest.json" }
            ]
        });
        // Queried under a former name; GitHub answered for the renamed repo.
        let release = parse_release("wegvon/irgat", &body, "aarch64").unwrap();
        assert_eq!(release.repo, "wegvon/irgatos");
        assert_eq!(release.version, "0.2.0");
        assert_eq!(
            release.commit.as_deref(),
            Some("89b88053a1966eae8b984d21441372041f5a7b63")
        );
        let asset = release.asset.unwrap();
        assert_eq!(asset.kind, AssetKind::AppArchive);
        assert_eq!(asset.size, 42);
        assert!(is_release_download(&asset.url, &release.repo));
    }

    #[test]
    fn ignores_drafts_and_non_version_tags() {
        let draft = serde_json::json!({ "tag_name": "v0.2.0", "draft": true });
        assert!(parse_release("wegvon/irgatos", &draft, "aarch64").is_none());
        let nightly = serde_json::json!({ "tag_name": "nightly" });
        assert!(parse_release("wegvon/irgatos", &nightly, "aarch64").is_none());
    }

    #[test]
    fn installs_in_place_only_from_an_applications_folder() {
        let home = Path::new("/Users/turel");
        assert_eq!(
            install_target(
                Some(Path::new("/Applications/Irgatos.app")),
                "Irgatos",
                Some(home)
            ),
            PathBuf::from("/Applications/Irgatos.app")
        );
        assert_eq!(
            install_target(
                Some(Path::new("/Users/turel/Applications/Irgatos.app")),
                "Irgatos",
                Some(home)
            ),
            PathBuf::from("/Users/turel/Applications/Irgatos.app")
        );
        for elsewhere in [
            "/Volumes/Irgatos/Irgatos.app",
            "/private/var/folders/x/AppTranslocation/1/d/Irgatos.app",
            "/Users/turel/src/irgatos/target/release/bundle/macos/Irgatos.app",
        ] {
            assert_eq!(
                install_target(Some(Path::new(elsewhere)), "Irgatos", Some(home)),
                PathBuf::from("/Applications/Irgatos.app"),
                "{elsewhere}"
            );
        }
        assert_eq!(
            install_target(None, "Irgatos", None),
            PathBuf::from("/Applications/Irgatos.app")
        );
    }

    // The swap script is a macOS shell script; Windows paths would use `\`.
    #[cfg(unix)]
    #[test]
    fn quoting_survives_hostile_paths() {
        assert_eq!(shell_quote("/tmp/it's here"), r"'/tmp/it'\''s here'");
        assert_eq!(applescript_string(r#"echo "a\b""#), r#""echo \"a\\b\"""#);
        let script = swap_script(
            Path::new("/tmp/x/Irgatos.app"),
            Path::new("/Applications/Irgatos.app"),
        );
        assert!(script.starts_with("set -e;"));
        assert!(script
            .contains("/usr/bin/ditto '/tmp/x/Irgatos.app' '/Applications/.Irgatos.app.incoming-"));
        assert!(
            script.contains("mv '/Applications/Irgatos.app' '/Applications/.Irgatos.app.previous-")
        );
    }

    #[cfg(unix)]
    #[test]
    fn swap_script_replaces_and_keeps_nothing_behind() {
        let root = std::env::temp_dir().join(format!("irgatos-swap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let source = root.join("new/Irgatos.app/Contents");
        let target = root.join("apps/Irgatos.app");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("marker"), "new").unwrap();
        std::fs::create_dir_all(target.join("Contents")).unwrap();
        std::fs::write(target.join("Contents/marker"), "old").unwrap();
        // ditto is macOS-only; cp -R stands in for it to exercise the renames.
        let script =
            swap_script(&root.join("new/Irgatos.app"), &target).replace("/usr/bin/ditto", "cp -R");
        let status = Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(
            std::fs::read_to_string(target.join("Contents/marker")).unwrap(),
            "new"
        );
        let leftovers: Vec<_> = std::fs::read_dir(root.join("apps"))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(leftovers, vec!["Irgatos.app"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    fn run(dir: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args([
                "-c",
                "user.name=Irgatos",
                "-c",
                "user.email=irgatos@example.com",
            ])
            .args([
                "-c",
                "init.defaultBranch=main",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn commit(dir: &Path, version: &str) -> String {
        std::fs::write(
            dir.join("package.json"),
            format!("{{\"name\":\"irgat-desktop\",\"version\":\"{version}\"}}\n"),
        )
        .unwrap();
        run(dir, &["add", "-A"]);
        run(dir, &["commit", "-q", "-m", &format!("v{version}")]);
        run(dir, &["rev-parse", "HEAD"])
    }

    #[test]
    fn source_state_sees_upstream_commits_and_local_rebuilds() {
        let root = std::env::temp_dir().join(format!("irgatos-source-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let origin = root.join("origin");
        let checkout = root.join("checkout");
        std::fs::create_dir_all(origin.join("src-tauri")).unwrap();
        std::fs::write(origin.join("src-tauri/tauri.conf.json"), "{}").unwrap();
        run(&origin, &["init", "-q"]);
        let built = commit(&origin, "0.1.0");
        run(
            &root,
            &[
                "clone",
                "-q",
                origin.to_str().unwrap(),
                checkout.to_str().unwrap(),
            ],
        );
        assert!(is_irgatos_checkout(&checkout));

        let state = source_state(&checkout, Some(&built), true).unwrap();
        assert_eq!(state.branch, "main");
        assert_eq!(state.upstream.as_deref(), Some("origin/main"));
        assert_eq!((state.new_commits, state.behind, state.ahead), (0, 0, 0));
        assert!(!state.dirty);

        let newer = commit(&origin, "0.2.0");
        let state = source_state(&checkout, Some(&built), true).unwrap();
        assert!(state.fetch_error.is_none());
        assert_eq!((state.new_commits, state.behind, state.ahead), (1, 1, 0));
        assert_eq!(state.target, newer);
        assert_eq!(state.version.as_deref(), Some("0.2.0"));
        assert!(!state.diverged);

        // Pulled but not rebuilt: nothing upstream, yet the build is behind.
        run(&checkout, &["merge", "-q", "--ff-only", "origin/main"]);
        let state = source_state(&checkout, Some(&built), false).unwrap();
        assert_eq!((state.new_commits, state.behind), (1, 0));
        assert_eq!(state.target, newer);

        // An unknown build commit (CI build) falls back to upstream distance.
        let state = source_state(&checkout, Some(&"0".repeat(40)), false).unwrap();
        assert_eq!(state.new_commits, 0);

        commit(&origin, "0.3.0");
        commit(&checkout, "0.2.1-local");
        let state = source_state(&checkout, Some(&built), true).unwrap();
        assert!(state.diverged);
        assert_eq!(state.target, state.head);

        std::fs::write(checkout.join("package.json"), "{}").unwrap();
        assert!(source_state(&checkout, None, false).unwrap().dirty);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn release_commit_reads_notes_or_target() {
        let sha = "89b88053a1966eae8b984d21441372041f5a7b63";
        let targeted = serde_json::json!({ "target_commitish": sha });
        assert_eq!(release_commit(&targeted).as_deref(), Some(sha));
        let noted = serde_json::json!({ "target_commitish": "main", "body": format!("- **Commit:** `{sha}`") });
        assert_eq!(release_commit(&noted).as_deref(), Some(sha));
        let none = serde_json::json!({ "target_commitish": "main", "body": "Commit: abc" });
        assert_eq!(release_commit(&none), None);
    }

    #[test]
    fn package_version_reads_package_json() {
        assert_eq!(
            package_version(r#"{"version":"0.2.0"}"#).as_deref(),
            Some("0.2.0")
        );
        assert_eq!(package_version("{}"), None);
    }
}
