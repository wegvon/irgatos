import { useEffect, useState, type ReactNode } from "react";
import type { WebSearch, WebSearchHit } from "../../model/protocol";
import { read } from "../client";
import { ago } from "../format";
import { navigate } from "../route";
import { Harness, Spinner } from "./parts";
import { Search, Sparkles, X } from "../../../../shared/ui/icons";

/** Meaning needs a round trip to the embedding service; wait for a pause. */
const DEBOUNCE_MS = 400;

/**
 * Asks the Mac to search every chat, open or not, once typing pauses.
 * Null while there is nothing to show yet.
 */
export function useChatSearch(query: string) {
  const trimmed = query.trim();
  const [result, setResult] = useState<WebSearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (trimmed.length < 2) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      read<WebSearch>("search", { q: trimmed })
        .then((next) => {
          if (!alive) return;
          setResult(next);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!alive) return;
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  const current = result?.query === trimmed ? result : null;
  return { result: current, error, loading, searching: trimmed.length >= 2 };
}

/** One found chat: its title, where it lives, and the words that matched. */
function HitRow({ hit, now }: { hit: WebSearchHit; now: number }) {
  return (
    <button
      onClick={() => navigate({ name: "chat", id: hit.sessionId })}
      className="web-press flex w-full flex-col gap-0.5 rounded-[16px] px-3 py-2.5 text-left active:bg-content/8"
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-(--ink)">
          {hit.title}
        </span>
        {hit.kind === "meaning" ? (
          <span
            title="Found by meaning: none of your words matched"
            className="flex shrink-0 items-center gap-1 rounded-full bg-content/8 px-1.5 py-0.5 text-[11px] font-semibold text-(--ink-2)"
          >
            <Sparkles className="size-3" />
            meaning
          </span>
        ) : null}
        <span className="shrink-0 text-[12px] tabular-nums text-(--ink-3)">
          {ago(hit.updatedAt, now)}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-(--ink-2)">
        <Harness harness={hit.harness} className="size-3" />
        <span className="shrink-0 font-medium">{hit.place}</span>
        {hit.preview ? (
          <>
            <span className="text-(--ink-3)">·</span>
            <span className="min-w-0 truncate">{hit.preview}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Every chat on the Mac matching the words, as ⌘K finds them there: titles,
 * messages, then the ones that only match by meaning.
 */
export function SearchResults({
  query,
  now,
  title = "All chats",
  skip,
}: {
  query: string;
  now: number;
  title?: string;
  /** Chats already listed above, by session id. */
  skip?: ReadonlySet<string>;
}) {
  const { result, error, loading, searching } = useChatSearch(query);
  if (!searching) return null;
  const hits = result?.hits.filter((hit) => !skip?.has(hit.sessionId)) ?? [];
  return (
    <section aria-label="Search results" className="pt-2">
      <div className="flex items-center gap-2 px-3 pb-1 text-[12.5px] font-semibold text-(--ink-3)">
        {title}
        {loading ? <Spinner className="size-3.5" /> : null}
      </div>
      {hits.length ? (
        hits.map((hit) => <HitRow key={hit.sessionId} hit={hit} now={now} />)
      ) : result && !loading ? (
        <Note>{skip?.size ? "Nothing else found." : "Nothing found."}</Note>
      ) : null}
      {error ? <Note>{error}</Note> : null}
      {result?.note ? <Note>{result.note}</Note> : null}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-2 text-[13.5px] leading-snug text-(--ink-3)">
      {children}
    </div>
  );
}

/** The iPad's search screen: one field over the results. */
export function SearchScreen({
  header,
  now,
  wide,
}: {
  header: ReactNode;
  now: number;
  wide: boolean;
}) {
  const [query, setQuery] = useState("");
  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 ${wide ? "max-w-[820px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
          Search
        </h1>
      </header>
      <label className="flex h-12 items-center gap-2.5 rounded-[16px] bg-content/6 px-4 text-(--ink-3) focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
        <Search className="size-5 shrink-0" />
        <input
          autoFocus
          className="web-field min-w-0 flex-1 bg-transparent text-(--ink) outline-none"
          placeholder="Search every chat, by words or meaning"
          value={query}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            aria-label="Clear search"
            className="flex size-6 items-center justify-center rounded-full bg-(--ink-3) text-(--color-background-base)"
            onClick={() => setQuery("")}
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </label>
      <div className="glass rounded-[24px] p-1.5 empty:hidden">
        <SearchResults query={query} now={now} title="Results" />
      </div>
      {query.trim().length < 2 ? (
        <div className="px-1 text-[14px] text-(--ink-3)">
          Finds chats by title, by any message, and by meaning when the words
          differ, including chats closed on your Mac.
        </div>
      ) : null}
    </div>
  );
}
