import { describe, expect, it } from "vitest";
import {
  REVIEW_WINDOW_MS,
  buildFleet,
  countNeedsYou,
  fleetActivity,
  fleetEntry,
  fleetRequests,
  filterFleet,
} from "./fleet";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import type { UserQuestionPrompt } from "../../sessions/model/userQuestion";

const NOW = 10 * REVIEW_WINDOW_MS;

function chat(cwd: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", cwd), title: "Fix the login form", ...patch };
}

function sent(at: number, text = "Do the thing"): Block {
  return { id: `u-${at}`, role: "user", text, startedAt: at, durationMs: 1_000 };
}

function edit(path: string): Block {
  return {
    id: `edit-${path}`,
    role: "tool",
    text: `Edit ${path}`,
    tool: { kind: "edit", status: "completed", preview: { kind: "write", path } },
  };
}

function shellApproval(requestId: number, command: string): Block {
  return {
    id: `ask-${requestId}`,
    role: "tool",
    text: "Run a command",
    tool: {
      kind: "execute",
      status: "pending",
      preview: { kind: "shell", query: command },
    },
    approval: { requestId },
  };
}

const question: UserQuestionPrompt = {
  requestId: 9,
  title: "Pick a database",
  questions: [
    {
      id: "db",
      prompt: "Which database should the cache use?",
      multiSelect: false,
      allowCustom: true,
      options: [
        { id: "redis", label: "Redis" },
        { id: "sqlite", label: "SQLite" },
      ],
    },
  ],
};

describe("fleetRequests", () => {
  it("lists undecided approvals with their exact command, then the open question", () => {
    const session = chat("/repo/a", {
      blocks: [
        sent(NOW),
        { ...shellApproval(1, "rm -rf build"), approval: { requestId: 1, decided: "allow" } },
        shellApproval(2, "npm publish --tag next"),
      ],
      pendingQuestion: question,
    });
    const requests = fleetRequests(session);
    expect(requests.map((request) => [request.kind, request.requestId])).toEqual([
      ["approval", 2],
      ["question", 9],
    ]);
    expect(requests[0]).toMatchObject({ detail: "npm publish --tag next" });
  });

  it("asks nothing of a session whose worktree was deleted", () => {
    const session = chat("/repo/a", {
      worktreeRemoved: true,
      blocks: [sent(NOW), shellApproval(1, "ls")],
    });
    expect(fleetRequests(session)).toEqual([]);
  });

  it("truncates a very long command", () => {
    const session = chat("/repo/a", {
      blocks: [sent(NOW), shellApproval(1, "x".repeat(1_000))],
    });
    const [request] = fleetRequests(session);
    expect(request.kind === "approval" && request.detail?.length).toBe(400);
  });
});

describe("fleetEntry", () => {
  it("puts a waiting session in Needs you even while its turn is busy", () => {
    const entry = fleetEntry(
      chat("/repo/a", { busy: true, blocks: [sent(NOW), shellApproval(1, "ls")] }),
      { now: NOW },
    );
    expect(entry?.bucket).toBe("needsYou");
  });

  it("reports what a running session is doing", () => {
    const session = chat("/repo/a", {
      busy: true,
      blocks: [
        sent(NOW),
        {
          id: "t",
          role: "tool",
          text: "Run tests",
          tool: { kind: "execute", status: "in_progress", preview: { kind: "shell", query: "npm test" } },
        },
      ],
    });
    const entry = fleetEntry(session, { now: NOW });
    expect(entry?.bucket).toBe("running");
    expect(entry?.activity).toBe(fleetActivity(session));
    expect(entry?.activity).not.toBe("Working");
  });

  it("offers a recently finished turn with edits for review, and lets it go idle later", () => {
    const session = chat("/repo/a", {
      blocks: [sent(NOW - 60_000), edit("/repo/a/src/login.ts")],
    });
    const recent = fleetEntry(session, { now: NOW });
    expect(recent?.bucket).toBe("review");
    expect(recent?.editedPaths).toEqual(["/repo/a/src/login.ts"]);
    expect(fleetEntry(session, { now: NOW + REVIEW_WINDOW_MS })?.bucket).toBe("idle");
    expect(
      fleetEntry(session, {
        now: NOW + REVIEW_WINDOW_MS,
        unseenFinishedIds: new Set([session.id]),
      }),
    ).toMatchObject({ bucket: "review", unseen: true });
  });

  it("counts saved artifacts as something to review", () => {
    const session = chat("/repo/a", {
      blocks: [
        sent(NOW - 1_000),
        {
          id: "reply",
          role: "assistant",
          text: "Saved the report.",
          artifactCards: [{ id: "a1" } as never],
        },
      ],
    });
    expect(fleetEntry(session, { now: NOW })).toMatchObject({
      bucket: "review",
      artifacts: 1,
    });
  });

  it("keeps a finished turn without changes idle", () => {
    const session = chat("/repo/a", {
      blocks: [sent(NOW - 1_000), { id: "r", role: "assistant", text: "Done." }],
    });
    expect(fleetEntry(session, { now: NOW })?.bucket).toBe("idle");
  });

  it("offers an unread reply without changes for review, chats included", () => {
    const reply = { id: "r", role: "assistant", text: "Hello!" } as const;
    const project = chat("/repo/a", { id: "p", blocks: [sent(1, "hello"), reply] });
    const freeChat = chat("/Users/me/.irgatos/scratch", {
      id: "c",
      blocks: [sent(1, "hello"), reply],
    });
    const fleet = buildFleet([project, freeChat], {
      now: NOW,
      unseenFinishedIds: new Set(["p", "c"]),
    });
    expect(fleet.review.map((entry) => entry.sessionId).sort()).toEqual(["c", "p"]);
    expect(fleet.review.find((entry) => entry.sessionId === "c")).toMatchObject({ chat: true, projectLabel: "Chat" });
    expect(fleet.idle).toEqual([]);
    expect(fleetEntry(project, { now: NOW })?.bucket).toBe("idle");
  });

  it("lists a session that stopped mid-turn as Interrupted, not Idle", () => {
    const session = chat("/repo/a", {
      blocks: [sent(NOW - 1_000), { id: "r", role: "assistant", text: "Half" }],
    });
    expect(
      fleetEntry(session, { now: NOW, interruptedIds: new Set([session.id]) })
        ?.bucket,
    ).toBe("interrupted");
    expect(
      fleetEntry(
        { ...session, busy: true },
        { now: NOW, interruptedIds: new Set([session.id]) },
      )?.bucket,
    ).toBe("running");
  });

  it("skips blank tabs, Inbox asks, hidden habit runs, and quiet workers", () => {
    expect(fleetEntry(chat("/repo/a"))).toBeNull();
    expect(fleetEntry(chat("/repo/a", { ephemeral: true, busy: true }))).toBeNull();
    expect(
      fleetEntry(chat("/repo/a", { inboxAsk: {} as never, blocks: [sent(NOW)] })),
    ).toBeNull();
    const worker = chat("/repo/a", { orchestrationLeadId: "lead", busy: true, blocks: [sent(NOW)] });
    expect(fleetEntry(worker)).toBeNull();
    expect(
      fleetEntry({ ...worker, blocks: [sent(NOW), shellApproval(3, "ls")] }),
    ).toMatchObject({ bucket: "needsYou", leadId: "lead" });
  });

  it("labels worktree sessions and Irgat chats", () => {
    const entry = fleetEntry(
      chat("/repo/a", {
        worktreeCwd: "/repo/a-wt/feature",
        branch: "feature",
        blocks: [sent(NOW)],
      }),
      { now: NOW, irgatName: () => "Ada" },
    );
    expect(entry).toMatchObject({
      worktree: true,
      workCwd: "/repo/a-wt/feature",
      branch: "feature",
      irgat: "Ada",
      projectLabel: "Ada",
    });
  });

  it("lists project-free chats under Chat, without a branch", () => {
    const entry = fleetEntry(
      chat("/Users/me/.irgatos/scratch", {
        branch: "main",
        busy: true,
        blocks: [sent(NOW)],
      }),
      { now: NOW, projectLabel: () => "scratch" },
    );
    expect(entry).toMatchObject({
      chat: true,
      projectLabel: "Chat",
      bucket: "running",
    });
    expect(entry?.branch).toBeUndefined();
    expect(
      fleetEntry(chat("/repo/a", { blocks: [sent(NOW)] }), { now: NOW })?.chat,
    ).toBeUndefined();
  });
});

describe("buildFleet", () => {
  it("groups every project's sessions and orders each bucket", () => {
    const oldAsk = chat("/repo/a", { id: "old-ask", blocks: [sent(NOW - 5_000), shellApproval(1, "ls")] });
    const newAsk = chat("/repo/b", { id: "new-ask", blocks: [sent(NOW - 1_000)], pendingQuestion: question });
    const seenReview = chat("/repo/a", { id: "seen", blocks: [sent(NOW - 1_000), edit("/repo/a/x.ts")] });
    const unseenReview = chat("/repo/b", { id: "unseen", blocks: [sent(NOW - 9_000), edit("/repo/b/y.ts")] });
    const running = chat("/repo/c", { id: "running", busy: true, blocks: [sent(NOW)] });
    const idle = chat("/repo/c", { id: "idle", blocks: [sent(1)] });
    const fleet = buildFleet(
      [newAsk, oldAsk, seenReview, unseenReview, running, idle, running],
      { now: NOW, unseenFinishedIds: new Set(["unseen"]) },
    );
    expect(fleet.needsYou.map((entry) => entry.sessionId)).toEqual(["old-ask", "new-ask"]);
    expect(fleet.review.map((entry) => entry.sessionId)).toEqual(["unseen", "seen"]);
    expect(fleet.running.map((entry) => entry.sessionId)).toEqual(["running"]);
    expect(fleet.idle.map((entry) => entry.sessionId)).toEqual(["idle"]);
    expect(fleet.needsYouCount).toBe(2);
    expect(fleet.total).toBe(6);
    expect(countNeedsYou([newAsk, oldAsk, seenReview, running])).toBe(2);
  });

  it("filters rows by title, project, command, and question text", () => {
    const fleet = buildFleet(
      [
        chat("/repo/api", { id: "a", title: "Ship billing", blocks: [sent(NOW), shellApproval(1, "stripe login")] }),
        chat("/repo/web", { id: "b", title: "Tidy CSS", blocks: [sent(NOW)], pendingQuestion: question }),
        chat("/repo/web", { id: "c", title: "Write docs", busy: true, blocks: [sent(NOW)] }),
      ],
      { now: NOW },
    );
    const ids = (query: string) => {
      const filtered = filterFleet(fleet, query);
      return [...filtered.needsYou, ...filtered.review, ...filtered.running, ...filtered.idle].map(
        (entry) => entry.sessionId,
      );
    };
    expect(ids("stripe")).toEqual(["a"]);
    expect(ids("CACHE use")).toEqual(["b"]);
    expect(ids("web")).toEqual(["b", "c"]);
    expect(ids("  ")).toEqual(["a", "b", "c"]);
    expect(filterFleet(fleet, "stripe")).toMatchObject({ total: 1, needsYouCount: 2 });
  });
});
