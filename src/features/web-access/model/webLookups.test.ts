import { describe, expect, it, vi } from "vitest";
import type { InboxItem } from "../../inbox/model/githubTasks";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import { newSession, type Session } from "../../sessions/model/session";
import {
  inboxChatPrompt,
  webInbox,
  webInboxDetail,
  webSearch,
  webUsage,
  type WebLookupDeps,
} from "./webLookups";
import { handleWebAccess, type WebAccessDeps } from "./webAccess";

function item(number: number, patch: Partial<InboxItem> = {}): InboxItem {
  return {
    kind: "pr",
    number,
    title: `Fix bug ${number}`,
    url: `https://github.com/me/shop/pull/${number}`,
    state: "open",
    updatedAt: "2026-10-20T10:00:00Z",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignees: [],
    draft: false,
    repo: "me/shop",
    projectPath: "/Users/me/code/shop",
    provider: "github",
    ...patch,
  };
}

function limits(patch: Partial<ProviderRateLimits>): ProviderRateLimits {
  return {
    provider: "claude",
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: 1,
    error: null,
    status: "ok",
    ...patch,
  };
}

function deps(patch: Partial<WebLookupDeps> = {}): WebLookupDeps {
  return {
    history: async () => [],
    searchWords: async () => ({ hits: [], truncated: false }),
    searchMeaning: async () => ({
      hits: [],
      semantic: "on",
      note: null,
      indexed: 10,
      total: 10,
    }),
    inbox: async () => ({ items: [], errors: {} }),
    inboxBody: async () => ({ body: "The body", author: "octo" }),
    isUnseen: () => false,
    markSeen: vi.fn(),
    snoozes: () => ({ snoozed: {}, resurfaced: {} }),
    drafts: () => ({}),
    usage: async () => [],
    showRemaining: () => false,
    ...patch,
  };
}

const shop = (id: string, title: string): Session => ({
  ...newSession("claude", "/Users/me/code/shop"),
  id,
  title,
});

describe("search from the browser", () => {
  it("lists each chat once: titles, then words, then meaning", async () => {
    const result = await webSearch(
      deps({
        history: async () => [
          {
            id: "old",
            cwd: "/Users/me/code/shop",
            harness: "claude",
            model: "opus",
            runtimeMode: "default",
            title: "Checkout flow",
            updatedAt: 5,
          } as never,
        ],
        searchWords: async () => ({
          truncated: false,
          hits: [
            {
              kind: "message",
              sessionId: "old",
              cwd: "/Users/me/code/shop",
              harness: "claude",
              title: "Checkout flow",
              updatedAt: 5,
              blockId: "b1",
              preview: "the checkout button",
            },
            {
              kind: "message",
              sessionId: "words",
              cwd: "/Users/me/code/api",
              harness: "codex",
              title: "Payments",
              updatedAt: 4,
              blockId: "b2",
              preview: "checkout totals",
            },
          ],
        }),
        searchMeaning: async () => ({
          semantic: "on",
          note: null,
          indexed: 10,
          total: 10,
          hits: [
            {
              sessionId: "meant",
              blockId: "b3",
              cwd: "/Users/me/code/api",
              harness: "claude",
              title: "Basket",
              updatedAt: 3,
              preview: "paying for the cart",
              score: 0.8,
            },
          ],
        }),
      }),
      [],
      "checkout",
    );
    expect(result.hits.map((hit) => [hit.sessionId, hit.kind])).toEqual([
      ["old", "chat"],
      ["words", "message"],
      ["meant", "meaning"],
    ]);
    expect(result.hits[1]).toMatchObject({
      place: "api",
      preview: "checkout totals",
    });
    expect(result.note).toBeNull();
  });

  it("finds open chats by title and keeps working when meaning is off", async () => {
    const result = await webSearch(
      deps({
        searchMeaning: async () => {
          throw new Error("embedding service away");
        },
      }),
      [shop("live", "Login form")],
      "login",
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ sessionId: "live", kind: "chat" });
  });

  it("says when meaning search is not set up", async () => {
    const result = await webSearch(
      deps({
        searchMeaning: async () => ({
          hits: [],
          semantic: "off",
          note: null,
          indexed: 0,
          total: 0,
        }),
      }),
      [],
      "anything",
    );
    expect(result.note).toMatch(/Matching words only/);
  });

  it("answers an empty query without asking the Mac", async () => {
    const history = vi.fn(async () => []);
    expect(await webSearch(deps({ history }), [], "  ")).toEqual({
      query: "  ",
      hits: [],
      note: null,
    });
    expect(history).not.toHaveBeenCalled();
  });
});

describe("the Inbox from the browser", () => {
  it("marks what needs action, what is new, and what is snoozed", async () => {
    const result = await webInbox(
      deps({
        inbox: async () => ({
          items: [
            item(1, { updatedAt: "2026-10-21T10:00:00Z" }),
            item(2),
            item(3, { state: "merged" }),
          ],
          errors: { jira: "Token expired" },
        }),
        isUnseen: (entry) => entry.key.endsWith("1") || entry.key.endsWith("3"),
        snoozes: () => ({
          snoozed: {
            "github:me/shop:pr:2": { until: Date.now() + 60_000, snoozedAt: 1 },
          },
          resurfaced: {},
        }),
      }),
      [],
      false,
    );
    expect(result.errors).toEqual(["Jira: Token expired"]);
    const byNumber = Object.fromEntries(
      result.items.map((entry) => [entry.ref, entry]),
    );
    expect(result.items[0]?.ref).toBe("#1");
    expect(byNumber["#1"]).toMatchObject({
      unseen: true,
      needsAction: true,
      status: "Open",
      source: "me/shop",
      place: "shop",
    });
    // Merged work never needs action, even when it changed.
    expect(byNumber["#3"]).toMatchObject({ unseen: true, needsAction: false });
    expect(byNumber["#3"]?.status).toBe("Merged");
    expect(byNumber["#2"]?.snoozedUntil).toBeGreaterThan(Date.now());
    expect(byNumber["#2"]?.needsAction).toBe(false);
  });

  it("opens an item with its description and marks it seen", async () => {
    const markSeen = vi.fn();
    const lookups = deps({
      inbox: async () => ({ items: [item(7)], errors: {} }),
      markSeen,
    });
    const { items } = await webInbox(lookups, [], false);
    const detail = await webInboxDetail(lookups, [], items[0]!.key);
    expect(detail).toMatchObject({
      body: "The body",
      author: "octo",
      item: { ref: "#7", title: "Fix bug 7" },
    });
    expect(markSeen).toHaveBeenCalledWith({
      key: items[0]!.key,
      updatedAt: "2026-10-20T10:00:00Z",
    });
    await expect(webInboxDetail(lookups, [], "github:gone")).rejects.toThrow(
      /no longer in your Inbox/,
    );
  });

  it("starts a chat from an item the way the Mac's Start button does", async () => {
    const lookups = deps({
      inbox: async () => ({ items: [item(7)], errors: {} }),
    });
    const { items } = await webInbox(lookups, [], false);
    const started = await inboxChatPrompt(lookups, items[0]!.key, "Add a test");
    expect(started.cwd).toBe("/Users/me/code/shop");
    expect(started.prompt).toContain("#7 Fix bug 7");
    expect(started.prompt).not.toContain("The body");
    expect(started.prompt.endsWith("Add a test")).toBe(true);
  });

  it("brings a tracker ticket's description along", async () => {
    const lookups = deps({
      inbox: async () => ({
        items: [
          item(9, {
            kind: "linear",
            provider: "linear",
            identifier: "APP-9",
            teamName: "App",
          }),
        ],
        errors: {},
      }),
    });
    const { items } = await webInbox(lookups, [], false);
    expect(items[0]).toMatchObject({ ref: "APP-9", source: "App" });
    const started = await inboxChatPrompt(lookups, items[0]!.key, "");
    expect(started.prompt).toContain("APP-9 Fix bug 9");
    expect(started.prompt).toContain("The body");
  });
});

describe("usage limits from the browser", () => {
  it("shows each account's windows and skips providers not installed", async () => {
    const usage = vi.fn(async () => [
      {
        limits: limits({
          session: { usedPercent: 92, windowMinutes: 300, resetsAt: null },
          weekly: { usedPercent: 40, windowMinutes: 10_080, resetsAt: null },
        }),
        account: "Work",
      },
      {
        limits: limits({
          provider: "codex",
          status: "unavailable",
          reason: "not-installed",
        }),
      },
      {
        limits: limits({
          provider: "devin",
          session: { usedPercent: 10, windowMinutes: 1_440, resetsAt: null },
          extraUsageBalance: 4.5,
        }),
      },
    ]);
    const result = await webUsage(
      deps({ usage, showRemaining: () => true }),
      ["claude", "codex", "devin"],
      true,
    );
    expect(usage).toHaveBeenCalledWith(["claude", "codex", "devin"], true);
    expect(result.showRemaining).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0]).toMatchObject({
      provider: "claude",
      title: "Claude Code",
      account: "Work",
      tone: "low",
      windows: [
        { title: "5h", usedPercent: 92 },
        { title: "Weekly", usedPercent: 40 },
      ],
    });
    expect(result.accounts[1]).toMatchObject({
      provider: "devin",
      windows: [{ title: "Daily" }],
      extra: 4.5,
    });
  });
});

describe("the relayed calls", () => {
  it("starts an Inbox chat in the item's project, quietly", async () => {
    const launch = vi.fn(async () => {});
    const app = {
      sessions: () => [],
      launch,
      freeChatDir: async () => "/Users/me/.irgatos/scratch",
      choice: () => ({ harness: "claude", model: "opus" }),
      harnesses: () => ["claude"],
      newId: () => "new-1",
      lookups: deps({ inbox: async () => ({ items: [item(7)], errors: {} }) }),
    } as unknown as WebAccessDeps;
    const result = await handleWebAccess(app, "inboxStart", {
      key: "github:me/shop:pr:7",
      text: "Review it",
    });
    expect(result).toEqual({ sessionId: "new-1" });
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/Users/me/code/shop",
        harness: "claude",
        model: "opus",
        reveal: false,
        prompt: expect.stringContaining("Review it"),
      }),
      "new-1",
    );
  });

  it("says so when this build has no lookups", async () => {
    const app = { sessions: () => [] } as unknown as WebAccessDeps;
    await expect(handleWebAccess(app, "search", { q: "x" })).rejects.toThrow(
      /Not available/,
    );
  });
});
