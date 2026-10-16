import type { FleetEntry } from "../../../fleet/model/fleet";
import { ago, basename, plural } from "../format";
import { navigate } from "../route";
import { Harness, StatusDot } from "./parts";
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

/** One chat in a list: status, title, what it is doing, where it lives. */
export function ChatRow({
  entry,
  now,
  selected = false,
  showFiles = false,
  showPlace = true,
  compact = false,
}: {
  entry: FleetEntry;
  now: number;
  selected?: boolean;
  showFiles?: boolean;
  /** Off in a list already grouped by project. */
  showPlace?: boolean;
  compact?: boolean;
}) {
  const files = showFiles ? entry.editedPaths.slice(0, 3) : [];
  return (
    <button
      onClick={() => navigate({ name: "chat", id: entry.sessionId })}
      aria-current={selected ? "page" : undefined}
      className={`flex w-full items-center gap-3 text-left transition-colors ${
        compact ? "rounded-[12px] px-3 py-2.5" : "px-4 py-3"
      } ${selected ? "bg-selection-strong" : "active:bg-selection"}`}
    >
      <StatusDot bucket={entry.bucket} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate font-medium ${compact ? "text-[15px]" : "text-[16px]"}`}
          >
            {entry.title}
          </span>
          {entry.unseen ? (
            <span className="size-2 shrink-0 rounded-full bg-(--accent)" />
          ) : null}
          <span className="shrink-0 text-[12px] tabular-nums text-content/40">
            {ago(entry.at, now)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-content/50">
          <Harness harness={entry.harness} className="size-3" />
          {showPlace ? (
            <>
              <span className="shrink-0 font-medium text-content/60">
                {place(entry)}
              </span>
              <span className="text-content/25">·</span>
            </>
          ) : null}
          <span
            className={`min-w-0 truncate ${entry.bucket === "running" ? "web-shimmer" : ""}`}
          >
            {subtitle(entry)}
          </span>
        </div>
        {files.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {files.map((path) => (
              <span
                key={path}
                className="max-w-[12rem] truncate rounded-md bg-content/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] text-content/65"
              >
                {basename(path)}
              </span>
            ))}
            {entry.editedPaths.length > files.length ? (
              <span className="px-1 py-0.5 text-[11.5px] text-content/40">
                +{entry.editedPaths.length - files.length}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {compact ? null : (
        <ChevronRight className="size-4 shrink-0 text-content/25" />
      )}
    </button>
  );
}
