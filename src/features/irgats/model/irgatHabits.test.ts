// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  HABIT_RUNS_KEPT,
  habitsToday,
  nextHabitAfterToday,
  habitStarting,
  setHabitRunning,
  afterRun,
  dropRelays,
  isRelayed,
  relayApproval,
  takeRelayedApproval,
  dueHabits,
  habitQuotaHeld,
  holdHabitForQuota,
  runHabitAnyway,
  habitPostsContext,
  habitReport,
  habitSchedule,
  MISSED_RUN_GRACE_MS,
  newHabit,
  parseHabits,
  QUIET_MARKER,
  runsWhilePaused,
  serializeHabits,
  unseenHabitPosts,
  type Habit,
} from "./irgatHabits";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).getTime();

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: "h1",
  name: "Morning CI check",
  instructions: "Check CI on main; tell me only if something is red.",
  schedule: {
    scheduleKind: "weekdays",
    time: "09:00",
    minute: 0,
    dayOfWeek: 1,
  },
  enabled: true,
  createdAt: at(1, 8),
  nextRunAt: at(5, 9),
  ...patch,
});

it("round-trips habits.json and drops anything malformed", () => {
  const text = serializeHabits([habit()]);
  expect(parseHabits(text)).toEqual([habit()]);
  expect(parseHabits('[{"id":"x"}, 3, null]')).toEqual([]);
  expect(parseHabits("not json")).toEqual([]);
  expect(parseHabits(null)).toEqual([]);
});

it("validates schedules from the CLI", () => {
  expect(habitSchedule({ kind: "weekdays", time: "09:30" })).toEqual({
    scheduleKind: "weekdays",
    time: "09:30",
    minute: 0,
    dayOfWeek: 1,
  });
  expect(() => habitSchedule({ kind: "monthly" })).toThrow("kind");
  expect(() => habitSchedule({ kind: "daily", time: "9am" })).toThrow("HH:MM");
  expect(() => habitSchedule({ kind: "weekly", dayOfWeek: 7 })).toThrow(
    "dayOfWeek",
  );
  expect(() => habitSchedule({ kind: "daily", cron: "* *" })).toThrow("cron");
});

it("runs a recent missed habit once and skips stale ones", () => {
  const due = habit({ nextRunAt: at(5, 9) });
  const stale = habit({
    id: "h2",
    nextRunAt: at(5, 9) - MISSED_RUN_GRACE_MS - 1,
  });
  const paused = habit({ id: "h3", enabled: false, nextRunAt: at(5, 8) });
  const later = habit({ id: "h4", nextRunAt: at(5, 12) });
  const { run, skipped } = dueHabits([due, stale, paused, later], at(5, 9, 5));
  expect(run.map((h) => h.id)).toEqual(["h1"]);
  expect(skipped.map((h) => h.id)).toEqual(["h2"]);
});

describe("quota holds", () => {
  const hold = { harness: "claude", accountId: "default", until: at(5, 12) };

  it("parks a due habit until its provider resets, neither run nor skipped", () => {
    const held = holdHabitForQuota(habit({ nextRunAt: at(5, 9) }), hold);
    expect(held).toMatchObject({ runRequested: true, quotaHold: hold });
    expect(habitQuotaHeld(held, at(5, 10))).toBe(true);
    expect(dueHabits([held], at(5, 10))).toEqual({ run: [], skipped: [] });
    expect(habitStarting(held, at(5, 10))).toBe(false);
  });

  it("is not skipped as missed however long the hold lasts", () => {
    const held = holdHabitForQuota(habit({ nextRunAt: at(5, 9) }), hold);
    const afterReset = at(5, 12) + MISSED_RUN_GRACE_MS * 3;
    expect(habitQuotaHeld(held, afterReset)).toBe(false);
    expect(dueHabits([held], afterReset).run).toEqual([held]);
    expect(habitStarting(held, afterReset)).toBe(true);
  });

  it("lets the scheduler decide what counts as held", () => {
    const held = holdHabitForQuota(habit(), hold);
    expect(dueHabits([held], at(5, 10), () => false).run).toEqual([held]);
    const plain = habit({ nextRunAt: at(5, 9) });
    expect(dueHabits([plain], at(5, 9, 5), () => true)).toEqual({
      run: [],
      skipped: [],
    });
  });

  it("runs anyway when the user overrides the hold", () => {
    const held = holdHabitForQuota(habit(), hold);
    const forced = runHabitAnyway(held);
    expect(forced.quotaHold).toEqual({ ...hold, override: true });
    expect(habitQuotaHeld(forced, at(5, 10))).toBe(false);
    expect(dueHabits([forced], at(5, 10)).run).toEqual([forced]);
    expect(runHabitAnyway(habit())).toEqual({ ...habit(), runRequested: true });
  });

  it("clears the hold once the run is claimed", () => {
    const claimed = afterRun(holdHabitForQuota(habit(), hold), at(5, 12));
    expect(claimed).not.toHaveProperty("quotaHold");
    expect(claimed).not.toHaveProperty("runRequested");
  });

  it("round-trips the hold through habits.json and drops malformed ones", () => {
    const forced = runHabitAnyway(holdHabitForQuota(habit(), hold));
    expect(parseHabits(serializeHabits([forced]))).toEqual([forced]);
    const broken = JSON.stringify([
      { ...habit(), quotaHold: { harness: "claude" } },
      { ...habit({ id: "h2" }), quotaHold: { harness: "codex", until: 5 } },
    ]);
    const [first, second] = parseHabits(broken);
    expect(first).not.toHaveProperty("quotaHold");
    expect(second.quotaHold).toEqual({
      harness: "codex",
      accountId: "default",
      until: 5,
    });
  });
});

it("moves to the next run and records how it went", () => {
  // Monday Oct 5 09:00 → next weekday is Tuesday Oct 6 09:00.
  const claimed = afterRun(habit(), at(5, 9));
  expect(claimed.nextRunAt).toBe(at(6, 9));
  expect(claimed.lastRunAt).toBeUndefined();
  const failed = afterRun(habit(), at(5, 9, 3), {
    kind: "failed",
    error: "timed out",
  });
  expect(failed).toMatchObject({
    lastOutcome: "failed",
    lastError: "timed out",
    lastRunAt: at(5, 9, 3),
  });
  expect(afterRun(failed, at(6, 9), { kind: "quiet" })).not.toHaveProperty(
    "lastError",
  );
});

it("stays silent when the run has nothing to say", () => {
  expect(habitReport(QUIET_MARKER)).toBeUndefined();
  expect(habitReport(`  **${QUIET_MARKER}**. `)).toBeUndefined();
  expect(
    habitReport(`CI is green, all good.\n\n${QUIET_MARKER}`),
  ).toBeUndefined();
  expect(habitReport("")).toBeUndefined();
  expect(habitReport("CI is red on main: the lint job fails since #712.")).toBe(
    "CI is red on main: the lint job fails since #712.",
  );
});

it("hands the Irgat what its habits posted since the user last wrote", () => {
  const post = (id: string, text: string): Block => ({
    id,
    role: "assistant",
    text,
    irgatHabit: { id: "h1", name: "Morning CI check", at: at(5, 9) },
  });
  const blocks: Block[] = [
    post("old", "seen before the user replied"),
    { id: "u1", role: "user", text: "thanks" },
    { id: "a1", role: "assistant", text: "anytime" },
    post("p1", "CI is red on main"),
    post("p2", "and a PR waits on you"),
  ];
  const posts = unseenHabitPosts(blocks);
  expect(posts.map((block) => block.id)).toEqual(["p1", "p2"]);
  const context = habitPostsContext(posts);
  expect(context).toContain("<while_you_were_away>");
  expect(context).toContain("Morning CI check: CI is red on main");
  expect(habitPostsContext([])).toBe("");
});

it("still hands over habit posts after a Live voice call", () => {
  const blocks: Block[] = [
    { id: "u1", role: "user", text: "thanks" },
    {
      id: "p1",
      role: "assistant",
      text: "CI is red",
      irgatHabit: { id: "h1", name: "CI", at: at(5, 9) },
    },
    { id: "v1", role: "user", text: "what broke?", liveVoice: { at: 1 } },
    { id: "v2", role: "assistant", text: "A flaky test", liveVoice: { at: 2 } },
  ];
  expect(unseenHabitPosts(blocks).map((block) => block.id)).toEqual(["p1"]);
});

it("routes an answer in the Irgat's chat back to the run that asked", () => {
  const id = relayApproval({
    irgatId: "irgat",
    runId: "run",
    requestId: 7,
    blockId: "b",
  });
  // Its own id, so it cannot collide with the Irgat's own requests.
  expect(id).not.toBe(7);
  expect(isRelayed("run", 7)).toBe(true);
  expect(takeRelayedApproval("other-irgat", id)).toBeUndefined();
  expect(takeRelayedApproval("irgat", id)).toMatchObject({
    runId: "run",
    requestId: 7,
  });
  expect(takeRelayedApproval("irgat", id)).toBeUndefined();
  relayApproval({ irgatId: "irgat", runId: "run", requestId: 8, blockId: "c" });
  expect(dropRelays("run").map((relay) => relay.blockId)).toEqual(["c"]);
  expect(isRelayed("run", 8)).toBe(false);
});

it("keeps a short history of runs, newest first", () => {
  let current = habit();
  for (let i = 0; i < HABIT_RUNS_KEPT + 3; i++)
    current = afterRun(current, at(5, 9, 2) + i * 60_000, {
      kind: i % 2 ? "quiet" : "posted",
      ...(i % 2 ? {} : { report: `report ${i}` }),
      startedAt: at(5, 9) + i * 60_000,
    });
  const runs = current.runs!;
  expect(runs).toHaveLength(HABIT_RUNS_KEPT);
  expect(runs[0]).toMatchObject({
    outcome: "posted",
    report: "report 22",
    durationMs: 120_000,
  });
  expect(runs[1]).not.toHaveProperty("report");
  // The history survives habits.json.
  expect(parseHabits(serializeHabits([current]))[0].runs).toEqual(runs);
  // Claiming a due run is not a run.
  expect(afterRun(habit(), at(5, 9)).runs).toBeUndefined();
});

it("never starts a habit again while it is still running", () => {
  const due = habit({ nextRunAt: at(5, 9) });
  setHabitRunning(due.id, at(5, 9));
  expect(dueHabits([due], at(5, 9, 5)).run).toEqual([]);
  setHabitRunning(due.id);
  expect(dueHabits([due], at(5, 9, 5)).run).toEqual([due]);
});

it("runs a requested habit once, even paused, without moving its schedule", () => {
  const requested = habit({
    enabled: false,
    runRequested: true,
    nextRunAt: at(6, 9),
  });
  expect(dueHabits([requested], at(5, 14)).run).toEqual([requested]);
  const claimed = afterRun(requested, at(5, 14));
  expect(claimed).toMatchObject({ enabled: false, nextRunAt: at(6, 9) });
  expect(claimed).not.toHaveProperty("runRequested");
  expect(habitStarting(requested, at(5, 14))).toBe(true);
  expect(habitStarting(claimed, at(5, 14))).toBe(false);
});

it("lays out today: live first, then the day in order, nothing from other days", () => {
  const now = at(5, 12);
  const ranThisMorning = habit({
    id: "morning",
    nextRunAt: at(6, 8, 30),
    runs: [{ at: at(5, 8, 30), durationMs: 60_000, outcome: "posted" }],
  });
  const later = habit({ id: "later", nextRunAt: at(5, 17) });
  const tomorrow = habit({ id: "tomorrow", nextRunAt: at(6, 9) });
  const running = habit({ id: "running", nextRunAt: at(6, 9) });
  const asked = habit({ id: "asked", nextRunAt: at(6, 9), runRequested: true });
  const paused = habit({ id: "paused", enabled: false, nextRunAt: at(5, 15) });
  const today = habitsToday(
    [later, tomorrow, ranThisMorning, running, asked, paused],
    now,
    (id) => (id === "running" ? at(5, 11, 58) : undefined),
  );
  expect(today.map((item) => [item.habit.id, item.state])).toEqual([
    ["running", "running"],
    ["asked", "starting"],
    ["morning", "done"],
    ["later", "upcoming"],
  ]);
  expect(today[2].outcome).toBe("posted");
  expect(nextHabitAfterToday([tomorrow, paused], now)?.habit.id).toBe(
    "tomorrow",
  );
});

it("starts a new habit enabled and due at its next time", () => {
  const now = new Date(2026, 9, 6, 8, 0).getTime();
  const habit = newHabit(
    {
      name: "Morning",
      instructions: "Say hi",
      schedule: {
        scheduleKind: "daily",
        time: "09:00",
        minute: 0,
        dayOfWeek: 1,
      },
    },
    now,
  );
  expect(habit).toMatchObject({ enabled: true, createdAt: now });
  expect(habit.id).toBeTruthy();
  expect(habit.nextRunAt).toBe(new Date(2026, 9, 6, 9, 0).getTime());
  expect(parseHabits(JSON.stringify([habit]))).toEqual([habit]);
});

it("starts a new habit enabled and due at its next scheduled time", () => {
  const created = newHabit(
    {
      name: "Standup",
      instructions: "Summarize yesterday's PRs.",
      schedule: {
        scheduleKind: "daily",
        time: "09:00",
        minute: 0,
        dayOfWeek: 1,
      },
    },
    at(6, 10),
  );
  expect(created).toMatchObject({
    name: "Standup",
    enabled: true,
    createdAt: at(6, 10),
    nextRunAt: at(7, 9),
  });
  expect(created.id).toBeTruthy();
});

it("lets only runs started by hand through while the Irgat is paused", () => {
  const scheduled = habit({ nextRunAt: at(5, 9) });
  const byHand = habit({
    id: "h2",
    runRequested: true,
    trigger: { source: "manual", at: at(5, 9) },
  });
  const webhook = habit({
    id: "h3",
    runRequested: true,
    trigger: { source: "webhook", at: at(5, 9) },
  });
  const now = at(5, 9, 5);
  const { run } = dueHabits([scheduled, byHand, webhook], now);
  expect(runsWhilePaused(run).map((h) => h.id)).toEqual(["h2"]);
  expect(habitStarting(scheduled, now, true)).toBe(false);
  expect(habitStarting(byHand, now, true)).toBe(true);
  expect(habitStarting(scheduled, now)).toBe(true);
});
