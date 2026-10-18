import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  GitBranch,
  LoaderCircle,
  Star,
} from "../../../shared/ui/icons";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { compactNumber } from "../model/feed";
import {
  TRENDING_LANGUAGES,
  TRENDING_PERIODS,
  loadTrending,
  repoParts,
  takeNewRepos,
  type TrendingPage,
  type TrendingPeriod,
  type TrendingRepo,
} from "../model/trending";

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

let rememberedPeriod: TrendingPeriod = "daily";
let rememberedLanguage = "";

/** The period and language switches, shown in the Feed's tab bar. */
export function TrendingControls({
  period,
  language,
  onPeriod,
  onLanguage,
}: {
  period: TrendingPeriod;
  language: string;
  onPeriod: (period: TrendingPeriod) => void;
  onLanguage: (language: string) => void;
}) {
  return (
    <>
      <div
        className="flex rounded-md bg-content/5 p-0.5"
        role="radiogroup"
        aria-label="Trending period"
      >
        {TRENDING_PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={period === p.id}
            onClick={() => onPeriod(p.id)}
            className={`rounded px-2 py-0.5 ${
              period === p.id
                ? "bg-background-base text-content shadow-sm"
                : "text-content/55 hover:text-content"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <select
        value={language}
        onChange={(event) => onLanguage(event.target.value)}
        aria-label="Language"
        className="rounded-md border border-stroke bg-transparent px-1.5 py-0.5 text-[12px] text-content/75"
      >
        {TRENDING_LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </>
  );
}

export function useTrendingChoice() {
  const [period, setPeriod] = useState<TrendingPeriod>(rememberedPeriod);
  const [language, setLanguage] = useState(rememberedLanguage);
  useEffect(() => {
    rememberedPeriod = period;
    rememberedLanguage = language;
  }, [period, language]);
  return { period, language, setPeriod, setLanguage };
}

/**
 * GitHub's trending repositories for the chosen period. `refreshKey`
 * changing (the header's Refresh button) reads GitHub again.
 */
export function TrendingList({
  period,
  language,
  refreshKey,
  onLoading,
}: {
  period: TrendingPeriod;
  language: string;
  refreshKey: number;
  onLoading?: (loading: boolean) => void;
}) {
  const [page, setPage] = useState<TrendingPage | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const firstRefresh = useRef(refreshKey);
  const onLoadingRef = useRef(onLoading);
  onLoadingRef.current = onLoading;

  const load = useCallback(
    async (refresh: boolean) => {
      const id = ++request.current;
      setLoading(true);
      onLoadingRef.current?.(true);
      try {
        const next = await loadTrending(period, language, refresh);
        if (id !== request.current) return;
        setPage(next);
        setFresh(takeNewRepos(period, language, next.repos));
        setError(null);
      } catch (err: unknown) {
        if (id === request.current) setError(message(err));
      } finally {
        if (id === request.current) {
          setLoading(false);
          onLoadingRef.current?.(false);
        }
      }
    },
    [period, language],
  );

  useEffect(() => {
    setPage(null);
    void load(false);
  }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (refreshKey === firstRefresh.current) return;
    void loadRef.current(true);
  }, [refreshKey]);

  const gained = TRENDING_PERIODS.find((p) => p.id === period)?.gained ?? "";
  const repos = page?.repos ?? [];

  return (
    <>
      {error ? (
        <p className="text-[12px] text-red-400">
          Could not load GitHub trending: {error}
        </p>
      ) : null}
      {page && repos.length > 0 ? (
        <p className="text-[12px] text-content/45">
          Repositories gaining the most stars on GitHub {gained}
          {fresh.size > 0 ? `, ${fresh.size} new since you last looked` : ""}.
          Updated {formatRelativeTime(new Date(page.fetchedAt).toISOString())}.
        </p>
      ) : null}
      {loading && !page ? (
        <div className="flex justify-center py-8 text-content/45">
          <LoaderCircle className="size-4 animate-spin" />
        </div>
      ) : null}
      {page && repos.length === 0 && !error ? (
        <p className="py-8 text-center text-[12px] text-content/50">
          GitHub lists no trending repositories for this choice right now.
        </p>
      ) : null}
      {repos.map((repo, index) => (
        <RepoCard
          key={repo.fullName}
          rank={index + 1}
          repo={repo}
          gained={gained}
          isNew={fresh.has(repo.fullName)}
        />
      ))}
    </>
  );
}

function RepoCard({
  rank,
  repo,
  gained,
  isNew,
}: {
  rank: number;
  repo: TrendingRepo;
  gained: string;
  isNew: boolean;
}) {
  const { owner, name } = repoParts(repo.fullName);
  return (
    <article
      className="group cursor-pointer rounded-lg border border-stroke px-3.5 py-3 hover:bg-content/[0.03]"
      onClick={() => void openUrl(repo.url)}
      title={`Open ${repo.fullName} on GitHub`}
    >
      <header className="flex items-center gap-2 text-[13px]">
        <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-content/35">
          {rank}
        </span>
        {owner ? (
          <img
            src={`https://github.com/${encodeURIComponent(owner)}.png?size=40`}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-5 shrink-0 rounded"
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        ) : null}
        <span className="min-w-0 truncate">
          {owner ? <span className="text-content/55">{owner} / </span> : null}
          <span className="font-medium text-content">{name}</span>
        </span>
        {isNew ? (
          <span className="shrink-0 rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
            New
          </span>
        ) : null}
        <ExternalLink
          className="ml-auto size-3.5 shrink-0 text-content/40 opacity-0 group-hover:opacity-100"
          strokeWidth={1.75}
        />
      </header>
      {repo.description ? (
        <p className="ml-7 mt-1 text-[12px] leading-relaxed text-content/70">
          {repo.description}
        </p>
      ) : null}
      <footer className="ml-7 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-content/50">
        {repo.language ? (
          <span className="flex items-center gap-1">
            <span
              className="size-2 rounded-full bg-content/30"
              style={
                repo.languageColor
                  ? { backgroundColor: repo.languageColor }
                  : undefined
              }
            />
            {repo.language}
          </span>
        ) : null}
        <span className="flex items-center gap-1" title={`${repo.stars} stars`}>
          <Star className="size-3" strokeWidth={1.75} />
          {compactNumber(repo.stars)}
        </span>
        <span className="flex items-center gap-1" title={`${repo.forks} forks`}>
          <GitBranch className="size-3" strokeWidth={1.75} />
          {compactNumber(repo.forks)}
        </span>
        {repo.periodStars > 0 ? (
          <span className="ml-auto rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-400">
            +{repo.periodStars.toLocaleString()} stars {gained}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
