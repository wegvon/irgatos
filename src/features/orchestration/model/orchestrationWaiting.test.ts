import { describe, expect, it } from "vitest";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";
import {
  dependentTasks,
  taskWaitReason,
  waitDetail,
  waitForLead,
  waitLabel,
} from "./orchestrationWaiting";

function task(
  id: string,
  patch: Partial<OrchestrationTask> = {},
): OrchestrationTask {
  return {
    id,
    sessionId: `s-${id}`,
    title: id.toUpperCase(),
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
    maxWorkers: 2,
    cli: "irgat",
    tasks,
    continuations: 0,
    requests: {},
    ...patch,
  } as OrchestrationRun;
}

describe("why a queued task waits", () => {
  it("names a dependency that is still working, and links to it", () => {
    const api = task("api", { status: "running" });
    const ui = task("ui", { dependsOn: ["api"] });
    const reason = taskWaitReason(run([api, ui]), ui)!;
    expect(reason).toMatchObject({
      kind: "dependency",
      stuck: false,
      blocker: { taskId: "api", sessionId: "s-api", title: "API" },
    });
    expect(waitLabel(reason)).toBe("Waiting on task");
    expect(waitDetail(reason)).toContain("Starts after API finishes");
  });

  it("separates a finished dependency waiting on the lead's review", () => {
    const api = task("api", { status: "completed" });
    const ui = task("ui", { dependsOn: ["api"] });
    const reason = taskWaitReason(run([api, ui]), ui)!;
    expect(reason.kind).toBe("review");
    expect(waitLabel(reason)).toBe("Waiting on review");
  });

  it("flags a stopped dependency as needing someone to act", () => {
    const api = task("api", { status: "cancelled" });
    const ui = task("ui", { dependsOn: ["api"] });
    const reason = taskWaitReason(run([api, ui]), ui)!;
    expect(reason).toMatchObject({ kind: "dependencyStopped", stuck: true });
    expect(waitLabel(reason)).toBe("Stuck");
    expect(waitDetail(reason)).toContain("API was cancelled");
  });

  it("names the worker holding overlapping files", () => {
    const a = task("a", { status: "running", scopes: ["/repo/src"] });
    const b = task("b", { scopes: ["/repo/src/app.ts"] });
    const reason = taskWaitReason(run([a, b]), b)!;
    expect(reason).toMatchObject({ kind: "files", blocker: { title: "A" } });
    expect(waitForLead(reason)).toBe("Waiting for files: A");
  });

  it("falls back to worker capacity with the numbers", () => {
    const a = task("a", { status: "running" });
    const b = task("b", { status: "running" });
    const c = task("c");
    const reason = taskWaitReason(run([a, b, c]), c)!;
    expect(reason).toMatchObject({ kind: "capacity", active: 2, max: 2 });
    expect(waitDetail(reason)).toContain("All 2 worker slots are busy");
  });

  it("says the run is paused before anything else", () => {
    const a = task("a", { status: "running" });
    const b = task("b", { dependsOn: ["a"] });
    const reason = taskWaitReason(
      run([a, b], { status: "paused", error: "Usage limit" }),
      b,
    )!;
    expect(reason).toMatchObject({ kind: "paused", stuck: true });
    expect(waitDetail(reason)).toContain("Usage limit");
  });

  it("explains nothing for a task that is not queued", () => {
    const a = task("a", { status: "running" });
    expect(taskWaitReason(run([a]), a)).toBeUndefined();
  });

  it("keeps the lead's wording for a dependency", () => {
    const api = task("api", { status: "running" });
    const ui = task("ui", { dependsOn: ["api"] });
    expect(waitForLead(taskWaitReason(run([api, ui]), ui)!)).toBe(
      "Waiting for review: API",
    );
  });
});

describe("what cancelling affects", () => {
  it("lists queued dependents, including indirect ones", () => {
    const api = task("api", { status: "running" });
    const ui = task("ui", { dependsOn: ["api"] });
    const e2e = task("e2e", { dependsOn: ["ui"] });
    const docs = task("docs");
    const done = task("old", { dependsOn: ["api"], status: "completed" });
    expect(
      dependentTasks(run([api, ui, e2e, docs, done]), "api").map(
        (entry) => entry.id,
      ),
    ).toEqual(["ui", "e2e"]);
    expect(dependentTasks(run([api, docs]), "api")).toEqual([]);
  });
});
