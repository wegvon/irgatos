import { loadGoals } from "./goalStore";
import { goalForSession } from "./goals";
import {
  criteriaVersion,
  draftCriteriaContext,
  goalBriefContext,
} from "./criteria";

/**
 * What a turn hears about its goal. The turn that starts a goal sets out its
 * completion criteria; a chat that joins a goal, or any chat after the user
 * changed the criteria, hears them once.
 */

const HANDED_KEY = "irgatos.goals.handed.v1";
const KEEP = 500;

function readHanded(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(HANDED_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export type GoalContextPlan = { context?: string; version?: string };

export function planGoalContext(
  sessionId: string,
  /** No earlier user turn in this conversation. */
  firstTurn: boolean,
): GoalContextPlan {
  const goal = goalForSession(loadGoals(), sessionId);
  if (!goal) return firstTurn ? { context: draftCriteriaContext() } : {};
  const role = goal.links.find((link) => link.sessionId === sessionId)?.role;
  if (role !== "main" && role !== "chat") return {};
  if (!goal.criteria?.length) {
    if (!firstTurn) return {};
    return role === "main"
      ? { context: draftCriteriaContext() }
      : { context: goalBriefContext(goal), version: criteriaVersion(goal) };
  }
  // It wrote them itself and nobody changed them since.
  if (goal.criteriaFrom === sessionId && !goal.criteriaEdited) return {};
  const version = criteriaVersion(goal);
  if (readHanded()[sessionId] === version) return {};
  return { context: goalBriefContext(goal), version };
}

/** Record that a turn the provider accepted carried this version. */
export function recordGoalContext(sessionId: string, version: string): void {
  try {
    const entries = Object.entries({ ...readHanded(), [sessionId]: version });
    localStorage.setItem(
      HANDED_KEY,
      JSON.stringify(Object.fromEntries(entries.slice(-KEEP))),
    );
  } catch {
    // Not remembered: the next turn hears the criteria again.
  }
}
