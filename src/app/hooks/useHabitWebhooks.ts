import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { listIrgats } from "../../features/irgats/model/irgat";
import { subscribeIrgatFiles } from "../../features/irgats/model/irgatFiles";
import { loadHabits } from "../../features/irgats/model/irgatHabits";
import {
  fireHabitWebhook,
  HABIT_WEBHOOK_EVENT,
  habitWebhookTokens,
  syncHabitWebhook,
  type HabitWebhookEvent,
} from "../../features/irgats/model/habitWebhook";

const RESYNC_MS = 60_000;

/**
 * Keeps the local trigger listener open for the habits that have a trigger
 * URL, and turns each hit into a requested run the scheduler picks up.
 */
export function useHabitWebhooks(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let syncing = false;
    let again = false;
    const sync = async () => {
      if (syncing) {
        again = true;
        return;
      }
      syncing = true;
      try {
        do {
          again = false;
          const lists = await Promise.all(
            listIrgats().map(({ id }) => loadHabits(id).catch(() => [])),
          );
          if (disposed) return;
          await syncHabitWebhook(lists.flatMap(habitWebhookTokens));
        } while (again && !disposed);
      } finally {
        syncing = false;
      }
    };
    void sync();
    const stopFiles = subscribeIrgatFiles(() => void sync());
    const timer = window.setInterval(() => void sync(), RESYNC_MS);
    let unlisten: (() => void) | undefined;
    void listen<HabitWebhookEvent>(HABIT_WEBHOOK_EVENT, (event) => {
      void fireHabitWebhook(
        event.payload,
        listIrgats().map(({ id }) => id),
      ).catch((error) =>
        console.warn("Could not start the habit from its trigger", error),
      );
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) =>
        console.warn("Could not listen for habit triggers", error),
      );
    return () => {
      disposed = true;
      stopFiles();
      window.clearInterval(timer);
      unlisten?.();
    };
  }, [enabled]);
}
