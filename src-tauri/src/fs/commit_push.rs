//! One-click commit and push. Each phase is its own command so the UI can show
//! progress between them, and every failure a user can act on comes back as a
//! distinct kind instead of an opaque string.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::{
    expand_home, git_checked, git_head_branch, git_output, git_remote_name, git_stdout,
    with_signing_hint,
};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleIssue {
    pub path: String,
    /// Checked out at a different commit than the one the superproject records.
    pub moved: bool,
    pub modified: bool,
    pub untracked: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CommitPushError {
    NotRepository,
    OperationInProgress {
        operation: String,
    },
    DetachedHead,
    Submodules {
        submodules: Vec<SubmoduleIssue>,
        detail: String,
    },
    NothingToCommit {
        ahead: i64,
    },
    NoRemote,
    NoUpstream {
        remote: String,
        branch: String,
    },
    AuthFailed {
        remote: String,
        detail: String,
    },
    NonFastForward {
        remote: String,
        branch: String,
        detail: String,
    },
    HookFailed {
        hook: String,
        detail: String,
    },
    RebaseConflict {
        detail: String,
    },
    Failed {
        phase: String,
        detail: String,
    },
}

fn failed(phase: &str, detail: impl Into<String>) -> CommitPushError {
    CommitPushError::Failed {
        phase: phase.into(),
        detail: detail.into(),
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitPushPlan {
    pub branch: String,
    pub remote: String,
    pub upstream: Option<String>,
    /// Nothing is staged, so every change is staged before committing.
    pub stage_all: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitPushStaged {
    pub paths: Vec<String>,
    pub staged_all: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitPushCommit {
    pub sha: String,
    pub message: String,
    /// Files committed whole, with no changes left in the working tree.
    pub paths: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitPushPushed {
    pub remote: String,
    pub branch: String,
    pub set_upstream: bool,
}

async fn blocking<T: Send + 'static>(
    phase: &'static str,
    job: impl FnOnce() -> Result<T, CommitPushError> + Send + 'static,
) -> Result<T, CommitPushError> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| failed(phase, e.to_string()))?
}

/// Everything that would stop a commit and push, checked before anything changes.
#[tauri::command]
pub async fn git_commit_push_check(
    cwd: String,
    set_upstream: bool,
    allow_submodules: bool,
) -> Result<CommitPushPlan, CommitPushError> {
    blocking("check", move || {
        check_for(&expand_home(&cwd), set_upstream, allow_submodules)
    })
    .await
}

/// Keep what is staged, or stage every change when nothing is.
#[tauri::command]
pub async fn git_commit_push_stage(cwd: String) -> Result<CommitPushStaged, CommitPushError> {
    blocking("stage", move || stage_for(&expand_home(&cwd))).await
}

/// Commit the index with `message`, or a summary of the staged files.
#[tauri::command]
pub async fn git_commit_push_commit(
    cwd: String,
    message: String,
) -> Result<CommitPushCommit, CommitPushError> {
    blocking("commit", move || commit_for(&expand_home(&cwd), &message)).await
}

/// Push the current branch to its upstream; never forced.
#[tauri::command]
pub async fn git_commit_push_push(
    cwd: String,
    set_upstream: bool,
) -> Result<CommitPushPushed, CommitPushError> {
    blocking("push", move || push_for(&expand_home(&cwd), set_upstream)).await
}

/// Rebase local commits onto the upstream after a rejected push.
#[tauri::command]
pub async fn git_commit_push_rebase(cwd: String) -> Result<(), CommitPushError> {
    blocking("pull", move || rebase_for(&expand_home(&cwd))).await
}

fn check_for(
    root: &Path,
    set_upstream: bool,
    allow_submodules: bool,
) -> Result<CommitPushPlan, CommitPushError> {
    if git_stdout(root, &["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        return Err(CommitPushError::NotRepository);
    }
    if let Some(operation) = operation_in_progress(root) {
        return Err(CommitPushError::OperationInProgress {
            operation: operation.into(),
        });
    }
    let branch = git_head_branch(root).ok_or(CommitPushError::DetachedHead)?;
    let status = git_output(
        root,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ],
    )
    .map(|bytes| parse_status(&bytes))
    .ok_or_else(|| failed("check", "Could not read the repository status"))?;
    if status.conflicted {
        return Err(failed(
            "check",
            "Some files still have merge conflicts. Resolve and stage them first.",
        ));
    }
    if !status.staged && !status.changed {
        return Err(CommitPushError::NothingToCommit {
            ahead: ahead_of_upstream(root),
        });
    }
    if !allow_submodules && !status.submodules.is_empty() {
        return Err(CommitPushError::Submodules {
            submodules: status.submodules,
            detail: String::new(),
        });
    }
    let upstream = upstream(root);
    let remote = match &upstream {
        Some(_) => upstream_target(root, &branch).map(|(remote, _)| remote),
        None => git_remote_name(root),
    }
    .ok_or(CommitPushError::NoRemote)?;
    if upstream.is_none() && !set_upstream {
        return Err(CommitPushError::NoUpstream { remote, branch });
    }
    Ok(CommitPushPlan {
        branch,
        remote,
        upstream,
        stage_all: !status.staged,
    })
}

fn stage_for(root: &Path) -> Result<CommitPushStaged, CommitPushError> {
    let mut paths = staged_paths(root)?;
    let staged_all = paths.is_empty();
    if staged_all {
        git_checked(root, &["add", "-A", "--", "."]).map_err(|detail| failed("stage", detail))?;
        paths = staged_paths(root)?;
    }
    if paths.is_empty() {
        return Err(CommitPushError::NothingToCommit {
            ahead: ahead_of_upstream(root),
        });
    }
    Ok(CommitPushStaged { paths, staged_all })
}

fn commit_for(root: &Path, message: &str) -> Result<CommitPushCommit, CommitPushError> {
    // A second click, or a commit made elsewhere meanwhile, finds nothing staged.
    let staged = staged_paths(root)?;
    if staged.is_empty() {
        return Err(CommitPushError::NothingToCommit {
            ahead: ahead_of_upstream(root),
        });
    }
    let message = match message.trim() {
        "" => default_message(&staged),
        text => text.to_string(),
    };
    if let Err(detail) = git_checked(root, &["commit", "--cleanup=strip", "-m", &message]) {
        return Err(commit_error(root, detail));
    }
    let unstaged = name_list(root, &["diff", "--name-only", "-z", "--no-renames"])?;
    Ok(CommitPushCommit {
        sha: git_stdout(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default(),
        message,
        paths: staged
            .into_iter()
            .filter(|path| !unstaged.contains(path))
            .collect(),
    })
}

fn push_for(root: &Path, set_upstream: bool) -> Result<CommitPushPushed, CommitPushError> {
    let branch = git_head_branch(root).ok_or(CommitPushError::DetachedHead)?;
    let (remote, target, set_upstream) =
        match upstream(root).and_then(|_| upstream_target(root, &branch)) {
            Some((remote, merge)) => (remote, merge, false),
            None => {
                let remote = git_remote_name(root).ok_or(CommitPushError::NoRemote)?;
                if !set_upstream {
                    return Err(CommitPushError::NoUpstream { remote, branch });
                }
                (remote, format!("refs/heads/{branch}"), true)
            }
        };
    let refspec = format!("refs/heads/{branch}:{target}");
    let mut args = vec!["push"];
    if set_upstream {
        args.push("-u");
    }
    if root.join(".gitmodules").is_file() {
        args.push("--recurse-submodules=check");
    }
    args.extend([remote.as_str(), refspec.as_str()]);
    git_checked(root, &args).map_err(|detail| push_error(root, &remote, &branch, detail))?;
    Ok(CommitPushPushed {
        remote,
        branch,
        set_upstream,
    })
}

fn rebase_for(root: &Path) -> Result<(), CommitPushError> {
    let branch = git_head_branch(root).ok_or(CommitPushError::DetachedHead)?;
    let Some((remote, _)) = upstream(root).and_then(|_| upstream_target(root, &branch)) else {
        let remote = git_remote_name(root).ok_or(CommitPushError::NoRemote)?;
        return Err(CommitPushError::NoUpstream { remote, branch });
    };
    let Err(detail) = git_checked(root, &["pull", "--rebase", "--autostash"]) else {
        return Ok(());
    };
    if operation_in_progress(root) == Some("rebase") {
        // Leave the branch as it was rather than half-rebased behind a button.
        let _ = git_checked(root, &["rebase", "--abort"]);
        return Err(CommitPushError::RebaseConflict { detail });
    }
    Err(match push_error(root, &remote, &branch, detail) {
        CommitPushError::Failed { detail, .. } => failed("pull", detail),
        other => other,
    })
}

fn commit_error(root: &Path, detail: String) -> CommitPushError {
    let lower = detail.to_lowercase();
    let git_refusal = [
        "please tell me who you are",
        "failed to sign",
        "ssh-keygen",
        "unmerged files",
        "index.lock",
        "nothing to commit",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    if !git_refusal {
        if let Some(hook) = active_hooks(root, &["pre-commit", "prepare-commit-msg", "commit-msg"])
        {
            return CommitPushError::HookFailed { hook, detail };
        }
    }
    failed("commit", with_signing_hint(detail))
}

fn push_error(root: &Path, remote: &str, branch: &str, detail: String) -> CommitPushError {
    let lower = detail.to_lowercase();
    if is_non_fast_forward(&lower) {
        return CommitPushError::NonFastForward {
            remote: remote.into(),
            branch: branch.into(),
            detail,
        };
    }
    if is_auth_failure(&lower) {
        return CommitPushError::AuthFailed {
            remote: remote.into(),
            detail,
        };
    }
    if lower.contains("submodule") && lower.contains("not be found on any remote") {
        return CommitPushError::Submodules {
            submodules: Vec::new(),
            detail,
        };
    }
    if lower.contains("failed to push some refs") && !lower.contains("rejected]") {
        if let Some(hook) = active_hooks(root, &["pre-push"]) {
            return CommitPushError::HookFailed { hook, detail };
        }
    }
    failed("push", detail)
}

fn is_non_fast_forward(lower: &str) -> bool {
    !lower.contains("[remote rejected]")
        && (lower.contains("[rejected]")
            || lower.contains("non-fast-forward")
            || lower.contains("(fetch first)")
            || lower.contains("updates were rejected because the tip"))
}

fn is_auth_failure(lower: &str) -> bool {
    [
        "authentication failed",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "permission denied (publickey",
        "permission denied, please try again",
        "http basic: access denied",
        "invalid username or password",
        "invalid credentials",
        "the requested url returned error: 401",
        "the requested url returned error: 403",
        "returned error: 403",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn default_message(paths: &[String]) -> String {
    let name = |path: &String| path.rsplit('/').next().unwrap_or(path).to_string();
    match paths {
        [] => "Update files".into(),
        [one] => format!("Update {}", name(one)),
        [first, second] => format!("Update {} and {}", name(first), name(second)),
        [first, rest @ ..] => format!("Update {} and {} other files", name(first), rest.len()),
    }
}

fn staged_paths(root: &Path) -> Result<Vec<String>, CommitPushError> {
    name_list(
        root,
        &["diff", "--cached", "--name-only", "-z", "--no-renames"],
    )
}

fn name_list(root: &Path, args: &[&str]) -> Result<Vec<String>, CommitPushError> {
    let bytes = git_output(root, args)
        .ok_or_else(|| failed("check", "Could not read the staged changes"))?;
    Ok(bytes
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| String::from_utf8_lossy(entry).into_owned())
        .collect())
}

fn upstream(root: &Path) -> Option<String> {
    git_stdout(
        root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
}

/// The upstream's remote and branch ref, read from the branch config.
fn upstream_target(root: &Path, branch: &str) -> Option<(String, String)> {
    let remote = git_stdout(root, &["config", &format!("branch.{branch}.remote")])?;
    let merge = git_stdout(root, &["config", &format!("branch.{branch}.merge")])?;
    Some((remote, merge))
}

fn ahead_of_upstream(root: &Path) -> i64 {
    if upstream(root).is_none() {
        return 0;
    }
    git_stdout(root, &["rev-list", "--count", "@{upstream}..HEAD"])
        .and_then(|count| count.parse().ok())
        .unwrap_or(0)
}

fn git_path(root: &Path, line: &str) -> PathBuf {
    let path = Path::new(line);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

fn operation_in_progress(root: &Path) -> Option<&'static str> {
    const MARKERS: [(&str, &str); 5] = [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ];
    let mut args = vec!["rev-parse"];
    for (marker, _) in MARKERS {
        args.extend(["--git-path", marker]);
    }
    let paths = git_stdout(root, &args)?;
    for ((marker, operation), line) in MARKERS.iter().zip(paths.lines()) {
        let path = git_path(root, line.trim());
        if !path.exists() {
            continue;
        }
        if *marker == "rebase-apply" && path.join("applying").exists() {
            return Some("am");
        }
        return Some(operation);
    }
    None
}

/// Hooks git would actually run, honouring `core.hooksPath`.
fn active_hooks(root: &Path, names: &[&str]) -> Option<String> {
    let found: Vec<&str> = names
        .iter()
        .copied()
        .filter(|name| {
            git_stdout(root, &["rev-parse", "--git-path", &format!("hooks/{name}")])
                .map(|line| is_executable(&git_path(root, &line)))
                .unwrap_or(false)
        })
        .collect();
    (!found.is_empty()).then(|| found.join(" / "))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[derive(Default, Debug, PartialEq, Eq)]
struct WorkTreeStatus {
    staged: bool,
    changed: bool,
    conflicted: bool,
    submodules: Vec<SubmoduleIssue>,
}

/// Reads `git status --porcelain=v2 -z`.
fn parse_status(bytes: &[u8]) -> WorkTreeStatus {
    let text = String::from_utf8_lossy(bytes);
    let mut status = WorkTreeStatus::default();
    let mut entries = text.split('\0');
    while let Some(entry) = entries.next() {
        let Some((kind, rest)) = entry.split_once(' ') else {
            continue;
        };
        let fields_before_path = match kind {
            "?" => {
                status.changed = true;
                continue;
            }
            "1" => 7,
            "2" => 8,
            "u" => 9,
            _ => continue,
        };
        if kind == "2" {
            entries.next();
        }
        let fields: Vec<&str> = rest.splitn(fields_before_path + 1, ' ').collect();
        let (Some(xy), Some(sub), Some(path)) = (
            fields.first(),
            fields.get(1),
            fields.get(fields_before_path),
        ) else {
            continue;
        };
        let mut xy = xy.chars();
        let (x, y) = (xy.next().unwrap_or('.'), xy.next().unwrap_or('.'));
        if kind == "u" {
            status.conflicted = true;
            continue;
        }
        status.staged |= x != '.';
        status.changed |= y != '.';
        let mut sub = sub.chars();
        if sub.next() == Some('S') {
            let issue = SubmoduleIssue {
                path: (*path).to_string(),
                moved: sub.next() == Some('C'),
                modified: sub.next() == Some('M'),
                untracked: sub.next() == Some('U'),
            };
            if issue.moved || issue.modified || issue.untracked {
                status.submodules.push(issue);
            }
        }
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        let dir = std::env::temp_dir().join(format!(
            "irgat-commit-push-{label}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Tmp(dir)
    }

    fn git(dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(["-c", "protocol.file.allow=always"])
            .args(args)
            .current_dir(dir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn configure(dir: &Path) {
        for (key, value) in [
            ("user.name", "Irgat"),
            ("user.email", "irgat@test"),
            ("commit.gpgsign", "false"),
            ("core.fsmonitor", "false"),
            ("core.autocrlf", "false"),
            ("pull.rebase", "false"),
        ] {
            git(dir, &["config", key, value]);
        }
    }

    fn repo(label: &str) -> Tmp {
        let dir = tmp(label);
        git(&dir.0, &["init", "-q", "-b", "main"]);
        configure(&dir.0);
        std::fs::write(dir.0.join("a.txt"), "alpha\n").unwrap();
        git(&dir.0, &["add", "."]);
        git(&dir.0, &["commit", "-q", "-m", "init"]);
        dir
    }

    /// A repo whose `main` tracks `origin/main` on a local bare remote.
    fn tracked(label: &str) -> (Tmp, Tmp) {
        let origin = tmp(&format!("{label}-origin"));
        git(&origin.0, &["init", "-q", "--bare", "-b", "main"]);
        let local = repo(label);
        let url = origin.0.to_string_lossy().into_owned();
        git(&local.0, &["remote", "add", "origin", &url]);
        git(&local.0, &["push", "-q", "-u", "origin", "main"]);
        (origin, local)
    }

    fn clone(origin: &Tmp, label: &str) -> Tmp {
        let dir = tmp(label);
        let url = origin.0.to_string_lossy().into_owned();
        git(&dir.0, &["clone", "-q", "-b", "main", &url, "."]);
        configure(&dir.0);
        dir
    }

    fn rev(dir: &Path, spec: &str) -> String {
        git_stdout(dir, &["rev-parse", spec]).unwrap()
    }

    #[cfg(unix)]
    fn hook(repo: &Path, name: &str, script: &str) {
        use std::os::unix::fs::PermissionsExt;
        let hooks = repo.join("test-hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        let path = hooks.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let hooks = hooks.to_string_lossy().into_owned();
        git(repo, &["config", "core.hooksPath", &hooks]);
    }

    fn one_click(root: &Path, message: &str) -> Result<CommitPushPushed, CommitPushError> {
        check_for(root, false, false)?;
        stage_for(root)?;
        commit_for(root, message)?;
        push_for(root, false)
    }

    #[test]
    fn commits_every_change_and_pushes_to_the_upstream() {
        let (origin, local) = tracked("happy");
        std::fs::write(local.0.join("a.txt"), "beta\n").unwrap();
        std::fs::write(local.0.join("new.txt"), "new\n").unwrap();
        let plan = check_for(&local.0, false, false).unwrap();
        assert!(plan.stage_all);
        assert_eq!(plan.upstream.as_deref(), Some("origin/main"));
        let staged = stage_for(&local.0).unwrap();
        assert!(staged.staged_all);
        let commit = commit_for(&local.0, "  ").unwrap();
        assert_eq!(commit.message, "Update a.txt and new.txt");
        assert_eq!(commit.paths, vec!["a.txt", "new.txt"]);
        let pushed = push_for(&local.0, false).unwrap();
        assert_eq!(
            (pushed.remote.as_str(), pushed.set_upstream),
            ("origin", false)
        );
        assert_eq!(rev(&origin.0, "main"), rev(&local.0, "HEAD"));
    }

    #[test]
    fn keeps_a_partial_index_and_reports_files_left_dirty() {
        let (_origin, local) = tracked("partial");
        std::fs::write(local.0.join("a.txt"), "staged\n").unwrap();
        std::fs::write(local.0.join("b.txt"), "untouched\n").unwrap();
        git(&local.0, &["add", "a.txt"]);
        std::fs::write(local.0.join("a.txt"), "staged\nand more\n").unwrap();
        assert!(!check_for(&local.0, false, false).unwrap().stage_all);
        assert!(!stage_for(&local.0).unwrap().staged_all);
        let commit = commit_for(&local.0, "Partial").unwrap();
        assert!(commit.paths.is_empty());
        assert_eq!(
            git_stdout(&local.0, &["show", "HEAD:a.txt"]).as_deref(),
            Some("staged")
        );
        assert!(git_stdout(&local.0, &["ls-files", "b.txt"]).is_none());
    }

    #[test]
    fn nothing_to_commit_is_reported_and_a_second_commit_is_refused() {
        let (_origin, local) = tracked("nothing");
        assert_eq!(
            check_for(&local.0, false, false),
            Err(CommitPushError::NothingToCommit { ahead: 0 })
        );
        std::fs::write(local.0.join("a.txt"), "beta\n").unwrap();
        stage_for(&local.0).unwrap();
        commit_for(&local.0, "Once").unwrap();
        let head = rev(&local.0, "HEAD");
        assert_eq!(
            commit_for(&local.0, "Twice"),
            Err(CommitPushError::NothingToCommit { ahead: 1 })
        );
        assert_eq!(rev(&local.0, "HEAD"), head);
    }

    #[test]
    fn no_remote_is_reported_before_committing() {
        let local = repo("no-remote");
        std::fs::write(local.0.join("a.txt"), "beta\n").unwrap();
        assert_eq!(
            check_for(&local.0, true, false),
            Err(CommitPushError::NoRemote)
        );
        assert_eq!(push_for(&local.0, true), Err(CommitPushError::NoRemote));
    }

    #[test]
    fn missing_upstream_is_offered_and_set_with_u() {
        let (origin, local) = tracked("no-upstream");
        git(&local.0, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(local.0.join("a.txt"), "feature\n").unwrap();
        let no_upstream = CommitPushError::NoUpstream {
            remote: "origin".into(),
            branch: "feature".into(),
        };
        assert_eq!(check_for(&local.0, false, false), Err(no_upstream.clone()));
        assert!(check_for(&local.0, true, false).unwrap().upstream.is_none());
        stage_for(&local.0).unwrap();
        commit_for(&local.0, "Feature").unwrap();
        assert_eq!(push_for(&local.0, false), Err(no_upstream));
        let pushed = push_for(&local.0, true).unwrap();
        assert!(pushed.set_upstream);
        assert_eq!(upstream(&local.0).as_deref(), Some("origin/feature"));
        assert_eq!(rev(&origin.0, "feature"), rev(&local.0, "HEAD"));
    }

    #[test]
    fn non_fast_forward_is_never_forced_and_rebase_recovers() {
        let (origin, local) = tracked("nff");
        let other = clone(&origin, "nff-other");
        std::fs::write(other.0.join("other.txt"), "theirs\n").unwrap();
        git(&other.0, &["add", "."]);
        git(&other.0, &["commit", "-q", "-m", "theirs"]);
        git(&other.0, &["push", "-q"]);
        let theirs = rev(&origin.0, "main");

        std::fs::write(local.0.join("a.txt"), "mine\n").unwrap();
        std::fs::write(local.0.join("dirty.txt"), "left out\n").unwrap();
        git(&local.0, &["add", "a.txt"]);
        let error = one_click(&local.0, "Mine").unwrap_err();
        let CommitPushError::NonFastForward {
            remote,
            branch,
            detail,
        } = error
        else {
            panic!("expected non-fast-forward, got {error:?}");
        };
        assert_eq!((remote.as_str(), branch.as_str()), ("origin", "main"));
        assert!(detail.contains("rejected"), "{detail}");
        assert_eq!(rev(&origin.0, "main"), theirs);

        rebase_for(&local.0).unwrap();
        assert!(local.0.join("dirty.txt").exists());
        push_for(&local.0, false).unwrap();
        assert_eq!(rev(&origin.0, "main^"), theirs);
        assert_eq!(rev(&origin.0, "main"), rev(&local.0, "HEAD"));
    }

    #[test]
    fn conflicting_rebase_is_aborted_and_keeps_the_local_commit() {
        let (origin, local) = tracked("rebase-conflict");
        let other = clone(&origin, "rebase-conflict-other");
        std::fs::write(other.0.join("a.txt"), "theirs\n").unwrap();
        git(&other.0, &["commit", "-q", "-am", "theirs"]);
        git(&other.0, &["push", "-q"]);
        std::fs::write(local.0.join("a.txt"), "mine\n").unwrap();
        assert!(matches!(
            one_click(&local.0, "Mine"),
            Err(CommitPushError::NonFastForward { .. })
        ));
        let head = rev(&local.0, "HEAD");
        assert!(matches!(
            rebase_for(&local.0),
            Err(CommitPushError::RebaseConflict { .. })
        ));
        assert_eq!(operation_in_progress(&local.0), None);
        assert_eq!(rev(&local.0, "HEAD"), head);
    }

    #[cfg(unix)]
    #[test]
    fn failing_pre_commit_hook_surfaces_its_output() {
        let (_origin, local) = tracked("pre-commit");
        hook(
            &local.0,
            "pre-commit",
            "echo 'lint: trailing whitespace in a.txt' >&2\nexit 1",
        );
        std::fs::write(local.0.join("a.txt"), "beta \n").unwrap();
        let head = rev(&local.0, "HEAD");
        let error = one_click(&local.0, "Lint me").unwrap_err();
        assert_eq!(
            error,
            CommitPushError::HookFailed {
                hook: "pre-commit".into(),
                detail: "lint: trailing whitespace in a.txt".into(),
            }
        );
        assert_eq!(rev(&local.0, "HEAD"), head);
    }

    #[cfg(unix)]
    #[test]
    fn failing_pre_push_hook_surfaces_its_output() {
        let (origin, local) = tracked("pre-push");
        hook(
            &local.0,
            "pre-push",
            "echo 'tests failed: 3 of 120' >&2\nexit 1",
        );
        std::fs::write(local.0.join("a.txt"), "beta\n").unwrap();
        let before = rev(&origin.0, "main");
        let error = one_click(&local.0, "Push me").unwrap_err();
        let CommitPushError::HookFailed { hook, detail } = error else {
            panic!("expected hook failure, got {error:?}");
        };
        assert_eq!(hook, "pre-push");
        assert!(detail.contains("tests failed: 3 of 120"), "{detail}");
        assert_eq!(rev(&origin.0, "main"), before);
    }

    #[test]
    fn detached_head_is_reported() {
        let (_origin, local) = tracked("detached");
        git(&local.0, &["checkout", "-q", "--detach"]);
        std::fs::write(local.0.join("a.txt"), "beta\n").unwrap();
        assert_eq!(
            check_for(&local.0, false, false),
            Err(CommitPushError::DetachedHead)
        );
        assert_eq!(
            push_for(&local.0, false),
            Err(CommitPushError::DetachedHead)
        );
    }

    #[test]
    fn merge_rebase_and_cherry_pick_in_progress_are_reported() {
        let local = repo("in-progress");
        git(&local.0, &["checkout", "-q", "-b", "side"]);
        std::fs::write(local.0.join("a.txt"), "side\n").unwrap();
        git(&local.0, &["commit", "-q", "-am", "side"]);
        git(&local.0, &["checkout", "-q", "main"]);
        std::fs::write(local.0.join("a.txt"), "main\n").unwrap();
        git(&local.0, &["commit", "-q", "-am", "main"]);

        for (start, abort, operation) in [
            (vec!["merge", "side"], vec!["merge", "--abort"], "merge"),
            (vec!["rebase", "side"], vec!["rebase", "--abort"], "rebase"),
            (
                vec!["cherry-pick", "side"],
                vec!["cherry-pick", "--abort"],
                "cherry-pick",
            ),
        ] {
            let status = Command::new("git")
                .args(&start)
                .current_dir(&local.0)
                .output()
                .unwrap()
                .status;
            assert!(!status.success(), "{start:?} should stop on the conflict");
            assert_eq!(
                check_for(&local.0, true, true),
                Err(CommitPushError::OperationInProgress {
                    operation: operation.into()
                })
            );
            git(&local.0, &abort);
        }
    }

    #[test]
    fn dirty_and_moved_submodules_need_confirmation() {
        let library = repo("submodule-lib");
        let (_origin, local) = tracked("submodule");
        let url = library.0.to_string_lossy().into_owned();
        git(&local.0, &["submodule", "add", "-q", &url, "lib"]);
        git(&local.0, &["commit", "-q", "-m", "add lib"]);
        let sub = local.0.join("lib");
        configure(&sub);

        std::fs::write(sub.join("a.txt"), "dirty\n").unwrap();
        std::fs::write(sub.join("scratch.txt"), "untracked\n").unwrap();
        assert_eq!(
            check_for(&local.0, false, false),
            Err(CommitPushError::Submodules {
                submodules: vec![SubmoduleIssue {
                    path: "lib".into(),
                    moved: false,
                    modified: true,
                    untracked: true,
                }],
                detail: String::new(),
            })
        );
        assert!(check_for(&local.0, false, true).is_ok());

        git(&sub, &["commit", "-q", "-am", "lib change"]);
        std::fs::remove_file(sub.join("scratch.txt")).unwrap();
        let Err(CommitPushError::Submodules { submodules, .. }) = check_for(&local.0, false, false)
        else {
            panic!("a moved submodule needs confirmation");
        };
        assert!(submodules[0].moved && !submodules[0].modified);
    }

    #[test]
    fn rejected_credentials_are_reported_as_authentication_failures() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"git\"\r\n\
                      Content-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
        });
        let local = repo("auth");
        let url = format!("http://127.0.0.1:{port}/repo.git");
        git(&local.0, &["remote", "add", "origin", &url]);
        git(&local.0, &["config", "http.proxy", ""]);
        git(&local.0, &["config", "credential.helper", ""]);
        git(&local.0, &["config", "branch.main.remote", "origin"]);
        git(
            &local.0,
            &["config", "branch.main.merge", "refs/heads/main"],
        );
        git(
            &local.0,
            &["update-ref", "refs/remotes/origin/main", "HEAD"],
        );
        std::fs::write(local.0.join("a.txt"), "beta\n").unwrap();
        let error = one_click(&local.0, "Auth").unwrap_err();
        assert!(
            matches!(&error, CommitPushError::AuthFailed { remote, .. } if remote == "origin"),
            "{error:?}"
        );
    }

    #[test]
    fn push_and_commit_errors_are_classified_from_git_output() {
        let github_nff =
            "To github.com:me/app.git\n ! [rejected]        main -> main (fetch first)\n\
            error: failed to push some refs to 'github.com:me/app.git'";
        assert!(is_non_fast_forward(&github_nff.to_lowercase()));
        let protected = " ! [remote rejected] main -> main (protected branch hook declined)";
        assert!(!is_non_fast_forward(&protected.to_lowercase()));
        for auth in [
            "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/me/app.git/'",
            "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            "remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://gitlab.com/me/app.git/'",
            "fatal: unable to access 'https://github.com/me/app.git/': The requested URL returned error: 403",
        ] {
            assert!(is_auth_failure(&auth.to_lowercase()), "{auth}");
        }
        assert!(!is_auth_failure(&github_nff.to_lowercase()));

        let local = repo("classify");
        assert_eq!(
            push_error(
                &local.0,
                "origin",
                "main",
                "fatal: unable to connect".into()
            ),
            failed("push", "fatal: unable to connect")
        );
        assert!(matches!(
            commit_error(&local.0, "error: gpg failed to sign the data".into()),
            CommitPushError::Failed { detail, .. } if detail.contains("couldn't sign")
        ));
    }

    #[test]
    fn default_messages_summarise_the_staged_files() {
        let paths = |names: &[&str]| {
            names
                .iter()
                .map(|name| name.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(default_message(&paths(&["src/app.ts"])), "Update app.ts");
        assert_eq!(
            default_message(&paths(&["a.ts", "lib/b.ts", "c.ts"])),
            "Update a.ts and 2 other files"
        );
    }

    #[test]
    fn errors_serialize_with_a_kind_tag() {
        let json = serde_json::to_value(CommitPushError::NoUpstream {
            remote: "origin".into(),
            branch: "feature".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "noUpstream", "remote": "origin", "branch": "feature" })
        );
        assert_eq!(
            serde_json::to_value(CommitPushError::DetachedHead).unwrap(),
            serde_json::json!({ "kind": "detachedHead" })
        );
    }
}
