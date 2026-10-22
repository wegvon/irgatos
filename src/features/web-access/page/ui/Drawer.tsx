import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FLEET_BUCKETS, type FleetBucket } from "../../../fleet/model/fleet";
import type { WebOverview } from "../../model/protocol";
import { navigate, openSheet } from "../route";
import { allEntries, matches } from "./Chats";
import { ChatRow } from "./ChatRow";
import { NEW_CHAT_FIELD } from "./NewChat";
import { MacIcon } from "./Services";
import { Spinner, type Tone } from "./parts";
import { WORKSPACE_SCREENS } from "./Workspace";
import {
  Bot,
  Idea,
  PenLine,
  Radar,
  Search,
  X,
} from "../../../../shared/ui/icons";

/** Short names, so the status filters fit the panel's width. */
const CHIP: Record<FleetBucket, string> = {
  needsYou: "Needs you",
  interrupted: "Stopped",
  review: "Review",
  running: "Running",
  idle: "Idle",
};

/** Opens the composer on the phone's start screen, focused. */
export function startNewChat() {
  navigate({ name: "home" });
  window.setTimeout(() => document.getElementById(NEW_CHAT_FIELD)?.focus(), 60);
}

/**
 * The phone's menu, sliding in from the left like the desktop's two-layer
 * sidebar folded into one panel: search, the sections as tiles, a new chat,
 * then every open chat, filtered by status. Swipe left or tap outside to
 * close it.
 */
export function Drawer({
  open,
  onClose,
  overview,
  now,
  mac,
  macLabel,
  selected,
}: {
  open: boolean;
  onClose: () => void;
  overview: WebOverview | null;
  now: number;
  mac: Tone;
  macLabel: string;
  selected?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FleetBucket | null>(null);
  const start = useRef<{ x: number; y: number; side?: boolean } | null>(null);
  const [drag, setDrag] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // Each opening starts at the top of the list.
  useEffect(() => {
    if (open) list.current?.scrollTo({ top: 0 });
  }, [open]);

  const entries = useMemo(() => {
    if (!overview) return [];
    const words = query.trim();
    return (filter ? overview[filter] : allEntries(overview)).filter(
      (entry) => !words || matches(entry, words),
    );
  }, [overview, filter, query]);
  const needsYou = overview?.needsYou.length ?? 0;

  return (
    <div
      className={`absolute inset-0 z-20 ${open ? "" : "pointer-events-none"}`}
      inert={!open}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <nav
        aria-label="Menu"
        onTouchStart={(event) => {
          // The filter strip scrolls sideways itself.
          const inStrip = (event.target as Element).closest("[data-scroll-x]");
          const touch = event.touches[0];
          start.current =
            inStrip || !touch ? null : { x: touch.clientX, y: touch.clientY };
        }}
        onTouchMove={(event) => {
          const from = start.current;
          const touch = event.touches[0];
          if (!from || !touch) return;
          const dx = touch.clientX - from.x;
          const dy = touch.clientY - from.y;
          // Decide once whether this is a swipe to close or a scroll of the
          // list. Moving the panel while the list scrolls makes WebKit lose
          // rows of it.
          if (from.side === undefined) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            from.side = dx < 0 && Math.abs(dx) > Math.abs(dy);
          }
          if (from.side) setDrag(Math.min(0, dx));
        }}
        onTouchEnd={() => {
          if (drag < -70) onClose();
          start.current = null;
          setDrag(0);
        }}
        style={
          drag
            ? { transform: `translateX(${drag}px)`, transition: "none" }
            : // No transform once open: a scroller inside a transformed
              // panel paints unreliably on iOS.
              { transform: open ? "none" : "translateX(-100%)" }
        }
        className={`web-page absolute inset-y-0 left-0 flex w-[min(86vw,340px)] flex-col pl-(--safe-left) shadow-[8px_0_30px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-out`}
      >
        <div className="flex shrink-0 flex-col gap-3 px-3 pt-[calc(var(--safe-top)+12px)]">
          <label className="flex h-11 items-center gap-2.5 rounded-[14px] bg-content/6 px-3.5 text-(--ink-3) focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
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
          <div className="grid grid-cols-4 gap-2">
            <Tile
              label="Today"
              badge={needsYou}
              onClick={() => navigate({ name: "today" })}
            >
              <Radar className="size-[21px]" />
            </Tile>
            <Tile label="Irgats" onClick={() => navigate({ name: "irgats" })}>
              <Bot className="size-[21px]" />
            </Tile>
            <Tile label="Ideas" onClick={() => navigate({ name: "ideas" })}>
              <Idea className="size-[21px]" />
            </Tile>
            <Tile
              label="Your Mac"
              title={macLabel}
              onClick={() => openSheet({ name: "services" })}
            >
              <MacIcon tone={mac} small />
            </Tile>
            {WORKSPACE_SCREENS.map((entry) => (
              <Tile
                key={entry.name}
                label={entry.label}
                onClick={() => navigate({ name: entry.name })}
              >
                <entry.Icon className="size-[21px]" />
              </Tile>
            ))}
          </div>
          <button
            onClick={() => {
              onClose();
              startNewChat();
            }}
            className="web-press flex h-12 items-center gap-3 rounded-[14px] bg-content/6 px-3.5 text-[16.5px] font-semibold text-(--ink)"
          >
            <PenLine className="size-5" />
            New chat
          </button>
          <div
            data-scroll-x
            className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]"
          >
            <Chip on={filter === null} onClick={() => setFilter(null)}>
              All
            </Chip>
            {overview
              ? FLEET_BUCKETS.map((bucket) =>
                  overview[bucket].length ? (
                    <Chip
                      key={bucket}
                      on={filter === bucket}
                      warn={bucket === "needsYou"}
                      onClick={() =>
                        setFilter(filter === bucket ? null : bucket)
                      }
                    >
                      {CHIP[bucket]}
                      <span className="tabular-nums">
                        {overview[bucket].length}
                      </span>
                    </Chip>
                  ) : null,
                )
              : null}
          </div>
        </div>
        <div
          ref={list}
          className="web-scroll min-h-0 flex-1 px-1.5 pb-[calc(var(--safe-bottom)+12px)] pt-1"
        >
          {!overview ? (
            <div className="flex justify-center py-10 text-(--ink-3)">
              <Spinner className="size-5" />
            </div>
          ) : entries.length ? (
            entries.map((entry) => (
              <ChatRow
                key={entry.sessionId}
                entry={entry}
                now={now}
                selected={entry.sessionId === selected}
              />
            ))
          ) : (
            <div className="px-3 py-6 text-[15px] text-(--ink-3)">
              {query || filter
                ? "No chats match."
                : "No chats are open on your Mac."}
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}

function Tile({
  label,
  title,
  badge = 0,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="glass web-press relative flex h-[64px] flex-col items-center justify-center gap-1.5 rounded-[14px] text-[12.5px] font-medium text-(--ink)"
    >
      <span className="text-(--ink-2)">{children}</span>
      {label}
      {badge ? (
        <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold tabular-nums text-black">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function Chip({
  on,
  warn = false,
  onClick,
  children,
}: {
  on: boolean;
  warn?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`web-press flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-medium ${
        on
          ? "bg-(--ink) text-(--color-background-base)"
          : warn
            ? "bg-content/6 text-(--tone-amber)"
            : "bg-content/6 text-(--ink-2)"
      }`}
    >
      {children}
    </button>
  );
}
