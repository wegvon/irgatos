import { formatResetDuration } from "../../providers/model/rateLimits";
import {
  detectUsageLimit,
  parseUsageLimitReset,
} from "../../quotas/model/usageLimitReset";
import type { Session, UsageLimit } from "./session";

/**
 * A fallback for adapters that report exhausted accounts as plain errors,
 * with the reset time when the message gives one.
 */
export function usageLimitFromError(
  message: string,
  now = Date.now(),
): UsageLimit | undefined {
  const detected = detectUsageLimit(message, now);
  if (!detected) return undefined;
  return detected.resetAt != null ? { resetsAt: detected.resetAt } : {};
}

/** Keep a known limit, filling in its reset from the error when it was unknown. */
export function mergeUsageLimitError(
  limit: UsageLimit | undefined,
  message: string,
  now = Date.now(),
): UsageLimit | undefined {
  if (!limit) return usageLimitFromError(message, now);
  if (limit.resetsAt != null) return limit;
  const resetsAt = parseUsageLimitReset(message, now);
  return resetsAt != null ? { ...limit, resetsAt } : limit;
}

/** Release the stopped outbox only when the user chooses to recover. */
export function resumeUsageLimitedSession(session: Session): Session {
  if (!session.usageLimit || session.busy) return session;
  return {
    ...session,
    usageLimit: undefined,
    queueStatus: session.queuedMessages?.length ? "active" : undefined,
    queuedMessages: session.queuedMessages?.map((message) => ({
      ...message,
      error: undefined,
    })),
  };
}

/** Providers can still refuse right at the reset; give them a moment. */
export const USAGE_LIMIT_RESUME_GRACE_MS = 30_000;

/** "3:16 AM · in 4h 42m" today, "Sep 26, 3:16 AM · in 1d 4h" later. */
export function formatUsageLimitReset(resetsAt: number, now: number): string {
  const reset = new Date(resetsAt);
  const sameDay = reset.toDateString() === new Date(now).toDateString();
  const when = reset.toLocaleString(undefined, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
  return `${when} · in ${formatResetDuration(resetsAt - now)}`;
}

/** Idle, armed, and past its reset: time to send the continue turn. */
export function usageLimitResumeDue(session: Session, now: number): boolean {
  const limit = session.usageLimit;
  if (!limit?.resumeAtReset || limit.resetsAt == null || session.busy) {
    return false;
  }
  return now >= limit.resetsAt + USAGE_LIMIT_RESUME_GRACE_MS;
}
