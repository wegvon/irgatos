// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  invoke: invokeMock,
}));

import type { SessionSummary } from "../../sessions/data/sessionStore";
import { formatSessionTitle, type Session } from "../../sessions/model/session";
import {
  freeChatBadge,
  freeChatDisplayTitle,
  freeChatRows,
  isFreeChatCwd,
  isFreeChatSession,
  loadFreeChatView,
  newFreeChatSession,
  resetFreeChatDirForTest,
  resolveFreeChatDir,
  saveFreeChatView,
} from "./freeChat";

const DIR = "/Users/turel/.irgatos/scratch";

function summary(id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    cwd: DIR,
    harness: "claude",
    model: "sonnet",
    runtimeMode: "supervised",
    title: formatSessionTitle("claude", `Chat ${id}`),
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function live(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    cwd: DIR,
    harness: "claude",
    model: "sonnet",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "claude",
    blocks: [],
    ...extra,
  };
}

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  invokeMock.mockReset();
  resetFreeChatDirForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("free chat detection", () => {
  it("recognises the scratch folder on every platform spelling", () => {
    expect(isFreeChatCwd(DIR)).toBe(true);
    expect(isFreeChatCwd(`${DIR}/`)).toBe(true);
    expect(isFreeChatCwd("C:\\Users\\turel\\.irgatos\\scratch")).toBe(true);
    expect(isFreeChatCwd("/tmp/.irgatos/scratch")).toBe(true);
    expect(isFreeChatCwd("/Users/turel/projects/irgatos")).toBe(false);
    expect(isFreeChatCwd("/Users/turel/.irgatos/scratch-notes")).toBe(false);
    expect(isFreeChatCwd("~")).toBe(false);
    expect(isFreeChatCwd(undefined)).toBe(false);
    expect(isFreeChatSession({ cwd: DIR })).toBe(true);
    expect(isFreeChatSession(null)).toBe(false);
  });

  it("starts a chat in the scratch folder without a worktree", () => {
    const session = newFreeChatSession(DIR, "full-access");
    expect(session.cwd).toBe(DIR);
    expect(session.runtimeMode).toBe("full-access");
    expect(session.workspaceMode).toBe("current");
    expect(session.blocks).toEqual([]);
    expect(freeChatDisplayTitle(session.title, session.harness)).toBe("New chat");
  });

  it("asks the backend for the scratch folder once and retries after a failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no disk"));
    await expect(resolveFreeChatDir()).rejects.toThrow("no disk");
    invokeMock.mockResolvedValue(DIR);
    await expect(resolveFreeChatDir()).resolves.toBe(DIR);
    await expect(resolveFreeChatDir()).resolves.toBe(DIR);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledWith("free_chat_scratch_dir");
  });
});

describe("free chat list", () => {
  it("keeps project sessions and archived chats out", () => {
    const rows = freeChatRows({
      stored: [
        summary("a"),
        summary("project", { cwd: "/Users/turel/projects/app" }),
        summary("old", { archived: true }),
      ],
      live: [live("open-project", { cwd: "/Users/turel/projects/app" })],
    });
    expect(rows.map((row) => row.id)).toEqual(["a"]);
    expect(rows[0].title).toBe("Chat a");
  });

  it("orders pinned, then blank drafts, then most recent", () => {
    const rows = freeChatRows({
      stored: [
        summary("older", { updatedAt: 10 }),
        summary("newer", { updatedAt: 20 }),
        summary("pinned", { updatedAt: 1, pinned: true }),
      ],
      live: [live("draft")],
      now: 5,
    });
    expect(rows.map((row) => row.id)).toEqual(["pinned", "draft", "newer", "older"]);
    expect(rows[1]).toMatchObject({ blank: true, title: "New chat" });
  });

  it("reports what each chat is waiting on, and prefers the live title", () => {
    const approval = live("approval", {
      title: formatSessionTitle("claude", "Renamed live"),
      blocks: [
        {
          id: "b",
          role: "tool",
          text: "",
          approval: { requestId: "r", decided: false },
        } as unknown as Session["blocks"][number],
      ],
    });
    const rows = freeChatRows({
      stored: [summary("approval"), summary("busy"), summary("done"), summary("quiet")],
      live: [approval, live("busy", { busy: true, blocks: [] })],
      unseen: new Set(["done"]),
    });
    const state = Object.fromEntries(rows.map((row) => [row.id, row.state]));
    expect(state).toEqual({
      approval: "needs-input",
      busy: "running",
      done: "unread",
      quiet: "idle",
    });
    expect(rows.find((row) => row.id === "approval")?.title).toBe("Renamed live");
    expect(freeChatBadge(rows)).toEqual({ count: 1, tone: "attention" });
    expect(
      freeChatBadge(rows.filter((row) => row.state !== "needs-input")),
    ).toEqual({ count: 1, tone: "unread" });
    expect(freeChatBadge([])).toEqual({ count: 0, tone: "none" });
  });

  it("filters by title", () => {
    const rows = freeChatRows({
      stored: [
        summary("a", { title: formatSessionTitle("claude", "Tax question") }),
        summary("b", { title: formatSessionTitle("claude", "Recipe") }),
      ],
      live: [],
      query: "  tax ",
    });
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });
});

describe("free chat view state", () => {
  it("round-trips and tolerates junk", () => {
    expect(loadFreeChatView()).toEqual({ open: false });
    saveFreeChatView({ open: true, activeId: "a" });
    expect(loadFreeChatView()).toEqual({ open: true, activeId: "a" });
    localStorage.setItem("irgatos:freechat:v1", JSON.stringify({ open: "yes", activeId: 3 }));
    expect(loadFreeChatView()).toEqual({ open: false });
  });
});
