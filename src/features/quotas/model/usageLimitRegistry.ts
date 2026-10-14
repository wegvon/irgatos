import {
  exhaustedWindowResetAt,
  type ProviderRateLimits,
} from "../../providers/model/rateLimits";
import type { HarnessId } from "../../sessions/model/session";

/**
 * Which providers are out of quota right now, and until when. A hold is per
 * harness and account: one Claude profile running dry does not stop another.
 * Scheduled work aimed at a held provider waits here instead of failing, and
 * is handed back once the hold ends or the user says to run it anyway.
 */

export const DEFAULT_ACCOUNT = "default";

export type UsageLimitSource = "session" | "error" | "quota" | "manual";

export type UsageLimitHold = {
  key: string;
  harness: HarnessId;
  accountId: string;
  /** Epoch ms when the provider's window resets, or our best guess. */
  resetAt: number;
  /** False when the provider never said; `resetAt` is the fallback window. */
  exact: boolean;
  /** When the hold began. A turn that succeeds after this lifts it. */
  since: number;
  source: UsageLimitSource;
  /** The session whose turn ran into the limit, when one did. */
  sessionId?: string;
};

export type HoldInput = {
  harness: HarnessId;
  accountId?: string;
  resetAt?: number;
  source: UsageLimitSource;
  sessionId?: string;
};

export type HeldWorkKind = "automation";

/** A scheduled run parked until its provider's hold ends. */
export type HeldWork = {
  id: string;
  kind: HeldWorkKind;
  harness: HarnessId;
  accountId: string;
  label: string;
  /** What the work belongs to, e.g. the automation id. */
  ownerId?: string;
  heldAt: number;
  /** The user chose Run anyway; release on the next drain. */
  force?: boolean;
};

export type UsageLimitSnapshot = {
  holds: readonly UsageLimitHold[];
  work: readonly HeldWork[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type UsageLimitRegistryOptions = {
  storage?: StorageLike | null;
  storageKey?: string;
  now?: () => number;
  /** Used when a provider stops us without saying when it resets. */
  fallbackMs?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const USAGE_LIMIT_HOLDS_KEY = "irgat.usageLimitHolds.v1";
export const DEFAULT_USAGE_LIMIT_FALLBACK_MS = 60 * 60_000;
/** Timers drift while the machine sleeps; never wait longer than this. */
const MAX_TIMER_MS = 60_000;

export function holdKey(harness: HarnessId, accountId?: string): string {
  return `${harness}:${accountId || DEFAULT_ACCOUNT}`;
}

/** Held-work id for one claimed automation run. */
export function automationHoldId(runId: string): string {
  return `automation:${runId}`;
}

export class UsageLimitRegistry {
  private holds = new Map<string, UsageLimitHold>();
  private work = new Map<string, HeldWork>();
  private listeners = new Set<() => void>();
  private current: UsageLimitSnapshot = { holds: [], work: [] };
  private timer: unknown = null;
  private readonly storage: StorageLike | null;
  private readonly storageKey: string;
  private readonly clock: () => number;
  private readonly fallbackMs: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: UsageLimitRegistryOptions = {}) {
    this.storage = options.storage ?? null;
    this.storageKey = options.storageKey ?? USAGE_LIMIT_HOLDS_KEY;
    this.clock = options.now ?? Date.now;
    this.fallbackMs =
      options.fallbackMs ?? (() => DEFAULT_USAGE_LIMIT_FALLBACK_MS);
    this.setTimer =
      options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.load();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between changes, for `useSyncExternalStore`. */
  snapshot = (): UsageLimitSnapshot => this.current;

  /** The provider's active hold, if it is still in its window. */
  get(
    harness: HarnessId,
    accountId?: string,
    now = this.clock(),
  ): UsageLimitHold | undefined {
    const hold = this.holds.get(holdKey(harness, accountId));
    return hold && hold.resetAt > now ? hold : undefined;
  }

  list(now = this.clock()): UsageLimitHold[] {
    return [...this.holds.values()].filter((hold) => hold.resetAt > now);
  }

  /**
   * Hold a provider until its reset. Without a reset time the fallback window
   * applies; an exact time from the provider always wins over a guess.
   */
  hold(input: HoldInput, now = this.clock()): UsageLimitHold | undefined {
    const key = holdKey(input.harness, input.accountId);
    const exact = input.resetAt != null;
    const resetAt = input.resetAt ?? now + this.fallbackMs();
    if (resetAt <= now) return this.get(input.harness, input.accountId, now);
    const existing = this.get(input.harness, input.accountId, now);
    if (existing) {
      // A guess never overrides the provider's word; between guesses the
      // longer wait stands, and a fresh exact time replaces an older one.
      const keep = exact
        ? existing.exact && existing.resetAt === resetAt
        : existing.exact || existing.resetAt >= resetAt;
      if (keep) return existing;
    }
    const hold: UsageLimitHold = {
      key,
      harness: input.harness,
      accountId: input.accountId || DEFAULT_ACCOUNT,
      resetAt,
      exact,
      since: existing?.since ?? now,
      source: input.source,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };
    this.holds.set(key, hold);
    this.changed(true);
    return hold;
  }

  /** Lift the hold now: "Resume now", or the provider proved it works. */
  release(harness: HarnessId, accountId?: string): boolean {
    const removed = this.holds.delete(holdKey(harness, accountId));
    if (removed) this.changed(true);
    return removed;
  }

  /** A turn that started after the hold began and finished fine lifts it. */
  noteSuccess(
    harness: HarnessId,
    accountId: string | undefined,
    turnStartedAt: number,
  ): boolean {
    const hold = this.holds.get(holdKey(harness, accountId));
    if (!hold || hold.since >= turnStartedAt) return false;
    return this.release(harness, accountId);
  }

  /**
   * Mirror the usage meters: an exhausted window holds its provider until the
   * window resets, and a fresh reading that is no longer exhausted lifts a
   * hold that came from the meters.
   */
  syncQuota(
    snapshots: Record<string, ProviderRateLimits>,
    now = this.clock(),
  ): void {
    for (const [key, limits] of Object.entries(snapshots)) {
      if (limits.status !== "ok") continue;
      const accountId = key.slice(key.indexOf(":") + 1) || DEFAULT_ACCOUNT;
      const harness = limits.provider as HarnessId;
      const resetAt = exhaustedWindowResetAt(limits);
      if (resetAt != null && resetAt > now) {
        this.hold({ harness, accountId, resetAt, source: "quota" }, now);
        continue;
      }
      const hold = this.holds.get(holdKey(harness, accountId));
      if (hold?.source === "quota" && limits.updatedAt > hold.since) {
        this.release(harness, accountId);
      }
    }
  }

  heldWork(): readonly HeldWork[] {
    return this.current.work;
  }

  holdWork(item: Omit<HeldWork, "heldAt"> & { heldAt?: number }): void {
    const existing = this.work.get(item.id);
    this.work.set(item.id, {
      ...item,
      accountId: item.accountId || DEFAULT_ACCOUNT,
      heldAt: existing?.heldAt ?? item.heldAt ?? this.clock(),
    });
    this.changed(false);
  }

  /** Run anyway: the next drain hands it back even though the hold stands. */
  forceWork(id: string): void {
    const item = this.work.get(id);
    if (!item || item.force) return;
    this.work.set(id, { ...item, force: true });
    this.changed(false);
  }

  dropWork(id: string): void {
    if (this.work.delete(id)) this.changed(false);
  }

  /** Work whose hold is over, or that the user forced, removed and returned. */
  takeReadyWork(now = this.clock()): HeldWork[] {
    const ready = [...this.work.values()].filter(
      (item) => item.force || !this.get(item.harness, item.accountId, now),
    );
    if (!ready.length) return [];
    for (const item of ready) this.work.delete(item.id);
    this.changed(false);
    return ready;
  }

  /** Drop holds whose window has passed; true when any did. */
  prune(now = this.clock()): boolean {
    let pruned = false;
    for (const [key, hold] of this.holds) {
      if (hold.resetAt <= now) {
        this.holds.delete(key);
        pruned = true;
      }
    }
    if (pruned) this.changed(true);
    return pruned;
  }

  /** Earliest moment something here changes on its own. */
  nextExpiry(now = this.clock()): number | undefined {
    let next: number | undefined;
    for (const hold of this.holds.values()) {
      if (hold.resetAt > now) next = Math.min(next ?? hold.resetAt, hold.resetAt);
    }
    return next;
  }

  dispose(): void {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private changed(holdsChanged: boolean): void {
    this.current = {
      holds: [...this.holds.values()],
      work: [...this.work.values()],
    };
    if (holdsChanged) {
      this.save();
      this.schedule();
    }
    for (const listener of [...this.listeners]) listener();
  }

  private schedule(): void {
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
    const now = this.clock();
    const next = this.nextExpiry(now);
    if (next == null) return;
    const wait = Math.max(250, Math.min(next - now, MAX_TIMER_MS));
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (!this.prune()) this.schedule();
    }, wait);
  }

  private load(): void {
    if (!this.storage) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.storage.getItem(this.storageKey) ?? "[]");
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    const now = this.clock();
    for (const raw of parsed) {
      const hold = parseHold(raw);
      if (hold && hold.resetAt > now) this.holds.set(hold.key, hold);
    }
    this.current = { holds: [...this.holds.values()], work: [] };
    this.schedule();
  }

  private save(): void {
    if (!this.storage) return;
    try {
      if (this.holds.size === 0) this.storage.removeItem(this.storageKey);
      else
        this.storage.setItem(
          this.storageKey,
          JSON.stringify([...this.holds.values()]),
        );
    } catch {
      // Quota or private mode: the hold still works for this run.
    }
  }
}

function parseHold(raw: unknown): UsageLimitHold | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const { harness, accountId, resetAt, since, source } = value;
  if (typeof harness !== "string" || typeof resetAt !== "number") return;
  if (!Number.isFinite(resetAt)) return undefined;
  const account = typeof accountId === "string" ? accountId : DEFAULT_ACCOUNT;
  return {
    key: holdKey(harness as HarnessId, account),
    harness: harness as HarnessId,
    accountId: account,
    resetAt,
    exact: value.exact === true,
    since: typeof since === "number" ? since : resetAt,
    source:
      source === "session" ||
      source === "error" ||
      source === "quota" ||
      source === "manual"
        ? source
        : "session",
    ...(typeof value.sessionId === "string"
      ? { sessionId: value.sessionId }
      : {}),
  };
}

/**
 * The hold a session's queued prompts still wait on. Run anyway is tied to
 * the hold it was given for, so a later limit holds the queue again.
 */
export function queueHold(
  hold: UsageLimitHold | undefined,
  override: number | undefined,
): UsageLimitHold | undefined {
  return hold && hold.since !== override ? hold : undefined;
}

/** "3:16 AM" today, "Oct 15, 3:16 AM" on another day. */
export function formatHoldTime(resetAt: number, now: number): string {
  const reset = new Date(resetAt);
  const sameDay = reset.toDateString() === new Date(now).toDateString();
  return reset.toLocaleString(undefined, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Paused until quota reset (3:16 AM)". */
export function heldUntilLabel(resetAt: number, now: number): string {
  return `Paused until quota reset (${formatHoldTime(resetAt, now)})`;
}

/** "2h 05m", "4m 09s", "12s": precise enough to watch tick down. */
export function formatHoldCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}
