import { useSyncExternalStore } from "react";
import { HARNESSES, type HarnessId } from "../../sessions/model/session";
import { GOAL_TITLE_MAX, type Goal, type GoalLink, type GoalLinkRole } from "./goals";

/**
 * Goals live in local storage, one list for every window. Writes go through
 * here so every view (Fleet, the chat's goal line) sees the same list.
 */

const KEY = "irgatos.goals.v1";
/** Finished goals beyond this many are forgotten, oldest first. */
const KEEP_DONE = 200;
const ROLES: readonly GoalLinkRole[] = ["main", "worker", "fork", "launched", "chat"];

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: readonly Goal[] | null = null;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseLink(value: unknown): GoalLink | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const sessionId = str(raw.sessionId);
  const harness = str(raw.harness) as HarnessId | undefined;
  if (!sessionId || !harness || !HARNESSES.includes(harness)) return null;
  const role = ROLES.includes(raw.role as GoalLinkRole)
    ? (raw.role as GoalLinkRole)
    : "chat";
  const branch = str(raw.branch);
  const lastStatus = str(raw.lastStatus);
  return {
    sessionId,
    role,
    addedAt: num(raw.addedAt) ?? 0,
    title: str(raw.title) ?? "",
    harness,
    workCwd: str(raw.workCwd) ?? "",
    ...(branch ? { branch } : {}),
    ...(lastStatus
      ? { lastStatus: lastStatus as GoalLink["lastStatus"] }
      : {}),
  };
}

export function parseGoals(value: unknown): Goal[] {
  if (!Array.isArray(value)) return [];
  const goals: Goal[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = str(raw.id);
    const cwd = str(raw.cwd);
    if (!id || !cwd || seen.has(id)) continue;
    seen.add(id);
    const links = Array.isArray(raw.links)
      ? raw.links.map(parseLink).filter((link): link is GoalLink => !!link)
      : [];
    const scope = str(raw.scope);
    const doneAt = num(raw.doneAt);
    goals.push({
      id,
      title: (str(raw.title) ?? "").slice(0, GOAL_TITLE_MAX) || "Untitled goal",
      ...(raw.autoTitle === true ? { autoTitle: true } : {}),
      request: str(raw.request) ?? "",
      ...(scope ? { scope } : {}),
      cwd,
      createdAt: num(raw.createdAt) ?? 0,
      updatedAt: num(raw.updatedAt) ?? 0,
      ...(doneAt ? { doneAt } : {}),
      links,
    });
  }
  return goals;
}

/** Keep every open goal; drop the oldest finished ones past the cap. */
export function pruneGoals(goals: readonly Goal[]): readonly Goal[] {
  const done = goals.filter((goal) => goal.doneAt);
  if (done.length <= KEEP_DONE) return goals;
  const drop = new Set(
    [...done]
      .sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0))
      .slice(0, done.length - KEEP_DONE)
      .map((goal) => goal.id),
  );
  return goals.filter((goal) => !drop.has(goal.id));
}

export function loadGoals(): readonly Goal[] {
  if (cache) return cache;
  try {
    cache = parseGoals(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    cache = [];
  }
  return cache;
}

export function saveGoals(goals: readonly Goal[]): void {
  const next = pruneGoals(goals);
  if (next === cache) return;
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: goals still work for this run.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Another window wrote the list.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useGoals(): readonly Goal[] {
  return useSyncExternalStore(subscribe, loadGoals, loadGoals);
}

/** Change one goal; `undefined` from `change` removes it. */
export function updateGoal(
  goalId: string,
  change: (goal: Goal) => Goal | undefined,
): void {
  const goals = loadGoals();
  const index = goals.findIndex((goal) => goal.id === goalId);
  if (index < 0) return;
  const next = change(goals[index]);
  saveGoals(
    next
      ? goals.map((goal, at) =>
          at === index ? { ...next, updatedAt: Date.now() } : goal,
        )
      : goals.filter((_, at) => at !== index),
  );
}

export function renameGoal(goalId: string, title: string): void {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, GOAL_TITLE_MAX);
  if (!clean) return;
  updateGoal(goalId, ({ autoTitle: _auto, ...goal }) => ({ ...goal, title: clean }));
}

export function setGoalScope(goalId: string, scope: string): void {
  const clean = scope.trim().slice(0, 2_000);
  updateGoal(goalId, (goal) => {
    const { scope: _old, ...rest } = goal;
    return clean ? { ...rest, scope: clean } : rest;
  });
}

export function setGoalDone(goalId: string, done: boolean): void {
  updateGoal(goalId, (goal) => {
    const { doneAt: _old, ...rest } = goal;
    return done ? { ...rest, doneAt: Date.now() } : rest;
  });
}

/** Forget the goal; its conversations stay where they are. */
export function removeGoal(goalId: string): void {
  updateGoal(goalId, () => undefined);
}

/**
 * Put a conversation under a goal before its first message, so it joins that
 * goal instead of starting its own. Moves it out of any other goal.
 */
export function linkSessionToGoal(
  goalId: string,
  link: Omit<GoalLink, "addedAt"> & { addedAt?: number },
): void {
  const goals = loadGoals();
  if (!goals.some((goal) => goal.id === goalId)) return;
  const now = Date.now();
  saveGoals(
    goals
      .map((goal) => {
        const rest = goal.links.filter(
          (entry) => entry.sessionId !== link.sessionId,
        );
        if (goal.id !== goalId) {
          return rest.length === goal.links.length
            ? goal
            : { ...goal, links: rest, updatedAt: now };
        }
        return {
          ...goal,
          links: [...rest, { ...link, addedAt: link.addedAt ?? now }],
          updatedAt: now,
          ...(goal.doneAt ? { doneAt: undefined } : {}),
        };
      })
      // A goal left with no conversations was only ever this one's.
      .filter((goal) => goal.id === goalId || goal.links.length > 0),
  );
}

/** Test seam: forget the in-memory copy. */
export function resetGoalCache(): void {
  cache = null;
}
