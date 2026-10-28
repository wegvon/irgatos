// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  clearDecisionDeferral,
  decisionKeySession,
  deferDecision,
  isDecisionDeferred,
  loadDecisionDeferrals,
  pruneDecisionDeferrals,
  reminderChoices,
} from "./decisionDeferrals";
import { decisionKey } from "./decisionUrgency";

beforeEach(() => localStorage.clear());

const key = decisionKey("s:1", "approval", 4);

it("keeps a deferral until its reminder, or until the request is settled", () => {
  deferDecision(key, 2000, 1000);
  expect(isDecisionDeferred(loadDecisionDeferrals()[key], 1500)).toBe(true);
  expect(isDecisionDeferred(loadDecisionDeferrals()[key], 2000)).toBe(false);
  deferDecision(key, null, 1000);
  expect(isDecisionDeferred(loadDecisionDeferrals()[key], 10 ** 13)).toBe(true);
  clearDecisionDeferral(key);
  expect(loadDecisionDeferrals()).toEqual({});
});

it("forgets settled requests only for chats that are loaded", () => {
  deferDecision(key, null);
  const other = decisionKey("other", "question", 1);
  deferDecision(other, null);
  // Right after launch nothing is loaded yet: keep both.
  pruneDecisionDeferrals(new Set(), new Set());
  expect(Object.keys(loadDecisionDeferrals())).toHaveLength(2);
  pruneDecisionDeferrals(new Set([other]), new Set(["s:1", "other"]));
  expect(Object.keys(loadDecisionDeferrals())).toEqual([other]);
});

it("reads the session back out of a key", () => {
  expect(decisionKeySession(key)).toBe("s:1");
  expect(decisionKeySession("session-id")).toBeUndefined();
});

it("offers no reminder that lands after a question's deadline", () => {
  const now = 0;
  expect(reminderChoices(undefined, now).map((c) => c.label)).toEqual([
    "Remind me in 15 minutes",
    "Remind me in 1 hour",
    "Remind me in 3 hours",
  ]);
  expect(reminderChoices(30 * 60_000, now).map((c) => c.label)).toEqual([
    "Remind me in 15 minutes",
  ]);
  expect(reminderChoices(2 * 60_000, now)).toEqual([]);
});
