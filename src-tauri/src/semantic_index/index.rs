//! One incremental pass over a project: embed what changed, drop what is gone.

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::chunk::{self, Chunk};
use super::client::{self, Task};
use super::store::{NewChunk, Store, CODE};

pub trait Embed {
    fn embed(&self, texts: &[String], task: Task) -> Result<Vec<Vec<f32>>, String>;
}

impl Embed for client::Client {
    fn embed(&self, texts: &[String], task: Task) -> Result<Vec<Vec<f32>>, String> {
        client::Client::embed(self, texts, task)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub total_files: usize,
    pub done_files: usize,
    pub total_chunks: usize,
    pub done_chunks: usize,
    pub removed_files: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Complete,
    Cancelled,
}

struct Pending {
    item: String,
    hash: String,
    modified: SystemTime,
    chunks: Vec<Chunk>,
}

/// Embeds `files` (project-relative) under `root` into `scope`. Unchanged
/// files are skipped by content hash; recently edited files go first, so a
/// partial index already covers what is being worked on.
#[allow(clippy::too_many_arguments)]
pub fn index_scope(
    store: &mut Store,
    embedder: &dyn Embed,
    scope: &str,
    root: &Path,
    files: &[String],
    dims: usize,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(&Progress),
) -> Result<Outcome, String> {
    let cancelled = || cancel.load(Ordering::Acquire);
    let known = store.hashes(CODE, scope, client::MODEL, dims)?;
    let mut present = HashSet::new();
    let mut pending = Vec::new();
    for item in files {
        if cancelled() {
            return Ok(Outcome::Cancelled);
        }
        if !chunk::indexable_path(item) {
            continue;
        }
        let path = root.join(item);
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if !meta.is_file() || meta.len() > chunk::MAX_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Some(text) = chunk::indexable_text(&bytes) else {
            continue;
        };
        present.insert(item.clone());
        let hash = format!("{:x}", Sha256::digest(&bytes));
        if known.get(item) == Some(&hash) {
            continue;
        }
        pending.push(Pending {
            item: item.clone(),
            hash,
            modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            chunks: chunk::chunks(item, text),
        });
    }

    let mut progress = Progress::default();
    for item in store.items(CODE, scope)? {
        if !present.contains(&item) {
            store.remove_item(CODE, scope, &item)?;
            progress.removed_files += 1;
        }
    }

    pending.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.item.cmp(&b.item))
    });
    progress.total_files = pending.len();
    progress.total_chunks = pending.iter().map(|p| p.chunks.len()).sum();
    on_progress(&progress);

    for group in groups(&pending) {
        if cancelled() {
            return Ok(Outcome::Cancelled);
        }
        let files = &pending[group];
        let texts: Vec<String> = files
            .iter()
            .flat_map(|file| file.chunks.iter().map(|c| c.text.clone()))
            .collect();
        let vectors = if texts.is_empty() {
            Vec::new()
        } else {
            embedder.embed(&texts, Task::Document)?
        };
        if vectors.len() != texts.len() {
            return Err("The embedding service returned the wrong number of vectors".into());
        }
        let mut offset = 0;
        for file in files {
            let rows: Vec<NewChunk<'_>> = file
                .chunks
                .iter()
                .zip(&vectors[offset..offset + file.chunks.len()])
                .map(|(chunk, vector)| NewChunk {
                    start_line: chunk.start_line,
                    end_line: chunk.end_line,
                    vector,
                })
                .collect();
            offset += file.chunks.len();
            store.replace_item(
                CODE,
                scope,
                &file.item,
                &file.hash,
                client::MODEL,
                dims,
                &rows,
            )?;
            progress.done_files += 1;
            progress.done_chunks += file.chunks.len();
        }
        on_progress(&progress);
    }
    Ok(Outcome::Complete)
}

/// Consecutive files packed so each group fills about one request. A file
/// with more chunks than a request holds forms a group of its own.
fn groups(pending: &[Pending]) -> Vec<std::ops::Range<usize>> {
    let mut out = Vec::new();
    let mut start = 0;
    let (mut count, mut chars) = (0, 0);
    for (index, file) in pending.iter().enumerate() {
        let file_count = file.chunks.len();
        let file_chars: usize = file
            .chunks
            .iter()
            .map(|c| client::clip(&c.text).chars().count())
            .sum();
        if index > start
            && (count + file_count > client::MAX_TEXTS
                || chars + file_chars > client::MAX_REQUEST_CHARS)
        {
            out.push(start..index);
            start = index;
            count = 0;
            chars = 0;
        }
        count += file_count;
        chars += file_chars;
    }
    if start < pending.len() {
        out.push(start..pending.len());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic_index::client::normalize;
    use crate::semantic_index::client::tests::fake_vector;
    use std::cell::RefCell;

    struct Fake {
        calls: RefCell<Vec<usize>>,
        fail: bool,
    }
    impl Embed for Fake {
        fn embed(&self, texts: &[String], _task: Task) -> Result<Vec<Vec<f32>>, String> {
            if self.fail {
                return Err("offline".into());
            }
            self.calls.borrow_mut().push(texts.len());
            Ok(texts.iter().map(|t| normalize(fake_vector(t, 8))).collect())
        }
    }
    fn fake() -> Fake {
        Fake {
            calls: RefCell::new(Vec::new()),
            fail: false,
        }
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn lines(count: usize, word: &str) -> String {
        (1..=count)
            .map(|i| format!("{word} {i}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn run(store: &mut Store, embedder: &Fake, root: &Path, files: &[&str]) -> Progress {
        let files: Vec<String> = files.iter().map(|s| s.to_string()).collect();
        let mut last = Progress::default();
        let outcome = index_scope(
            store,
            embedder,
            "scope",
            root,
            &files,
            8,
            &AtomicBool::new(false),
            |p| last = p.clone(),
        )
        .unwrap();
        assert_eq!(outcome, Outcome::Complete);
        last
    }

    #[test]
    fn reindexes_only_changed_files_and_drops_removed_ones() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "a.rs", &lines(130, "alpha"));
        write(root, "b.rs", &lines(10, "beta"));
        write(root, "c.rs", &lines(10, "gamma"));
        write(root, "package-lock.json", "{}");
        let mut store = Store::open_in_memory().unwrap();

        let first = run(
            &mut store,
            &fake(),
            root,
            &["a.rs", "b.rs", "c.rs", "package-lock.json"],
        );
        assert_eq!((first.total_files, first.total_chunks), (3, 5));
        assert_eq!((first.done_files, first.done_chunks), (3, 5));
        assert_eq!(store.chunks(CODE, "scope", "").unwrap().len(), 5);

        // Nothing changed: no embedding calls at all.
        let embedder = fake();
        let again = run(&mut store, &embedder, root, &["a.rs", "b.rs", "c.rs"]);
        assert_eq!(again.total_files, 0);
        assert!(embedder.calls.borrow().is_empty());

        // b changed, c removed, a untouched.
        write(root, "b.rs", &lines(70, "beta changed"));
        std::fs::remove_file(root.join("c.rs")).unwrap();
        let embedder = fake();
        let third = run(&mut store, &embedder, root, &["a.rs", "b.rs"]);
        assert_eq!((third.total_files, third.total_chunks), (1, 2));
        assert_eq!(third.removed_files, 1);
        assert_eq!(*embedder.calls.borrow(), vec![2]);
        let mut items = store.items(CODE, "scope").unwrap();
        items.sort();
        assert_eq!(items, vec!["a.rs", "b.rs"]);
        let b: Vec<_> = store
            .chunks(CODE, "scope", "b.rs")
            .unwrap()
            .into_iter()
            .map(|c| (c.start_line, c.end_line))
            .collect();
        assert_eq!(b.len(), 2);
        assert!(b.contains(&(1, 60)) && b.contains(&(51, 70)));
    }

    #[test]
    fn packs_small_files_into_shared_requests() {
        let dir = tempfile::tempdir().unwrap();
        let names: Vec<String> = (0..40).map(|i| format!("f{i}.rs")).collect();
        for name in &names {
            write(dir.path(), name, "fn x() {}");
        }
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let embedder = fake();
        let mut store = Store::open_in_memory().unwrap();
        run(&mut store, &embedder, dir.path(), &refs);
        assert_eq!(*embedder.calls.borrow(), vec![16, 16, 8]);
    }

    #[test]
    fn a_failed_request_keeps_finished_files_and_cancel_stops_early() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.rs", "fn a() {}");
        let mut store = Store::open_in_memory().unwrap();
        let failing = Fake {
            calls: RefCell::new(Vec::new()),
            fail: true,
        };
        let files = vec!["a.rs".to_string()];
        let error = index_scope(
            &mut store,
            &failing,
            "scope",
            dir.path(),
            &files,
            8,
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(error, "offline");
        assert!(store.items(CODE, "scope").unwrap().is_empty());

        let embedder = fake();
        let outcome = index_scope(
            &mut store,
            &embedder,
            "scope",
            dir.path(),
            &files,
            8,
            &AtomicBool::new(true),
            |_| {},
        )
        .unwrap();
        assert_eq!(outcome, Outcome::Cancelled);
        assert!(embedder.calls.borrow().is_empty());
    }
}
