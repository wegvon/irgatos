import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInboxDraft,
  inboxDraft,
  INBOX_DRAFT_MAX_CHARS,
  loadInboxDrafts,
  parseInboxDrafts,
  saveInboxDraft,
  subscribeInboxDrafts,
  withInboxDraft,
} from "./inboxDrafts";

const KEY = "irgat.inboxDrafts";

describe("withInboxDraft", () => {
  it("sets, replaces and removes drafts", () => {
    const one = withInboxDraft({}, "a", "Looks good", 1);
    expect(one).toEqual({ a: { body: "Looks good", updatedAt: 1 } });
    expect(withInboxDraft(one, "a", "LGTM", 2).a).toEqual({
      body: "LGTM",
      updatedAt: 2,
    });
    expect(withInboxDraft(one, "a", "   ", 3)).toEqual({});
    expect(withInboxDraft(one, "missing", "", 3)).toBe(one);
    expect(withInboxDraft(one, "", "x", 3)).toBe(one);
  });

  it("caps the body and keeps the most recent drafts", () => {
    const long = withInboxDraft({}, "a", "x".repeat(INBOX_DRAFT_MAX_CHARS + 5), 1);
    expect(long.a.body).toHaveLength(INBOX_DRAFT_MAX_CHARS);
    let drafts = {};
    for (let i = 0; i < 205; i++) drafts = withInboxDraft(drafts, `k${i}`, "x", i);
    expect(Object.keys(drafts)).toHaveLength(200);
    expect(drafts).not.toHaveProperty("k0");
    expect(drafts).toHaveProperty("k204");
  });

  it("ignores malformed storage", () => {
    expect(parseInboxDrafts("nope")).toEqual({});
    expect(parseInboxDrafts("[1]")).toEqual({});
    expect(
      parseInboxDrafts(
        JSON.stringify({ a: { body: "hi" }, b: { body: " " }, c: 4 }),
      ),
    ).toEqual({ a: { body: "hi", updatedAt: 0 } });
  });
});

describe("draft storage", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    });
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("persists per item and announces changes", () => {
    const listener = vi.fn();
    const stop = subscribeInboxDrafts(listener);
    expect(saveInboxDraft("github:acme/web#1", "Draft reply", 5)).toBe(true);
    expect(inboxDraft("github:acme/web#1")).toBe("Draft reply");
    expect(inboxDraft("other")).toBe("");
    expect(JSON.parse(data.get(KEY)!)).toEqual({
      "github:acme/web#1": { body: "Draft reply", updatedAt: 5 },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clearInboxDraft("github:acme/web#1")).toBe(true);
    expect(loadInboxDrafts()).toEqual({});
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports a refused write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(saveInboxDraft("k", "text")).toBe(false);
  });
});
