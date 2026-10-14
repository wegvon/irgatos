//! Crash-safe JSON and text state files.
//!
//! Every write goes to a temporary file beside the target, is flushed to
//! disk, and renamed over it, so a crash or power loss leaves either the old
//! file or the new one, never half of each. JSON stores also keep the last
//! good copy as `<name>.bak`. A file that no longer parses is moved aside as
//! `<name>.corrupt-<millis>.bak`, and the last good copy takes its place.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::Serialize;

/// Corrupt copies kept per file; older ones are deleted.
pub const CORRUPT_BACKUPS_KEPT: usize = 3;

/// How a read found the file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Recovery {
    /// The file parsed as it was.
    Clean,
    /// There was no file yet.
    Missing,
    /// The file was malformed; the last good copy replaced it.
    FromBackup { corrupt: PathBuf },
    /// The file was malformed and there was no usable copy to fall back on.
    Reset { corrupt: PathBuf },
}

fn display_err(path: &Path, error: impl std::fmt::Display) -> String {
    format!("{}: {error}", path.display())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{}: not a file path", path.display()))
}

/// The last good copy of `path`.
pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".bak");
    path.with_file_name(name)
}

/// Where a malformed `path` is kept, stamped with `millis`.
pub fn corrupt_path(path: &Path, millis: u128) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".corrupt-{millis}.bak"));
    path.with_file_name(name)
}

#[cfg(unix)]
fn sync_dir(dir: &Path) -> Result<(), String> {
    std::fs::File::open(dir)
        .and_then(|handle| handle.sync_all())
        .map_err(|e| display_err(dir, e))
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) -> Result<(), String> {
    Ok(())
}

/// Replaces `path` with `bytes` in one step. The temporary file is created
/// owner-only and deleted if anything fails before the rename.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| display_err(dir, e))?;
    let prefix = format!(".{}.", file_name(path)?);
    let mut temp = tempfile::Builder::new()
        .prefix(&prefix)
        .suffix(".tmp")
        .tempfile_in(dir)
        .map_err(|e| display_err(dir, e))?;
    temp.write_all(bytes)
        .and_then(|()| temp.as_file().sync_all())
        .map_err(|e| display_err(temp.path(), e))?;
    temp.persist(path).map_err(|e| display_err(path, e.error))?;
    sync_dir(dir)
}

/// Writes `value` as JSON, keeping the file it replaces as the last good copy
/// when that one still parses.
pub fn write_json_atomic(path: &Path, value: &impl Serialize, pretty: bool) -> Result<(), String> {
    let bytes = if pretty {
        serde_json::to_vec_pretty(value)
    } else {
        serde_json::to_vec(value)
    }
    .map_err(|e| e.to_string())?;
    if let Ok(current) = std::fs::read(path) {
        if current != bytes && serde_json::from_slice::<serde_json::Value>(&current).is_ok() {
            write_atomic(&backup_path(path), &current)?;
        }
    }
    write_atomic(path, &bytes)
}

/// Reads JSON from `path`, recovering from a malformed file: it is moved to
/// `<name>.corrupt-<millis>.bak` and the last good copy, if it parses, is
/// restored in its place. `Ok((None, _))` means start empty.
pub fn read_json_or_recover<T: DeserializeOwned>(
    path: &Path,
) -> Result<(Option<T>, Recovery), String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((None, Recovery::Missing));
        }
        Err(error) => return Err(display_err(path, error)),
    };
    match serde_json::from_slice::<T>(&bytes) {
        Ok(value) => Ok((Some(value), Recovery::Clean)),
        Err(error) => {
            let corrupt = quarantine(path)?;
            eprintln!(
                "[state] {} is malformed ({error}); kept it as {}",
                path.display(),
                corrupt.display()
            );
            let backup = backup_path(path);
            if let Ok(saved) = std::fs::read(&backup) {
                if let Ok(value) = serde_json::from_slice::<T>(&saved) {
                    write_atomic(path, &saved)?;
                    return Ok((Some(value), Recovery::FromBackup { corrupt }));
                }
            }
            Ok((None, Recovery::Reset { corrupt }))
        }
    }
}

/// Moves `path` aside as a timestamped corrupt copy and prunes old ones.
pub fn quarantine(path: &Path) -> Result<PathBuf, String> {
    let mut millis = now_millis();
    let mut corrupt = corrupt_path(path, millis);
    while corrupt.exists() {
        millis += 1;
        corrupt = corrupt_path(path, millis);
    }
    std::fs::rename(path, &corrupt).map_err(|e| display_err(path, e))?;
    prune_corrupt(path, CORRUPT_BACKUPS_KEPT);
    Ok(corrupt)
}

/// Corrupt copies of `path`, oldest first.
pub fn corrupt_copies(path: &Path) -> Vec<PathBuf> {
    let (Some(dir), Ok(name)) = (path.parent(), file_name(path)) else {
        return Vec::new();
    };
    let dir = if dir.as_os_str().is_empty() {
        Path::new(".")
    } else {
        dir
    };
    let prefix = format!("{name}.corrupt-");
    let mut found: Vec<(u128, PathBuf)> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let entry_name = entry.file_name().to_string_lossy().into_owned();
                    let stamp = entry_name.strip_prefix(&prefix)?.strip_suffix(".bak")?;
                    Some((stamp.parse().ok()?, entry.path()))
                })
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found.into_iter().map(|(_, path)| path).collect()
}

fn prune_corrupt(path: &Path, keep: usize) {
    let copies = corrupt_copies(path);
    let excess = copies.len().saturating_sub(keep);
    for old in copies.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
    struct Index {
        names: Vec<String>,
    }

    fn index(names: &[&str]) -> Index {
        Index {
            names: names.iter().map(|name| name.to_string()).collect(),
        }
    }

    #[test]
    fn write_atomic_replaces_the_file_and_leaves_no_temporary_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/state.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
        let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(leftovers, vec!["state.json".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn write_atomic_creates_owner_only_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.json");
        write_atomic(&path, b"{}").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn write_atomic_keeps_the_old_file_when_the_target_cannot_be_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("taken");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("inside"), b"x").unwrap();
        assert!(write_atomic(&path, b"data").is_err());
        assert!(path.join("inside").is_file());
        let temporaries = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(temporaries, 0);
    }

    #[test]
    fn json_writes_keep_the_previous_good_copy() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        write_json_atomic(&path, &index(&["a"]), false).unwrap();
        assert!(!backup_path(&path).exists());
        write_json_atomic(&path, &index(&["a", "b"]), true).unwrap();
        let saved: Index =
            serde_json::from_slice(&std::fs::read(backup_path(&path)).unwrap()).unwrap();
        assert_eq!(saved, index(&["a"]));
    }

    #[test]
    fn json_writes_do_not_back_up_a_malformed_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        write_json_atomic(&path, &index(&["good"]), false).unwrap();
        write_json_atomic(&path, &index(&["newer"]), false).unwrap();
        std::fs::write(&path, b"{ broken").unwrap();
        write_json_atomic(&path, &index(&["latest"]), false).unwrap();
        let saved: Index =
            serde_json::from_slice(&std::fs::read(backup_path(&path)).unwrap()).unwrap();
        assert_eq!(saved, index(&["good"]));
    }

    #[test]
    fn reading_a_missing_file_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        let (value, recovery) =
            read_json_or_recover::<Index>(&dir.path().join("none.json")).unwrap();
        assert_eq!(value, None);
        assert_eq!(recovery, Recovery::Missing);
    }

    #[test]
    fn a_malformed_file_is_kept_aside_and_the_last_good_copy_restored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        write_json_atomic(&path, &index(&["a"]), false).unwrap();
        write_json_atomic(&path, &index(&["a", "b"]), false).unwrap();
        std::fs::write(&path, b"{\"names\": [\"a\", ").unwrap();

        let (value, recovery) = read_json_or_recover::<Index>(&path).unwrap();
        assert_eq!(value, Some(index(&["a"])));
        let Recovery::FromBackup { corrupt } = recovery else {
            panic!("expected a backup recovery, got {recovery:?}");
        };
        assert_eq!(std::fs::read(&corrupt).unwrap(), b"{\"names\": [\"a\", ");
        let name = corrupt.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with("index.json.corrupt-") && name.ends_with(".bak"),
            "{name}"
        );
        let restored: Index = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(restored, index(&["a"]));
        assert_eq!(
            read_json_or_recover::<Index>(&path).unwrap().1,
            Recovery::Clean
        );
    }

    #[test]
    fn a_malformed_file_without_a_good_copy_resets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        std::fs::write(&path, b"not json").unwrap();
        std::fs::write(backup_path(&path), b"also not json").unwrap();
        let (value, recovery) = read_json_or_recover::<Index>(&path).unwrap();
        assert_eq!(value, None);
        assert!(matches!(recovery, Recovery::Reset { .. }));
        assert!(!path.exists());
    }

    #[test]
    fn a_wrong_shape_counts_as_malformed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        std::fs::write(&path, b"[1, 2, 3]").unwrap();
        let (value, recovery) = read_json_or_recover::<Index>(&path).unwrap();
        assert_eq!(value, None);
        assert!(matches!(recovery, Recovery::Reset { .. }));
    }

    #[test]
    fn only_the_newest_corrupt_copies_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.json");
        for stamp in [10u128, 20, 30] {
            std::fs::write(corrupt_path(&path, stamp), b"old").unwrap();
        }
        std::fs::write(dir.path().join("other.json.corrupt-1.bak"), b"other").unwrap();
        std::fs::write(&path, b"broken").unwrap();
        let corrupt = quarantine(&path).unwrap();
        let kept = corrupt_copies(&path);
        assert_eq!(kept.len(), CORRUPT_BACKUPS_KEPT);
        assert_eq!(kept.last(), Some(&corrupt));
        assert!(!corrupt_path(&path, 10).exists());
        assert!(dir.path().join("other.json.corrupt-1.bak").exists());
    }
}
