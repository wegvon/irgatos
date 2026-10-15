//! Semantic code search for agents: a per-project index of EmbeddingGemma
//! vectors, built in the background against a user-configured endpoint, and
//! a hybrid query that fuses it with `git grep`.
//!
//! Indexing is opt-in per project from Settings. Once a project has an index,
//! searches keep it fresh with an incremental pass at most every few minutes.
//! The endpoint key lives beside the other integration keys and never
//! reaches the webview.

mod chunk;
mod client;
mod index;
mod query;
mod store;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use index::Progress;
use store::{Store, CODE};

const CONFIG_FILE: &str = "semantic-index.json";
const KEY_FILE: &str = "semantic-index-key";
const DB_FILE: &str = "semantic-index.db";
/// Code retrieval loses 10-30 points of top-3 hits at 256 dimensions.
const DIMS: usize = 768;
pub const EVENT: &str = "semantic-index:progress";
const REFRESH_AFTER: Duration = Duration::from_secs(10 * 60);
const MAX_QUERY_CHARS: usize = 500;
const MAX_GREP_TERMS: usize = 6;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    enabled: bool,
    endpoint: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    enabled: bool,
    endpoint: String,
    has_key: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    root: String,
    /// "none", "indexing", "partial" or "complete".
    state: &'static str,
    files: usize,
    chunks: usize,
    progress: Option<Progress>,
    updated_at: Option<i64>,
    last_error: Option<String>,
}

struct Job {
    cancel: AtomicBool,
    progress: Mutex<Progress>,
}

static JOBS: Mutex<Option<HashMap<String, Arc<Job>>>> = Mutex::new(None);
static REFRESHED: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

fn job(scope: &str) -> Option<Arc<Job>> {
    JOBS.lock().ok()?.as_ref()?.get(scope).cloned()
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn load_config(dir: &Path) -> Config {
    std::fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn read_key(dir: &Path) -> Result<Option<String>, String> {
    crate::voice::read_secret(&dir.join(KEY_FILE))
}

fn settings(dir: &Path) -> Result<Settings, String> {
    let config = load_config(dir);
    Ok(Settings {
        enabled: config.enabled,
        endpoint: config.endpoint,
        has_key: read_key(dir)?.is_some(),
    })
}

/// Endpoint and key when semantic search is on and complete.
fn active(dir: &Path) -> Result<Option<(String, String)>, String> {
    let config = load_config(dir);
    if !config.enabled || config.endpoint.trim().is_empty() {
        return Ok(None);
    }
    Ok(read_key(dir)?.map(|key| (config.endpoint, key)))
}

/// Projects are keyed by their canonical path, so a symlinked checkout and
/// its target share one index.
fn scope_of(root: &str) -> Result<PathBuf, String> {
    let root = crate::fs::expand_home(root);
    std::fs::canonicalize(&root).map_err(|e| format!("{}: {e}", root.display()))
}

fn scope_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[tauri::command]
pub fn semantic_index_settings(app: AppHandle) -> Result<Settings, String> {
    settings(&data_dir(&app)?)
}

/// `key`: None leaves the stored key alone, "" removes it. Semantic search
/// only turns on with both an endpoint and a key.
#[tauri::command]
pub fn semantic_index_save_settings(
    app: AppHandle,
    enabled: bool,
    endpoint: String,
    key: Option<String>,
) -> Result<Settings, String> {
    let dir = data_dir(&app)?;
    let endpoint = endpoint.trim().to_string();
    if !endpoint.is_empty() {
        client::embeddings_url(&endpoint)?;
    }
    if let Some(key) = key {
        crate::voice::store_secret(&dir.join(KEY_FILE), &key)?;
    }
    let has_key = read_key(&dir)?.is_some();
    let config = Config {
        enabled: enabled && has_key && !endpoint.is_empty(),
        endpoint,
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::state_file::write_json_atomic(&dir.join(CONFIG_FILE), &config, true)?;
    if !config.enabled {
        if let Ok(jobs) = JOBS.lock() {
            for job in jobs.iter().flat_map(|jobs| jobs.values()) {
                job.cancel.store(true, Ordering::Release);
            }
        }
    }
    settings(&dir)
}

#[tauri::command]
pub async fn semantic_index_status(
    app: AppHandle,
    roots: Vec<String>,
) -> Result<Vec<ProjectStatus>, String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = Store::open(&dir.join(DB_FILE))?;
        roots
            .into_iter()
            .map(|root| {
                let scope = scope_of(&root)
                    .map(|p| scope_key(&p))
                    .unwrap_or(root.clone());
                status(&store, &root, &scope)
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

fn status(store: &Store, root: &str, scope: &str) -> Result<ProjectStatus, String> {
    let stored = store.scope_status(CODE, scope)?;
    let running = job(scope);
    let progress = running
        .as_ref()
        .and_then(|job| job.progress.lock().ok().map(|p| p.clone()));
    let stored_state = match &stored {
        None => "none",
        Some(s) if s.complete => "complete",
        Some(_) => "partial",
    };
    let state = if running.is_some() {
        "indexing"
    } else {
        stored_state
    };
    let stored = stored.unwrap_or_default();
    Ok(ProjectStatus {
        root: root.to_string(),
        state,
        files: stored.items,
        chunks: stored.chunks,
        progress,
        updated_at: stored.updated_at,
        last_error: stored.last_error,
    })
}

/// Starts (or rebuilds) a project's index in the background.
#[tauri::command]
pub fn semantic_index_build(app: AppHandle, root: String, rebuild: bool) -> Result<(), String> {
    start(&app, &scope_of(&root)?, rebuild).map(|_| ())
}

#[tauri::command]
pub fn semantic_index_cancel(root: String) -> Result<(), String> {
    if let Some(job) = job(&scope_key(&scope_of(&root)?)) {
        job.cancel.store(true, Ordering::Release);
    }
    Ok(())
}

/// Stops indexing a project and deletes its vectors.
#[tauri::command]
pub async fn semantic_index_remove(app: AppHandle, root: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let scope = scope_key(&scope_of(&root)?);
    if let Some(job) = job(&scope) {
        job.cancel.store(true, Ordering::Release);
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Wait for a cancelled pass to let go, or it would write the scope back.
        for _ in 0..600 {
            if job(&scope).is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let mut store = Store::open(&dir.join(DB_FILE))?;
        store.clear_scope(CODE, &scope)?;
        let _ = app.emit(EVENT, status(&store, &root, &scope)?);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Starts a pass unless one is already running. Returns whether it started.
fn start(app: &AppHandle, root: &Path, rebuild: bool) -> Result<bool, String> {
    let dir = data_dir(app)?;
    let (endpoint, key) = active(&dir)?
        .ok_or("Turn on semantic search with an endpoint and API key in Settings first")?;
    let embedder = client::Client::new(&endpoint, &key, DIMS)?;
    let scope = scope_key(root);
    let job = Arc::new(Job {
        cancel: AtomicBool::new(false),
        progress: Mutex::new(Progress::default()),
    });
    {
        let mut jobs = JOBS.lock().map_err(|_| "Indexer unavailable")?;
        let jobs = jobs.get_or_insert_with(HashMap::new);
        if jobs.contains_key(&scope) {
            return Ok(false);
        }
        jobs.insert(scope.clone(), job.clone());
    }
    if let Ok(mut refreshed) = REFRESHED.lock() {
        refreshed
            .get_or_insert_with(HashMap::new)
            .insert(scope.clone(), Instant::now());
    }
    let app = app.clone();
    let root = root.to_path_buf();
    std::thread::spawn(move || {
        let result = run_pass(&app, &dir, &root, &scope, &embedder, &job, rebuild);
        if let Ok(mut jobs) = JOBS.lock() {
            if let Some(jobs) = jobs.as_mut() {
                jobs.remove(&scope);
            }
        }
        if let Ok(store) = Store::open(&dir.join(DB_FILE)) {
            if let Err(error) = &result {
                let _ = store.set_scope_state(CODE, &scope, false, Some(error));
            }
            if let Ok(status) = status(&store, &scope, &scope) {
                let _ = app.emit(EVENT, status);
            }
        }
    });
    Ok(true)
}

fn run_pass(
    app: &AppHandle,
    dir: &Path,
    root: &Path,
    scope: &str,
    embedder: &client::Client,
    job: &Job,
    rebuild: bool,
) -> Result<(), String> {
    let mut store = Store::open(&dir.join(DB_FILE))?;
    if rebuild {
        store.clear_scope(CODE, scope)?;
    }
    if store.scope_status(CODE, scope)?.is_none() {
        store.set_scope_state(CODE, scope, false, None)?;
    }
    let files: Vec<String> =
        crate::fs::list_project_files_sync_cancellable(&scope_key(root), Some(&job.cancel))?
            .into_iter()
            .map(|file| file.relative.replace('\\', "/"))
            .collect();
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let outcome = index::index_scope(
        &mut store,
        embedder,
        scope,
        root,
        &files,
        DIMS,
        &job.cancel,
        |progress| {
            if let Ok(mut current) = job.progress.lock() {
                *current = progress.clone();
            }
            if last_emit.elapsed() >= Duration::from_millis(500) {
                last_emit = Instant::now();
                let _ = app.emit(
                    EVENT,
                    json!({"root": scope, "state": "indexing", "progress": progress}),
                );
            }
        },
    )?;
    store.set_scope_state(CODE, scope, outcome == index::Outcome::Complete, None)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchInput {
    query: String,
    #[serde(default)]
    limit: Option<usize>,
}

/// `code.search` for an agent: read-only, scoped to the folder its turn runs
/// in. Works without an index (grep only) and on a partial one.
pub(crate) fn agent_search(app: &AppHandle, cwd: &Path, input: &Value) -> Result<Value, String> {
    let input: SearchInput = serde_json::from_value(input.clone())
        .map_err(|e| format!("code.search takes {{\"query\":\"...\",\"limit\":8}}: {e}"))?;
    let query = input.query.trim();
    if query.is_empty() {
        return Err("query is empty".into());
    }
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(format!("query is longer than {MAX_QUERY_CHARS} characters"));
    }
    let limit = input.limit.unwrap_or(8).clamp(1, 20);
    let cwd = std::fs::canonicalize(cwd).map_err(|e| e.to_string())?;
    let dir = data_dir(app)?;
    let active = active(&dir)?;
    let store = Store::open(&dir.join(DB_FILE))?;

    let embed = active.as_ref().map(|(endpoint, key)| {
        move |text: &str| {
            client::Client::for_query(endpoint, key, DIMS)
                .and_then(|c| c.embed(&[text.to_string()], client::Task::CodeRetrieval))
                .map(|mut vectors| vectors.pop().unwrap_or_default())
        }
    });
    let Found {
        hits,
        scope,
        mut note,
    } = search_folder(
        &store,
        embed
            .as_ref()
            .map(|f| f as &dyn Fn(&str) -> Result<Vec<f32>, String>),
        &cwd,
        query,
        limit,
    )?;

    const OFF: &str =
        "Semantic search is off in Irgatos Settings, so results come from git grep only.";
    let index = match &scope {
        Some(scope) => {
            let status = status(&store, scope, scope)?;
            if active.is_some() && job(scope).is_none() && refresh_due(scope) {
                let _ = start(app, Path::new(scope), false);
            }
            if note.is_none() && active.is_none() {
                note = Some(OFF.into());
            } else if note.is_none() && status.state != "complete" {
                note = Some(match &status.progress {
                    Some(p) if p.total_files > p.done_files => format!(
                        "The semantic index is still being built ({} of {} changed files embedded); results may miss code that is not embedded yet.",
                        p.done_files, p.total_files
                    ),
                    _ => "The semantic index is incomplete; results may miss some code.".into(),
                });
            }
            json!({"state": status.state, "files": status.files, "chunks": status.chunks})
        }
        None => {
            note = note.or_else(|| {
                Some(if active.is_some() {
                    "This project has no semantic index, so results come from git grep only. The user can index it in Irgatos Settings > Semantic search.".into()
                } else {
                    OFF.into()
                })
            });
            json!({"state": "none"})
        }
    };
    Ok(json!({"results": hits, "index": index, "note": note}))
}

/// Turns a search query into a vector.
type EmbedQuery<'a> = &'a dyn Fn(&str) -> Result<Vec<f32>, String>;

struct Found {
    hits: Vec<query::Hit>,
    /// The indexed project holding the folder, if any.
    scope: Option<String>,
    note: Option<String>,
}

/// The hybrid search itself. `embed` turns the query into a vector; without
/// it, or without an index for `cwd`, only grep contributes.
fn search_folder(
    store: &Store,
    embed: Option<EmbedQuery<'_>>,
    cwd: &Path,
    query: &str,
    limit: usize,
) -> Result<Found, String> {
    // The deepest indexed project that holds this folder.
    let cwd_key = scope_key(cwd);
    let scope = store
        .scopes(CODE)?
        .into_iter()
        .filter(|scope| cwd_key == *scope || cwd_key.starts_with(&format!("{scope}/")))
        .max_by_key(String::len);
    let prefix = scope
        .as_ref()
        .map(|scope| {
            let rest = cwd_key[scope.len()..].trim_start_matches('/');
            if rest.is_empty() {
                String::new()
            } else {
                format!("{rest}/")
            }
        })
        .unwrap_or_default();

    let mut note = None;
    let (chunks, query_vector) = match (&scope, embed) {
        (Some(scope), Some(embed)) => {
            let chunks = store.chunks(CODE, scope, &prefix)?;
            match embed(query) {
                Ok(vector) => (chunks, Some(vector)),
                Err(error) => {
                    note = Some(format!("Semantic search is unavailable ({error}); results come from git grep only."));
                    (Vec::new(), None)
                }
            }
        }
        _ => (Vec::new(), None),
    };
    let chunk_paths: Vec<Option<String>> = chunks
        .iter()
        .map(|c| c.item.strip_prefix(&prefix).map(str::to_string))
        .collect();

    let terms = query::terms(query);
    let terms = &terms[..terms.len().min(MAX_GREP_TERMS)];
    let cancel = AtomicBool::new(false);
    let mut matches = Vec::new();
    for (index, term) in terms.iter().enumerate() {
        let options = crate::search::SearchOptions {
            cwd: scope_key(cwd),
            query: term.clone(),
            case_sensitive: false,
            whole_word: false,
            regex: false,
            include: None,
            exclude: None,
            search_id: String::new(),
        };
        let found = crate::search::search_project_sync(cwd, &options, &cancel)?;
        matches.extend(found.matches.into_iter().map(|m| query::LineMatch {
            path: m.relative,
            line: m.line as usize,
            term: index,
            preview: query::clip_line(&m.preview, 160),
        }));
    }

    let hits = query::hybrid(
        query::Inputs {
            chunks: &chunks,
            chunk_paths: &chunk_paths,
            query_vector: query_vector.as_deref(),
            terms,
            matches: &matches,
        },
        limit,
        |path, start, end| {
            std::fs::read_to_string(cwd.join(path))
                .map(|text| query::preview_lines(&text, start, end))
                .unwrap_or_default()
        },
    );
    Ok(Found { hits, scope, note })
}

fn refresh_due(scope: &str) -> bool {
    let Ok(mut refreshed) = REFRESHED.lock() else {
        return false;
    };
    let refreshed = refreshed.get_or_insert_with(HashMap::new);
    refreshed
        .get(scope)
        .is_none_or(|at| at.elapsed() >= REFRESH_AFTER)
}

/// Whether `cwd` sits in a project with an index, for the agent hint.
#[tauri::command]
pub async fn semantic_index_available(app: AppHandle, cwd: String) -> Result<bool, String> {
    let dir = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if active(&dir)?.is_none() {
            return Ok(false);
        }
        let Ok(cwd) = scope_of(&cwd) else {
            return Ok(false);
        };
        let cwd = scope_key(&cwd);
        let store = Store::open(&dir.join(DB_FILE))?;
        Ok(store
            .scopes(CODE)?
            .iter()
            .any(|scope| cwd == *scope || cwd.starts_with(&format!("{scope}/"))))
    })
    .await
    .map_err(|e| e.to_string())?
}
