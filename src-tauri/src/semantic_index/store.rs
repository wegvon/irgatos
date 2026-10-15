//! The vector store: one SQLite file beside the app's other data.
//!
//! Rows are keyed by `(corpus, scope, item, start_line)` so other corpora can
//! share it later. For code, `corpus` is "code", `scope` the project root and
//! `item` a project-relative path. Chat history would use a session as the
//! scope and a message as the item. Vectors are little-endian f32 BLOBs,
//! already L2-normalized, so a dot product is the cosine.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

pub const CODE: &str = "code";

pub struct Store {
    conn: Connection,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StoredChunk {
    pub item: String,
    pub start_line: usize,
    pub end_line: usize,
    pub vector: Vec<f32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ScopeStatus {
    pub items: usize,
    pub chunks: usize,
    /// The last full pass reached every file it listed.
    pub complete: bool,
    pub updated_at: Option<i64>,
    pub last_error: Option<String>,
}

pub struct NewChunk<'a> {
    pub start_line: usize,
    pub end_line: usize,
    pub vector: &'a [f32],
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, String> {
        Self::init(Connection::open_in_memory().map_err(|e| e.to_string())?)
    }

    fn init(conn: Connection) -> Result<Self, String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS items (
                corpus TEXT NOT NULL,
                scope TEXT NOT NULL,
                item TEXT NOT NULL,
                hash TEXT NOT NULL,
                model TEXT NOT NULL,
                dims INTEGER NOT NULL,
                indexed_at INTEGER NOT NULL,
                PRIMARY KEY (corpus, scope, item)
            );
            CREATE TABLE IF NOT EXISTS chunks (
                corpus TEXT NOT NULL,
                scope TEXT NOT NULL,
                item TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                vector BLOB NOT NULL,
                PRIMARY KEY (corpus, scope, item, start_line)
            );
            CREATE TABLE IF NOT EXISTS scopes (
                corpus TEXT NOT NULL,
                scope TEXT NOT NULL,
                complete INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER,
                last_error TEXT,
                PRIMARY KEY (corpus, scope)
            );",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self { conn })
    }

    /// Hash of every item indexed with this model and size. An item embedded
    /// with another model or size is absent, so it is embedded again.
    pub fn hashes(
        &self,
        corpus: &str,
        scope: &str,
        model: &str,
        dims: usize,
    ) -> Result<HashMap<String, String>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT item, hash FROM items
                 WHERE corpus = ?1 AND scope = ?2 AND model = ?3 AND dims = ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![corpus, scope, model, dims as i64], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn items(&self, corpus: &str, scope: &str) -> Result<Vec<String>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT item FROM items WHERE corpus = ?1 AND scope = ?2")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![corpus, scope], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Replaces an item's chunks and hash in one transaction, so a query never
    /// sees half of a file.
    #[allow(clippy::too_many_arguments)]
    pub fn replace_item(
        &mut self,
        corpus: &str,
        scope: &str,
        item: &str,
        hash: &str,
        model: &str,
        dims: usize,
        chunks: &[NewChunk<'_>],
    ) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM chunks WHERE corpus = ?1 AND scope = ?2 AND item = ?3",
            params![corpus, scope, item],
        )
        .map_err(|e| e.to_string())?;
        {
            let mut insert = tx
                .prepare(
                    "INSERT INTO chunks (corpus, scope, item, start_line, end_line, vector)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(|e| e.to_string())?;
            for chunk in chunks {
                insert
                    .execute(params![
                        corpus,
                        scope,
                        item,
                        chunk.start_line as i64,
                        chunk.end_line as i64,
                        to_blob(chunk.vector)
                    ])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.execute(
            "INSERT INTO items (corpus, scope, item, hash, model, dims, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (corpus, scope, item) DO UPDATE SET
               hash = excluded.hash, model = excluded.model, dims = excluded.dims,
               indexed_at = excluded.indexed_at",
            params![corpus, scope, item, hash, model, dims as i64, now()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn remove_item(&mut self, corpus: &str, scope: &str, item: &str) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        for table in ["chunks", "items"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE corpus = ?1 AND scope = ?2 AND item = ?3"),
                params![corpus, scope, item],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn clear_scope(&mut self, corpus: &str, scope: &str) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        for table in ["chunks", "items", "scopes"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE corpus = ?1 AND scope = ?2"),
                params![corpus, scope],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn set_scope_state(
        &self,
        corpus: &str,
        scope: &str,
        complete: bool,
        error: Option<&str>,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO scopes (corpus, scope, complete, updated_at, last_error)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (corpus, scope) DO UPDATE SET
                   complete = excluded.complete, updated_at = excluded.updated_at,
                   last_error = excluded.last_error",
                params![corpus, scope, complete, now(), error],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn scope_status(&self, corpus: &str, scope: &str) -> Result<Option<ScopeStatus>, String> {
        let state = self
            .conn
            .query_row(
                "SELECT complete, updated_at, last_error FROM scopes
                 WHERE corpus = ?1 AND scope = ?2",
                params![corpus, scope],
                |row| Ok((row.get::<_, bool>(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((complete, updated_at, last_error)) = state else {
            return Ok(None);
        };
        let count = |table: &str| -> Result<usize, String> {
            self.conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE corpus = ?1 AND scope = ?2"),
                    params![corpus, scope],
                    |row| row.get::<_, i64>(0),
                )
                .map(|n| n as usize)
                .map_err(|e| e.to_string())
        };
        Ok(Some(ScopeStatus {
            items: count("items")?,
            chunks: count("chunks")?,
            complete,
            updated_at,
            last_error,
        }))
    }

    pub fn scopes(&self, corpus: &str) -> Result<Vec<String>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT scope FROM scopes WHERE corpus = ?1")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![corpus], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Every chunk in a scope whose item starts with `prefix` ("" for all).
    pub fn chunks(
        &self,
        corpus: &str,
        scope: &str,
        prefix: &str,
    ) -> Result<Vec<StoredChunk>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT item, start_line, end_line, vector FROM chunks
                 WHERE corpus = ?1 AND scope = ?2 AND substr(item, 1, length(?3)) = ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![corpus, scope, prefix], |row| {
                Ok(StoredChunk {
                    item: row.get(0)?,
                    start_line: row.get::<_, i64>(1)? as usize,
                    end_line: row.get::<_, i64>(2)? as usize,
                    vector: from_blob(&row.get::<_, Vec<u8>>(3)?),
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn to_blob(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn from_blob(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_items_atomically_and_round_trips_vectors() {
        let mut store = Store::open_in_memory().unwrap();
        let v = [0.5f32, -0.25, 1.0];
        let chunk = |start| NewChunk {
            start_line: start,
            end_line: start + 59,
            vector: &v,
        };
        store
            .replace_item(CODE, "/p", "a.rs", "h1", "m", 3, &[chunk(1), chunk(51)])
            .unwrap();
        store
            .replace_item(CODE, "/p", "a.rs", "h2", "m", 3, &[chunk(1)])
            .unwrap();
        let chunks = store.chunks(CODE, "/p", "").unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].vector, v.to_vec());
        assert_eq!(store.hashes(CODE, "/p", "m", 3).unwrap()["a.rs"], "h2");
        // Another model or size counts as not indexed.
        assert!(store.hashes(CODE, "/p", "m", 768).unwrap().is_empty());

        store
            .replace_item(CODE, "/p", "src/b.rs", "h", "m", 3, &[chunk(1)])
            .unwrap();
        assert_eq!(store.chunks(CODE, "/p", "src/").unwrap().len(), 1);
        store.remove_item(CODE, "/p", "a.rs").unwrap();
        assert_eq!(store.items(CODE, "/p").unwrap(), vec!["src/b.rs"]);

        assert!(store.scope_status(CODE, "/p").unwrap().is_none());
        store
            .set_scope_state(CODE, "/p", false, Some("boom"))
            .unwrap();
        let status = store.scope_status(CODE, "/p").unwrap().unwrap();
        assert_eq!(
            (status.items, status.chunks, status.complete),
            (1, 1, false)
        );
        assert_eq!(status.last_error.as_deref(), Some("boom"));
        assert_eq!(store.scopes(CODE).unwrap(), vec!["/p"]);
        store.clear_scope(CODE, "/p").unwrap();
        assert!(store.scope_status(CODE, "/p").unwrap().is_none());
        assert!(store.chunks(CODE, "/p", "").unwrap().is_empty());
    }
}
