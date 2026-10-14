import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxItemKey, type InboxItem } from "./githubTasks";
import {
  applyInboxTriage,
  inboxTriageCounts,
  inboxTriageFlags,
  isInboxTriageFilter,
  loadInboxTriageFilter,
  saveInboxTriageFilter,
  subscribeInboxTriageFilter,
  type InboxTriageContext,
} from "./inboxTriage";
import { EMPTY_INBOX_SNOOZES, type InboxSnoozeState } from "./inboxSnooze";

function item(number: number, overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    kind: "issue",
    title: `Item ${number}`,
    url: `https://github.com/acme/web/issues/${number}`,
    state: "open",
    updatedAt: "2026-10-01T08:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    number,
    projectPath: "/tmp/web",
    provider: "github",
    ...overrides,
  };
}

const now = 10_000;

function context(
  overrides: Partial<InboxTriageContext> = {},
): InboxTriageContext {
  return {
    now,
    snoozes: EMPTY_INBOX_SNOOZES,
    drafts: {},
    isUnseen: () => false,
    relatedSessionCount: () => 0,
    ...overrides,
  };
}

describe("inbox triage", () => {
  const seen = item(1);
  const unseen = item(2);
  const closedUnseen = item(3, { state: "closed" });
  const linked = item(4);
  const snoozed = item(5);
  const resurfaced = item(6);
  const todo = item(7, { provider: "gitlab", attentionReason: "review_requested" });
  const drafted = item(8);
  const items = [seen, unseen, closedUnseen, linked, snoozed, resurfaced, todo, drafted];
  const snoozes: InboxSnoozeState = {
    snoozed: { [inboxItemKey(snoozed)]: { until: now + 1, snoozedAt: 0 } },
    resurfaced: { [inboxItemKey(resurfaced)]: { at: now - 1 } },
  };
  const ctx = context({
    snoozes,
    drafts: {
      [inboxItemKey(drafted)]: { body: "half a reply", updatedAt: 1 },
      [inboxItemKey(snoozed)]: { body: "later", updatedAt: 1 },
    },
    isUnseen: (entry) =>
      entry === unseen || entry === closedUnseen || entry === snoozed,
    relatedSessionCount: (entry) => (entry === linked || entry === snoozed ? 2 : 0),
  });

  it("flags each signal", () => {
    expect(inboxTriageFlags(seen, ctx)).toMatchObject({
      needsAction: false,
      agentActivity: false,
      draft: false,
      resurfaced: false,
    });
    expect(inboxTriageFlags(unseen, ctx).needsAction).toBe(true);
    expect(inboxTriageFlags(closedUnseen, ctx).needsAction).toBe(false);
    expect(inboxTriageFlags(todo, ctx).needsAction).toBe(true);
    expect(inboxTriageFlags(resurfaced, ctx)).toMatchObject({
      needsAction: true,
      resurfaced: true,
    });
    expect(inboxTriageFlags(snoozed, ctx)).toMatchObject({
      snoozedUntil: now + 1,
      needsAction: false,
      agentActivity: false,
      draft: true,
    });
  });

  it("counts every pill", () => {
    expect(inboxTriageCounts(items, ctx)).toEqual({
      all: 7,
      needs_action: 3,
      agent_activity: 1,
      drafts: 2,
      snoozed: 1,
    });
  });

  it("filters, leading Needs action with what came back", () => {
    expect(applyInboxTriage(items, "all", ctx)).not.toContain(snoozed);
    expect(applyInboxTriage(items, "needs_action", ctx)).toEqual([
      resurfaced,
      unseen,
      todo,
    ]);
    expect(applyInboxTriage(items, "agent_activity", ctx)).toEqual([linked]);
    expect(applyInboxTriage(items, "drafts", ctx)).toEqual([snoozed, drafted]);
    expect(applyInboxTriage(items, "snoozed", ctx)).toEqual([snoozed]);
  });

  it("returns an expired snooze to the list", () => {
    const later = context({ ...ctx, now: now + 5 });
    expect(applyInboxTriage(items, "snoozed", later)).toEqual([]);
    expect(applyInboxTriage(items, "all", later)).toContain(snoozed);
  });

  it("orders snoozed items by wake time", () => {
    const a = item(10);
    const b = item(11);
    const order = context({
      snoozes: {
        snoozed: {
          [inboxItemKey(a)]: { until: now + 50, snoozedAt: 0 },
          [inboxItemKey(b)]: { until: now + 10, snoozedAt: 0 },
        },
        resurfaced: {},
      },
    });
    expect(applyInboxTriage([a, b], "snoozed", order)).toEqual([b, a]);
  });

  it("recognizes stored filters", () => {
    expect(isInboxTriageFilter("drafts")).toBe(true);
    expect(isInboxTriageFilter("bogus")).toBe(false);
    expect(isInboxTriageFilter(null)).toBe(false);
  });
});

describe("inbox triage persistence", () => {
  let store: Map<string, string>;
  let refuse = false;

  beforeEach(() => {
    store = new Map();
    refuse = false;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (refuse) throw new Error("quota");
        store.set(key, value);
      },
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal("window", new EventTarget());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the pill and announces changes", () => {
    const listener = vi.fn();
    const stop = subscribeInboxTriageFilter(listener);
    expect(loadInboxTriageFilter()).toBe("all");
    saveInboxTriageFilter("snoozed");
    expect(loadInboxTriageFilter()).toBe("snoozed");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    saveInboxTriageFilter("drafts");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores junk and keeps a refused choice for this run", () => {
    store.set("irgat.inboxTriage", "bogus");
    expect(loadInboxTriageFilter()).toBe("all");
    refuse = true;
    saveInboxTriageFilter("needs_action");
    expect(loadInboxTriageFilter()).toBe("needs_action");
    refuse = false;
    saveInboxTriageFilter("all");
    expect(loadInboxTriageFilter()).toBe("all");
  });
});
