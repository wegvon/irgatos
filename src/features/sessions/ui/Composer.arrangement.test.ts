// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/voice", () => ({
  voiceStatus: async () => ({ supported: false }),
  requestVoiceAccess: async () => ({ supported: false }),
  startCapture: vi.fn(),
  speak: vi.fn(),
  summarizeReply: async () => null,
  suggestNextPrompt: vi.fn(),
  systemVoices: async () => [],
  openVoicePrivacySettings: vi.fn(),
  saveTranscriptionKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

import { Composer } from "./Composer";

let container: HTMLDivElement;
let root: Root;
let onSubmit: ReturnType<typeof vi.fn>;

async function render(suggestArrangement: boolean) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "~",
        sessionId: "s1",
        suggestArrangement,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit,
      }),
    ),
  );
}

const textarea = () => container.querySelector("textarea")!;
const hint = () => container.querySelector<HTMLElement>("[data-arrangement-hint]");

async function type(value: string) {
  await act(async () => {
    textarea().value = value;
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  onSubmit = vi.fn(() => true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Composer suggested setup", () => {
  it("suggests planning a big change first and sends it in plan mode once used", async () => {
    await render(true);
    await type("Refactor the mail sync so accounts load in parallel");
    expect(hint()?.dataset.arrangementHint).toBe("plan");
    expect(hint()?.textContent).toContain("Suggested: Plan first.");

    const use = [...hint()!.querySelectorAll("button")].find((b) => b.textContent === "Use")!;
    await act(async () => use.click());
    expect(hint()).toBeNull();

    await act(async () => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][2]).toMatchObject({ intent: "plan" });
  });

  it("stays away after the first message and once hidden", async () => {
    await render(false);
    await type("Refactor the mail sync so accounts load in parallel");
    expect(hint()).toBeNull();

    await render(true);
    await type("Refactor the mail sync so accounts load in parallel");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Hide suggestion"]')!.click(),
    );
    await type("Migrate the settings store to SQLite with a rewrite");
    expect(hint()).toBeNull();
  });
});
