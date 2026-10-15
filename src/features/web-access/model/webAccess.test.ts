import { describe, expect, it, vi } from "vitest";
import {
  newSession,
  type Block,
  type Session,
} from "../../sessions/model/session";
import type { UserQuestionPrompt } from "../../sessions/model/userQuestion";
import {
  WEB_TRANSCRIPT_LIMIT,
  handleWebAccess,
  type WebAccessDeps,
} from "./webAccess";

function chat(id: string, patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/Users/me/code/shop"),
    id,
    title: "Fix the login form",
    ...patch,
  };
}

const sent: Block = {
  id: "u1",
  role: "user",
  text: "Run the tests",
  startedAt: 1_000,
};

const approval: Block = {
  id: "ask-7",
  role: "tool",
  text: "Run a command",
  tool: {
    kind: "execute",
    status: "pending",
    preview: { kind: "shell", query: "npm test" },
  },
  approval: { requestId: 7 },
};

const question: UserQuestionPrompt = {
  requestId: 9,
  questions: [
    {
      id: "db",
      prompt: "Which database?",
      multiSelect: false,
      allowCustom: true,
      options: [
        { id: "redis", label: "Redis" },
        { id: "sqlite", label: "SQLite" },
      ],
    },
  ],
};

function deps(sessions: Session[]): WebAccessDeps {
  return {
    sessions: () => sessions,
    submit: vi.fn(() => true),
    approve: vi.fn(),
    answer: vi.fn(),
    stop: vi.fn(),
  };
}

describe("handleWebAccess", () => {
  it("lists open chats the way Fleet groups them", () => {
    const waiting = chat("a", { blocks: [sent, approval], busy: true });
    const running = chat("b", { blocks: [sent], busy: true });
    const blank = chat("c");
    const overview = handleWebAccess(
      deps([waiting, running, blank]),
      "overview",
      {},
    ) as Record<string, { sessionId: string }[]>;
    expect(overview.needsYou.map((entry) => entry.sessionId)).toEqual(["a"]);
    expect(overview.running.map((entry) => entry.sessionId)).toEqual(["b"]);
    expect(overview.idle).toEqual([]);
  });

  it("returns the newest messages without internal turns", () => {
    const blocks: Block[] = Array.from(
      { length: WEB_TRANSCRIPT_LIMIT + 5 },
      (_, index) => ({
        id: `m${index}`,
        role: "assistant",
        text: `reply ${index}`,
      }),
    );
    blocks.push({ id: "hidden", role: "user", text: "nudge", internal: true });
    const result = handleWebAccess(deps([chat("a", { blocks })]), "session", {
      id: "a",
    }) as { blocks: { id: string }[]; omitted: number };
    expect(result.blocks).toHaveLength(WEB_TRANSCRIPT_LIMIT);
    expect(result.omitted).toBe(5);
    expect(result.blocks.at(-1)?.id).toBe(`m${WEB_TRANSCRIPT_LIMIT + 4}`);
  });

  it("sends a message into the chat", () => {
    const d = deps([chat("a")]);
    expect(
      handleWebAccess(d, "send", { sessionId: "a", text: "  hello  " }),
    ).toEqual({ sent: true });
    expect(d.submit).toHaveBeenCalledWith("a", "hello");
    expect(() =>
      handleWebAccess(d, "send", { sessionId: "a", text: "   " }),
    ).toThrow("Write a message first.");
    expect(() =>
      handleWebAccess(d, "send", { sessionId: "zzz", text: "hi" }),
    ).toThrow("not open");
  });

  it("decides only approvals that are still open", () => {
    const d = deps([chat("a", { blocks: [sent, approval] })]);
    handleWebAccess(d, "approval", {
      sessionId: "a",
      requestId: 7,
      decision: "allow",
    });
    expect(d.approve).toHaveBeenCalledWith("a", 7, "allow");
    expect(() =>
      handleWebAccess(d, "approval", {
        sessionId: "a",
        requestId: 8,
        decision: "allow",
      }),
    ).toThrow("already answered");
    expect(() =>
      handleWebAccess(d, "approval", {
        sessionId: "a",
        requestId: 7,
        decision: "maybe",
      }),
    ).toThrow("allow or deny");
  });

  it("answers the open question", () => {
    const d = deps([chat("a", { blocks: [sent], pendingQuestion: question })]);
    handleWebAccess(d, "answer", {
      sessionId: "a",
      requestId: 9,
      answers: { db: ["sqlite"] },
    });
    expect(d.answer).toHaveBeenCalledWith("a", 9, {
      kind: "answered",
      answers: { db: ["sqlite"] },
    });
    handleWebAccess(d, "answer", { sessionId: "a", requestId: 9, skip: true });
    expect(d.answer).toHaveBeenLastCalledWith("a", 9, { kind: "skipped" });
    expect(() =>
      handleWebAccess(d, "answer", { sessionId: "a", requestId: 3 }),
    ).toThrow("already answered");
  });

  it("stops only a running chat", () => {
    const d = deps([chat("a", { busy: true }), chat("b")]);
    expect(handleWebAccess(d, "stop", { sessionId: "a" })).toEqual({
      stopped: true,
    });
    expect(handleWebAccess(d, "stop", { sessionId: "b" })).toEqual({
      stopped: false,
    });
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown actions", () => {
    expect(() => handleWebAccess(deps([]), "delete", {})).toThrow(
      "Unknown action",
    );
  });
});
