//! Search by meaning over chat history, for the Search view.
//!
//! Each user turn (the message plus the start of the reply to it) is one
//! document in the shared semantic index's "chats" corpus. The index is
//! brought up to date in the background, newest chats first, whenever the
//! Search view opens or searches and the last pass is a few minutes old.
//! Only chats whose `updated_at` moved are read again, so a refresh after
//! the first one costs a cheap listing.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

pub(crate) const CORPUS: &str = "chats";
pub(crate) const SCOPE: &str = "all";
/// Newest turns kept in the index; older history stays word-searchable.
const MAX_TURNS: usize = 6000;
const REFRESH_AFTER: Duration = Duration::from_secs(3 * 60);
/// A meaning-only match below this is noise: every turn is somewhat close.
/// Measured on real chats: unrelated queries top out at 0.65-0.68, related
/// ones reach 0.76-0.77.
const MEANING_FLOOR: f32 = 0.71;
/// Turns shown per chat, so one long chat does not fill the list.
const PER_CHAT: usize = 2;
const MAX_USER_CHARS: usize = 1200;
const MAX_REPLY_CHARS: usize = 1500;
const PREVIEW_CHARS: usize = 140;

#[derive(Clone, Debug, PartialEq)]
struct Turn {
    block_id: String,
    text: String,
    preview: String,
}

#[derive(Clone, Debug)]
struct Chat {
    updated_at: i64,
    cwd: String,
    harness: String,
    title: String,
    turns: Vec<Turn>,
    /// False when the chat sat past the cap and its transcript was not read.
    read: bool,
}

#[derive(Clone, Default)]
struct Cache {
    chats: HashMap<String, Chat>,
    /// Session ids, newest first.
    order: Vec<String>,
    refreshed: Option<Instant>,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);
static REFRESHING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeaningHit {
    session_id: String,
    block_id: String,
    cwd: String,
    harness: String,
    title: String,
    updated_at: i64,
    preview: String,
    score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeaningResult {
    hits: Vec<ChatMeaningHit>,
    /// "on", "off" (semantic search not set up) or "unavailable".
    semantic: &'static str,
    note: Option<String>,
    /// Turns embedded so far and turns there are to embed.
    indexed: usize,
    total: usize,
}

/// Starts a background refresh when the last one is stale. Cheap to call.
#[tauri::command]
pub fn chat_semantic_warm(app: AppHandle) {
    if crate::semantic_index::embeddings_on(&app) && refresh_due() {
        spawn_refresh(app);
    }
}

#[tauri::command]
pub async fn chat_semantic_search(
    app: AppHandle,
    query: String,
    cwd: Option<String>,
    limit: Option<usize>,
) -> Result<ChatMeaningResult, String> {
    let limit = limit.unwrap_or(12).clamp(1, 48);
    tauri::async_runtime::spawn_blocking(move || search(&app, &query, cwd.as_deref(), limit))
        .await
        .map_err(|e| e.to_string())?
}

fn search(
    app: &AppHandle,
    query: &str,
    cwd: Option<&str>,
    limit: usize,
) -> Result<ChatMeaningResult, String> {
    let query = query.trim();
    let off = ChatMeaningResult {
        hits: Vec::new(),
        semantic: "off",
        note: None,
        indexed: 0,
        total: 0,
    };
    if query.is_empty() || !crate::semantic_index::embeddings_on(app) {
        return Ok(off);
    }
    // The first search after start needs the chat list to label its hits.
    if cache_empty() {
        refresh(app)?;
        let started = Instant::now();
        while REFRESHING.load(Ordering::Acquire) && started.elapsed() < Duration::from_secs(20) {
            std::thread::sleep(Duration::from_millis(50));
        }
    } else if refresh_due() {
        spawn_refresh(app.clone());
    }
    let total = CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref().map(|c| turn_count(c).min(MAX_TURNS)))
        .unwrap_or(0);
    let indexed = crate::semantic_index::corpus_items(app, CORPUS, SCOPE)
        .unwrap_or(0)
        .min(total);
    let ranked = match crate::semantic_index::rank_documents(app, CORPUS, SCOPE, query, 120) {
        Ok(Some(ranked)) => ranked,
        Ok(None) => return Ok(off),
        Err(error) => {
            return Ok(ChatMeaningResult {
                note: Some(format!(
                    "Search by meaning is unavailable ({error}); showing word matches only."
                )),
                semantic: "unavailable",
                indexed,
                total,
                hits: Vec::new(),
            })
        }
    };
    let cache = CACHE.lock().map_err(|_| "Chat index is locked")?;
    let hits = cache
        .as_ref()
        .map(|cache| pick(cache, &ranked, cwd, limit))
        .unwrap_or_default();
    Ok(ChatMeaningResult {
        hits,
        semantic: "on",
        note: None,
        indexed,
        total,
    })
}

/// Ranked document ids to hits: above the floor, in the folder if one is
/// given, at most `PER_CHAT` per chat.
fn pick(
    cache: &Cache,
    ranked: &[(String, f32)],
    cwd: Option<&str>,
    limit: usize,
) -> Vec<ChatMeaningHit> {
    let cwd = cwd
        .map(|c| c.trim_end_matches('/'))
        .filter(|c| !c.is_empty() && *c != "~");
    let mut per_chat: HashMap<&str, usize> = HashMap::new();
    let mut hits = Vec::new();
    let cutoff = ranked.first().map_or(f32::MAX, |(_, best)| {
        crate::semantic_index::meaning_cutoff(*best, MEANING_FLOOR)
    });
    for (id, score) in ranked {
        if *score < cutoff || hits.len() >= limit {
            break;
        }
        let Some((session_id, block_id)) = split_id(id) else {
            continue;
        };
        let Some(chat) = cache.chats.get(session_id) else {
            continue;
        };
        if cwd.is_some_and(|cwd| chat.cwd.trim_end_matches('/') != cwd) {
            continue;
        }
        let Some(turn) = chat.turns.iter().find(|t| t.block_id == block_id) else {
            continue;
        };
        let seen = per_chat.entry(session_id).or_default();
        if *seen >= PER_CHAT {
            continue;
        }
        *seen += 1;
        hits.push(ChatMeaningHit {
            session_id: session_id.to_string(),
            block_id: block_id.to_string(),
            cwd: chat.cwd.clone(),
            harness: chat.harness.clone(),
            title: chat.title.clone(),
            updated_at: chat.updated_at,
            preview: turn.preview.clone(),
            score: (*score * 1000.0).round() / 1000.0,
        });
    }
    hits
}

fn doc_id(session_id: &str, block_id: &str) -> String {
    format!("{session_id}\u{1f}{block_id}")
}

fn split_id(id: &str) -> Option<(&str, &str)> {
    id.split_once('\u{1f}')
}

fn cache_empty() -> bool {
    CACHE
        .lock()
        .map(|cache| cache.as_ref().is_none_or(|c| c.refreshed.is_none()))
        .unwrap_or(true)
}

fn refresh_due() -> bool {
    CACHE
        .lock()
        .map(|cache| {
            cache
                .as_ref()
                .and_then(|c| c.refreshed)
                .is_none_or(|at| at.elapsed() >= REFRESH_AFTER)
        })
        .unwrap_or(false)
}

fn turn_count(cache: &Cache) -> usize {
    cache.chats.values().map(|c| c.turns.len()).sum()
}

fn spawn_refresh(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(error) = refresh(&app) {
            eprintln!("chat semantic index: {error}");
        }
    });
}

/// Rereads the chats that changed and hands the full document set to the
/// semantic index, which embeds only what is new.
fn refresh(app: &AppHandle) -> Result<(), String> {
    if REFRESHING.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let result = (|| {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let conn = open_read(&dir.join(crate::session_store::DB_FILE))?;
        // Searches keep using the old list while the new one is read.
        let previous = CACHE
            .lock()
            .map_err(|_| "Chat index is locked")?
            .clone()
            .unwrap_or_default();
        let next = load(&conn, previous)?;
        let docs = documents(&next);
        if let Ok(mut cache) = CACHE.lock() {
            *cache = Some(next);
        }
        crate::semantic_index::sync_documents(app, CORPUS, SCOPE, docs);
        Ok(())
    })();
    REFRESHING.store(false, Ordering::Release);
    result
}

fn open_read(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// The chat list, newest first, reusing the turns of chats that did not move.
fn load(conn: &Connection, mut previous: Cache) -> Result<Cache, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, updated_at, cwd, harness, title FROM sessions
             WHERE has_user_message = 1 AND archived = 0 AND inbox_ask IS NULL
             ORDER BY updated_at DESC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut next = Cache::default();
    let mut turns_left = MAX_TURNS;
    for (id, updated_at, cwd, harness, title) in rows {
        let (turns, read) = match previous.chats.remove(&id) {
            Some(chat) if chat.read && chat.updated_at == updated_at && chat.title == title => {
                (chat.turns, true)
            }
            // Past the cap nothing is embedded, so skip reading transcripts.
            _ if turns_left == 0 => (Vec::new(), false),
            _ => (turns(&title, &blocks(conn, &id)?), true),
        };
        turns_left = turns_left.saturating_sub(turns.len());
        next.order.push(id.clone());
        next.chats.insert(
            id,
            Chat {
                updated_at,
                cwd,
                harness,
                title,
                turns,
                read,
            },
        );
    }
    next.refreshed = Some(Instant::now());
    Ok(next)
}

/// A chat's blocks: Irgat transcripts live in their own table.
fn blocks(conn: &Connection, id: &str) -> Result<Vec<Value>, String> {
    let irgat = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM irgat_transcripts WHERE session_id = ?1)",
            [id],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if irgat {
        let mut statement = conn
            .prepare("SELECT block_json FROM irgat_blocks WHERE session_id = ?1 ORDER BY seq")
            .map_err(|e| e.to_string())?;
        let blocks = statement
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|raw| raw.ok().and_then(|raw| serde_json::from_str(&raw).ok()))
            .collect();
        return Ok(blocks);
    }
    let raw: Option<String> = conn
        .query_row(
            "SELECT blocks_json FROM sessions WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(raw
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default())
}

/// One document per user turn: the chat's title, what was asked and the
/// start of the answer.
fn turns(title: &str, blocks: &[Value]) -> Vec<Turn> {
    struct Open {
        block_id: String,
        asked: String,
        answer: String,
    }
    fn close(title: &str, open: Open, out: &mut Vec<Turn>) {
        if open.asked.chars().count() + open.answer.chars().count() < 12 {
            return;
        }
        let mut text = String::new();
        if !title.trim().is_empty() {
            text.push_str(title.trim());
            text.push_str("\n\n");
        }
        text.push_str(&clip(&open.asked, MAX_USER_CHARS));
        if !open.answer.is_empty() {
            text.push_str("\n\n");
            text.push_str(&clip(&open.answer, MAX_REPLY_CHARS));
        }
        let preview_from = if open.asked.trim().is_empty() {
            &open.answer
        } else {
            &open.asked
        };
        out.push(Turn {
            block_id: open.block_id,
            preview: one_line(preview_from, PREVIEW_CHARS),
            text,
        });
    }

    let mut out = Vec::new();
    let mut open: Option<Open> = None;
    for block in blocks {
        let role = block
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let text = block
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if role == "user" {
            if block.get("draft").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            let Some(id) = block
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            else {
                continue;
            };
            if let Some(previous) = open.take() {
                close(title, previous, &mut out);
            }
            open = Some(Open {
                block_id: id.to_string(),
                asked: text.to_string(),
                answer: String::new(),
            });
        } else if matches!(role, "assistant" | "plan") && !text.is_empty() {
            if let Some(open) = open.as_mut() {
                if open.answer.chars().count() < MAX_REPLY_CHARS {
                    if !open.answer.is_empty() {
                        open.answer.push('\n');
                    }
                    open.answer.push_str(text);
                }
            }
        }
    }
    if let Some(open) = open {
        close(title, open, &mut out);
    }
    out
}

/// Documents newest first (newest chat, latest turn first), capped, so the
/// recent past becomes searchable before the old.
fn documents(cache: &Cache) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for id in &cache.order {
        let Some(chat) = cache.chats.get(id) else {
            continue;
        };
        for turn in chat.turns.iter().rev() {
            let doc = doc_id(id, &turn.block_id);
            if seen.insert(doc.clone()) {
                out.push((doc, turn.text.clone()));
            }
            if out.len() == MAX_TURNS {
                return out;
            }
        }
    }
    out
}

fn clip(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_string(),
    }
}

fn one_line(text: &str, max: usize) -> String {
    clip(&text.split_whitespace().collect::<Vec<_>>().join(" "), max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chat(updated_at: i64, cwd: &str, turns: Vec<Turn>) -> Chat {
        Chat {
            updated_at,
            cwd: cwd.into(),
            harness: "claude".into(),
            title: "t".into(),
            turns,
            read: true,
        }
    }

    fn turn(block_id: &str) -> Turn {
        Turn {
            block_id: block_id.into(),
            text: format!("text {block_id}"),
            preview: format!("preview {block_id}"),
        }
    }

    #[test]
    fn groups_blocks_into_user_turns() {
        let blocks = vec![
            json!({"id": "a0", "role": "assistant", "text": "before any question"}),
            json!({"id": "u1", "role": "user", "text": "Why does the mail list crash?"}),
            json!({"id": "t1", "role": "tool", "text": "", "tool": {"title": "grep"}}),
            json!({"id": "a1", "role": "assistant", "text": "An HTML entity was cut in half."}),
            json!({"id": "u2", "role": "user", "text": "draft", "draft": true}),
            json!({"id": "u3", "role": "user", "text": "ok"}),
            json!({"id": "u4", "role": "user", "text": "Add a dark theme to the settings page"}),
        ];
        let turns = turns("Mail bugs", &blocks);
        let ids: Vec<&str> = turns.iter().map(|t| t.block_id.as_str()).collect();
        // "ok" with no answer is too short to mean anything.
        assert_eq!(ids, ["u1", "u4"]);
        assert_eq!(
            turns[0].text,
            "Mail bugs\n\nWhy does the mail list crash?\n\nAn HTML entity was cut in half."
        );
        assert_eq!(turns[0].preview, "Why does the mail list crash?");
    }

    #[test]
    fn clips_long_turns_on_char_boundaries() {
        let long = "ğ".repeat(MAX_USER_CHARS + 50);
        let blocks = vec![json!({"id": "u1", "role": "user", "text": long})];
        let turns = turns("", &blocks);
        assert_eq!(turns[0].text.chars().count(), MAX_USER_CHARS + 1);
        assert_eq!(turns[0].preview.chars().count(), PREVIEW_CHARS + 1);
    }

    #[test]
    fn documents_go_newest_first() {
        let mut cache = Cache::default();
        cache
            .chats
            .insert("old".into(), chat(1, "/p", vec![turn("o1")]));
        cache
            .chats
            .insert("new".into(), chat(2, "/p", vec![turn("n1"), turn("n2")]));
        cache.order = vec!["new".into(), "old".into()];
        let ids: Vec<String> = documents(&cache).into_iter().map(|(id, _)| id).collect();
        assert_eq!(
            ids,
            [
                doc_id("new", "n2"),
                doc_id("new", "n1"),
                doc_id("old", "o1")
            ]
        );
    }

    #[test]
    fn picks_above_the_floor_per_chat_and_folder() {
        let mut cache = Cache::default();
        cache.chats.insert(
            "a".into(),
            chat(1, "/p/", vec![turn("1"), turn("2"), turn("3")]),
        );
        cache
            .chats
            .insert("b".into(), chat(2, "/q", vec![turn("1")]));
        let ranked = vec![
            (doc_id("a", "1"), 0.80),
            (doc_id("a", "2"), 0.78),
            (doc_id("a", "3"), 0.77),
            (doc_id("b", "1"), 0.76),
            (doc_id("gone", "1"), 0.75),
            // Under the best hit's band.
            (doc_id("b", "1"), 0.73),
        ];
        let all = pick(&cache, &ranked, None, 10);
        let got: Vec<(&str, &str)> = all
            .iter()
            .map(|h| (h.session_id.as_str(), h.block_id.as_str()))
            .collect();
        assert_eq!(got, [("a", "1"), ("a", "2"), ("b", "1")]);
        let scoped = pick(&cache, &ranked, Some("/p"), 10);
        assert_eq!(scoped.len(), 2);
        assert!(scoped.iter().all(|h| h.session_id == "a"));
        assert_eq!(pick(&cache, &ranked, None, 1).len(), 1);
        // An unrelated query's best match still sits under the floor.
        let unrelated = vec![(doc_id("a", "1"), 0.68), (doc_id("b", "1"), 0.66)];
        assert!(pick(&cache, &unrelated, None, 10).is_empty());
    }

    #[test]
    fn reuses_unchanged_chats_and_rereads_moved_ones() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, updated_at INTEGER, cwd TEXT,
               harness TEXT, title TEXT, has_user_message INTEGER, archived INTEGER,
               inbox_ask TEXT, blocks_json TEXT);
             CREATE TABLE irgat_transcripts (session_id TEXT PRIMARY KEY);
             CREATE TABLE irgat_blocks (session_id TEXT, seq INTEGER, block_json TEXT);",
        )
        .unwrap();
        let blocks = json!([{"id": "u1", "role": "user", "text": "How do I rename a chat?"}]);
        conn.execute(
            "INSERT INTO sessions VALUES ('s1', 5, '/p', 'claude', 'Chats', 1, 0, NULL, ?1),
                                         ('s2', 6, '/p', 'claude', 'Gone', 1, 1, NULL, ?1),
                                         ('s3', 7, '/p', 'irgat', 'Irgat', 1, 0, NULL, '[]')",
            [blocks.to_string()],
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO irgat_transcripts VALUES ('s3');
             INSERT INTO irgat_blocks VALUES ('s3', 1,
               '{\"id\":\"i1\",\"role\":\"user\",\"text\":\"Summarise todays news\"}');",
        )
        .unwrap();
        let first = load(&conn, Cache::default()).unwrap();
        assert_eq!(first.order, ["s3", "s1"]);
        assert_eq!(first.chats["s3"].turns[0].block_id, "i1");

        // An unchanged chat keeps its cached turns even if its rows change.
        let mut cached = first;
        cached.chats.get_mut("s1").unwrap().turns[0].preview = "cached".into();
        conn.execute("UPDATE sessions SET blocks_json = '[]' WHERE id = 's1'", [])
            .unwrap();
        let second = load(&conn, cached).unwrap();
        assert_eq!(second.chats["s1"].turns[0].preview, "cached");

        conn.execute("UPDATE sessions SET updated_at = 9 WHERE id = 's1'", [])
            .unwrap();
        let third = load(&conn, second).unwrap();
        assert!(third.chats["s1"].turns.is_empty());
        assert_eq!(third.order, ["s1", "s3"]);
    }
}
