//! Feed storage: the user's interests and the posts agents collected, in one
//! SQLite file beside the app's other data.
//!
//! Each post and interest keeps its EmbeddingGemma vector (little-endian f32,
//! L2-normalized), so a post's score is its best cosine against the enabled
//! interests and can be worked out again whenever the interests change.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

/// Posts this similar to one collected in the last few days are the same
/// news told again; they are counted on the first post instead of shown.
pub const SIMILAR: f32 = 0.95;
const SIMILAR_WINDOW_MS: i64 = 3 * 24 * 60 * 60 * 1000;
/// Unsaved posts older than this, or past the newest `KEEP`, are dropped.
const MAX_AGE_MS: i64 = 90 * 24 * 60 * 60 * 1000;
const KEEP: i64 = 5_000;
pub const DEFAULT_THRESHOLD: f32 = 0.4;

pub struct Store {
    conn: Connection,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Interest {
    pub id: String,
    pub title: String,
    pub description: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// Has a vector for its current text, so it can score posts.
    pub embedded: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub source: String,
    pub external_id: String,
    pub url: String,
    pub author: String,
    pub author_name: String,
    pub text: String,
    pub summary: String,
    pub published_at: Option<i64>,
    pub collected_at: i64,
    pub metrics: Value,
    pub media: Vec<String>,
    /// The interest the collecting agent named, as it wrote it.
    pub agent_interest: String,
    /// The closest enabled interest by meaning, and its cosine.
    pub interest_id: Option<String>,
    pub score: Option<f32>,
    pub read: bool,
    pub saved: bool,
    /// Later posts telling the same news.
    pub similar: i64,
}

#[derive(Debug)]
pub struct NewItem {
    pub source: String,
    pub external_id: String,
    pub url: String,
    pub author: String,
    pub author_name: String,
    pub text: String,
    pub summary: String,
    pub published_at: Option<i64>,
    pub metrics: Value,
    pub media: Vec<String>,
    pub agent_interest: String,
    pub collected_by: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View {
    /// Posts that match an interest, or every post while nothing is scored.
    Feed,
    /// Posts scored below the threshold.
    Filtered,
    Saved,
}

impl View {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "feed" => Ok(View::Feed),
            "filtered" => Ok(View::Filtered),
            "saved" => Ok(View::Saved),
            _ => Err(format!("Unknown feed view {value}")),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Added {
    /// Stored; `similar_to` when it repeats a recent post.
    New {
        id: String,
        similar_to: Option<String>,
    },
    /// The same post, or the same link, is already in the feed.
    Known,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub unread: i64,
    pub filtered: i64,
    pub saved: i64,
    /// Posts still waiting for a vector.
    pub unscored: i64,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn to_blob(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn from_blob(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// The closest interest and its cosine; None without any interest vector.
pub fn best_match(vector: &[f32], interests: &[(String, Vec<f32>)]) -> Option<(String, f32)> {
    interests
        .iter()
        .map(|(id, v)| (id, dot(vector, v)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(id, score)| (id.clone(), score))
}

/// What a post is embedded as: who said it, what they said, and the agent's
/// note on it.
pub fn item_text(item: &NewItem) -> String {
    embed_text(&item.author_name, &item.author, &item.text, &item.summary)
}

fn embed_text(author_name: &str, author: &str, text: &str, summary: &str) -> String {
    let who = match (author_name.is_empty(), author.is_empty()) {
        (false, false) => format!("{author_name} (@{author}): "),
        (false, true) => format!("{author_name}: "),
        (true, false) => format!("@{author}: "),
        (true, true) => String::new(),
    };
    if summary.is_empty() {
        format!("{who}{text}")
    } else {
        format!("{who}{text}\n\n{summary}")
    }
}

pub fn interest_text(title: &str, description: &str) -> String {
    if description.trim().is_empty() {
        title.trim().to_string()
    } else {
        format!("{}\n{}", title.trim(), description.trim())
    }
}

const ITEM_COLUMNS: &str = "i.id, i.source, i.external_id, i.url, i.author, i.author_name, i.text,
    i.summary, i.published_at, i.collected_at, i.metrics, i.media, i.agent_interest,
    i.interest_id, i.score, i.read, i.saved,
    (SELECT COUNT(*) FROM items d WHERE d.similar_to = i.id)";

fn item_row(row: &rusqlite::Row) -> rusqlite::Result<Item> {
    let metrics: String = row.get(10)?;
    let media: String = row.get(11)?;
    Ok(Item {
        id: row.get(0)?,
        source: row.get(1)?,
        external_id: row.get(2)?,
        url: row.get(3)?,
        author: row.get(4)?,
        author_name: row.get(5)?,
        text: row.get(6)?,
        summary: row.get(7)?,
        published_at: row.get(8)?,
        collected_at: row.get(9)?,
        metrics: serde_json::from_str(&metrics).unwrap_or(Value::Null),
        media: serde_json::from_str(&media).unwrap_or_default(),
        agent_interest: row.get(12)?,
        interest_id: row.get(13)?,
        score: row.get::<_, Option<f64>>(14)?.map(|s| s as f32),
        read: row.get(15)?,
        saved: row.get(16)?,
        similar: row.get(17)?,
    })
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
            "CREATE TABLE IF NOT EXISTS interests (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                position INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                vector BLOB
            );
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                external_id TEXT NOT NULL,
                url TEXT NOT NULL,
                author TEXT NOT NULL,
                author_name TEXT NOT NULL,
                text TEXT NOT NULL,
                summary TEXT NOT NULL,
                published_at INTEGER,
                collected_at INTEGER NOT NULL,
                collected_by TEXT NOT NULL,
                metrics TEXT NOT NULL,
                media TEXT NOT NULL,
                agent_interest TEXT NOT NULL,
                vector BLOB,
                interest_id TEXT,
                score REAL,
                similar_to TEXT,
                read INTEGER NOT NULL DEFAULT 0,
                saved INTEGER NOT NULL DEFAULT 0,
                hidden INTEGER NOT NULL DEFAULT 0,
                UNIQUE (source, external_id)
            );
            CREATE INDEX IF NOT EXISTS items_url ON items (url);
            CREATE INDEX IF NOT EXISTS items_similar ON items (similar_to);
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self { conn })
    }

    // ---- settings ----

    pub fn meta(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn set_meta(&self, key: &str, value: Option<&str>) -> Result<(), String> {
        match value {
            Some(value) => self.conn.execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            ),
            None => self.conn.execute("DELETE FROM meta WHERE key = ?1", [key]),
        }
        .map(|_| ())
        .map_err(|e| e.to_string())
    }

    pub fn threshold(&self) -> Result<f32, String> {
        Ok(self
            .meta("threshold")?
            .and_then(|v| v.parse::<f32>().ok())
            .filter(|v| v.is_finite())
            .unwrap_or(DEFAULT_THRESHOLD))
    }

    // ---- interests ----

    pub fn interests(&self) -> Result<Vec<Interest>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, description, enabled, created_at, updated_at,
                        vector IS NOT NULL
                 FROM interests ORDER BY position, created_at",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Interest {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    description: r.get(2)?,
                    enabled: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                    embedded: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn interest(&self, id: &str) -> Result<Option<Interest>, String> {
        Ok(self.interests()?.into_iter().find(|i| i.id == id))
    }

    /// Creates or edits an interest. A changed text drops its vector, so it
    /// is embedded again.
    pub fn save_interest(
        &self,
        id: Option<&str>,
        title: &str,
        description: &str,
        enabled: bool,
    ) -> Result<Interest, String> {
        let now = now_ms();
        let id = match id.filter(|id| !id.is_empty()) {
            Some(id) => {
                let changed = self
                    .conn
                    .execute(
                        "UPDATE interests SET
                            vector = CASE WHEN title = ?2 AND description = ?3
                                          THEN vector ELSE NULL END,
                            title = ?2, description = ?3, enabled = ?4, updated_at = ?5
                         WHERE id = ?1",
                        params![id, title, description, enabled, now],
                    )
                    .map_err(|e| e.to_string())?;
                if changed == 0 {
                    return Err("That interest no longer exists".into());
                }
                id.to_string()
            }
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                self.conn
                    .execute(
                        "INSERT INTO interests
                            (id, title, description, enabled, position, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4,
                            (SELECT COALESCE(MAX(position), 0) + 1 FROM interests), ?5, ?5)",
                        params![id, title, description, enabled, now],
                    )
                    .map_err(|e| e.to_string())?;
                id
            }
        };
        self.interest(&id)?
            .ok_or_else(|| "That interest no longer exists".into())
    }

    pub fn remove_interest(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM interests WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Interests whose current text has no vector yet: (id, text to embed).
    pub fn unembedded_interests(&self) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, title, description FROM interests WHERE vector IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let title: String = r.get(1)?;
                let description: String = r.get(2)?;
                Ok((r.get(0)?, interest_text(&title, &description)))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Stores a vector for an interest, unless its text changed meanwhile.
    pub fn set_interest_vector(&self, id: &str, text: &str, vector: &[f32]) -> Result<(), String> {
        let current: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT title, description FROM interests WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if current.is_some_and(|(t, d)| interest_text(&t, &d) == text) {
            self.conn
                .execute(
                    "UPDATE interests SET vector = ?2 WHERE id = ?1",
                    params![id, to_blob(vector)],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn interest_vectors(&self) -> Result<Vec<(String, Vec<f32>)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, vector FROM interests WHERE enabled = 1 AND vector IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, from_blob(&r.get::<_, Vec<u8>>(1)?))))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    // ---- items ----

    /// Stores a post unless the same post or link is already in the feed.
    /// `vector` scores it now; without one it waits for `set_item_vector`.
    pub fn add_item(&self, item: &NewItem, vector: Option<&[f32]>) -> Result<Added, String> {
        let known: bool = self
            .conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM items
                    WHERE (source = ?1 AND external_id = ?2) OR url = ?3)",
                params![item.source, item.external_id, item.url],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if known {
            return Ok(Added::Known);
        }
        let now = now_ms();
        let id = uuid::Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO items (id, source, external_id, url, author, author_name, text,
                    summary, published_at, collected_at, collected_by, metrics, media,
                    agent_interest)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    id,
                    item.source,
                    item.external_id,
                    item.url,
                    item.author,
                    item.author_name,
                    item.text,
                    item.summary,
                    item.published_at,
                    now,
                    item.collected_by,
                    item.metrics.to_string(),
                    serde_json::to_string(&item.media).unwrap_or_else(|_| "[]".into()),
                    item.agent_interest,
                ],
            )
            .map_err(|e| e.to_string())?;
        let similar_to = match vector {
            Some(vector) => self.set_item_vector(&id, vector)?,
            None => None,
        };
        Ok(Added::New { id, similar_to })
    }

    /// Scores a post and links it to a recent post it repeats. Returns that
    /// post's id.
    pub fn set_item_vector(&self, id: &str, vector: &[f32]) -> Result<Option<String>, String> {
        let collected_at: i64 = self
            .conn
            .query_row("SELECT collected_at FROM items WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        let similar_to = {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT id, vector FROM items
                     WHERE id != ?1 AND vector IS NOT NULL AND similar_to IS NULL
                       AND collected_at >= ?2 AND collected_at <= ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(
                    params![id, collected_at - SIMILAR_WINDOW_MS, collected_at],
                    |r| Ok((r.get::<_, String>(0)?, from_blob(&r.get::<_, Vec<u8>>(1)?))),
                )
                .map_err(|e| e.to_string())?;
            let mut best: Option<(String, f32)> = None;
            for row in rows {
                let (other, v) = row.map_err(|e| e.to_string())?;
                let score = dot(vector, &v);
                if score >= SIMILAR && best.as_ref().is_none_or(|(_, s)| score > *s) {
                    best = Some((other, score));
                }
            }
            best.map(|(other, _)| other)
        };
        let matched = best_match(vector, &self.interest_vectors()?);
        self.conn
            .execute(
                "UPDATE items SET vector = ?2, interest_id = ?3, score = ?4, similar_to = ?5
                 WHERE id = ?1",
                params![
                    id,
                    to_blob(vector),
                    matched.as_ref().map(|(i, _)| i.clone()),
                    matched.as_ref().map(|(_, s)| *s as f64),
                    similar_to,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(similar_to)
    }

    /// The closest interest and score of a stored post, once it is scored.
    pub fn score_of(&self, id: &str) -> Result<Option<(Option<String>, f32)>, String> {
        self.conn
            .query_row(
                "SELECT interest_id, score FROM items WHERE id = ?1 AND score IS NOT NULL",
                [id],
                |r| Ok((r.get(0)?, r.get::<_, f64>(1)? as f32)),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Posts with no vector yet, newest first: (id, text to embed).
    pub fn unembedded_items(&self, limit: usize) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, author_name, author, text, summary FROM items
                 WHERE vector IS NULL ORDER BY collected_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit as i64], |r| {
                let text = embed_text(
                    &r.get::<_, String>(1)?,
                    &r.get::<_, String>(2)?,
                    &r.get::<_, String>(3)?,
                    &r.get::<_, String>(4)?,
                );
                Ok((r.get(0)?, text))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Scores every post again against the enabled interests.
    pub fn rescore(&mut self) -> Result<(), String> {
        let interests = self.interest_vectors()?;
        let tx = self.conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut read = tx
                .prepare("SELECT id, vector FROM items WHERE vector IS NOT NULL")
                .map_err(|e| e.to_string())?;
            let mut write = tx
                .prepare("UPDATE items SET interest_id = ?2, score = ?3 WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = read
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, from_blob(&r.get::<_, Vec<u8>>(1)?)))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (id, vector) = row.map_err(|e| e.to_string())?;
                let matched = best_match(&vector, &interests);
                write
                    .execute(params![
                        id,
                        matched.as_ref().map(|(i, _)| i.clone()),
                        matched.as_ref().map(|(_, s)| *s as f64),
                    ])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    /// The WHERE clause of a view. A post with no score counts as relevant:
    /// nothing has judged it yet, and the agent already chose it.
    fn view_filter(view: View, interest: Option<&str>) -> (String, Vec<rusqlite::types::Value>) {
        use rusqlite::types::Value as V;
        let mut clauses = vec!["i.hidden = 0".to_string()];
        let mut args: Vec<V> = Vec::new();
        match view {
            View::Feed => {
                clauses.push("i.similar_to IS NULL AND (i.score IS NULL OR i.score >= ?1)".into())
            }
            View::Filtered => {
                clauses.push("i.similar_to IS NULL AND i.score IS NOT NULL AND i.score < ?1".into())
            }
            View::Saved => clauses.push("i.saved = 1 AND ?1 = ?1".into()),
        }
        if let Some(interest) = interest {
            clauses.push(format!("i.interest_id = ?{}", 2));
            args.push(V::Text(interest.to_string()));
        }
        (clauses.join(" AND "), args)
    }

    pub fn items(
        &self,
        view: View,
        interest: Option<&str>,
        unread_only: bool,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<Item>, i64), String> {
        use rusqlite::types::Value as V;
        let threshold = self.threshold()? as f64;
        let (mut filter, extra) = Self::view_filter(view, interest);
        if unread_only {
            filter.push_str(" AND i.read = 0");
        }
        let mut args = vec![V::Real(threshold)];
        args.extend(extra);
        let total: i64 = self
            .conn
            .query_row(
                &format!("SELECT COUNT(*) FROM items i WHERE {filter}"),
                params_from_iter(args.iter()),
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let next = args.len();
        args.push(V::Integer(limit as i64));
        args.push(V::Integer(offset as i64));
        let sql = format!(
            "SELECT {ITEM_COLUMNS} FROM items i WHERE {filter}
             ORDER BY COALESCE(i.published_at, i.collected_at) DESC, i.collected_at DESC
             LIMIT ?{} OFFSET ?{}",
            next + 1,
            next + 2
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(args.iter()), item_row)
            .map_err(|e| e.to_string())?;
        let items = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
        Ok((items, total))
    }

    /// Later posts that repeat this one.
    pub fn similar_items(&self, id: &str) -> Result<Vec<Item>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {ITEM_COLUMNS} FROM items i WHERE i.similar_to = ?1
                 ORDER BY i.collected_at"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([id], item_row).map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn counts(&self) -> Result<Counts, String> {
        let threshold = self.threshold()? as f64;
        self.conn
            .query_row(
                "SELECT
                    COALESCE(SUM(hidden = 0 AND read = 0 AND similar_to IS NULL
                        AND (score IS NULL OR score >= ?1)), 0),
                    COALESCE(SUM(hidden = 0 AND similar_to IS NULL
                        AND score IS NOT NULL AND score < ?1), 0),
                    COALESCE(SUM(hidden = 0 AND saved = 1), 0),
                    COALESCE(SUM(vector IS NULL), 0)
                 FROM items",
                [threshold],
                |r| {
                    Ok(Counts {
                        unread: r.get(0)?,
                        filtered: r.get(1)?,
                        saved: r.get(2)?,
                        unscored: r.get(3)?,
                    })
                },
            )
            .map_err(|e| e.to_string())
    }

    /// Sets read, saved or hidden on posts. Hiding or reading a post does the
    /// same to the posts that repeat it.
    pub fn mark(
        &self,
        ids: &[String],
        read: Option<bool>,
        saved: Option<bool>,
        hidden: Option<bool>,
    ) -> Result<(), String> {
        for id in ids {
            if let Some(read) = read {
                self.conn
                    .execute(
                        "UPDATE items SET read = ?2 WHERE id = ?1 OR similar_to = ?1",
                        params![id, read],
                    )
                    .map_err(|e| e.to_string())?;
            }
            if let Some(saved) = saved {
                self.conn
                    .execute(
                        "UPDATE items SET saved = ?2, read = CASE WHEN ?2 THEN 1 ELSE read END
                         WHERE id = ?1",
                        params![id, saved],
                    )
                    .map_err(|e| e.to_string())?;
            }
            if let Some(hidden) = hidden {
                self.conn
                    .execute(
                        "UPDATE items SET hidden = ?2 WHERE id = ?1 OR similar_to = ?1",
                        params![id, hidden],
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Marks every post in a view read.
    pub fn mark_all_read(&self, view: View, interest: Option<&str>) -> Result<(), String> {
        use rusqlite::types::Value as V;
        let (filter, extra) = Self::view_filter(view, interest);
        let mut args = vec![V::Real(self.threshold()? as f64)];
        args.extend(extra);
        self.conn
            .execute(
                &format!(
                    "UPDATE items SET read = 1 WHERE id IN (SELECT i.id FROM items i WHERE {filter})
                        OR similar_to IN (SELECT i.id FROM items i WHERE {filter})"
                ),
                params_from_iter(args.iter()),
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// When each source last delivered a post, as epoch ms.
    pub fn last_collected(&self) -> Result<HashMap<String, i64>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT source, MAX(collected_at) FROM items GROUP BY source")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Drops old unsaved posts, keeping at most `KEEP`.
    pub fn prune(&self) -> Result<(), String> {
        let cutoff = now_ms() - MAX_AGE_MS;
        self.conn
            .execute(
                "DELETE FROM items WHERE saved = 0 AND (collected_at < ?1 OR id NOT IN
                    (SELECT id FROM items ORDER BY collected_at DESC LIMIT ?2))",
                params![cutoff, KEEP],
            )
            .map_err(|e| e.to_string())?;
        // A post whose original was dropped stands on its own again.
        self.conn
            .execute(
                "UPDATE items SET similar_to = NULL
                 WHERE similar_to IS NOT NULL AND similar_to NOT IN (SELECT id FROM items)",
                [],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unit(values: &[f32]) -> Vec<f32> {
        let norm = values.iter().map(|x| x * x).sum::<f32>().sqrt();
        values.iter().map(|x| x / norm).collect()
    }

    fn post(id: &str, url: &str) -> NewItem {
        NewItem {
            source: "x".into(),
            external_id: id.into(),
            url: url.into(),
            author: "someone".into(),
            author_name: "Some One".into(),
            text: format!("post {id}"),
            summary: String::new(),
            published_at: Some(1_000),
            metrics: json!({"likes": 3}),
            media: vec![],
            agent_interest: String::new(),
            collected_by: "session".into(),
        }
    }

    fn store_with_interests() -> (Store, String, String) {
        let store = Store::open_in_memory().unwrap();
        let rust = store
            .save_interest(None, "Rust", "systems programming", true)
            .unwrap();
        let coffee = store.save_interest(None, "Coffee", "", true).unwrap();
        store
            .set_interest_vector(
                &rust.id,
                "Rust\nsystems programming",
                &unit(&[1.0, 0.0, 0.0]),
            )
            .unwrap();
        store
            .set_interest_vector(&coffee.id, "Coffee", &unit(&[0.0, 1.0, 0.0]))
            .unwrap();
        (store, rust.id, coffee.id)
    }

    #[test]
    fn scores_posts_against_the_closest_interest() {
        let (store, rust, _) = store_with_interests();
        store
            .add_item(
                &post("1", "https://x.com/a/1"),
                Some(&unit(&[0.9, 0.1, 0.0])),
            )
            .unwrap();
        store
            .add_item(
                &post("2", "https://x.com/a/2"),
                Some(&unit(&[0.0, 0.0, 1.0])),
            )
            .unwrap();
        store
            .add_item(&post("3", "https://x.com/a/3"), None)
            .unwrap();
        let (feed, total) = store.items(View::Feed, None, false, 0, 50).unwrap();
        // The unscored post shows; the off-topic one is filtered.
        assert_eq!(total, 2);
        let ids: Vec<_> = feed.iter().map(|i| i.external_id.as_str()).collect();
        assert!(ids.contains(&"1") && ids.contains(&"3"));
        let first = feed.iter().find(|i| i.external_id == "1").unwrap();
        assert_eq!(first.interest_id.as_deref(), Some(rust.as_str()));
        assert!(first.score.unwrap() > 0.9);
        let (filtered, _) = store.items(View::Filtered, None, false, 0, 50).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].external_id, "2");
        let (only_rust, _) = store.items(View::Feed, Some(&rust), false, 0, 50).unwrap();
        assert_eq!(only_rust.len(), 1);
        let counts = store.counts().unwrap();
        assert_eq!((counts.unread, counts.filtered, counts.unscored), (2, 1, 1));
    }

    #[test]
    fn the_same_post_or_link_is_not_added_twice() {
        let store = Store::open_in_memory().unwrap();
        assert!(matches!(
            store
                .add_item(&post("1", "https://x.com/a/1"), None)
                .unwrap(),
            Added::New { .. }
        ));
        assert_eq!(
            store
                .add_item(&post("1", "https://x.com/a/other"), None)
                .unwrap(),
            Added::Known
        );
        assert_eq!(
            store
                .add_item(&post("9", "https://x.com/a/1"), None)
                .unwrap(),
            Added::Known
        );
    }

    #[test]
    fn a_repeated_story_is_counted_on_the_first_post() {
        let (store, _, _) = store_with_interests();
        let Added::New { id: first, .. } = store
            .add_item(
                &post("1", "https://x.com/a/1"),
                Some(&unit(&[1.0, 0.0, 0.0])),
            )
            .unwrap()
        else {
            panic!()
        };
        let again = store
            .add_item(
                &post("2", "https://x.com/b/2"),
                Some(&unit(&[1.0, 0.01, 0.0])),
            )
            .unwrap();
        assert!(matches!(again, Added::New { similar_to: Some(ref s), .. } if *s == first));
        let (feed, _) = store.items(View::Feed, None, false, 0, 50).unwrap();
        assert_eq!(feed.len(), 1);
        assert_eq!(feed[0].similar, 1);
        assert_eq!(store.similar_items(&first).unwrap().len(), 1);
        // Reading or hiding the story covers its repeats.
        store
            .mark(std::slice::from_ref(&first), Some(true), None, None)
            .unwrap();
        assert!(store.similar_items(&first).unwrap()[0].read);
    }

    #[test]
    fn editing_an_interest_rescores_posts() {
        let (mut store, rust, coffee) = store_with_interests();
        store
            .add_item(
                &post("1", "https://x.com/a/1"),
                Some(&unit(&[0.0, 0.0, 1.0])),
            )
            .unwrap();
        assert_eq!(store.items(View::Feed, None, false, 0, 50).unwrap().1, 0);
        // New text drops the old vector until it is embedded again.
        let edited = store
            .save_interest(Some(&coffee), "Space", "rockets", true)
            .unwrap();
        assert!(!edited.embedded);
        assert_eq!(
            store.unembedded_interests().unwrap(),
            vec![(coffee.clone(), "Space\nrockets".to_string())]
        );
        // A vector for stale text is ignored.
        store
            .set_interest_vector(&coffee, "Coffee", &unit(&[0.0, 0.0, 1.0]))
            .unwrap();
        assert!(!store.interest(&coffee).unwrap().unwrap().embedded);
        store
            .set_interest_vector(&coffee, "Space\nrockets", &unit(&[0.0, 0.0, 1.0]))
            .unwrap();
        store.rescore().unwrap();
        let (feed, _) = store.items(View::Feed, None, false, 0, 50).unwrap();
        assert_eq!(feed[0].interest_id.as_deref(), Some(coffee.as_str()));
        // A disabled interest stops matching.
        store
            .save_interest(Some(&coffee), "Space", "rockets", false)
            .unwrap();
        store.rescore().unwrap();
        let (feed, _) = store.items(View::Filtered, None, false, 0, 50).unwrap();
        assert_eq!(feed[0].interest_id.as_deref(), Some(rust.as_str()));
    }

    #[test]
    fn saved_posts_survive_pruning_and_threshold_is_stored() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.threshold().unwrap(), DEFAULT_THRESHOLD);
        store.set_meta("threshold", Some("0.55")).unwrap();
        assert_eq!(store.threshold().unwrap(), 0.55);
        let Added::New { id, .. } = store
            .add_item(&post("1", "https://x.com/a/1"), None)
            .unwrap()
        else {
            panic!()
        };
        store
            .add_item(&post("2", "https://x.com/a/2"), None)
            .unwrap();
        store
            .mark(std::slice::from_ref(&id), None, Some(true), None)
            .unwrap();
        store
            .conn
            .execute("UPDATE items SET collected_at = 0", [])
            .unwrap();
        store.prune().unwrap();
        let (saved, total) = store.items(View::Saved, None, false, 0, 50).unwrap();
        assert_eq!((saved.len(), total), (1, 1));
        assert!(saved[0].read);
        assert_eq!(store.items(View::Feed, None, false, 0, 50).unwrap().1, 1);
    }

    #[test]
    fn mark_all_read_covers_one_view() {
        let (store, _, _) = store_with_interests();
        store
            .add_item(
                &post("1", "https://x.com/a/1"),
                Some(&unit(&[1.0, 0.0, 0.0])),
            )
            .unwrap();
        store
            .add_item(
                &post("2", "https://x.com/a/2"),
                Some(&unit(&[0.0, 0.0, 1.0])),
            )
            .unwrap();
        store.mark_all_read(View::Feed, None).unwrap();
        assert_eq!(store.counts().unwrap().unread, 0);
        let (filtered, _) = store.items(View::Filtered, None, true, 0, 50).unwrap();
        assert_eq!(filtered.len(), 1);
    }
}
