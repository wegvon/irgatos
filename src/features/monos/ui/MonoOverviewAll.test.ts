// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Habit } from "../model/monoHabits";
import { MonoOverview } from "./MonoOverview";

const loadHabits = vi.fn<(monoId: string) => Promise<Habit[]>>();
vi.mock("../model/monoHabits", async (original) => ({
  ...(await original<object>()),
  loadHabits: (monoId: string) => loadHabits(monoId),
}));

vi.mock("./MonoChangesView", () => ({
  MonoChangesView: () => createElement("p", { "data-changes-view": "" }),
}));

const listSessionsByProject = vi.fn(async (cwd: string) =>
  Array.from({ length: 30 }, (_, i) => ({
    id: `s${i}`,
    cwd,
    harness: "codex",
    model: "codex:gpt-5.4",
    runtimeMode: "auto",
    title: `Session ${i}`,
    createdAt: 1,
    updatedAt: 1,
  })),
);
const getSession = vi.fn(async (_id: string) => null);
vi.mock("../../sessions/data/sessionStore", async (original) => ({
  ...(await original<object>()),
  listSessionsByProject: (cwd: string) => listSessionsByProject(cwd),
  getSession: (id: string) => getSession(id),
}));

let container: HTMLDivElement;
let root: Root;
// Habits are cached per Mono, so each test reads its own.
let monoCount = 0;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  loadHabits.mockReset();
  loadHabits.mockResolvedValue([]);
  listSessionsByProject.mockClear();
  getSession.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  monoCount += 1;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const launches = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    sessionId: `s${i}`,
    cwd: "/p",
    title: `Session ${i}`,
    harness: "codex" as const,
    model: "codex:gpt-5.4",
  }));

const documents = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `d${i}`,
    kind: "document" as const,
    title: `Doc ${i}`,
  }));

const habit = (i: number): Habit =>
  ({
    id: `h${i}`,
    name: `Habit ${i}`,
    instructions: "",
    schedule: { scheduleKind: "daily", time: "09:00", minute: 0, dayOfWeek: 1 },
    enabled: true,
    createdAt: i,
    nextRunAt: Date.now() + 86_400_000,
  }) as Habit;

async function render(props: Record<string, unknown> = {}) {
  const callbacks = {
    onTabChange: vi.fn(),
    onOpenSession: vi.fn(),
    onOpenDocument: vi.fn(),
  };
  await act(async () =>
    root.render(
      createElement(MonoOverview, {
        open: true,
        monoId: `mono-${monoCount}`,
        cwd: "/home",
        agent: { name: "Broski", mascot: "cat", color: "#9c9", projects: [] },
        state: { status: "idle" },
        launches: launches(23),
        sessions: [],
        documents: documents(12),
        changes: {
          sessionId: "mono",
          cwd: "/home",
          totals: { files: 3, additions: 12, deletions: 4 },
          request: {},
          projects: [],
        },
        tab: "all",
        ...callbacks,
        onClose: vi.fn(),
        ...props,
      }),
    ),
  );
  return callbacks;
}

const section = (id: string) =>
  container.querySelector<HTMLElement>(`[data-overview-section="${id}"]`)!;
const ids = (id: string, attribute: string) =>
  [...section(id).querySelectorAll(`[${attribute}]`)].map((row) =>
    row.getAttribute(attribute),
  );
const more = (id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-overview-more="${id}"]`);

it("puts every kind in one place, each with its count", async () => {
  loadHabits.mockResolvedValue([habit(1), habit(2)]);
  await render();
  expect(
    [...container.querySelectorAll("[data-overview-section]")].map((entry) =>
      entry.getAttribute("data-overview-section"),
    ),
  ).toEqual(["sessions", "documents", "habits", "changes"]);
  const count = (id: string) =>
    section(id).querySelector("[data-overview-count]")?.textContent;
  expect(count("sessions")).toBe("23");
  expect(count("documents")).toBe("12");
  expect(count("habits")).toBe("2");
  expect(count("changes")).toBe("3");
  expect(section("changes").textContent).toContain("3 files changed");
});

it("shows the ten newest of each kind first", async () => {
  await render();
  expect(ids("sessions", "data-mono-session")).toEqual(
    Array.from({ length: 10 }, (_, i) => `s${22 - i}`),
  );
  expect(ids("documents", "data-mono-document")).toEqual(
    Array.from({ length: 10 }, (_, i) => `d${11 - i}`),
  );
  expect(more("sessions")!.textContent).toBe("Show 10 more· 10 of 23");
  expect(more("documents")!.textContent).toBe("Show 2 more· 10 of 12");
});

it("shows more of one section at a time, leaving the others as they were", async () => {
  await render();
  await act(async () => more("sessions")!.click());
  expect(ids("sessions", "data-mono-session")).toHaveLength(20);
  expect(ids("documents", "data-mono-document")).toHaveLength(10);
  expect(more("sessions")!.textContent).toBe("Show 3 more· 20 of 23");
  await act(async () => more("sessions")!.click());
  expect(ids("sessions", "data-mono-session")).toHaveLength(23);
  expect(more("sessions")).toBeNull();
  await act(async () => more("documents")!.click());
  expect(ids("documents", "data-mono-document")).toHaveLength(12);
  expect(more("documents")).toBeNull();
});

it("looks up only the sessions on show", async () => {
  listSessionsByProject.mockResolvedValueOnce([]);
  await render();
  expect(getSession).toHaveBeenCalledTimes(10);
  expect(getSession.mock.calls.map(([id]) => id)).toContain("s22");
  expect(getSession.mock.calls.map(([id]) => id)).not.toContain("s12");
});

it("pages habits by their latest activity", async () => {
  loadHabits.mockResolvedValue(Array.from({ length: 14 }, (_, i) => habit(i)));
  await render();
  expect(ids("habits", "data-habit")).toEqual(
    Array.from({ length: 10 }, (_, i) => `h${13 - i}`),
  );
  await act(async () => more("habits")!.click());
  expect(ids("habits", "data-habit")).toHaveLength(14);
});

it("says what each empty section is for", async () => {
  await render({
    launches: [],
    documents: [],
    changes: {
      sessionId: "mono",
      cwd: "/home",
      totals: null,
      request: {},
      projects: [],
    },
  });
  expect(section("sessions").textContent).toContain(
    "Sessions Broski starts on your projects show up here.",
  );
  expect(section("documents").textContent).toContain("Broski writes");
  expect(section("habits").textContent).toContain("on a schedule");
  expect(section("changes").textContent).toContain("ready to review");
  expect(container.querySelector("[data-overview-more]")).toBeNull();
});

it("shows habits loading, then a failed read with a way to try again", async () => {
  let fail: (error: Error) => void = () => {};
  loadHabits.mockImplementationOnce(
    () => new Promise((_, reject) => (fail = reject)),
  );
  await render();
  expect(
    section("habits").querySelector('[role="status"][aria-busy]'),
  ).not.toBeNull();
  await act(async () => fail(new Error("disk")));
  const alert = section("habits").querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Could not read the habits.");
  loadHabits.mockResolvedValueOnce([habit(1)]);
  await act(async () => alert.querySelector("button")!.click());
  expect(section("habits").querySelector('[role="alert"]')).toBeNull();
  expect(ids("habits", "data-habit")).toEqual(["h1"]);
});

it("opens each kind's own tab, and items as their tabs do", async () => {
  const { onTabChange, onOpenDocument } = await render();
  const viewAll = (label: string) =>
    container
      .querySelector<HTMLButtonElement>(
        `button[aria-label="View all ${label}"]`,
      )!
      .click();
  viewAll("sessions");
  viewAll("habits");
  expect(onTabChange.mock.calls).toEqual([["sessions"], ["habits"]]);
  act(() =>
    container
      .querySelector<HTMLButtonElement>("[data-overview-changes]")!
      .click(),
  );
  expect(onTabChange).toHaveBeenLastCalledWith("changes");
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[data-mono-document="d11"]')!
      .click(),
  );
  expect(onOpenDocument).toHaveBeenCalledWith("d11");
});

it("keeps the new-habit button on the habits section", async () => {
  await render();
  const button = section("habits").querySelector<HTMLButtonElement>(
    'button[aria-label="New habit"]',
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(
    container.querySelector("[data-mono-overview]")!.closest("[inert]"),
  ).not.toBeNull();
});
