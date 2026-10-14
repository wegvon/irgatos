import { describe, expect, it } from "vitest";
import { newSession, type Session } from "./session";
import {
  formatUsageLimitReset,
  mergeUsageLimitError,
  USAGE_LIMIT_RESUME_GRACE_MS,
  usageLimitResumeDue,
  usageLimitFromError,
  resumeUsageLimitedSession,
} from "./usageLimit";

function limited(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("codex", "/tmp/project"),
    usageLimit: { resetsAt: 10_000, resumeAtReset: true },
    ...patch,
  };
}

describe("usageLimitResumeDue", () => {
  it("waits for the reset plus a grace period", () => {
    expect(usageLimitResumeDue(limited(), 10_000)).toBe(false);
    expect(
      usageLimitResumeDue(limited(), 10_000 + USAGE_LIMIT_RESUME_GRACE_MS),
    ).toBe(true);
  });

  it("only resumes idle sessions the user armed", () => {
    const later = 10_000 + USAGE_LIMIT_RESUME_GRACE_MS;
    expect(usageLimitResumeDue(limited({ busy: true }), later)).toBe(false);
    expect(
      usageLimitResumeDue(limited({ usageLimit: { resetsAt: 10_000 } }), later),
    ).toBe(false);
    expect(
      usageLimitResumeDue(
        limited({ usageLimit: { resumeAtReset: true } }),
        later,
      ),
    ).toBe(false);
  });
});

describe("provider error fallback", () => {
  it.each([
    "You've hit your usage limit.",
    "Quota exceeded for this account",
    "insufficient_quota",
    "Credit balance is too low",
    "Monthly limit exceeded",
  ])("recognizes an exhausted account: %s", (message) => {
    expect(usageLimitFromError(message)).toEqual({});
  });

  it.each([
    "429: rate limit exceeded, retry in 3 seconds",
    "Server overloaded",
    "Context window exceeded",
    "Invalid API key",
    "Network timeout",
  ])("keeps other failures out of usage recovery: %s", (message) => {
    expect(usageLimitFromError(message)).toBeUndefined();
  });

  it("reads the reset time when the error gives one", () => {
    const now = 1_760_420_000_000;
    expect(
      usageLimitFromError("Claude AI usage limit reached|1760430000", now),
    ).toEqual({ resetsAt: 1_760_430_000_000 });
    expect(
      usageLimitFromError("You've hit your usage limit. Try again in 2h.", now),
    ).toEqual({ resetsAt: now + 2 * 3_600_000 });
  });

  it("treats a long rate-limit wait as a limit with its reset", () => {
    expect(
      usageLimitFromError("429 Too Many Requests. Retry-After: 900", 0),
    ).toEqual({ resetsAt: 900_000 });
  });
});

describe("mergeUsageLimitError", () => {
  it("starts a limit from the error when none was known", () => {
    expect(mergeUsageLimitError(undefined, "Quota exceeded", 0)).toEqual({});
    expect(mergeUsageLimitError(undefined, "Invalid API key", 0)).toBeUndefined();
  });

  it("fills in a missing reset without losing the user's choice", () => {
    expect(
      mergeUsageLimitError(
        { resumeAtReset: true },
        "usage limit reached, try again in 30 minutes",
        1_000,
      ),
    ).toEqual({ resumeAtReset: true, resetsAt: 1_000 + 30 * 60_000 });
  });

  it("keeps a reset the provider already reported", () => {
    const known = { resetsAt: 5_000, resumeAtReset: false };
    expect(mergeUsageLimitError(known, "try again in 30 minutes", 1_000)).toBe(
      known,
    );
    const unknown = { resumeAtReset: true };
    expect(mergeUsageLimitError(unknown, "Claude Code exited", 1_000)).toBe(
      unknown,
    );
  });
});

it("only releases the outbox of an idle usage-limited session", () => {
  const session = limited({
    queueStatus: "paused",
    queuedMessages: [
      {
        id: "head",
        text: "Check tests",
        attachments: [],
        error: "Quota exceeded",
      },
    ],
  });
  const resumed = resumeUsageLimitedSession(session);
  expect(resumed.usageLimit).toBeUndefined();
  expect(resumed.queueStatus).toBe("active");
  expect(resumed.queuedMessages).toEqual([
    { id: "head", text: "Check tests", attachments: [], error: undefined },
  ]);
  expect(resumeUsageLimitedSession({ ...session, busy: true }).usageLimit).toBe(
    session.usageLimit,
  );
  const ordinary = { ...session, usageLimit: undefined };
  expect(resumeUsageLimitedSession(ordinary)).toBe(ordinary);
});

describe("formatUsageLimitReset", () => {
  it("shows the time and what is left", () => {
    const now = new Date(2026, 8, 25, 22, 34).getTime();
    const today = new Date(2026, 8, 25, 23, 50).getTime();
    expect(formatUsageLimitReset(today, now)).toMatch(/ · in 1h 16m$/);
    const tomorrow = new Date(2026, 8, 26, 3, 16).getTime();
    expect(formatUsageLimitReset(tomorrow, now)).toMatch(/26.* · in 4h 42m$/);
  });
});
