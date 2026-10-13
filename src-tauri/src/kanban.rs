use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::session_store::{now_millis, validate_id, SessionStore};

pub(crate) const CHANGED: &str = "monocode:kanban-changed";
const DEFAULT_COLUMNS: [&str; 4] = ["Backlog", "In progress", "Review", "Done"];
const CARD_TITLE_MAX: usize = 200;
const COLUMN_TITLE_MAX: usize = 60;
const NOTES_MAX: usize = 100_000;
const LABEL_MAX: usize = 32;
const LABELS_MAX: usize = 3;
const COLUMNS_MAX: usize = 24;
const PROJECT_MAX: usize = 4096;

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
    )
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
    let existing: Option<(String, i64)> = tx
        .query_row(
            "SELECT id, created_at FROM kanban_boards WHERE project = ?1",
            [&project],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(sql)?;
    let (id, created_at) = match existing {
        Some(board) => board,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            let now = now_millis();
            tx.execute(
                "INSERT INTO kanban_boards (id, project, created_at) VALUES (?1, ?2, ?3)",
                params![id, project, now],
            )
            .map_err(sql)?;
            for (position, title) in DEFAULT_COLUMNS.iter().enumerate() {
                tx.execute(
                    "INSERT INTO kanban_columns (id, board_id, title, position, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![uuid::Uuid::new_v4().to_string(), id, title, position as i64, now],
                )
                .map_err(sql)?;
            }
            (id, now)
        }
    };
    let columns = read_columns(&tx, &id).map_err(sql)?;
    tx.commit().map_err(sql)?;
    Ok(KanbanBoard {
        id,
        project,
        columns,
        created_at,
    })
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
        "SELECT {CARD_COLUMNS} FROM kanban_cards
         WHERE column_id = ?1 ORDER BY position, created_at, id"
    ))?;
    for column in &mut columns {
        column.cards = statement
            .query_map([&column.id], read_card)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
    }
    Ok(columns)
}

const CARD_COLUMNS: &str = "id, column_id, title, notes, labels_json, created_at, updated_at";

fn read_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<KanbanCard> {
    let labels_json: String = row.get(4)?;
    Ok(KanbanCard {
        id: row.get(0)?,
        column_id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        labels: serde_json::from_str(&labels_json).unwrap_or_default(),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn get_card(conn: &Connection, id: &str) -> Result<KanbanCard, String> {
    conn.query_row(
        &format!("SELECT {CARD_COLUMNS} FROM kanban_cards WHERE id = ?1"),
        [id],
        read_card,
    )
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
    let Some(column_id) = tx
        .query_row(
            "SELECT column_id FROM kanban_cards WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql)?
    else {
        return Ok(());
    };
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
    conn.execute(
        "INSERT INTO kanban_cards (id, column_id, title, notes, labels_json, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, -1, ?6, ?7)",
        params![
            card.id,
            card.column_id,
            title,
            notes,
            labels_json(&labels)?,
            card.created_at,
            card.updated_at
        ],
    )
    .map_err(sql)?;
    Ok(())
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
            "monocode-kanban-{}-{}",
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
}
