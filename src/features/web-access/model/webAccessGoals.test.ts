import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { syncGoals, type Goal } from "../../goals/model/goals";
import { newSession, type Session } from "../../sessions/model/session";
import { WEB_GOALS_READS, WEB_GOALS_WRITES, handleWebGoals } from "./webAccessGoals";
import type { WebGoals } from "./protocol";

const REPLY = `Export works in Safari. Try http://localhost:5173/export.

<criteria_check>
- [met] Export downloads a CSV in Safari
</criteria_check>

<known_limitations>
- Very large exports are slow
</known_limitations>`;

function chat(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/Users/demo/src/web"), id, title: `claude · ${id}`, ...patch };
}

function setup(sessions: Session[]) {
  let goals: readonly Goal[] = syncGoals([], sessions, { now: 100 });
  const setDone = vi.fn((goalId: string, done: boolean) => {
    goals = goals.map((goal) => (goal.id === goalId ? { ...goal, ...(done ? { doneAt: 5 } : {}) } : goal));
  });
  const resume = vi.fn();
  const deps = {
    sessions: () => sessions,
    goals: () => goals,
    setDone,
    resume,
    now: () => 1_000,
  };
  return { deps, setDone, resume };
}

describe("goals on the phone", () => {
  it("lists a delivered goal with its result to review", () => {
    const { deps } = setup([
      chat("a", {
        blocks: [
          { id: "u", role: "user", text: "Fix the Safari export", startedAt: 10, durationMs: 5 },
          { id: "c", role: "assistant", text: "<completion_criteria>\n- Export downloads a CSV in Safari\n</completion_criteria>" },
          { id: "r", role: "assistant", text: REPLY },
        ],
      }),
    ]);
    const { goals } = handleWebGoals(deps, "goals", {}) as WebGoals;
    expect(goals).toHaveLength(1);
    const [goal] = goals;
    expect(goal).toMatchObject({
      request: "Fix the Safari export",
      project: "web",
      sessionId: "a",
      finished: false,
    });
    expect(goal.result).toMatchObject({
      summary: expect.stringContaining("Export works in Safari"),
      limitations: ["Very large exports are slow"],
      links: [{ url: "http://localhost:5173/export" }],
    });
  });

  it("carries waiting approvals with their plain-words brief", () => {
    const { deps } = setup([
      chat("a", {
        busy: true,
        blocks: [
          { id: "u", role: "user", text: "Ship the SDK", startedAt: 10 },
          {
            id: "t",
            role: "tool",
            text: "Run",
            tool: { kind: "execute", status: "pending", preview: { kind: "shell", query: "npm publish" } },
            approval: { requestId: 4 },
          },
        ],
      }),
    ]);
    const [goal] = (handleWebGoals(deps, "goals", {}) as WebGoals).goals;
    expect(goal.state).toBe("needsYou");
    expect(goal.requests[0].request).toMatchObject({
      kind: "approval",
      requestId: 4,
      brief: { what: "Publish or deploy", reversible: "no" },
    });
  });

  it("explains an interrupted goal and resumes it, and marks goals done", () => {
    const { deps, resume, setDone } = setup([
      chat("a", {
        blocks: [
          { id: "u", role: "user", text: "Migrate billing", startedAt: 10 },
          { id: "a1", role: "assistant", text: "Working" },
          { id: "n", role: "system", text: "Claude crashed", notice: "error" },
        ],
      }),
    ]);
    const [goal] = (handleWebGoals(deps, "goals", {}) as WebGoals).goals;
    expect(goal.recovery).toMatchObject({ sessionId: "a", cause: "interrupted", left: ["Finish: Migrate billing"] });
    handleWebGoals(deps, "goalResume", { sessionId: "a", cause: "interrupted" });
    expect(resume).toHaveBeenCalledWith("a", "interrupted");
    expect(() => handleWebGoals(deps, "goalResume", { sessionId: "gone" })).toThrow(/not open/);

    handleWebGoals(deps, "goalDone", { goalId: goal.id, done: true });
    expect(setDone).toHaveBeenCalledWith(goal.id, true);
    expect((handleWebGoals(deps, "goals", {}) as WebGoals).goals[0].finished).toBe(true);
    expect(() => handleWebGoals(deps, "goalDone", { goalId: "nope" })).toThrow(/no longer exists/);
  });

  it("is let through by the Mac's server", () => {
    const rust = readFileSync("src-tauri/src/web_access.rs", "utf8");
    const list = (name: string) =>
      [...(rust.match(new RegExp(`const ${name}[^=]*= \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"(\w+)"/g)].map(
        (match) => match[1],
      );
    expect(list("READ_ACTIONS")).toEqual(expect.arrayContaining([...WEB_GOALS_READS]));
    expect(list("WRITE_ACTIONS")).toEqual(expect.arrayContaining([...WEB_GOALS_WRITES]));
  });
});
