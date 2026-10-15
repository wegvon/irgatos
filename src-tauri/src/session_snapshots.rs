//! Rolling copies of the session database.
//!
//! SQLite's write-ahead log already survives a crash mid-write; these copies
//! cover the rarer case of a database file that no longer opens (a torn
//! write on power loss, a bad sector, a sync tool truncating it). Such a file
//! is moved aside with its `-wal` and `-shm` companions as
//! `<name>.corrupt-<millis>.bak`, and the newest copy that passes
//! `PRAGMA quick_check` takes its place.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, ErrorCode, OpenFlags};

use crate::state_file;

/// Copies kept beside the database; older ones are deleted.
pub const SNAPSHOTS_KEPT: usize = 3;
/// At most one copy per this interval while sessions are being saved.
pub const SNAPSHOT_INTERVAL: Duration = Duration::from_secs(10 * 60);

const SNAPSHOT_SUFFIX: &str = ".sqlite3";
const COMPANIONS: [&str; 3] = ["", "-wal", "-shm"];

fn display_err(path: &Path, error: impl std::fmt::Display) -> String {
    format!("{}: {error}", path.display())
}

/// Where the copies of `db` live: `<name>.snapshots/` beside it.
pub fn snapshot_dir(db: &Path) -> PathBuf {
    let mut name = db.file_name().unwrap_or_default().to_os_string();
    name.push(".snapshots");
    db.with_file_name(name)
}

/// Copies of `db`, oldest first.
pub fn snapshots(db: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(u128, PathBuf)> = std::fs::read_dir(snapshot_dir(db))
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let stamp = name.strip_suffix(SNAPSHOT_SUFFIX)?.parse().ok()?;
                    Some((stamp, entry.path()))
                })
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found.into_iter().map(|(_, path)| path).collect()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

/// Copies `db` into its snapshot folder through `VACUUM INTO`, which reads
/// one consistent version even while another connection is writing.
pub fn take_snapshot(db: &Path) -> Result<PathBuf, String> {
    let dir = snapshot_dir(db);
    std::fs::create_dir_all(&dir).map_err(|e| display_err(&dir, e))?;
    let temp = tempfile::Builder::new()
        .prefix(".snapshot-")
        .suffix(".tmp")
        .tempfile_in(&dir)
        .map_err(|e| display_err(&dir, e))?
        .into_temp_path();
    let source = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| display_err(db, e))?;
    source
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| display_err(db, e))?;
    source
        .execute("VACUUM INTO ?1", [temp.to_string_lossy()])
        .map_err(|e| display_err(db, e))?;
    drop(source);
    // Windows only flushes a handle opened for writing.
    std::fs::OpenOptions::new()
        .write(true)
        .open(&temp)
        .and_then(|file| file.sync_all())
        .map_err(|e| display_err(&temp, e))?;
    let mut millis = now_millis();
    let mut target = dir.join(format!("{millis}{SNAPSHOT_SUFFIX}"));
    while target.exists() {
        millis += 1;
        target = dir.join(format!("{millis}{SNAPSHOT_SUFFIX}"));
    }
    temp.persist(&target)
        .map_err(|e| display_err(&target, e.error))?;
    prune(db, SNAPSHOTS_KEPT);
    Ok(target)
}

fn prune(db: &Path, keep: usize) {
    let copies = snapshots(db);
    let excess = copies.len().saturating_sub(keep);
    for old in copies.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
}

/// Whether SQLite gave up on the file itself rather than on a query.
pub fn is_corruption(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase)
    )
}

fn passes_check(path: &Path) -> bool {
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return false;
    };
    conn.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .is_ok_and(|result| result == "ok")
}

/// What `recover` did with a database that would not open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recovered {
    /// The database file as it was, kept for inspection.
    pub corrupt: PathBuf,
    /// The copy restored in its place; `None` means it starts empty.
    pub restored_from: Option<PathBuf>,
}

/// Moves a database that would not open aside, with its `-wal` and `-shm`
/// files, and puts the newest copy that still checks out in its place.
pub fn recover(db: &Path) -> Result<Recovered, String> {
    let mut corrupt = None;
    for suffix in COMPANIONS {
        let mut name = db.file_name().unwrap_or_default().to_os_string();
        name.push(suffix);
        let path = db.with_file_name(name);
        if path.exists() {
            let kept = state_file::quarantine(&path)?;
            if suffix.is_empty() {
                corrupt = Some(kept);
            }
        }
    }
    let corrupt = corrupt.ok_or_else(|| format!("{}: no database to recover", db.display()))?;
    let restored_from = snapshots(db)
        .into_iter()
        .rev()
        .find(|copy| passes_check(copy));
    if let Some(copy) = &restored_from {
        let dir = db
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let temp = tempfile::Builder::new()
            .prefix(".restore-")
            .suffix(".tmp")
            .tempfile_in(dir)
            .map_err(|e| display_err(dir, e))?
            .into_temp_path();
        std::fs::copy(copy, &temp).map_err(|e| display_err(copy, e))?;
        temp.persist(db).map_err(|e| display_err(db, e.error))?;
    }
    eprintln!(
        "[session-store] {} would not open; kept it as {} and {}",
        db.display(),
        corrupt.display(),
        match &restored_from {
            Some(copy) => format!("restored {}", copy.display()),
            None => "started empty (no usable snapshot)".into(),
        }
    );
    Ok(Recovered {
        corrupt,
        restored_from,
    })
}

/// Takes a copy on a background thread after a save, at most once per
/// interval and never two at a time.
pub struct Snapshots {
    db: PathBuf,
    interval: Duration,
    last: Mutex<Option<Instant>>,
    running: Arc<AtomicBool>,
}

impl Snapshots {
    pub fn new(db: PathBuf, interval: Duration) -> Self {
        Self {
            db,
            interval,
            last: Mutex::new(None),
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Claims the next copy if one is due. Split from `after_save` so the
    /// throttle can be tested without threads.
    fn claim(&self, now: Instant) -> bool {
        let Ok(mut last) = self.last.lock() else {
            return false;
        };
        if last.is_some_and(|at| now.duration_since(at) < self.interval) {
            return false;
        }
        if self.running.swap(true, Ordering::AcqRel) {
            return false;
        }
        *last = Some(now);
        true
    }

    /// Call after a session save has committed.
    pub fn after_save(&self) {
        if !self.claim(Instant::now()) {
            return;
        }
        let db = self.db.clone();
        let running = Arc::clone(&self.running);
        let spawned = std::thread::Builder::new()
            .name("session-snapshot".into())
            .spawn(move || {
                if let Err(error) = take_snapshot(&db) {
                    eprintln!("[session-store] snapshot failed: {error}");
                }
                running.store(false, Ordering::Release);
            });
        if spawned.is_err() {
            self.running.store(false, Ordering::Release);
        }
    }

    #[cfg(test)]
    fn wait_idle(&self) {
        while self.running.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database(dir: &Path, rows: &[&str]) -> PathBuf {
        let db = dir.join("irgat.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS notes (text TEXT NOT NULL);",
        )
        .unwrap();
        for row in rows {
            conn.execute("INSERT INTO notes (text) VALUES (?1)", [row])
                .unwrap();
        }
        db
    }

    fn rows(db: &Path) -> Vec<String> {
        let conn = Connection::open(db).unwrap();
        let mut statement = conn
            .prepare("SELECT text FROM notes ORDER BY rowid")
            .unwrap();
        let found = statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap();
        found
    }

    #[test]
    fn a_snapshot_is_a_complete_copy_even_while_the_database_is_open() {
        let dir = tempfile::tempdir().unwrap();
        let db = database(dir.path(), &["one", "two"]);
        let writer = Connection::open(&db).unwrap();
        writer
            .execute("INSERT INTO notes (text) VALUES ('three')", [])
            .unwrap();
        let copy = take_snapshot(&db).unwrap();
        assert_eq!(rows(&copy), vec!["one", "two", "three"]);
        assert_eq!(snapshots(&db), vec![copy]);
        let leftovers = std::fs::read_dir(snapshot_dir(&db))
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn only_the_newest_snapshots_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let db = database(dir.path(), &["one"]);
        let taken: Vec<_> = (0..SNAPSHOTS_KEPT + 2)
            .map(|_| take_snapshot(&db).unwrap())
            .collect();
        assert_eq!(snapshots(&db), taken[2..].to_vec());
    }

    #[test]
    fn garbage_in_place_of_the_database_counts_as_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("irgat.db");
        std::fs::write(&db, vec![0x5a; 8192]).unwrap();
        let conn = Connection::open(&db).unwrap();
        let error = conn
            .execute_batch("PRAGMA journal_mode = WAL;")
            .unwrap_err();
        assert!(is_corruption(&error), "{error:?}");
        let busy = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        );
        assert!(!is_corruption(&busy));
    }

    #[test]
    fn a_corrupt_database_is_kept_aside_and_the_newest_good_copy_restored() {
        let dir = tempfile::tempdir().unwrap();
        let db = database(dir.path(), &["one"]);
        take_snapshot(&db).unwrap();
        Connection::open(&db)
            .unwrap()
            .execute("INSERT INTO notes (text) VALUES ('two')", [])
            .unwrap();
        let newest = take_snapshot(&db).unwrap();
        std::fs::write(&newest, b"torn").unwrap();
        let good = snapshots(&db)[0].clone();
        std::fs::write(&db, vec![0x5a; 8192]).unwrap();
        std::fs::write(db.with_file_name("irgat.db-wal"), b"wal").unwrap();

        let recovered = recover(&db).unwrap();
        assert_eq!(recovered.restored_from, Some(good));
        assert_eq!(std::fs::read(&recovered.corrupt).unwrap(), vec![0x5a; 8192]);
        assert!(!db.with_file_name("irgat.db-wal").exists());
        assert_eq!(
            state_file::corrupt_copies(&db.with_file_name("irgat.db-wal")).len(),
            1
        );
        assert_eq!(rows(&db), vec!["one"]);
    }

    #[test]
    fn a_corrupt_database_without_copies_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("irgat.db");
        std::fs::write(&db, b"not a database").unwrap();
        let recovered = recover(&db).unwrap();
        assert_eq!(recovered.restored_from, None);
        assert!(!db.exists());
        assert!(recovered.corrupt.exists());
    }

    #[test]
    fn copies_are_throttled_and_never_overlap() {
        let dir = tempfile::tempdir().unwrap();
        let snapshots = Snapshots::new(dir.path().join("irgat.db"), Duration::from_secs(60));
        let start = Instant::now();
        assert!(snapshots.claim(start));
        assert!(
            !snapshots.claim(start + Duration::from_secs(61)),
            "still running"
        );
        snapshots.running.store(false, Ordering::Release);
        assert!(!snapshots.claim(start + Duration::from_secs(30)));
        assert!(snapshots.claim(start + Duration::from_secs(61)));
    }

    #[test]
    fn saving_takes_a_copy_in_the_background() {
        let dir = tempfile::tempdir().unwrap();
        let db = database(dir.path(), &["one"]);
        let scheduler = Snapshots::new(db.clone(), Duration::from_secs(60));
        scheduler.after_save();
        scheduler.wait_idle();
        scheduler.after_save();
        scheduler.wait_idle();
        assert_eq!(snapshots(&db).len(), 1);
    }
}
