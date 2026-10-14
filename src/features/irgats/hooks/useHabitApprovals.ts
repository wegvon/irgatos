import { useEffect, useState } from "react";
import { irgatLook, listIrgats } from "../model/irgat";
import { subscribeIrgatFiles } from "../model/irgatFiles";
import { loadHabits } from "../model/irgatHabits";
import {
  habitApprovalEntries,
  type HabitApprovalEntry,
} from "../model/habitApprovals";

const REFRESH_MS = 30_000;

/** Habit runs across every Irgat that wait on the user's approval. */
export function useHabitApprovals(): HabitApprovalEntry[] {
  const [entries, setEntries] = useState<HabitApprovalEntry[]>([]);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      const lists = await Promise.all(
        listIrgats().map(async (irgat) => ({
          irgatId: irgat.id,
          ...(irgat.sessionId ? { irgatSessionId: irgat.sessionId } : {}),
          irgatName: irgatLook(irgat).name,
          color: irgat.color,
          habits: await loadHabits(irgat.id).catch(() => []),
        })),
      );
      if (!live) return;
      const next = habitApprovalEntries(lists, Date.now());
      setEntries((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    };
    const run = () =>
      void refresh().catch((error) =>
        console.warn("Could not check habit approvals", error),
      );
    run();
    const stop = subscribeIrgatFiles(run);
    window.addEventListener("focus", run);
    const timer = window.setInterval(run, REFRESH_MS);
    return () => {
      live = false;
      stop();
      window.removeEventListener("focus", run);
      window.clearInterval(timer);
    };
  }, []);
  return entries;
}
