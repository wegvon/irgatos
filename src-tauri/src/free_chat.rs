//! The working folder for Chat conversations, which belong to no project.

use std::path::{Path, PathBuf};

/// Kept in sync with `FREE_CHAT_DIR_SUFFIX` in `src/features/freechat/model/freeChat.ts`,
/// which recognises chats by this suffix of their working folder.
const SCRATCH_DIR: [&str; 2] = [".irgatos", "scratch"];

fn scratch_under(base: &Path) -> PathBuf {
    SCRATCH_DIR
        .iter()
        .fold(base.to_path_buf(), |path, part| path.join(part))
}

fn create_private_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Agents may leave notes or downloads here; other users have no business reading them.
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// `~/.irgatos/scratch`, or the same folder under the temp directory when the
/// home folder is missing or read-only.
pub(crate) fn ensure_scratch_dir(home: Option<&Path>, temp: &Path) -> Result<PathBuf, String> {
    if let Some(home) = home.filter(|home| home.is_dir()) {
        let dir = scratch_under(home);
        if create_private_dir(&dir).is_ok() {
            return Ok(dir);
        }
    }
    let dir = scratch_under(temp);
    create_private_dir(&dir)?;
    Ok(dir)
}

#[tauri::command]
pub fn free_chat_scratch_dir() -> Result<String, String> {
    let home = crate::dirs_home().map(PathBuf::from);
    ensure_scratch_dir(home.as_deref(), &std::env::temp_dir())
        .map(|dir| crate::fs::path_to_js(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_scratch_folder_under_home() {
        let home = tempfile::tempdir().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let dir = ensure_scratch_dir(Some(home.path()), temp.path()).unwrap();
        assert_eq!(dir, home.path().join(".irgatos").join("scratch"));
        assert!(dir.is_dir());
        assert!(!temp.path().join(".irgatos").exists());
    }

    #[test]
    fn reuses_an_existing_scratch_folder() {
        let home = tempfile::tempdir().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let first = ensure_scratch_dir(Some(home.path()), temp.path()).unwrap();
        std::fs::write(first.join("note.txt"), "kept").unwrap();
        let second = ensure_scratch_dir(Some(home.path()), temp.path()).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            std::fs::read_to_string(second.join("note.txt")).unwrap(),
            "kept"
        );
    }

    #[test]
    fn falls_back_to_temp_without_a_home_folder() {
        let temp = tempfile::tempdir().unwrap();
        let missing = temp.path().join("no-such-home");
        let dir = ensure_scratch_dir(Some(&missing), temp.path()).unwrap();
        assert_eq!(dir, temp.path().join(".irgatos").join("scratch"));
        assert!(dir.is_dir());
        let none = ensure_scratch_dir(None, temp.path()).unwrap();
        assert_eq!(none, dir);
    }

    #[cfg(unix)]
    #[test]
    fn falls_back_to_temp_when_home_is_read_only() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let temp = tempfile::tempdir().unwrap();
        std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
        let writable = std::fs::create_dir(home.path().join("probe")).is_ok();
        let dir = ensure_scratch_dir(Some(home.path()), temp.path()).unwrap();
        std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        if writable {
            // Running as root ignores the mode bits, so the home folder still wins.
            assert_eq!(dir, home.path().join(".irgatos").join("scratch"));
        } else {
            assert_eq!(dir, temp.path().join(".irgatos").join("scratch"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_scratch_folder_private() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let dir = ensure_scratch_dir(Some(home.path()), temp.path()).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
    }
}
