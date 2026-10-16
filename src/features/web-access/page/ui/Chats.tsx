import { useMemo, useState, type ReactNode } from "react";
import { FLEET_BUCKETS, type FleetEntry } from "../../../fleet/model/fleet";
import type { WebOverview } from "../../model/protocol";
import { ChatRow, place } from "./ChatRow";
import { Empty, Group, SectionTitle, Spinner } from "./parts";
import { MessageMultiple, Search, X } from "../../../../shared/ui/icons";

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

/** Every open chat, grouped by the project or Irgat it belongs to. */
export function Chats({
  overview,
  now,
  header,
  wide,
}: {
  overview: WebOverview | null;
  now: number;
  header?: ReactNode;
  wide: boolean;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    if (!overview) return [];
    const byPlace = new Map<string, FleetEntry[]>();
    for (const entry of allEntries(overview)) {
      if (query.trim() && !matches(entry, query.trim())) continue;
      const key = place(entry);
      byPlace.set(key, [...(byPlace.get(key) ?? []), entry]);
    }
    return [...byPlace.entries()]
      .map(([name, entries]) => ({
        name,
        entries: entries.sort((a, b) => b.at - a.at),
      }))
      .sort((a, b) => b.entries[0]!.at - a.entries[0]!.at);
  }, [overview, query]);

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-6 px-4 ${wide ? "max-w-[760px] px-8 pt-[calc(var(--safe-top)+20px)] pb-12" : "pb-8"}`}
    >
      <header className={wide ? "" : "pt-[calc(var(--safe-top)+10px)]"}>
        <div className="flex h-9 items-center justify-end">{header}</div>
        <h1 className="mt-0.5 text-[34px] font-bold leading-tight tracking-[-0.02em]">
          Chats
        </h1>
        <label className="mt-3 flex h-11 items-center gap-2 rounded-[12px] bg-content/[0.07] px-3 text-content/45">
          <Search className="size-[18px] shrink-0" />
          <input
            className="web-field min-w-0 flex-1 bg-transparent text-content outline-none"
            placeholder="Search chats"
            value={query}
            enterKeyHint="search"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              aria-label="Clear search"
              className="flex size-6 items-center justify-center rounded-full bg-content/25 text-(--color-background-base)"
              onClick={() => setQuery("")}
            >
              <X className="size-3.5" strokeWidth={2.5} />
            </button>
          ) : null}
        </label>
      </header>
      {!overview ? (
        <div className="flex justify-center py-20 text-content/40">
          <Spinner className="size-6" />
        </div>
      ) : groups.length === 0 ? (
        <Empty
          icon={<MessageMultiple className="size-6" />}
          title={query ? "No matches" : "No open chats"}
        >
          {query
            ? "Try another word from the title or project."
            : "Chats you open on your Mac show up here."}
        </Empty>
      ) : (
        groups.map((group) => (
          <section key={group.name}>
            <SectionTitle count={group.entries.length}>
              {group.name}
            </SectionTitle>
            <Group>
              {group.entries.map((entry) => (
                <ChatRow
                  key={entry.sessionId}
                  entry={entry}
                  now={now}
                  showPlace={false}
                />
              ))}
            </Group>
          </section>
        ))
      )}
    </div>
  );
}
