//! Short documents, one vector each: ideas today, other notes later. Unlike
//! code there are no files or line windows; an item is an id and its text.

use std::collections::HashSet;

use sha2::{Digest, Sha256};

use super::client::{self, Task, MAX_TEXTS};
use super::index::Embed;
use super::query;
use super::store::{NewChunk, Store};

/// Embeds the documents whose text changed and drops the ones that are gone.
/// Saves after every request, so a failure keeps what was already embedded.
/// Returns how many documents were embedded.
pub fn sync(
    store: &mut Store,
    embedder: &dyn Embed,
    corpus: &str,
    scope: &str,
    docs: &[(String, String)],
    dims: usize,
) -> Result<usize, String> {
    let known = store.hashes(corpus, scope, client::MODEL, dims)?;
    let wanted: HashSet<&str> = docs.iter().map(|(id, _)| id.as_str()).collect();
    for item in store.items(corpus, scope)? {
        if !wanted.contains(item.as_str()) {
            store.remove_item(corpus, scope, &item)?;
        }
    }
    let changed: Vec<(&str, &str, String)> = docs
        .iter()
        .map(|(id, text)| (id.as_str(), text.as_str(), hash(text)))
        .filter(|(id, _, hash)| known.get(*id) != Some(hash))
        .collect();
    let mut embedded = 0;
    let result = (|| {
        for group in changed.chunks(MAX_TEXTS) {
            let texts: Vec<String> = group.iter().map(|(_, text, _)| text.to_string()).collect();
            let vectors = embedder.embed(&texts, Task::Document)?;
            for ((id, _, hash), vector) in group.iter().zip(&vectors) {
                store.replace_item(
                    corpus,
                    scope,
                    id,
                    hash,
                    client::MODEL,
                    dims,
                    &[NewChunk {
                        start_line: 0,
                        end_line: 0,
                        vector,
                    }],
                )?;
                embedded += 1;
            }
        }
        Ok(())
    })();
    store.set_scope_state(corpus, scope, result.is_ok(), result.as_ref().err().map(String::as_str))?;
    result.map(|()| embedded)
}

/// Items by cosine to the query vector, best first.
pub fn rank(
    store: &Store,
    corpus: &str,
    scope: &str,
    query: &[f32],
    limit: usize,
) -> Result<Vec<(String, f32)>, String> {
    let chunks = store.chunks(corpus, scope, "")?;
    Ok(query::vector_ranking(&chunks, query, limit)
        .into_iter()
        .map(|(index, score)| (chunks[index].item.clone(), score))
        .collect())
}

fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic_index::client::normalize;
    use crate::semantic_index::client::tests::fake_vector;
    use std::cell::RefCell;

    struct Fake {
        calls: RefCell<Vec<usize>>,
        fail_after: Option<usize>,
    }
    impl Embed for Fake {
        fn embed(&self, texts: &[String], task: Task) -> Result<Vec<Vec<f32>>, String> {
            assert_eq!(task, Task::Document);
            let mut calls = self.calls.borrow_mut();
            if self.fail_after == Some(calls.len()) {
                return Err("offline".into());
            }
            calls.push(texts.len());
            Ok(texts.iter().map(|t| normalize(fake_vector(t, 16))).collect())
        }
    }
    fn fake(fail_after: Option<usize>) -> Fake {
        Fake {
            calls: RefCell::new(Vec::new()),
            fail_after,
        }
    }
    fn doc(id: &str, text: &str) -> (String, String) {
        (id.into(), text.into())
    }

    #[test]
    fn embeds_only_changed_documents_and_drops_removed_ones() {
        let mut store = Store::open_in_memory().unwrap();
        let embedder = fake(None);
        let docs = vec![
            doc("a", "voice summaries for replies"),
            doc("b", "dark theme for the mail list"),
        ];
        assert_eq!(sync(&mut store, &embedder, "ideas", "all", &docs, 16).unwrap(), 2);
        assert_eq!(sync(&mut store, &embedder, "ideas", "all", &docs, 16).unwrap(), 0);
        let docs = vec![doc("a", "voice summaries, read aloud"), doc("c", "coffee grinder")];
        assert_eq!(sync(&mut store, &embedder, "ideas", "all", &docs, 16).unwrap(), 2);
        let mut items = store.items("ideas", "all").unwrap();
        items.sort();
        assert_eq!(items, ["a", "c"]);
        assert!(store.scope_status("ideas", "all").unwrap().unwrap().complete);
        assert!(store.items("code", "all").unwrap().is_empty());
    }

    #[test]
    fn a_failure_keeps_finished_requests() {
        let mut store = Store::open_in_memory().unwrap();
        let docs: Vec<_> = (0..MAX_TEXTS + 3)
            .map(|i| doc(&format!("d{i}"), &format!("idea number {i}")))
            .collect();
        let error = sync(&mut store, &fake(Some(1)), "ideas", "all", &docs, 16).unwrap_err();
        assert_eq!(error, "offline");
        assert_eq!(store.items("ideas", "all").unwrap().len(), MAX_TEXTS);
        let status = store.scope_status("ideas", "all").unwrap().unwrap();
        assert!(!status.complete);
        assert_eq!(status.last_error.as_deref(), Some("offline"));
        assert_eq!(sync(&mut store, &fake(None), "ideas", "all", &docs, 16).unwrap(), 3);
    }

    #[test]
    fn ranks_items_by_meaning() {
        let mut store = Store::open_in_memory().unwrap();
        let docs = vec![
            doc("a", "voice summaries replies"),
            doc("b", "coffee grinder espresso"),
        ];
        sync(&mut store, &fake(None), "ideas", "all", &docs, 16).unwrap();
        let query = normalize(fake_vector("espresso coffee", 16));
        let ranked = rank(&store, "ideas", "all", &query, 5).unwrap();
        assert_eq!(ranked[0].0, "b");
        assert_eq!(ranked.len(), 2);
    }
}
