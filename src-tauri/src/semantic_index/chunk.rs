//! Which project files are worth embedding, and the line windows they become.

pub const WINDOW_LINES: usize = 60;
pub const OVERLAP_LINES: usize = 10;
/// Source files past this are almost always generated or vendored.
pub const MAX_FILE_BYTES: u64 = 512 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chunk {
    /// 1-based, inclusive.
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}

const SKIPPED_NAMES: [&str; 12] = [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "Cargo.lock",
    "Gemfile.lock",
    "poetry.lock",
    "composer.lock",
    "go.sum",
    "Package.resolved",
    "flake.lock",
];
const SKIPPED_DIRS: [&str; 10] = [
    "dist",
    "build",
    "out",
    "target",
    "node_modules",
    "vendor",
    "coverage",
    ".next",
    "generated",
    "__generated__",
];
const SKIPPED_SUFFIXES: [&str; 22] = [
    ".lock", ".min.js", ".min.css", ".map", ".snap", ".svg", ".png", ".jpg", ".jpeg", ".gif",
    ".webp", ".ico", ".icns", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".zip", ".gz", ".wasm",
    ".mp3",
];

/// Path-only check, before the file is read.
pub fn indexable_path(relative: &str) -> bool {
    let relative = relative.replace('\\', "/");
    let mut parts = relative.split('/').peekable();
    while let Some(part) = parts.next() {
        if parts.peek().is_none() {
            let lower = part.to_ascii_lowercase();
            return !SKIPPED_NAMES.contains(&part)
                && !SKIPPED_SUFFIXES
                    .iter()
                    .any(|suffix| lower.ends_with(suffix))
                && !lower.contains(".generated.")
                && !lower.ends_with(".pb.go");
        }
        if SKIPPED_DIRS.contains(&part) {
            return false;
        }
    }
    false
}

/// Content check: text, not minified, not marked as generated.
pub fn indexable_text(bytes: &[u8]) -> Option<&str> {
    if bytes.is_empty() || bytes[..bytes.len().min(8192)].contains(&0) {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let head: String = text.lines().take(5).collect::<Vec<_>>().join("\n");
    if head.contains("@generated") || head.contains("DO NOT EDIT") {
        return None;
    }
    let lines = text.lines().count().max(1);
    if text.len() / lines > 300 || text.lines().any(|line| line.len() > 5_000) {
        return None;
    }
    Some(text)
}

/// Overlapping windows over `text`. Each carries its path and first line on
/// top, so a match on the file name alone still lands in the right file.
pub fn chunks(relative: &str, text: &str) -> Vec<Chunk> {
    let lines: Vec<&str> = text.lines().collect();
    let step = WINDOW_LINES - OVERLAP_LINES;
    let mut out = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let end = (start + WINDOW_LINES).min(lines.len());
        let body = lines[start..end].join("\n");
        if !body.trim().is_empty() {
            out.push(Chunk {
                start_line: start + 1,
                end_line: end,
                text: format!("{relative}:{}\n{body}", start + 1),
            });
        }
        if end == lines.len() {
            break;
        }
        start += step;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numbered(count: usize) -> String {
        (1..=count)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn windows_overlap_and_cover_every_line() {
        let chunks = chunks("src/a.rs", &numbered(130));
        let ranges: Vec<(usize, usize)> =
            chunks.iter().map(|c| (c.start_line, c.end_line)).collect();
        assert_eq!(ranges, vec![(1, 60), (51, 110), (101, 130)]);
        assert!(chunks[0].text.starts_with("src/a.rs:1\nline 1\n"));
        assert!(chunks[1].text.starts_with("src/a.rs:51\nline 51\n"));
        assert!(chunks[2].text.ends_with("line 130"));
    }

    #[test]
    fn short_and_blank_files() {
        let one = chunks("a.ts", "only line");
        assert_eq!(one.len(), 1);
        assert_eq!((one[0].start_line, one[0].end_line), (1, 1));
        assert!(chunks("a.ts", "").is_empty());
        assert!(chunks("a.ts", "\n\n   \n").is_empty());
        // Exactly one window: no trailing duplicate.
        assert_eq!(chunks("a.ts", &numbered(60)).len(), 1);
    }

    #[test]
    fn skips_lockfiles_build_output_and_assets() {
        assert!(indexable_path("src-tauri/src/lib.rs"));
        assert!(indexable_path("src/features/voice/live/liveSession.ts"));
        assert!(indexable_path("README.md"));
        assert!(!indexable_path("package-lock.json"));
        assert!(!indexable_path("src-tauri/Cargo.lock"));
        assert!(!indexable_path("dist/assets/index-abc.js"));
        assert!(!indexable_path("web/node_modules/x/index.js"));
        assert!(!indexable_path("public/app.min.js"));
        assert!(!indexable_path("public/logo.svg"));
        assert!(!indexable_path("src/api.generated.ts"));
        assert!(!indexable_path("src/__generated__/schema.ts"));
    }

    #[test]
    fn skips_binary_minified_and_generated_content() {
        assert!(indexable_text(b"fn main() {}\n").is_some());
        assert!(indexable_text(b"abc\0def").is_none());
        assert!(indexable_text(b"").is_none());
        assert!(indexable_text("// @generated by protoc\nfn x() {}".as_bytes()).is_none());
        let minified = format!("var a={};", "x".repeat(6_000));
        assert!(indexable_text(minified.as_bytes()).is_none());
        assert!(indexable_text(&[0xff, 0xfe, 0x41]).is_none());
    }
}
