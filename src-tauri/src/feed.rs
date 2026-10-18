//! The Feed page: posts an agent collects from sources such as X, kept only
//! when they match the interests the user wrote down.
//!
//! Irgatos owns everything up to the agent's tools: the interests, the store,
//! and the scoring. Finding posts is the agent's job, with whatever source
//! tools (an X MCP server, say) its provider has. It reads the interests with
//! `feed.interests` and hands posts over with `feed.add` in the app CLI; each
//! post is embedded with the Smart Search model and scored against the
//! interests by meaning, so off-topic posts land under Filtered instead of
//! the feed. Without Smart Search every post is shown as the agent sent it.

mod store;
mod trending;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use store::{Added, Counts, Interest, Item, NewItem, Store, View};

const DB_FILE: &str = "feed.db";
pub const EVENT: &str = "feed:changed";
const MAX_ITEMS_PER_CALL: usize = 30;
const MAX_TEXT_CHARS: usize = 5_000;
const MAX_SUMMARY_CHARS: usize = 600;
const MAX_TITLE_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 2_000;
const MAX_URL_CHARS: usize = 2_000;
const MAX_MEDIA: usize = 4;
/// Posts embedded per background pass.
const BACKLOG_BATCH: usize = 64;

/// Serializes writers; SQLite's own lock would only make them wait.
static DB: Mutex<()> = Mutex::new(());
static REFRESHING: AtomicBool = AtomicBool::new(false);
static REFRESH_AGAIN: AtomicBool = AtomicBool::new(false);

fn open(app: &AppHandle) -> Result<Store, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Store::open(&dir.join(DB_FILE))
}

/// Runs store work off the async runtime, one writer at a time.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&mut Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = DB.lock().unwrap_or_else(|e| e.into_inner());
        work(&mut open(&app)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn changed(app: &AppHandle) {
    let _ = app.emit(EVENT, ());
}

/// Embeds interests and posts that have no vector yet, then scores every
/// post again if an interest changed. Runs in the background; a call during
/// a pass asks for one more pass.
pub(crate) fn refresh(app: &AppHandle) {
    if !crate::semantic_index::embeddings_on(app) {
        return;
    }
    if REFRESHING.swap(true, Ordering::AcqRel) {
        REFRESH_AGAIN.store(true, Ordering::Release);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            REFRESH_AGAIN.store(false, Ordering::Release);
            match refresh_pass(&app) {
                Ok(true) => changed(&app),
                Ok(false) => {}
                Err(error) => eprintln!("feed: scoring failed: {error}"),
            }
            if !REFRESH_AGAIN.load(Ordering::Acquire) {
                break;
            }
        }
        REFRESHING.store(false, Ordering::Release);
        // A request that came in as the loop ended still gets its pass.
        if REFRESH_AGAIN.swap(false, Ordering::AcqRel) {
            refresh(&app);
        }
    });
}

/// One pass; true when something changed.
fn refresh_pass(app: &AppHandle) -> Result<bool, String> {
    let interests = {
        let _guard = DB.lock().unwrap_or_else(|e| e.into_inner());
        open(app)?.unembedded_interests()?
    };
    let mut any = false;
    if !interests.is_empty() {
        let texts: Vec<String> = interests.iter().map(|(_, t)| t.clone()).collect();
        let Some(vectors) = crate::semantic_index::embed_texts(app, &texts, true)? else {
            return Ok(false);
        };
        let _guard = DB.lock().unwrap_or_else(|e| e.into_inner());
        let mut store = open(app)?;
        for ((id, text), vector) in interests.iter().zip(&vectors) {
            store.set_interest_vector(id, text, vector)?;
        }
        store.rescore()?;
        any = true;
    }
    loop {
        let items = {
            let _guard = DB.lock().unwrap_or_else(|e| e.into_inner());
            open(app)?.unembedded_items(BACKLOG_BATCH)?
        };
        if items.is_empty() {
            break;
        }
        let texts: Vec<String> = items.iter().map(|(_, t)| t.clone()).collect();
        let Some(vectors) = crate::semantic_index::embed_texts(app, &texts, false)? else {
            break;
        };
        let _guard = DB.lock().unwrap_or_else(|e| e.into_inner());
        let store = open(app)?;
        for ((id, _), vector) in items.iter().zip(&vectors) {
            store.set_item_vector(id, vector)?;
        }
        any = true;
    }
    Ok(any)
}

// ---- the Feed page ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    interests: Vec<Interest>,
    threshold: f32,
    /// Smart Search is on, so posts are scored by meaning.
    scoring: bool,
    counts: Counts,
    /// Source → when it last delivered a post, epoch ms.
    last_collected: std::collections::HashMap<String, i64>,
    /// The Irgat and habit that collect the feed, as the page saved them.
    collector: Value,
}

#[tauri::command]
pub async fn feed_overview(app: AppHandle) -> Result<Overview, String> {
    let scoring = crate::semantic_index::embeddings_on(&app);
    let overview = blocking(app.clone(), move |store| {
        store.prune()?;
        Ok(Overview {
            interests: store.interests()?,
            threshold: store.threshold()?,
            scoring,
            counts: store.counts()?,
            last_collected: store.last_collected()?,
            collector: store
                .meta("collector")?
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or(Value::Null),
        })
    })
    .await?;
    refresh(&app);
    Ok(overview)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterestInput {
    id: Option<String>,
    title: String,
    description: String,
    enabled: bool,
}

fn clean_interest(input: &InterestInput) -> Result<(String, String), String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Give the interest a name".into());
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("Keep the name under {MAX_TITLE_CHARS} characters"));
    }
    let description = input.description.trim();
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(format!(
            "Keep the description under {MAX_DESCRIPTION_CHARS} characters"
        ));
    }
    Ok((title.to_string(), description.to_string()))
}

#[tauri::command]
pub async fn feed_save_interest(
    app: AppHandle,
    interest: InterestInput,
) -> Result<Interest, String> {
    let (title, description) = clean_interest(&interest)?;
    let saved = blocking(app.clone(), move |store| {
        let saved = store.save_interest(
            interest.id.as_deref(),
            &title,
            &description,
            interest.enabled,
        )?;
        // Turning one on or off changes scores even when the text stays.
        store.rescore()?;
        Ok(saved)
    })
    .await?;
    refresh(&app);
    changed(&app);
    Ok(saved)
}

#[tauri::command]
pub async fn feed_remove_interest(app: AppHandle, id: String) -> Result<(), String> {
    blocking(app.clone(), move |store| {
        store.remove_interest(&id)?;
        store.rescore()
    })
    .await?;
    changed(&app);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPage {
    items: Vec<Item>,
    total: i64,
}

#[tauri::command]
pub async fn feed_items(
    app: AppHandle,
    view: String,
    interest_id: Option<String>,
    unread_only: bool,
    offset: usize,
    limit: usize,
) -> Result<ItemPage, String> {
    let view = View::parse(&view)?;
    blocking(app, move |store| {
        let (items, total) = store.items(
            view,
            interest_id.as_deref().filter(|id| !id.is_empty()),
            unread_only,
            offset,
            limit.clamp(1, 200),
        )?;
        Ok(ItemPage { items, total })
    })
    .await
}

#[tauri::command]
pub async fn feed_similar(app: AppHandle, id: String) -> Result<Vec<Item>, String> {
    blocking(app, move |store| store.similar_items(&id)).await
}

#[tauri::command]
pub async fn feed_mark(
    app: AppHandle,
    ids: Vec<String>,
    read: Option<bool>,
    saved: Option<bool>,
    hidden: Option<bool>,
) -> Result<(), String> {
    blocking(app, move |store| store.mark(&ids, read, saved, hidden)).await
}

#[tauri::command]
pub async fn feed_mark_all_read(
    app: AppHandle,
    view: String,
    interest_id: Option<String>,
) -> Result<(), String> {
    let view = View::parse(&view)?;
    blocking(app, move |store| {
        store.mark_all_read(view, interest_id.as_deref().filter(|id| !id.is_empty()))
    })
    .await
}

#[tauri::command]
pub async fn feed_set_threshold(app: AppHandle, threshold: f32) -> Result<(), String> {
    if !(0.0..=1.0).contains(&threshold) {
        return Err("The threshold is a cosine between 0 and 1".into());
    }
    blocking(app, move |store| {
        store.set_meta("threshold", Some(&threshold.to_string()))
    })
    .await
}

/// `collector`: {"irgatId":"...","habitId":"..."}, or null to forget it.
#[tauri::command]
pub async fn feed_save_collector(app: AppHandle, collector: Value) -> Result<(), String> {
    if !(collector.is_null() || collector.is_object()) {
        return Err("collector must be an object or null".into());
    }
    blocking(app, move |store| {
        let raw = (!collector.is_null()).then(|| collector.to_string());
        store.set_meta("collector", raw.as_deref())
    })
    .await
}

/// GitHub's trending repositories: `since` is daily, weekly or monthly;
/// `language` one of the tab's languages, or empty for all of them.
#[tauri::command]
pub async fn feed_github_trending(
    since: String,
    language: Option<String>,
    refresh: bool,
) -> Result<trending::TrendingPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        trending::trending(&since, language.as_deref(), refresh)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- the agent's side: `feed.*` in the app CLI ----

pub const AGENT_ACTIONS: [&str; 2] = ["feed.interests", "feed.add"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PostInput {
    source: String,
    id: String,
    url: String,
    text: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    author_name: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    published_at: Option<Value>,
    #[serde(default)]
    interest: String,
    #[serde(default)]
    metrics: Option<Map<String, Value>>,
    #[serde(default)]
    media: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddInput {
    items: Vec<PostInput>,
}

const ADD_USAGE: &str = r#"feed.add takes {"items":[{"source":"x","id":"<post id>","url":"https://...","text":"...","author":"handle","authorName":"Name","publishedAt":"2026-10-15T09:30:00Z","summary":"...","interest":"<interest title>","metrics":{"likes":10},"media":["https://..."]}]}"#;

fn http_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
        && value.len() <= MAX_URL_CHARS
}

fn clip(text: &str, max: usize) -> String {
    let text = text.trim();
    match text.char_indices().nth(max) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_string(),
    }
}

/// Epoch ms from RFC 3339, or from a number in seconds or milliseconds.
fn parse_time(value: &Value) -> Result<i64, String> {
    match value {
        Value::Number(n) => {
            let n = n.as_f64().ok_or("publishedAt is not a number")?;
            Ok(if n < 1e11 { n * 1000.0 } else { n } as i64)
        }
        Value::String(s) => {
            time::OffsetDateTime::parse(s.trim(), &time::format_description::well_known::Rfc3339)
                .map(|t| (t.unix_timestamp_nanos() / 1_000_000) as i64)
                .map_err(|_| format!("publishedAt {s:?} is not an RFC 3339 time"))
        }
        _ => Err("publishedAt must be an RFC 3339 string or epoch number".into()),
    }
}

/// Checks one post; an error names the field.
fn post(input: PostInput, session: &str) -> Result<NewItem, String> {
    let source = input.source.trim().to_lowercase();
    if source.is_empty()
        || source.len() > 24
        || !source
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("source must be a short name such as \"x\"".into());
    }
    let id = input.id.trim();
    if id.is_empty() || id.len() > 200 {
        return Err("id must be the post's own id on its source".into());
    }
    let url = input.url.trim();
    if !http_url(url) {
        return Err("url must be the post's http(s) link".into());
    }
    if input.text.trim().is_empty() {
        return Err("text is empty".into());
    }
    let media: Vec<String> = input.media.iter().map(|m| m.trim().to_string()).collect();
    if media.len() > MAX_MEDIA || media.iter().any(|m| !http_url(m)) {
        return Err(format!("media takes up to {MAX_MEDIA} http(s) links"));
    }
    let metrics = match input.metrics {
        None => Value::Object(Map::new()),
        Some(metrics) => {
            if metrics.len() > 8 || metrics.iter().any(|(k, v)| k.len() > 24 || !v.is_number()) {
                return Err("metrics takes up to 8 numbers, such as {\"likes\":10}".into());
            }
            Value::Object(metrics)
        }
    };
    Ok(NewItem {
        source,
        external_id: id.to_string(),
        url: url.to_string(),
        author: clip(input.author.trim_start_matches('@'), 80),
        author_name: clip(&input.author_name, 120),
        text: clip(&input.text, MAX_TEXT_CHARS),
        summary: clip(&input.summary, MAX_SUMMARY_CHARS),
        published_at: input.published_at.as_ref().map(parse_time).transpose()?,
        metrics,
        media,
        agent_interest: clip(&input.interest, MAX_TITLE_CHARS),
        collected_by: session.to_string(),
    })
}

/// `feed.interests` / `feed.add` for any agent turn running in Irgatos.
pub(crate) fn agent_action(
    app: &AppHandle,
    session_id: &str,
    action: &str,
    input: &Value,
) -> Result<Value, String> {
    match action {
        "feed.interests" => {
            if input.as_object().is_some_and(|o| !o.is_empty()) {
                return Err("feed.interests takes {}".into());
            }
            let _guard = DB.lock().unwrap_or_else(|e| e.into_inner());
            let store = open(app)?;
            let interests: Vec<Value> = store
                .interests()?
                .into_iter()
                .filter(|i| i.enabled)
                .map(|i| json!({"id": i.id, "title": i.title, "description": i.description}))
                .collect();
            let last: Map<String, Value> = store
                .last_collected()?
                .into_iter()
                .map(|(source, at)| (source, json!(iso(at))))
                .collect();
            let note = if interests.is_empty() {
                "The user has not written any interests yet. Collect nothing; tell them to add interests on the Feed page."
            } else {
                "Find recent posts about these interests with your source tools, then hand them over with feed.add. Search each interest in its own words; the description says what the user does and does not want. lastCollected is when each source last delivered a post: look for posts after it. Irgatos scores every post by meaning and keeps posts it already has out, so send candidates rather than judging every borderline one."
            };
            Ok(json!({
                "interests": interests,
                "lastCollected": last,
                "scoring": crate::semantic_index::embeddings_on(app),
                "note": note,
            }))
        }
        "feed.add" => {
            let input: AddInput =
                serde_json::from_value(input.clone()).map_err(|e| format!("{ADD_USAGE}: {e}"))?;
            if input.items.is_empty() || input.items.len() > MAX_ITEMS_PER_CALL {
                return Err(format!(
                    "Send 1 to {MAX_ITEMS_PER_CALL} items per feed.add call"
                ));
            }
            add_posts(app, session_id, input.items)
        }
        _ => Err("Unknown feed action".into()),
    }
}

fn iso(ms: i64) -> String {
    time::OffsetDateTime::from_unix_timestamp_nanos(ms as i128 * 1_000_000)
        .ok()
        .and_then(|t| {
            t.format(&time::format_description::well_known::Rfc3339)
                .ok()
        })
        .unwrap_or_default()
}

fn add_posts(app: &AppHandle, session: &str, inputs: Vec<PostInput>) -> Result<Value, String> {
    let mut results: Vec<Value> = Vec::with_capacity(inputs.len());
    let mut posts: Vec<(usize, NewItem)> = Vec::new();
    for (index, input) in inputs.into_iter().enumerate() {
        let id = input.id.clone();
        match post(input, session) {
            Ok(item) => {
                results.push(json!({"id": id}));
                posts.push((index, item));
            }
            Err(error) => results.push(json!({"id": id, "status": "invalid", "error": error})),
        }
    }
    let texts: Vec<String> = posts.iter().map(|(_, p)| store::item_text(p)).collect();
    // Scoring needs the embedding service; a post it cannot reach now is
    // kept and scored in the background later.
    let (vectors, scoring_note) = match crate::semantic_index::embed_texts(app, &texts, false) {
        Ok(Some(vectors)) => (Some(vectors), None),
        Ok(None) => (
            None,
            Some("Smart Search is off in Irgatos, so posts are not scored and all of them show in the feed."),
        ),
        Err(error) => {
            eprintln!("feed: could not embed posts: {error}");
            (
                None,
                Some("The embedding service did not answer; the posts are kept and scored later."),
            )
        }
    };
    let (mut added, mut relevant, mut known, mut similar) = (0, 0, 0, 0);
    {
        let _guard = DB.lock().unwrap_or_else(|e| e.into_inner());
        let store = open(app)?;
        let threshold = store.threshold()?;
        let titles: std::collections::HashMap<String, String> = store
            .interests()?
            .into_iter()
            .map(|i| (i.id, i.title))
            .collect();
        for (n, (index, item)) in posts.iter().enumerate() {
            let vector = vectors.as_ref().and_then(|v| v.get(n)).map(Vec::as_slice);
            let result = &mut results[*index];
            match store.add_item(item, vector)? {
                Added::Known => {
                    known += 1;
                    result["status"] = json!("known");
                }
                Added::New { id, similar_to } => {
                    added += 1;
                    if similar_to.is_some() {
                        similar += 1;
                        result["status"] = json!("similar");
                    } else {
                        result["status"] = json!("added");
                    }
                    if let Some((interest, score)) = store.score_of(&id)? {
                        let matches = score >= threshold;
                        if matches && similar_to.is_none() {
                            relevant += 1;
                        }
                        result["score"] = json!((score * 100.0).round() / 100.0);
                        result["matches"] = json!(matches);
                        if let Some(title) = interest.and_then(|i| titles.get(&i)) {
                            result["interest"] = json!(title);
                        }
                    }
                }
            }
        }
    }
    if added > 0 {
        changed(app);
    }
    if vectors.is_none() {
        refresh(app);
    }
    let invalid = results.iter().filter(|r| r["status"] == "invalid").count();
    let mut summary = format!(
        "{added} new, {known} already in the feed, {similar} repeating a recent post, {invalid} invalid."
    );
    if vectors.is_some() {
        summary.push_str(&format!(
            " {relevant} of the new posts match an interest and show in the feed; the rest are under Filtered."
        ));
    }
    Ok(json!({
        "results": results,
        "summary": summary,
        "note": scoring_note,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(value: Value) -> PostInput {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn checks_posts_from_agents() {
        let ok = post(
            input(json!({
                "source": "X", "id": "123", "url": "https://x.com/a/status/123",
                "text": "  hello  ", "author": "@someone", "publishedAt": "2026-10-15T09:30:00Z",
                "metrics": {"likes": 3}
            })),
            "s1",
        )
        .unwrap();
        assert_eq!(ok.source, "x");
        assert_eq!(ok.author, "someone");
        assert_eq!(ok.text, "hello");
        assert_eq!(ok.published_at, Some(1_792_056_600_000));
        assert_eq!(ok.collected_by, "s1");

        let bad = |value: Value| post(input(value), "s").unwrap_err();
        let base = json!({"source": "x", "id": "1", "url": "https://x.com/1", "text": "t"});
        let with = |key: &str, value: Value| {
            let mut v = base.clone();
            v[key] = value;
            v
        };
        assert!(bad(with("url", json!("javascript:alert(1)"))).contains("url"));
        assert!(bad(with("source", json!("x feed"))).contains("source"));
        assert!(bad(with("text", json!(" "))).contains("text"));
        assert!(bad(with("publishedAt", json!("yesterday"))).contains("publishedAt"));
        assert!(bad(with("metrics", json!({"likes": "many"}))).contains("metrics"));
        assert!(bad(with("media", json!(["file:///etc/passwd"]))).contains("media"));
        // Unknown fields are refused, as everywhere in the app CLI.
        assert!(serde_json::from_value::<PostInput>(with("title", json!("t"))).is_err());
    }

    #[test]
    fn reads_times_in_seconds_or_milliseconds() {
        assert_eq!(
            parse_time(&json!(1_792_056_600)).unwrap(),
            1_792_056_600_000
        );
        assert_eq!(
            parse_time(&json!(1_792_056_600_000_i64)).unwrap(),
            1_792_056_600_000
        );
        assert_eq!(iso(1_792_056_600_000), "2026-10-15T09:30:00Z");
    }

    #[test]
    fn long_text_is_clipped() {
        assert_eq!(clip("abcdef", 3), "abc…");
        assert_eq!(clip(" ab ", 3), "ab");
    }
}
