import { approveHabit, skipHabit } from "./habitGuards";
import {
  checkHabitsNow,
  habitAwaitingApproval,
  updateHabits,
  type Habit,
} from "./irgatHabits";

/** A habit run waiting on the user, as Fleet's Needs you lists it. */
export type HabitApprovalEntry = {
  irgatId: string;
  /** The Irgat's chat, to open from the card. */
  irgatSessionId?: string;
  irgatName: string;
  color: string;
  habit: Habit;
  requestedAt: number;
};

export type IrgatHabitList = {
  irgatId: string;
  irgatSessionId?: string;
  irgatName: string;
  color: string;
  habits: readonly Habit[];
};

/** Every habit run waiting on the user, the longest waiting first. */
export function habitApprovalEntries(
  lists: readonly IrgatHabitList[],
  now: number,
): HabitApprovalEntry[] {
  const entries: HabitApprovalEntry[] = [];
  for (const list of lists)
    for (const habit of list.habits)
      if (habitAwaitingApproval(habit, now))
        entries.push({
          irgatId: list.irgatId,
          ...(list.irgatSessionId ? { irgatSessionId: list.irgatSessionId } : {}),
          irgatName: list.irgatName,
          color: list.color,
          habit,
          requestedAt: habit.approval!.requestedAt,
        });
  return entries.sort((a, b) => a.requestedAt - b.requestedAt);
}

/** Approve lets the run go ahead now; Skip drops it until its next time. */
export async function decideHabitApproval(
  irgatId: string,
  habitId: string,
  decision: "approve" | "skip",
): Promise<void> {
  await updateHabits(irgatId, (habits) => ({
    habits: habits.map((habit) => {
      if (habit.id !== habitId || habit.approval?.state !== "pending")
        return habit;
      return decision === "approve"
        ? approveHabit(habit)
        : skipHabit(habit, Date.now(), "You skipped this run.");
    }),
    result: undefined,
  }));
  if (decision === "approve") checkHabitsNow();
}
