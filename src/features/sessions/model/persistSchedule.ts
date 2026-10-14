/** Quiet time after the last change before pending sessions are saved. */
export const PERSIST_DEBOUNCE_MS = 650;
/** A stream of changes never holds a save back longer than this. */
export const PERSIST_MAX_WAIT_MS = 4_000;
/** How often a running turn's partial reply is saved, so a crash keeps it. */
export const ACTIVE_TURN_SNAPSHOT_MS = 5_000;

/**
 * How long to wait before saving: the debounce, cut short so the first
 * pending change is never older than `maxWait` when it is written.
 */
export function persistDelay(
  pendingSince: number | undefined,
  now: number,
  debounce = PERSIST_DEBOUNCE_MS,
  maxWait = PERSIST_MAX_WAIT_MS,
): number {
  if (pendingSince === undefined) return debounce;
  return Math.max(0, Math.min(debounce, pendingSince + maxWait - now));
}

/** Whether a running turn has gone long enough unsaved to save it now. */
export function activeTurnSnapshotDue(
  lastSnapshotAt: number | undefined,
  now: number,
  interval = ACTIVE_TURN_SNAPSHOT_MS,
): boolean {
  return lastSnapshotAt === undefined || now - lastSnapshotAt >= interval;
}
