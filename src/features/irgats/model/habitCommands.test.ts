// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { isHabitCommand, resumeHabit, webHabitState } from "./habitCommands";
import { setHabitRunning, type Habit } from "./irgatHabits";

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: "h1",
  name: "Book the table",
  instructions: "Book it.",
  schedule: {
    scheduleKind: "once",
    time: "19:00",
    minute: 0,
    dayOfWeek: 1,
    date: "2026-10-05",
  },
  enabled: false,
  createdAt: 0,
  nextRunAt: 0,
  finishedAt: 10,
  ...patch,
});

it("knows the commands the phone may send", () => {
  expect(isHabitCommand("stop")).toBe(true);
  expect(isHabitCommand("remove")).toBe(false);
});

it("resumes a one-off as not done, due at its moment", () => {
  const resumed = resumeHabit(habit(), 0);
  expect(resumed.enabled).toBe(true);
  expect(resumed).not.toHaveProperty("finishedAt");
  expect(resumed.nextRunAt).toBe(new Date(2026, 9, 5, 19, 0).getTime());
});

it("says what a habit is up to, running first", () => {
  expect(webHabitState(habit(), 0)).toBe("finished");
  expect(webHabitState(habit({ finishedAt: undefined }), 0)).toBe("paused");
  setHabitRunning("h1", 5);
  expect(webHabitState(habit(), 6)).toBe("running");
  setHabitRunning("h1");
});
