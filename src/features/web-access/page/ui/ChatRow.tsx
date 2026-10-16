import type { FleetEntry } from "../../../fleet/model/fleet";
import { ago, basename, plural } from "../format";
import { navigate } from "../route";
import {
  BUCKET_PILL,
  BUCKET_TONE,
  Harness,
  Pill,
  StatusDot,
  TONE,
  Ticks,
} from "./parts";
import { ArrowUpRight } from "../../../../shared/ui/icons";

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
      return entry.activity ?? "Working…";
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
 * One chat as a pastel card in its status color: lavender while it runs,
 * peach while it waits on you, mint once it is ready to review.
 */
export function ChatCard({ entry, now }: { entry: FleetEntry; now: number }) {
  const tone = BUCKET_TONE[entry.bucket];
  const idle = entry.bucket === "idle";
  const files = entry.bucket === "review" ? entry.editedPaths.slice(0, 3) : [];
  return (
    <button
      onClick={() => open(entry)}
      className={`${TONE[tone]} ${idle ? "glass" : "tinted"} web-press flex w-full flex-col gap-2.5 rounded-[24px] p-4 text-left`}
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
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/80 text-(--ink-2) shadow-[inset_0_0_0_1px_var(--hairline)]">
          <ArrowUpRight className="size-3.5" strokeWidth={2.2} />
        </span>
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
        <span className="flex flex-col gap-1.5">
          <span
            className={`min-w-0 truncate text-[12.5px] font-medium ${entry.bucket === "running" ? "web-shimmer" : "tone-text"}`}
          >
            {subtitle(entry)}
          </span>
          {entry.bucket === "running" ? (
            <Ticks value={null} tone={tone} />
          ) : entry.bucket === "review" ? (
            <Ticks value={1} tone={tone} />
          ) : null}
        </span>
      )}
      {files.length ? (
        <span className="flex flex-wrap gap-1.5">
          {files.map((path) => (
            <span
              key={path}
              className="max-w-[12rem] truncate rounded-full bg-white/75 px-2.5 py-1 font-mono text-[11.5px] text-(--ink-2) shadow-[inset_0_0_0_1px_var(--hairline)]"
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
        selected
          ? "bg-white/90 shadow-[inset_0_0_0_1px_white,0_6px_18px_-10px_rgb(64_44_150/0.35)]"
          : "active:bg-white/50"
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
