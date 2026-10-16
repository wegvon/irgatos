// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../../sessions/model/session";
import { IrgatSettings } from "./IrgatSettings";

vi.mock("../../sessions/ui/ModelPicker", () => ({
  ModelPicker: () => null,
  ModelSettingRows: () => null,
}));

let container: HTMLDivElement;
let root: Root;
const onRuntimeModeChange = vi.fn();
const onOpenPage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  runtimeMode: RuntimeMode = "auto",
  busy = false,
  onReset?: () => Promise<void>,
) {
  await act(async () =>
    root.render(
      createElement(IrgatSettings, {
        irgatId: "irgat-1",
        agent: { name: "Broski", mascot: "cat", color: "#9c9", projects: [] },
        files: {
          id: "irgat-1",
          dir: "/data/irgat-1",
          soul: "# Soul",
          soulHash: "soul",
          memory: "",
          memoryHash: "memory",
          memoryPath: "/data/irgat-1/MEMORY.md",
          topics: [],
        },
        onOpenPage,
        cwd: "/home",
        harness: "codex",
        model: "codex:gpt-5.4",
        modelSettings: {},
        runtimeMode,
        busy,
        onModelChange: vi.fn(),
        onModelSettingsChange: vi.fn(),
        onRuntimeModeChange,
        onReset,
      }),
    ),
  );
}

function trigger() {
  return document.querySelector<HTMLButtonElement>(
    "[data-access-picker-trigger]",
  )!;
}

function dialog() {
  return document.querySelector<HTMLElement>("[data-irgat-settings]")!;
}

function button(label: string, root: ParentNode = document) {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === label,
  )!;
}

function escape() {
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
}

it("shows who it is and how it works, with its soul and memory a click away", async () => {
  await render();
  expect(dialog().querySelector('input[aria-label="Name"]')).not.toBeNull();
  expect(dialog().textContent).toContain("Permissions");
  expect(dialog().textContent).toContain("Projects");
  expect(dialog().textContent).toContain("Nothing remembered yet.");
  const link = (label: string) =>
    [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      entry.textContent?.startsWith(label),
    )!;
  act(() => link("Soul").click());
  expect(onOpenPage).toHaveBeenLastCalledWith("soul");
  act(() => link("Memory").click());
  expect(onOpenPage).toHaveBeenLastCalledWith("memory");
});

it("keeps the mascots and colors in a popover opened from its icon", async () => {
  await render();
  expect(document.querySelector('[aria-label="Mascot"]')).toBeNull();
  const face = dialog().querySelector<HTMLElement>(
    '[aria-label="Change mascot and color"]',
  )!;
  act(() => face.click());
  const popover = document.querySelector('[aria-label="Mascot and color"]')!;
  expect(popover.querySelector('[aria-label="Mascot"]')).not.toBeNull();
  expect(popover.querySelector('[aria-label="Color"]')).not.toBeNull();
  escape();
  expect(document.querySelector('[aria-label="Mascot and color"]')).toBeNull();
});

function confirmButton(label: string) {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"]:not(:has([data-irgat-settings])) button',
    ),
  ].find((entry) => entry.textContent === label)!;
}

it("requires confirmation for reset and cancels without deleting anything", async () => {
  const reset = vi.fn(async () => {});
  await render("auto", false, reset);
  act(() => button("Reset", dialog()).click());
  const confirm = confirmButton("Cancel").closest('[role="dialog"]')!;
  expect(confirm.textContent).toContain("Reset Broski's conversation?");
  expect(confirm.textContent).toContain("soul, memory and habits will be kept");
  act(() => confirmButton("Cancel").click());
  expect(confirmButton("Cancel")).toBeUndefined();
  expect(reset).not.toHaveBeenCalled();
});

it("resets once after confirmation", async () => {
  const reset = vi.fn(async () => {});
  await render("auto", false, reset);
  act(() => button("Reset", dialog()).click());
  await act(async () => confirmButton("Reset conversation").click());
  expect(reset).toHaveBeenCalledOnce();
  expect(confirmButton("Cancel")).toBeUndefined();
});

it("lets the user choose every permission mode and reflects the saved choice", async () => {
  await render("auto");
  expect(trigger().textContent).toBe("Auto");

  for (const mode of RUNTIME_MODES) {
    act(() => trigger().click());
    const options = document.querySelectorAll<HTMLButtonElement>(
      '[data-access-picker] [role="option"]',
    );
    expect(options).toHaveLength(RUNTIME_MODES.length);
    act(() => options[RUNTIME_MODES.indexOf(mode)].click());
    expect(onRuntimeModeChange).toHaveBeenLastCalledWith(mode);
    expect(document.querySelector("[data-access-picker]")).toBeNull();
    await render(mode);
    expect(trigger().textContent).toBe(RUNTIME_MODE_LABEL[mode]);
  }
});

it("explains when permissions take effect while the Irgat is working", async () => {
  await render("auto", true);
  expect(trigger().title).toContain("Changes apply to the next turn.");
  act(() => trigger().click());
  expect(document.querySelector("[data-access-picker]")?.textContent).toContain(
    "Access changes apply to the next turn. Stop and resend to apply them now.",
  );
});
