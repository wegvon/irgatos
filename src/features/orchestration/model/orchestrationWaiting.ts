import { scopesOverlap } from "./orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
  TaskStatus,
} from "./orchestrationState";

/** The task that holds a queued one back, so the UI can link to it. */
export type WaitBlocker = {
  taskId: string;
  sessionId: string;
  title: string;
  status: TaskStatus;
};

/**
 * Why a queued task has not started, in the order the scheduler checks.
 * `stuck` means nothing will change without someone acting: the run is
 * paused, or a prerequisite stopped and will never be accepted on its own.
 */
export type WaitReason =
  | { kind: "paused"; stuck: true; reason?: string }
  | { kind: "dependency"; stuck: false; blocker: WaitBlocker }
  | { kind: "review"; stuck: false; blocker: WaitBlocker }
  | { kind: "dependencyStopped"; stuck: true; blocker: WaitBlocker }
  | { kind: "files"; stuck: false; blocker: WaitBlocker }
  | { kind: "capacity"; stuck: false; active: number; max: number };

const isActive = (task: OrchestrationTask) =>
  task.status === "running" || task.status === "cancelling";

const blocker = (task: OrchestrationTask): WaitBlocker => ({
  taskId: task.id,
  sessionId: task.sessionId,
  title: task.title,
  status: task.status,
});

export function taskWaitReason(
  run: OrchestrationRun,
  task: OrchestrationTask,
): WaitReason | undefined {
  if (task.status !== "queued") return undefined;
  if (run.status === "paused")
    return { kind: "paused", stuck: true, reason: run.error };
  const dependencies = task.dependsOn.flatMap((id) => {
    const found = run.tasks.find((entry) => entry.id === id);
    return found && !found.accepted ? [found] : [];
  });
  // A stopped prerequisite outranks one that is merely slow: it needs a person.
  const stopped = dependencies.find((entry) =>
    ["failed", "cancelled", "blocked", "interrupted"].includes(entry.status),
  );
  if (stopped)
    return { kind: "dependencyStopped", stuck: true, blocker: blocker(stopped) };
  const awaitingReview = dependencies.find(
    (entry) => entry.status === "completed",
  );
  if (awaitingReview)
    return { kind: "review", stuck: false, blocker: blocker(awaitingReview) };
  if (dependencies.length)
    return { kind: "dependency", stuck: false, blocker: blocker(dependencies[0]) };
  const owner = run.tasks.find(
    (entry) => isActive(entry) && scopesOverlap(entry.scopes, task.scopes),
  );
  if (owner) return { kind: "files", stuck: false, blocker: blocker(owner) };
  return {
    kind: "capacity",
    stuck: false,
    active: run.tasks.filter(isActive).length,
    max: run.maxWorkers,
  };
}

/** Short status for a row; the full sentence is `waitDetail`. */
export function waitLabel(reason: WaitReason): string {
  switch (reason.kind) {
    case "paused":
      return "Paused";
    case "dependency":
      return "Waiting on task";
    case "review":
      return "Waiting on review";
    case "dependencyStopped":
      return "Stuck";
    case "files":
      return "Waiting on files";
    case "capacity":
      return "Waiting for a slot";
  }
}

const STOPPED: Partial<Record<TaskStatus, string>> = {
  failed: "failed",
  cancelled: "was cancelled",
  blocked: "was stopped for review",
  interrupted: "was interrupted",
};

export function waitDetail(reason: WaitReason): string {
  switch (reason.kind) {
    case "paused":
      return `The run is paused${reason.reason ? `: ${reason.reason}` : "."} Resume it to start this task.`;
    case "dependency":
      return `Starts after ${reason.blocker.title} finishes and the lead accepts it.`;
    case "review":
      return `${reason.blocker.title} finished. This starts once the lead reviews and accepts it.`;
    case "dependencyStopped":
      return `${reason.blocker.title} ${STOPPED[reason.blocker.status] ?? "stopped"}, so this cannot start on its own. The lead has to retry it or change the plan.`;
    case "files":
      return `${reason.blocker.title} is editing the same files. This starts when it finishes.`;
    case "capacity":
      return `All ${reason.max} worker ${reason.max === 1 ? "slot is" : "slots are"} busy. This starts when one frees up.`;
  }
}

/** The wording the lead's CLI has always used, so its prompts keep working. */
export function waitForLead(reason: WaitReason): string {
  switch (reason.kind) {
    case "review":
    case "dependency":
      return `Waiting for review: ${reason.blocker.title}`;
    case "dependencyStopped":
      return `Waiting for review: ${reason.blocker.title} (${reason.blocker.status}; retry or cancel it)`;
    case "files":
      return `Waiting for files: ${reason.blocker.title}`;
    case "paused":
      return "Waiting for the run to resume";
    case "capacity":
      return "Waiting for a worker slot";
  }
}

/**
 * Queued tasks that wait on this one, directly or through another queued
 * task. Cancelling it leaves each of them unable to start on its own.
 */
export function dependentTasks(
  run: OrchestrationRun,
  taskId: string,
): OrchestrationTask[] {
  const found: OrchestrationTask[] = [];
  const seen = new Set([taskId]);
  const queue = [taskId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const entry of run.tasks) {
      if (seen.has(entry.id) || !entry.dependsOn.includes(id)) continue;
      if (entry.status !== "queued") continue;
      seen.add(entry.id);
      found.push(entry);
      queue.push(entry.id);
    }
  }
  return found;
}
