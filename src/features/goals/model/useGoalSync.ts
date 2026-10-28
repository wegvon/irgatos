import { useEffect, useRef } from "react";
import type { Session } from "../../sessions/model/session";
import { loadGoals, saveGoals } from "./goalStore";
import { syncGoals } from "./goals";

/** Streaming turns change sessions many times a second; goals need far less. */
const SYNC_DELAY_MS = 800;

/** Keep every working conversation under a goal while the app runs. */
export function useGoalSync(
  sessions: readonly Session[],
  excluded: ReadonlySet<string>,
  interruptedIds?: ReadonlySet<string>,
): void {
  const latest = useRef({ sessions, excluded, interruptedIds });
  latest.current = { sessions, excluded, interruptedIds };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Throttled, not debounced: a long streaming turn must not hold it off.
  useEffect(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const current = latest.current;
      const goals = loadGoals();
      const next = syncGoals(goals, current.sessions, {
        excluded: current.excluded,
        interruptedIds: current.interruptedIds,
      });
      if (next !== goals) saveGoals(next);
    }, SYNC_DELAY_MS);
  }, [sessions, excluded, interruptedIds]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );
}
