// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  CompletionGateBar,
  completionGateBadge,
  completionGateMenuItems,
} from "./CompletionGateBar";
import {
  ProjectCompletionGateSettings,
  gateTimeoutFromMinutes,
} from "./ProjectCompletionGateSettings";
import {
  loadProjectGate,
  loadSessionGate,
  registerCompletionGateController,
  resolveCompletionGate,
  saveProjectGate,
  setCompletionGateStatus,
  type CompletionGateController,
} from "../model/completionGate";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  setCompletionGateStatus("s1", undefined);
  registerCompletionGateController(null);
  document.body.innerHTML = "";
});

const button = (label: string | RegExp) =>
  [...document.querySelectorAll("button")].find((entry) =>
    typeof label === "string"
      ? entry.textContent === label
      : label.test(entry.textContent ?? ""),
  ) as HTMLButtonElement | undefined;

describe("CompletionGateBar", () => {
  it("starts off and turns on with a preset", () => {
    act(() =>
      root.render(createElement(CompletionGateBar, { sessionId: "s1", cwd: "/work/app" })),
    );
    expect(container.textContent).toContain("Gate off");
    act(() => button(/Gate off/)!.click());
    const preset = [...document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')].find(
      (entry) => entry.textContent?.includes("Cargo check"),
    ) as HTMLElement;
    expect(preset).toBeDefined();
    act(() => preset.click());
    expect(loadSessionGate("s1")).toEqual({ mode: "on", command: "cargo check" });
    expect(container.textContent).toContain("Gate · Cargo check");
  });

  it("follows the project and shows the verdict", () => {
    saveProjectGate("/work/app", {
      enabled: true,
      command: "npx tsc --noEmit",
      timeoutMs: 60_000,
    });
    act(() =>
      root.render(createElement(CompletionGateBar, { sessionId: "s1", cwd: "/work/app" })),
    );
    expect(container.textContent).toContain("Gate · TypeScript");
    act(() =>
      setCompletionGateStatus("s1", {
        state: "verified",
        command: "npx tsc --noEmit",
        timedOut: false,
        durationMs: 2_300,
        at: 1,
        attempts: 1,
      }),
    );
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toBe("Verified ✓");
    expect(status.getAttribute("title")).toBe(
      "npx tsc --noEmit passed in 2.3s after 1 retry.",
    );
  });

  it("shows a retry in progress with its output and a way to stop", () => {
    const controller = {
      stopRetries: vi.fn(),
    } as unknown as CompletionGateController;
    registerCompletionGateController(controller);
    act(() =>
      root.render(createElement(CompletionGateBar, { sessionId: "s1", cwd: "/work/app" })),
    );
    act(() =>
      setCompletionGateStatus("s1", {
        state: "fixing",
        command: "npm test",
        attempt: 2,
        max: 3,
        exitCode: 1,
        output: "FAIL src/cart.test.ts",
      }),
    );
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "Fixing 2/3",
    );
    expect(container.querySelector("pre")).toBeNull();
    act(() => button("Show output")!.click());
    expect(container.querySelector("pre")!.textContent).toBe(
      "FAIL src/cart.test.ts",
    );
    act(() => button("Stop retries")!.click());
    expect(controller.stopRetries).toHaveBeenCalledWith("s1");
  });

  it("lists the modes and presets with the current choice checked", () => {
    const items = completionGateMenuItems({
      project: { enabled: true, command: "npm test", timeoutMs: 60_000 },
      session: undefined,
      effective: resolveCompletionGate(
        { enabled: true, command: "npm test", timeoutMs: 60_000 },
        undefined,
      ),
    });
    const checked = items
      .filter((item) => item.kind === "item" && item.checked)
      .map((item) => (item.kind === "item" ? item.id : ""));
    expect(checked).toEqual(["mode:inherit", "preset:npm-test"]);
    expect(items[0]).toMatchObject({ label: "Follow project (On: Tests)" });
  });

  it("words every verdict", () => {
    expect(
      completionGateBadge({ state: "running", command: "x", attempt: 0, startedAt: 0 })
        .label,
    ).toBe("Checking…");
    expect(
      completionGateBadge({
        state: "verified",
        command: "x",
        timedOut: true,
        durationMs: 1,
        at: 0,
        attempts: 0,
      }).label,
    ).toBe("Verified ✓ · timed out");
    expect(
      completionGateBadge({
        state: "failed",
        command: "x",
        reason: "exhausted",
        exitCode: 1,
        output: "",
        attempts: 3,
      }).label,
    ).toBe("Still failing after 3 retries");
    expect(
      completionGateBadge({
        state: "failed",
        command: "x",
        reason: "error",
        exitCode: null,
        output: "",
        attempts: 0,
      }).label,
    ).toBe("Check could not run");
  });
});

describe("ProjectCompletionGateSettings", () => {
  it("saves the project default", () => {
    act(() =>
      root.render(
        createElement(ProjectCompletionGateSettings, { project: "/work/app" }),
      ),
    );
    act(() =>
      (container.querySelector('[role="switch"]') as HTMLButtonElement).click(),
    );
    act(() => button("Tests")!.click());
    act(() => button("Save")!.click());
    expect(loadProjectGate("/work/app")).toEqual({
      enabled: true,
      command: "npm test",
      timeoutMs: 5 * 60_000,
    });
    expect(container.textContent).toContain("Saved.");
  });

  it("rejects an empty command", () => {
    act(() =>
      root.render(
        createElement(ProjectCompletionGateSettings, { project: "/work/app" }),
      ),
    );
    const input = container.querySelector(
      'input[aria-label="Completion Gate command"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(input, "  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Save")!.click());
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(
      "Enter a command to run.",
    );
    expect(loadProjectGate("/work/app")).toBeUndefined();
  });

  it("reads the time limit in minutes within bounds", () => {
    expect(gateTimeoutFromMinutes("2")).toBe(120_000);
    expect(gateTimeoutFromMinutes("0.5")).toBe(30_000);
    expect(gateTimeoutFromMinutes("0")).toBeNull();
    expect(gateTimeoutFromMinutes("31")).toBeNull();
    expect(gateTimeoutFromMinutes("soon")).toBeNull();
  });
});
