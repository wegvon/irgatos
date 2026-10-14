// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Habit } from "../model/irgatHabits";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
const copied = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copied }));

const {
  HabitGuardsSection,
  HabitTriggerSection,
  habitGuardsDraft,
  habitGuardsFromDraft,
} = await import("./HabitGuardsSection");
const { HabitRow } = await import("./IrgatHabits");
const { HabitPage, habitGuardSummary } = await import("./HabitPage");
const { syncHabitWebhook } = await import("../model/habitWebhook");
const { habitApprovalEntries } = await import("../model/habitApprovals");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockReset();
  copied.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    name: "Deploy watch",
    instructions: "Check the deploy.",
    schedule: { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 },
    enabled: true,
    createdAt: 0,
    nextRunAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;

function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("guard drafts", () => {
  it("round-trips saved guards and picks a readable unit", () => {
    const draft = habitGuardsDraft(
      habit({
        requestApproval: true,
        ifCondition: { kind: "expression", expression: "now.hour > 8" },
        delaySeconds: 600,
      }),
    );
    expect(draft).toMatchObject({
      requestApproval: true,
      kind: "expression",
      expression: "now.hour > 8",
      delay: "10",
      unit: "minutes",
    });
    expect(habitGuardsFromDraft(draft)).toEqual({
      settings: {
        requestApproval: true,
        ifCondition: { kind: "expression", expression: "now.hour > 8" },
        delaySeconds: 600,
      },
    });
  });

  it("explains what cannot be saved", () => {
    const base = habitGuardsDraft(habit());
    expect(habitGuardsFromDraft({ ...base, delay: "-1" })).toHaveProperty(
      "error",
    );
    expect(
      habitGuardsFromDraft({ ...base, delay: "25", unit: "hours" }),
    ).toEqual({ error: "Keep the delay to a day or less." });
    expect(
      habitGuardsFromDraft({ ...base, kind: "expression", expression: "x()" }),
    ).toHaveProperty("error");
  });
});

describe("HabitGuardsSection", () => {
  it("saves approval, an expression and a delay together", async () => {
    const onSave = vi.fn(async () => {});
    act(() =>
      root.render(createElement(HabitGuardsSection, { habit: habit(), onSave })),
    );
    // Nothing to save until something changes.
    expect(button("Save guards")).toBeUndefined();
    act(() => container.querySelector<HTMLElement>('[role="switch"]')!.click());
    act(() => button("Expression is true").click());
    type(
      container.querySelector('input[aria-label="Condition expression"]')!,
      "now.hour >=",
    );
    type(container.querySelector('input[aria-label="Delay"]')!, "2");
    act(() => button("min").click());
    act(() => button("Save guards").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    type(
      container.querySelector('input[aria-label="Condition expression"]')!,
      "now.hour >= 9",
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button("Save guards").click());
    expect(onSave).toHaveBeenCalledWith({
      requestApproval: true,
      ifCondition: { kind: "expression", expression: "now.hour >= 9" },
      delaySeconds: 120,
    });
  });

  it("shows a save error from the store", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("habits.json is read-only");
    });
    act(() =>
      root.render(createElement(HabitGuardsSection, { habit: habit(), onSave })),
    );
    act(() => button("Command passes").click());
    type(
      container.querySelector('input[aria-label="Condition command"]')!,
      "test -f READY",
    );
    await act(async () => button("Save guards").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "habits.json is read-only",
    );
  });
});

describe("HabitTriggerSection", () => {
  it("creates a trigger token", () => {
    const onTokenChange = vi.fn(async () => {});
    act(() =>
      root.render(
        createElement(HabitTriggerSection, { habit: habit(), onTokenChange }),
      ),
    );
    act(() => button("Create trigger").click());
    expect(onTokenChange).toHaveBeenCalledWith(
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    );
  });

  it("shows and copies the command once the listener is up", async () => {
    const token = "k".repeat(43);
    const onTokenChange = vi.fn(async () => {});
    invoke.mockResolvedValueOnce({ port: null, error: "port in use" });
    await syncHabitWebhook([token]);
    act(() =>
      root.render(
        createElement(HabitTriggerSection, {
          habit: habit({ triggerToken: token, enabled: false }),
          onTokenChange,
        }),
      ),
    );
    expect(container.textContent).toContain(
      "The trigger listener could not start: port in use",
    );
    expect(container.textContent).toContain("Paused habits ignore their trigger.");

    invoke.mockResolvedValueOnce({ port: 47615, error: null });
    await act(async () => {
      await syncHabitWebhook([token]);
    });
    const command = `curl -X POST http://127.0.0.1:47615/habits/${token} -d 'optional payload'`;
    expect(container.querySelector("code")?.textContent).toBe(command);
    await act(async () => button("Copy command").click());
    expect(copied).toHaveBeenCalledWith(command);
    expect(button("Copied")).toBeDefined();

    act(() => button("Remove").click());
    expect(onTokenChange).toHaveBeenLastCalledWith(null);
  });
});

describe("habit card and page", () => {
  const actions = () => ({
    runNow: vi.fn(),
    toggle: vi.fn(),
    remove: vi.fn(),
    approve: vi.fn(),
    skip: vi.fn(),
    setGuards: vi.fn(async () => {}),
    setTriggerToken: vi.fn(async () => {}),
  });

  it("puts Approve and Skip on a card waiting for approval", () => {
    const handlers = actions();
    act(() =>
      root.render(
        createElement(
          "ul",
          null,
          createElement(HabitRow, {
            habit: habit({
              requestApproval: true,
              runRequested: true,
              approval: { state: "pending", requestedAt: Date.now() },
            }),
            actions: handlers,
            onOpen: vi.fn(),
          }),
        ),
      ),
    );
    expect(container.textContent).toContain("Waiting for your approval");
    expect(
      container.querySelector("[data-habit-approval]"),
    ).not.toBeNull();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Approve Deploy watch"]')!
        .click(),
    );
    expect(handlers.approve).toHaveBeenCalledWith("h1");
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Skip Deploy watch"]')!
        .click(),
    );
    expect(handlers.skip).toHaveBeenCalledWith("h1");
  });

  it("shows a delayed card's start time", () => {
    act(() =>
      root.render(
        createElement(
          "ul",
          null,
          createElement(HabitRow, {
            habit: habit({
              delaySeconds: 300,
              runRequested: true,
              delayedUntil: Date.now() + 300_000,
            }),
            actions: actions(),
            onOpen: vi.fn(),
          }),
        ),
      ),
    );
    expect(container.textContent).toContain("Delayed · starts");
    expect(container.querySelector("[data-habit-delayed]")).not.toBeNull();
  });

  it("summarises guards and shows a skipped run's reason", () => {
    const guarded = habit({
      requestApproval: true,
      ifCondition: { kind: "shell", command: "test -f READY" },
      delaySeconds: 300,
      triggerToken: "k".repeat(43),
      runs: [
        {
          at: Date.now() - 60_000,
          durationMs: 0,
          outcome: "skipped",
          reason: "`test -f READY` exited with code 1.",
        },
      ],
    });
    expect(habitGuardSummary(guarded)).toBe(
      "Asks first · If test -f READY · Waits 5 min · Has a trigger",
    );
    const onApprove = vi.fn();
    act(() =>
      root.render(
        createElement(HabitPage, {
          habit: guarded,
          color: "#f80",
          cwd: "/code",
          onBack: vi.fn(),
          onRunNow: vi.fn(),
          onToggle: vi.fn(),
          onRemove: vi.fn(),
          guards: {
            onApprove,
            onSkip: vi.fn(),
            onGuardsChange: vi.fn(async () => {}),
            onTriggerTokenChange: vi.fn(async () => {}),
          },
        }),
      ),
    );
    expect(container.textContent).toContain("Guards");
    expect(container.querySelector("[data-habit-guards]")).not.toBeNull();
    expect(container.querySelector("[data-habit-trigger]")).not.toBeNull();
    const run = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Skipped"),
    )!;
    act(() => run.click());
    expect(container.textContent).toContain("exited with code 1");
  });
});

describe("habitApprovalEntries", () => {
  it("lists pending approvals across Irgats, oldest first", () => {
    const now = Date.now();
    const pending = (id: string, requestedAt: number) =>
      habit({ id, approval: { state: "pending", requestedAt } });
    const entries = habitApprovalEntries(
      [
        {
          irgatId: "a",
          irgatName: "Skull",
          color: "#f80",
          habits: [pending("newer", now - 1_000), habit({ id: "idle" })],
        },
        {
          irgatId: "b",
          irgatSessionId: "chat-b",
          irgatName: "Ghost",
          color: "#08f",
          habits: [
            pending("older", now - 60_000),
            pending("expired", now - 13 * 3_600_000),
          ],
        },
      ],
      now,
    );
    expect(entries.map((e) => [e.irgatId, e.habit.id])).toEqual([
      ["b", "older"],
      ["a", "newer"],
    ]);
    expect(entries[0].irgatSessionId).toBe("chat-b");
  });
});
