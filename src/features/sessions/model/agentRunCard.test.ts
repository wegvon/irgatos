import { describe, expect, it } from "vitest";
import {
  agentRunFromSession,
  formatClock,
  formatStepDuration,
  stepElapsed,
  updateStepTimings,
  type StepTiming,
} from "./agentRunCard";
import type { Block } from "./session";

const cwd = "/repo";

function user(id = "u1"): Block {
  return {
    id,
    role: "user",
    text: "Fix proration rounding",
    startedAt: 1_000,
    turnModel: { harness: "claude", id: "sonnet", name: "Claude Sonnet 5.5" },
  };
}

function read(id: string, path: string, status = "completed"): Block {
  return {
    id,
    role: "tool",
    text: "Read",
    tool: {
      kind: "read",
      status,
      preview: { kind: "read", path: `${cwd}/${path}` },
    },
  };
}

function edit(id: string, path: string, status = "completed"): Block {
  return {
    id,
    role: "tool",
    text: "Edit",
    tool: {
      kind: "edit",
      status,
      preview: {
        kind: "write",
        path: `${cwd}/${path}`,
        additions: 1,
        deletions: 1,
      },
    },
  };
}

function shell(id: string, command: string, status = "completed"): Block {
  return { id, role: "tool", text: command, tool: { kind: "execute", status } };
}

function session(blocks: Block[], busy: boolean) {
  return { blocks, busy, cwd, harness: "claude" as const, model: "sonnet" };
}

describe("agentRunFromSession", () => {
  it("folds consecutive reads and names the running step in present tense", () => {
    const run = agentRunFromSession(
      session(
        [
          user(),
          read("r1", "src/a.ts"),
          read("r2", "src/b.ts"),
          read("r3", "src/c.ts"),
          edit("e1", "src/billing/invoice.ts", "in_progress"),
        ],
        true,
      ),
    )!;
    expect(run.state).toBe("running");
    expect(run.model).toBe("Claude Sonnet 5.5");
    expect(run.steps.map((step) => [step.pastLabel, step.state])).toEqual([
      ["Read 3 files", "done"],
      ["Edited src/billing/invoice.ts", "active"],
    ]);
    expect(run.title).toBe("Editing src/billing/invoice.ts");
  });

  it("asks for approval with the command in the title and a waiting row", () => {
    const push: Block = {
      ...shell("p1", "git push", "pending"),
      role: "approval",
      approval: { requestId: 7 },
    };
    const run = agentRunFromSession(session([user(), push], true))!;
    expect(run.state).toBe("waiting_approval");
    expect(run.title).toBe("Needs your approval to run git push");
    expect(run.approvalRequestId).toBe(7);
    expect(run.steps.at(-1)).toMatchObject({
      icon: "approval",
      state: "waiting",
      presentLabel: "Waiting for approval to run git push",
    });
  });

  it("goes back to running once the approval is decided", () => {
    const push: Block = {
      ...shell("p1", "git push", "in_progress"),
      role: "approval",
      approval: { requestId: 7, decided: "allow" },
    };
    const run = agentRunFromSession(session([user(), push], true))!;
    expect(run.state).toBe("running");
    expect(run.title).toBe("Running git push");
  });

  it("summarises a finished turn with its time and changed files", () => {
    const done = { ...user(), durationMs: 13_000 };
    const run = agentRunFromSession(
      session(
        [
          done,
          edit("e1", "src/a.ts"),
          edit("e2", "src/a.ts"),
          edit("e3", "src/b.ts"),
        ],
        false,
      ),
    )!;
    expect(run.state).toBe("done");
    expect(run.title).toBe("Done in 13s · 2 files changed");
  });

  it("marks a turn that ended on an error as failed", () => {
    const run = agentRunFromSession(
      session(
        [
          user(),
          shell("s1", "npm test"),
          {
            id: "x",
            role: "system",
            text: "Provider error: overloaded",
            notice: "error",
          },
        ],
        false,
      ),
    )!;
    expect(run.state).toBe("failed");
    expect(run.error).toBe("Provider error: overloaded");
    expect(run.steps.at(-1)).toMatchObject({ icon: "error", state: "failed" });
  });

  it("keeps the user's Pause over a plain finished turn", () => {
    const run = agentRunFromSession(
      session([user(), shell("s1", "ls")], false),
      "paused",
    )!;
    expect(run.state).toBe("paused");
  });

  it("follows only the latest user turn", () => {
    const run = agentRunFromSession(
      session([user("u0"), shell("old", "ls"), user("u1")], true),
    )!;
    expect(run.turnId).toBe("u1");
    expect(run.steps).toEqual([]);
    expect(run.title).toBe("Starting…");
  });
});

describe("step timings", () => {
  it("times a step from when it was seen running until it settled", () => {
    const timings = new Map<string, StepTiming>();
    const running = agentRunFromSession(
      session([user(), shell("s1", "npm test", "in_progress")], true),
    )!;
    updateStepTimings(timings, running, 100);
    expect(stepElapsed(running.steps[0], timings, 600)).toBe(500);
    const settled = agentRunFromSession(
      session([user(), shell("s1", "npm test")], true),
    )!;
    updateStepTimings(timings, settled, 2_000);
    expect(stepElapsed(settled.steps[0], timings, 9_000)).toBe(1_900);
  });

  it("leaves steps that were already finished untimed", () => {
    const timings = new Map<string, StepTiming>();
    const run = agentRunFromSession(
      session([user(), shell("s1", "ls")], true),
    )!;
    updateStepTimings(timings, run, 100);
    expect(stepElapsed(run.steps[0], timings, 500)).toBeUndefined();
  });
});

describe("formatting", () => {
  it("formats the header clock and row durations", () => {
    expect(formatClock(5_400)).toBe("0:05");
    expect(formatClock(125_000)).toBe("2:05");
    expect(formatStepDuration(1_940)).toBe("1.9s");
    expect(formatStepDuration(2_000)).toBe("2s");
    expect(formatStepDuration(42_000)).toBe("42s");
    expect(formatStepDuration(185_000)).toBe("3m 05s");
  });
});
