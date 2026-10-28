import { describe, expect, it } from "vitest";
import {
  REVIEW_WINDOW_MS,
  buildFleet,
  fleetEntry,
  teamCountsLabel,
} from "./fleet";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";
import type { ReviewMarks } from "./reviewMarks";

const NOW = 10 * REVIEW_WINDOW_MS;

function chat(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id, title: id, ...patch };
}

function sent(at: number): Block {
  return { id: `u-${at}`, role: "user", text: "Go", startedAt: at, durationMs: 1_000 };
}

function edit(path: string): Block {
  return {
    id: `edit-${path}`,
    role: "tool",
    text: `Edit ${path}`,
    tool: { kind: "edit", status: "completed", preview: { kind: "write", path } },
  };
}

const changed = (at: number) => [sent(at), edit("/repo/a.ts")];
const turnAt = (at: number) => at + 1_000;

describe("explicit review", () => {
  const since = 1_000;
  const reviews = (marks: ReviewMarks["marks"] = {}): ReviewMarks => ({
    since,
    marks,
  });

  it("keeps a result in review long after it was seen", () => {
    const session = chat("a", { blocks: changed(NOW - 5 * REVIEW_WINDOW_MS) });
    // Without tracking, the old two-hour window lets it go idle.
    expect(fleetEntry(session, { now: NOW })?.bucket).toBe("idle");
    expect(fleetEntry(session, { now: NOW, reviews: reviews() })?.bucket).toBe(
      "review",
    );
  });

  it("leaves review only when marked, and only for that turn", () => {
    const at = NOW - 5 * REVIEW_WINDOW_MS;
    const session = chat("a", { blocks: changed(at) });
    const marked = reviews({ a: { turnAt: turnAt(at), state: "reviewed" } });
    expect(fleetEntry(session, { now: NOW, reviews: marked })?.bucket).toBe(
      "idle",
    );
    // A newer turn with changes is outstanding again.
    const next = chat("a", {
      blocks: [...changed(at), sent(NOW - 1_000), edit("/repo/b.ts")],
    });
    expect(fleetEntry(next, { now: NOW, reviews: marked })?.bucket).toBe(
      "review",
    );
  });

  it("keeps a put-aside result in review, below the others", () => {
    const later = chat("later", { blocks: changed(NOW - 2_000) });
    const fresh = chat("fresh", { blocks: changed(NOW - 9_000) });
    const fleet = buildFleet([later, fresh], {
      now: NOW,
      reviews: reviews({
        later: { turnAt: turnAt(NOW - 2_000), state: "later" },
      }),
    });
    expect(fleet.review.map((entry) => entry.sessionId)).toEqual([
      "fresh",
      "later",
    ]);
    expect(fleet.review[1].reviewLater).toBe(true);
    expect(fleet.review[1].turnAt).toBe(turnAt(NOW - 2_000));
  });

  it("does not flood review with turns from before tracking began", () => {
    const old = chat("old", { blocks: changed(10) });
    expect(
      fleetEntry(old, { now: NOW, reviews: { since: NOW, marks: {} } })?.bucket,
    ).toBe("idle");
  });

  it("still clears a plain unread reply by reading it", () => {
    const reply = chat("reply", { blocks: [sent(NOW - 1_000)] });
    expect(
      fleetEntry(reply, {
        now: NOW,
        reviews: reviews(),
        unseenFinishedIds: new Set(["reply"]),
      })?.bucket,
    ).toBe("review");
    expect(fleetEntry(reply, { now: NOW, reviews: reviews() })?.bucket).toBe(
      "idle",
    );
  });
});

function task(id: string, patch: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    id,
    sessionId: `w-${id}`,
    title: id,
    harness: "codex",
    model: "codex:test",
    prompt: "",
    files: [id],
    scopes: [`/repo/${id}`],
    dependsOn: [],
    status: "queued",
    accepted: false,
    result: "",
    delivered: false,
    ...patch,
  };
}

function run(tasks: OrchestrationTask[], patch: Partial<OrchestrationRun> = {}) {
  return {
    version: 2,
    leadId: "lead",
    cwd: "/repo",
    status: "active",
    allowedHarnesses: ["codex"],
    maxWorkers: 3,
    cli: "irgat",
    tasks,
    continuations: 0,
    requests: {},
    ...patch,
  } as OrchestrationRun;
}

describe("orchestration teams", () => {
  const lead = chat("lead", { blocks: [sent(NOW - 1_000)] });
  const worker = (id: string, patch: Partial<Session> = {}) =>
    chat(`w-${id}`, { orchestrationLeadId: "lead", blocks: [sent(NOW)], ...patch });

  it("lists the team under its lead with counts, while workers run", () => {
    const fleet = buildFleet(
      [lead, worker("api", { busy: true }), worker("ui"), worker("docs")],
      {
        now: NOW,
        runs: [
          run([
            task("api", { status: "running" }),
            task("ui", { dependsOn: ["api"] }),
            task("docs", { status: "completed" }),
          ]),
        ],
      },
    );
    // Workers do not get their own rows; the lead carries them.
    expect(fleet.total).toBe(1);
    const entry = fleet.running[0];
    expect(entry.sessionId).toBe("lead");
    // The lead is idle itself, but its team is still at work.
    expect(entry.activity).toBe("Supervising 3 agents");
    expect(entry.team?.counts).toMatchObject({ working: 1, waiting: 1, done: 1 });
    expect(teamCountsLabel(entry.team!.counts)).toBe("1 working · 1 waiting · 1 done");
    const ui = entry.team!.members.find((member) => member.taskId === "ui")!;
    expect(ui.label).toBe("Waiting on task");
    expect(ui.wait).toMatchObject({ kind: "dependency", blocker: { taskId: "api" } });
  });

  it("counts a worker waiting on an approval as needing input", () => {
    const asking = worker("api", {
      busy: true,
      blocks: [
        sent(NOW),
        {
          id: "ask",
          role: "tool",
          text: "Run",
          tool: { kind: "execute", status: "pending", preview: { kind: "shell", query: "npm test" } },
          approval: { requestId: 1 },
        },
      ],
    });
    const fleet = buildFleet([lead, asking], {
      now: NOW,
      runs: [run([task("api", { status: "running" })])],
    });
    const team = fleet.running.find((entry) => entry.sessionId === "lead")!.team!;
    expect(team.counts.needsInput).toBe(1);
    expect(team.members[0].label).toBe("Needs input");
    // It still shows up on its own in Needs you.
    expect(fleet.needsYou.map((entry) => entry.sessionId)).toEqual(["w-api"]);
  });

  it("lets a finished team's lead settle normally", () => {
    const fleet = buildFleet([lead], {
      now: NOW,
      runs: [run([task("api", { status: "completed", accepted: true })], { status: "finished" })],
    });
    const entry = [...fleet.idle, ...fleet.review][0];
    expect(entry.team?.active).toBe(false);
    expect(fleet.running).toEqual([]);
  });
});
