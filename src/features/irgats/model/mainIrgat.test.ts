// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createIrgat, findIrgat, listIrgats, removeIrgat, removeIrgatProject } from "./irgat";
import type { Habit } from "./irgatHabits";
import { ensureMainIrgat, MAIN_HABIT, MAIN_IRGAT_NAME, mainIrgatId } from "./mainIrgat";
import { rememberProject } from "../../projects/model/recents";

let files: Map<string, Habit[]>;
const deps = {
  updateHabits: async <T,>(
    irgatId: string,
    change: (habits: Habit[]) => { habits: Habit[]; result: T },
  ): Promise<T> => {
    const { habits, result } = change(files.get(irgatId) ?? []);
    files.set(irgatId, habits);
    return result;
  },
  now: () => new Date(2026, 9, 28, 10, 20).getTime(),
};

beforeEach(() => {
  files = new Map();
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("sets up the main Irgat first on the rail, on every project, with an hourly look-only habit", async () => {
  const other = createIrgat();
  rememberProject("/code/app");
  rememberProject("/code/site");
  const id = await ensureMainIrgat("~", deps);
  const irgat = findIrgat(id!)!;
  expect(listIrgats().map((entry) => entry.id)).toEqual([id, other.id]);
  expect(irgat.name).toBe(MAIN_IRGAT_NAME);
  expect(irgat.instructions).toMatch(/main assistant/);
  expect([...irgat.projects].sort()).toEqual(["/code/app", "/code/site"]);
  const habits = files.get(id!)!;
  expect(habits).toHaveLength(1);
  expect(habits[0]).toMatchObject({
    name: MAIN_HABIT.name,
    readOnly: true,
    enabled: true,
    schedule: { scheduleKind: "hourly", minute: 0 },
  });
  expect(habits[0].nextRunAt).toBe(new Date(2026, 9, 28, 11, 0).getTime());
  expect(mainIrgatId()).toBe(id);
});

it("is set up once and only adds projects new to the rail", async () => {
  rememberProject("/code/app");
  const id = await ensureMainIrgat("~", deps);
  removeIrgatProject(id!, "/code/app");
  rememberProject("/code/new");
  expect(await ensureMainIrgat("~", deps)).toBe(id);
  expect(listIrgats()).toHaveLength(1);
  expect(findIrgat(id!)!.projects).toEqual(["/code/new"]);
  expect(files.get(id!)).toHaveLength(1);
});

it("does not come back once the user deletes it", async () => {
  const id = await ensureMainIrgat("~", deps);
  removeIrgat(id!);
  expect(await ensureMainIrgat("~", deps)).toBeUndefined();
  expect(listIrgats()).toEqual([]);
  expect(mainIrgatId()).toBeUndefined();
});

it("adds its habit on a later start when the first try failed", async () => {
  const failing = { ...deps, updateHabits: () => Promise.reject(new Error("disk")) };
  await expect(ensureMainIrgat("~", failing)).rejects.toThrow("disk");
  const id = await ensureMainIrgat("~", deps);
  expect(listIrgats()).toHaveLength(1);
  expect(files.get(id!)).toHaveLength(1);
});
