import { inboxItemKey, inboxItemStatus, type InboxItem } from "./githubTasks";
import {
  isResurfaced,
  snoozedUntil,
  type InboxSnoozeState,
} from "./inboxSnooze";
import type { InboxDrafts } from "./inboxDrafts";

/** Quick views over the Inbox list, shown as pills above it. */
export type InboxTriageFilter =
  | "all"
  | "needs_action"
  | "agent_activity"
  | "drafts"
  | "snoozed";

export const INBOX_TRIAGE_FILTERS: readonly InboxTriageFilter[] = [
  "all",
  "needs_action",
  "agent_activity",
  "drafts",
  "snoozed",
];

export const INBOX_TRIAGE_LABELS: Record<InboxTriageFilter, string> = {
  all: "All",
  needs_action: "Needs action",
  agent_activity: "Agent activity",
  drafts: "Drafts",
  snoozed: "Snoozed",
};

export type InboxTriageContext = {
  now: number;
  snoozes: InboxSnoozeState;
  drafts: InboxDrafts;
  /** Updated since the user last opened it. */
  isUnseen: (item: InboxItem) => boolean;
  /** Agent sessions linked to the item. */
  relatedSessionCount: (item: InboxItem) => number;
};

export type InboxTriageFlags = {
  key: string;
  snoozedUntil?: number;
  resurfaced: boolean;
  needsAction: boolean;
  agentActivity: boolean;
  draft: boolean;
};

function isOpen(item: InboxItem): boolean {
  const status = inboxItemStatus(item);
  return status !== "Closed" && status !== "Merged";
}

/**
 * Needs action: still open, not snoozed, and either back from a snooze,
 * updated since the user looked, or flagged by its provider as waiting on
 * them (a GitLab or Azure DevOps to-do).
 */
export function inboxTriageFlags(
  item: InboxItem,
  context: InboxTriageContext,
): InboxTriageFlags {
  const key = inboxItemKey(item);
  const until = snoozedUntil(context.snoozes, key, context.now);
  const snoozed = until != null;
  const resurfaced = !snoozed && isResurfaced(context.snoozes, key);
  return {
    key,
    ...(snoozed ? { snoozedUntil: until } : {}),
    resurfaced,
    needsAction:
      !snoozed &&
      isOpen(item) &&
      (resurfaced || !!item.attentionReason?.trim() || context.isUnseen(item)),
    agentActivity: !snoozed && context.relatedSessionCount(item) > 0,
    draft: !!context.drafts[key]?.body.trim(),
  };
}

function matches(flags: InboxTriageFlags, filter: InboxTriageFilter): boolean {
  switch (filter) {
    case "all":
      return flags.snoozedUntil == null;
    case "needs_action":
      return flags.needsAction;
    case "agent_activity":
      return flags.agentActivity;
    case "drafts":
      return flags.draft;
    case "snoozed":
      return flags.snoozedUntil != null;
  }
}

export type InboxTriageCounts = Record<InboxTriageFilter, number>;

export function inboxTriageCounts(
  items: readonly InboxItem[],
  context: InboxTriageContext,
): InboxTriageCounts {
  const counts: InboxTriageCounts = {
    all: 0,
    needs_action: 0,
    agent_activity: 0,
    drafts: 0,
    snoozed: 0,
  };
  for (const item of items) {
    const flags = inboxTriageFlags(item, context);
    for (const filter of INBOX_TRIAGE_FILTERS)
      if (matches(flags, filter)) counts[filter] += 1;
  }
  return counts;
}

/** The items in one triage view; back-from-snooze items lead "Needs action". */
export function applyInboxTriage(
  items: readonly InboxItem[],
  filter: InboxTriageFilter,
  context: InboxTriageContext,
): InboxItem[] {
  const kept: Array<{ item: InboxItem; flags: InboxTriageFlags }> = [];
  for (const item of items) {
    const flags = inboxTriageFlags(item, context);
    if (matches(flags, filter)) kept.push({ item, flags });
  }
  if (filter === "snoozed")
    kept.sort(
      (a, b) => (a.flags.snoozedUntil ?? 0) - (b.flags.snoozedUntil ?? 0),
    );
  else if (filter === "needs_action")
    kept.sort((a, b) => Number(b.flags.resurfaced) - Number(a.flags.resurfaced));
  return kept.map((entry) => entry.item);
}

const STORAGE_KEY = "irgat.inboxTriage";

export function isInboxTriageFilter(value: unknown): value is InboxTriageFilter {
  return (
    typeof value === "string" &&
    (INBOX_TRIAGE_FILTERS as readonly string[]).includes(value)
  );
}

/** Holds the choice for this run when storage refuses it. */
let unsaved: InboxTriageFilter | null = null;

export function loadInboxTriageFilter(): InboxTriageFilter {
  if (unsaved) return unsaved;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isInboxTriageFilter(raw) ? raw : "all";
  } catch {
    return "all";
  }
}

const CHANGED = "irgat:inbox-triage-changed";

export function saveInboxTriageFilter(filter: InboxTriageFilter) {
  try {
    localStorage.setItem(STORAGE_KEY, filter);
    unsaved = null;
  } catch {
    unsaved = filter;
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function subscribeInboxTriageFilter(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}
