import { sessionAgent } from "../../agent-tree/model/agentTree";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session, TaskListItem } from "../../sessions/model/session";
import type { GoalView } from "./goals";

/**
 * Where a goal stands in outcomes rather than activity: what is done, what is
 * left, what is stuck and what waits on the user. One summary for the whole
 * goal, however many chats and workers share it; an orchestration run's own
 * task list wins, since its lead coordinates the workers.
 */

export type ProgressItem = {
  text: string;
  /** Result, error or what it is doing, in a line. */
  detail?: string;
  sessionId?: string;
  /** Being worked on right now. */
  active?: boolean;
};

export type GoalProgressSummary = {
  done: ProgressItem[];
  remaining: ProgressItem[];
  blocked: ProgressItem[];
  /** Approvals and questions waiting on the user. */
  decisions: number;
  /** Where the done/remaining lists come from. */
  source: "workers" | "steps" | "chats";
};

const DETAIL_MAX = 160;

function line(text: string | undefined): string | undefined {
  const first = text
    ?.split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  if (!first) return undefined;
  return first.length > DETAIL_MAX ? `${first.slice(0, DETAIL_MAX - 1)}…` : first;
}

function latestTaskList(session: Session): TaskListItem[] | undefined {
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.taskList?.items.length) return block.taskList.items;
    if (block.role === "user" && !block.draft && !block.internal) break;
  }
  return undefined;
}

function formatReset(at: number, now: number): string {
  const minutes = Math.max(1, Math.round((at - now) / 60_000));
  if (minutes < 60) return `resets in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `resets in ${hours} h`;
}

export function goalProgressSummary(
  view: GoalView,
  sessionsById: ReadonlyMap<string, Session>,
  runs: readonly OrchestrationRun[] = [],
  now = Date.now(),
): GoalProgressSummary {
  const done: ProgressItem[] = [];
  const remaining: ProgressItem[] = [];
  const blocked: ProgressItem[] = [];
  const memberIds = new Set(view.members.map((member) => member.link.sessionId));
  const covered = new Set<string>();
  let source: GoalProgressSummary["source"] = "chats";

  // The coordinator's own task list: one row per worker task.
  const run = [...runs]
    .reverse()
    .find((entry) => memberIds.has(entry.leadId) && entry.tasks.length > 0);
  if (run) {
    source = "workers";
    covered.add(run.leadId);
    for (const task of run.tasks) {
      covered.add(task.sessionId);
      const item: ProgressItem = { text: task.title, sessionId: task.sessionId };
      switch (task.status) {
        case "completed":
          done.push({ ...item, ...(line(task.result) ? { detail: line(task.result) } : {}) });
          break;
        case "running":
        case "cancelling":
          remaining.push({ ...item, active: true });
          break;
        case "queued":
          remaining.push({
            ...item,
            ...(task.dependsOn.length ? { detail: "Waiting on earlier tasks" } : {}),
          });
          break;
        case "failed":
        case "blocked":
        case "interrupted":
          blocked.push({
            ...item,
            detail:
              line(task.error) ??
              (task.status === "interrupted"
                ? "Stopped before it finished"
                : task.status === "blocked"
                  ? "Blocked"
                  : "Failed"),
          });
          break;
        case "cancelled":
          break;
      }
    }
    if (run.status === "paused" && run.lastPauseReason)
      blocked.push({ text: "Coordination paused", detail: line(run.lastPauseReason), sessionId: run.leadId });
  }

  // Otherwise the main chat's steps, as the agent planned them.
  if (!run) {
    const main =
      view.members.find((member) => member.open && member.link.role === "main") ??
      view.members.find((member) => member.open && member.link.role !== "worker");
    const session = main ? sessionsById.get(main.link.sessionId) : undefined;
    const items = session ? latestTaskList(session) : undefined;
    if (session && items?.length) {
      source = "steps";
      for (const item of items) {
        if (item.status === "cancelled") continue;
        const entry: ProgressItem = { text: item.text, sessionId: session.id };
        if (item.status === "completed") done.push(entry);
        else remaining.push({ ...entry, ...(item.status === "in_progress" && session.busy ? { active: true } : {}) });
      }
    }
  }

  // Every chat and worker the run does not already speak for.
  for (const member of view.members) {
    const sessionId = member.link.sessionId;
    const session = sessionsById.get(sessionId);
    if (session?.usageLimit) {
      blocked.push({
        text: member.link.title || "A chat",
        detail: session.usageLimit.resetsAt
          ? `Hit its usage limit, ${formatReset(session.usageLimit.resetsAt, now)}`
          : "Hit its usage limit",
        sessionId,
      });
      continue;
    }
    if (covered.has(sessionId) || !member.open || !session) continue;
    if (member.status === "failed") {
      const agent = sessionAgent(session);
      blocked.push({ text: member.link.title || "A chat", detail: line(agent.error) ?? "Stopped with an error", sessionId });
    } else if (member.status === "stopped") {
      blocked.push({ text: member.link.title || "A chat", detail: "Stopped before it finished", sessionId });
    } else if (member.link.role === "worker") {
      if (member.status === "done") done.push({ text: member.link.title, sessionId });
      else if (member.status === "running")
        remaining.push({ text: member.link.title, sessionId, active: true, ...(member.activity ? { detail: member.activity } : {}) });
    }
  }

  return { done, remaining, blocked, decisions: view.requests.length, source };
}

/** "3 done · 2 left · 1 stuck · 1 needs you", leaving out what is zero. */
export function progressHeadline(summary: GoalProgressSummary): string | undefined {
  const parts = [
    summary.done.length ? `${summary.done.length} done` : "",
    summary.remaining.length ? `${summary.remaining.length} left` : "",
    summary.blocked.length ? `${summary.blocked.length} stuck` : "",
    summary.decisions ? `${summary.decisions} ${summary.decisions === 1 ? "needs" : "need"} you` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
