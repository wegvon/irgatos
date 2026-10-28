import {
  teamCountsLabel,
  type FleetEntry,
} from "../../../fleet/model/fleet";
import { write } from "../client";
import { ago, basename, plural } from "../format";
import { navigate } from "../route";
import {
  BUCKET_PILL,
  BUCKET_TONE,
  Harness,
  Pill,
  StatusDot,
  TONE,
} from "./parts";
import { ChevronRight } from "../../../../shared/ui/icons";

export function place(entry: FleetEntry): string {
  return entry.irgat ?? (entry.chat ? "Chat" : entry.projectLabel);
}

export function subtitle(entry: FleetEntry): string {
  switch (entry.bucket) {
    case "needsYou": {
      const request = entry.requests[0];
      if (request?.kind === "approval")
        return `Wants to ${request.label.toLowerCase()}`;
      return "Asked you a question";
    }
    case "running":
      // A lead with workers says how its team is doing, like desktop Fleet.
      return entry.team
        ? `${entry.activity ?? "Working…"} · ${teamCountsLabel(entry.team.counts)}`
        : (entry.activity ?? "Working…");
    case "review": {
      const parts = [];
      if (entry.editedPaths.length)
        parts.push(`Edited ${plural(entry.editedPaths.length, "file")}`);
      if (entry.artifacts) parts.push(plural(entry.artifacts, "artifact"));
      return parts.join(" · ") || "Finished";
    }
    case "interrupted":
      return "Stopped before it finished";
    case "idle":
      return "Idle";
  }
}

const open = (entry: FleetEntry) =>
  navigate({ name: "chat", id: entry.sessionId });

/**
 * One chat as a card, like the desktop's Fleet cards: neutral, with an amber
 * edge while it waits on you and the status in a small chip.
 */
export function ChatCard({ entry, now }: { entry: FleetEntry; now: number }) {
  // A result stays in Ready to review until it is marked, as on desktop.
  if (entry.bucket !== "review") return <ChatCardBody entry={entry} now={now} />;
  const mark = (state: "reviewed" | "later" | null) =>
    void write("reviewMark", {
      sessionId: entry.sessionId,
      turnAt: entry.turnAt,
      state,
    }).catch(console.error);
  return (
    <div data-web-review={entry.sessionId} className="flex flex-col gap-1.5">
      <ChatCardBody entry={entry} now={now} />
      <span className="flex items-center justify-end gap-2 px-1">
        {entry.reviewLater ? (
          <span className="mr-auto text-[12px] text-(--ink-3)">Put aside</span>
        ) : null}
        <button
          type="button"
          onClick={() => mark(entry.reviewLater ? null : "later")}
          className="web-press rounded-full px-3 py-1.5 text-[13px] font-medium text-(--ink-2)"
        >
          {entry.reviewLater ? "Back to the top" : "Review later"}
        </button>
        <button
          type="button"
          onClick={() => mark("reviewed")}
          className="web-press glass rounded-full px-3 py-1.5 text-[13px] font-semibold text-(--ink)"
        >
          Mark reviewed
        </button>
      </span>
    </div>
  );
}

function ChatCardBody({ entry, now }: { entry: FleetEntry; now: number }) {
  const tone = BUCKET_TONE[entry.bucket];
  const idle = entry.bucket === "idle";
  const files = entry.bucket === "review" ? entry.editedPaths.slice(0, 3) : [];
  return (
    <button
      onClick={() => open(entry)}
      className={`${TONE[tone]} ${entry.bucket === "needsYou" ? "attention" : "glass"} web-press flex w-full flex-col gap-2.5 rounded-[22px] p-4 text-left`}
    >
      <span className="flex w-full items-center gap-2">
        <Pill tone={tone} live={entry.bucket === "running"}>
          {BUCKET_PILL[entry.bucket]}
        </Pill>
        {entry.unseen ? (
          <span className="size-2 shrink-0 rounded-full bg-(--accent)" />
        ) : null}
        <span className="ml-auto shrink-0 text-[12px] font-medium tabular-nums text-(--ink-3)">
          {ago(entry.at, now)}
        </span>
        <ChevronRight className="size-4 shrink-0 text-(--ink-3)" />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-(--ink)">
          {entry.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-(--ink-2)">
          <Harness harness={entry.harness} className="size-3.5" />
          <span className="shrink-0 font-medium">{place(entry)}</span>
          {entry.branch ? (
            <>
              <span className="text-(--ink-3)">·</span>
              <span className="min-w-0 truncate">{entry.branch}</span>
            </>
          ) : null}
        </span>
      </span>
      {idle ? null : (
        <span
          className={`min-w-0 truncate text-[13px] font-medium ${entry.bucket === "running" ? "web-shimmer" : "tone-text"}`}
        >
          {subtitle(entry)}
        </span>
      )}
      {files.length ? (
        <span className="flex flex-wrap gap-1.5">
          {files.map((path) => (
            <span
              key={path}
              className="max-w-[12rem] truncate rounded-md bg-content/8 px-2 py-0.5 font-mono text-[11.5px] text-(--ink-2)"
            >
              {basename(path)}
            </span>
          ))}
          {entry.editedPaths.length > files.length ? (
            <span className="px-1 py-1 text-[11.5px] text-(--ink-3)">
              +{entry.editedPaths.length - files.length}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** One chat as a slim row, for the iPad sidebar. */
export function ChatRow({
  entry,
  now,
  selected = false,
}: {
  entry: FleetEntry;
  now: number;
  selected?: boolean;
}) {
  return (
    <button
      onClick={() => open(entry)}
      aria-current={selected ? "page" : undefined}
      className={`web-press flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left ${
        selected ? "bg-selection" : "active:bg-content/8"
      }`}
    >
      <StatusDot bucket={entry.bucket} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-(--ink)">
            {entry.title}
          </span>
          {entry.unseen ? (
            <span className="size-2 shrink-0 rounded-full bg-(--accent)" />
          ) : null}
          <span className="shrink-0 text-[12px] tabular-nums text-(--ink-3)">
            {ago(entry.at, now)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-(--ink-2)">
          <Harness harness={entry.harness} className="size-3" />
          <span className="shrink-0 font-medium">{place(entry)}</span>
          <span className="text-(--ink-3)">·</span>
          <span
            className={`min-w-0 truncate ${entry.bucket === "running" ? "web-shimmer" : ""}`}
          >
            {subtitle(entry)}
          </span>
        </span>
      </span>
    </button>
  );
}
