use super::*;

struct Fixture {
    dir: PathBuf,
    lead: PathBuf,
    store: CheckpointStore,
}

impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("irgat-worker-test-{}", uuid::Uuid::new_v4()));
        let lead = dir.join("repo");
        std::fs::create_dir_all(lead.join("src")).unwrap();
        for args in [
            &["init", "-b", "main"][..],
            &["config", "user.name", "Test"],
            &["config", "user.email", "test@example.invalid"],
            &["config", "core.autocrlf", "false"],
        ] {
            run_git(&lead, args).unwrap();
        }
        std::fs::write(lead.join("README.md"), "readme\n").unwrap();
        std::fs::write(lead.join("src/a.txt"), "original\n").unwrap();
        std::fs::write(lead.join("src/old.txt"), "remove me\n").unwrap();
        std::fs::write(lead.join("src/tool.sh"), "#!/bin/sh\necho hi\n").unwrap();
        run_git(&lead, &["add", "."]).unwrap();
        run_git(&lead, &["commit", "-m", "initial"]).unwrap();
        Self {
            store: CheckpointStore::new(dir.join("checkpoints")),
            dir,
            lead,
        }
    }

    fn lead_cwd(&self) -> &str {
        self.lead.to_str().unwrap()
    }

    /// A real orchestration worktree, seeded the way the app seeds it.
    fn worker(&self, task: &str) -> PathBuf {
        let tree =
            crate::worktrees::create_seeded(&self.lead, &format!("irgat/orch-{task}")).unwrap();
        PathBuf::from(tree.path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

#[cfg(unix)]
fn mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

#[test]
fn worker_without_a_baseline_still_reports_the_missing_checkpoint() {
    // The regression this module fixes: nothing recorded the worker, so a
    // real change could never be accepted.
    let f = Fixture::new();
    let worker = f.worker("nobaseline");
    std::fs::write(worker.join("src/a.txt"), "worker change\n").unwrap();
    let error = f
        .store
        .apply("w", worker.to_str().unwrap(), f.lead_cwd(), None)
        .unwrap_err();
    assert!(error.contains("no recoverable change checkpoint"));
    assert_eq!(read(&f.lead.join("src/a.txt")), "original\n");
}

#[test]
fn shell_changes_in_a_real_worktree_integrate_into_the_lead() {
    let f = Fixture::new();
    // Uncommitted lead work is part of the worker's starting point.
    std::fs::write(f.lead.join("src/a.txt"), "lead draft\n").unwrap();
    std::fs::write(f.lead.join(".gitignore"), "node_modules/\n").unwrap();
    std::fs::create_dir_all(f.lead.join("node_modules/dep")).unwrap();
    std::fs::write(f.lead.join("node_modules/dep/index.js"), "1\n").unwrap();
    // The same sequence the app runs before a worker's first turn.
    let worker = f.worker("endtoend");
    let cwd = worker.to_str().unwrap();
    let env = crate::worktree_lifecycle::prepare_worker(
        &f.lead,
        &worker,
        std::time::Duration::from_secs(30),
    )
    .unwrap();
    assert_eq!(env.dependencies, ["node_modules"]);
    f.store.begin_worker("w", cwd).unwrap();
    assert!(f.store.cleanup_safe("w", cwd).unwrap());

    // No structured edit events: plain filesystem writes, as a shell would.
    std::fs::write(worker.join("src/a.txt"), "lead draft\nworker line\n").unwrap();
    std::fs::write(worker.join("src/new.txt"), "brand new\n").unwrap();
    std::fs::remove_file(worker.join("src/old.txt")).unwrap();
    #[cfg(unix)]
    set_mode(&worker.join("src/tool.sh"), 0o755);

    // Retrying the worker in its retained checkout keeps the first baseline.
    f.store.begin_worker("w", cwd).unwrap();
    let review = f
        .store
        .review_worker("w", cwd, &["src".to_string()])
        .unwrap()
        .unwrap();
    let mut expected = vec!["src/a.txt", "src/new.txt", "src/old.txt"];
    if cfg!(unix) {
        expected.push("src/tool.sh");
    }
    assert_eq!(review.files, expected);
    assert!(review.out_of_scope.is_empty());
    assert!(!f.store.cleanup_safe("w", cwd).unwrap());

    let scopes = ["src".to_string()];
    let applied = f
        .store
        .apply("w", cwd, f.lead_cwd(), Some(&scopes))
        .unwrap();
    assert_eq!(applied.files, expected);
    assert_eq!(applied.already_applied, 0);
    assert_eq!(read(&f.lead.join("src/a.txt")), "lead draft\nworker line\n");
    assert_eq!(read(&f.lead.join("src/new.txt")), "brand new\n");
    assert!(!f.lead.join("src/old.txt").exists());
    #[cfg(unix)]
    assert_eq!(mode(&f.lead.join("src/tool.sh")) & 0o111, 0o111);

    // Integration is idempotent, so a crash mid-way can simply be retried.
    let retried = f
        .store
        .apply("w", cwd, f.lead_cwd(), Some(&scopes))
        .unwrap();
    assert_eq!(retried.already_applied, expected.len());

    crate::worktrees::remove(&f.lead, &worker, true).unwrap();
    f.store.forget("w").unwrap();
    let refs = run_git(&f.lead, &["for-each-ref", "refs/irgat/workers/"]).unwrap();
    assert!(refs.is_empty());
}

#[test]
fn out_of_scope_shell_writes_are_reported_and_never_integrated() {
    let f = Fixture::new();
    let worker = f.worker("scope");
    let cwd = worker.to_str().unwrap();
    f.store.begin_worker("w", cwd).unwrap();
    std::fs::write(worker.join("src/a.txt"), "in scope\n").unwrap();
    std::fs::write(worker.join("README.md"), "escaped through a shell\n").unwrap();
    let scopes = ["src/".to_string()];
    let review = f.store.review_worker("w", cwd, &scopes).unwrap().unwrap();
    assert_eq!(review.out_of_scope, ["README.md"]);
    let error = f
        .store
        .apply("w", cwd, f.lead_cwd(), Some(&scopes))
        .unwrap_err();
    assert!(error.contains("outside its assignment: README.md"));
    assert_eq!(read(&f.lead.join("src/a.txt")), "original\n");
    assert_eq!(read(&f.lead.join("README.md")), "readme\n");
    // `.` owns the whole project.
    assert!(f
        .store
        .review_worker("w", cwd, &[".".to_string()])
        .unwrap()
        .unwrap()
        .out_of_scope
        .is_empty());
}

#[test]
fn a_lead_change_to_the_same_file_blocks_integration_before_any_write() {
    let f = Fixture::new();
    let worker = f.worker("conflict");
    let cwd = worker.to_str().unwrap();
    f.store.begin_worker("w", cwd).unwrap();
    std::fs::write(worker.join("src/new.txt"), "worker\n").unwrap();
    std::fs::write(worker.join("src/a.txt"), "worker\n").unwrap();
    std::fs::write(f.lead.join("src/a.txt"), "lead edit\n").unwrap();
    let error = f.store.apply("w", cwd, f.lead_cwd(), None).unwrap_err();
    assert!(error.contains("src/a.txt"));
    assert!(!f.lead.join("src/new.txt").exists());
    assert_eq!(read(&f.lead.join("src/a.txt")), "lead edit\n");
}

#[test]
fn scopes_are_relative_to_a_project_inside_the_repository() {
    assert_eq!(
        repo_scopes("pkg", &[".".into(), "./src/".into()]).unwrap(),
        ["pkg", "pkg/src"]
    );
    assert_eq!(repo_scopes("", &[".".to_string()]).unwrap(), [""]);
    assert!(repo_scopes("", &["../x".into()]).is_err());
    assert!(repo_scopes("", &["/etc".into()]).is_err());
    let scopes = repo_scopes("pkg", &["src".into()]).unwrap();
    assert!(in_scope(&scopes, "pkg/src/a.ts"));
    assert!(!in_scope(&scopes, "pkg/srcx/a.ts"));
    assert!(!in_scope(&scopes, "other/src/a.ts"));
}
