import { useMemo, useState, type ReactNode } from "react";
import {
  FLEET_BUCKETS,
  type FleetBucket,
  type FleetEntry,
} from "../../../fleet/model/fleet";
import type { WebOverview } from "../../model/protocol";
import { navigate } from "../route";
import { ChatCard, place } from "./ChatRow";
import { BUCKET_PILL, BUCKET_TONE, Empty, Spinner, TONE } from "./parts";
import { Search, X } from "../../../../shared/ui/icons";

export function allEntries(overview: WebOverview): FleetEntry[] {
  return FLEET_BUCKETS.flatMap((bucket) => overview[bucket]);
}

function matches(entry: FleetEntry, query: string) {
  const text =
    `${entry.title} ${place(entry)} ${entry.branch ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/** Every open chat as a card, filtered by status and searchable. */
export function Chats({
  overview,
  filter,
  now,
  header,
  wide,
}: {
  overview: WebOverview | null;
  filter?: FleetBucket;
  now: number;
  header?: ReactNode;
  wide: boolean;
}) {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    if (!overview) return [];
    const words = query.trim();
    return (filter ? overview[filter] : allEntries(overview)).filter(
      (entry) => !words || matches(entry, words),
    );
  }, [overview, filter, query]);
  const setFilter = (next?: FleetBucket) =>
    navigate({ name: "chats", ...(next ? { filter: next } : {}) }, true);

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 ${wide ? "max-w-[760px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
          Chats
        </h1>
        <label className="glass flex h-12 items-center gap-2.5 rounded-full px-4 text-(--ink-3) focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
          <Search className="size-[18px] shrink-0" />
          <input
            className="web-field min-w-0 flex-1 bg-transparent text-(--ink) outline-none"
            placeholder="Search chats"
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
        {overview ? (
          <div className="glass -mx-1 flex gap-1 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none]">
            <Segment on={!filter} onClick={() => setFilter()}>
              All
              <Count>{allEntries(overview).length}</Count>
            </Segment>
            {FLEET_BUCKETS.filter(
              (bucket) => overview[bucket].length || bucket === filter,
            ).map((bucket) => (
              <Segment
                key={bucket}
                on={filter === bucket}
                onClick={() => setFilter(bucket)}
              >
                <span
                  className={`${TONE[BUCKET_TONE[bucket]]} tone-dot size-2 rounded-full`}
                />
                {BUCKET_PILL[bucket]}
                <Count>{overview[bucket].length}</Count>
              </Segment>
            ))}
          </div>
        ) : null}
      </header>
      {!overview ? (
        <div className="flex justify-center py-20 text-(--ink-3)">
          <Spinner className="size-6" />
        </div>
      ) : entries.length === 0 ? (
        <Empty title={query ? "No matches" : "Nothing here"}>
          {query
            ? "Try another word from the title or project."
            : filter
              ? `No chat is ${BUCKET_PILL[filter].toLowerCase()} right now.`
              : "Chats you open on your Mac show up here."}
        </Empty>
      ) : (
        <div
          className={`web-rise grid gap-3 ${wide ? "grid-cols-1 min-[1200px]:grid-cols-2" : ""}`}
        >
          {entries.map((entry) => (
            <ChatCard key={entry.sessionId} entry={entry} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

function Segment({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`web-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold ${
        on ? "bg-selection text-(--ink)" : "text-(--ink-2)"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return (
    <span className="tabular-nums font-medium text-(--ink-3)">{children}</span>
  );
}
