//! OpenAI-style `/v1/embeddings` client for the EmbeddingGemma service.
//!
//! The server applies the model's task prompt itself, so texts go out bare
//! with a `task`. It accepts 1-16 texts per request, at most 16 000 characters
//! each and 32 000 in total; `batches` packs within those limits.

use std::ops::Range;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use url::Url;

pub const MODEL: &str = "google/embeddinggemma-2";
pub const MAX_TEXTS: usize = 16;
pub const MAX_TEXT_CHARS: usize = 16_000;
pub const MAX_REQUEST_CHARS: usize = 32_000;
/// A full batch of 60-line chunks takes ~9 s on the CPU server.
const HTTP_TIMEOUT: Duration = Duration::from_secs(120);
const ATTEMPTS: u32 = 6;
/// A query embeds one short text (~0.4 s). Past this it falls back to grep.
const QUERY_DEADLINE: Duration = Duration::from_secs(15);
const QUERY_RETRY: Duration = Duration::from_millis(250);
/// How long indexing holds back for searches before it sends anyway.
const MAX_YIELD: Duration = Duration::from_secs(30);

/// The server embeds one request at a time and turns others away with 429.
/// Indexing requests take turns in one lane, so two projects indexing at once
/// do not knock each other out, and the lane stays clear while a search
/// waits, so a search lands between two batches instead of after the pass.
static INDEX_LANE: Mutex<()> = Mutex::new(());
static WAITING_QUERIES: AtomicUsize = AtomicUsize::new(0);

struct Waiting;
impl Waiting {
    fn new() -> Self {
        WAITING_QUERIES.fetch_add(1, Ordering::AcqRel);
        Waiting
    }
}
impl Drop for Waiting {
    fn drop(&mut self) {
        WAITING_QUERIES.fetch_sub(1, Ordering::AcqRel);
    }
}

fn yield_to_queries() {
    let started = Instant::now();
    while WAITING_QUERIES.load(Ordering::Acquire) > 0 && started.elapsed() < MAX_YIELD {
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Task {
    Document,
    CodeRetrieval,
}

impl Task {
    fn as_str(self) -> &'static str {
        match self {
            Task::Document => "Document",
            Task::CodeRetrieval => "CodeRetrieval",
        }
    }
}

/// `https://host` or `https://host/v1/embeddings`; plain http only on this machine,
/// so the key never crosses a network in the clear.
pub fn embeddings_url(endpoint: &str) -> Result<Url, String> {
    let mut url = Url::parse(endpoint.trim())
        .map_err(|_| "The semantic search endpoint is not a valid URL".to_string())?;
    match url.scheme() {
        "https" => {}
        "http" if is_local(&url) => {}
        "http" => return Err("Use https for a semantic search endpoint on another machine".into()),
        _ => return Err("The semantic search endpoint must be an http(s) URL".into()),
    }
    if url.query().is_some() || !url.username().is_empty() || url.password().is_some() {
        return Err("The semantic search endpoint must not carry a query or credentials".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    if path.ends_with("/v1/embeddings") {
        url.set_path(&path);
    } else {
        url.set_path(&format!("{path}/v1/embeddings"));
    }
    Ok(url)
}

fn is_local(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Over-long texts are cut to what the server accepts; a chunk's head carries
/// its path and the start of the code, which is what retrieval keys on.
pub fn clip(text: &str) -> &str {
    match text.char_indices().nth(MAX_TEXT_CHARS) {
        Some((end, _)) => &text[..end],
        None => text,
    }
}

/// Consecutive ranges of `texts` that each fit in one request.
pub fn batches(texts: &[String]) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut chars = 0;
    for (index, text) in texts.iter().enumerate() {
        let len = clip(text).chars().count();
        if index > start && (index - start >= MAX_TEXTS || chars + len > MAX_REQUEST_CHARS) {
            out.push(start..index);
            start = index;
            chars = 0;
        }
        chars += len;
    }
    if start < texts.len() {
        out.push(start..texts.len());
    }
    out
}

pub struct Client {
    url: Url,
    key: String,
    dims: usize,
    agent: ureq::Agent,
    backoff: Duration,
    query: bool,
}

impl Client {
    /// For indexing: waits out a busy server and gives way to searches.
    pub fn new(endpoint: &str, key: &str, dims: usize) -> Result<Self, String> {
        Ok(Self {
            url: embeddings_url(endpoint)?,
            key: key.trim().to_string(),
            dims,
            agent: ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build(),
            backoff: Duration::from_secs(1),
            query: false,
        })
    }

    /// For a search: retries a busy server quickly, up to a short deadline,
    /// while indexing holds back.
    pub fn for_query(endpoint: &str, key: &str, dims: usize) -> Result<Self, String> {
        let mut client = Self::new(endpoint, key, dims)?;
        client.agent = ureq::AgentBuilder::new().timeout(QUERY_DEADLINE).build();
        client.backoff = QUERY_RETRY;
        client.query = true;
        Ok(client)
    }

    #[cfg(test)]
    pub fn with_backoff(mut self, backoff: Duration) -> Self {
        self.backoff = backoff;
        self
    }

    /// One vector per text, in order, L2-normalized.
    pub fn embed(&self, texts: &[String], task: Task) -> Result<Vec<Vec<f32>>, String> {
        let mut out = Vec::with_capacity(texts.len());
        for range in batches(texts) {
            let batch: Vec<&str> = texts[range].iter().map(|text| clip(text)).collect();
            out.extend(self.request(&batch, task)?);
        }
        Ok(out)
    }

    fn request(&self, texts: &[&str], task: Task) -> Result<Vec<Vec<f32>>, String> {
        let body = json!({
            "model": MODEL,
            "input": texts,
            "task": task.as_str(),
            "dimensions": self.dims,
        })
        .to_string();
        let started = Instant::now();
        let _waiting = self.query.then(Waiting::new);
        let _lane = (!self.query).then(|| INDEX_LANE.lock().unwrap_or_else(|e| e.into_inner()));
        let mut wait = self.backoff;
        let mut attempt = 0;
        loop {
            attempt += 1;
            if !self.query {
                yield_to_queries();
            }
            let response = self
                .agent
                .post(self.url.as_str())
                .set("Authorization", &format!("Bearer {}", self.key))
                .set("Content-Type", "application/json")
                .send_string(&body);
            let retry = match response {
                Ok(response) => {
                    let raw = response.into_string().map_err(|_| {
                        "The embedding service sent an unreadable reply".to_string()
                    })?;
                    return parse(&raw, texts.len(), self.dims);
                }
                Err(ureq::Error::Status(401 | 403, _)) => {
                    return Err("The embedding service rejected the API key".into())
                }
                Err(ureq::Error::Status(status @ (429 | 500..=599), _)) => {
                    format!("The embedding service answered {status}")
                }
                Err(ureq::Error::Status(status, _)) => {
                    return Err(format!("The embedding service answered {status}"))
                }
                Err(ureq::Error::Transport(_)) => "Could not reach the embedding service".into(),
            };
            let out_of_time = if self.query {
                started.elapsed() + wait >= QUERY_DEADLINE
            } else {
                attempt >= ATTEMPTS
            };
            if out_of_time {
                return Err(retry);
            }
            std::thread::sleep(wait);
            if !self.query {
                wait *= 2;
            }
        }
    }
}

fn parse(raw: &str, expected: usize, dims: usize) -> Result<Vec<Vec<f32>>, String> {
    let value: Value =
        serde_json::from_str(raw).map_err(|_| "The embedding service sent invalid JSON")?;
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or("The embedding service sent no data")?;
    let mut out: Vec<Option<Vec<f32>>> = vec![None; expected];
    for item in data {
        let index = item
            .get("index")
            .and_then(Value::as_u64)
            .ok_or("An embedding has no index")? as usize;
        let vector: Vec<f32> = item
            .get("embedding")
            .and_then(Value::as_array)
            .ok_or("An embedding has no vector")?
            .iter()
            .map(|x| x.as_f64().map(|x| x as f32))
            .collect::<Option<_>>()
            .ok_or("An embedding holds a non-number")?;
        if vector.len() != dims {
            return Err(format!(
                "The embedding service returned {} dimensions instead of {dims}",
                vector.len()
            ));
        }
        *out.get_mut(index)
            .ok_or("An embedding index is out of range")? = Some(normalize(vector));
    }
    out.into_iter()
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| "The embedding service skipped a text".into())
}

pub fn normalize(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        vector.iter_mut().for_each(|x| *x /= norm);
    }
    vector
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// A loopback stand-in for the service. Each request pops the next status;
    /// a 200 answers with one `dims`-long vector per input text.
    pub(crate) struct MockServer {
        pub url: String,
        pub requests: Arc<Mutex<Vec<Value>>>,
        _thread: std::thread::JoinHandle<()>,
    }

    pub(crate) fn mock_server(statuses: Vec<u16>, dims: usize) -> MockServer {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}", server.server_addr().to_ip().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        let thread = std::thread::spawn(move || {
            let mut statuses = statuses.into_iter();
            for mut request in server.incoming_requests() {
                let mut raw = String::new();
                request.as_reader().read_to_string(&mut raw).unwrap();
                let body: Value = serde_json::from_str(&raw).unwrap();
                let auth = request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Authorization"))
                    .map(|h| h.value.to_string());
                seen.lock()
                    .unwrap()
                    .push(json!({"body": body, "auth": auth}));
                let status = statuses.next().unwrap_or(200);
                let reply = if status == 200 {
                    let data: Vec<Value> = body["input"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .enumerate()
                        .map(|(i, text)| {
                            json!({"index": i, "embedding": fake_vector(text.as_str().unwrap(), dims)})
                        })
                        .collect();
                    json!({"data": data}).to_string()
                } else {
                    "{}".into()
                };
                let _ = request
                    .respond(tiny_http::Response::from_string(reply).with_status_code(status));
            }
        });
        MockServer {
            url,
            requests,
            _thread: thread,
        }
    }

    /// Deterministic bag-of-words vector, so texts that share words score close.
    pub(crate) fn fake_vector(text: &str, dims: usize) -> Vec<f32> {
        let mut v = vec![0.0f32; dims];
        for word in text
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() > 2)
        {
            let hash = word
                .to_lowercase()
                .bytes()
                .fold(7u64, |h, b| h.wrapping_mul(31).wrapping_add(b as u64));
            v[(hash % dims as u64) as usize] += 1.0;
        }
        v[0] += 0.01;
        v
    }

    #[test]
    fn endpoint_needs_https_unless_local_and_gains_the_embeddings_path() {
        assert_eq!(
            embeddings_url("https://embed.example.com")
                .unwrap()
                .as_str(),
            "https://embed.example.com/v1/embeddings"
        );
        assert_eq!(
            embeddings_url("https://embed.example.com/v1/embeddings/")
                .unwrap()
                .as_str(),
            "https://embed.example.com/v1/embeddings"
        );
        assert!(embeddings_url("http://127.0.0.1:8080").is_ok());
        assert!(embeddings_url("http://localhost:8080").is_ok());
        assert!(embeddings_url("http://192.168.1.4:8080").is_err());
        assert!(embeddings_url("https://user:pw@host").is_err());
        assert!(embeddings_url("ftp://host").is_err());
    }

    #[test]
    fn batches_stay_within_count_and_character_limits() {
        let small: Vec<String> = (0..40).map(|i| format!("text {i}")).collect();
        let ranges = batches(&small);
        assert_eq!(ranges, vec![0..16, 16..32, 32..40]);

        let big: Vec<String> = (0..5).map(|_| "x".repeat(12_000)).collect();
        let ranges = batches(&big);
        assert_eq!(ranges, vec![0..2, 2..4, 4..5]);
        for range in ranges {
            let total: usize = big[range].iter().map(|t| clip(t).chars().count()).sum();
            assert!(total <= MAX_REQUEST_CHARS);
        }

        // A single text over the per-text limit is clipped, not sent whole.
        let huge = vec!["é".repeat(20_000)];
        assert_eq!(batches(&huge), vec![0..1]);
        assert_eq!(clip(&huge[0]).chars().count(), MAX_TEXT_CHARS);
        assert!(batches(&[]).is_empty());
    }

    #[test]
    fn embeds_in_order_with_task_dims_and_bearer_key() {
        let server = mock_server(vec![], 8);
        let client = Client::new(&server.url, "secret", 8).unwrap();
        let texts: Vec<String> = (0..20).map(|i| format!("chunk number {i}")).collect();
        let vectors = client.embed(&texts, Task::Document).unwrap();
        assert_eq!(vectors.len(), 20);
        let expected = normalize(fake_vector("chunk number 19", 8));
        assert_eq!(vectors[19], expected);
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0]["body"]["task"], "Document");
        assert_eq!(requests[0]["body"]["dimensions"], 8);
        assert_eq!(requests[0]["body"]["model"], MODEL);
        assert_eq!(requests[0]["body"]["input"].as_array().unwrap().len(), 16);
        assert_eq!(requests[0]["auth"], "Bearer secret");
    }

    #[test]
    fn retries_server_errors_and_rate_limits_but_not_bad_keys() {
        let server = mock_server(vec![503, 429, 200], 4);
        let client = Client::new(&server.url, "k", 4)
            .unwrap()
            .with_backoff(Duration::from_millis(1));
        let vectors = client
            .embed(&["hello world".into()], Task::CodeRetrieval)
            .unwrap();
        assert_eq!(vectors.len(), 1);
        assert_eq!(server.requests.lock().unwrap().len(), 3);
        assert_eq!(
            server.requests.lock().unwrap()[2]["body"]["task"],
            "CodeRetrieval"
        );

        let server = mock_server(vec![401], 4);
        let client = Client::new(&server.url, "bad", 4)
            .unwrap()
            .with_backoff(Duration::from_millis(1));
        let error = client.embed(&["x".into()], Task::Document).unwrap_err();
        assert!(error.contains("rejected the API key"));
        assert_eq!(server.requests.lock().unwrap().len(), 1);

        let server = mock_server(vec![500; ATTEMPTS as usize], 4);
        let client = Client::new(&server.url, "k", 4)
            .unwrap()
            .with_backoff(Duration::from_millis(1));
        assert!(client.embed(&["x".into()], Task::Document).is_err());
        assert_eq!(server.requests.lock().unwrap().len(), ATTEMPTS as usize);
    }

    #[test]
    fn a_search_keeps_retrying_a_busy_server_until_its_deadline() {
        // Busy with an indexing batch for a while, then free.
        let server = mock_server(vec![429; 10], 4);
        let client = Client::for_query(&server.url, "k", 4)
            .unwrap()
            .with_backoff(Duration::from_millis(5));
        assert!(client.embed(&["x".into()], Task::CodeRetrieval).is_ok());
        assert_eq!(server.requests.lock().unwrap().len(), 11);
    }

    #[test]
    fn indexing_holds_back_while_a_search_waits() {
        let server = mock_server(vec![], 4);
        let url = server.url.clone();
        let waiting = Waiting::new();
        let indexer = std::thread::spawn(move || {
            Client::new(&url, "k", 4)
                .unwrap()
                .embed(&["x".into()], Task::Document)
        });
        std::thread::sleep(Duration::from_millis(300));
        assert!(server.requests.lock().unwrap().is_empty());
        drop(waiting);
        assert!(indexer.join().unwrap().is_ok());
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }

    #[test]
    fn rejects_wrong_dimensions() {
        let server = mock_server(vec![], 4);
        let client = Client::new(&server.url, "k", 8).unwrap();
        let error = client.embed(&["x".into()], Task::Document).unwrap_err();
        assert!(error.contains("4 dimensions instead of 8"));
    }
}
