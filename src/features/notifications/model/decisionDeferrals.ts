/**
 * Requests the user put off for now. A deferral only hides the in-app card
 * and holds its banner: it never answers the request, which stays pending in
 * Fleet and keeps blocking its agent (or keeps its harness deadline).
 */
export type DecisionDeferral = {
  /** When the card comes back with a reminder; null waits until the user opens it. */
  remindAt: number | null;
  deferredAt: number;
};

const KEY = "irgatos.decisionDeferrals.v1";
export const DECISION_DEFERRALS_CHANGE = "irgatos:decision-deferrals-change";

let cachedRaw: string | null | undefined;
let cached: Record<string, DecisionDeferral> = {};

export function loadDecisionDeferrals(): Record<string, DecisionDeferral> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    cached =
      parsed && typeof parsed === "object"
        ? Object.fromEntries(
            Object.entries(parsed as Record<string, DecisionDeferral>).filter(
              ([, value]) =>
                value &&
                typeof value.deferredAt === "number" &&
                (value.remindAt === null || typeof value.remindAt === "number"),
            ),
          )
        : {};
  } catch {
    cached = {};
  }
  return cached;
}

function save(next: Record<string, DecisionDeferral>) {
  cached = next;
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(KEY, raw);
    cachedRaw = raw;
  } catch {
    // private mode / quota: the deferral lasts for this run only
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DECISION_DEFERRALS_CHANGE));
  }
}

export function deferDecision(
  key: string,
  remindAt: number | null,
  now = Date.now(),
) {
  save({ ...loadDecisionDeferrals(), [key]: { remindAt, deferredAt: now } });
}

export function clearDecisionDeferral(key: string) {
  const current = loadDecisionDeferrals();
  if (!(key in current)) return;
  const { [key]: _gone, ...rest } = current;
  save(rest);
}

/**
 * Drops deferrals of requests that were answered, denied or expired. Only a
 * loaded session can tell: right after launch, chats are still restoring.
 */
export function pruneDecisionDeferrals(
  pending: ReadonlySet<string>,
  loadedSessionIds: ReadonlySet<string>,
) {
  const current = loadDecisionDeferrals();
  const kept = Object.entries(current).filter(([key]) => {
    if (pending.has(key)) return true;
    const sessionId = decisionKeySession(key);
    return !sessionId || !loadedSessionIds.has(sessionId);
  });
  if (kept.length !== Object.keys(current).length) {
    save(Object.fromEntries(kept));
  }
}

/** Session id inside a `decision:<session>:<kind>:<request>` key. */
export function decisionKeySession(key: string): string | undefined {
  const match = /^decision:(.+):(approval|question):\d+$/.exec(key);
  return match?.[1];
}

/** Deferred now: a reminder still ahead, or no reminder at all. */
export function isDecisionDeferred(
  deferral: DecisionDeferral | undefined,
  now = Date.now(),
): boolean {
  return !!deferral && (deferral.remindAt === null || deferral.remindAt > now);
}

export function subscribeDecisionDeferrals(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener(DECISION_DEFERRALS_CHANGE, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DECISION_DEFERRALS_CHANGE, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export type ReminderChoice = { label: string; remindAt: number | null };

const REMINDER_STEPS = [
  { label: "15 minutes", ms: 15 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "3 hours", ms: 3 * 60 * 60_000 },
];

/**
 * Reminder times worth offering. A timed question goes on without an answer
 * at its deadline, so a reminder after that would come too late.
 */
export function reminderChoices(
  deadline: number | undefined,
  now = Date.now(),
): ReminderChoice[] {
  return REMINDER_STEPS.filter(
    (step) => deadline == null || now + step.ms < deadline,
  ).map((step) => ({ label: `Remind me in ${step.label}`, remindAt: now + step.ms }));
}
