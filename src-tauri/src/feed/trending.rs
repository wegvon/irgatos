//! GitHub's trending repositories for the Feed's GitHub tab.
//!
//! GitHub has no API for trending, so this reads github.com/trending the way
//! a browser does and picks the rows apart. Pages are kept for a while so
//! switching between Today, This week and This month does not refetch.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::link_preview::decode_entities;

const CACHE_FOR: Duration = Duration::from_secs(30 * 60);
const USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Irgatos";

/// Languages the tab offers, as GitHub spells them in trending URLs.
const LANGUAGES: [&str; 14] = [
    "rust",
    "typescript",
    "javascript",
    "python",
    "go",
    "swift",
    "kotlin",
    "java",
    "c",
    "c++",
    "c#",
    "zig",
    "ruby",
    "php",
];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendingRepo {
    /// "owner/name".
    pub full_name: String,
    pub url: String,
    pub description: String,
    pub language: String,
    /// The dot GitHub draws beside the language, "#dea584".
    pub language_color: String,
    pub stars: u64,
    pub forks: u64,
    /// Stars gained in the chosen period.
    pub period_stars: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendingPage {
    pub repos: Vec<TrendingRepo>,
    /// Epoch ms when GitHub was read.
    pub fetched_at: i64,
}

static CACHE: Mutex<Option<HashMap<String, (Instant, TrendingPage)>>> = Mutex::new(None);

fn since_param(since: &str) -> Result<&'static str, String> {
    match since {
        "daily" => Ok("daily"),
        "weekly" => Ok("weekly"),
        "monthly" => Ok("monthly"),
        _ => Err("since is daily, weekly or monthly".into()),
    }
}

fn trending_url(since: &str, language: Option<&str>) -> Result<String, String> {
    let since = since_param(since)?;
    let path = match language.filter(|l| !l.is_empty()) {
        None => String::new(),
        Some(language) => {
            if !LANGUAGES.contains(&language) {
                return Err(format!("Unknown language {language:?}"));
            }
            format!("/{}", language.replace('+', "%2B").replace('#', "%23"))
        }
    };
    Ok(format!("https://github.com/trending{path}?since={since}"))
}

/// Trending repositories, from the cache unless `refresh` or it is stale.
pub fn trending(since: &str, language: Option<&str>, refresh: bool) -> Result<TrendingPage, String> {
    let url = trending_url(since, language)?;
    if !refresh {
        let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, page)) = cache.as_ref().and_then(|c| c.get(&url)) {
            if at.elapsed() < CACHE_FOR {
                return Ok(page.clone());
            }
        }
    }
    let html = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build()
        .get(&url)
        .set("Accept", "text/html")
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(status, _) => format!("GitHub returned HTTP {status}"),
            other => format!("Could not reach GitHub: {other}"),
        })?
        .into_string()
        .map_err(|e| format!("Could not read GitHub's page: {e}"))?;
    let repos = parse(&html);
    // An empty page for a broad query means GitHub changed its markup;
    // a narrow language can honestly have nothing.
    if repos.is_empty() && language.is_none_or(str::is_empty) && !html.contains("Box-row") {
        return Err("GitHub's trending page looked different than expected".into());
    }
    let page = TrendingPage {
        repos,
        fetched_at: time::OffsetDateTime::now_utc().unix_timestamp() * 1000,
    };
    CACHE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert(url, (Instant::now(), page.clone()));
    Ok(page)
}

/// Reads the repository rows of a github.com/trending page.
pub fn parse(html: &str) -> Vec<TrendingRepo> {
    html.split("<article")
        .skip(1)
        .filter(|chunk| chunk.contains("Box-row"))
        .filter_map(parse_row)
        .collect()
}

fn parse_row(row: &str) -> Option<TrendingRepo> {
    let row = row.split("</article>").next().unwrap_or(row);
    // The title link; the Star button above it links to /login.
    let heading = &row[row.find("<h2")?..];
    let href = attribute_after(heading, "href=\"")?;
    let full_name = href.trim_matches('/').to_string();
    let mut parts = full_name.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    if parts.next().is_some() || !valid_segment(owner) || !valid_segment(name) {
        return None;
    }
    let after_heading = &heading[heading.find("</h2>").unwrap_or(0)..];
    let description = after_heading
        .find("<p")
        .and_then(|start| {
            let p = &after_heading[start..];
            let body = &p[p.find('>')? + 1..];
            Some(text(&body[..body.find("</p>")?]))
        })
        .unwrap_or_default();
    let language = between(row, "itemprop=\"programmingLanguage\">", "<")
        .map(text)
        .unwrap_or_default();
    let language_color = between(row, "repo-language-color\" style=\"background-color:", "\"")
        .map(|c| c.trim().trim_end_matches(';').trim().to_string())
        .filter(|c| c.starts_with('#') && c.len() <= 9 && c[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        .unwrap_or_default();
    let link_number = |suffix: &str| {
        between(row, &format!("href=\"/{full_name}/{suffix}\""), "</a>")
            .and_then(|a| a.find('>').map(|i| number(&text(&a[i + 1..]))))
            .unwrap_or(0)
    };
    let period_stars = between(row, "float-sm-right", "</span>")
        .and_then(|span| span.find('>').map(|i| text(&span[i + 1..])))
        .filter(|t| t.contains("star"))
        .map(|t| number(&t))
        .unwrap_or(0);
    Some(TrendingRepo {
        url: format!("https://github.com/{full_name}"),
        stars: link_number("stargazers"),
        forks: link_number("forks"),
        full_name,
        description,
        language,
        language_color,
        period_stars,
    })
}

fn valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 100
        && segment
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn attribute_after<'a>(html: &'a str, marker: &str) -> Option<&'a str> {
    between(html, marker, "\"")
}

fn between<'a>(html: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let from = html.find(start)? + start.len();
    let rest = &html[from..];
    Some(&rest[..rest.find(end)?])
}

/// Tags dropped, entities decoded, whitespace collapsed.
fn text(html: &str) -> String {
    let mut plain = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => plain.push(c),
            _ => {}
        }
    }
    decode_entities(&plain)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The first number in "1,234 stars this week".
fn number(text: &str) -> u64 {
    text.split_whitespace()
        .find_map(|word| word.replace(',', "").parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROW: &str = r##"
<article class="Box-row">
  <div class="float-right d-flex">
    <a href="/login?return_to=%2Fowner-1%2Fcool.rs" rel="nofollow" class="btn-sm btn">Star</a>
  </div>
  <h2 class="h3 lh-condensed">
    <a data-hydro-click="{}" href="/owner-1/cool.rs" data-view-component="true" class="Link">
      <svg aria-hidden="true" height="16"><path d="M2"></path></svg>
      <span data-view-component="true" class="text-normal">
        owner-1 /
</span>
      cool.rs
</a>  </h2>
    <p class="col-9 color-fg-muted my-1 tmp-pr-4">
      A fast &amp; <g-emoji alias="zap">⚡</g-emoji> friendly   tool
    </p>
  <div class="f6 color-fg-muted mt-2">
      <span class="d-inline-block ml-0 mr-3">
        <span class="repo-language-color" style="background-color: #dea584"></span>
        <span itemprop="programmingLanguage">Rust</span>
      </span>
      <a href="/owner-1/cool.rs/stargazers" data-view-component="true" class="Link Link--muted d-inline-block mr-3">
        <svg aria-label="star" role="img" height="16"><path d="M8"></path></svg>
        12,345
</a>
      <a href="/owner-1/cool.rs/forks" data-view-component="true" class="Link Link--muted d-inline-block mr-3">
        <svg aria-label="fork" role="img" height="16"><path d="M5"></path></svg>
        1,024
</a>
      <span class="d-inline-block mr-3">
        Built by
          <a class="d-inline-block" href="/someone"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/1?s=40&amp;v=4" width="20" height="20" alt="@someone" /></a>
      </span>
      <span class="d-inline-block float-sm-right">
        <svg aria-hidden="true" height="16"><path d="M8"></path></svg>
        2,071 stars this week
      </span>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/bare/repo" class="Link"><span class="text-normal">bare /</span> repo</a>
  </h2>
  <div class="f6 color-fg-muted mt-2">
      <a href="/bare/repo/stargazers" class="Link">9</a>
      <span class="d-inline-block float-sm-right">3 stars today</span>
  </div>
</article>
"##;

    #[test]
    fn reads_trending_rows() {
        let repos = parse(&format!("<html><body>{ROW}</body></html>"));
        assert_eq!(repos.len(), 2);
        assert_eq!(
            repos[0],
            TrendingRepo {
                full_name: "owner-1/cool.rs".into(),
                url: "https://github.com/owner-1/cool.rs".into(),
                description: "A fast & ⚡ friendly tool".into(),
                language: "Rust".into(),
                language_color: "#dea584".into(),
                stars: 12_345,
                forks: 1_024,
                period_stars: 2_071,
            }
        );
        let bare = &repos[1];
        assert_eq!(bare.full_name, "bare/repo");
        assert_eq!(bare.description, "");
        assert_eq!(bare.language, "");
        assert_eq!((bare.stars, bare.forks, bare.period_stars), (9, 0, 3));
    }

    #[test]
    fn skips_rows_that_are_not_repositories() {
        let html = r#"<article class="Box-row"><h2><a href="/only-owner">x</a></h2></article>
            <article class="Box-row"><h2><a href="/a/b/c">x</a></h2></article>
            <article class="other"><h2><a href="/a/b">x</a></h2></article>"#;
        assert!(parse(html).is_empty());
    }

    #[test]
    fn builds_trending_urls() {
        assert_eq!(
            trending_url("weekly", None).unwrap(),
            "https://github.com/trending?since=weekly"
        );
        assert_eq!(
            trending_url("daily", Some("c++")).unwrap(),
            "https://github.com/trending/c%2B%2B?since=daily"
        );
        assert_eq!(
            trending_url("monthly", Some("c#")).unwrap(),
            "https://github.com/trending/c%23?since=monthly"
        );
        assert!(trending_url("yearly", None).is_err());
        assert!(trending_url("daily", Some("../evil")).is_err());
    }
}
