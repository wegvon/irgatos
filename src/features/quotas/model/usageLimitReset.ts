/**
 * Reading a provider's usage-limit or rate-limit message: whether it is one,
 * and when the window resets if the message says so.
 */

/** Exhausted plans and accounts: these always mean "wait for the reset". */
const USAGE_LIMIT =
  /(?:usage|spending|monthly|weekly|daily|session|\d+-hour) limit (?:reached|exceeded|hit)|(?:quota|credits?) (?:exceeded|exhausted|depleted)|insufficient[_ ](?:quota|credits)|hit your (?:usage )?limit|credit balance is too low|out of (?:credits|quota)|usage_limit_exceeded|usageLimitExceeded/i;

/**
 * Short-term throttling. The CLIs retry these themselves within seconds, so
 * they only count as a hold when the provider asks for a real wait.
 */
const RATE_LIMIT =
  /rate[ _-]?limit(?:ed|s? reached|s? exceeded|_error|_exceeded)?|too many requests|\b429\b|resource[_ ]exhausted/i;

/** Waits shorter than this are ordinary retries, not a quota hold. */
export const MIN_RATE_LIMIT_HOLD_MS = 60_000;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Resets this far away are a misread, not a plan window. */
const MAX_RESET_AHEAD_MS = 45 * DAY;

export type DetectedUsageLimit = {
  /** Epoch ms when the provider's window resets, when the message says. */
  resetAt?: number;
  /** "usage" for exhausted plans, "rate" for throttling with a long wait. */
  kind: "usage" | "rate";
};

/**
 * A usage limit, or a rate limit with a wait worth holding for. Ordinary
 * failures, and rate limits the CLI retries in seconds, return undefined.
 */
export function detectUsageLimit(
  message: string,
  now: number,
): DetectedUsageLimit | undefined {
  if (!message) return undefined;
  if (USAGE_LIMIT.test(message)) {
    const resetAt = parseUsageLimitReset(message, now);
    return resetAt != null ? { kind: "usage", resetAt } : { kind: "usage" };
  }
  if (!RATE_LIMIT.test(message)) return undefined;
  const resetAt = parseUsageLimitReset(message, now);
  if (resetAt == null || resetAt - now < MIN_RATE_LIMIT_HOLD_MS) {
    return undefined;
  }
  return { kind: "rate", resetAt };
}

/**
 * When the limit resets, read from the message itself. Understands epoch
 * suffixes (`limit reached|1760430000`), JSON reset fields, ISO timestamps,
 * relative waits ("try again in 4h 42m", "Retry-After: 120") and wall-clock
 * times ("resets 3pm (Europe/Istanbul)", "reset at Oct 15, 9:30 AM").
 */
export function parseUsageLimitReset(
  message: string,
  now: number,
): number | undefined {
  const candidates = [
    epochReset(message),
    isoReset(message),
    relativeReset(message, now),
    clockReset(message, now),
  ];
  for (const at of candidates) {
    if (at != null && at > now && at - now <= MAX_RESET_AHEAD_MS) return at;
  }
  return undefined;
}

function toEpochMs(raw: string): number {
  const value = Number(raw);
  return raw.length >= 13 ? value : value * 1_000;
}

function epochReset(message: string): number | undefined {
  // Claude Code's classic "Claude AI usage limit reached|1760430000".
  const piped = /\|\s*(\d{10}|\d{13})\b/.exec(message);
  if (piped) return toEpochMs(piped[1]);
  const field =
    /reset(?:s|_at|At|sAt|s_at|_time|Time)?["']?\s*[:=]\s*["']?(\d{10}|\d{13})\b/i.exec(
      message,
    );
  return field ? toEpochMs(field[1]) : undefined;
}

function isoReset(message: string): number | undefined {
  const match =
    /\b(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?/.exec(
      message,
    );
  if (!match) return undefined;
  const parsed = Date.parse(`${match[1]}T${match[2]}${match[3] ?? ""}`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const UNIT_MS: Record<string, number> = {
  d: DAY,
  day: DAY,
  days: DAY,
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  s: SECOND,
  sec: SECOND,
  secs: SECOND,
  second: SECOND,
  seconds: SECOND,
};

const DURATION_PART =
  /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;

function durationMs(text: string): number | undefined {
  let total = 0;
  let found = false;
  for (const part of text.matchAll(DURATION_PART)) {
    total += Number(part[1]) * UNIT_MS[part[2].toLowerCase()];
    found = true;
  }
  return found ? total : undefined;
}

function relativeReset(message: string, now: number): number | undefined {
  const retryAfter = /retry[- ]after\s*[:=]?\s*(\d+)(?!\s*[a-z:.\d])/i.exec(
    message,
  );
  if (retryAfter) return now + Number(retryAfter[1]) * SECOND;
  // Compact Go-style waits ("in 1h2m3s") have no spaces between parts.
  const relative =
    /\b(?:in|after|for|resets? in|wait)\s+((?:\d+(?:\.\d+)?\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])[\s,]*(?:and\s+)?)+)/i.exec(
      message,
    );
  if (!relative) return undefined;
  const ms = durationMs(relative[1].replace(/(\d)([a-z]+)(?=\d)/gi, "$1$2 "));
  return ms != null ? now + ms : undefined;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

type WallClock = {
  hour: number;
  minute: number;
  month?: number;
  day?: number;
  zone?: string;
};

function clockReset(message: string, now: number): number | undefined {
  const match =
    /\b(?:resets?|reset(?:ting)?|available|try again|again|until|after)\b[^0-9\n]{0,12}?(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?:\s*\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\))?/i.exec(
      message,
    );
  if (!match) return undefined;
  const [, monthName, dayText, hourText, minuteText, meridiem, zone] = match;
  // A bare number ("again 3") is not a time; need minutes or am/pm.
  if (minuteText == null && meridiem == null) return undefined;
  let hour = Number(hourText);
  const minute = minuteText != null ? Number(minuteText) : 0;
  if (minute > 59) return undefined;
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    const pm = meridiem.toLowerCase().startsWith("p");
    hour = (hour % 12) + (pm ? 12 : 0);
  } else if (hour > 23) {
    return undefined;
  }
  const clock: WallClock = { hour, minute };
  if (monthName && dayText) {
    clock.month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
    clock.day = Number(dayText);
  }
  if (zone) clock.zone = zone;
  return nextWallClock(clock, now);
}

/** The next moment that wall clock reads, in its zone or the local one. */
export function nextWallClock(clock: WallClock, now: number): number | undefined {
  const zone = clock.zone && isValidZone(clock.zone) ? clock.zone : undefined;
  const today = zonedParts(now, zone);
  const year = today.year;
  const month = clock.month ?? today.month;
  const day = clock.day ?? today.day;
  let at = wallToEpoch(year, month, day, clock.hour, clock.minute, zone);
  if (at <= now) {
    at =
      clock.month != null
        ? wallToEpoch(year + 1, month, day, clock.hour, clock.minute, zone)
        : wallToEpoch(year, month, day + 1, clock.hour, clock.minute, zone);
  }
  return Number.isFinite(at) ? at : undefined;
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function zonedParts(at: number, zone: string | undefined): Parts {
  if (!zone) {
    const date = new Date(at);
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(at));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

function wallToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string | undefined,
): number {
  if (!zone) return new Date(year, month, day, hour, minute).getTime();
  const guess = Date.UTC(year, month, day, hour, minute);
  // Correct by the zone's offset at the guess, then once more across DST.
  let at = guess - zoneOffset(guess, zone);
  at = guess - zoneOffset(at, zone);
  return at;
}

function zoneOffset(at: number, zone: string): number {
  const parts = zonedParts(at, zone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return asUtc - Math.floor(at / MINUTE) * MINUTE;
}
