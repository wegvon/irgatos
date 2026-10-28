import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import {
  filterGoalViews,
  goalForSession,
  goalView,
  sortGoalViews,
  syncGoals,
  type Goal,
} from "./goals";
import { parseGoals, pruneGoals } from "./goalStore";

const NOW = 1_000_000;

function chat(id: string, cwd = "/repo", patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", cwd), id, title: "claude", ...patch };
}

function sent(text: string, at = NOW - 5_000, patch: Partial<Block> = {}): Block {
  return { id: `u-${text}`, role: "user", text, startedAt: at, durationMs: 1_000, ...patch };
}

let ids = 0;
const options = (patch = {}) => ({ now: NOW, newId: () => `goal-${++ids}`, ...patch });

describe("syncGoals", () => {
  it("starts one goal per root conversation from its first request", () => {
    const goals = syncGoals(
      [],
      [chat("a", "/repo", { blocks: [sent("Fix the Safari export button\nIt does nothing")] })],
      options(),
    );
    expect(goals).toHaveLength(1);
    expect(goals[0].title).toBe("Fix the Safari export button");
    expect(goals[0].request).toContain("It does nothing");
    expect(goals[0].links.map((link) => [link.sessionId, link.role])).toEqual([["a", "main"]]);
  });

  it("leaves blank tabs, drafts, Irgat chats and app prompts alone", () => {
    const sessions = [
      chat("blank"),
      chat("draft", "/repo", { blocks: [sent("later", NOW, { draft: true })] }),
      chat("irgat", "/repo", { blocks: [sent("hello")] }),
      chat("internal", "/repo", { blocks: [sent("keep going", NOW, { internal: true })] }),
      chat("habit", "/repo", { ephemeral: true, blocks: [sent("run")] }),
    ];
    const goals = syncGoals([], sessions, options({ excluded: new Set(["irgat"]) }));
    expect(goals).toEqual([]);
  });

  it("puts orchestration workers and forks under their starter's goal", () => {
    const lead = chat("lead", "/repo", { blocks: [sent("Ship the redesign")] });
    const worker = chat("w1", "/repo", {
      orchestrationLeadId: "lead",
      blocks: [sent("Build the header")],
    });
    const fork = chat("fork", "/repo", {
      blocks: [
        { id: "f", role: "system", text: "", forkPoint: { fromSessionId: "lead", fromTitle: "x" } },
        sent("Try another layout"),
      ],
    });
    // Children listed first must still land under the lead.
    const goals = syncGoals([], [worker, fork, lead], options());
    expect(goals).toHaveLength(1);
    expect(
      goals[0].links.map((link) => [link.sessionId, link.role]).sort(),
    ).toEqual([
      ["fork", "fork"],
      ["lead", "main"],
      ["w1", "worker"],
    ]);
  });

  it("keeps the goal when the conversation switches provider or closes", () => {
    const session = chat("a", "/repo", { blocks: [sent("Add dark mode")] });
    const first = syncGoals([], [session], options());
    const switched = syncGoals(first, [{ ...session, harness: "codex" }], options());
    expect(switched[0].id).toBe(first[0].id);
    expect(switched[0].links[0].harness).toBe("codex");
    const closed = syncGoals(switched, [], options());
    expect(closed).toBe(switched);
    expect(goalForSession(closed, "a")?.id).toBe(first[0].id);
  });

  it("follows the chat's generated name until the user renames the goal", () => {
    const session = chat("a", "/repo", { blocks: [sent("pls fix the thing on safari")] });
    const first = syncGoals([], [session], options());
    expect(first[0].title).toBe("pls fix the thing on safari");
    const named = syncGoals(first, [{ ...session, title: "claude · Fix Safari export" }], options());
    expect(named[0].title).toBe("Fix Safari export");
    const renamed = [{ ...named[0], title: "Mine", autoTitle: undefined }];
    expect(syncGoals(renamed, [{ ...session, title: "claude · Other" }], options())[0].title).toBe("Mine");
  });

  it("returns the same list when nothing changed", () => {
    const session = chat("a", "/repo", { blocks: [sent("Add dark mode")] });
    const first = syncGoals([], [session], options());
    expect(syncGoals(first, [session], options())).toBe(first);
  });

  it("joins a pre-linked conversation to its goal instead of starting one", () => {
    const first = syncGoals([], [chat("a", "/repo", { blocks: [sent("Add dark mode")] })], options());
    const linked: Goal[] = [
      {
        ...first[0],
        links: [
          ...first[0].links,
          { sessionId: "b", role: "chat", addedAt: NOW, title: "", harness: "claude", workCwd: "/repo" },
        ],
      },
    ];
    const next = syncGoals(linked, [chat("b", "/repo", { blocks: [sent("Continue")] })], options());
    expect(next).toHaveLength(1);
    expect(next[0].links.find((link) => link.sessionId === "b")?.role).toBe("chat");
  });
});

describe("goalView", () => {
  const base = (sessions: Session[]) => {
    const goals = syncGoals([], sessions, options());
    return { goal: goals[0], byId: new Map(sessions.map((s) => [s.id, s])) };
  };

  it("surfaces a worker's approval as the goal's decision", () => {
    const lead = chat("lead", "/repo", { blocks: [sent("Ship it")] });
    const worker = chat("w", "/repo", {
      orchestrationLeadId: "lead",
      blocks: [
        sent("Run tests"),
        {
          id: "ask",
          role: "tool",
          text: "Run",
          tool: { kind: "execute", status: "pending", preview: { kind: "shell", query: "npm test" } },
          approval: { requestId: 3 },
        },
      ],
    });
    const { goal, byId } = base([lead, worker]);
    const view = goalView(goal, byId, { now: NOW });
    expect(view.state).toBe("needsYou");
    expect(view.requests).toHaveLength(1);
    expect(view.requests[0].sessionId).toBe("w");
    expect(view.progress).toEqual({ done: 0, total: 1, source: "workers" });
  });

  it("counts the agent's own steps and collects results", () => {
    const lead = chat("lead", "/repo", {
      branch: "feat/x",
      worktreeCwd: "/repo-wt",
      linkedWorkItem: { kind: "pr", repo: "o/r", number: 4, url: "https://github.com/o/r/pull/4" },
      blocks: [
        sent("Ship it"),
        {
          id: "t",
          role: "tasks",
          text: "",
          taskList: {
            items: [
              { text: "a", status: "completed" },
              { text: "b", status: "in_progress" },
              { text: "c", status: "cancelled" },
            ],
          },
        },
        {
          id: "e",
          role: "tool",
          text: "Edit",
          tool: { kind: "edit", status: "completed", preview: { kind: "write", path: "/repo-wt/a.ts" } },
        },
      ],
    });
    const { goal, byId } = base([lead]);
    const view = goalView(goal, byId, { now: NOW });
    expect(view.progress).toEqual({ done: 1, total: 2, source: "steps" });
    expect(view.editedPaths).toEqual(["/repo-wt/a.ts"]);
    expect(view.pullRequests.map((pr) => pr.number)).toEqual([4]);
    expect(view.branches).toEqual(["feat/x"]);
    expect(view.worktrees).toEqual(["/repo-wt"]);
    expect(view.state).toBe("review");
  });

  it("shows closed conversations from their snapshot and honors done", () => {
    const { goal } = base([chat("a", "/repo", { blocks: [sent("Ship it")] })]);
    const view = goalView({ ...goal, doneAt: NOW }, new Map(), { now: NOW });
    expect(view.state).toBe("done");
    expect(view.members[0]).toMatchObject({ open: false, status: "closed" });
  });

  it("sorts what needs the user first and filters by text", () => {
    const a = goalView({ ...base([chat("a", "/r", { blocks: [sent("Alpha")] })]).goal, doneAt: 1 }, new Map());
    const b = goalView(base([chat("b", "/r", { busy: true, blocks: [sent("Beta")] })]).goal, new Map([["b", chat("b", "/r", { busy: true, blocks: [sent("Beta")] })]]));
    expect(sortGoalViews([a, b]).map((view) => view.goal.title)).toEqual(["Beta", "Alpha"]);
    expect(filterGoalViews([a, b], "alp").map((view) => view.goal.title)).toEqual(["Alpha"]);
  });
});

describe("goal storage", () => {
  it("drops malformed entries and keeps the rest", () => {
    const parsed = parseGoals([
      null,
      { id: "x" },
      {
        id: "g",
        cwd: "/r",
        title: "T",
        request: "R",
        createdAt: 1,
        updatedAt: 2,
        links: [{ sessionId: "s", harness: "claude", role: "worker" }, { sessionId: "bad", harness: "nope" }],
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].links).toEqual([
      { sessionId: "s", role: "worker", addedAt: 0, title: "", harness: "claude", workCwd: "" },
    ]);
  });

  it("forgets only the oldest finished goals", () => {
    const goals: Goal[] = Array.from({ length: 205 }, (_, index) => ({
      id: `g${index}`,
      title: "t",
      request: "",
      cwd: "/r",
      createdAt: 0,
      updatedAt: 0,
      doneAt: index + 1,
      links: [],
    }));
    goals.push({ ...goals[0], id: "open", doneAt: undefined });
    const kept = pruneGoals(goals);
    expect(kept).toHaveLength(201);
    expect(kept.some((goal) => goal.id === "g0")).toBe(false);
    expect(kept.some((goal) => goal.id === "open")).toBe(true);
  });
});
