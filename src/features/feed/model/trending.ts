import { invoke } from "@tauri-apps/api/core";

/** GitHub's trending repositories; see src-tauri/src/feed/trending.rs. */

export type TrendingPeriod = "daily" | "weekly" | "monthly";

export const TRENDING_PERIODS: {
  id: TrendingPeriod;
  label: string;
  /** How the stars gained in the period read on a row. */
  gained: string;
}[] = [
  { id: "daily", label: "Today", gained: "today" },
  { id: "weekly", label: "This week", gained: "this week" },
  { id: "monthly", label: "This month", gained: "this month" },
];

/** Values match the languages src-tauri/src/feed/trending.rs accepts. */
export const TRENDING_LANGUAGES: { id: string; label: string }[] = [
  { id: "", label: "All languages" },
  { id: "rust", label: "Rust" },
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "kotlin", label: "Kotlin" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "c++", label: "C++" },
  { id: "c#", label: "C#" },
  { id: "zig", label: "Zig" },
  { id: "ruby", label: "Ruby" },
  { id: "php", label: "PHP" },
];

export type TrendingRepo = {
  /** "owner/name". */
  fullName: string;
  url: string;
  description: string;
  language: string;
  languageColor: string;
  stars: number;
  forks: number;
  /** Stars gained in the chosen period. */
  periodStars: number;
};

export type TrendingPage = { repos: TrendingRepo[]; fetchedAt: number };

export const loadTrending = (
  since: TrendingPeriod,
  language: string,
  refresh = false,
) =>
  invoke<TrendingPage>("feed_github_trending", {
    since,
    language: language || null,
    refresh,
  });

// ---- which repositories are new since the last look ----

const SEEN_KEY = "irgatos.feed.trendingSeen.v1";

type Seen = Record<string, string[]>;

const seenKey = (since: TrendingPeriod, language: string) =>
  `${since}:${language}`;

function readSeen(): Seen {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Seen) : {};
  } catch {
    return {};
  }
}

/**
 * Repositories that were not on this list the previous time it was shown,
 * then remembers the current list. The very first look marks nothing new.
 */
export function takeNewRepos(
  since: TrendingPeriod,
  language: string,
  repos: TrendingRepo[],
): Set<string> {
  const seen = readSeen();
  const key = seenKey(since, language);
  const before = seen[key];
  const names = repos.map((repo) => repo.fullName);
  const fresh = before
    ? new Set(names.filter((name) => !before.includes(name)))
    : new Set<string>();
  seen[key] = names;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Without storage every repository simply reads as already seen.
  }
  return fresh;
}

/** "owner" and "name" of "owner/name". */
export function repoParts(fullName: string): { owner: string; name: string } {
  const slash = fullName.indexOf("/");
  return slash < 0
    ? { owner: "", name: fullName }
    : { owner: fullName.slice(0, slash), name: fullName.slice(slash + 1) };
}
