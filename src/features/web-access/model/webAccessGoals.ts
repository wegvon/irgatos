import { projectName } from "../../../shared/lib/paths";
import { isFreeChatCwd } from "../../freechat/model/freeChatPath";
import { goalRecovery, primarySession, progressText } from "../../goals/model/goalCard";
import { setGoalDone, loadGoals } from "../../goals/model/goalStore";
import {
  GOAL_STATE_LABEL,
  goalView,
  sortGoalViews,
  type Goal,
} from "../../goals/model/goals";
import { goalProgressSummary, progressHeadline, type ProgressItem } from "../../goals/model/progress";
import { goalResult } from "../../goals/model/result";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { CompletionGateStatus } from "../../sessions/model/completionGate";
import type { Session } from "../../sessions/model/session";
import type { RecoveryCause } from "../../goals/model/recovery";
import type { WebGoal, WebGoalItem, WebGoals } from "./protocol";

/**
 * The desktop's Goals on the phone: each goal's state, progress, decisions
 * waiting on the user and its delivered result, built by the same models the
 * Goals view uses so both screens say the same thing.
 */

export const WEB_GOALS_READS = ["goals"] as const;
export const WEB_GOALS_WRITES = ["goalDone", "goalResume"] as const;
const ACTIONS = new Set<string>([...WEB_GOALS_READS, ...WEB_GOALS_WRITES]);

export function isWebGoalsAction(action: string): boolean {
  return ACTIONS.has(action);
}

export type WebGoalsDeps = {
  sessions: () => readonly Session[];
  goals?: () => readonly Goal[];
  interruptedIds?: () => ReadonlySet<string>;
  runs?: () => readonly OrchestrationRun[];
  gateStatus?: (sessionId: string) => CompletionGateStatus | undefined;
  /** Picks a stopped chat back up, as the goal card's Resume does. */
  resume?: (sessionId: string, cause: RecoveryCause) => void;
  setDone?: (goalId: string, done: boolean) => void;
  now?: () => number;
};

type Input = Record<string, unknown>;

const GOALS_MAX = 80;

function items(list: readonly ProgressItem[]): WebGoalItem[] {
  return list.map((item) => ({
    text: item.text,
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.active ? { active: true } : {}),
  }));
}

export function webGoals(deps: WebGoalsDeps): WebGoals {
  const now = deps.now?.() ?? Date.now();
  const sessions = deps.sessions();
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const runs = deps.runs?.() ?? [];
  const views = sortGoalViews(
    (deps.goals ?? loadGoals)().map((goal) =>
      goalView(goal, byId, { now, interruptedIds: deps.interruptedIds?.() }),
    ),
  ).slice(0, GOALS_MAX);
  const goals = views.map((view): WebGoal => {
    const { goal } = view;
    const summary = goalProgressSummary(view, byId, runs, now);
    const progress = goal.doneAt
      ? undefined
      : (progressHeadline({ ...summary, decisions: 0 }) ?? progressText(view));
    const result =
      view.state === "working" || view.state === "needsYou"
        ? undefined
        : goalResult(view, byId, { gateStatus: deps.gateStatus });
    const recovery = goalRecovery(view, byId, now);
    const chats = view.members.filter((member) => member.link.role !== "worker").length;
    const primary = primarySession(view);
    const project = isFreeChatCwd(goal.cwd) ? "Chat" : projectName(goal.cwd);
    return {
      id: goal.id,
      title: goal.title,
      state: view.state,
      stateLabel: GOAL_STATE_LABEL[view.state],
      request: goal.request,
      project,
      ...(view.branches[0] ? { branch: view.branches[0] } : {}),
      ...(progress ? { progress } : {}),
      ...(view.activity ? { activity: view.activity } : {}),
      chats,
      agents: view.members.length - chats,
      files: view.editedPaths.length,
      ...(primary ? { sessionId: primary.link.sessionId } : {}),
      at: view.lastActivityAt || goal.updatedAt,
      requests: view.requests.map((entry) => ({
        sessionId: entry.sessionId,
        sessionTitle: entry.sessionTitle,
        request: entry.request,
      })),
      done: items(summary.done),
      remaining: items(summary.remaining),
      blocked: items(summary.blocked),
      criteria: (goal.criteria ?? []).map((criterion) => ({
        text: criterion.text,
        ...(criterion.verdict ? { verdict: criterion.verdict } : {}),
      })),
      ...(result
        ? {
            result: {
              sessionId: result.sessionId,
              ...(result.summary ? { summary: result.summary } : {}),
              checks: result.checks.map((check) => ({
                label: check.label,
                state: check.state,
                ...(check.gate ? { gate: true } : {}),
              })),
              limitations: result.limitations,
              links: result.previews.flatMap((preview) =>
                preview.kind === "url" && preview.url
                  ? [{ title: preview.title, url: preview.url }]
                  : [],
              ),
              artifacts: result.previews.flatMap((preview) =>
                preview.kind === "artifact" ? [preview.title] : [],
              ),
            },
          }
        : {}),
      ...(recovery
        ? {
            recovery: {
              sessionId: recovery.sessionId,
              cause: recovery.cause,
              ...recovery.brief,
              ...(recovery.resetsAt ? { resetsAt: recovery.resetsAt } : {}),
            },
          }
        : {}),
      finished: !!goal.doneAt,
    };
  });
  return { goals, at: now };
}

export function handleWebGoals(
  deps: WebGoalsDeps,
  action: string,
  input: Input,
): unknown {
  switch (action) {
    case "goals":
      return webGoals(deps);
    case "goalDone": {
      const goalId = typeof input.goalId === "string" ? input.goalId : "";
      const goals = (deps.goals ?? loadGoals)();
      if (!goals.some((goal) => goal.id === goalId)) throw new Error("That goal no longer exists.");
      (deps.setDone ?? setGoalDone)(goalId, input.done !== false);
      return { ok: true };
    }
    case "goalResume": {
      const sessionId = typeof input.sessionId === "string" ? input.sessionId : "";
      const cause: RecoveryCause = input.cause === "limit" ? "limit" : "interrupted";
      if (!deps.resume) throw new Error("Not available on this Mac.");
      if (!deps.sessions().some((session) => session.id === sessionId))
        throw new Error("That chat is not open on the Mac.");
      deps.resume(sessionId, cause);
      return { ok: true };
    }
    default:
      throw new Error("Unknown action");
  }
}
