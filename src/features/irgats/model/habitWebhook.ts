import { invoke } from "@tauri-apps/api/core";
import { triggerHabit } from "./habitGuards";
import {
  checkHabitsNow,
  loadHabits,
  updateHabits,
  type Habit,
} from "./irgatHabits";

/** Mirrors `HabitWebhookEvent` in `habit_webhook.rs`. */
export type HabitWebhookEvent = {
  token: string;
  payload?: string | null;
  receivedAt: number;
};

/** Mirrors `HabitWebhookInfo`; no port while no habit has a trigger. */
export type HabitWebhookInfo = { port: number | null; error: string | null };

export const HABIT_WEBHOOK_EVENT = "habit-webhook";

let info: HabitWebhookInfo = { port: null, error: null };
const listeners = new Set<() => void>();

export function habitWebhookInfo(): HabitWebhookInfo {
  return info;
}

export function subscribeHabitWebhookInfo(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setInfo(next: HabitWebhookInfo): void {
  if (next.port === info.port && next.error === info.error) return;
  info = next;
  for (const listener of listeners) listener();
}

/** Trigger tokens of habits that can run; a paused habit's URL answers 404. */
export function habitWebhookTokens(habits: readonly Habit[]): string[] {
  return habits.flatMap((habit) =>
    habit.enabled && habit.triggerToken ? [habit.triggerToken] : [],
  );
}

/** Opens the local listener for these tokens, or closes it when there are none. */
export async function syncHabitWebhook(
  tokens: readonly string[],
): Promise<HabitWebhookInfo> {
  const unique = [...new Set(tokens)].sort();
  try {
    const next = await invoke<HabitWebhookInfo>("habit_webhook_sync", {
      tokens: unique,
    });
    setInfo({ port: next.port ?? null, error: next.error ?? null });
  } catch (error) {
    setInfo({
      port: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return info;
}

/**
 * Requests a run of the habit the token belongs to. Returns whether one was
 * found; a paused habit's trigger is ignored.
 */
export async function fireHabitWebhook(
  event: HabitWebhookEvent,
  irgatIds: readonly string[],
): Promise<boolean> {
  for (const irgatId of irgatIds) {
    const owned = (await loadHabits(irgatId)).some(
      (habit) => habit.triggerToken === event.token,
    );
    if (!owned) continue;
    const fired = await updateHabits(irgatId, (habits) => {
      let hit = false;
      const next = habits.map((habit) => {
        if (habit.triggerToken !== event.token) return habit;
        const triggered = triggerHabit(habit, {
          source: "webhook",
          at: event.receivedAt || Date.now(),
          ...(event.payload ? { payload: event.payload } : {}),
        });
        if (!triggered) return habit;
        hit = true;
        return triggered;
      });
      return { habits: hit ? next : habits, result: hit };
    });
    if (fired) checkHabitsNow();
    return fired;
  }
  return false;
}
