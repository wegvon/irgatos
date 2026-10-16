//! Ideas: a Planka-style board for loose ideas, separate from the agents'
//! Kanban. Boards hold lists, lists hold cards, and each board has its own
//! colored labels. Cards are also embedded for meaning-based search when
//! semantic search is on (see `semantic_index::sync_documents`).

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::session_store::{now_millis, validate_id, SessionStore};

pub(crate) const CHANGED: &str = "irgat:ideas-changed";
const DEFAULT_BOARD: &str = "Ideas";
const DEFAULT_LISTS: [&str; 4] = ["Inbox", "Exploring", "Next up", "Parked"];
pub(crate) const LABEL_COLORS: [&str; 9] = [
    "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "gray",
];
const TITLE_MAX: usize = 200;
const NAME_MAX: usize = 60;
const DESCRIPTION_MAX: usize = 100_000;
const TASKS_MAX: usize = 100;
const TASK_MAX: usize = 300;
const LABELS_PER_BOARD_MAX: usize = 40;
const LISTS_MAX: usize = 30;
const BOARDS_MAX: usize = 30;
const PROJECT_MAX: usize = 4096;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeasState {
    pub boards: Vec<IdeaBoard>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaBoard {
    pub id: String,
    pub title: String,
    pub lists: Vec<IdeaList>,
    pub labels: Vec<IdeaLabel>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaList {
    pub id: String,
    pub title: String,
    pub cards: Vec<IdeaCard>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaLabel {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaTask {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaCard {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub description: String,
    pub label_ids: Vec<String>,
    /// Project folder the idea is about; None for ideas about anything else.
    pub project: Option<String>,
    pub tasks: Vec<IdeaTask>,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaCardInput {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub tasks: Vec<IdeaTask>,
    #[serde(default)]
    pub due_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaSearchHit {
    pub card_id: String,
    pub score: f64,
    /// Found by meaning only: no query word appears in the card.
    pub semantic_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaSearchResult {
    pub hits: Vec<IdeaSearchHit>,
    /// "on", "off" (not set up) or "unavailable" (the endpoint failed).
    pub semantic: &'static str,
    pub note: Option<String>,
}

pub(crate) fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS idea_boards (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           position INTEGER NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS idea_lists (
           id TEXT PRIMARY KEY,
           board_id TEXT NOT NULL REFERENCES idea_boards(id) ON DELETE CASCADE,
           title TEXT NOT NULL,
           position INTEGER NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idea_lists_board ON idea_lists (board_id, position);
         CREATE TABLE IF NOT EXISTS idea_labels (
           id TEXT PRIMARY KEY,
           board_id TEXT NOT NULL REFERENCES idea_boards(id) ON DELETE CASCADE,
           name TEXT NOT NULL,
           color TEXT NOT NULL,
           position INTEGER NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idea_labels_board ON idea_labels (board_id, position);
         CREATE TABLE IF NOT EXISTS idea_cards (
           id TEXT PRIMARY KEY,
           list_id TEXT NOT NULL REFERENCES idea_lists(id) ON DELETE CASCADE,
           title TEXT NOT NULL,
           description TEXT NOT NULL DEFAULT '',
           label_ids_json TEXT NOT NULL DEFAULT '[]',
           project TEXT,
           tasks_json TEXT NOT NULL DEFAULT '[]',
           due_at INTEGER,
           position INTEGER NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idea_cards_list ON idea_cards (list_id, position);",
    )
}

// ---- commands ----------------------------------------------------------

#[tauri::command(async)]
pub fn ideas_load(app: AppHandle, store: State<'_, SessionStore>) -> Result<IdeasState, String> {
    let mut conn = store.lock_conn()?;
    let state = load_state(&mut conn)?;
    drop(conn);
    reindex(&app);
    Ok(state)
}

#[tauri::command(async)]
pub fn ideas_board_create(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    title: String,
) -> Result<(), String> {
    create_board(&mut *store.lock_conn()?, &id, &title, now_millis())?;
    notify(&app, false);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_board_rename(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    title: String,
) -> Result<(), String> {
    rename(
        &*store.lock_conn()?,
        "idea_boards",
        &id,
        &normalize_name(&title, "board")?,
    )?;
    notify(&app, false);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_board_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    delete_board(&mut *store.lock_conn()?, &id)?;
    notify(&app, true);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_list_create(
    app: AppHandle,
    store: State<'_, SessionStore>,
    board_id: String,
    id: String,
    title: String,
) -> Result<(), String> {
    create_list(
        &mut *store.lock_conn()?,
        &board_id,
        &id,
        &title,
        now_millis(),
    )?;
    notify(&app, false);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_list_rename(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    title: String,
) -> Result<(), String> {
    rename(
        &*store.lock_conn()?,
        "idea_lists",
        &id,
        &normalize_name(&title, "list")?,
    )?;
    notify(&app, false);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_list_move(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    index: usize,
) -> Result<(), String> {
    move_list(&mut *store.lock_conn()?, &id, index)?;
    notify(&app, false);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_list_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    delete_list(&mut *store.lock_conn()?, &id)?;
    notify(&app, true);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_card_create(
    app: AppHandle,
    store: State<'_, SessionStore>,
    list_id: String,
    card: IdeaCardInput,
    index: Option<usize>,
) -> Result<IdeaCard, String> {
    let card = create_card(
        &mut *store.lock_conn()?,
        &list_id,
        &card,
        index,
        now_millis(),
    )?;
    notify(&app, true);
    Ok(card)
}

#[tauri::command(async)]
pub fn ideas_card_update(
    app: AppHandle,
    store: State<'_, SessionStore>,
    card: IdeaCardInput,
) -> Result<IdeaCard, String> {
    let card = update_card(&*store.lock_conn()?, &card, now_millis())?;
    notify(&app, true);
    Ok(card)
}

#[tauri::command(async)]
pub fn ideas_card_move(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    list_id: String,
    index: usize,
) -> Result<(), String> {
    move_card(&mut *store.lock_conn()?, &id, &list_id, index, now_millis())?;
    notify(&app, false);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_card_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    delete_card(&mut *store.lock_conn()?, &id)?;
    notify(&app, true);
    Ok(())
}

/// Undo for a deletion: the card comes back with its identity and times.
#[tauri::command(async)]
pub fn ideas_card_restore(
    app: AppHandle,
    store: State<'_, SessionStore>,
    card: IdeaCard,
    index: usize,
) -> Result<(), String> {
    restore_card(&mut *store.lock_conn()?, &card, index)?;
    notify(&app, true);
    Ok(())
}

#[tauri::command(async)]
pub fn ideas_label_save(
    app: AppHandle,
    store: State<'_, SessionStore>,
    board_id: String,
    label: IdeaLabel,
) -> Result<IdeaLabel, String> {
    let label = save_label(&*store.lock_conn()?, &board_id, &label, now_millis())?;
    notify(&app, true);
    Ok(label)
}

#[tauri::command(async)]
pub fn ideas_label_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    delete_label(&mut *store.lock_conn()?, &id)?;
    notify(&app, true);
    Ok(())
}

/// Ranks every card against `query`: words that appear in the card, fused
/// with meaning when semantic search is set up. Works without it.
#[tauri::command]
pub async fn ideas_search(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<IdeaSearchResult, String> {
    let limit = limit.unwrap_or(20).clamp(1, 100);
    tauri::async_runtime::spawn_blocking(move || {
        let cards = {
            let store = app.state::<SessionStore>();
            let mut conn = store.lock_conn()?;
            all_cards(&mut conn)?
        };
        let query = query.trim();
        if query.is_empty() {
            return Ok(IdeaSearchResult {
                hits: Vec::new(),
                semantic: "off",
                note: None,
            });
        }
        let words = word_ranking(&cards, query);
        let (semantic, ranked, note) = match crate::semantic_index::rank_documents(
            &app,
            IDEAS_CORPUS,
            IDEAS_SCOPE,
            query,
            limit * 2,
        ) {
            Ok(Some(ranked)) => ("on", ranked, None),
            Ok(None) => ("off", Vec::new(), None),
            Err(error) => (
                "unavailable",
                Vec::new(),
                Some(format!(
                    "Search by meaning is unavailable ({error}); showing word matches only."
                )),
            ),
        };
        Ok(IdeaSearchResult {
            hits: fuse(&cards, &words, &ranked, limit),
            semantic,
            note,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- semantic index ----------------------------------------------------

pub(crate) const IDEAS_CORPUS: &str = "ideas";
pub(crate) const IDEAS_SCOPE: &str = "all";

/// Brings the ideas' vectors up to date in the background.
fn reindex(app: &AppHandle) {
    let store = app.state::<SessionStore>();
    let Ok(mut conn) = store.lock_conn() else {
        return;
    };
    let Ok(state) = load_state(&mut conn) else {
        return;
    };
    drop(conn);
    crate::semantic_index::sync_documents(app, IDEAS_CORPUS, IDEAS_SCOPE, documents(&state));
}

/// The text a card is embedded as: what it says, plus its labels and project.
pub(crate) fn documents(state: &IdeasState) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for board in &state.boards {
        let labels: HashMap<&str, &str> = board
            .labels
            .iter()
            .map(|label| (label.id.as_str(), label.name.as_str()))
            .collect();
        for list in &board.lists {
            for card in &list.cards {
                out.push((card.id.clone(), card_text(card, &labels)));
            }
        }
    }
    out
}

fn card_text(card: &IdeaCard, labels: &HashMap<&str, &str>) -> String {
    let mut text = card.title.clone();
    if !card.description.trim().is_empty() {
        text.push_str("\n\n");
        text.push_str(card.description.trim());
    }
    let tasks: Vec<&str> = card.tasks.iter().map(|task| task.text.as_str()).collect();
    if !tasks.is_empty() {
        text.push_str("\n\n");
        text.push_str(&tasks.join("\n"));
    }
    let names: Vec<&str> = card
        .label_ids
        .iter()
        .filter_map(|id| labels.get(id.as_str()).copied())
        .collect();
    if !names.is_empty() {
        text.push_str("\n\nLabels: ");
        text.push_str(&names.join(", "));
    }
    if let Some(project) = card.project.as_deref() {
        text.push_str("\nProject: ");
        text.push_str(crate::semantic_index::last_path_segment(project));
    }
    text
}

/// Lowercased words of two or more letters, Turkish dotted/dotless i folded.
fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() >= 2)
        .map(fold)
        .collect()
}

fn fold(word: &str) -> String {
    word.chars()
        .flat_map(|c| match c {
            'İ' | 'I' | 'ı' => vec!['i'],
            _ => c.to_lowercase().collect(),
        })
        .collect()
}

/// Cards that contain query words, best first: more distinct words, then a
/// title hit, then a whole-phrase hit.
fn word_ranking(cards: &[(IdeaCard, String)], query: &str) -> Vec<(String, f64)> {
    let terms = {
        let mut terms = words(query);
        terms.dedup();
        terms
    };
    if terms.is_empty() {
        return Vec::new();
    }
    let phrase = fold(query.trim());
    let mut scored: Vec<(String, f64)> = cards
        .iter()
        .filter_map(|(card, text)| {
            let haystack = fold(text);
            let title = fold(&card.title);
            let hits = terms
                .iter()
                .filter(|term| haystack.contains(term.as_str()))
                .count();
            if hits == 0 {
                return None;
            }
            let in_title = terms
                .iter()
                .filter(|term| title.contains(term.as_str()))
                .count();
            let whole = if haystack.contains(&phrase) { 1.0 } else { 0.0 };
            Some((
                card.id.clone(),
                hits as f64 / terms.len() as f64
                    + 0.25 * in_title as f64 / terms.len() as f64
                    + 0.5 * whole,
            ))
        })
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored
}

/// Reciprocal rank fusion of word matches and meaning. Meaning alone is
/// trusted only above a floor, or every card would match every query.
fn fuse(
    cards: &[(IdeaCard, String)],
    words: &[(String, f64)],
    meaning: &[(String, f32)],
    limit: usize,
) -> Vec<IdeaSearchHit> {
    const K: f64 = 60.0;
    const MEANING_FLOOR: f32 = 0.35;
    let known: HashMap<&str, ()> = cards
        .iter()
        .map(|(card, _)| (card.id.as_str(), ()))
        .collect();
    let mut scores: HashMap<String, (f64, bool)> = HashMap::new();
    for (rank, (id, _)) in words.iter().enumerate() {
        let entry = scores.entry(id.clone()).or_insert((0.0, false));
        entry.0 += 1.0 / (K + rank as f64 + 1.0);
        entry.1 = true;
    }
    for (rank, (id, cosine)) in meaning.iter().enumerate() {
        if !known.contains_key(id.as_str()) {
            continue;
        }
        let matched = scores.get(id).is_some_and(|(_, word)| *word);
        if !matched && *cosine < MEANING_FLOOR {
            continue;
        }
        let entry = scores.entry(id.clone()).or_insert((0.0, false));
        entry.0 += 1.0 / (K + rank as f64 + 1.0);
    }
    let mut hits: Vec<IdeaSearchHit> = scores
        .into_iter()
        .map(|(card_id, (score, word))| IdeaSearchHit {
            card_id,
            score,
            semantic_only: !word,
        })
        .collect();
    hits.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.card_id.cmp(&b.card_id))
    });
    hits.truncate(limit);
    hits
}

// ---- storage -----------------------------------------------------------

fn notify(app: &AppHandle, content_changed: bool) {
    let _ = app.emit(CHANGED, ());
    if content_changed {
        reindex(app);
    }
}

fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

fn one_line(text: &str, max: usize) -> String {
    let single = text.split_whitespace().collect::<Vec<_>>().join(" ");
    single
        .chars()
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

fn normalize_name(name: &str, what: &str) -> Result<String, String> {
    let name = one_line(name, NAME_MAX);
    if name.is_empty() {
        return Err(format!("Name the {what} first."));
    }
    Ok(name)
}

fn normalize_title(title: &str) -> String {
    let title = one_line(title, TITLE_MAX);
    if title.is_empty() {
        "Untitled idea".into()
    } else {
        title
    }
}

fn normalize_description(text: &str) -> Result<String, String> {
    if text.len() > DESCRIPTION_MAX {
        return Err("The description is too long.".into());
    }
    Ok(text.replace("\r\n", "\n").replace('\r', "\n"))
}

fn normalize_project(project: Option<&str>) -> Result<Option<String>, String> {
    let Some(project) = project.map(str::trim).filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    if project.len() > PROJECT_MAX {
        return Err("The project path is too long.".into());
    }
    let project = if project.len() > 1 {
        project.trim_end_matches(['/', '\\'])
    } else {
        project
    };
    Ok(Some(project.to_string()))
}

fn normalize_tasks(tasks: &[IdeaTask]) -> Result<Vec<IdeaTask>, String> {
    if tasks.len() > TASKS_MAX {
        return Err(format!("A card holds at most {TASKS_MAX} checklist items."));
    }
    let mut out = Vec::new();
    for task in tasks {
        validate_id(&task.id, "checklist item")?;
        let text = one_line(&task.text, TASK_MAX);
        if text.is_empty() || out.iter().any(|t: &IdeaTask| t.id == task.id) {
            continue;
        }
        out.push(IdeaTask {
            id: task.id.clone(),
            text,
            done: task.done,
        });
    }
    Ok(out)
}

/// Only labels of the card's own board, once each, in the given order.
fn normalize_label_ids(
    conn: &Connection,
    board_id: &str,
    ids: &[String],
) -> Result<Vec<String>, String> {
    let known = label_ids(conn, board_id).map_err(sql)?;
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        if known.contains(id) && !out.contains(id) {
            out.push(id.clone());
        }
    }
    Ok(out)
}

fn label_ids(conn: &Connection, board_id: &str) -> rusqlite::Result<Vec<String>> {
    conn.prepare("SELECT id FROM idea_labels WHERE board_id = ?1")?
        .query_map([board_id], |row| row.get(0))?
        .collect()
}

fn to_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn rename(conn: &Connection, table: &str, id: &str, title: &str) -> Result<(), String> {
    validate_id(id, "item")?;
    let changed = conn
        .execute(
            &format!("UPDATE {table} SET title = ?1, updated_at = ?2 WHERE id = ?3"),
            params![title, now_millis(), id],
        )
        .map_err(sql)?;
    if changed == 0 {
        return Err("This no longer exists.".into());
    }
    Ok(())
}

/// Every board, with a default board created the first time.
pub(crate) fn load_state(conn: &mut Connection) -> Result<IdeasState, String> {
    let tx = conn.transaction().map_err(sql)?;
    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM idea_boards", [], |row| row.get(0))
        .map_err(sql)?;
    if count == 0 {
        seed_board(
            &tx,
            &uuid::Uuid::new_v4().to_string(),
            DEFAULT_BOARD,
            now_millis(),
        )?;
    }
    let boards = read_boards(&tx).map_err(sql)?;
    tx.commit().map_err(sql)?;
    Ok(IdeasState { boards })
}

fn seed_board(conn: &Connection, id: &str, title: &str, now: i64) -> Result<(), String> {
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM idea_boards",
            [],
            |row| row.get(0),
        )
        .map_err(sql)?;
    conn.execute(
        "INSERT INTO idea_boards (id, title, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, title, position, now],
    )
    .map_err(sql)?;
    for (position, title) in DEFAULT_LISTS.iter().enumerate() {
        conn.execute(
            "INSERT INTO idea_lists (id, board_id, title, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                uuid::Uuid::new_v4().to_string(),
                id,
                title,
                position as i64,
                now
            ],
        )
        .map_err(sql)?;
    }
    Ok(())
}

fn read_boards(conn: &Connection) -> rusqlite::Result<Vec<IdeaBoard>> {
    let mut boards = conn
        .prepare("SELECT id, title, created_at FROM idea_boards ORDER BY position, created_at, id")?
        .query_map([], |row| {
            Ok(IdeaBoard {
                id: row.get(0)?,
                title: row.get(1)?,
                lists: Vec::new(),
                labels: Vec::new(),
                created_at: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut lists = conn.prepare(
        "SELECT id, title FROM idea_lists WHERE board_id = ?1 ORDER BY position, created_at, id",
    )?;
    let mut labels = conn.prepare(
        "SELECT id, name, color FROM idea_labels WHERE board_id = ?1 ORDER BY position, created_at, id",
    )?;
    let mut cards = conn.prepare(&format!(
        "{CARD_SELECT} WHERE list_id = ?1 ORDER BY position, created_at, id"
    ))?;
    for board in &mut boards {
        board.labels = labels
            .query_map([&board.id], |row| {
                Ok(IdeaLabel {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        board.lists = lists
            .query_map([&board.id], |row| {
                Ok(IdeaList {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    cards: Vec::new(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for list in &mut board.lists {
            list.cards = cards
                .query_map([&list.id], read_card)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
        }
    }
    Ok(boards)
}

/// Every card with the text it is searched by.
fn all_cards(conn: &mut Connection) -> Result<Vec<(IdeaCard, String)>, String> {
    let state = load_state(conn)?;
    let mut out = Vec::new();
    for board in &state.boards {
        let labels: HashMap<&str, &str> = board
            .labels
            .iter()
            .map(|label| (label.id.as_str(), label.name.as_str()))
            .collect();
        for list in &board.lists {
            for card in &list.cards {
                out.push((card.clone(), card_text(card, &labels)));
            }
        }
    }
    Ok(out)
}

const CARD_SELECT: &str = "SELECT id, list_id, title, description, label_ids_json, project,
       tasks_json, due_at, created_at, updated_at FROM idea_cards";

fn read_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<IdeaCard> {
    let label_ids: String = row.get(4)?;
    let tasks: String = row.get(6)?;
    Ok(IdeaCard {
        id: row.get(0)?,
        list_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        label_ids: serde_json::from_str(&label_ids).unwrap_or_default(),
        project: row.get(5)?,
        tasks: serde_json::from_str(&tasks).unwrap_or_default(),
        due_at: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn get_card(conn: &Connection, id: &str) -> Result<IdeaCard, String> {
    conn.query_row(&format!("{CARD_SELECT} WHERE id = ?1"), [id], read_card)
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "This idea no longer exists.".to_string())
}

fn list_board(conn: &Connection, list_id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT board_id FROM idea_lists WHERE id = ?1",
        [list_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(sql)?
    .ok_or_else(|| "This list no longer exists.".to_string())
}

fn ids_in(
    conn: &Connection,
    sql_text: &str,
    parent: &str,
    excluding: &str,
) -> rusqlite::Result<Vec<String>> {
    conn.prepare(sql_text)?
        .query_map(params![parent, excluding], |row| row.get(0))?
        .collect()
}

fn card_ids(conn: &Connection, list_id: &str, excluding: &str) -> rusqlite::Result<Vec<String>> {
    ids_in(
        conn,
        "SELECT id FROM idea_cards WHERE list_id = ?1 AND id != ?2 ORDER BY position, created_at, id",
        list_id,
        excluding,
    )
}

fn list_ids(conn: &Connection, board_id: &str, excluding: &str) -> rusqlite::Result<Vec<String>> {
    ids_in(
        conn,
        "SELECT id FROM idea_lists WHERE board_id = ?1 AND id != ?2 ORDER BY position, created_at, id",
        board_id,
        excluding,
    )
}

fn write_card_positions(conn: &Connection, list_id: &str, ids: &[String]) -> rusqlite::Result<()> {
    let mut statement =
        conn.prepare("UPDATE idea_cards SET list_id = ?1, position = ?2 WHERE id = ?3")?;
    for (position, id) in ids.iter().enumerate() {
        statement.execute(params![list_id, position as i64, id])?;
    }
    Ok(())
}

fn write_list_positions(conn: &Connection, ids: &[String]) -> rusqlite::Result<()> {
    let mut statement = conn.prepare("UPDATE idea_lists SET position = ?1 WHERE id = ?2")?;
    for (position, id) in ids.iter().enumerate() {
        statement.execute(params![position as i64, id])?;
    }
    Ok(())
}

pub(crate) fn create_board(
    conn: &mut Connection,
    id: &str,
    title: &str,
    now: i64,
) -> Result<(), String> {
    validate_id(id, "board")?;
    let title = normalize_name(title, "board")?;
    let tx = conn.transaction().map_err(sql)?;
    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM idea_boards", [], |row| row.get(0))
        .map_err(sql)?;
    if count as usize >= BOARDS_MAX {
        return Err(format!("You can have at most {BOARDS_MAX} boards."));
    }
    seed_board(&tx, id, &title, now)?;
    tx.commit().map_err(sql)
}

/// Deletes a board with its lists, cards and labels. The last board stays.
pub(crate) fn delete_board(conn: &mut Connection, id: &str) -> Result<(), String> {
    validate_id(id, "board")?;
    let tx = conn.transaction().map_err(sql)?;
    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM idea_boards", [], |row| row.get(0))
        .map_err(sql)?;
    if count <= 1 {
        return Err("Keep at least one board.".into());
    }
    for statement in [
        "DELETE FROM idea_cards WHERE list_id IN (SELECT id FROM idea_lists WHERE board_id = ?1)",
        "DELETE FROM idea_lists WHERE board_id = ?1",
        "DELETE FROM idea_labels WHERE board_id = ?1",
        "DELETE FROM idea_boards WHERE id = ?1",
    ] {
        tx.execute(statement, [id]).map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

pub(crate) fn create_list(
    conn: &mut Connection,
    board_id: &str,
    id: &str,
    title: &str,
    now: i64,
) -> Result<(), String> {
    validate_id(board_id, "board")?;
    validate_id(id, "list")?;
    let title = normalize_name(title, "list")?;
    let tx = conn.transaction().map_err(sql)?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM idea_boards WHERE id = ?1)",
            [board_id],
            |row| row.get(0),
        )
        .map_err(sql)?;
    if !exists {
        return Err("This board no longer exists.".into());
    }
    let ids = list_ids(&tx, board_id, id).map_err(sql)?;
    if ids.len() >= LISTS_MAX {
        return Err(format!("A board holds at most {LISTS_MAX} lists."));
    }
    tx.execute(
        "INSERT INTO idea_lists (id, board_id, title, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, board_id, title, ids.len() as i64, now],
    )
    .map_err(sql)?;
    tx.commit().map_err(sql)
}

pub(crate) fn move_list(conn: &mut Connection, id: &str, index: usize) -> Result<(), String> {
    validate_id(id, "list")?;
    let tx = conn.transaction().map_err(sql)?;
    let board_id = list_board(&tx, id)?;
    let mut ids = list_ids(&tx, &board_id, id).map_err(sql)?;
    ids.insert(index.min(ids.len()), id.to_string());
    write_list_positions(&tx, &ids).map_err(sql)?;
    tx.commit().map_err(sql)
}

/// Deletes a list with its cards. A board keeps at least one list.
pub(crate) fn delete_list(conn: &mut Connection, id: &str) -> Result<(), String> {
    validate_id(id, "list")?;
    let tx = conn.transaction().map_err(sql)?;
    let Some(board_id) = tx
        .query_row(
            "SELECT board_id FROM idea_lists WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql)?
    else {
        return Ok(());
    };
    let rest = list_ids(&tx, &board_id, id).map_err(sql)?;
    if rest.is_empty() {
        return Err("Keep at least one list on the board.".into());
    }
    tx.execute("DELETE FROM idea_cards WHERE list_id = ?1", [id])
        .map_err(sql)?;
    tx.execute("DELETE FROM idea_lists WHERE id = ?1", [id])
        .map_err(sql)?;
    write_list_positions(&tx, &rest).map_err(sql)?;
    tx.commit().map_err(sql)
}

pub(crate) fn create_card(
    conn: &mut Connection,
    list_id: &str,
    input: &IdeaCardInput,
    index: Option<usize>,
    now: i64,
) -> Result<IdeaCard, String> {
    validate_id(&input.id, "idea")?;
    validate_id(list_id, "list")?;
    let tx = conn.transaction().map_err(sql)?;
    let board_id = list_board(&tx, list_id)?;
    let card = IdeaCard {
        id: input.id.clone(),
        list_id: list_id.to_string(),
        title: normalize_title(&input.title),
        description: normalize_description(&input.description)?,
        label_ids: normalize_label_ids(&tx, &board_id, &input.label_ids)?,
        project: normalize_project(input.project.as_deref())?,
        tasks: normalize_tasks(&input.tasks)?,
        due_at: input.due_at,
        created_at: now,
        updated_at: now,
    };
    insert_card_row(&tx, &card)?;
    let mut ids = card_ids(&tx, list_id, &card.id).map_err(sql)?;
    let at = index.unwrap_or(ids.len()).min(ids.len());
    ids.insert(at, card.id.clone());
    write_card_positions(&tx, list_id, &ids).map_err(sql)?;
    tx.commit().map_err(sql)?;
    Ok(card)
}

fn insert_card_row(conn: &Connection, card: &IdeaCard) -> Result<(), String> {
    conn.execute(
        "INSERT INTO idea_cards (id, list_id, title, description, label_ids_json, project,
           tasks_json, due_at, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, -1, ?9, ?10)",
        params![
            card.id,
            card.list_id,
            card.title,
            card.description,
            to_json(&card.label_ids)?,
            card.project,
            to_json(&card.tasks)?,
            card.due_at,
            card.created_at,
            card.updated_at
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            "This idea already exists.".to_string()
        }
        error => sql(error),
    })?;
    Ok(())
}

pub(crate) fn update_card(
    conn: &Connection,
    input: &IdeaCardInput,
    now: i64,
) -> Result<IdeaCard, String> {
    validate_id(&input.id, "idea")?;
    let existing = get_card(conn, &input.id)?;
    let board_id = list_board(conn, &existing.list_id)?;
    let next = IdeaCard {
        title: normalize_title(&input.title),
        description: normalize_description(&input.description)?,
        label_ids: normalize_label_ids(conn, &board_id, &input.label_ids)?,
        project: normalize_project(input.project.as_deref())?,
        tasks: normalize_tasks(&input.tasks)?,
        due_at: input.due_at,
        ..existing.clone()
    };
    if next == existing {
        return Ok(existing);
    }
    conn.execute(
        "UPDATE idea_cards SET title = ?1, description = ?2, label_ids_json = ?3, project = ?4,
           tasks_json = ?5, due_at = ?6, updated_at = ?7
         WHERE id = ?8",
        params![
            next.title,
            next.description,
            to_json(&next.label_ids)?,
            next.project,
            to_json(&next.tasks)?,
            next.due_at,
            now,
            next.id
        ],
    )
    .map_err(sql)?;
    get_card(conn, &input.id)
}

pub(crate) fn move_card(
    conn: &mut Connection,
    id: &str,
    list_id: &str,
    index: usize,
    now: i64,
) -> Result<(), String> {
    validate_id(id, "idea")?;
    validate_id(list_id, "list")?;
    let tx = conn.transaction().map_err(sql)?;
    let card = get_card(&tx, id)?;
    let from_board = list_board(&tx, &card.list_id)?;
    let to_board = list_board(&tx, list_id)?;
    let mut ids = card_ids(&tx, list_id, id).map_err(sql)?;
    ids.insert(index.min(ids.len()), id.to_string());
    write_card_positions(&tx, list_id, &ids).map_err(sql)?;
    if card.list_id != list_id {
        let rest = card_ids(&tx, &card.list_id, id).map_err(sql)?;
        write_card_positions(&tx, &card.list_id, &rest).map_err(sql)?;
        // Labels belong to a board, so a card moved to another board drops them.
        let labels = if from_board == to_board {
            card.label_ids.clone()
        } else {
            Vec::new()
        };
        tx.execute(
            "UPDATE idea_cards SET label_ids_json = ?1, updated_at = ?2 WHERE id = ?3",
            params![to_json(&labels)?, now, id],
        )
        .map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

pub(crate) fn delete_card(conn: &mut Connection, id: &str) -> Result<(), String> {
    validate_id(id, "idea")?;
    let tx = conn.transaction().map_err(sql)?;
    let Some(list_id) = tx
        .query_row(
            "SELECT list_id FROM idea_cards WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql)?
    else {
        return Ok(());
    };
    tx.execute("DELETE FROM idea_cards WHERE id = ?1", [id])
        .map_err(sql)?;
    let rest = card_ids(&tx, &list_id, id).map_err(sql)?;
    write_card_positions(&tx, &list_id, &rest).map_err(sql)?;
    tx.commit().map_err(sql)
}

pub(crate) fn restore_card(
    conn: &mut Connection,
    card: &IdeaCard,
    index: usize,
) -> Result<(), String> {
    validate_id(&card.id, "idea")?;
    validate_id(&card.list_id, "list")?;
    let tx = conn.transaction().map_err(sql)?;
    let board_id = list_board(&tx, &card.list_id)
        .map_err(|_| "The list for this idea was deleted.".to_string())?;
    let card = IdeaCard {
        title: normalize_title(&card.title),
        description: normalize_description(&card.description)?,
        label_ids: normalize_label_ids(&tx, &board_id, &card.label_ids)?,
        project: normalize_project(card.project.as_deref())?,
        tasks: normalize_tasks(&card.tasks)?,
        ..card.clone()
    };
    insert_card_row(&tx, &card)?;
    let mut ids = card_ids(&tx, &card.list_id, &card.id).map_err(sql)?;
    ids.insert(index.min(ids.len()), card.id.clone());
    write_card_positions(&tx, &card.list_id, &ids).map_err(sql)?;
    tx.commit().map_err(sql)
}

/// Creates or renames/recolors a label on `board_id`.
pub(crate) fn save_label(
    conn: &Connection,
    board_id: &str,
    label: &IdeaLabel,
    now: i64,
) -> Result<IdeaLabel, String> {
    validate_id(board_id, "board")?;
    validate_id(&label.id, "label")?;
    let name = normalize_name(&label.name, "label")?;
    if !LABEL_COLORS.contains(&label.color.as_str()) {
        return Err("Pick one of the label colors.".into());
    }
    let owner: Option<String> = conn
        .query_row(
            "SELECT board_id FROM idea_labels WHERE id = ?1",
            [&label.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    match owner {
        Some(owner) if owner != board_id => {
            return Err("This label belongs to another board.".into())
        }
        Some(_) => {
            conn.execute(
                "UPDATE idea_labels SET name = ?1, color = ?2 WHERE id = ?3",
                params![name, label.color, label.id],
            )
            .map_err(sql)?;
        }
        None => {
            let ids = label_ids(conn, board_id).map_err(sql)?;
            if ids.len() >= LABELS_PER_BOARD_MAX {
                return Err(format!(
                    "A board holds at most {LABELS_PER_BOARD_MAX} labels."
                ));
            }
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM idea_boards WHERE id = ?1)",
                    [board_id],
                    |row| row.get(0),
                )
                .map_err(sql)?;
            if !exists {
                return Err("This board no longer exists.".into());
            }
            conn.execute(
                "INSERT INTO idea_labels (id, board_id, name, color, position, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![label.id, board_id, name, label.color, ids.len() as i64, now],
            )
            .map_err(sql)?;
        }
    }
    Ok(IdeaLabel {
        id: label.id.clone(),
        name,
        color: label.color.clone(),
    })
}

/// Deletes a label and takes it off every card that had it.
pub(crate) fn delete_label(conn: &mut Connection, id: &str) -> Result<(), String> {
    validate_id(id, "label")?;
    let tx = conn.transaction().map_err(sql)?;
    let Some(board_id) = tx
        .query_row(
            "SELECT board_id FROM idea_labels WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql)?
    else {
        return Ok(());
    };
    let cards: Vec<(String, String)> = tx
        .prepare(
            "SELECT k.id, k.label_ids_json FROM idea_cards k
             JOIN idea_lists l ON l.id = k.list_id WHERE l.board_id = ?1",
        )
        .map_err(sql)?
        .query_map([&board_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(sql)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql)?;
    for (card_id, json) in cards {
        let ids: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
        if ids.iter().any(|label| label == id) {
            let kept: Vec<String> = ids.into_iter().filter(|label| label != id).collect();
            tx.execute(
                "UPDATE idea_cards SET label_ids_json = ?1 WHERE id = ?2",
                params![to_json(&kept)?, card_id],
            )
            .map_err(sql)?;
        }
    }
    tx.execute("DELETE FROM idea_labels WHERE id = ?1", [id])
        .map_err(sql)?;
    tx.commit().map_err(sql)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str, title: &str) -> IdeaCardInput {
        IdeaCardInput {
            id: id.into(),
            title: title.into(),
            description: String::new(),
            label_ids: Vec::new(),
            project: None,
            tasks: Vec::new(),
            due_at: None,
        }
    }

    fn titles(list: &IdeaList) -> Vec<&str> {
        list.cards.iter().map(|card| card.title.as_str()).collect()
    }

    fn first_board(conn: &mut Connection) -> IdeaBoard {
        load_state(conn).unwrap().boards.remove(0)
    }

    #[test]
    fn the_first_load_seeds_one_board_with_default_lists() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let state = load_state(&mut conn).unwrap();
        assert_eq!(state.boards.len(), 1);
        assert_eq!(state.boards[0].title, DEFAULT_BOARD);
        assert_eq!(
            state.boards[0]
                .lists
                .iter()
                .map(|l| l.title.as_str())
                .collect::<Vec<_>>(),
            DEFAULT_LISTS
        );
        let again = load_state(&mut conn).unwrap();
        assert_eq!(again.boards.len(), 1);
        assert_eq!(again.boards[0].id, state.boards[0].id);
    }

    #[test]
    fn cards_are_created_at_an_index_and_moved_between_lists() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = first_board(&mut conn);
        let inbox = &board.lists[0].id;
        let next = &board.lists[2].id;
        create_card(&mut conn, inbox, &input("a", "Voice notes"), None, 1).unwrap();
        create_card(
            &mut conn,
            inbox,
            &input("b", "Dark  mode\nfor mail"),
            None,
            2,
        )
        .unwrap();
        create_card(&mut conn, inbox, &input("c", ""), Some(0), 3).unwrap();
        let board = first_board(&mut conn);
        assert_eq!(
            titles(&board.lists[0]),
            ["Untitled idea", "Voice notes", "Dark mode for mail"]
        );

        move_card(&mut conn, "a", next, 0, 4).unwrap();
        move_card(&mut conn, "c", inbox, 9, 5).unwrap();
        let board = first_board(&mut conn);
        assert_eq!(
            titles(&board.lists[0]),
            ["Dark mode for mail", "Untitled idea"]
        );
        assert_eq!(titles(&board.lists[2]), ["Voice notes"]);
        assert_eq!(board.lists[2].cards[0].list_id, *next);
    }

    #[test]
    fn a_deleted_card_can_be_restored_in_place() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = first_board(&mut conn);
        let inbox = &board.lists[0].id;
        for (id, title) in [("a", "One"), ("b", "Two"), ("c", "Three")] {
            create_card(&mut conn, inbox, &input(id, title), None, 1).unwrap();
        }
        let card = get_card(&conn, "b").unwrap();
        delete_card(&mut conn, "b").unwrap();
        assert_eq!(titles(&first_board(&mut conn).lists[0]), ["One", "Three"]);
        restore_card(&mut conn, &card, 1).unwrap();
        assert_eq!(
            titles(&first_board(&mut conn).lists[0]),
            ["One", "Two", "Three"]
        );
        assert!(restore_card(&mut conn, &card, 1).is_err());
    }

    #[test]
    fn updates_keep_only_the_boards_labels_and_clean_checklists() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = first_board(&mut conn);
        let inbox = board.lists[0].id.clone();
        let label = IdeaLabel {
            id: "l1".into(),
            name: "  side   project ".into(),
            color: "teal".into(),
        };
        assert_eq!(
            save_label(&conn, &board.id, &label, 1).unwrap().name,
            "side project"
        );
        assert!(save_label(
            &conn,
            &board.id,
            &IdeaLabel {
                color: "neon".into(),
                ..label.clone()
            },
            1
        )
        .is_err());
        create_card(&mut conn, &inbox, &input("a", "Idea"), None, 1).unwrap();
        let card = update_card(
            &conn,
            &IdeaCardInput {
                label_ids: vec!["l1".into(), "ghost".into(), "l1".into()],
                project: Some("/work/irgatos/".into()),
                tasks: vec![
                    IdeaTask {
                        id: "t1".into(),
                        text: "  sketch it ".into(),
                        done: true,
                    },
                    IdeaTask {
                        id: "t2".into(),
                        text: "   ".into(),
                        done: false,
                    },
                ],
                due_at: Some(99),
                ..input("a", "Idea")
            },
            2,
        )
        .unwrap();
        assert_eq!(card.label_ids, ["l1"]);
        assert_eq!(card.project.as_deref(), Some("/work/irgatos"));
        assert_eq!(card.tasks.len(), 1);
        assert_eq!(card.tasks[0].text, "sketch it");
        assert_eq!(card.due_at, Some(99));
        assert_eq!(card.updated_at, 2);

        delete_label(&mut conn, "l1").unwrap();
        assert!(get_card(&conn, "a").unwrap().label_ids.is_empty());
    }

    #[test]
    fn moving_to_another_board_drops_labels() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = first_board(&mut conn);
        save_label(
            &conn,
            &board.id,
            &IdeaLabel {
                id: "l1".into(),
                name: "app".into(),
                color: "red".into(),
            },
            1,
        )
        .unwrap();
        create_card(
            &mut conn,
            &board.lists[0].id,
            &IdeaCardInput {
                label_ids: vec!["l1".into()],
                ..input("a", "Idea")
            },
            None,
            1,
        )
        .unwrap();
        create_board(&mut conn, "second", "Personal", 2).unwrap();
        let other = load_state(&mut conn)
            .unwrap()
            .boards
            .into_iter()
            .find(|b| b.id == "second")
            .unwrap();
        move_card(&mut conn, "a", &other.lists[1].id, 0, 3).unwrap();
        assert!(get_card(&conn, "a").unwrap().label_ids.is_empty());
    }

    #[test]
    fn lists_and_boards_keep_one_each() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = first_board(&mut conn);
        assert!(delete_board(&mut conn, &board.id).is_err());
        let ids: Vec<String> = board.lists.iter().map(|l| l.id.clone()).collect();
        create_card(
            &mut conn,
            &ids[0],
            &input("a", "Gone with its list"),
            None,
            1,
        )
        .unwrap();
        for id in &ids[..3] {
            delete_list(&mut conn, id).unwrap();
        }
        assert!(delete_list(&mut conn, &ids[3]).is_err());
        assert!(get_card(&conn, "a").is_err());

        create_list(&mut conn, &board.id, "new", "Later", 1).unwrap();
        move_list(&mut conn, "new", 0).unwrap();
        let board = first_board(&mut conn);
        assert_eq!(
            board
                .lists
                .iter()
                .map(|l| l.title.as_str())
                .collect::<Vec<_>>(),
            ["Later", "Parked"]
        );
        create_board(&mut conn, "b2", "Other", 2).unwrap();
        delete_board(&mut conn, &board.id).unwrap();
        let state = load_state(&mut conn).unwrap();
        assert_eq!(state.boards.len(), 1);
        assert_eq!(state.boards[0].id, "b2");
    }

    fn searchable(id: &str, title: &str, description: &str) -> (IdeaCard, String) {
        let card = IdeaCard {
            id: id.into(),
            list_id: "l".into(),
            title: title.into(),
            description: description.into(),
            label_ids: Vec::new(),
            project: None,
            tasks: Vec::new(),
            due_at: None,
            created_at: 0,
            updated_at: 0,
        };
        let text = card_text(&card, &HashMap::new());
        (card, text)
    }

    #[test]
    fn word_search_folds_turkish_case_and_prefers_titles() {
        let cards = vec![
            searchable("a", "Sesli not", "İstanbul gezisi için fikir"),
            searchable("b", "İstanbul rehberi", ""),
            searchable("c", "Kahve", "nothing here"),
        ];
        let ranked = word_ranking(&cards, "istanbul");
        assert_eq!(
            ranked.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert!(word_ranking(&cards, " ? ").is_empty());
    }

    #[test]
    fn fusion_keeps_strong_meaning_matches_and_drops_weak_ones() {
        let cards = vec![
            searchable("a", "Sesli not", ""),
            searchable("b", "Podcast kaydı", ""),
            searchable("c", "Kahve", ""),
        ];
        let words = word_ranking(&cards, "sesli");
        let meaning = vec![
            ("b".to_string(), 0.62f32),
            ("a".to_string(), 0.58),
            ("c".to_string(), 0.10),
            ("gone".to_string(), 0.9),
        ];
        let hits = fuse(&cards, &words, &meaning, 10);
        let ids: Vec<&str> = hits.iter().map(|hit| hit.card_id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert!(!hits[0].semantic_only);
        assert!(hits[1].semantic_only);
    }

    #[test]
    fn documents_carry_labels_tasks_and_project() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = first_board(&mut conn);
        save_label(
            &conn,
            &board.id,
            &IdeaLabel {
                id: "l1".into(),
                name: "voice".into(),
                color: "blue".into(),
            },
            1,
        )
        .unwrap();
        create_card(
            &mut conn,
            &board.lists[0].id,
            &IdeaCardInput {
                description: "Read replies aloud".into(),
                label_ids: vec!["l1".into()],
                project: Some("/Users/t/irgatos".into()),
                tasks: vec![IdeaTask {
                    id: "t".into(),
                    text: "try Kahya".into(),
                    done: false,
                }],
                ..input("a", "Summaries")
            },
            None,
            1,
        )
        .unwrap();
        let docs = documents(&load_state(&mut conn).unwrap());
        assert_eq!(docs.len(), 1);
        assert_eq!(
            docs[0].1,
            "Summaries\n\nRead replies aloud\n\ntry Kahya\n\nLabels: voice\nProject: irgatos"
        );
    }
}
