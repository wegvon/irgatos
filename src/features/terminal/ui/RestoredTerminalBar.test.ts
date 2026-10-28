// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevEnvironmentStatus } from "../../source-control/model/worktreeEnv";
import { devStatusText, RestoredTerminalBar } from "./RestoredTerminalBar";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render(
  status: DevEnvironmentStatus,
  write = vi.fn(async () => undefined),
  onDismiss = vi.fn(),
) {
  const check = vi.fn(async () => status);
  await act(async () => {
    root.render(
      createElement(RestoredTerminalBar, {
        ptyId: "term-1",
        cwd: "/work/demo",
        onDismiss,
        check,
        write,
      }),
    );
  });
  return { check, write, onDismiss };
}

describe("restored terminal bar", () => {
  it("labels the tab as a new shell even without a dev command", async () => {
    await render({ running: false });
    expect(container.textContent).toContain(
      "New shell session. Commands from before the restart were not re-run.",
    );
    expect(container.querySelector("[data-dev-environment]")).toBeNull();
    expect(container.querySelector("[data-start-dev-environment]")).toBeNull();
  });

  it("offers to start a stopped development environment in this shell", async () => {
    const { write, check } = await render({
      command: "npm run dev",
      running: false,
    });
    expect(
      container.querySelector("[data-dev-environment]")?.getAttribute(
        "data-dev-environment",
      ),
    ).toBe("stopped");
    expect(check).toHaveBeenCalledWith("/work/demo");
    // Nothing runs until the user asks.
    expect(write).not.toHaveBeenCalled();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-start-dev-environment]")
        ?.click();
    });
    expect(write).toHaveBeenCalledWith("term-1", "npm run dev\r");
  });

  it("says when the development environment already runs", async () => {
    await render({ command: "npm run dev", running: true, port: 4107 });
    expect(container.textContent).toContain(
      "Development environment is running on port 4107",
    );
    expect(container.querySelector("[data-start-dev-environment]")).toBeNull();
  });

  it("can be hidden", async () => {
    const { onDismiss } = await render({ running: false });
    act(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Hide"]')?.click(),
    );
    expect(onDismiss).toHaveBeenCalled();
  });

  it("words the status plainly", () => {
    expect(devStatusText({ running: false })).toBe(
      "Development environment is not running",
    );
    expect(devStatusText({ running: true })).toBe(
      "Development environment is running",
    );
  });
});
