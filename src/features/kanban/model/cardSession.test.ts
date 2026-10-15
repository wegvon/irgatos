import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { kanbanProject } from "./kanban";
import {
  boardSessions,
  boardSyncBatches,
  cardSessionLabel,
  cardSessionView,
  liveCardSession,
  liveSessionAttention,
  liveSessionStatus,
  pendingCardApproval,
  type BoardSession,
  liveSessionsKey,
  projectActivity,
  type LiveCardSession,
  type LiveSessionLike,
} from "./cardSession";

let seq = 0;
function block(role: Block["role"], extra: Partial<Block> = {}): Block {
  seq += 1;
  return { id: `b${seq}`, role, text: "", ...extra };
}

function session(blocks: Block[], extra: Partial<LiveSessionLike> = {}): LiveSessionLike {
  return { busy: false, blocks, ...extra };
}

describe("liveSessionStatus", () => {
  it("treats a session without a sent turn as not started", () => {
    expect(liveSessionStatus(session([]))).toBe("draft");
    expect(liveSessionStatus(session([block("user", { draft: true })]))).toBe("draft");
  });

  it("reports running while busy and needs-input while waiting on the user", () => {
    const blocks = [block("user"), block("assistant")];
    expect(liveSessionStatus(session(blocks, { busy: true }))).toBe("running");
    expect(
      liveSessionStatus(
        session([...blocks, block("tool", { approval: { requestId: 1 } })], { busy: true }),
      ),
    ).toBe("needs-input");
  });

  it("reads how the last turn ended", () => {
    expect(liveSessionStatus(session([block("user"), block("assistant")]))).toBe("finished");
    expect(
      liveSessionStatus(session([block("user"), block("system", { notice: "error" })])),
    ).toBe("failed");
    expect(
      liveSessionStatus(session([block("user"), block("system", { notice: "interrupt" })])),
    ).toBe("stopped");
  });

  it("ignores notices from earlier turns and unsent drafts", () => {
    const blocks = [
      block("user"),
      block("system", { notice: "error" }),
      block("user"),
      block("assistant"),
      block("user", { draft: true }),
    ];
    expect(liveSessionStatus(session(blocks))).toBe("finished");
  });
});

describe("cardSessionView", () => {
  const live: LiveCardSession = { status: "running", title: "Live title", harness: "codex" };

  it("prefers the loaded session", () => {
    expect(
      cardSessionView({ id: "s", status: "failed", title: "Stored", saved: true }, live),
    ).toEqual({ state: "running", title: "Live title", harness: "codex", live: true });
  });

  it("shows a stale running state as interrupted", () => {
    for (const status of ["running", "needs-input"] as const) {
      expect(
        cardSessionView({ id: "s", status, title: "Stored", harness: "claude", saved: true }, undefined),
      ).toMatchObject({ state: "interrupted", harness: "claude", live: false });
    }
  });

  it("keeps the stored outcome and flags sessions that are gone", () => {
    expect(cardSessionView({ id: "s", status: "failed", saved: true }, undefined)).toMatchObject({
      state: "failed",
      title: "Untitled session",
    });
    expect(cardSessionView({ id: "s", saved: true }, undefined).state).toBe("finished");
    expect(cardSessionView({ id: "s", status: "finished", saved: false }, undefined).state).toBe(
      "missing",
    );
    expect(
      cardSessionView({ id: "s", harness: "not-a-harness", saved: true }, undefined).harness,
    ).toBeNull();
  });
});

describe("liveSessionsKey", () => {
  it("changes only when a shown field changes", () => {
    const a = new Map([["s", { status: "running", title: "T", harness: "claude" } as const]]);
    const b = new Map([["s", { status: "running", title: "T", harness: "claude" } as const]]);
    const c = new Map([["s", { status: "finished", title: "T", harness: "claude" } as const]]);
    expect(liveSessionsKey(a)).toBe(liveSessionsKey(b));
    expect(liveSessionsKey(a)).not.toBe(liveSessionsKey(c));
  });
});

describe("waiting on the user", () => {
  it("tells an approval from a question, and both mean needs-input", () => {
    const approval = session([block("user"), block("tool", { approval: { requestId: 1 } })], {
      busy: true,
    });
    const question = session([block("user")], {
      busy: true,
      pendingQuestion: { requestId: 2, questions: [] },
    });
    expect(liveSessionStatus(approval)).toBe("needs-input");
    expect(liveSessionStatus(question)).toBe("needs-input");
    expect(liveSessionAttention(approval)).toBe("approval");
    expect(liveSessionAttention(question)).toBe("question");
    expect(liveSessionAttention({ ...question, worktreeRemoved: true })).toBeUndefined();
  });

  it("labels the badge with the reason", () => {
    const live: LiveCardSession = {
      status: "needs-input",
      title: "T",
      harness: "claude",
      attention: "question",
    };
    const view = cardSessionView({ id: "s", saved: true }, live);
    expect(cardSessionLabel(view)).toBe("Waiting for answers");
    expect(cardSessionLabel({ ...view, attention: "approval" })).toBe("Need approval");
    expect(cardSessionLabel({ state: "needs-input" })).toBe("Needs input");
  });
});

describe("boardSyncBatches", () => {
  const entry = (extra: Partial<BoardSession>): BoardSession => ({
    status: "running",
    title: "T",
    harness: "codex",
    project: "/work/app",
    fileable: true,
    ...extra,
  });

  it("groups changes by project and skips blank tabs unless a card links them", () => {
    const sent = new Map<string, string>();
    const sessions = new Map([
      ["a", entry({})],
      ["blank", entry({ status: "draft", fileable: false })],
      ["linked", entry({ status: "draft", fileable: false })],
      ["api", entry({ project: "/work/api", status: "finished" })],
      ["nowhere", entry({ project: undefined })],
    ]);
    const batches = boardSyncBatches(sessions, new Set(["linked"]), sent);
    expect([...batches]).toEqual([
      [
        "/work/app",
        [
          { sessionId: "a", title: "T", status: "running" },
          { sessionId: "linked", title: "T", status: "draft" },
        ],
      ],
      ["/work/api", [{ sessionId: "api", title: "T", status: "finished" }]],
    ]);
    expect(boardSyncBatches(sessions, new Set(["linked"]), sent).size).toBe(0);
  });
});

describe("projectActivity with terminal agents", () => {
  const live = (project: string, status: LiveCardSession["status"]) =>
    ({ project, status }) as LiveCardSession;

  it("counts working and blocked terminal agents with other projects' sessions", () => {
    const sessions = new Map<string, LiveCardSession>([
      ["s1", live("/a", "running")],
      ["s2", live("/here", "needs-input")],
    ]);
    const activity = projectActivity(sessions, "/here", [
      { project: "/a", state: "blocked" },
      { project: "/b", state: "working" },
      { project: "/b", state: "idle" },
      { project: "/c", state: "done" },
      { project: "/here", state: "blocked" },
    ]);
    expect(activity).toEqual([
      { project: "/a", waiting: 1, running: 1 },
      { project: "/b", waiting: 0, running: 1 },
    ]);
  });

  it("matches the session-only result without terminal agents", () => {
    const sessions = new Map<string, LiveCardSession>([["s1", live("/a", "running")]]);
    expect(projectActivity(sessions, null)).toEqual(projectActivity(sessions, null, []));
  });
});

describe("project-free chats on the board", () => {
  const SCRATCH = "/Users/me/.irgatos/scratch";

  it("files a chat on the Chats board and flags it", () => {
    const chat = {
      ...newSession("claude", SCRATCH),
      title: "Explain monads",
      blocks: [block("user"), block("assistant")],
    };
    const work = { ...newSession("codex", "/repo/app"), blocks: [block("user")] };
    const board = boardSessions([chat, work]);
    expect(board.get(chat.id)).toMatchObject({
      chat: true,
      project: kanbanProject(SCRATCH),
      status: "finished",
      fileable: true,
    });
    expect(board.get(work.id)?.chat).toBeUndefined();
  });

  it("carries the oldest waiting permission so the card can answer it", () => {
    const chat = {
      ...newSession("claude", SCRATCH),
      busy: true,
      blocks: [
        block("user"),
        block("tool", { text: "Run ls", approval: { requestId: 7, decided: "allow" } }),
        block("tool", { text: "Run pwd", approval: { requestId: 8 } }),
      ],
    } as Session;
    const live = liveCardSession(chat);
    expect(live).toMatchObject({ status: "needs-input", attention: "approval" });
    expect(live.approval?.requestId).toBe(8);
    expect(pendingCardApproval({ ...chat, worktreeRemoved: true })).toBeUndefined();
    const key = liveSessionsKey(new Map([[chat.id, live]]));
    expect(key).not.toBe(
      liveSessionsKey(new Map([[chat.id, { ...live, approval: undefined }]])),
    );
  });
});
