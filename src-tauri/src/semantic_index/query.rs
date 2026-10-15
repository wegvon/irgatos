//! Hybrid code search: vector neighbours plus `git grep` on the query's own
//! words, merged with reciprocal rank fusion.

use std::collections::HashMap;

use serde::Serialize;

use super::chunk::{self, WINDOW_LINES};
use super::store::StoredChunk;

/// The usual RRF constant; it keeps one list's top hit from drowning the other.
const RRF_K: f64 = 60.0;
const VECTOR_CANDIDATES: usize = 40;
const GREP_CANDIDATES: usize = 40;

const STOPWORDS: [&str; 40] = [
    "where",
    "what",
    "which",
    "when",
    "does",
    "with",
    "from",
    "that",
    "this",
    "have",
    "into",
    "there",
    "their",
    "about",
    "should",
    "would",
    "could",
    "find",
    "show",
    "code",
    "file",
    "files",
    "function",
    "method",
    "implemented",
    "handled",
    "handle",
    "logic",
    "used",
    "uses",
    "nerede",
    "nasıl",
    "hangi",
    "olan",
    "için",
    "kodu",
    "dosya",
    "fonksiyon",
    "yapılıyor",
    "neresi",
];

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Key {
    pub path: String,
    pub start_line: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub score: f64,
    pub sources: Vec<&'static str>,
    pub preview: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Term {
    pub text: String,
    /// Looks like code (snake_case, camelCase, a path or `quoted`), so a
    /// match is strong evidence; plain words only count together.
    pub identifier: bool,
}

/// Words worth grepping for. Identifiers always; plain words of four or more
/// ASCII letters that are not filler.
pub fn terms(query: &str) -> Vec<Term> {
    let mut out: Vec<Term> = Vec::new();
    let mut push = |text: &str, identifier: bool| {
        let text = text.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
        if text.is_empty() || out.iter().any(|t| t.text.eq_ignore_ascii_case(text)) {
            return;
        }
        out.push(Term {
            text: text.to_string(),
            identifier,
        });
    };
    for quoted in query.split('`').skip(1).step_by(2) {
        if quoted.trim().len() >= 3 {
            push(quoted.trim(), true);
        }
    }
    for word in query.split(|c: char| c.is_whitespace() || c == '`' || c == ',' || c == '?') {
        let word = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
        if word.chars().count() < 3 {
            continue;
        }
        let inner_upper = word.chars().skip(1).any(|c| c.is_ascii_uppercase())
            && word.chars().any(|c| c.is_ascii_lowercase());
        let identifier = word.contains('_')
            || word.contains("::")
            || inner_upper
            || (word.chars().any(|c| c.is_ascii_digit()) && word.chars().any(char::is_alphabetic));
        if identifier {
            for part in word.split("::").filter(|p| p.len() >= 3) {
                push(part, true);
            }
        } else if word.len() >= 4
            && word.chars().all(|c| c.is_ascii_alphabetic())
            && !STOPWORDS.contains(&word.to_lowercase().as_str())
        {
            push(word, false);
        }
    }
    out
}

/// Chunk indices by cosine to `query`, best first. Vectors are normalized,
/// so the dot product is the cosine.
pub fn vector_ranking(chunks: &[StoredChunk], query: &[f32], limit: usize) -> Vec<(usize, f32)> {
    let mut scored: Vec<(usize, f32)> = chunks
        .iter()
        .enumerate()
        .filter(|(_, c)| c.vector.len() == query.len())
        .map(|(i, c)| (i, c.vector.iter().zip(query).map(|(a, b)| a * b).sum()))
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    scored.truncate(limit);
    scored
}

/// A grep match on one line, with the term it matched.
pub struct LineMatch {
    pub path: String,
    pub line: usize,
    pub term: usize,
    pub preview: String,
}

/// The windows grep points at, best first. A window that matches several
/// distinct words beats one that repeats a single word; a rare word beats a
/// common one. Plain words only count where two of them meet, unless a
/// single word is all the query has.
pub fn grep_ranking(
    terms: &[Term],
    matches: &[LineMatch],
    window_of: impl Fn(&str, usize) -> (usize, usize),
) -> Vec<(Key, usize, Vec<String>)> {
    // Lockfiles and build output match everything and mean nothing.
    let matches: Vec<&LineMatch> = matches
        .iter()
        .filter(|m| chunk::indexable_path(&m.path))
        .collect();
    let mut per_term = vec![0usize; terms.len()];
    for m in &matches {
        per_term[m.term] += 1;
    }
    let weight = |term: usize| {
        let base = if terms[term].identifier { 3.0 } else { 1.0 };
        base / (2.0 + per_term[term] as f64).ln()
    };
    struct Window {
        end: usize,
        terms: Vec<bool>,
        count: usize,
        previews: Vec<String>,
    }
    let mut windows: HashMap<Key, Window> = HashMap::new();
    for m in &matches {
        let (start, end) = window_of(&m.path, m.line);
        let window = windows
            .entry(Key {
                path: m.path.clone(),
                start_line: start,
            })
            .or_insert_with(|| Window {
                end,
                terms: vec![false; terms.len()],
                count: 0,
                previews: Vec::new(),
            });
        window.terms[m.term] = true;
        window.count += 1;
        if window.previews.len() < 2 && !window.previews.contains(&m.preview) {
            window.previews.push(m.preview.clone());
        }
    }
    let mut ranked: Vec<(Key, usize, Vec<String>, f64)> = windows
        .into_iter()
        .filter_map(|(key, window)| {
            let hit: Vec<usize> = (0..terms.len()).filter(|&t| window.terms[t]).collect();
            let strong = hit.iter().any(|&t| terms[t].identifier);
            if !strong && hit.len() < 2 && terms.len() > 1 {
                return None;
            }
            let score =
                hit.iter().map(|&t| weight(t)).sum::<f64>() + (window.count as f64).ln_1p() * 0.01;
            Some((key, window.end, window.previews, score))
        })
        .collect();
    ranked.sort_by(|a, b| b.3.total_cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
    ranked.truncate(GREP_CANDIDATES);
    ranked
        .into_iter()
        .map(|(key, end, previews, _)| (key, end, previews))
        .collect()
}

/// Reciprocal rank fusion over ranked lists of keys, each with a weight.
pub fn rrf(lists: &[(&[Key], f64)]) -> Vec<(Key, f64)> {
    let mut scores: HashMap<Key, f64> = HashMap::new();
    for (list, weight) in lists {
        for (rank, key) in list.iter().enumerate() {
            *scores.entry(key.clone()).or_default() += weight / (RRF_K + rank as f64 + 1.0);
        }
    }
    let mut out: Vec<(Key, f64)> = scores.into_iter().collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out
}

/// The indexed chunk holding `line`, preferring the one with the most context
/// around it; otherwise a window starting a little above it.
pub fn window_for(chunks: &[(usize, usize)], line: usize) -> (usize, usize) {
    chunks
        .iter()
        .filter(|(start, end)| *start <= line && line <= *end)
        .max_by_key(|(start, end)| (line - start).min(end - line))
        .copied()
        .unwrap_or_else(|| {
            let start = line.saturating_sub(10).max(1);
            (start, start + WINDOW_LINES - 1)
        })
}

pub struct Inputs<'a> {
    pub chunks: &'a [StoredChunk],
    /// `chunks[i].item` relative to the caller's folder, or None when outside it.
    pub chunk_paths: &'a [Option<String>],
    pub query_vector: Option<&'a [f32]>,
    pub terms: &'a [Term],
    pub matches: &'a [LineMatch],
}

/// Fuses both rankings. Previews for grep hits are the matching lines;
/// `read_preview` supplies the rest.
pub fn hybrid(
    inputs: Inputs<'_>,
    limit: usize,
    read_preview: impl Fn(&str, usize, usize) -> String,
) -> Vec<Hit> {
    let mut ranges: HashMap<&str, Vec<(usize, usize)>> = HashMap::new();
    for (chunk, path) in inputs.chunks.iter().zip(inputs.chunk_paths) {
        if let Some(path) = path {
            ranges
                .entry(path.as_str())
                .or_default()
                .push((chunk.start_line, chunk.end_line));
        }
    }
    let mut ends: HashMap<Key, usize> = HashMap::new();
    let mut previews: HashMap<Key, Vec<String>> = HashMap::new();

    let mut vector_keys = Vec::new();
    if let Some(query) = inputs.query_vector {
        for (index, _) in vector_ranking(inputs.chunks, query, usize::MAX) {
            let Some(path) = &inputs.chunk_paths[index] else {
                continue;
            };
            let chunk = &inputs.chunks[index];
            let key = Key {
                path: path.clone(),
                start_line: chunk.start_line,
            };
            ends.insert(key.clone(), chunk.end_line);
            vector_keys.push(key);
            if vector_keys.len() == VECTOR_CANDIDATES {
                break;
            }
        }
    }

    let grep = grep_ranking(inputs.terms, inputs.matches, |path, line| {
        window_for(ranges.get(path).map(Vec::as_slice).unwrap_or(&[]), line)
    });
    let mut grep_keys = Vec::new();
    for (key, end, lines) in grep {
        ends.entry(key.clone()).or_insert(end);
        previews.insert(key.clone(), lines);
        grep_keys.push(key);
    }

    // Plain words alone are a weak signal next to the embedding.
    let grep_weight = if inputs.terms.iter().any(|t| t.identifier) {
        1.0
    } else {
        0.5
    };
    let vector_set: std::collections::HashSet<&Key> = vector_keys.iter().collect();
    let grep_set: std::collections::HashSet<&Key> = grep_keys.iter().collect();
    rrf(&[(&vector_keys, 1.0), (&grep_keys, grep_weight)])
        .into_iter()
        .take(limit)
        .map(|(key, score)| {
            let end = ends.get(&key).copied().unwrap_or(key.start_line);
            let mut sources = Vec::new();
            if vector_set.contains(&key) {
                sources.push("vector");
            }
            if grep_set.contains(&key) {
                sources.push("grep");
            }
            let preview = match previews.get(&key) {
                Some(lines) if !lines.is_empty() => lines.join("\n"),
                _ => read_preview(&key.path, key.start_line, end),
            };
            Hit {
                path: key.path,
                start_line: key.start_line,
                end_line: end,
                score: (score * 10_000.0).round() / 10_000.0,
                sources,
                preview,
            }
        })
        .collect()
}

/// The first few meaningful lines of a range, trimmed.
pub fn preview_lines(text: &str, start_line: usize, end_line: usize) -> String {
    text.lines()
        .skip(start_line.saturating_sub(1))
        .take(end_line + 1 - start_line.max(1))
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !matches!(*line, "{" | "}" | "};" | ")" | ");" | "*/" | "/**" | "//")
                && !line.starts_with("use ")
                && !line.starts_with("import ")
        })
        .take(3)
        .map(|line| clip_line(line, 160))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn clip_line(line: &str, max: usize) -> String {
    let line = line.trim();
    match line.char_indices().nth(max) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(path: &str, start: usize) -> Key {
        Key {
            path: path.into(),
            start_line: start,
        }
    }

    #[test]
    fn extracts_identifiers_and_meaningful_words() {
        let found = terms(
            "where is `search_sessions_sql` and validateEndpoint for the transcription endpoint?",
        );
        let texts: Vec<(&str, bool)> = found
            .iter()
            .map(|t| (t.text.as_str(), t.identifier))
            .collect();
        assert_eq!(
            texts,
            vec![
                ("search_sessions_sql", true),
                ("validateEndpoint", true),
                ("transcription", false),
                ("endpoint", false),
            ]
        );
        let rust = terms("session_store::search_sessions timeout");
        assert!(rust
            .iter()
            .any(|t| t.text == "session_store" && t.identifier));
        assert!(rust
            .iter()
            .any(|t| t.text == "search_sessions" && t.identifier));
        // Filler and non-ASCII words are dropped: grep would not find them in code.
        assert!(terms("görüntüsü nerede").is_empty());
    }

    #[test]
    fn rrf_rewards_agreement_and_honours_weights() {
        let a = [key("x", 1), key("y", 1), key("z", 1)];
        let b = [key("y", 1), key("w", 1)];
        let fused = rrf(&[(&a, 1.0), (&b, 1.0)]);
        assert_eq!(fused[0].0, key("y", 1));
        assert_eq!(fused[1].0, key("x", 1));
        assert!((fused[0].1 - (1.0 / 62.0 + 1.0 / 61.0)).abs() < 1e-12);
        assert_eq!(fused.len(), 4);

        // With grep down-weighted, its lone top hit falls behind vector's.
        let fused = rrf(&[(&a, 1.0), (&[key("w", 1)][..], 0.5)]);
        assert_eq!(fused[0].0, key("x", 1));
    }

    #[test]
    fn grep_windows_need_two_words_or_one_identifier() {
        let terms = vec![
            Term {
                text: "timeout".into(),
                identifier: false,
            },
            Term {
                text: "summary".into(),
                identifier: false,
            },
            Term {
                text: "HTTP_TIMEOUT".into(),
                identifier: true,
            },
        ];
        let m = |path: &str, line, term| LineMatch {
            path: path.into(),
            line,
            term,
            preview: format!("{path}:{line}"),
        };
        let matches = vec![
            m("a.rs", 5, 0),
            m("a.rs", 9, 1),
            m("b.rs", 100, 0),
            m("c.rs", 3, 2),
        ];
        let ranked = grep_ranking(&terms, &matches, |_, line| {
            window_for(&[(1, 60), (51, 110)], line)
        });
        let keys: Vec<Key> = ranked.iter().map(|r| r.0.clone()).collect();
        // c has the identifier, a has two words; b has one plain word only.
        assert_eq!(keys, vec![key("c.rs", 1), key("a.rs", 1)]);
        assert_eq!(ranked[1].2, vec!["a.rs:5", "a.rs:9"]);
    }

    #[test]
    fn grep_lines_map_to_the_nearest_indexed_chunk() {
        let chunks = [(1, 60), (51, 110), (101, 130)];
        assert_eq!(window_for(&chunks, 58), (51, 110));
        assert_eq!(window_for(&chunks, 53), (1, 60));
        assert_eq!(window_for(&chunks, 20), (1, 60));
        assert_eq!(window_for(&chunks, 105), (51, 110));
        assert_eq!(window_for(&chunks, 120), (101, 130));
        assert_eq!(window_for(&[], 25), (15, 74));
        assert_eq!(window_for(&[], 3), (1, 60));
    }

    #[test]
    fn hybrid_merges_vector_and_grep_hits_on_the_same_chunk() {
        let chunk = |item: &str, start, v: Vec<f32>| StoredChunk {
            item: item.into(),
            start_line: start,
            end_line: start + 59,
            vector: v,
        };
        let chunks = vec![
            chunk("src/a.rs", 1, vec![1.0, 0.0]),
            chunk("src/b.rs", 1, vec![0.8, 0.6]),
            chunk("other/c.rs", 1, vec![1.0, 0.0]),
        ];
        let paths = vec![Some("a.rs".to_string()), Some("b.rs".to_string()), None];
        let terms = vec![Term {
            text: "fooBar".into(),
            identifier: true,
        }];
        let matches = vec![LineMatch {
            path: "b.rs".into(),
            line: 10,
            term: 0,
            preview: "let fooBar = 1;".into(),
        }];
        let hits = hybrid(
            Inputs {
                chunks: &chunks,
                chunk_paths: &paths,
                query_vector: Some(&[1.0, 0.0]),
                terms: &terms,
                matches: &matches,
            },
            5,
            |path, start, _| format!("{path}@{start}"),
        );
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].path, "b.rs");
        assert_eq!(hits[0].sources, vec!["vector", "grep"]);
        assert_eq!(hits[0].preview, "let fooBar = 1;");
        assert_eq!((hits[0].start_line, hits[0].end_line), (1, 60));
        assert_eq!(hits[1].path, "a.rs");
        assert_eq!(hits[1].sources, vec!["vector"]);
        assert_eq!(hits[1].preview, "a.rs@1");
    }

    #[test]
    fn previews_skip_imports_and_braces() {
        let text = "use std::fs;\n\nfn main() {\n    let x = 1;\n}\nfn other() {}\n";
        assert_eq!(
            preview_lines(text, 1, 6),
            "fn main() {\nlet x = 1;\nfn other() {}"
        );
        assert_eq!(clip_line("abcdef", 3), "abc…");
    }
}
