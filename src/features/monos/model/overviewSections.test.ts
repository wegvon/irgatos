import { describe, expect, it } from "vitest";
import type { Habit } from "./monoHabits";
import {
  habitsByRecent,
  INITIAL_OVERVIEW_LIMITS,
  newestFirst,
  nextPageSize,
  OVERVIEW_PAGE_SIZE,
  overviewPage,
  showMoreInSection,
} from "./overviewSections";

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

describe("overviewPage", () => {
  it("shows the first page and counts what is left", () => {
    const page = overviewPage(range(23), OVERVIEW_PAGE_SIZE);
    expect(page.shown).toEqual(range(10));
    expect(page.remaining).toBe(13);
  });

  it("shows everything, with nothing left, when the list is short", () => {
    expect(overviewPage(range(4), 10)).toEqual({
      shown: range(4),
      remaining: 0,
    });
    expect(overviewPage([], 10)).toEqual({ shown: [], remaining: 0 });
  });

  it("never goes past the list or below nothing", () => {
    expect(overviewPage(range(3), 50).remaining).toBe(0);
    expect(overviewPage(range(3), -5)).toEqual({ shown: [], remaining: 3 });
    expect(overviewPage(range(3), 1.7).shown).toEqual([0]);
  });

  it("does not change the list it pages", () => {
    const items = range(12);
    overviewPage(items, 10).shown.push(99);
    expect(items).toEqual(range(12));
  });
});

describe("showMoreInSection", () => {
  it("adds one page to that section only", () => {
    const once = showMoreInSection(INITIAL_OVERVIEW_LIMITS, "documents");
    expect(once).toEqual({ sessions: 10, documents: 20, habits: 10 });
    expect(showMoreInSection(once, "documents").documents).toBe(30);
    expect(INITIAL_OVERVIEW_LIMITS.documents).toBe(OVERVIEW_PAGE_SIZE);
  });

  it("pages through a long list a page at a time", () => {
    const items = range(25);
    let limits = INITIAL_OVERVIEW_LIMITS;
    const seen: number[] = [];
    for (;;) {
      const page = overviewPage(items, limits.sessions);
      seen.push(page.shown.length);
      if (!page.remaining) break;
      expect(nextPageSize(page.remaining)).toBe(Math.min(10, page.remaining));
      limits = showMoreInSection(limits, "sessions");
    }
    expect(seen).toEqual([10, 20, 25]);
  });
});

describe("nextPageSize", () => {
  it("is a full page, or what is left", () => {
    expect(nextPageSize(40)).toBe(10);
    expect(nextPageSize(3)).toBe(3);
    expect(nextPageSize(0)).toBe(0);
  });
});

describe("newestFirst", () => {
  it("reverses an oldest-first record without touching it", () => {
    const record = ["a", "b", "c"];
    expect(newestFirst(record)).toEqual(["c", "b", "a"]);
    expect(record).toEqual(["a", "b", "c"]);
  });
});

describe("habitsByRecent", () => {
  const habit = (id: string, createdAt: number, lastRunAt?: number) =>
    ({ id, createdAt, lastRunAt }) as Habit;

  it("puts the latest run or newest habit first", () => {
    const sorted = habitsByRecent([
      habit("old-never-ran", 1),
      habit("old-ran-lately", 2, 500),
      habit("new", 300),
      habit("ran-earlier", 3, 100),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual([
      "old-ran-lately",
      "new",
      "ran-earlier",
      "old-never-ran",
    ]);
  });
});
