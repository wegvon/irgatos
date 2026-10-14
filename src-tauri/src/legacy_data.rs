//! One-time import of data the app wrote under its pre-Irgat names.
//!
//! Older builds kept the session database in `monocode.db`, the Irgat agent
//! folders in `monos/`, the private Codex storage in `codex-monos/`, and named
//! the Irgat tables and a few persisted block fields after "mono". Nothing here
//! deletes or rewrites the legacy copy on disk: the new location is built from
//! it, and when both exist the new one wins on conflict.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags};
use serde_json::Value;

pub(crate) const DB_FILE: &str = "irgat.db";
pub(crate) const LEGACY_DB_FILE: &str = "monocode.db";
const DB_MARKER: &str = "monocode.db";

/// Directories inside the app data folder, legacy name first.
const DATA_DIRS: [(&str, &str); 2] = [("monos", "irgats"), ("codex-monos", "codex-irgats")];

/// Hidden entries in each private Codex account folder, legacy name first.
const CODEX_HOME_ENTRIES: [(&str, &str); 2] = [
    (".monocode-migrations", ".irgat-migrations"),
    (".monocode-agent-state", ".irgat-agent-state"),
];

const TABLE_RENAMES: [(&str, &str); 3] = [
    ("mono_transcripts", "irgat_transcripts"),
    ("mono_turns", "irgat_turns"),
    ("mono_blocks", "irgat_blocks"),
];

/// Top-level keys of a persisted session block or queued message.
const BLOCK_KEY_RENAMES: [(&str, &str); 6] = [
    ("monoSessionCompletion", "irgatSessionCompletion"),
    ("monoSpawnedSessions", "irgatSpawnedSessions"),
    ("monoHabit", "irgatHabit"),
    ("monoCard", "irgatCard"),
    ("monoReaction", "irgatReaction"),
    ("monocode", "irgat"),
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DatabaseImport {
    /// No legacy database on disk.
    NothingToImport,
    /// The new database did not exist; it is now a converted copy of the legacy one.
    Copied,
    /// Both existed; rows missing from the new database were added from the legacy one.
    Merged,
    /// Both existed and the legacy rows were already merged on an earlier start.
    AlreadyMerged,
}

/// Bundle identifier the app shipped under before it became Irgatos.
pub(crate) const LEGACY_IDENTIFIER: &str = "com.monocode.desktop";
/// Bundle identifier of this build; must match `identifier` in `tauri.conf.json`.
pub(crate) const IDENTIFIER: &str = "com.irgatos.desktop";

/// The OS keys the app's folders (data, config, cache, WebKit/WebView2 storage)
/// by bundle identifier, so a new identifier would start from empty folders.
/// Copies each `<root>/<legacy id>` to `<root>/<new id>` and each
/// `<root>/<legacy id>.plist` to `<root>/<new id>.plist`. It must run before
/// the app or its webview creates the new folders.
///
/// Like the rest of this module it only copies: the legacy folder stays in
/// place, a new folder that already has files keeps them, and a marker inside
/// the new folder stops the import from repeating.
pub(crate) fn import_identifier_folders(roots: &[PathBuf]) -> Vec<String> {
    let mut notes = Vec::new();
    for root in roots {
        match import_identifier_folder(root, LEGACY_IDENTIFIER, IDENTIFIER) {
            Ok(true) => notes.push(format!(
                "imported {LEGACY_IDENTIFIER} from {}",
                root.display()
            )),
            Ok(false) => {}
            Err(e) => eprintln!(
                "irgat: could not import {LEGACY_IDENTIFIER} from {}: {e}",
                root.display()
            ),
        }
        let from = root.join(format!("{LEGACY_IDENTIFIER}.plist"));
        let to = root.join(format!("{IDENTIFIER}.plist"));
        if from.is_file() && to.symlink_metadata().is_err() {
            if let Err(e) = std::fs::copy(&from, &to) {
                eprintln!("irgat: could not copy {}: {e}", from.display());
            }
        }
    }
    notes
}

fn import_identifier_folder(root: &Path, legacy: &str, current: &str) -> Result<bool, String> {
    let from = root.join(legacy);
    let to = root.join(current);
    let marker = to.join(format!(".imported-from-{legacy}"));
    if !from.is_dir() || marker.exists() {
        return Ok(false);
    }
    if to.exists() {
        copy_missing(&from, &to).map_err(|e| e.to_string())?;
    } else {
        let staging = root.join(format!("{current}.importing"));
        if staging.exists() {
            std::fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
        }
        copy_missing(&from, &staging).map_err(|e| e.to_string())?;
        std::fs::rename(&staging, &to).map_err(|e| e.to_string())?;
    }
    std::fs::write(&marker, b"").map_err(|e| e.to_string())?;
    Ok(true)
}

/// Folders that hold per-identifier app state on this OS.
pub(crate) fn identifier_roots() -> Vec<PathBuf> {
    let var = |name: &str| {
        std::env::var_os(name)
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
    };
    let mut roots = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(home) = var("HOME") {
        let library = home.join("Library");
        for name in [
            "Application Support",
            "Caches",
            "WebKit",
            "HTTPStorages",
            "Preferences",
        ] {
            roots.push(library.join(name));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(home) = var("HOME") {
        for (xdg, fallback) in [
            ("XDG_DATA_HOME", ".local/share"),
            ("XDG_CONFIG_HOME", ".config"),
            ("XDG_CACHE_HOME", ".cache"),
        ] {
            roots.push(var(xdg).unwrap_or_else(|| home.join(fallback)));
        }
    }
    #[cfg(windows)]
    for name in ["APPDATA", "LOCALAPPDATA"] {
        roots.extend(var(name));
    }
    roots
}

/// Imports everything under `data_dir`. A failure is reported and skipped so
/// the app still starts; the legacy files are left where they were.
pub(crate) fn import_legacy_data(data_dir: &Path) -> Vec<String> {
    let mut notes = Vec::new();
    for (legacy, current) in DATA_DIRS {
        match import_directory(data_dir, legacy, current) {
            Ok(true) => notes.push(format!("imported {legacy}/ into {current}/")),
            Ok(false) => {}
            Err(e) => eprintln!("irgat: could not import {legacy}/: {e}"),
        }
    }
    match import_database(data_dir) {
        Ok(DatabaseImport::Copied) => notes.push(format!("copied {LEGACY_DB_FILE} to {DB_FILE}")),
        Ok(DatabaseImport::Merged) => {
            notes.push(format!("merged {LEGACY_DB_FILE} into {DB_FILE}"));
        }
        Ok(_) => {}
        Err(e) => eprintln!("irgat: could not import {LEGACY_DB_FILE}: {e}"),
    }
    notes
}

fn import_directory(data_dir: &Path, legacy: &str, current: &str) -> Result<bool, String> {
    let from = data_dir.join(legacy);
    let to = data_dir.join(current);
    let marker = to.join(format!(".imported-from-{legacy}"));
    if !from.is_dir() || marker.exists() {
        return Ok(false);
    }
    if to.exists() {
        copy_missing(&from, &to).map_err(|e| e.to_string())?;
    } else {
        let staging = data_dir.join(format!("{current}.importing"));
        if staging.exists() {
            std::fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
        }
        copy_missing(&from, &staging).map_err(|e| e.to_string())?;
        std::fs::rename(&staging, &to).map_err(|e| e.to_string())?;
    }
    if current == "codex-irgats" {
        for account in std::fs::read_dir(&to).map_err(|e| e.to_string())?.flatten() {
            if account.path().is_dir() {
                rename_codex_entries(&account.path());
            }
        }
    }
    std::fs::write(&marker, b"").map_err(|e| e.to_string())?;
    Ok(true)
}

fn rename_codex_entries(account: &Path) {
    for (legacy, current) in CODEX_HOME_ENTRIES {
        let from = account.join(legacy);
        let to = account.join(current);
        if from.exists() && !to.exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }
}

/// Copies files that `dst` does not have yet; never overwrites.
fn copy_missing(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_missing(&from, &to)?;
        } else if to.symlink_metadata().is_err() {
            if kind.is_symlink() {
                copy_symlink(&from, &to)?;
            } else {
                std::fs::copy(&from, &to)?;
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn copy_symlink(from: &Path, to: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(std::fs::read_link(from)?, to)
}

#[cfg(not(unix))]
fn copy_symlink(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::copy(from, to).map(|_| ())
}

pub(crate) fn import_database(data_dir: &Path) -> Result<DatabaseImport, String> {
    let legacy = data_dir.join(LEGACY_DB_FILE);
    let current = data_dir.join(DB_FILE);
    if !legacy.is_file() {
        return Ok(DatabaseImport::NothingToImport);
    }
    if !current.exists() {
        snapshot_database(&legacy, &current)?;
        let conn = Connection::open(&current).map_err(|e| e.to_string())?;
        convert_legacy_schema(&conn).map_err(|e| e.to_string())?;
        record_import(&conn).map_err(|e| e.to_string())?;
        return Ok(DatabaseImport::Copied);
    }
    let conn = Connection::open(&current).map_err(|e| e.to_string())?;
    ensure_marker_table(&conn).map_err(|e| e.to_string())?;
    if import_recorded(&conn).map_err(|e| e.to_string())? {
        return Ok(DatabaseImport::AlreadyMerged);
    }
    merge_legacy_rows(&conn, &legacy).map_err(|e| e.to_string())?;
    record_import(&conn).map_err(|e| e.to_string())?;
    Ok(DatabaseImport::Merged)
}

/// A consistent single-file copy: the legacy database may still be in WAL mode
/// with recent writes that are not in the main file.
fn snapshot_database(from: &Path, to: &Path) -> Result<(), String> {
    let staging = to.with_extension("db.importing");
    for suffix in ["", "-wal", "-shm"] {
        let mut name = staging.clone().into_os_string();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
    let vacuumed = Connection::open_with_flags(from, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .and_then(|conn| conn.execute("VACUUM INTO ?1", [staging.to_string_lossy().as_ref()]));
    if let Err(e) = vacuumed {
        eprintln!(
            "irgat: snapshotting {} failed ({e}); copying the file",
            from.display()
        );
        std::fs::copy(from, &staging).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&staging, to).map_err(|e| e.to_string())
}

fn ensure_marker_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS legacy_imports (
           name TEXT PRIMARY KEY,
           applied_at INTEGER NOT NULL
         );",
    )
}

fn import_recorded(conn: &Connection) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM legacy_imports WHERE name = ?1)",
        [DB_MARKER],
        |row| row.get(0),
    )
}

fn record_import(conn: &Connection) -> rusqlite::Result<()> {
    ensure_marker_table(conn)?;
    conn.execute(
        "INSERT OR IGNORE INTO legacy_imports (name, applied_at) VALUES (?1, strftime('%s','now') * 1000)",
        [DB_MARKER],
    )?;
    Ok(())
}

fn table_exists(conn: &Connection, schema: &str, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {schema}.sqlite_master WHERE type = 'table' AND name = ?1)"),
        [name],
        |row| row.get(0),
    )
}

/// Renames the Irgat transcript tables of a database that has only the legacy
/// names, then moves persisted block fields to their new names.
pub(crate) fn convert_legacy_schema(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (legacy, current) in TABLE_RENAMES {
        if table_exists(&tx, "main", legacy)? && !table_exists(&tx, "main", current)? {
            tx.execute_batch(&format!("ALTER TABLE {legacy} RENAME TO {current};"))?;
        }
    }
    tx.execute_batch("DROP INDEX IF EXISTS mono_blocks_user;")?;
    tx.commit()?;
    rewrite_block_keys(conn)
}

fn columns(conn: &Connection, schema: &str, table: &str) -> rusqlite::Result<Vec<(String, bool)>> {
    let mut statement = conn.prepare(&format!("PRAGMA {schema}.table_info(\"{table}\")"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(5)? > 0))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Adds rows the legacy database has and the current one lacks. Rows that
/// share a primary key keep the current version.
fn merge_legacy_rows(conn: &Connection, legacy: &Path) -> rusqlite::Result<()> {
    conn.execute(
        "ATTACH DATABASE ?1 AS legacy",
        [legacy.to_string_lossy().as_ref()],
    )?;
    let result = merge_attached(conn);
    let detached = conn.execute_batch("DETACH DATABASE legacy;");
    result?;
    detached?;
    rewrite_block_keys(conn)
}

fn merge_attached(conn: &Connection) -> rusqlite::Result<()> {
    let tables: Vec<String> = conn
        .prepare(
            "SELECT name FROM legacy.sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations', 'legacy_imports')",
        )?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let merged = (|| {
        let tx = conn.unchecked_transaction()?;
        for table in &tables {
            let target = TABLE_RENAMES
                .iter()
                .find(|(legacy, _)| legacy == table)
                .map_or(table.as_str(), |(_, current)| *current);
            if !table_exists(&tx, "main", target)? {
                continue;
            }
            let current = columns(&tx, "main", target)?;
            if !current.iter().any(|(_, primary)| *primary) {
                eprintln!("irgat: not merging {table}: the table has no primary key");
                continue;
            }
            let legacy_names: HashSet<String> = columns(&tx, "legacy", table)?
                .into_iter()
                .map(|(name, _)| name)
                .collect();
            let shared: Vec<String> = current
                .into_iter()
                .map(|(name, _)| name)
                .filter(|name| legacy_names.contains(name))
                .map(|name| format!("\"{name}\""))
                .collect();
            if shared.is_empty() {
                continue;
            }
            let list = shared.join(", ");
            tx.execute_batch(&format!(
                "INSERT OR IGNORE INTO main.\"{target}\" ({list}) SELECT {list} FROM legacy.\"{table}\";"
            ))?;
        }
        tx.commit()
    })();
    if foreign_keys != 0 {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    }
    merged
}

/// Renames the legacy keys on one block or queued message. Returns whether
/// anything changed. A key already present under the new name wins.
pub(crate) fn rename_block_keys(value: &mut Value) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for (legacy, current) in BLOCK_KEY_RENAMES {
        if let Some(moved) = object.remove(legacy) {
            object.entry(current).or_insert(moved);
            changed = true;
        }
    }
    changed
}

fn rewrite_array(text: &str) -> Option<String> {
    let mut value: Value = serde_json::from_str(text).ok()?;
    let mut changed = false;
    for item in value.as_array_mut()? {
        changed |= rename_block_keys(item);
    }
    changed.then(|| value.to_string())
}

pub(crate) fn rewrite_block_keys(conn: &Connection) -> rusqlite::Result<()> {
    const LEGACY_KEY_PATTERN: &str = "%\"mono%";
    if table_exists(conn, "main", "sessions")? {
        let rows: Vec<(String, String, String)> = conn
            .prepare(
                "SELECT id, blocks_json, queued_messages_json FROM sessions
                 WHERE blocks_json LIKE ?1 OR queued_messages_json LIKE ?1",
            )?
            .query_map([LEGACY_KEY_PATTERN], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        for (id, blocks, queued) in rows {
            let blocks = rewrite_array(&blocks);
            let queued = rewrite_array(&queued);
            if blocks.is_none() && queued.is_none() {
                continue;
            }
            conn.execute(
                "UPDATE sessions SET blocks_json = COALESCE(?2, blocks_json),
                   queued_messages_json = COALESCE(?3, queued_messages_json) WHERE id = ?1",
                params![id, blocks, queued],
            )?;
        }
    }
    if table_exists(conn, "main", "irgat_blocks")? {
        let rows: Vec<(String, i64, String)> = conn
            .prepare(
                "SELECT session_id, seq, block_json FROM irgat_blocks WHERE block_json LIKE ?1",
            )?
            .query_map([LEGACY_KEY_PATTERN], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        for (session_id, seq, text) in rows {
            let Ok(mut block) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            if rename_block_keys(&mut block) {
                conn.execute(
                    "UPDATE irgat_blocks SET block_json = ?3 WHERE session_id = ?1 AND seq = ?2",
                    params![session_id, seq, block.to_string()],
                )?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("irgat-legacy-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const SESSIONS: &str = "CREATE TABLE sessions (
        id TEXT PRIMARY KEY, blocks_json TEXT NOT NULL DEFAULT '[]',
        queued_messages_json TEXT NOT NULL DEFAULT '[]');";

    fn legacy_database(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
            .unwrap();
        conn.execute_batch(SESSIONS).unwrap();
        conn.execute_batch(
            "CREATE TABLE mono_transcripts (
               session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE);
             CREATE TABLE mono_turns (
               session_id TEXT NOT NULL REFERENCES mono_transcripts(session_id) ON DELETE CASCADE,
               seq INTEGER NOT NULL, PRIMARY KEY (session_id, seq));
             CREATE TABLE mono_blocks (
               session_id TEXT NOT NULL REFERENCES mono_transcripts(session_id) ON DELETE CASCADE,
               seq INTEGER NOT NULL, block_json TEXT NOT NULL,
               PRIMARY KEY (session_id, seq));
             CREATE INDEX mono_blocks_user ON mono_blocks(session_id);
             CREATE TABLE kanban_cards (id TEXT PRIMARY KEY, title TEXT NOT NULL);
             INSERT INTO kanban_cards VALUES ('card-1', 'Ship it');",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions VALUES ('s1', ?1, ?2)",
            params![
                json!([{"id": "b1", "monoHabit": {"id": "h", "name": "n", "at": 1}, "text": "monoHabit stays in text"}]).to_string(),
                json!([{"id": "q1", "monoSessionCompletion": {"sessionId": "x"}}]).to_string()
            ],
        )
        .unwrap();
        conn.execute("INSERT INTO sessions VALUES ('mono-chat', '[]', '[]')", [])
            .unwrap();
        conn.execute("INSERT INTO mono_transcripts VALUES ('mono-chat')", [])
            .unwrap();
        conn.execute("INSERT INTO mono_turns VALUES ('mono-chat', 1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO mono_blocks VALUES ('mono-chat', 1, ?1)",
            [json!({"id": "c", "monoCard": {"kind": "x"}, "monocode": true}).to_string()],
        )
        .unwrap();
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn old_database_present_and_new_absent_is_copied_and_converted() {
        let dir = scratch("copy");
        legacy_database(&dir.join(LEGACY_DB_FILE));

        assert_eq!(import_database(&dir).unwrap(), DatabaseImport::Copied);

        let conn = Connection::open(dir.join(DB_FILE)).unwrap();
        assert_eq!(count(&conn, "SELECT count(*) FROM irgat_blocks"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM irgat_turns"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM irgat_transcripts"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT count(*) FROM sqlite_master WHERE name LIKE 'mono_%'"
            ),
            0
        );
        assert_eq!(count(&conn, "SELECT count(*) FROM kanban_cards"), 1);
        let block: String = conn
            .query_row("SELECT block_json FROM irgat_blocks", [], |row| row.get(0))
            .unwrap();
        let block: Value = serde_json::from_str(&block).unwrap();
        assert_eq!(block["irgatCard"]["kind"], "x");
        assert_eq!(block["irgat"], true);
        assert!(block.get("monoCard").is_none());
        let (blocks, queued): (String, String) = conn
            .query_row(
                "SELECT blocks_json, queued_messages_json FROM sessions WHERE id = 's1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let blocks: Value = serde_json::from_str(&blocks).unwrap();
        assert_eq!(blocks[0]["irgatHabit"]["name"], "n");
        assert_eq!(blocks[0]["text"], "monoHabit stays in text");
        let queued: Value = serde_json::from_str(&queued).unwrap();
        assert_eq!(queued[0]["irgatSessionCompletion"]["sessionId"], "x");
        assert!(dir.join(LEGACY_DB_FILE).is_file(), "legacy file is kept");
        let legacy = Connection::open(dir.join(LEGACY_DB_FILE)).unwrap();
        assert_eq!(count(&legacy, "SELECT count(*) FROM mono_blocks"), 1);
    }

    #[test]
    fn schema_conversion_keeps_the_transcript_foreign_keys_working() {
        let dir = scratch("fk");
        legacy_database(&dir.join(LEGACY_DB_FILE));
        import_database(&dir).unwrap();

        let conn = Connection::open(dir.join(DB_FILE)).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute(
            "DELETE FROM irgat_transcripts WHERE session_id = 'mono-chat'",
            [],
        )
        .unwrap();
        assert_eq!(count(&conn, "SELECT count(*) FROM irgat_blocks"), 0);
    }

    #[test]
    fn nothing_happens_without_a_legacy_database() {
        let dir = scratch("none");
        assert_eq!(
            import_database(&dir).unwrap(),
            DatabaseImport::NothingToImport
        );
        assert!(!dir.join(DB_FILE).exists());
    }

    #[test]
    fn both_present_keeps_new_rows_and_adds_missing_legacy_rows_once() {
        let dir = scratch("both");
        legacy_database(&dir.join(LEGACY_DB_FILE));
        {
            let conn = Connection::open(dir.join(DB_FILE)).unwrap();
            conn.execute_batch(SESSIONS).unwrap();
            conn.execute_batch(
                "CREATE TABLE irgat_transcripts (session_id TEXT PRIMARY KEY);
                 CREATE TABLE irgat_turns (session_id TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (session_id, seq));
                 CREATE TABLE irgat_blocks (session_id TEXT NOT NULL, seq INTEGER NOT NULL, block_json TEXT NOT NULL, PRIMARY KEY (session_id, seq));
                 CREATE TABLE kanban_cards (id TEXT PRIMARY KEY, title TEXT NOT NULL);
                 INSERT INTO kanban_cards VALUES ('card-1', 'Edited in the new app');
                 INSERT INTO kanban_cards VALUES ('card-2', 'Only in the new app');
                 INSERT INTO sessions VALUES ('s1', '[]', '[]');",
            )
            .unwrap();
        }

        assert_eq!(import_database(&dir).unwrap(), DatabaseImport::Merged);

        let conn = Connection::open(dir.join(DB_FILE)).unwrap();
        let title: String = conn
            .query_row(
                "SELECT title FROM kanban_cards WHERE id = 'card-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Edited in the new app");
        assert_eq!(count(&conn, "SELECT count(*) FROM kanban_cards"), 2);
        let s1: String = conn
            .query_row(
                "SELECT blocks_json FROM sessions WHERE id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(s1, "[]", "the new database's version of a shared row wins");
        assert_eq!(
            count(
                &conn,
                "SELECT count(*) FROM sessions WHERE id = 'mono-chat'"
            ),
            1
        );
        assert_eq!(count(&conn, "SELECT count(*) FROM irgat_blocks"), 1);
        let block: String = conn
            .query_row("SELECT block_json FROM irgat_blocks", [], |row| row.get(0))
            .unwrap();
        assert!(block.contains("irgatCard"));

        conn.execute("DELETE FROM kanban_cards WHERE id = 'card-1'", [])
            .unwrap();
        drop(conn);
        assert_eq!(
            import_database(&dir).unwrap(),
            DatabaseImport::AlreadyMerged
        );
        let conn = Connection::open(dir.join(DB_FILE)).unwrap();
        assert_eq!(
            count(
                &conn,
                "SELECT count(*) FROM kanban_cards WHERE id = 'card-1'"
            ),
            0
        );
    }

    #[test]
    fn rename_keeps_a_value_already_under_the_new_name() {
        let mut block = json!({"monoHabit": {"id": "old"}, "irgatHabit": {"id": "new"}});
        assert!(rename_block_keys(&mut block));
        assert_eq!(block["irgatHabit"]["id"], "new");
        assert!(block.get("monoHabit").is_none());
        assert!(!rename_block_keys(&mut json!({"role": "user"})));
    }

    #[test]
    fn directories_are_copied_when_the_new_one_is_absent() {
        let data = scratch("dirs");
        std::fs::create_dir_all(data.join("monos/abc/memory")).unwrap();
        std::fs::write(data.join("monos/index.json"), "{}").unwrap();
        std::fs::write(data.join("monos/abc/SOUL.md"), "soul").unwrap();
        std::fs::create_dir_all(data.join("codex-monos/acct/.monocode-migrations")).unwrap();
        std::fs::create_dir_all(data.join("codex-monos/acct/.monocode-agent-state")).unwrap();
        std::fs::write(data.join("codex-monos/acct/auth.json"), "{}").unwrap();

        let notes = import_legacy_data(&data);

        assert_eq!(notes.len(), 2);
        assert_eq!(
            std::fs::read_to_string(data.join("irgats/abc/SOUL.md")).unwrap(),
            "soul"
        );
        assert!(data.join("irgats/index.json").is_file());
        assert!(data.join("codex-irgats/acct/.irgat-migrations").is_dir());
        assert!(data.join("codex-irgats/acct/.irgat-agent-state").is_dir());
        assert!(!data.join("codex-irgats/acct/.monocode-migrations").exists());
        assert!(
            data.join("monos/abc/SOUL.md").is_file(),
            "legacy folder is kept"
        );
        assert!(data.join("codex-monos/acct/.monocode-migrations").is_dir());
        assert!(!data.join("irgats.importing").exists());
    }

    #[test]
    fn directories_present_in_both_places_keep_the_new_files_and_import_once() {
        let data = scratch("dirs-both");
        std::fs::create_dir_all(data.join("monos/abc")).unwrap();
        std::fs::create_dir_all(data.join("monos/def")).unwrap();
        std::fs::write(data.join("monos/abc/SOUL.md"), "old soul").unwrap();
        std::fs::write(data.join("monos/def/SOUL.md"), "only old").unwrap();
        std::fs::create_dir_all(data.join("irgats/abc")).unwrap();
        std::fs::write(data.join("irgats/abc/SOUL.md"), "new soul").unwrap();

        assert_eq!(import_legacy_data(&data).len(), 1);

        assert_eq!(
            std::fs::read_to_string(data.join("irgats/abc/SOUL.md")).unwrap(),
            "new soul"
        );
        assert_eq!(
            std::fs::read_to_string(data.join("irgats/def/SOUL.md")).unwrap(),
            "only old"
        );

        std::fs::remove_dir_all(data.join("irgats/def")).unwrap();
        assert!(import_legacy_data(&data).is_empty());
        assert!(
            !data.join("irgats/def").exists(),
            "a deleted folder stays deleted"
        );
    }

    #[test]
    fn a_corrupt_legacy_database_does_not_stop_startup() {
        let dir = scratch("corrupt");
        std::fs::write(
            dir.join(LEGACY_DB_FILE),
            b"not a database at all, just text",
        )
        .unwrap();
        let notes = import_legacy_data(&dir);
        assert!(notes.is_empty());
    }

    #[test]
    fn identifier_folder_is_copied_when_the_new_one_is_absent() {
        let root = scratch("id-absent");
        let old = root.join(LEGACY_IDENTIFIER);
        std::fs::create_dir_all(old.join("WebsiteData")).unwrap();
        std::fs::write(old.join("WebsiteData/ls.db"), b"keys").unwrap();
        std::fs::write(root.join(format!("{LEGACY_IDENTIFIER}.plist")), b"prefs").unwrap();

        let notes = import_identifier_folders(std::slice::from_ref(&root));

        assert_eq!(notes.len(), 1);
        let new = root.join(IDENTIFIER);
        assert_eq!(
            std::fs::read(new.join("WebsiteData/ls.db")).unwrap(),
            b"keys"
        );
        assert_eq!(
            std::fs::read(root.join(format!("{IDENTIFIER}.plist"))).unwrap(),
            b"prefs"
        );
        assert_eq!(
            std::fs::read(old.join("WebsiteData/ls.db")).unwrap(),
            b"keys"
        );
        assert!(!root.join(format!("{IDENTIFIER}.importing")).exists());
    }

    #[test]
    fn identifier_folders_present_in_both_places_keep_the_new_files_and_import_once() {
        let root = scratch("id-both");
        let old = root.join(LEGACY_IDENTIFIER);
        let new = root.join(IDENTIFIER);
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("settings.json"), b"old").unwrap();
        std::fs::write(old.join("only-old.txt"), b"old").unwrap();
        std::fs::write(new.join("settings.json"), b"new").unwrap();
        std::fs::write(root.join(format!("{LEGACY_IDENTIFIER}.plist")), b"old").unwrap();
        std::fs::write(root.join(format!("{IDENTIFIER}.plist")), b"new").unwrap();

        assert_eq!(
            import_identifier_folders(std::slice::from_ref(&root)).len(),
            1
        );

        assert_eq!(std::fs::read(new.join("settings.json")).unwrap(), b"new");
        assert_eq!(std::fs::read(new.join("only-old.txt")).unwrap(), b"old");
        assert_eq!(
            std::fs::read(root.join(format!("{IDENTIFIER}.plist"))).unwrap(),
            b"new"
        );
        assert_eq!(std::fs::read(old.join("settings.json")).unwrap(), b"old");

        std::fs::write(old.join("later.txt"), b"later").unwrap();
        assert!(import_identifier_folders(&[root]).is_empty());
        assert!(!new.join("later.txt").exists());
    }

    #[test]
    fn nothing_happens_without_a_legacy_identifier_folder() {
        let root = scratch("id-none");
        assert!(import_identifier_folders(std::slice::from_ref(&root)).is_empty());
        assert!(!root.join(IDENTIFIER).exists());
        assert!(import_identifier_folders(&[root.join("missing")]).is_empty());
    }
}
