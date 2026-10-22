import { useMemo } from "react";
import type { WebHistory, WebHistoryEntry } from "../../model/protocol";
import { read, usePoll } from "../client";
import { ago } from "../format";
import { navigate } from "../route";
import { Harness } from "./parts";

const EVERY_MS = 60_000;

function matches(entry: WebHistoryEntry, query: string) {
  const text =
    `${entry.title} ${entry.projectLabel} ${entry.branch ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/**
 * Chats saved on the Mac but not open there, newest first, as the desktop
 * sidebar's history lists them. Opening one loads it on the Mac quietly.
 */
export function History({
  active,
  query,
  now,
  selected,
}: {
  /** Off while the list is out of sight, so a closed menu costs nothing. */
  active: boolean;
  query: string;
  now: number;
  selected?: string;
}) {
  const { data } = usePoll(
    active ? "history" : null,
    () => read<WebHistory>("history"),
    () => EVERY_MS,
  );
  const chats = useMemo(() => {
    const words = query.trim();
    return (data?.chats ?? []).filter(
      (entry) => !words || matches(entry, words),
    );
  }, [data, query]);
  if (!chats.length) return null;

  return (
    <section aria-label="Earlier chats" className="mt-3">
      <h2 className="px-3 pb-1 text-[12.5px] font-semibold text-(--ink-3)">
        Earlier
      </h2>
      {chats.map((entry) => (
        <button
          key={entry.sessionId}
          onClick={() => navigate({ name: "chat", id: entry.sessionId })}
          aria-current={entry.sessionId === selected ? "page" : undefined}
          className={`web-press flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left ${
            entry.sessionId === selected
              ? "bg-selection"
              : "active:bg-content/8"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-(--ink)">
                {entry.title}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-(--ink-3)">
                {ago(entry.updatedAt, now)}
              </span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-(--ink-2)">
              <Harness harness={entry.harness} className="size-3" />
              <span className="shrink-0 font-medium">{entry.projectLabel}</span>
              {entry.branch ? (
                <>
                  <span className="text-(--ink-3)">·</span>
                  <span className="min-w-0 truncate">{entry.branch}</span>
                </>
              ) : null}
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}
