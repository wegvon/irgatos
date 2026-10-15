// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CaptureHandlers,
  CaptureOptions,
  VoiceStatus,
} from "../../../platform/tauri/voice";

const voice = vi.hoisted(() => ({
  status: vi.fn(),
  request: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  openSettings: vi.fn(),
}));

vi.mock("../../../platform/tauri/voice", () => ({
  voiceStatus: voice.status,
  requestVoiceAccess: voice.request,
  startCapture: voice.start,
  openVoicePrivacySettings: voice.openSettings,
  saveTranscriptionKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

import { Composer } from "./Composer";
import { resetVoiceSupportForTests } from "../../voice/hooks/useVoiceSupport";
import { saveVoiceSettings } from "../../voice/model/voiceSettings";

const GRANTED: VoiceStatus = {
  supported: true,
  microphone: "granted",
  speech: "granted",
  onDevice: true,
  languageAvailable: true,
  locale: "en-US",
  cloudKey: false,
};

let container: HTMLDivElement;
let root: Root;
let capture: { options: CaptureOptions; handlers: CaptureHandlers } | null;
let onSubmit: ReturnType<typeof vi.fn>;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderComposer(initialDraft = "") {
  onSubmit = vi.fn();
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "~",
        initialDraft,
        hideTopBar: true,
        hotkeys: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit,
      }),
    ),
  );
  await flush();
}

const textarea = () => container.querySelector("textarea")!;
const micButton = () =>
  container.querySelector<HTMLButtonElement>("[data-dictation-button]");
const strip = () => container.querySelector("[data-dictation-strip]");

async function startDictating() {
  await act(async () => micButton()!.click());
  await flush();
  expect(capture).not.toBeNull();
}

async function emit(fn: (handlers: CaptureHandlers) => void) {
  await act(async () => fn(capture!.handlers));
}

function press(key: string, init: KeyboardEventInit = {}) {
  textarea().dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetVoiceSupportForTests();
  capture = null;
  voice.status.mockReset().mockResolvedValue(GRANTED);
  voice.request.mockReset().mockResolvedValue(GRANTED);
  voice.stop.mockReset();
  voice.cancel.mockReset();
  voice.openSettings.mockReset();
  voice.start
    .mockReset()
    .mockImplementation(
      async (options: CaptureOptions, handlers: CaptureHandlers) => {
        capture = { options, handlers };
        return { id: "capture-1", stop: voice.stop, cancel: voice.cancel };
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

describe("Composer dictation", () => {
  it("hides the microphone where voice input is unsupported or turned off", async () => {
    voice.status.mockResolvedValue({ ...GRANTED, supported: false });
    await renderComposer();
    expect(micButton()).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    resetVoiceSupportForTests();
    voice.status.mockResolvedValue(GRANTED);
    saveVoiceSettings({ dictation: false });
    await renderComposer();
    expect(micButton()).toBeNull();
  });

  it("writes partials live at the caret and keeps the final text editable", async () => {
    saveVoiceSettings({ locale: "tr-TR" });
    await renderComposer("Please now");
    textarea().setSelectionRange(7, 7);
    await startDictating();

    expect(capture!.options).toEqual({
      engine: "qwen",
      locale: "tr-TR",
      allowServer: false,
      cloud: undefined,
    });
    expect(strip()?.textContent).toContain("Listening");
    expect(strip()?.textContent).toContain("Qwen3-ASR");
    expect(micButton()?.getAttribute("aria-label")).toBe("Finish dictation");

    await emit((h) => h.onPartial?.("fix"));
    expect(textarea().value).toBe("Please fix now");
    await emit((h) => h.onPartial?.("fix the build"));
    expect(textarea().value).toBe("Please fix the build now");

    await act(async () => micButton()!.click());
    expect(voice.stop).toHaveBeenCalledOnce();
    expect(strip()?.textContent).toContain("Transcribing");

    await emit((h) => h.onFinal("fix the build"));
    expect(strip()).toBeNull();
    expect(textarea().value).toBe("Please fix the build now");
    expect(textarea().selectionStart).toBe(20);
    expect(document.activeElement).toBe(textarea());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("puts the draft back when dictation is cancelled with Escape", async () => {
    await renderComposer("keep this");
    textarea().setSelectionRange(5, 9);
    await startDictating();
    await emit((h) => h.onPartial?.("drop that"));
    expect(textarea().value).toBe("keep drop that");

    await act(async () => press("Escape"));
    expect(voice.cancel).toHaveBeenCalledOnce();
    expect(strip()).toBeNull();
    expect(textarea().value).toBe("keep this");
    expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([
      5, 9,
    ]);
  });

  it("restores a selection when nothing was heard", async () => {
    await renderComposer("keep this");
    textarea().setSelectionRange(5, 9);
    await startDictating();
    await act(async () => micButton()!.click());
    await emit((h) => h.onFinal(""));
    expect(textarea().value).toBe("keep this");
  });

  it("sends once the transcript settles when Enter is pressed mid-sentence", async () => {
    await renderComposer();
    await startDictating();
    await emit((h) => h.onPartial?.("run the"));
    await act(async () => press("Enter"));
    expect(voice.stop).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();

    await emit((h) => h.onFinal("run the tests"));
    await flush();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toBe("run the tests");
  });

  it("waits for the Qwen final result without dropping the live transcript", async () => {
    await renderComposer();
    await startDictating();
    await emit((h) => h.onPartial?.("almost done"));
    vi.useFakeTimers();
    try {
      await act(async () => micButton()!.click());
      await act(async () => vi.advanceTimersByTime(4000));
    } finally {
      vi.useRealTimers();
    }
    expect(voice.cancel).not.toHaveBeenCalled();
    expect(strip()).not.toBeNull();
    expect(textarea().value).toBe("almost done");
    await emit((h) => h.onFinal("complete result"));
    expect(strip()).toBeNull();
    expect(textarea().value).toBe("complete result");
  });

  it("lets typing take over and keeps what was heard", async () => {
    await renderComposer();
    await startDictating();
    await emit((h) => h.onPartial?.("hello"));

    await act(async () => {
      textarea().value = "hello world";
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(voice.cancel).toHaveBeenCalledOnce();
    expect(strip()).toBeNull();
    await emit((h) => h.onPartial?.("ignored"));
    expect(textarea().value).toBe("hello world");
  });

  it("toggles with the dictation shortcut", async () => {
    await renderComposer();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          code: "KeyE",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    await flush();
    expect(voice.start).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          code: "KeyE",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(voice.stop).toHaveBeenCalledOnce();
  });

  it("asks for undecided permissions and explains a refusal", async () => {
    voice.status.mockResolvedValue({ ...GRANTED, microphone: "prompt" });
    voice.request.mockResolvedValue({ ...GRANTED, microphone: "denied" });
    await renderComposer("draft");
    await act(async () => micButton()!.click());
    await flush();

    expect(voice.request).toHaveBeenCalledWith("qwen", "tr-TR");
    expect(voice.start).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Microphone access is off");
    expect(textarea().value).toBe("draft");

    const open = [...alert!.querySelectorAll("button")].find(
      (button) => button.textContent === "Open System Settings",
    );
    await act(async () => open!.click());
    expect(voice.openSettings).toHaveBeenCalledWith("microphone");
  });

  it("shows a recognizer failure and leaves the words it heard", async () => {
    await renderComposer();
    await startDictating();
    await emit((h) => h.onPartial?.("half a"));
    await emit((h) => h.onError("The recognizer stopped"));

    expect(strip()).toBeNull();
    expect(textarea().value).toBe("half a");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The recognizer stopped",
    );
  });

  it("uploads to the configured service without asking for speech access", async () => {
    saveVoiceSettings({
      engine: "cloud",
      locale: "tr-TR",
      cloudEndpoint: "http://127.0.0.1:8080/v1/audio/transcriptions",
      cloudModel: "whisper-1",
    });
    voice.status.mockResolvedValue({ ...GRANTED, speech: "prompt" });
    await renderComposer();
    await startDictating();

    expect(voice.request).not.toHaveBeenCalled();
    expect(capture!.options.cloud).toEqual({
      endpoint: "http://127.0.0.1:8080/v1/audio/transcriptions",
      model: "whisper-1",
      language: "tr",
    });
    expect(strip()?.textContent).toContain("Transcription service");
  });
});
