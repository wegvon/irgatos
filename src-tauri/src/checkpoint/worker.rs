//! Whole-checkout recordings for isolated orchestration workers. A worker runs
//! in its own linked worktree, so every change in that checkout is the
//! worker's: shell commands, generators and structured edits alike. The
//! baseline is captured before the first turn and the result is captured
//! again when the lead reviews it, so integration never depends on which
//! tool events a provider happened to report.
use super::turn::{capture_workspace, run_git};
use super::*;

#[cfg(test)]
mod tests;

const WORKER_FILE: &str = "worker.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRecord {
    /// The worker checkout the session was started in.
    cwd: String,
    /// Shared Git directory, so refs can be removed after the worktree is.
    common: String,
    before: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerReview {
    /// Repository-relative paths the worker changed.
    pub files: Vec<String>,
    /// Changed paths outside the assigned write scope.
    pub out_of_scope: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Side {
    mode: String,
    oid: String,
}

#[derive(Debug)]
struct WorkerChange {
    relative: String,
    before: Option<Side>,
    after: Option<Side>,
}

fn worker_ref(session_id: &str, side: &str) -> String {
    format!("refs/irgat/workers/{session_id}/{side}")
}

fn toplevel(cwd: &str) -> Result<PathBuf, String> {
    let root = project_root(cwd)?;
    let top = run_git(&root, &["rev-parse", "--show-toplevel"])?;
    let top = String::from_utf8(top).map_err(|e| e.to_string())?;
    std::fs::canonicalize(top.trim_end_matches(['\r', '\n'])).map_err(|e| e.to_string())
}

/// The project folder inside the repository, as `pkg/` or empty at the root.
fn project_prefix(cwd: &str) -> Result<String, String> {
    let prefix = run_git(&project_root(cwd)?, &["rev-parse", "--show-prefix"])?;
    Ok(String::from_utf8(prefix)
        .map_err(|e| e.to_string())?
        .trim_end_matches(['\r', '\n'])
        .trim_end_matches('/')
        .to_string())
}

/// Project-relative scopes as repository-relative prefixes. `.` is the
/// whole project folder.
fn repo_scopes(prefix: &str, scopes: &[String]) -> Result<Vec<String>, String> {
    scopes
        .iter()
        .map(|scope| {
            let mut scope = scope.trim().replace('\\', "/");
            while let Some(rest) = scope.strip_prefix("./") {
                scope = rest.to_string();
            }
            let scope = scope.trim_end_matches('/');
            if scope.starts_with('/')
                || scope
                    .split('/')
                    .any(|part| part == ".." || (part.len() == 2 && part.ends_with(':')))
            {
                return Err(format!("Invalid write scope {scope}"));
            }
            Ok(
                match (prefix.is_empty(), scope.is_empty() || scope == ".") {
                    (_, true) => prefix.to_string(),
                    (true, false) => scope.to_string(),
                    (false, false) => format!("{prefix}/{scope}"),
                },
            )
        })
        .collect()
}

fn in_scope(scopes: &[String], relative: &str) -> bool {
    scopes.iter().any(|scope| {
        scope.is_empty()
            || relative == scope
            || relative
                .strip_prefix(scope.as_str())
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

pub(super) fn outside_scopes<'a>(
    cwd: &str,
    scopes: &[String],
    files: impl IntoIterator<Item = &'a String>,
) -> Result<Vec<String>, String> {
    let scopes = repo_scopes(&project_prefix(cwd)?, scopes)?;
    Ok(files
        .into_iter()
        .filter(|relative| !in_scope(&scopes, relative))
        .cloned()
        .collect())
}

fn parse_side(mode: &str, oid: &str) -> Option<Side> {
    (mode != "000000").then(|| Side {
        mode: mode.to_string(),
        oid: oid.to_string(),
    })
}

fn tree_changes(root: &Path, before: &str, after: &str) -> Result<Vec<WorkerChange>, String> {
    let raw = run_git(
        root,
        &[
            "diff-tree",
            "-r",
            "-z",
            "--raw",
            "--no-renames",
            "--no-commit-id",
            before,
            after,
        ],
    )?;
    let mut parts = raw.split(|byte| *byte == 0).filter(|part| !part.is_empty());
    let mut changes = Vec::new();
    while let Some(header) = parts.next() {
        let header = String::from_utf8_lossy(header);
        let fields: Vec<&str> = header.trim_start_matches(':').split(' ').collect();
        let path = parts.next().ok_or("Unexpected end of worker change list")?;
        if fields.len() < 5 {
            return Err(format!("Unexpected worker change entry: {header}"));
        }
        changes.push(WorkerChange {
            relative: String::from_utf8(path.to_vec()).map_err(|e| e.to_string())?,
            before: parse_side(fields[0], fields[2]),
            after: parse_side(fields[1], fields[3]),
        });
    }
    Ok(changes)
}

/// What a checkout file is now, in the same terms Git recorded it.
fn current_side(root: &Path, relative: &str) -> Result<Option<Side>, String> {
    let path = root.join(relative);
    let Ok(meta) = std::fs::symlink_metadata(&path) else {
        return Ok(None);
    };
    if !meta.is_file() {
        return Ok(Some(Side {
            mode: "other".into(),
            oid: String::new(),
        }));
    }
    let oid = run_git(root, &["hash-object", "--", relative])?;
    let executable = file_mode(&path).is_some_and(|mode| mode & 0o111 != 0);
    Ok(Some(Side {
        mode: if executable { "100755" } else { "100644" }.into(),
        oid: String::from_utf8_lossy(&oid).trim().to_string(),
    }))
}

fn unsupported(side: &Option<Side>) -> Option<&'static str> {
    match side.as_ref().map(|side| side.mode.as_str()) {
        Some("120000") => Some("a symbolic link"),
        Some("160000") => Some("a submodule"),
        _ => None,
    }
}

fn with_exec_bit(mode: u32, executable: bool) -> u32 {
    if executable {
        mode | ((mode & 0o444) >> 2)
    } else {
        mode & !0o111
    }
}

impl CheckpointStore {
    fn read_worker(&self, session_id: &str, cwd: &str) -> Result<Option<WorkerRecord>, String> {
        let path = self.session_dir(session_id).join(WORKER_FILE);
        let Ok(bytes) = std::fs::read(&path) else {
            return Ok(None);
        };
        let record: WorkerRecord = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        Ok(same_cwd(&record.cwd, cwd).then_some(record))
    }

    pub(super) fn has_worker(&self, session_id: &str, cwd: &str) -> Result<bool, String> {
        Ok(self.read_worker(session_id, cwd)?.is_some())
    }

    /// Record the worker checkout before its first turn. A retried worker in
    /// the same retained checkout keeps its original baseline.
    pub(super) fn begin_worker(&self, session_id: &str, cwd: &str) -> Result<(), String> {
        let root = toplevel(cwd)?;
        if let Some(record) = self.read_worker(session_id, cwd)? {
            if run_git(
                &root,
                &["cat-file", "-e", &format!("{}^{{commit}}", record.before)],
            )
            .is_ok()
            {
                return Ok(());
            }
        }
        let common = run_git(
            &root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?;
        let common = String::from_utf8(common)
            .map_err(|e| e.to_string())?
            .trim_end_matches(['\r', '\n'])
            .to_string();
        let before = capture_workspace(&root, &worker_ref(session_id, "before"))?;
        let dir = self.session_dir(session_id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        state_file::write_json_atomic(
            &dir.join(WORKER_FILE),
            &WorkerRecord {
                cwd: cwd.to_string(),
                common,
                before,
            },
            false,
        )
    }

    fn worker_changes(
        &self,
        session_id: &str,
        record: &WorkerRecord,
    ) -> Result<(PathBuf, Vec<WorkerChange>), String> {
        let root = toplevel(&record.cwd)?;
        let after = capture_workspace(&root, &worker_ref(session_id, "after"))?;
        let changes = tree_changes(&root, &record.before, &after)?;
        Ok((root, changes))
    }

    /// Every change in the worker checkout, checked against its write scope.
    pub(super) fn review_worker(
        &self,
        session_id: &str,
        cwd: &str,
        scopes: &[String],
    ) -> Result<Option<WorkerReview>, String> {
        let Some(record) = self.read_worker(session_id, cwd)? else {
            return Ok(None);
        };
        let (_, changes) = self.worker_changes(session_id, &record)?;
        let files: Vec<String> = changes.into_iter().map(|change| change.relative).collect();
        let out_of_scope = outside_scopes(cwd, scopes, &files)?;
        Ok(Some(WorkerReview {
            files,
            out_of_scope,
        }))
    }

    pub(super) fn worker_unchanged(&self, session_id: &str, cwd: &str) -> Result<bool, String> {
        let Some(record) = self.read_worker(session_id, cwd)? else {
            return Ok(false);
        };
        Ok(self.worker_changes(session_id, &record)?.1.is_empty())
    }

    /// Copy the worker's recorded delta into the lead checkout. Every path is
    /// checked before any is written, and a path already holding the
    /// worker's result counts as applied, so a retry after a crash is safe.
    pub(super) fn apply_worker(
        &self,
        session_id: &str,
        from_cwd: &str,
        to_cwd: &str,
        scopes: Option<&[String]>,
    ) -> Result<CheckpointApplyResult, String> {
        let record = self
            .read_worker(session_id, from_cwd)?
            .ok_or("This worker has no recoverable change checkpoint")?;
        let (from_root, changes) = self.worker_changes(session_id, &record)?;
        let to_root = toplevel(to_cwd)?;
        if from_root == to_root {
            return Err("An isolated worker cannot be integrated into itself".into());
        }
        if git_head(&from_root)? != git_head(&to_root)? {
            return Err(
                "The worker or lead branch moved while this task was running. The worker worktree was kept for manual review."
                    .into(),
            );
        }
        if let Some(scopes) = scopes {
            let files: Vec<String> = changes
                .iter()
                .map(|change| change.relative.clone())
                .collect();
            let outside = outside_scopes(from_cwd, scopes, &files)?;
            if !outside.is_empty() {
                return Err(format!(
                    "The worker changed files outside its assignment: {}. Nothing was integrated and the worker worktree was kept.",
                    outside.join(", ")
                ));
            }
        }

        let mut writes = Vec::new();
        let mut already_applied = 0;
        for change in &changes {
            let relative = &change.relative;
            if let Some(kind) = unsupported(&change.before).or(unsupported(&change.after)) {
                return Err(format!(
                    "Cannot integrate {relative}: it is {kind}. The worker worktree was kept."
                ));
            }
            if path_contains_symlink(&to_root, relative)
                || path_contains_symlink(&from_root, relative)
            {
                return Err(format!(
                    "Cannot integrate {relative}: the path contains a symbolic link. The worker worktree was kept."
                ));
            }
            let target = current_side(&to_root, relative)?;
            if target == change.after {
                already_applied += 1;
            } else if target == change.before {
                writes.push(change);
            } else {
                return Err(format!(
                    "Cannot integrate {relative}: the lead checkout changed since this worker started. The worker worktree was kept."
                ));
            }
        }

        for change in writes {
            let relative = &change.relative;
            let Some(after) = &change.after else {
                remove_worktree(&to_root, relative)?;
                continue;
            };
            let source = from_root.join(relative);
            let bytes = std::fs::read(&source).map_err(|e| format!("{relative}: {e}"))?;
            let target = to_root.join(relative);
            let mode = file_mode(&target)
                .or_else(|| file_mode(&source))
                .map(|mode| with_exec_bit(mode, after.mode == "100755"));
            write_worktree(&target, &bytes)?;
            set_file_mode(&target, mode)?;
        }
        Ok(CheckpointApplyResult {
            files: changes.into_iter().map(|change| change.relative).collect(),
            already_applied,
        })
    }

    pub(super) fn forget_worker(&self, session_id: &str) -> Result<(), String> {
        let path = self.session_dir(session_id).join(WORKER_FILE);
        let Ok(bytes) = std::fs::read(&path) else {
            return Ok(());
        };
        let record: WorkerRecord = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let common = Path::new(&record.common);
        if common.is_dir() {
            let prefix = format!("refs/irgat/workers/{session_id}/");
            let refs = run_git(common, &["for-each-ref", "--format=%(refname)", &prefix])?;
            for reference in String::from_utf8_lossy(&refs)
                .lines()
                .filter(|reference| reference.starts_with(&prefix))
            {
                run_git(common, &["update-ref", "-d", reference])?;
            }
        }
        std::fs::remove_file(path).map_err(|e| e.to_string())
    }
}
