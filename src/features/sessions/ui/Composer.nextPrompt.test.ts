// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reply } from "../../voice/model/spokenReply";

const voice = vi.hoisted(() => ({
  suggest: vi.fn(),
}));

vi.mock("../../../platform/tauri/voice", () => ({
  voiceStatus: async () => ({ supported: false }),
  requestVoiceAccess: async () => ({ supported: false }),
  startCapture: vi.fn(),
  speak: vi.fn(),
  summarizeReply: async () => null,
  suggestNextPrompt: voice.suggest,
  systemVoices: async () => [],
  openVoicePrivacySettings: vi.fn(),
  saveTranscriptionKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

import { Composer } from "./Composer";
import { resetNextPrompts } from "../model/nextPrompt";
import { saveNextPromptSuggestions } from "../../settings/model/displayPrefs";

let container: HTMLDivElement;
let root: Root;
let onSubmit: ReturnType<typeof vi.fn>;

const REPLY: Reply = {
  id: "a1",
  text: "Tests pass. Should I commit?",
  prompts: ["fix the build"],
};

async function render(props: {
  busy?: boolean;
  voiceReply?: Reply | null;
  sessionId?: string;
}) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "~",
        hideTopBar: true,
        sessionId: "s1",
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit,
        ...props,
      }),
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

const textarea = () => container.querySelector("textarea")!;
const badge = () =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Use suggested message"]',
  );

async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    textarea().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetNextPrompts();
  onSubmit = vi.fn();
  voice.suggest.mockReset().mockResolvedValue("Evet, commit et.");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Composer next-message suggestion", () => {
  it("shows the guess in grey and Tab puts it in without sending", async () => {
    await render({ voiceReply: REPLY });
    expect(voice.suggest).toHaveBeenCalledExactlyOnceWith(
      REPLY.text,
      ["fix the build"],
      "s1",
    );
    expect(textarea().placeholder).toBe("Evet, commit et.");
    expect(badge()?.textContent).toBe("Tab");

    await press("Tab");
    expect(textarea().value).toBe("Evet, commit et.");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(badge()).toBeNull();

    // Taken once, it does not come back when the draft is cleared.
    await act(async () => {
      textarea().value = "";
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea().placeholder).not.toBe("Evet, commit et.");
  });

  it("hides with Escape and asks only once per reply", async () => {
    await render({ voiceReply: REPLY });
    await press("Escape");
    expect(badge()).toBeNull();
    expect(textarea().placeholder).not.toBe("Evet, commit et.");

    await render({ voiceReply: { ...REPLY } });
    expect(voice.suggest).toHaveBeenCalledOnce();
    expect(badge()).toBeNull();
  });

  it("stays away while the agent works or when turned off", async () => {
    await render({ busy: true, voiceReply: REPLY });
    expect(voice.suggest).not.toHaveBeenCalled();

    saveNextPromptSuggestions(false);
    await render({ busy: false, voiceReply: REPLY });
    expect(voice.suggest).not.toHaveBeenCalled();
    expect(badge()).toBeNull();
  });

  it("leaves Tab alone when there is no suggestion", async () => {
    voice.suggest.mockResolvedValue(null);
    await render({ voiceReply: REPLY });
    expect(badge()).toBeNull();
    await press("Tab");
    expect(textarea().value).toBe("");
  });
});
