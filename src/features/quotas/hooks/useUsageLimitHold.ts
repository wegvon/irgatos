import { useEffect, useState, useSyncExternalStore } from "react";
import type { HarnessId } from "../../sessions/model/session";
import type {
  HeldWork,
  UsageLimitHold,
  UsageLimitSnapshot,
} from "../model/usageLimitRegistry";
import { holdAccountId, usageLimitRegistry } from "../model/usageLimitStore";

export function useUsageLimitSnapshot(): UsageLimitSnapshot {
  return useSyncExternalStore(
    usageLimitRegistry.subscribe,
    usageLimitRegistry.snapshot,
    usageLimitRegistry.snapshot,
  );
}

/** The provider's hold for this session's account, while it lasts. */
export function useUsageLimitHold(
  harness: HarnessId,
  providerAccountId: string | undefined,
  cwd: string | undefined,
): UsageLimitHold | undefined {
  const snapshot = useUsageLimitSnapshot();
  const accountId = holdAccountId(harness, providerAccountId, cwd);
  // The registry prunes on expiry and publishes, which re-renders here.
  void snapshot;
  return usageLimitRegistry.get(harness, accountId);
}

export function useHeldWork(ownerId?: string): HeldWork[] {
  const snapshot = useUsageLimitSnapshot();
  return ownerId
    ? snapshot.work.filter((item) => item.ownerId === ownerId)
    : [...snapshot.work];
}

/** A clock for countdowns: every second near the end, else every 15s. */
export function useCountdownNow(until: number | undefined): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until == null) return;
    const remaining = until - Date.now();
    if (remaining <= 0) return;
    const step = remaining <= 10 * 60_000 ? 1_000 : 15_000;
    const timer = window.setInterval(() => setNow(Date.now()), step);
    return () => window.clearInterval(timer);
  }, [until, now]);
  return now;
}
