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
  speak: vi.fn(),
}));

vi.mock("../../../platform/tauri/voice", () => ({
  voiceStatus: voice.status,
  requestVoiceAccess: voice.request,
  startCapture: voice.start,
  speak: voice.speak,
  systemVoices: async () => [],
  openVoicePrivacySettings: voice.openSettings,
  saveTranscriptionKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

import { IrgatComposer } from "./IrgatComposer";
import { resetVoiceSupportForTests } from "../../voice/hooks/useVoiceSupport";
import { saveVoiceSettings } from "../../voice/model/voiceSettings";
import { setComposerDraft } from "../../sessions/model/draftCache";

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
let captures: { options: CaptureOptions; handlers: CaptureHandlers }[];
let onSubmit: ReturnType<typeof vi.fn>;

const latest = () => captures[captures.length - 1];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The chat box as an Irgat shows it under Irgats, with its controls row. */
async function renderComposer(props: Record<string, unknown> = {}) {
  await act(async () =>
    root.render(
      createElement(IrgatComposer, {
        sessionId: "irgat-voice-test",
        name: "Irgat",
        hotkeys: true,
        controls: null,
        onSubmit,
        ...props,
      }),
    ),
  );
  await flush();
}

const textarea = () =>
  container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message Irgat"]',
  )!;
const micButton = () =>
  container.querySelector<HTMLButtonElement>("[data-dictation-button]");
const modeButton = () =>
  container.querySelector<HTMLButtonElement>("[data-voice-mode-button]");
const strip = () => container.querySelector("[data-dictation-strip]");

async function startDictating() {
  await act(async () => micButton()!.click());
  await flush();
  expect(latest()).toBeDefined();
}

function press(key: string, init: KeyboardEventInit = {}) {
  textarea().dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

/** Typing, the way the field sees it: a key, then the new value. */
function type(value: string, key = value.slice(-1)) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  press(key);
  setValue.call(textarea(), value);
  textarea().dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setComposerDraft("irgat-voice-test", "");
  resetVoiceSupportForTests();
  captures = [];
  onSubmit = vi.fn();
  voice.status.mockReset().mockResolvedValue(GRANTED);
  voice.request.mockReset().mockResolvedValue(GRANTED);
  voice.stop.mockReset();
  voice.cancel.mockReset();
  voice.openSettings.mockReset();
  voice.speak.mockReset().mockResolvedValue({
    id: "speech-1",
    done: Promise.resolve({ interrupted: false }),
    stop: vi.fn(),
  });
  voice.start
    .mockReset()
    .mockImplementation(
      async (options: CaptureOptions, handlers: CaptureHandlers) => {
        captures.push({ options, handlers });
        return {
          id: `capture-${captures.length}`,
          stop: voice.stop,
          cancel: voice.cancel,
        };
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

describe("Irgat composer dictation", () => {
  it("offers the microphone and voice mode beside the chat box", async () => {
    await renderComposer();
    expect(micButton()).not.toBeNull();
    expect(modeButton()).not.toBeNull();
  });

  it("hides them where voice input is unsupported or turned off", async () => {
    voice.status.mockResolvedValue({ ...GRANTED, supported: false });
    await renderComposer();
    expect(micButton()).toBeNull();
    expect(modeButton()).toBeNull();

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
    setComposerDraft("irgat-voice-test", "Please now");
    await renderComposer();
    textarea().setSelectionRange(7, 7);
    await startDictating();

    expect(latest().options.locale).toBe("tr-TR");
    expect(strip()?.textContent).toContain("Listening");
    expect(micButton()?.getAttribute("aria-label")).toBe("Finish dictation");

    await act(async () => latest().handlers.onPartial?.("fix"));
    expect(textarea().value).toBe("Please fix now");
    await act(async () => latest().handlers.onPartial?.("fix the build"));
    expect(textarea().value).toBe("Please fix the build now");

    await act(async () => micButton()!.click());
    expect(voice.stop).toHaveBeenCalledOnce();
    await act(async () => latest().handlers.onFinal("fix the build"));

    expect(strip()).toBeNull();
    expect(textarea().value).toBe("Please fix the build now");
    expect(textarea().selectionStart).toBe(20);
    expect(document.activeElement).toBe(textarea());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("puts the draft back when dictation is cancelled with Escape", async () => {
    setComposerDraft("irgat-voice-test", "keep this");
    await renderComposer();
    textarea().setSelectionRange(5, 9);
    await startDictating();
    await act(async () => latest().handlers.onPartial?.("drop that"));
    expect(textarea().value).toBe("keep drop that");

    await act(async () => press("Escape"));
    expect(voice.cancel).toHaveBeenCalledOnce();
    expect(strip()).toBeNull();
    expect(textarea().value).toBe("keep this");
    expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([
      5, 9,
    ]);
  });

  it("sends once the transcript settles when Enter is pressed mid-sentence", async () => {
    await renderComposer();
    await startDictating();
    await act(async () => latest().handlers.onPartial?.("run the"));
    await act(async () => press("Enter"));
    expect(voice.stop).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => latest().handlers.onFinal("run the tests"));
    await flush();
    expect(onSubmit).toHaveBeenCalledWith("run the tests", []);
    expect(textarea().value).toBe("");
  });

  it("lets typing take over and keeps what was heard", async () => {
    await renderComposer();
    await startDictating();
    await act(async () => latest().handlers.onPartial?.("hello"));

    await act(async () => type("hello world", "d"));
    expect(voice.cancel).toHaveBeenCalledOnce();
    expect(strip()).toBeNull();
    await act(async () => latest().handlers.onPartial?.("ignored"));
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
          cancelable: true,
        }),
      );
    });
    await flush();
    expect(voice.start).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea());

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          code: "KeyE",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(voice.stop).toHaveBeenCalledOnce();
  });

  it("leaves the shortcuts alone when another composer owns them", async () => {
    await renderComposer({ hotkeys: false });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          code: "KeyE",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await flush();
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("explains a refused permission without touching the draft", async () => {
    voice.status.mockResolvedValue({ ...GRANTED, speech: "prompt" });
    voice.request.mockResolvedValue({ ...GRANTED, speech: "denied" });
    setComposerDraft("irgat-voice-test", "draft");
    await renderComposer();
    await act(async () => micButton()!.click());
    await flush();

    expect(voice.start).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Speech recognition is off");
    expect(textarea().value).toBe("draft");

    const open = [...alert!.querySelectorAll("button")].find(
      (button) => button.textContent === "Open System Settings",
    );
    await act(async () => open!.click());
    expect(voice.openSettings).toHaveBeenCalledWith("speech");
  });

  it("makes room for the buttons in the one-line chat box too", async () => {
    await renderComposer({ controls: undefined });
    const line = container.querySelector<HTMLElement>(
      '[data-layout="inline"]',
    )!;
    expect(line.className).toContain(
      "grid-cols-[1.625rem_minmax(0,1fr)_auto_1.625rem]",
    );
    expect(micButton()).not.toBeNull();
    expect(modeButton()).not.toBeNull();

    await startDictating();
    await act(async () => latest().handlers.onPartial?.("ship it"));
    expect(textarea().value).toBe("ship it");
  });

  it("keeps the microphone out of a chat box that cannot take messages", async () => {
    await renderComposer({ enabled: false });
    expect(micButton()?.disabled).toBe(true);
    expect(modeButton()?.disabled).toBe(true);
  });
});
