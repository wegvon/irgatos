use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::session_store::{now_millis, validate_id, SessionStore};

pub(crate) const CHANGED: &str = "irgat:kanban-changed";
const DEFAULT_COLUMNS: [&str; 4] = ["Backlog", "In progress", "Review", "Done"];
const CARD_TITLE_MAX: usize = 200;
const COLUMN_TITLE_MAX: usize = 60;
const NOTES_MAX: usize = 100_000;
const LABEL_MAX: usize = 32;
const LABELS_MAX: usize = 3;
const COLUMNS_MAX: usize = 24;
const PROJECT_MAX: usize = 4096;
const SESSION_STATUSES: [&str; 6] = [
    "running",
    "needs-input",
    "finished",
    "failed",
    "stopped",
    "draft",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanBoard {
    pub id: String,
    pub project: String,
    pub columns: Vec<KanbanColumn>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumn {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub cards: Vec<KanbanCard>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCard {
    pub id: String,
    pub column_id: String,
    pub title: String,
    pub notes: String,
    pub labels: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub session: Option<KanbanCardSession>,
    /// Present on cards the board filed for their session by itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_title: Option<String>,
}

/// The agent session a card is linked to. `status` is the last state the app
/// saw, so a card can show it before the session is loaded again.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCardSession {
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub harness: Option<String>,
    /// False until the session has been saved, or after it was deleted.
    #[serde(default)]
    pub saved: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanSessionLink {
    pub session_id: String,
    pub card_id: String,
    pub project: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCardInput {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub labels: Vec<String>,
}

/// One session the board should show. Live sessions report their state; the
/// rest are read from their saved transcript.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanSessionSync {
    pub session_id: String,
    pub title: String,
    #[serde(default)]
    pub status: Option<String>,
    /// Only file a missing card: a saved transcript can lag a live session,
    /// so it never moves a card or touches a dismissal.
    #[serde(default)]
    pub backfill: bool,
    /// The user asked for this card, which overrides an earlier dismissal.
    #[serde(default)]
    pub force: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedPayload {
    project: String,
}

pub(crate) fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS kanban_boards (
           id TEXT PRIMARY KEY,
           project TEXT NOT NULL UNIQUE,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS kanban_columns (
           id TEXT PRIMARY KEY,
           board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
           title TEXT NOT NULL,
           position INTEGER NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS kanban_columns_board
           ON kanban_columns (board_id, position);
         CREATE TABLE IF NOT EXISTS kanban_cards (
           id TEXT PRIMARY KEY,
           column_id TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE CASCADE,
           title TEXT NOT NULL,
           notes TEXT NOT NULL DEFAULT '',
           labels_json TEXT NOT NULL DEFAULT '[]',
           position INTEGER NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS kanban_cards_column
           ON kanban_cards (column_id, position);",
    )?;
    ensure_card_column(conn, "session_id", "TEXT")?;
    ensure_card_column(conn, "session_status", "TEXT")?;
    // Set on cards the board filed for a session: the title it last wrote, so
    // a title the user typed is never replaced.
    ensure_card_column(conn, "auto_title", "TEXT")?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS kanban_cards_session
           ON kanban_cards (session_id) WHERE session_id IS NOT NULL;
         CREATE TABLE IF NOT EXISTS kanban_session_dismissals (
           session_id TEXT PRIMARY KEY,
           status TEXT,
           dismissed_at INTEGER NOT NULL
         );",
    )
}

fn ensure_card_column(conn: &Connection, column: &str, decl: &str) -> rusqlite::Result<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('kanban_cards') WHERE name = ?1",
        [column],
        |row| row.get(0),
    )?;
    if present == 0 {
        conn.execute(
            &format!("ALTER TABLE kanban_cards ADD COLUMN {column} {decl}"),
            [],
        )?;
    }
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_board(
    store: State<'_, SessionStore>,
    project: String,
) -> Result<KanbanBoard, String> {
    let mut conn = store.lock_conn()?;
    load_board(&mut conn, &project)
}

#[tauri::command(async)]
pub fn kanban_card_create(
    app: AppHandle,
    store: State<'_, SessionStore>,
    column_id: String,
    card: KanbanCardInput,
    index: Option<usize>,
) -> Result<KanbanCard, String> {
    let mut conn = store.lock_conn()?;
    let created = create_card(&mut conn, &column_id, &card, index, now_millis())?;
    notify_column(&app, &conn, &created.column_id);
    Ok(created)
}

#[tauri::command(async)]
pub fn kanban_card_update(
    app: AppHandle,
    store: State<'_, SessionStore>,
    card: KanbanCardInput,
) -> Result<KanbanCard, String> {
    let conn = store.lock_conn()?;
    let updated = update_card(&conn, &card, now_millis())?;
    notify_column(&app, &conn, &updated.column_id);
    Ok(updated)
}

#[tauri::command(async)]
pub fn kanban_card_move(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    column_id: String,
    index: usize,
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    move_card(&mut conn, &id, &column_id, index, now_millis())?;
    notify_column(&app, &conn, &column_id);
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_card_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    let project = card_project(&conn, &id)?;
    delete_card(&mut conn, &id)?;
    notify(&app, project);
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_card_restore(
    app: AppHandle,
    store: State<'_, SessionStore>,
    card: KanbanCard,
    index: usize,
) -> Result<KanbanCard, String> {
    let mut conn = store.lock_conn()?;
    let restored = restore_card(&mut conn, &card, index)?;
    notify_column(&app, &conn, &restored.column_id);
    Ok(restored)
}

#[tauri::command(async)]
pub fn kanban_column_create(
    app: AppHandle,
    store: State<'_, SessionStore>,
    board_id: String,
    id: String,
    title: String,
) -> Result<KanbanColumn, String> {
    let mut conn = store.lock_conn()?;
    let column = create_column(&mut conn, &board_id, &id, &title, now_millis())?;
    notify_column(&app, &conn, &column.id);
    Ok(column)
}

#[tauri::command(async)]
pub fn kanban_column_rename(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    title: String,
) -> Result<(), String> {
    let conn = store.lock_conn()?;
    rename_column(&conn, &id, &title, now_millis())?;
    notify_column(&app, &conn, &id);
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_column_move(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    index: usize,
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    move_column(&mut conn, &id, index)?;
    notify_column(&app, &conn, &id);
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_column_delete(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    let project = column_project(&conn, &id)?;
    delete_column(&mut conn, &id)?;
    notify(&app, project);
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_column_restore(
    app: AppHandle,
    store: State<'_, SessionStore>,
    board_id: String,
    column: KanbanColumn,
    index: usize,
) -> Result<(), String> {
    let mut conn = store.lock_conn()?;
    restore_column(&mut conn, &board_id, &column, index)?;
    notify_column(&app, &conn, &column.id);
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_card_link_session(
    app: AppHandle,
    store: State<'_, SessionStore>,
    id: String,
    session_id: Option<String>,
) -> Result<KanbanCard, String> {
    let conn = store.lock_conn()?;
    let card = link_session(&conn, &id, session_id.as_deref(), now_millis())?;
    if let Some(session_id) = session_id.as_deref() {
        for project in absorb_auto_cards(&conn, session_id, &card.id)? {
            notify(&app, Some(project));
        }
    }
    notify_column(&app, &conn, &card.column_id);
    Ok(card)
}

#[tauri::command(async)]
pub fn kanban_sync_sessions(
    app: AppHandle,
    store: State<'_, SessionStore>,
    project: String,
    sessions: Vec<KanbanSessionSync>,
) -> Result<Vec<String>, String> {
    let mut conn = store.lock_conn()?;
    let changed = sync_sessions(&mut conn, &project, &sessions, now_millis())?;
    for project in &changed {
        notify(&app, Some(project.clone()));
    }
    Ok(changed)
}

#[tauri::command(async)]
pub fn kanban_session_status(
    app: AppHandle,
    store: State<'_, SessionStore>,
    session_id: String,
    status: String,
) -> Result<(), String> {
    let conn = store.lock_conn()?;
    for project in record_session_status(&conn, &session_id, &status)? {
        notify(&app, Some(project));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn kanban_session_links(
    store: State<'_, SessionStore>,
) -> Result<Vec<KanbanSessionLink>, String> {
    let conn = store.lock_conn()?;
    session_links(&conn)
}

fn notify(app: &AppHandle, project: Option<String>) {
    if let Some(project) = project {
        let _ = app.emit(CHANGED, ChangedPayload { project });
    }
}

fn notify_column(app: &AppHandle, conn: &Connection, column_id: &str) {
    notify(app, column_project(conn, column_id).ok().flatten());
}

fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

fn normalize_project(project: &str) -> Result<String, String> {
    let trimmed = project.trim();
    let trimmed = if trimmed.len() > 1 {
        trimmed.trim_end_matches(['/', '\\'])
    } else {
        trimmed
    };
    if trimmed.is_empty() || trimmed.len() > PROJECT_MAX {
        return Err("Choose a project for this board.".into());
    }
    Ok(trimmed.to_string())
}

fn normalize_card_title(title: &str) -> String {
    let single_line = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let sliced: String = single_line.chars().take(CARD_TITLE_MAX).collect();
    let sliced = sliced.trim();
    if sliced.is_empty() {
        "Untitled".into()
    } else {
        sliced.to_string()
    }
}

fn normalize_column_title(title: &str) -> Result<String, String> {
    let single_line = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let sliced: String = single_line.chars().take(COLUMN_TITLE_MAX).collect();
    let sliced = sliced.trim();
    if sliced.is_empty() {
        return Err("Name the column first.".into());
    }
    Ok(sliced.to_string())
}

fn normalize_notes(notes: &str) -> Result<String, String> {
    if notes.len() > NOTES_MAX {
        return Err("Card notes are too long.".into());
    }
    Ok(notes.replace("\r\n", "\n").replace('\r', "\n"))
}

fn normalize_labels(labels: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for input in labels {
        let label = input
            .trim()
            .trim_start_matches('#')
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("-")
            .to_lowercase();
        let label: String = label.chars().take(LABEL_MAX).collect();
        let label = label.trim_end_matches('-').to_string();
        if label.is_empty() || normalized.contains(&label) {
            continue;
        }
        normalized.push(label);
        if normalized.len() == LABELS_MAX {
            break;
        }
    }
    normalized
}

fn column_project(conn: &Connection, column_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT b.project FROM kanban_columns c
         JOIN kanban_boards b ON b.id = c.board_id
         WHERE c.id = ?1",
        [column_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(sql)
}

fn card_project(conn: &Connection, card_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT b.project FROM kanban_cards k
         JOIN kanban_columns c ON c.id = k.column_id
         JOIN kanban_boards b ON b.id = c.board_id
         WHERE k.id = ?1",
        [card_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(sql)
}

fn column_board(conn: &Connection, column_id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT board_id FROM kanban_columns WHERE id = ?1",
        [column_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(sql)?
    .ok_or_else(|| "This column no longer exists.".to_string())
}

/// The board for `project`, created with the default columns on first use.
pub(crate) fn load_board(conn: &mut Connection, project: &str) -> Result<KanbanBoard, String> {
    let project = normalize_project(project)?;
    let tx = conn.transaction().map_err(sql)?;
    let (id, created_at) = ensure_board(&tx, &project)?;
    let columns = read_columns(&tx, &id).map_err(sql)?;
    tx.commit().map_err(sql)?;
    Ok(KanbanBoard {
        id,
        project,
        columns,
        created_at,
    })
}

/// Id and creation time of the board for a normalized `project`.
fn ensure_board(conn: &Connection, project: &str) -> Result<(String, i64), String> {
    let existing: Option<(String, i64)> = conn
        .query_row(
            "SELECT id, created_at FROM kanban_boards WHERE project = ?1",
            [project],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(sql)?;
    if let Some(board) = existing {
        return Ok(board);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_millis();
    conn.execute(
        "INSERT INTO kanban_boards (id, project, created_at) VALUES (?1, ?2, ?3)",
        params![id, project, now],
    )
    .map_err(sql)?;
    for (position, title) in DEFAULT_COLUMNS.iter().enumerate() {
        conn.execute(
            "INSERT INTO kanban_columns (id, board_id, title, position, created_at, updated_at)
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
    Ok((id, now))
}

fn read_columns(conn: &Connection, board_id: &str) -> rusqlite::Result<Vec<KanbanColumn>> {
    let mut columns = conn
        .prepare(
            "SELECT id, title, created_at, updated_at FROM kanban_columns
             WHERE board_id = ?1 ORDER BY position, created_at, id",
        )?
        .query_map([board_id], |row| {
            Ok(KanbanColumn {
                id: row.get(0)?,
                title: row.get(1)?,
                cards: Vec::new(),
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare(&format!(
        "{CARD_SELECT} WHERE k.column_id = ?1 ORDER BY k.position, k.created_at, k.id"
    ))?;
    for column in &mut columns {
        column.cards = statement
            .query_map([&column.id], read_card)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
    }
    Ok(columns)
}

const CARD_SELECT: &str = "SELECT k.id, k.column_id, k.title, k.notes, k.labels_json,
       k.created_at, k.updated_at, k.session_id, k.session_status,
       s.title, s.harness, s.id IS NOT NULL, k.auto_title
     FROM kanban_cards k LEFT JOIN sessions s ON s.id = k.session_id";

fn read_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<KanbanCard> {
    let labels_json: String = row.get(4)?;
    let session_id: Option<String> = row.get(7)?;
    Ok(KanbanCard {
        id: row.get(0)?,
        column_id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        labels: serde_json::from_str(&labels_json).unwrap_or_default(),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        session: match session_id {
            Some(id) => Some(KanbanCardSession {
                id,
                status: row.get(8)?,
                title: row.get(9)?,
                harness: row.get(10)?,
                saved: row.get(11)?,
            }),
            None => None,
        },
        auto_title: row.get(12)?,
    })
}

fn get_card(conn: &Connection, id: &str) -> Result<KanbanCard, String> {
    conn.query_row(&format!("{CARD_SELECT} WHERE k.id = ?1"), [id], read_card)
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "This card no longer exists.".to_string())
}

fn card_ids(conn: &Connection, column_id: &str, excluding: &str) -> rusqlite::Result<Vec<String>> {
    conn.prepare(
        "SELECT id FROM kanban_cards WHERE column_id = ?1 AND id != ?2
         ORDER BY position, created_at, id",
    )?
    .query_map(params![column_id, excluding], |row| row.get(0))?
    .collect()
}

fn write_card_positions(
    conn: &Connection,
    column_id: &str,
    ids: &[String],
) -> rusqlite::Result<()> {
    let mut statement =
        conn.prepare("UPDATE kanban_cards SET column_id = ?1, position = ?2 WHERE id = ?3")?;
    for (position, id) in ids.iter().enumerate() {
        statement.execute(params![column_id, position as i64, id])?;
    }
    Ok(())
}

fn labels_json(labels: &[String]) -> Result<String, String> {
    serde_json::to_string(labels).map_err(|error| error.to_string())
}

pub(crate) fn create_card(
    conn: &mut Connection,
    column_id: &str,
    input: &KanbanCardInput,
    index: Option<usize>,
    now: i64,
) -> Result<KanbanCard, String> {
    validate_id(&input.id, "card")?;
    validate_id(column_id, "column")?;
    let title = normalize_card_title(&input.title);
    let notes = normalize_notes(&input.notes)?;
    let labels = normalize_labels(&input.labels);
    let tx = conn.transaction().map_err(sql)?;
    column_board(&tx, column_id)?;
    tx.execute(
        "INSERT INTO kanban_cards (id, column_id, title, notes, labels_json, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, -1, ?6, ?6)",
        params![input.id, column_id, title, notes, labels_json(&labels)?, now],
    )
    .map_err(sql)?;
    let mut ids = card_ids(&tx, column_id, &input.id).map_err(sql)?;
    let at = index.unwrap_or(ids.len()).min(ids.len());
    ids.insert(at, input.id.clone());
    write_card_positions(&tx, column_id, &ids).map_err(sql)?;
    let card = get_card(&tx, &input.id)?;
    tx.commit().map_err(sql)?;
    Ok(card)
}

pub(crate) fn update_card(
    conn: &Connection,
    input: &KanbanCardInput,
    now: i64,
) -> Result<KanbanCard, String> {
    validate_id(&input.id, "card")?;
    let existing = get_card(conn, &input.id)?;
    let title = normalize_card_title(&input.title);
    let notes = normalize_notes(&input.notes)?;
    let labels = normalize_labels(&input.labels);
    if title == existing.title && notes == existing.notes && labels == existing.labels {
        return Ok(existing);
    }
    conn.execute(
        "UPDATE kanban_cards SET title = ?1, notes = ?2, labels_json = ?3, updated_at = ?4
         WHERE id = ?5",
        params![title, notes, labels_json(&labels)?, now, input.id],
    )
    .map_err(sql)?;
    get_card(conn, &input.id)
}

pub(crate) fn move_card(
    conn: &mut Connection,
    id: &str,
    column_id: &str,
    index: usize,
    now: i64,
) -> Result<(), String> {
    validate_id(id, "card")?;
    validate_id(column_id, "column")?;
    let tx = conn.transaction().map_err(sql)?;
    let card = get_card(&tx, id)?;
    if column_board(&tx, &card.column_id)? != column_board(&tx, column_id)? {
        return Err("Cards can only move within their own board.".into());
    }
    let mut ids = card_ids(&tx, column_id, id).map_err(sql)?;
    ids.insert(index.min(ids.len()), id.to_string());
    write_card_positions(&tx, column_id, &ids).map_err(sql)?;
    if card.column_id != column_id {
        let rest = card_ids(&tx, &card.column_id, id).map_err(sql)?;
        write_card_positions(&tx, &card.column_id, &rest).map_err(sql)?;
        tx.execute(
            "UPDATE kanban_cards SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(sql)?;
    }
    tx.commit().map_err(sql)
}

pub(crate) fn delete_card(conn: &mut Connection, id: &str) -> Result<(), String> {
    validate_id(id, "card")?;
    let tx = conn.transaction().map_err(sql)?;
    let Some((column_id, session_id, session_status)) = tx
        .query_row(
            "SELECT column_id, session_id, session_status FROM kanban_cards WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(sql)?
    else {
        return Ok(());
    };
    if let Some(session_id) = session_id {
        dismiss_session(&tx, &session_id, session_status.as_deref())?;
    }
    tx.execute("DELETE FROM kanban_cards WHERE id = ?1", [id])
        .map_err(sql)?;
    let rest = card_ids(&tx, &column_id, id).map_err(sql)?;
    write_card_positions(&tx, &column_id, &rest).map_err(sql)?;
    tx.commit().map_err(sql)
}

/// Undo for a deletion: the card comes back with its original identity and times.
pub(crate) fn restore_card(
    conn: &mut Connection,
    card: &KanbanCard,
    index: usize,
) -> Result<KanbanCard, String> {
    validate_id(&card.id, "card")?;
    validate_id(&card.column_id, "column")?;
    let tx = conn.transaction().map_err(sql)?;
    column_board(&tx, &card.column_id)
        .map_err(|_| "The column for this card was deleted.".to_string())?;
    insert_card_row(&tx, card)?;
    let mut ids = card_ids(&tx, &card.column_id, &card.id).map_err(sql)?;
    ids.insert(index.min(ids.len()), card.id.clone());
    write_card_positions(&tx, &card.column_id, &ids).map_err(sql)?;
    let restored = get_card(&tx, &card.id)?;
    tx.commit().map_err(sql)?;
    Ok(restored)
}

fn insert_card_row(conn: &Connection, card: &KanbanCard) -> Result<(), String> {
    let title = normalize_card_title(&card.title);
    let notes = normalize_notes(&card.notes)?;
    let labels = normalize_labels(&card.labels);
    let session = card.session.as_ref();
    if let Some(session) = session {
        validate_id(&session.id, "session")?;
        undismiss_session(conn, &session.id)?;
    }
    conn.execute(
        "INSERT INTO kanban_cards (id, column_id, title, notes, labels_json, position, created_at, updated_at, session_id, session_status, auto_title)
         VALUES (?1, ?2, ?3, ?4, ?5, -1, ?6, ?7, ?8, ?9, ?10)",
        params![
            card.id,
            card.column_id,
            title,
            notes,
            labels_json(&labels)?,
            card.created_at,
            card.updated_at,
            session.map(|session| session.id.as_str()),
            session
                .and_then(|session| session.status.as_deref())
                .filter(|status| SESSION_STATUSES.contains(status)),
            session.and(card.auto_title.as_deref()),
        ],
    )
    .map_err(sql)?;
    Ok(())
}

/// Link `id` to a session, or clear the link with `None`. The status starts
/// from the saved transcript so a card linked to an old session reads right.
pub(crate) fn link_session(
    conn: &Connection,
    id: &str,
    session_id: Option<&str>,
    now: i64,
) -> Result<KanbanCard, String> {
    validate_id(id, "card")?;
    let existing = get_card(conn, id)?;
    let Some(session_id) = session_id else {
        if let Some(old) = &existing.session {
            dismiss_session(conn, &old.id, old.status.as_deref())?;
            conn.execute(
                "UPDATE kanban_cards SET session_id = NULL, session_status = NULL, updated_at = ?1
                 WHERE id = ?2",
                params![now, id],
            )
            .map_err(sql)?;
        }
        return get_card(conn, id);
    };
    validate_id(session_id, "session")?;
    if existing.session.as_ref().map(|session| session.id.as_str()) == Some(session_id) {
        return Ok(existing);
    }
    let blocks: Option<String> = conn
        .query_row(
            "SELECT blocks_json FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    let status = blocks.as_deref().map_or("draft", status_from_blocks);
    if let Some(old) = &existing.session {
        dismiss_session(conn, &old.id, old.status.as_deref())?;
    }
    undismiss_session(conn, session_id)?;
    conn.execute(
        "UPDATE kanban_cards SET session_id = ?1, session_status = ?2, updated_at = ?3
         WHERE id = ?4",
        params![session_id, status, now, id],
    )
    .map_err(sql)?;
    get_card(conn, id)
}

/// Remember that the user took `session_id` off the board, so syncing does
/// not file it again until the session starts working or asks for input.
fn dismiss_session(
    conn: &Connection,
    session_id: &str,
    status: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kanban_session_dismissals (session_id, status, dismissed_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET status = excluded.status,
           dismissed_at = excluded.dismissed_at",
        params![session_id, status, now_millis()],
    )
    .map_err(sql)?;
    Ok(())
}

fn undismiss_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM kanban_session_dismissals WHERE session_id = ?1",
        [session_id],
    )
    .map_err(sql)?;
    Ok(())
}

/// Cards the board filed for `session_id` and nobody has touched since give
/// way when the user links that session to a card of their own. Returns the
/// projects whose boards lost a card.
pub(crate) fn absorb_auto_cards(
    conn: &Connection,
    session_id: &str,
    keep: &str,
) -> Result<Vec<String>, String> {
    let doomed = conn
        .prepare(
            "SELECT k.id, k.column_id, b.project FROM kanban_cards k
             JOIN kanban_columns c ON c.id = k.column_id
             JOIN kanban_boards b ON b.id = c.board_id
             WHERE k.session_id = ?1 AND k.id != ?2
               AND k.auto_title IS NOT NULL AND k.title = k.auto_title
               AND k.notes = '' AND k.labels_json = '[]'",
        )
        .map_err(sql)?
        .query_map(params![session_id, keep], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(sql)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql)?;
    let mut projects = Vec::new();
    for (id, column_id, project) in doomed {
        conn.execute("DELETE FROM kanban_cards WHERE id = ?1", [&id])
            .map_err(sql)?;
        let rest = card_ids(conn, &column_id, &id).map_err(sql)?;
        write_card_positions(conn, &column_id, &rest).map_err(sql)?;
        if !projects.contains(&project) {
            projects.push(project);
        }
    }
    Ok(projects)
}

/// Column titles each session state files into, matched without case so
/// renamed or hand-made boards still sync when their names agree.
fn status_column_titles(status: &str) -> &'static [&'static str] {
    match status {
        "running" | "stopped" => &["in progress", "doing", "in-progress", "wip", "working"],
        "needs-input" | "failed" => &[
            "review",
            "in review",
            "needs review",
            "needs input",
            "needs approval",
            "waiting",
        ],
        "finished" => &["done", "finished", "complete", "completed"],
        _ => &["backlog", "todo", "to do", "to-do", "not started"],
    }
}

fn status_column(columns: &[(String, String)], status: &str) -> Option<String> {
    let wanted = status_column_titles(status);
    columns
        .iter()
        .find(|(_, title)| wanted.contains(&title.trim().to_lowercase().as_str()))
        .map(|(id, _)| id.clone())
}

fn board_columns(conn: &Connection, board_id: &str) -> rusqlite::Result<Vec<(String, String)>> {
    conn.prepare("SELECT id, title FROM kanban_columns WHERE board_id = ?1 ORDER BY position, created_at, id")?
        .query_map([board_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}

fn saved_session_status(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<&'static str>, String> {
    let blocks: Option<String> = conn
        .query_row(
            "SELECT blocks_json FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    Ok(blocks.as_deref().map(status_from_blocks))
}

struct LinkedCard {
    id: String,
    column_id: String,
    board_id: String,
    project: String,
    title: String,
    auto_title: Option<String>,
    status: Option<String>,
}

fn linked_cards(conn: &Connection, session_id: &str) -> rusqlite::Result<Vec<LinkedCard>> {
    conn.prepare(
        "SELECT k.id, k.column_id, c.board_id, b.project, k.title, k.auto_title, k.session_status
         FROM kanban_cards k
         JOIN kanban_columns c ON c.id = k.column_id
         JOIN kanban_boards b ON b.id = c.board_id
         WHERE k.session_id = ?1",
    )?
    .query_map([session_id], |row| {
        Ok(LinkedCard {
            id: row.get(0)?,
            column_id: row.get(1)?,
            board_id: row.get(2)?,
            project: row.get(3)?,
            title: row.get(4)?,
            auto_title: row.get(5)?,
            status: row.get(6)?,
        })
    })?
    .collect()
}

fn place_card(
    conn: &Connection,
    id: &str,
    from: &str,
    to: &str,
    index: usize,
) -> rusqlite::Result<()> {
    let mut ids = card_ids(conn, to, id)?;
    ids.insert(index.min(ids.len()), id.to_string());
    write_card_positions(conn, to, &ids)?;
    if from != to {
        let rest = card_ids(conn, from, id)?;
        write_card_positions(conn, from, &rest)?;
    }
    Ok(())
}

/// A linked card follows its session: a change of state moves it to the top
/// of that state's column, while a card the user placed stays put until the
/// session changes state again. Returns whether anything changed.
fn follow_session(
    conn: &Connection,
    card: &LinkedCard,
    status: &str,
    title: &str,
    now: i64,
) -> Result<bool, String> {
    let mut changed = false;
    if card.status.as_deref() != Some(status) {
        conn.execute(
            "UPDATE kanban_cards SET session_status = ?1 WHERE id = ?2",
            params![status, card.id],
        )
        .map_err(sql)?;
        changed = true;
        let columns = board_columns(conn, &card.board_id).map_err(sql)?;
        if let Some(target) = status_column(&columns, status) {
            if target != card.column_id {
                place_card(conn, &card.id, &card.column_id, &target, 0).map_err(sql)?;
                conn.execute(
                    "UPDATE kanban_cards SET updated_at = ?1 WHERE id = ?2",
                    params![now, card.id],
                )
                .map_err(sql)?;
            }
        }
    }
    if card.auto_title.as_deref() == Some(card.title.as_str()) && card.title != title {
        conn.execute(
            "UPDATE kanban_cards SET title = ?1, auto_title = ?1 WHERE id = ?2",
            params![title, card.id],
        )
        .map_err(sql)?;
        changed = true;
    }
    Ok(changed)
}

/// Whether a session with no card should get one. A dismissal holds while the
/// session keeps the state it was dismissed in, follows it through settled
/// states, and lapses once the session starts working or needs input again.
fn wants_card(conn: &Connection, session_id: &str, status: &str) -> Result<bool, String> {
    let dismissed: Option<Option<String>> = conn
        .query_row(
            "SELECT status FROM kanban_session_dismissals WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    let Some(previous) = dismissed else {
        return Ok(true);
    };
    if previous.as_deref() == Some(status) {
        return Ok(false);
    }
    if status == "running" || status == "needs-input" {
        undismiss_session(conn, session_id)?;
        return Ok(true);
    }
    conn.execute(
        "UPDATE kanban_session_dismissals SET status = ?1 WHERE session_id = ?2",
        params![status, session_id],
    )
    .map_err(sql)?;
    Ok(false)
}

/// Put `sessions` on `project`'s board: file a card for each one that has
/// none, and move linked cards when their session changes state. Entries are
/// applied in order and new cards go on top, so pass the newest last. Returns
/// the projects whose boards changed.
pub(crate) fn sync_sessions(
    conn: &mut Connection,
    project: &str,
    sessions: &[KanbanSessionSync],
    now: i64,
) -> Result<Vec<String>, String> {
    let project = normalize_project(project)?;
    for entry in sessions {
        validate_id(&entry.session_id, "session")?;
        if let Some(status) = entry.status.as_deref() {
            if !SESSION_STATUSES.contains(&status) {
                return Err(format!("Unknown session status: {status}"));
            }
        }
    }
    let tx = conn.transaction().map_err(sql)?;
    let (board_id, _) = ensure_board(&tx, &project)?;
    let mut changed: Vec<String> = Vec::new();
    let mut mark = |project: &str| {
        if !changed.iter().any(|known| known == project) {
            changed.push(project.to_string());
        }
    };
    for entry in sessions {
        let status = match entry.status.as_deref() {
            Some(status) => status,
            None => match saved_session_status(&tx, &entry.session_id)? {
                Some(status) => status,
                None => continue,
            },
        };
        let title = normalize_card_title(&entry.title);
        let linked = linked_cards(&tx, &entry.session_id).map_err(sql)?;
        if !linked.is_empty() {
            if entry.backfill {
                continue;
            }
            for card in &linked {
                if follow_session(&tx, card, status, &title, now)? {
                    mark(&card.project);
                }
            }
            continue;
        }
        if entry.force {
            undismiss_session(&tx, &entry.session_id)?;
        } else if entry.backfill {
            let dismissed: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM kanban_session_dismissals WHERE session_id = ?1)",
                    [&entry.session_id],
                    |row| row.get(0),
                )
                .map_err(sql)?;
            if dismissed {
                continue;
            }
        } else if !wants_card(&tx, &entry.session_id, status)? {
            continue;
        }
        let columns = board_columns(&tx, &board_id).map_err(sql)?;
        let Some(column_id) =
            status_column(&columns, status).or_else(|| columns.first().map(|(id, _)| id.clone()))
        else {
            continue;
        };
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO kanban_cards (id, column_id, title, notes, labels_json, position,
               created_at, updated_at, session_id, session_status, auto_title)
             VALUES (?1, ?2, ?3, '', '[]', -1, ?4, ?4, ?5, ?6, ?3)",
            params![id, column_id, title, now, entry.session_id, status],
        )
        .map_err(sql)?;
        place_card(&tx, &id, &column_id, &column_id, 0).map_err(sql)?;
        mark(&project);
    }
    tx.commit().map_err(sql)?;
    Ok(changed)
}

/// The settled state of a saved transcript: whether its last sent turn ended
/// in an error, was stopped, or finished.
pub(crate) fn status_from_blocks(blocks_json: &str) -> &'static str {
    let blocks: Vec<serde_json::Value> = serde_json::from_str(blocks_json).unwrap_or_default();
    let is_sent_user = |block: &serde_json::Value| {
        block.get("role").and_then(serde_json::Value::as_str) == Some("user")
            && block.get("draft").and_then(serde_json::Value::as_bool) != Some(true)
    };
    let Some(last_turn) = blocks.iter().rposition(is_sent_user) else {
        return "draft";
    };
    let mut status = "finished";
    for block in &blocks[last_turn + 1..] {
        if block.get("role").and_then(serde_json::Value::as_str) != Some("system") {
            continue;
        }
        match block.get("notice").and_then(serde_json::Value::as_str) {
            Some("error") => status = "failed",
            Some("interrupt") => status = "stopped",
            _ => {}
        }
    }
    status
}

/// Store the latest status for every card linked to `session_id`, returning the
/// projects whose boards changed.
pub(crate) fn record_session_status(
    conn: &Connection,
    session_id: &str,
    status: &str,
) -> Result<Vec<String>, String> {
    validate_id(session_id, "session")?;
    if !SESSION_STATUSES.contains(&status) {
        return Err(format!("Unknown session status: {status}"));
    }
    let projects = conn
        .prepare(
            "SELECT DISTINCT b.project FROM kanban_cards k
             JOIN kanban_columns c ON c.id = k.column_id
             JOIN kanban_boards b ON b.id = c.board_id
             WHERE k.session_id = ?1 AND IFNULL(k.session_status, '') != ?2",
        )
        .map_err(sql)?
        .query_map(params![session_id, status], |row| row.get(0))
        .map_err(sql)?
        .collect::<rusqlite::Result<Vec<String>>>()
        .map_err(sql)?;
    if !projects.is_empty() {
        conn.execute(
            "UPDATE kanban_cards SET session_status = ?1
             WHERE session_id = ?2 AND IFNULL(session_status, '') != ?1",
            params![status, session_id],
        )
        .map_err(sql)?;
    }
    Ok(projects)
}

pub(crate) fn session_links(conn: &Connection) -> Result<Vec<KanbanSessionLink>, String> {
    conn.prepare(
        "SELECT k.session_id, k.id, b.project, k.session_status FROM kanban_cards k
         JOIN kanban_columns c ON c.id = k.column_id
         JOIN kanban_boards b ON b.id = c.board_id
         WHERE k.session_id IS NOT NULL
         ORDER BY b.project, c.position, k.position",
    )
    .map_err(sql)?
    .query_map([], |row| {
        Ok(KanbanSessionLink {
            session_id: row.get(0)?,
            card_id: row.get(1)?,
            project: row.get(2)?,
            status: row.get(3)?,
        })
    })
    .map_err(sql)?
    .collect::<rusqlite::Result<Vec<_>>>()
    .map_err(sql)
}

fn column_ids(conn: &Connection, board_id: &str, excluding: &str) -> rusqlite::Result<Vec<String>> {
    conn.prepare(
        "SELECT id FROM kanban_columns WHERE board_id = ?1 AND id != ?2
         ORDER BY position, created_at, id",
    )?
    .query_map(params![board_id, excluding], |row| row.get(0))?
    .collect()
}

fn write_column_positions(conn: &Connection, ids: &[String]) -> rusqlite::Result<()> {
    let mut statement = conn.prepare("UPDATE kanban_columns SET position = ?1 WHERE id = ?2")?;
    for (position, id) in ids.iter().enumerate() {
        statement.execute(params![position as i64, id])?;
    }
    Ok(())
}

pub(crate) fn create_column(
    conn: &mut Connection,
    board_id: &str,
    id: &str,
    title: &str,
    now: i64,
) -> Result<KanbanColumn, String> {
    validate_id(board_id, "board")?;
    validate_id(id, "column")?;
    let title = normalize_column_title(title)?;
    let tx = conn.transaction().map_err(sql)?;
    let existing = column_ids(&tx, board_id, id).map_err(sql)?;
    if existing.len() >= COLUMNS_MAX {
        return Err(format!("A board can have up to {COLUMNS_MAX} columns."));
    }
    tx.execute(
        "INSERT INTO kanban_columns (id, board_id, title, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, board_id, title, existing.len() as i64, now],
    )
    .map_err(sql)?;
    tx.commit().map_err(sql)?;
    Ok(KanbanColumn {
        id: id.to_string(),
        title,
        cards: Vec::new(),
        created_at: now,
        updated_at: now,
    })
}

pub(crate) fn rename_column(
    conn: &Connection,
    id: &str,
    title: &str,
    now: i64,
) -> Result<(), String> {
    validate_id(id, "column")?;
    let title = normalize_column_title(title)?;
    let changed = conn
        .execute(
            "UPDATE kanban_columns SET title = ?1, updated_at = ?2 WHERE id = ?3 AND title != ?1",
            params![title, now, id],
        )
        .map_err(sql)?;
    if changed == 0 {
        column_board(conn, id)?;
    }
    Ok(())
}

pub(crate) fn move_column(conn: &mut Connection, id: &str, index: usize) -> Result<(), String> {
    validate_id(id, "column")?;
    let tx = conn.transaction().map_err(sql)?;
    let board_id = column_board(&tx, id)?;
    let mut ids = column_ids(&tx, &board_id, id).map_err(sql)?;
    ids.insert(index.min(ids.len()), id.to_string());
    write_column_positions(&tx, &ids).map_err(sql)?;
    tx.commit().map_err(sql)
}

pub(crate) fn delete_column(conn: &mut Connection, id: &str) -> Result<(), String> {
    validate_id(id, "column")?;
    let tx = conn.transaction().map_err(sql)?;
    let Ok(board_id) = column_board(&tx, id) else {
        return Ok(());
    };
    let sessions = tx
        .prepare(
            "SELECT session_id, session_status FROM kanban_cards
             WHERE column_id = ?1 AND session_id IS NOT NULL",
        )
        .map_err(sql)?
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(sql)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql)?;
    for (session_id, status) in sessions {
        dismiss_session(&tx, &session_id, status.as_deref())?;
    }
    tx.execute("DELETE FROM kanban_columns WHERE id = ?1", [id])
        .map_err(sql)?;
    let rest = column_ids(&tx, &board_id, id).map_err(sql)?;
    write_column_positions(&tx, &rest).map_err(sql)?;
    tx.commit().map_err(sql)
}

/// Undo for a column deletion, including the cards it held.
pub(crate) fn restore_column(
    conn: &mut Connection,
    board_id: &str,
    column: &KanbanColumn,
    index: usize,
) -> Result<(), String> {
    validate_id(board_id, "board")?;
    validate_id(&column.id, "column")?;
    let title = normalize_column_title(&column.title)?;
    let tx = conn.transaction().map_err(sql)?;
    let board_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kanban_boards WHERE id = ?1)",
            [board_id],
            |row| row.get(0),
        )
        .map_err(sql)?;
    if !board_exists {
        return Err("This board no longer exists.".into());
    }
    tx.execute(
        "INSERT INTO kanban_columns (id, board_id, title, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, -1, ?4, ?5)",
        params![
            column.id,
            board_id,
            title,
            column.created_at,
            column.updated_at
        ],
    )
    .map_err(sql)?;
    let mut ids = column_ids(&tx, board_id, &column.id).map_err(sql)?;
    ids.insert(index.min(ids.len()), column.id.clone());
    write_column_positions(&tx, &ids).map_err(sql)?;
    let mut card_order = Vec::with_capacity(column.cards.len());
    for card in &column.cards {
        validate_id(&card.id, "card")?;
        insert_card_row(
            &tx,
            &KanbanCard {
                column_id: column.id.clone(),
                ..card.clone()
            },
        )?;
        card_order.push(card.id.clone());
    }
    write_card_positions(&tx, &column.id, &card_order).map_err(sql)?;
    tx.commit().map_err(sql)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str, title: &str) -> KanbanCardInput {
        KanbanCardInput {
            id: id.into(),
            title: title.into(),
            notes: String::new(),
            labels: Vec::new(),
        }
    }

    fn titles(column: &KanbanColumn) -> Vec<&str> {
        column
            .cards
            .iter()
            .map(|card| card.title.as_str())
            .collect()
    }

    #[test]
    fn a_board_starts_with_the_default_columns_once() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let first = load_board(&mut conn, "/work/app/").unwrap();
        assert_eq!(first.project, "/work/app");
        assert_eq!(
            first
                .columns
                .iter()
                .map(|column| column.title.as_str())
                .collect::<Vec<_>>(),
            DEFAULT_COLUMNS
        );
        let again = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(again.id, first.id);
        assert_eq!(again.columns.len(), 4);
        assert!(load_board(&mut conn, "  ").is_err());
    }

    #[test]
    fn boards_are_scoped_per_project() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let app = load_board(&mut conn, "/work/app").unwrap();
        let api = load_board(&mut conn, "/work/api").unwrap();
        assert_ne!(app.id, api.id);
        create_card(&mut conn, &app.columns[0].id, &input("c1", "Ship"), None, 1).unwrap();
        assert_eq!(
            load_board(&mut conn, "/work/app").unwrap().columns[0]
                .cards
                .len(),
            1
        );
        assert!(load_board(&mut conn, "/work/api").unwrap().columns[0]
            .cards
            .is_empty());
        let error = move_card(&mut conn, "c1", &api.columns[1].id, 0, 2).unwrap_err();
        assert!(error.contains("own board"));
    }

    #[test]
    fn cards_are_created_in_place_and_normalized() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let backlog = &board.columns[0].id;
        create_card(&mut conn, backlog, &input("a", "First"), None, 1).unwrap();
        create_card(&mut conn, backlog, &input("b", "Second"), None, 1).unwrap();
        let top = create_card(
            &mut conn,
            backlog,
            &KanbanCardInput {
                id: "c".into(),
                title: "  Fix\nlogin   flow ".into(),
                notes: "line\r\nnext".into(),
                labels: vec![
                    "Bug".into(),
                    "#bug".into(),
                    "needs review".into(),
                    "p1".into(),
                    "extra".into(),
                ],
            },
            Some(0),
            5,
        )
        .unwrap();
        assert_eq!(top.title, "Fix login flow");
        assert_eq!(top.notes, "line\nnext");
        assert_eq!(top.labels, vec!["bug", "needs-review", "p1"]);
        assert_eq!((top.created_at, top.updated_at), (5, 5));
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(
            titles(&board.columns[0]),
            vec!["Fix login flow", "First", "Second"]
        );
        assert!(create_card(&mut conn, "missing", &input("d", "Lost"), None, 1).is_err());
        assert!(create_card(&mut conn, backlog, &input("bad id", "Nope"), None, 1).is_err());
    }

    #[test]
    fn updates_only_touch_the_timestamp_when_something_changed() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        create_card(
            &mut conn,
            &board.columns[0].id,
            &input("a", "Plan"),
            None,
            10,
        )
        .unwrap();
        let same = update_card(&conn, &input("a", "Plan"), 20).unwrap();
        assert_eq!(same.updated_at, 10);
        let edited = update_card(
            &conn,
            &KanbanCardInput {
                notes: "## Steps".into(),
                ..input("a", "")
            },
            30,
        )
        .unwrap();
        assert_eq!(edited.title, "Untitled");
        assert_eq!(edited.notes, "## Steps");
        assert_eq!((edited.created_at, edited.updated_at), (10, 30));
        assert!(update_card(&conn, &input("gone", "x"), 40).is_err());
        let huge = KanbanCardInput {
            notes: "x".repeat(NOTES_MAX + 1),
            ..input("a", "Plan")
        };
        assert!(update_card(&conn, &huge, 50).is_err());
    }

    #[test]
    fn moving_cards_renumbers_both_columns() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let (backlog, doing) = (&board.columns[0].id, &board.columns[1].id);
        for (id, title) in [("a", "A"), ("b", "B"), ("c", "C")] {
            create_card(&mut conn, backlog, &input(id, title), None, 1).unwrap();
        }
        move_card(&mut conn, "c", backlog, 0, 2).unwrap();
        let board_now = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(titles(&board_now.columns[0]), vec!["C", "A", "B"]);
        assert_eq!(board_now.columns[0].cards[0].updated_at, 1);

        move_card(&mut conn, "a", doing, 99, 3).unwrap();
        move_card(&mut conn, "b", doing, 0, 4).unwrap();
        let board_now = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(titles(&board_now.columns[0]), vec!["C"]);
        assert_eq!(titles(&board_now.columns[1]), vec!["B", "A"]);
        assert_eq!(board_now.columns[1].cards[1].updated_at, 3);
        let positions: Vec<i64> = conn
            .prepare("SELECT position FROM kanban_cards WHERE column_id = ?1 ORDER BY position")
            .unwrap()
            .query_map([doing], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(positions, vec![0, 1]);
    }

    #[test]
    fn a_deleted_card_restores_with_its_identity_and_place() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let backlog = &board.columns[0].id;
        for (id, title) in [("a", "A"), ("b", "B"), ("c", "C")] {
            create_card(&mut conn, backlog, &input(id, title), None, 7).unwrap();
        }
        let deleted = load_board(&mut conn, "/work/app").unwrap().columns[0].cards[1].clone();
        delete_card(&mut conn, "b").unwrap();
        delete_card(&mut conn, "b").unwrap();
        assert_eq!(
            titles(&load_board(&mut conn, "/work/app").unwrap().columns[0]),
            vec!["A", "C"]
        );
        let restored = restore_card(&mut conn, &deleted, 1).unwrap();
        assert_eq!(restored.created_at, 7);
        assert_eq!(
            titles(&load_board(&mut conn, "/work/app").unwrap().columns[0]),
            vec!["A", "B", "C"]
        );
        assert!(restore_card(&mut conn, &deleted, 1).is_err());
    }

    #[test]
    fn deleting_a_column_takes_its_cards_and_undo_brings_both_back() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let review = board.columns[2].id.clone();
        create_card(&mut conn, &review, &input("a", "A"), None, 1).unwrap();
        create_card(&mut conn, &review, &input("b", "B"), None, 1).unwrap();
        let snapshot = load_board(&mut conn, "/work/app").unwrap().columns[2].clone();
        delete_column(&mut conn, &review).unwrap();
        let after = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(after.columns.len(), 3);
        let orphans: i64 = conn
            .query_row("SELECT COUNT(*) FROM kanban_cards", [], |row| row.get(0))
            .unwrap();
        assert_eq!(orphans, 0);

        restore_column(&mut conn, &board.id, &snapshot, 2).unwrap();
        let restored = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(restored.columns[2].title, "Review");
        assert_eq!(titles(&restored.columns[2]), vec!["A", "B"]);
        assert_eq!(restored.columns[3].title, "Done");
    }

    #[test]
    fn columns_can_be_added_renamed_and_reordered() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let blocked = create_column(&mut conn, &board.id, "blocked", " Blocked ", 3).unwrap();
        assert_eq!(blocked.title, "Blocked");
        move_column(&mut conn, "blocked", 1).unwrap();
        rename_column(&conn, "blocked", "Waiting", 4).unwrap();
        assert!(rename_column(&conn, "blocked", "   ", 5).is_err());
        assert!(rename_column(&conn, "missing", "Name", 5).is_err());
        let names: Vec<String> = load_board(&mut conn, "/work/app")
            .unwrap()
            .columns
            .into_iter()
            .map(|column| column.title)
            .collect();
        assert_eq!(
            names,
            vec!["Backlog", "Waiting", "In progress", "Review", "Done"]
        );
        for index in names.len()..COLUMNS_MAX {
            create_column(&mut conn, &board.id, &format!("col-{index}"), "More", 6).unwrap();
        }
        assert!(create_column(&mut conn, &board.id, "one-too-many", "More", 7).is_err());
    }

    #[test]
    fn the_board_survives_reopening_the_database() {
        let path = std::env::temp_dir().join(format!(
            "irgat-kanban-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let board_id = {
            let store = SessionStore::open(path.join("test.db")).unwrap();
            let mut conn = store.lock_conn().unwrap();
            let board = load_board(&mut conn, "/work/app").unwrap();
            create_card(
                &mut conn,
                &board.columns[1].id,
                &input("a", "Kept"),
                None,
                1,
            )
            .unwrap();
            board.id
        };
        {
            let store = SessionStore::open(path.join("test.db")).unwrap();
            let mut conn = store.lock_conn().unwrap();
            let board = load_board(&mut conn, "/work/app").unwrap();
            assert_eq!(board.id, board_id);
            assert_eq!(titles(&board.columns[1]), vec!["Kept"]);
        }
        std::fs::remove_dir_all(path).unwrap();
    }

    fn save_session(conn: &Connection, id: &str, title: &str, blocks: serde_json::Value) {
        conn.execute(
            "INSERT INTO sessions (id, cwd, harness, model, runtime_mode, title, blocks_json, created_at, updated_at)
             VALUES (?1, '/work/app', 'claude', 'default', 'default', ?2, ?3, 1, 1)",
            params![id, title, blocks.to_string()],
        )
        .unwrap();
    }

    #[test]
    fn status_comes_from_the_last_sent_turn() {
        let turn = |extra: serde_json::Value| {
            let mut blocks = vec![
                serde_json::json!({ "id": "u0", "role": "user", "text": "first" }),
                serde_json::json!({ "id": "e0", "role": "system", "notice": "error", "text": "old" }),
                serde_json::json!({ "id": "u1", "role": "user", "text": "again" }),
            ];
            if !extra.is_null() {
                blocks.push(extra);
            }
            serde_json::Value::Array(blocks).to_string()
        };
        assert_eq!(status_from_blocks("[]"), "draft");
        assert_eq!(
            status_from_blocks(
                &serde_json::json!([{ "id": "d", "role": "user", "draft": true }]).to_string()
            ),
            "draft"
        );
        assert_eq!(
            status_from_blocks(&turn(serde_json::Value::Null)),
            "finished"
        );
        assert_eq!(
            status_from_blocks(&turn(
                serde_json::json!({ "id": "e1", "role": "system", "notice": "error" })
            )),
            "failed"
        );
        assert_eq!(
            status_from_blocks(&turn(
                serde_json::json!({ "id": "i1", "role": "system", "notice": "interrupt" })
            )),
            "stopped"
        );
        assert_eq!(status_from_blocks("not json"), "draft");
    }

    #[test]
    fn cards_link_to_sessions_and_read_their_titles() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        create_card(
            &mut conn,
            &board.columns[0].id,
            &input("a", "Fix login"),
            None,
            1,
        )
        .unwrap();
        save_session(
            &conn,
            "s1",
            "Login redirect",
            serde_json::json!([
                { "id": "u", "role": "user", "text": "fix it" },
                { "id": "e", "role": "system", "notice": "error", "text": "boom" }
            ]),
        );

        let linked = link_session(&conn, "a", Some("s1"), 5).unwrap();
        assert_eq!(
            linked.session,
            Some(KanbanCardSession {
                id: "s1".into(),
                status: Some("failed".into()),
                title: Some("Login redirect".into()),
                harness: Some("claude".into()),
                saved: true,
            })
        );
        assert_eq!(linked.updated_at, 5);

        let draft = link_session(&conn, "a", Some("unsaved"), 6).unwrap();
        let session = draft.session.unwrap();
        assert_eq!(session.status.as_deref(), Some("draft"));
        assert!(!session.saved);
        assert_eq!(session.title, None);

        let cleared = link_session(&conn, "a", None, 7).unwrap();
        assert_eq!(cleared.session, None);
        assert!(link_session(&conn, "a", Some("bad id!"), 8).is_err());
        assert!(link_session(&conn, "missing", Some("s1"), 8).is_err());
    }

    #[test]
    fn session_status_updates_every_linked_card_once() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let app = load_board(&mut conn, "/work/app").unwrap();
        let api = load_board(&mut conn, "/work/api").unwrap();
        create_card(&mut conn, &app.columns[0].id, &input("a", "One"), None, 1).unwrap();
        create_card(&mut conn, &api.columns[0].id, &input("b", "Two"), None, 1).unwrap();
        create_card(&mut conn, &api.columns[1].id, &input("c", "Other"), None, 1).unwrap();
        link_session(&conn, "a", Some("s1"), 2).unwrap();
        link_session(&conn, "b", Some("s1"), 2).unwrap();
        link_session(&conn, "c", Some("s2"), 2).unwrap();

        let mut changed = record_session_status(&conn, "s1", "running").unwrap();
        changed.sort();
        assert_eq!(changed, vec!["/work/api", "/work/app"]);
        assert!(record_session_status(&conn, "s1", "running")
            .unwrap()
            .is_empty());
        assert!(record_session_status(&conn, "s1", "exploded").is_err());
        assert_eq!(
            get_card(&conn, "a")
                .unwrap()
                .session
                .unwrap()
                .status
                .as_deref(),
            Some("running")
        );
        assert_eq!(get_card(&conn, "a").unwrap().updated_at, 2);
        assert_eq!(
            get_card(&conn, "c")
                .unwrap()
                .session
                .unwrap()
                .status
                .as_deref(),
            Some("draft")
        );

        let links = session_links(&conn).unwrap();
        assert_eq!(
            links
                .iter()
                .map(|link| (
                    link.session_id.as_str(),
                    link.card_id.as_str(),
                    link.project.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("s1", "b", "/work/api"),
                ("s2", "c", "/work/api"),
                ("s1", "a", "/work/app")
            ]
        );
    }

    #[test]
    fn restoring_a_card_or_column_keeps_its_session() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let column = board.columns[0].id.clone();
        create_card(&mut conn, &column, &input("a", "Linked"), None, 1).unwrap();
        let card = link_session(&conn, "a", Some("s1"), 2).unwrap();
        record_session_status(&conn, "s1", "finished").unwrap();
        let card = KanbanCard {
            session: get_card(&conn, "a").unwrap().session,
            ..card
        };
        delete_card(&mut conn, "a").unwrap();
        let restored = restore_card(&mut conn, &card, 0).unwrap();
        assert_eq!(restored.session, card.session);

        let full = load_board(&mut conn, "/work/app").unwrap().columns[0].clone();
        delete_column(&mut conn, &column).unwrap();
        restore_column(&mut conn, &board.id, &full, 0).unwrap();
        let again = get_card(&conn, "a").unwrap();
        assert_eq!(again.session.unwrap().status.as_deref(), Some("finished"));
    }

    fn live(id: &str, title: &str, status: &str) -> KanbanSessionSync {
        KanbanSessionSync {
            session_id: id.into(),
            title: title.into(),
            status: Some(status.into()),
            backfill: false,
            force: false,
        }
    }

    fn saved(id: &str, title: &str) -> KanbanSessionSync {
        KanbanSessionSync {
            status: None,
            backfill: true,
            ..live(id, title, "draft")
        }
    }

    fn column_of(board: &KanbanBoard, session_id: &str) -> Option<String> {
        board.columns.iter().find_map(|column| {
            column
                .cards
                .iter()
                .any(|card| card.session.as_ref().map(|s| s.id.as_str()) == Some(session_id))
                .then(|| column.title.clone())
        })
    }

    fn card_for(board: &KanbanBoard, session_id: &str) -> KanbanCard {
        board
            .columns
            .iter()
            .flat_map(|column| &column.cards)
            .find(|card| card.session.as_ref().map(|s| s.id.as_str()) == Some(session_id))
            .cloned()
            .unwrap()
    }

    #[test]
    fn sessions_land_in_the_column_for_their_state() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let changed = sync_sessions(
            &mut conn,
            "/work/app/",
            &[
                live("draft", "Plan it", "draft"),
                live("run", "Build it", "running"),
                live("ask", "Ask first", "needs-input"),
                live("done", "Shipped", "finished"),
                live("boom", "Broke", "failed"),
                live("newer", "Also asking", "needs-input"),
            ],
            10,
        )
        .unwrap();
        assert_eq!(changed, vec!["/work/app"]);
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(titles(&board.columns[0]), vec!["Plan it"]);
        assert_eq!(titles(&board.columns[1]), vec!["Build it"]);
        assert_eq!(
            titles(&board.columns[2]),
            vec!["Also asking", "Broke", "Ask first"]
        );
        assert_eq!(titles(&board.columns[3]), vec!["Shipped"]);
        let card = card_for(&board, "ask");
        assert_eq!(card.auto_title.as_deref(), Some("Ask first"));
        assert_eq!(card.session.unwrap().status.as_deref(), Some("needs-input"));

        let again = sync_sessions(
            &mut conn,
            "/work/app",
            &[live("ask", "Ask first", "needs-input")],
            11,
        )
        .unwrap();
        assert!(again.is_empty());
        assert!(sync_sessions(&mut conn, "/work/app", &[live("x", "X", "exploded")], 12).is_err());
    }

    #[test]
    fn cards_follow_state_changes_but_keep_a_manual_place_until_the_next_one() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Fix login", "running")],
            1,
        )
        .unwrap();
        let review = load_board(&mut conn, "/work/app").unwrap().columns[2]
            .id
            .clone();
        create_card(&mut conn, &review, &input("manual", "Read docs"), None, 1).unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Fix login", "needs-input")],
            2,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(titles(&board.columns[2]), vec!["Fix login", "Read docs"]);
        assert_eq!(card_for(&board, "s1").updated_at, 2);

        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Fix login", "finished")],
            3,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "s1").as_deref(), Some("Done"));

        let card = card_for(&board, "s1");
        move_card(&mut conn, &card.id, &board.columns[0].id, 0, 4).unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Fix login", "finished")],
            5,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "s1").as_deref(), Some("Backlog"));

        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Fix login", "running")],
            6,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "s1").as_deref(), Some("In progress"));
    }

    #[test]
    fn renamed_and_missing_columns_still_sync() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        rename_column(&conn, &board.columns[1].id, "Doing", 1).unwrap();
        delete_column(&mut conn, &board.columns[2].id).unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[
                live("run", "Run", "running"),
                live("ask", "Ask", "needs-input"),
            ],
            2,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "run").as_deref(), Some("Doing"));
        assert_eq!(column_of(&board, "ask").as_deref(), Some("Backlog"));
        // With no Review column the card stays where it is.
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("run", "Run", "needs-input")],
            3,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "run").as_deref(), Some("Doing"));
    }

    #[test]
    fn an_auto_title_follows_the_session_until_the_user_edits_it() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "New session", "running")],
            1,
        )
        .unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Fix the login redirect", "running")],
            2,
        )
        .unwrap();
        let card = card_for(&load_board(&mut conn, "/work/app").unwrap(), "s1");
        assert_eq!(card.title, "Fix the login redirect");
        update_card(&conn, &input(&card.id, "Login (mine)"), 3).unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Something else", "finished")],
            4,
        )
        .unwrap();
        let card = card_for(&load_board(&mut conn, "/work/app").unwrap(), "s1");
        assert_eq!(card.title, "Login (mine)");
    }

    #[test]
    fn a_dismissed_session_stays_off_until_it_needs_attention_again() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        sync_sessions(&mut conn, "/work/app", &[live("s1", "Task", "running")], 1).unwrap();
        let card = card_for(&load_board(&mut conn, "/work/app").unwrap(), "s1");
        delete_card(&mut conn, &card.id).unwrap();

        let still =
            sync_sessions(&mut conn, "/work/app", &[live("s1", "Task", "running")], 2).unwrap();
        assert!(still.is_empty());
        sync_sessions(&mut conn, "/work/app", &[live("s1", "Task", "finished")], 3).unwrap();
        assert_eq!(
            column_of(&load_board(&mut conn, "/work/app").unwrap(), "s1"),
            None
        );

        sync_sessions(&mut conn, "/work/app", &[live("s1", "Task", "running")], 4).unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "s1").as_deref(), Some("In progress"));

        // Undo brings the card back and forgets the dismissal.
        let card = card_for(&board, "s1");
        delete_card(&mut conn, &card.id).unwrap();
        restore_card(&mut conn, &card, 0).unwrap();
        delete_card(&mut conn, &card.id).unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Task", "needs-input")],
            5,
        )
        .unwrap();
        assert_eq!(
            column_of(&load_board(&mut conn, "/work/app").unwrap(), "s1").as_deref(),
            Some("Review")
        );
    }

    #[test]
    fn asking_for_a_dismissed_session_files_it_again() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        sync_sessions(&mut conn, "/work/app", &[live("s1", "Task", "finished")], 1).unwrap();
        let card = card_for(&load_board(&mut conn, "/work/app").unwrap(), "s1");
        link_session(&conn, &card.id, None, 2).unwrap();
        sync_sessions(&mut conn, "/work/app", &[live("s1", "Task", "finished")], 3).unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "s1"), None);
        assert_eq!(card_count(&board), 1);

        let forced = KanbanSessionSync {
            force: true,
            ..live("s1", "Task", "finished")
        };
        sync_sessions(&mut conn, "/work/app", &[forced], 4).unwrap();
        assert_eq!(
            column_of(&load_board(&mut conn, "/work/app").unwrap(), "s1").as_deref(),
            Some("Done")
        );
    }

    fn card_count(board: &KanbanBoard) -> usize {
        board.columns.iter().map(|column| column.cards.len()).sum()
    }

    #[test]
    fn saved_sessions_backfill_without_moving_or_reviving_anything() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        let finished = serde_json::json!([{ "id": "u", "role": "user", "text": "go" }]);
        save_session(&conn, "old", "Old work", finished.clone());
        save_session(&conn, "live", "Live work", finished.clone());
        save_session(&conn, "gone", "Dismissed", finished);
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("live", "Live work", "running")],
            1,
        )
        .unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("gone", "Dismissed", "finished")],
            1,
        )
        .unwrap();
        let gone = card_for(&load_board(&mut conn, "/work/app").unwrap(), "gone");
        delete_card(&mut conn, &gone.id).unwrap();

        sync_sessions(
            &mut conn,
            "/work/app",
            &[
                saved("old", "Old work"),
                saved("live", "Live work"),
                saved("gone", "Dismissed"),
                saved("unsaved", "Never saved"),
            ],
            2,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(column_of(&board, "old").as_deref(), Some("Done"));
        assert_eq!(column_of(&board, "live").as_deref(), Some("In progress"));
        assert_eq!(column_of(&board, "gone"), None);
        assert_eq!(column_of(&board, "unsaved"), None);
        // A backfill never touches the dismissal, so a still-finished session stays off.
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("gone", "Dismissed", "finished")],
            3,
        )
        .unwrap();
        assert_eq!(
            column_of(&load_board(&mut conn, "/work/app").unwrap(), "gone"),
            None
        );
    }

    #[test]
    fn linking_a_session_absorbs_its_untouched_auto_card() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Auto", "running"), live("s2", "Kept", "running")],
            1,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let kept = card_for(&board, "s2");
        update_card(
            &conn,
            &KanbanCardInput {
                notes: "my notes".into(),
                ..input(&kept.id, "Kept")
            },
            2,
        )
        .unwrap();
        create_card(
            &mut conn,
            &board.columns[0].id,
            &input("mine", "Mine"),
            None,
            2,
        )
        .unwrap();
        link_session(&conn, "mine", Some("s1"), 3).unwrap();
        assert_eq!(
            absorb_auto_cards(&conn, "s1", "mine").unwrap(),
            vec!["/work/app"]
        );
        sync_sessions(&mut conn, "/work/app", &[live("s1", "Auto", "running")], 4).unwrap();
        link_session(&conn, "mine", Some("s2"), 5).unwrap();
        assert!(absorb_auto_cards(&conn, "s2", "mine").unwrap().is_empty());
        let board = load_board(&mut conn, "/work/app").unwrap();
        assert_eq!(titles(&board.columns[1]), vec!["Mine", "Kept"]);
        assert_eq!(card_for(&board, "s2").title, "Mine");
        // Relinking "mine" away from s1 dismissed it, so it is not filed again.
        sync_sessions(&mut conn, "/work/app", &[live("s1", "Auto", "running")], 6).unwrap();
        assert_eq!(
            column_of(&load_board(&mut conn, "/work/app").unwrap(), "s1"),
            None
        );
    }

    #[test]
    fn deleting_a_column_dismisses_its_sessions_and_undo_restores_them() {
        let store = SessionStore::open_in_memory().unwrap();
        let mut conn = store.lock_conn().unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Done work", "finished")],
            1,
        )
        .unwrap();
        let board = load_board(&mut conn, "/work/app").unwrap();
        let done = board.columns[3].clone();
        delete_column(&mut conn, &done.id).unwrap();
        sync_sessions(
            &mut conn,
            "/work/app",
            &[live("s1", "Done work", "finished")],
            2,
        )
        .unwrap();
        assert_eq!(card_count(&load_board(&mut conn, "/work/app").unwrap()), 0);
        restore_column(&mut conn, &board.id, &done, 3).unwrap();
        let restored = card_for(&load_board(&mut conn, "/work/app").unwrap(), "s1");
        assert_eq!(restored.auto_title.as_deref(), Some("Done work"));
        let dismissals: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM kanban_session_dismissals",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(dismissals, 0);
    }

    #[test]
    fn an_existing_board_table_gains_the_session_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE kanban_cards (
               id TEXT PRIMARY KEY, column_id TEXT NOT NULL, title TEXT NOT NULL,
               notes TEXT NOT NULL DEFAULT '', labels_json TEXT NOT NULL DEFAULT '[]',
               position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
             );
             INSERT INTO kanban_cards VALUES ('a', 'col', 'Old', '', '[]', 0, 1, 1);",
        )
        .unwrap();
        ensure_tables(&conn).unwrap();
        ensure_tables(&conn).unwrap();
        let session: Option<String> = conn
            .query_row(
                "SELECT session_id FROM kanban_cards WHERE id = 'a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(session, None);
        let auto: Option<String> = conn
            .query_row(
                "SELECT auto_title FROM kanban_cards WHERE id = 'a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(auto, None);
    }
}
