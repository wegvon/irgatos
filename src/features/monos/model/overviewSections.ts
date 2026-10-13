import type { Habit } from "./monoHabits";

/** Entries each section of the All tab shows at first, and adds per "Show more". */
export const OVERVIEW_PAGE_SIZE = 10;

export type OverviewSectionId = "sessions" | "documents" | "habits";

export type OverviewLimits = Record<OverviewSectionId, number>;

export const INITIAL_OVERVIEW_LIMITS: OverviewLimits = {
  sessions: OVERVIEW_PAGE_SIZE,
  documents: OVERVIEW_PAGE_SIZE,
  habits: OVERVIEW_PAGE_SIZE,
};

/** The leading `limit` entries of a list, and how many are left behind them. */
export function overviewPage<T>(
  items: readonly T[],
  limit: number,
): { shown: T[]; remaining: number } {
  const size = Math.max(0, Math.min(items.length, Math.floor(limit)));
  return { shown: items.slice(0, size), remaining: items.length - size };
}

/** One more page for one section; the others keep what they show. */
export function showMoreInSection(
  limits: OverviewLimits,
  section: OverviewSectionId,
): OverviewLimits {
  return { ...limits, [section]: limits[section] + OVERVIEW_PAGE_SIZE };
}

/** What the next page adds: a full page, or whatever is left. */
export function nextPageSize(remaining: number): number {
  return Math.max(0, Math.min(remaining, OVERVIEW_PAGE_SIZE));
}

/** Newest first, from a record kept oldest first. */
export function newestFirst<T>(items: readonly T[]): T[] {
  return [...items].reverse();
}

/** Habits by their latest activity: the last run, or when they were made. */
export function habitsByRecent(habits: readonly Habit[]): Habit[] {
  const latest = (habit: Habit) =>
    Math.max(habit.lastRunAt ?? 0, habit.createdAt);
  return [...habits].sort((a, b) => latest(b) - latest(a));
}
