import { describe, expect, it, vi } from "vitest";
import {
  Orchestrator,
  withPendingGuidance,
  type ControlOutcome,
  type OrchestrationHost,
  type OrchestrationRun,
} from "./orchestration";
import { newSession } from "../../sessions/model/session";

function setup() {
  const store = {
    save: vi.fn(async () => {}),
    load: vi.fn(async () => null),
    enable: vi.fn(async () => "/bin/irgat"),
    disable: vi.fn(async () => {}),
    scopes: vi.fn(async (cwd: string, files: string[]) =>
      files.map((file) => `${cwd}/${file}`),
    ),
    resolvePath: vi.fn(async (path: string) => path),
  };
  const manager = new Orchestrator(store);
  const lead = { ...newSession("claude", "/repo"), id: "lead", busy: true };
  const sessions = [lead];
  const completions = new Map<string, (outcome: ControlOutcome) => void>();
  const host: OrchestrationHost = {
    session: (id) => sessions.find((session) => session.id === id),
    sessions: () => sessions,
    choices: () => [
      { harness: "codex", models: [{ id: "codex:test", name: "Test" }] },
    ],
    createWorker: vi.fn(async (run: OrchestrationRun, task) => {
      sessions.push({
        ...newSession(task.harness, run.cwd),
        id: task.sessionId,
        busy: false,
      });
      return {
        workspace: {
          id: `checkout:/worktrees/${task.id}`,
          projectCwd: run.cwd,
          checkoutCwd: `/worktrees/${task.id}`,
          kind: "worktree" as const,
        },
      };
    }),
    integrateWorker: vi.fn(async () => ({ files: [], alreadyApplied: 0 })),
    cleanupWorker: vi.fn(async () => true),
    submit: vi.fn((id, _text, done) => {
      const session = sessions.find((entry) => entry.id === id)!;
      session.busy = true;
      completions.set(id, (outcome) => {
        session.busy = false;
        done(outcome);
      });
    }),
    stop: vi.fn(async (id) => {
      const session = sessions.find((entry) => entry.id === id);
      if (session) session.busy = false;
    }),
    steer: vi.fn(async () => {}),
    respondApproval: vi.fn(),
    answerQuestion: vi.fn(),
  };
  manager.bind(host);
  let request = 0;
  const call = (action: string, input: Record<string, unknown> = {}) =>
    manager.handle("lead", `request-${++request}`, action, input);
  const start = async (workers = 1) => {
    lead.busy = false;
    await manager.start("lead", ["codex"], workers);
    lead.busy = true;
  };
  const delegate = (title: string, files: string[], extra = {}) =>
    call("delegate", {
      title,
      prompt: `Do ${title}`,
      harness: "codex",
      files,
      ...extra,
    });
  const tasks = () => manager.run("lead")!.tasks;
  const submitted = (id: string) =>
    vi
      .mocked(host.submit)
      .mock.calls.filter(([target]) => target === id)
      .map(([, text]) => text);
  return { manager, host, lead, call, start, delegate, tasks, completions, submitted };
}

describe("worker guidance", () => {
  it("steers a running worker and reports it delivered", async () => {
    const f = setup();
    await f.start();
    await f.delegate("API", ["api"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    const note = await f.manager.guide("lead", task.id, "Keep the old route");
    expect(note.status).toBe("delivered");
    expect(note.via).toBe("worker");
    expect(vi.mocked(f.host.steer).mock.calls[0]).toEqual([
      task.sessionId,
      expect.stringContaining("Keep the old route"),
    ]);
    expect(f.tasks()[0].guidance?.[0].status).toBe("delivered");
    // The worker keeps its turn: guidance never restarts it.
    expect(f.tasks()[0].status).toBe("running");
  });

  it("marks guidance failed when the steer does not arrive", async () => {
    const f = setup();
    await f.start();
    await f.delegate("API", ["api"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    vi.mocked(f.host.steer).mockRejectedValueOnce(new Error("Agent is gone"));
    const note = await f.manager.guide("lead", f.tasks()[0].id, "Stop");
    expect(note.status).toBe("failed");
    expect(f.tasks()[0].guidance?.[0]).toMatchObject({
      status: "failed",
      error: "Agent is gone",
    });
  });

  it("holds guidance for a queued worker and adds it to its first prompt", async () => {
    const f = setup();
    await f.start(1);
    await f.delegate("First", ["a"]);
    await f.delegate("Second", ["b"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const second = f.tasks()[1];
    expect(second.status).toBe("queued");
    const note = await f.manager.guide("lead", second.id, "Use the v2 schema");
    expect(note).toMatchObject({ status: "pending", via: "prompt" });
    expect(f.host.steer).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(f.completions.has(f.tasks()[0].sessionId)).toBe(true),
    );
    f.completions.get(f.tasks()[0].sessionId)!({ status: "completed", text: "ok" });
    await vi.waitFor(() =>
      expect(f.tasks()[1].guidance?.[0].status).toBe("delivered"),
    );
    expect(f.submitted(second.sessionId)[0]).toContain("Use the v2 schema");
  });

  it("fails pending guidance when its queued task is cancelled", async () => {
    const f = setup();
    await f.start(1);
    await f.delegate("First", ["a"]);
    await f.delegate("Second", ["b"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    await f.manager.guide("lead", f.tasks()[1].id, "Hurry");
    await f.manager.cancelTask("lead", f.tasks()[1].id);
    expect(f.tasks()[1].guidance?.[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("cancelled"),
    });
  });

  it("refuses guidance for a cancelled task without contacting anyone", async () => {
    const f = setup();
    await f.start();
    await f.delegate("API", ["api"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    await f.manager.cancelTask("lead", f.tasks()[0].id);
    const note = await f.manager.guide("lead", f.tasks()[0].id, "Never mind");
    expect(note.status).toBe("failed");
    expect(f.host.steer).not.toHaveBeenCalled();
  });

  it("tells the lead about every note, and hands a stopped worker's note to it", async () => {
    const f = setup();
    await f.start();
    await f.delegate("API", ["api"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    await vi.waitFor(() => expect(f.completions.has(task.sessionId)).toBe(true));
    f.completions.get(task.sessionId)!({ status: "completed", text: "Done" });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    const note = await f.manager.guide("lead", task.id, "Rename the flag too");
    expect(note).toMatchObject({ status: "pending", via: "lead" });
    f.lead.busy = false;
    f.manager.sync();
    await vi.waitFor(() =>
      expect(f.tasks()[0].guidance?.[0].status).toBe("delivered"),
    );
    const sent = f.submitted("lead").at(-1)!;
    expect(sent).toContain("Rename the flag too");
    expect(sent).toContain("not delivered: the worker had already stopped");
    expect(f.tasks()[0].guidance?.[0].leadNotified).toBe(true);
  });

  it("keeps a lead-bound note pending if the lead turn fails", async () => {
    const f = setup();
    await f.start();
    await f.delegate("API", ["api"]);
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("running"));
    const task = f.tasks()[0];
    await vi.waitFor(() => expect(f.completions.has(task.sessionId)).toBe(true));
    f.completions.get(task.sessionId)!({ status: "completed", text: "Done" });
    await vi.waitFor(() => expect(f.tasks()[0].status).toBe("completed"));
    await f.manager.guide("lead", task.id, "Check the docs");
    f.lead.busy = false;
    f.manager.sync();
    await vi.waitFor(() => expect(f.submitted("lead").length).toBe(1));
    f.completions.get("lead")!({ status: "failed", text: "", error: "boom" });
    await vi.waitFor(() =>
      expect(f.tasks()[0].guidance?.[0]).toMatchObject({
        status: "pending",
        leadNotified: false,
      }),
    );
  });

  it("only adds pending start-prompt notes", () => {
    expect(withPendingGuidance("Task")).toBe("Task");
    const prompt = withPendingGuidance("Task", [
      { id: "1", text: "Use A", at: 0, status: "pending", via: "prompt" },
      { id: "2", text: "Old", at: 0, status: "delivered", via: "worker" },
      { id: "3", text: "Lead", at: 0, status: "pending", via: "lead" },
    ]);
    expect(prompt).toContain("- Use A");
    expect(prompt).not.toContain("Old");
    expect(prompt).not.toContain("Lead");
  });
});
