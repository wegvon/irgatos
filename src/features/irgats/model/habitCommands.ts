import { decideHabitApproval } from "./habitApprovals";
import { pauseHabit, runHabitNow } from "./habitGuards";
import {
  checkHabitsNow,
  habitAwaitingApproval,
  habitRunningSince,
  nextHabitRunAt,
  stopHabitRun,
  updateHabits,
  type Habit,
} from "./irgatHabits";

/** What the phone can do to one of an Irgat's habits, as on the Mac. */
export const HABIT_COMMANDS = [
  "run",
  "pause",
  "resume",
  "stop",
  "approve",
  "skip",
] as const;
export type HabitCommand = (typeof HABIT_COMMANDS)[number];

export function isHabitCommand(value: unknown): value is HabitCommand {
  return (HABIT_COMMANDS as readonly unknown[]).includes(value);
}

/** Resumes a habit from now; a one-off set going again is no longer done. */
export function resumeHabit(habit: Habit, now: number): Habit {
  const { finishedAt: _done, ...rest } = habit;
  return {
    ...rest,
    enabled: true,
    nextRunAt: nextHabitRunAt(habit.schedule, now),
  };
}

/**
 * Applies a command to the habit as it stands in its file. Throws when the
 * habit is gone, so the phone can say so rather than seem to succeed.
 */
export async function applyHabitCommand(
  irgatId: string,
  habitId: string,
  command: HabitCommand,
): Promise<void> {
  if (command === "approve" || command === "skip")
    return decideHabitApproval(irgatId, habitId, command);
  if (command === "stop") {
    if (habitRunningSince(habitId) == null)
      throw new Error("That habit is not running.");
    stopHabitRun(habitId);
    return;
  }
  const found = await updateHabits(irgatId, (habits) => {
    const now = Date.now();
    let hit = false;
    const next = habits.map((habit) => {
      if (habit.id !== habitId) return habit;
      hit = true;
      return command === "run"
        ? runHabitNow(habit, now)
        : command === "pause"
          ? pauseHabit(habit)
          : resumeHabit(habit, now);
    });
    return { habits: next, result: hit };
  });
  if (!found) throw new Error("That habit is gone. Pull to refresh.");
  if (command === "run") checkHabitsNow();
}

/** A habit as the phone lists it. */
export function webHabitState(habit: Habit, now: number) {
  return habitRunningSince(habit.id) != null
    ? ("running" as const)
    : habitAwaitingApproval(habit, now)
      ? ("approval" as const)
      : habit.finishedAt != null
        ? ("finished" as const)
        : habit.enabled
          ? ("scheduled" as const)
          : ("paused" as const);
}
