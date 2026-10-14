// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewHabitPage } from "./NewHabitPage";

const addHabit = vi.hoisted(() => vi.fn());
vi.mock("../model/irgatHabits", async (original) => ({
  ...(await original<object>()),
  addHabit,
}));

let container: HTMLDivElement;
let root: Root;
let onCreated: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  addHabit.mockReset();
  onCreated = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(NewHabitPage, {
        irgatId: "irgat-1",
        onBack: vi.fn(),
        onCreated,
      }),
    ),
  );
  type("Name", "Morning digest");
  type("What it does", "Summarize overnight CI failures.");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function type(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  const prototype =
    field instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function createButton() {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Create",
  )!;
}

it("adds the habit once when Create and Enter land in the same frame", async () => {
  let finish!: () => void;
  addHabit.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
  const name = container.querySelector<HTMLInputElement>(
    '[aria-label="Name"]',
  )!;
  act(() => {
    createButton().click();
    createButton().click();
    name.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });

  expect(addHabit).toHaveBeenCalledTimes(1);
  expect(addHabit).toHaveBeenCalledWith(
    "irgat-1",
    expect.objectContaining({ name: "Morning digest" }),
  );
  expect(createButton().disabled).toBe(true);
  expect(createButton().getAttribute("aria-busy")).toBe("true");

  await act(async () => finish());
  expect(onCreated).toHaveBeenCalledTimes(1);
});

it("lets the user try again after adding the habit fails", async () => {
  addHabit.mockRejectedValueOnce(new Error("Disk full"));
  await act(async () => createButton().click());
  expect(container.textContent).toContain("Disk full");

  addHabit.mockResolvedValueOnce(undefined);
  await act(async () => createButton().click());

  expect(addHabit).toHaveBeenCalledTimes(2);
  expect(onCreated).toHaveBeenCalledTimes(1);
});
