import {
  INBOX_TRIAGE_FILTERS,
  INBOX_TRIAGE_LABELS,
  type InboxTriageCounts,
  type InboxTriageFilter,
} from "../model/inboxTriage";

const HINTS: Record<InboxTriageFilter, string> = {
  all: "Everything except snoozed items",
  needs_action: "Open items that are new to you, back from a snooze, or waiting on you",
  agent_activity: "Items an agent thread is working on",
  drafts: "Items with an unsent reply",
  snoozed: "Hidden until their reminder",
};

export function InboxTriagePills({
  value,
  counts,
  onChange,
}: {
  value: InboxTriageFilter;
  counts: InboxTriageCounts;
  onChange: (next: InboxTriageFilter) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Triage"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-stroke px-2 py-1.5 [scrollbar-width:none]"
    >
      {INBOX_TRIAGE_FILTERS.map((filter) => {
        const selected = filter === value;
        const count = counts[filter];
        return (
          <button
            key={filter}
            type="button"
            role="radio"
            aria-checked={selected}
            title={HINTS[filter]}
            onClick={() => onChange(filter)}
            className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] leading-none ${
              selected
                ? "border-transparent bg-selection text-content"
                : "border-content/10 text-content/55 hover:bg-content/5 hover:text-content"
            }`}
          >
            {INBOX_TRIAGE_LABELS[filter]}
            <span
              className={`tabular-nums ${
                selected
                  ? "text-content/60"
                  : filter === "needs_action" && count > 0
                    ? "text-accent"
                    : "text-content/35"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function inboxTriageEmptyText(filter: InboxTriageFilter): string | null {
  switch (filter) {
    case "needs_action":
      return "Nothing needs your attention";
    case "agent_activity":
      return "No agent threads are linked to these items";
    case "drafts":
      return "No unsent replies";
    case "snoozed":
      return "Nothing snoozed";
    case "all":
      return null;
  }
}
