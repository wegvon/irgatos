import { describe, expect, it, vi } from "vitest";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import {
  automationHoldId,
  DEFAULT_USAGE_LIMIT_FALLBACK_MS,
  formatHoldCountdown,
  heldUntilLabel,
  holdKey,
  queueHold,
  USAGE_LIMIT_HOLDS_KEY,
  UsageLimitRegistry,
  type UsageLimitRegistryOptions,
} from "./usageLimitRegistry";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 9, 14, 12, 0);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function setup(options: Partial<UsageLimitRegistryOptions> = {}) {
  let now = T0;
  const timers: { callback: () => void; ms: number; id: number }[] = [];
  let nextId = 1;
  const storage = memoryStorage();
  const registry = new UsageLimitRegistry({
    storage,
    now: () => now,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.push({ callback, ms, id });
      return id;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    ...options,
  });
  return {
    registry,
    storage,
    timers,
    advance(ms: number) {
      now += ms;
    },
    /** Fire the pending timer the way the runtime would. */
    fire() {
      const timer = timers.shift();
      timer?.callback();
      return timer;
    },
    get now() {
      return now;
    },
  };
}

function limits(
  provider: ProviderRateLimits["provider"],
  patch: Partial<ProviderRateLimits> = {},
): ProviderRateLimits {
  return {
    provider,
    session: null,
    weekly: null,
    monthly: null,
    resetCredits: null,
    updatedAt: T0,
    error: null,
    status: "ok",
    ...patch,
  };
}

describe("holds", () => {
  it("keys holds per harness and account", () => {
    const { registry } = setup();
    registry.hold({ harness: "claude", accountId: "work", resetAt: T0 + HOUR, source: "session" });
    expect(holdKey("claude", "work")).toBe("claude:work");
    expect(holdKey("codex")).toBe("codex:default");
    expect(registry.get("claude", "work")?.resetAt).toBe(T0 + HOUR);
    expect(registry.get("claude")).toBeUndefined();
    expect(registry.get("codex", "work")).toBeUndefined();
  });

  it("files a hold without an account under the default login", () => {
    const { registry } = setup();
    const hold = registry.hold({ harness: "codex", resetAt: T0 + HOUR, source: "error" });
    expect(hold).toMatchObject({
      key: "codex:default",
      accountId: "default",
      exact: true,
      since: T0,
      source: "error",
    });
    expect(registry.get("codex", "default")).toBe(hold);
  });

  it("uses the fallback window when the provider never says", () => {
    const { registry } = setup({ fallbackMs: () => 15 * MINUTE });
    const hold = registry.hold({ harness: "claude", source: "session" });
    expect(hold).toMatchObject({ resetAt: T0 + 15 * MINUTE, exact: false });
  });

  it("defaults the fallback window to an hour", () => {
    const registry = new UsageLimitRegistry({ now: () => T0 });
    expect(registry.hold({ harness: "claude", source: "session" })?.resetAt).toBe(
      T0 + DEFAULT_USAGE_LIMIT_FALLBACK_MS,
    );
    registry.dispose();
  });

  it("ignores a reset that already passed", () => {
    const { registry } = setup();
    expect(
      registry.hold({ harness: "claude", resetAt: T0 - 1, source: "session" }),
    ).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it("lets the provider's exact time replace a guess, never the reverse", () => {
    const { registry } = setup();
    registry.hold({ harness: "claude", source: "session" });
    const exact = registry.hold({ harness: "claude", resetAt: T0 + 20 * MINUTE, source: "error" });
    expect(exact).toMatchObject({ resetAt: T0 + 20 * MINUTE, exact: true });
    const guess = registry.hold({ harness: "claude", source: "session" });
    expect(guess).toBe(exact);
  });

  it("keeps the longer of two guesses", () => {
    let fallback = 30 * MINUTE;
    const { registry } = setup({ fallbackMs: () => fallback });
    registry.hold({ harness: "claude", source: "session" });
    fallback = 10 * MINUTE;
    expect(registry.hold({ harness: "claude", source: "session" })?.resetAt).toBe(
      T0 + 30 * MINUTE,
    );
    fallback = 2 * HOUR;
    expect(registry.hold({ harness: "claude", source: "session" })?.resetAt).toBe(
      T0 + 2 * HOUR,
    );
  });

  it("takes a fresh exact time over an older one and keeps when it began", () => {
    const env = setup();
    env.registry.hold({ harness: "codex", resetAt: T0 + HOUR, source: "error" });
    env.advance(5 * MINUTE);
    const later = env.registry.hold({ harness: "codex", resetAt: T0 + 3 * HOUR, source: "quota" });
    expect(later).toMatchObject({ resetAt: T0 + 3 * HOUR, since: T0, source: "quota" });
  });

  it("notifies once per real change and keeps the snapshot stable otherwise", () => {
    const { registry } = setup();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const before = registry.snapshot();
    expect(registry.snapshot()).toBe(before);
    registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.snapshot()).not.toBe(before);
    expect(registry.snapshot().holds).toHaveLength(1);
    unsubscribe();
    registry.release("claude");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("releases on Resume now", () => {
    const { registry } = setup();
    registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    expect(registry.release("claude")).toBe(true);
    expect(registry.release("claude")).toBe(false);
    expect(registry.get("claude")).toBeUndefined();
  });

  it("lifts a hold when a turn started after it succeeds", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    expect(env.registry.noteSuccess("claude", undefined, T0 - MINUTE)).toBe(false);
    expect(env.registry.get("claude")).toBeDefined();
    expect(env.registry.noteSuccess("codex", undefined, T0 + MINUTE)).toBe(false);
    expect(env.registry.noteSuccess("claude", "default", T0 + MINUTE)).toBe(true);
    expect(env.registry.get("claude")).toBeUndefined();
  });

  it("expires by itself once the reset passes", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", resetAt: T0 + 90_000, source: "session" });
    const listener = vi.fn();
    env.registry.subscribe(listener);
    expect(env.timers).toHaveLength(1);
    expect(env.timers[0].ms).toBe(60_000);
    env.advance(60_000);
    env.fire();
    expect(env.registry.get("claude")).toBeDefined();
    expect(listener).not.toHaveBeenCalled();
    expect(env.timers[0].ms).toBe(30_000);
    env.advance(30_000);
    env.fire();
    expect(env.registry.get("claude")).toBeUndefined();
    expect(env.registry.snapshot().holds).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(env.timers).toHaveLength(0);
  });

  it("reports the earliest expiry across holds", () => {
    const { registry } = setup();
    expect(registry.nextExpiry()).toBeUndefined();
    registry.hold({ harness: "claude", resetAt: T0 + 2 * HOUR, source: "session" });
    registry.hold({ harness: "codex", resetAt: T0 + HOUR, source: "session" });
    expect(registry.nextExpiry()).toBe(T0 + HOUR);
    expect(registry.list().map((hold) => hold.key).sort()).toEqual([
      "claude:default",
      "codex:default",
    ]);
  });

  it("prunes only holds whose window passed", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    env.registry.hold({ harness: "codex", resetAt: T0 + 2 * HOUR, source: "session" });
    expect(env.registry.prune(T0 + 30 * MINUTE)).toBe(false);
    expect(env.registry.prune(T0 + HOUR)).toBe(true);
    expect(env.registry.snapshot().holds.map((hold) => hold.harness)).toEqual(["codex"]);
  });
});

describe("persistence", () => {
  it("saves holds and restores the ones still active", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", accountId: "work", resetAt: T0 + HOUR, source: "session", sessionId: "s1" });
    env.registry.hold({ harness: "codex", resetAt: T0 + 2 * MINUTE, source: "error" });
    const saved = env.storage.data.get(USAGE_LIMIT_HOLDS_KEY);
    expect(saved).toBeDefined();
    const restored = new UsageLimitRegistry({
      storage: memoryStorage({ [USAGE_LIMIT_HOLDS_KEY]: saved! }),
      now: () => T0 + 10 * MINUTE,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    expect(restored.snapshot().holds).toEqual([
      {
        key: "claude:work",
        harness: "claude",
        accountId: "work",
        resetAt: T0 + HOUR,
        exact: true,
        since: T0,
        source: "session",
        sessionId: "s1",
      },
    ]);
  });

  it("clears storage when the last hold goes", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    env.registry.release("claude");
    expect(env.storage.data.has(USAGE_LIMIT_HOLDS_KEY)).toBe(false);
  });

  it("survives corrupt or odd storage", () => {
    const corrupt = new UsageLimitRegistry({
      storage: memoryStorage({ [USAGE_LIMIT_HOLDS_KEY]: "{not json" }),
      now: () => T0,
    });
    expect(corrupt.snapshot().holds).toEqual([]);
    const odd = new UsageLimitRegistry({
      storage: memoryStorage({
        [USAGE_LIMIT_HOLDS_KEY]: JSON.stringify([
          null,
          { harness: "claude" },
          { harness: "codex", resetAt: T0 + HOUR, source: "bogus" },
        ]),
      }),
      now: () => T0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    expect(odd.snapshot().holds).toEqual([
      {
        key: "codex:default",
        harness: "codex",
        accountId: "default",
        resetAt: T0 + HOUR,
        exact: false,
        since: T0 + HOUR,
        source: "session",
      },
    ]);
  });

  it("keeps working when storage throws", () => {
    const registry = new UsageLimitRegistry({
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
      now: () => T0,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    expect(
      registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" }),
    ).toBeDefined();
    expect(registry.get("claude")).toBeDefined();
  });
});

describe("syncQuota", () => {
  it("holds a provider whose usage window is used up", () => {
    const { registry } = setup();
    registry.syncQuota({
      "claude:work": limits("claude", {
        session: { usedPercent: 100, windowMinutes: 300, resetsAt: T0 + 3 * HOUR },
        weekly: { usedPercent: 40, windowMinutes: 10_080, resetsAt: T0 + 48 * HOUR },
      }),
      "codex:default": limits("codex", {
        session: { usedPercent: 80, windowMinutes: 300, resetsAt: T0 + HOUR },
      }),
      "devin:default": limits("devin", { status: "error" }),
    });
    expect(registry.get("claude", "work")).toMatchObject({
      resetAt: T0 + 3 * HOUR,
      exact: true,
      source: "quota",
    });
    expect(registry.get("codex")).toBeUndefined();
    expect(registry.get("devin")).toBeUndefined();
  });

  it("waits for the later window when several are spent", () => {
    const { registry } = setup();
    registry.syncQuota({
      "codex:default": limits("codex", {
        session: { usedPercent: 100, windowMinutes: 300, resetsAt: T0 + HOUR },
        weekly: { usedPercent: 100, windowMinutes: 10_080, resetsAt: T0 + 30 * HOUR },
      }),
    });
    expect(registry.get("codex")?.resetAt).toBe(T0 + 30 * HOUR);
  });

  it("lifts a quota hold once a fresh reading has room again", () => {
    const env = setup();
    env.registry.syncQuota({
      "claude:default": limits("claude", {
        session: { usedPercent: 100, windowMinutes: 300, resetsAt: T0 + HOUR },
      }),
    });
    env.registry.syncQuota({
      "claude:default": limits("claude", {
        session: { usedPercent: 10, windowMinutes: 300, resetsAt: T0 + 5 * HOUR },
        updatedAt: T0,
      }),
    });
    expect(env.registry.get("claude")).toBeDefined();
    env.registry.syncQuota({
      "claude:default": limits("claude", {
        session: { usedPercent: 10, windowMinutes: 300, resetsAt: T0 + 5 * HOUR },
        updatedAt: T0 + MINUTE,
      }),
    });
    expect(env.registry.get("claude")).toBeUndefined();
  });

  it("never lifts a hold that came from the agent itself", () => {
    const { registry } = setup();
    registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    registry.syncQuota({
      "claude:default": limits("claude", { updatedAt: T0 + MINUTE }),
    });
    expect(registry.get("claude")).toBeDefined();
  });
});

describe("held work", () => {
  const run = (id: string, patch = {}) => ({
    id: automationHoldId(id),
    kind: "automation" as const,
    harness: "claude" as const,
    accountId: "default",
    label: "Nightly triage",
    ownerId: "auto-1",
    ...patch,
  });

  it("parks work and hands it back when the hold ends", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    env.registry.holdWork(run("r1"));
    expect(automationHoldId("r1")).toBe("automation:r1");
    expect(env.registry.heldWork()).toEqual([{ ...run("r1"), heldAt: T0 }]);
    expect(env.registry.takeReadyWork()).toEqual([]);
    env.advance(HOUR);
    expect(env.registry.takeReadyWork()).toEqual([{ ...run("r1"), heldAt: T0 }]);
    expect(env.registry.heldWork()).toEqual([]);
  });

  it("hands work back immediately when its hold is released", () => {
    const { registry } = setup();
    registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    registry.holdWork(run("r1"));
    registry.holdWork(run("r2", { harness: "codex" }));
    registry.release("claude");
    expect(registry.takeReadyWork().map((item) => item.id)).toEqual([
      "automation:r1",
      "automation:r2",
    ]);
  });

  it("releases forced work even while the hold stands", () => {
    const { registry } = setup();
    registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    registry.holdWork(run("r1"));
    registry.holdWork(run("r2"));
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.forceWork("automation:r1");
    registry.forceWork("automation:r1");
    registry.forceWork("missing");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.takeReadyWork()).toEqual([
      { ...run("r1"), heldAt: T0, force: true },
    ]);
    expect(registry.heldWork().map((item) => item.id)).toEqual(["automation:r2"]);
  });

  it("keeps the original park time when work is parked again", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    env.registry.holdWork(run("r1"));
    env.advance(5 * MINUTE);
    env.registry.holdWork(run("r1", { label: "Renamed" }));
    expect(env.registry.heldWork()).toEqual([
      { ...run("r1", { label: "Renamed" }), heldAt: T0 },
    ]);
  });

  it("drops work the user deleted", () => {
    const { registry } = setup();
    registry.holdWork(run("r1"));
    registry.dropWork("automation:r1");
    registry.dropWork("automation:r1");
    expect(registry.heldWork()).toEqual([]);
  });

  it("does not persist held work", () => {
    const env = setup();
    env.registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    env.registry.holdWork(run("r1"));
    const saved = JSON.parse(env.storage.data.get(USAGE_LIMIT_HOLDS_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0].key).toBe("claude:default");
  });
});

describe("queueHold", () => {
  it("lets a queue run anyway past the hold it was told to, not a later one", () => {
    const env = setup();
    const first = env.registry.hold({ harness: "claude", resetAt: T0 + HOUR, source: "session" });
    expect(queueHold(first, undefined)).toBe(first);
    expect(queueHold(first, first!.since)).toBeUndefined();
    expect(queueHold(undefined, undefined)).toBeUndefined();
    env.registry.release("claude");
    env.advance(MINUTE);
    const second = env.registry.hold({ harness: "claude", resetAt: T0 + 2 * HOUR, source: "session" });
    expect(queueHold(second, first!.since)).toBe(second);
  });
});

describe("formatting", () => {
  it("counts down precisely enough to watch", () => {
    expect(formatHoldCountdown(0)).toBe("0s");
    expect(formatHoldCountdown(-5_000)).toBe("0s");
    expect(formatHoldCountdown(12_000)).toBe("12s");
    expect(formatHoldCountdown(4 * MINUTE + 9_000)).toBe("4m 09s");
    expect(formatHoldCountdown(2 * HOUR + 5 * MINUTE)).toBe("2h 05m");
    expect(formatHoldCountdown(50 * HOUR)).toBe("2d 2h");
    expect(formatHoldCountdown(500)).toBe("1s");
  });

  it("labels paused work with the reset time", () => {
    const now = new Date(2026, 9, 14, 1, 0).getTime();
    const label = heldUntilLabel(new Date(2026, 9, 14, 3, 16).getTime(), now);
    expect(label).toMatch(/^Paused until quota reset \(.*3:16.*\)$/);
    const tomorrow = heldUntilLabel(new Date(2026, 9, 15, 3, 16).getTime(), now);
    expect(tomorrow).toMatch(/Oct/);
  });
});
