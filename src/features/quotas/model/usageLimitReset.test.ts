import { describe, expect, it } from "vitest";
import {
  detectUsageLimit,
  MIN_RATE_LIMIT_HOLD_MS,
  nextWallClock,
  parseUsageLimitReset,
} from "./usageLimitReset";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 9, 14, 12, 0);

describe("detectUsageLimit", () => {
  it.each([
    "You've hit your usage limit.",
    "Quota exceeded for this account",
    "insufficient_quota",
    "Credit balance is too low",
    "Monthly limit exceeded",
    "Weekly limit reached",
    "5-hour limit reached",
    "You are out of credits",
    'codex error: {"type":"usageLimitExceeded"}',
  ])("treats an exhausted plan as a usage limit: %s", (message) => {
    expect(detectUsageLimit(message, NOW)).toEqual({ kind: "usage" });
  });

  it.each([
    "429: rate limit exceeded, retry in 3 seconds",
    "Too many requests. Retry-After: 30",
    "rate_limit_error",
    "Server overloaded",
    "Context window exceeded",
    "Invalid API key",
    "Network timeout",
    "",
  ])("leaves short retries and other failures alone: %s", (message) => {
    expect(detectUsageLimit(message, NOW)).toBeUndefined();
  });

  it("holds for a rate limit only when the wait is long", () => {
    expect(
      detectUsageLimit("Rate limit exceeded. Retry-After: 600", NOW),
    ).toEqual({ kind: "rate", resetAt: NOW + 10 * MINUTE });
    expect(
      detectUsageLimit("429 Too Many Requests; retry after 2 hours", NOW),
    ).toEqual({ kind: "rate", resetAt: NOW + 2 * HOUR });
    const justUnder = (MIN_RATE_LIMIT_HOLD_MS - 1_000) / 1_000;
    expect(
      detectUsageLimit(`rate limited, Retry-After: ${justUnder}`, NOW),
    ).toBeUndefined();
  });

  it("carries the reset time with a usage limit", () => {
    expect(
      detectUsageLimit("You've hit your usage limit. Try again in 4h 42m.", NOW),
    ).toEqual({ kind: "usage", resetAt: NOW + 4 * HOUR + 42 * MINUTE });
  });
});

describe("parseUsageLimitReset", () => {
  it("reads Claude's epoch suffix in seconds and milliseconds", () => {
    const now = 1_760_420_000_000;
    expect(
      parseUsageLimitReset("Claude AI usage limit reached|1760430000", now),
    ).toBe(1_760_430_000_000);
    expect(
      parseUsageLimitReset("usage limit reached|1760430000123", now),
    ).toBe(1_760_430_000_123);
  });

  it("reads JSON reset fields", () => {
    const now = 1_760_420_000_000;
    expect(
      parseUsageLimitReset(
        '{"error":{"type":"usage_limit_exceeded","resets_at":1760430000}}',
        now,
      ),
    ).toBe(1_760_430_000_000);
    expect(parseUsageLimitReset('{"resetAt": 1760430000000}', now)).toBe(
      1_760_430_000_000,
    );
  });

  it("reads ISO timestamps with and without a zone", () => {
    expect(
      parseUsageLimitReset(
        "Usage limit reached. Try again at 2026-10-14T18:30:00Z.",
        NOW,
      ),
    ).toBe(Date.UTC(2026, 9, 14, 18, 30));
    expect(
      parseUsageLimitReset("resets 2026-10-14 18:30:00+03:00", NOW),
    ).toBe(Date.UTC(2026, 9, 14, 15, 30));
  });

  it("reads relative waits, spaced and compact", () => {
    expect(parseUsageLimitReset("try again in 4h 42m", NOW)).toBe(
      NOW + 4 * HOUR + 42 * MINUTE,
    );
    expect(parseUsageLimitReset("retry in 1h2m3s", NOW)).toBe(
      NOW + HOUR + 2 * MINUTE + 3_000,
    );
    expect(
      parseUsageLimitReset("wait 2 hours and 15 minutes", NOW),
    ).toBe(NOW + 2 * HOUR + 15 * MINUTE);
    expect(parseUsageLimitReset("resets in 3 days", NOW)).toBe(
      NOW + 3 * 24 * HOUR,
    );
  });

  it("reads Retry-After in seconds", () => {
    expect(parseUsageLimitReset("Retry-After: 120", NOW)).toBe(
      NOW + 120_000,
    );
  });

  it("reads a wall-clock time in a named zone", () => {
    expect(
      parseUsageLimitReset("You've hit your limit · resets 3pm (UTC)", NOW),
    ).toBe(Date.UTC(2026, 9, 14, 15, 0));
    expect(
      parseUsageLimitReset(
        "Claude usage limit reached. Your limit resets Oct 15, 9:30 AM (Europe/Istanbul)",
        NOW,
      ),
    ).toBe(Date.UTC(2026, 9, 15, 6, 30));
  });

  it("rolls a time that already passed today to tomorrow", () => {
    const afternoon = Date.UTC(2026, 9, 14, 16, 0);
    expect(parseUsageLimitReset("resets 3pm (UTC)", afternoon)).toBe(
      Date.UTC(2026, 9, 15, 15, 0),
    );
  });

  it("reads a wall-clock time in the local zone", () => {
    const now = new Date(2026, 9, 14, 12, 0).getTime();
    expect(
      parseUsageLimitReset("usage limit reached, try again at 5:00 PM", now),
    ).toBe(new Date(2026, 9, 14, 17, 0).getTime());
    expect(parseUsageLimitReset("available after 18:45", now)).toBe(
      new Date(2026, 9, 14, 18, 45).getTime(),
    );
  });

  it("ignores bare numbers, invalid clocks and implausible resets", () => {
    expect(parseUsageLimitReset("try again 3 times", NOW)).toBeUndefined();
    expect(parseUsageLimitReset("resets 13pm", NOW)).toBeUndefined();
    expect(parseUsageLimitReset("resets 10:75", NOW)).toBeUndefined();
    const farAway = Math.floor((NOW + 90 * 24 * HOUR) / 1_000);
    expect(
      parseUsageLimitReset(`usage limit reached|${farAway}`, NOW),
    ).toBeUndefined();
    expect(
      parseUsageLimitReset("usage limit reached|1000000000", NOW),
    ).toBeUndefined();
    expect(parseUsageLimitReset("Usage limit reached.", NOW)).toBeUndefined();
  });

  it("falls back to the local zone for an unknown zone name", () => {
    const now = new Date(2026, 9, 14, 12, 0).getTime();
    expect(parseUsageLimitReset("resets 3pm (Mars/Olympus)", now)).toBe(
      new Date(2026, 9, 14, 15, 0).getTime(),
    );
  });
});

describe("nextWallClock", () => {
  it("rolls a dated time that already passed to next year", () => {
    expect(
      nextWallClock({ hour: 9, minute: 0, month: 0, day: 2, zone: "UTC" }, NOW),
    ).toBe(Date.UTC(2027, 0, 2, 9, 0));
  });

  it("keeps a dated time later this year", () => {
    expect(
      nextWallClock(
        { hour: 9, minute: 0, month: 10, day: 2, zone: "UTC" },
        NOW,
      ),
    ).toBe(Date.UTC(2026, 10, 2, 9, 0));
  });

  it("honors daylight saving in the named zone", () => {
    // New York is on EDT (UTC-4) in October and EST (UTC-5) in December.
    expect(
      nextWallClock(
        { hour: 15, minute: 0, zone: "America/New_York" },
        NOW,
      ),
    ).toBe(Date.UTC(2026, 9, 14, 19, 0));
    expect(
      nextWallClock(
        { hour: 15, minute: 0, month: 11, day: 1, zone: "America/New_York" },
        NOW,
      ),
    ).toBe(Date.UTC(2026, 11, 1, 20, 0));
  });
});
