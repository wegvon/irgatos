import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../model/session";
import { getComposerDraft, setComposerDraft } from "../model/draftCache";
import {
  INSERT_SESSION_REFERENCE_EVENT,
  insertSessionReference,
  type InsertSessionReferenceRequest,
} from "../model/sessionReferenceEvents";
import type { SessionSummary } from "./sessionStore";

const store = vi.hoisted(() => ({
  listRecentSessions: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("./sessionStore", () => store);

import {
  applySessionReferencesToTurn,
  publishLiveSessions,
  referenceCandidates,
  referenceTarget,
} from "./sessionReferenceDirectory";

function chat(
  id: string,
  title: string,
  blocks: Block[],
  extra: Partial<Session> = {},
): Session {
  return {
    ...newSession("claude", "/Users/me/app"),
    id,
    title,
    blocks,
    ...extra,
  };
}

function summary(
  id: string,
  title: string,
  updatedAt: number,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id,
    cwd: "/Users/me/app",
    harness: "claude",
    model: "sonnet",
    runtimeMode: "default",
    title,
    createdAt: updatedAt - 1_000,
    updatedAt,
    ...extra,
  } as SessionSummary;
}

const asked: Block[] = [
  {
    id: "u1",
    role: "user",
    text: "Why does login redirect twice?",
    sentAt: 10,
  },
  { id: "a1", role: "assistant", text: "The guard runs on both routes." },
];

beforeEach(() => {
  store.listRecentSessions.mockReset().mockResolvedValue([]);
  store.getSession.mockReset().mockResolvedValue(null);
  publishLiveSessions([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("referenceCandidates", () => {
  it("merges saved and open chats, newest first, and skips the current one", () => {
    const running = chat(
      "bbbbbbbb-0000-4000-8000-000000000000",
      "Refactor auth",
      asked,
      { busy: true },
    );
    const candidates = referenceCandidates(
      [
        summary("aaaaaaaa-0000-4000-8000-000000000000", "Old chat", 100),
        summary("bbbbbbbb-0000-4000-8000-000000000000", "Refactor auth", 50),
        summary("cccccccc-0000-4000-8000-000000000000", "Current", 900),
        summary("dddddddd-0000-4000-8000-000000000000", "Archived", 800, {
          archived: true,
        }),
      ],
      [running],
      "cccccccc-0000-4000-8000-000000000000",
      5_000,
    );
    expect(candidates.map((candidate) => candidate.title)).toEqual([
      "Refactor auth",
      "Old chat",
    ]);
    expect(candidates[0]).toMatchObject({
      busy: true,
      live: true,
      updatedAt: 5_000,
    });
    expect(candidates[1]).toMatchObject({ busy: false, live: false });
  });

  it("leaves out open chats nobody has written in yet", () => {
    const blank = chat("eeeeeeee-0000-4000-8000-000000000000", "New", []);
    const inbox = chat("ffffffff-0000-4000-8000-000000000000", "Ask", asked, {
      inboxAsk: true,
    });
    expect(referenceCandidates([], [blank, inbox], undefined)).toEqual([]);
  });
});

describe("referenceTarget", () => {
  it("compares against the open chat's worktree", () => {
    const current = chat("12345678-0000-4000-8000-000000000000", "Here", [], {
      worktreeCwd: "/Users/me/app-wt",
    });
    publishLiveSessions([current]);
    expect(
      referenceTarget({
        sessionId: current.id,
        harness: "codex",
        cwd: "/Users/me/app-wt",
      }),
    ).toEqual({
      sessionId: current.id,
      harness: "codex",
      cwd: "/Users/me/app",
      worktreeCwd: "/Users/me/app-wt",
    });
  });
});

describe("applySessionReferencesToTurn", () => {
  const context = {
    sessionId: "99999999-0000-4000-8000-000000000000",
    harness: "claude" as const,
    cwd: "/Users/me/app",
  };

  it("leaves the prompt alone when nothing was referenced", async () => {
    await expect(
      applySessionReferencesToTurn("plain", "plain prepared", context),
    ).resolves.toBe("plain prepared");
    expect(store.listRecentSessions).not.toHaveBeenCalled();
  });

  it("reads a running chat from memory, including its newest reply", async () => {
    const running = chat(
      "a1a1a1a1-0000-4000-8000-000000000000",
      "Fix login redirect",
      [...asked, { id: "a1b", role: "assistant", text: " Still checking…" }],
      { busy: true },
    );
    publishLiveSessions([running]);
    const typed = "Use what we found @session/fix-login-redirect-a1a1a1a1";
    const prompt = await applySessionReferencesToTurn(typed, typed, context);
    expect(prompt.startsWith(typed)).toBe(true);
    expect(prompt).toContain('ref="@session/fix-login-redirect-a1a1a1a1"');
    expect(prompt).toContain('status="running"');
    expect(prompt).toContain("Why does login redirect twice?");
    expect(prompt).toContain("Still checking…");
    expect(store.getSession).not.toHaveBeenCalled();
  });

  it("loads a saved chat from the store by its short id", async () => {
    const saved = chat(
      "b2b2b2b2-0000-4000-8000-000000000000",
      "Billing export",
      [
        { id: "u1", role: "user", text: "Export invoices as CSV" },
        { id: "a1", role: "assistant", text: "Added an export button." },
        { id: "u2", role: "user", text: "Now add a date filter" },
        { id: "a2", role: "assistant", text: "Filter added." },
      ],
      { harness: "codex", cwd: "/Users/me/billing" },
    );
    store.listRecentSessions.mockResolvedValue([
      summary(saved.id, saved.title, 1_000, {
        harness: "codex",
        cwd: "/Users/me/billing",
      }),
    ]);
    store.getSession.mockResolvedValue(saved);
    const typed = "Do the same here @session/billing-export-b2b2b2b2#3";
    const prompt = await applySessionReferencesToTurn(typed, typed, context);
    expect(store.listRecentSessions).toHaveBeenCalledWith(2, "b2b2b2b2");
    expect(prompt).toContain("Now add a date filter");
    expect(prompt).not.toContain("Export invoices as CSV");
    expect(prompt).toMatch(/different project/i);
    expect(prompt).toMatch(/different agent/i);
  });

  it("only expands references the user typed", async () => {
    const running = chat(
      "c3c3c3c3-0000-4000-8000-000000000000",
      "Notes chat",
      asked,
    );
    publishLiveSessions([running]);
    const prepared =
      "hi\n\n---\nNote body mentions @session/notes-chat-c3c3c3c3";
    await expect(
      applySessionReferencesToTurn("hi", prepared, context),
    ).resolves.toBe(prepared);
  });
});

describe("insertSessionReference", () => {
  const target = "d4d4d4d4-0000-4000-8000-000000000000";

  afterEach(() => setComposerDraft(target, ""));

  it("falls back to the saved draft when no composer takes it", () => {
    setComposerDraft(target, "Compare with");
    insertSessionReference(target, "session/billing-export-b2b2b2b2");
    expect(getComposerDraft(target)).toBe(
      "Compare with @session/billing-export-b2b2b2b2 ",
    );
  });

  it("leaves the draft to a mounted composer that handles it", () => {
    const events = new EventTarget();
    events.addEventListener(INSERT_SESSION_REFERENCE_EVENT, (event) => {
      (event as CustomEvent<InsertSessionReferenceRequest>).detail.handled =
        true;
    });
    vi.stubGlobal("window", events);
    insertSessionReference(target, "session/billing-export-b2b2b2b2");
    expect(getComposerDraft(target)).toBeUndefined();
  });
});
