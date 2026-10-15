import { describe, expect, it } from "vitest";
import {
  evaluateHabitExpression,
  habitExpressionContext,
} from "../../irgats/model/habitGuards";
import { newHabit } from "../../irgats/model/irgatHabits";
import {
  EVERY_3H_CONDITION,
  collectorHabitShape,
  collectorInstructions,
  collectorScheduleOf,
  compactNumber,
  metricsLine,
  sourceName,
  strictnessLabel,
} from "./feed";

describe("feed collector habit", () => {
  const at = (hour: number) => new Date(2026, 9, 15, hour, 5).getTime();

  it("runs every third hour and whenever the user asks", () => {
    const shape = collectorHabitShape("every3h");
    expect(shape.schedule.scheduleKind).toBe("hourly");
    const habit = {
      ...newHabit(
        { name: "Collect", instructions: "x", schedule: shape.schedule },
        0,
      ),
      ifCondition: shape.ifCondition,
    };
    const runs = (hour: number, manual = false) =>
      evaluateHabitExpression(
        EVERY_3H_CONDITION,
        habitExpressionContext(
          manual
            ? { ...habit, trigger: { source: "manual", at: at(hour) } }
            : habit,
          at(hour),
        ),
      );
    expect([0, 3, 9, 21].every((hour) => runs(hour))).toBe(true);
    expect([1, 2, 10, 23].some((hour) => runs(hour))).toBe(false);
    expect(runs(10, true)).toBe(true);
  });

  it("reads the schedule back from the habit", () => {
    for (const kind of ["hourly", "every3h", "daily"] as const) {
      const shape = collectorHabitShape(kind);
      const habit = {
        ...newHabit(
          { name: "c", instructions: "x", schedule: shape.schedule },
          0,
        ),
        ...(shape.ifCondition ? { ifCondition: shape.ifCondition } : {}),
      };
      expect(collectorScheduleOf(habit)).toBe(kind);
    }
    expect(collectorScheduleOf(undefined)).toBe("every3h");
  });

  it("tells the agent the exact CLI calls and to stay quiet when fine", () => {
    const text = collectorInstructions("/Apps/irgat app");
    expect(text).toContain("`/Apps/irgat app feed.interests --json '{}'`");
    expect(text).toContain("`/Apps/irgat app feed.add --input -`");
    expect(text).toContain("NOTHING_TO_REPORT");
    // Habit instructions are capped at 4 000 characters.
    expect(text.length).toBeLessThan(4_000);
  });
});

describe("feed formatting", () => {
  it("names sources and shortens numbers", () => {
    expect(sourceName("x")).toBe("X");
    expect(sourceName("reddit")).toBe("Reddit");
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(1_250)).toBe("1.3K");
    expect(compactNumber(12_400)).toBe("12K");
    expect(compactNumber(3_000_000)).toBe("3M");
  });

  it("lists the metrics people look at first", () => {
    expect(metricsLine({ views: 12_000, likes: 340, reposts: 12 })).toBe(
      "340 likes · 12 reposts · 12K views",
    );
    expect(metricsLine(null)).toBe("");
  });

  it("maps a stored threshold to the nearest strictness", () => {
    expect(strictnessLabel(0.4)).toBe("Balanced");
    expect(strictnessLabel(0.31)).toBe("Loose");
    expect(strictnessLabel(0.6)).toBe("Strict");
  });
});
