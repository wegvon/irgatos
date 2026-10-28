import { describe, expect, it } from "vitest";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { goalView, syncGoals } from "./goals";
import { goalProgressSummary, progressHeadline } from "./progress";

const sent = (text: string): Block => ({ id: `u-${text}`, role: "user", text, startedAt: 10 });

function chat(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id, title: `claude · ${id}`, blocks: [sent(id)], ...patch };
}

function view(sessions: Session[]) {
  const [goal] = syncGoals([], sessions, { now: 100 });
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return { view: goalView(goal, byId, { now: 100 }), byId };
}

function task(id: string, patch: Partial<OrchestrationTask>): OrchestrationTask {
  return {
    id,
    sessionId: `w-${id}`,
    title: `Task ${id}`,
    harness: "claude",
    model: "m",
    prompt: "",
    files: [],
    scopes: [],
    dependsOn: [],
    status: "queued",
    accepted: false,
    result: "",
    delivered: false,
    ...patch,
  };
}

describe("goal progress", () => {
  it("uses the coordinator's task list across its workers", () => {
    const sessions = [
      chat("lead", { busy: true }),
      chat("w-a", { orchestrationLeadId: "lead" }),
      chat("w-b", { orchestrationLeadId: "lead", busy: true }),
    ];
    const { view: goal, byId } = view(sessions);
    const run = {
      leadId: "lead",
      status: "active",
      tasks: [
        task("a", { status: "completed", result: "Header rebuilt\nmore" }),
        task("b", { status: "running" }),
        task("c", { status: "queued", dependsOn: ["a"] }),
        task("d", { status: "failed", error: "Tests failed in auth.spec" }),
        task("e", { status: "cancelled" }),
      ],
    } as unknown as OrchestrationRun;
    const summary = goalProgressSummary(goal, byId, [run], 0);
    expect(summary.source).toBe("workers");
    expect(summary.done).toEqual([{ text: "Task a", sessionId: "w-a", detail: "Header rebuilt" }]);
    expect(summary.remaining.map((item) => [item.text, item.active ?? false, item.detail])).toEqual([
      ["Task b", true, undefined],
      ["Task c", false, "Waiting on earlier tasks"],
    ]);
    expect(summary.blocked).toEqual([{ text: "Task d", sessionId: "w-d", detail: "Tests failed in auth.spec" }]);
    expect(progressHeadline(summary)).toBe("1 done · 2 left · 1 stuck");
  });

  it("falls back to the main chat's steps and flags usage limits", () => {
    const sessions = [
      chat("main", {
        usageLimit: { resetsAt: 30 * 60_000 },
        blocks: [
          sent("main"),
          {
            id: "t",
            role: "tasks",
            text: "",
            taskList: {
              items: [
                { text: "Read the code", status: "completed" },
                { text: "Fix it", status: "in_progress" },
                { text: "Drop", status: "cancelled" },
              ],
            },
          },
        ],
      }),
    ];
    const { view: goal, byId } = view(sessions);
    const summary = goalProgressSummary(goal, byId, [], 0);
    expect(summary.source).toBe("steps");
    expect(summary.done.map((item) => item.text)).toEqual(["Read the code"]);
    expect(summary.remaining.map((item) => item.text)).toEqual(["Fix it"]);
    expect(summary.blocked[0].detail).toBe("Hit its usage limit, resets in 30 min");
  });

  it("lists stopped chats as stuck and counts decisions", () => {
    const sessions = [
      chat("main", {
        blocks: [
          sent("main"),
          { id: "e", role: "system", text: "Claude crashed", notice: "error" },
        ],
      }),
    ];
    const { view: goal, byId } = view(sessions);
    const summary = goalProgressSummary(goal, byId, [], 0);
    expect(summary.blocked).toEqual([{ text: "main", sessionId: "main", detail: "Claude crashed" }]);
    expect(progressHeadline({ ...summary, decisions: 2 })).toBe("1 stuck · 2 need you");
  });
});
