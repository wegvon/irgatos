// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { IrgatComposer } from "../../irgats/ui/IrgatComposer";
import { clearComposerDraft } from "../model/draftCache";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original()),
  invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("../../source-control/hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => ({ settled: true }),
}));

const window = {
  pid: 42,
  window_id: 19,
  app_name: "TextEdit",
  title: "Scratch document",
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  clearComposerDraft("app-test");
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "computer_use_selected") return null;
    if (command === "computer_use_windows") return [window];
    if (command === "computer_use_select")
      return { window: args.window, allowControl: args.allowControl };
    if (command === "claude_mcp_list") return "";
    return [];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["irgat", "session"])(
  "shares a window, enables control, submits and stops from the %s composer",
  async (kind) => {
    const submit = vi.fn(() => true);
    const stop = vi.fn();
    await act(async () =>
      root.render(
        kind === "irgat"
          ? createElement(IrgatComposer, {
              sessionId: "app-test",
              name: "Onna",
              busy: true,
              onSubmit: submit,
              onStop: stop,
            })
          : createElement(Composer, {
              sessionId: "app-test",
              harness: "codex",
              model: "",
              runtimeMode: "supervised",
              executionCwd: "~",
              initialDraft: "",
              hideTopBar: true,
              onFocus: vi.fn(),
              onCwdChange: vi.fn(),
              onModelChange: vi.fn(),
              onRuntimeModeChange: vi.fn(),
              onSubmit: submit,
              onStop: stop,
              busy: true,
            }),
      ),
    );
    const field = container.querySelector<HTMLTextAreaElement>(
      kind === "irgat"
        ? '[aria-label="Message Onna"]'
        : 'textarea:not([aria-hidden="true"])',
    )!;
    await act(async () => {
      field.focus();
      if (kind === "irgat") {
        const props = Object.entries(field).find(([key]) =>
          key.startsWith("__reactProps"),
        )![1];
        props.onChange({ target: { value: "@Text", selectionStart: 5 } });
      } else {
        field.setRangeText("@Text", 0, field.value.length, "end");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(
      container.querySelector('[aria-label="Open application windows"]')
        ?.textContent,
    ).toContain("TextEdit");
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(field.value).toContain("@app/TextEdit");
    expect(submit).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("computer_use_select", {
      sessionId: "app-test",
      window,
      allowControl: false,
    });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-shared-app-window] input",
    )!;
    expect(checkbox.checked).toBe(false);
    await act(async () => checkbox.click());
    expect(invoke).toHaveBeenCalledWith("computer_use_select", {
      sessionId: "app-test",
      window,
      allowControl: true,
    });
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(submit.mock.calls[0][0]).toContain("@app/TextEdit");
    expect(container.querySelector("[data-shared-app-window]")).not.toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Stop application control"]',
        )!
        .click(),
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("computer_use_revoke", {
      sessionId: "app-test",
    });
    expect(container.querySelector("[data-shared-app-window]")).toBeNull();
  },
);
