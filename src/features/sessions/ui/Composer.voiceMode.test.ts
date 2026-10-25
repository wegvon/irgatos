// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CaptureHandlers,
  CaptureOptions,
  VoiceStatus,
} from "../../../platform/tauri/voice";
import type { Reply } from "../../voice/model/spokenReply";

const voice = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  summarize: vi.fn(),
  suggestNext: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../../../platform/tauri/voice", () => ({
  voiceStatus: voice.status,
  requestVoiceAccess: voice.status,
  startCapture: voice.start,
  speak: voice.speak,
  summarizeReply: voice.summarize,
  suggestNextPrompt: voice.suggestNext,
  systemVoices: async () => [],
  openVoicePrivacySettings: vi.fn(),
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
let captures: { options: CaptureOptions; handlers: CaptureHandlers }[];
let finishSpeech: ((interrupted: boolean) => void) | null;
let onSubmit: ReturnType<typeof vi.fn>;

const latest = () => captures[captures.length - 1];

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function render(props: { busy?: boolean; voiceReply?: Reply | null }) {
  await act(async () =>
    root.render(
      createElement(Composer, {
        focused: true,
        harness: "codex",
        model: "",
        runtimeMode: "supervised",
        executionCwd: "~",
        hideTopBar: true,
        hotkeys: true,
        onFocus: vi.fn(),
        onCwdChange: vi.fn(),
        onModelChange: vi.fn(),
        onRuntimeModeChange: vi.fn(),
        onSubmit,
        ...props,
      }),
    ),
  );
  await advance(0);
}

const textarea = () => container.querySelector("textarea")!;
const modeButton = () =>
  container.querySelector<HTMLButtonElement>("[data-voice-mode-button]")!;
const strip = () =>
  container.querySelector<HTMLElement>("[data-voice-mode-strip]");

async function turnOn() {
  await act(async () => modeButton().click());
  await advance(0);
}

/** Says `text`, then stays quiet for `pauseMs`. */
async function say(text: string, pauseMs = 1300) {
  await act(async () => latest().handlers.onPartial?.(text));
  await advance(pauseMs);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveVoiceSettings({ readReplies: true });
  resetVoiceSupportForTests();
  captures = [];
  finishSpeech = null;
  onSubmit = vi.fn();
  voice.status.mockReset().mockResolvedValue(GRANTED);
  voice.stop.mockReset();
  voice.cancel.mockReset();
  voice.stopSpeaking.mockReset().mockImplementation(() => finishSpeech?.(true));
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
  voice.summarize.mockReset().mockResolvedValue(null);
  voice.speak.mockReset().mockImplementation(async () => ({
    id: "speech-1",
    done: new Promise<{ interrupted: boolean }>((resolve) => {
      finishSpeech = (interrupted) => resolve({ interrupted });
    }),
    stop: voice.stopSpeaking,
  }));
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

describe("Composer voice mode", () => {
  it("listens, sends after a pause, reads the reply, then listens again", async () => {
    await render({ voiceReply: { id: "old", text: "Earlier answer." } });
    await turnOn();

    expect(captures).toHaveLength(1);
    expect(strip()?.dataset.phase).toBe("listening");
    expect(modeButton().getAttribute("aria-pressed")).toBe("true");

    await act(async () => latest().handlers.onPartial?.("run the"));
    await advance(600);
    await act(async () => latest().handlers.onPartial?.("run the tests"));
    await advance(600);
    expect(voice.stop).not.toHaveBeenCalled();
    expect(strip()?.textContent).toContain("Sends after a 1.2 s pause");
    await advance(700);
    expect(voice.stop).toHaveBeenCalledOnce();
    expect(strip()?.dataset.phase).toBe("sending");

    await act(async () => latest().handlers.onFinal("run the tests"));
    await advance(0);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toBe("run the tests");

    await render({ busy: true, voiceReply: null });
    expect(strip()?.dataset.phase).toBe("waiting");
    expect(captures).toHaveLength(1);

    saveVoiceSettings({ speechProvider: "kahya" });
    await render({
      busy: false,
      voiceReply: {
        id: "a1",
        text: "## Done\nAll **42** tests pass.\n```sh\nnpm test\n```",
      },
    });
    expect(voice.speak).toHaveBeenCalledExactlyOnceWith(
      "All 42 tests pass.",
      "kahya",
    );
    expect(strip()?.dataset.phase).toBe("speaking");
    expect(captures).toHaveLength(1);

    await act(async () => finishSpeech?.(false));
    await advance(0);
    expect(captures).toHaveLength(2);
    expect(strip()?.dataset.phase).toBe("listening");
  });

  it("does not read the reply that was already there when it turned on", async () => {
    await render({ voiceReply: { id: "old", text: "Earlier answer." } });
    await turnOn();
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it("interrupts a reply with Escape and goes back to listening", async () => {
    await render({});
    await turnOn();
    await say("hello");
    await act(async () => latest().handlers.onFinal("hello"));
    await render({ busy: true });
    await render({ busy: false, voiceReply: { id: "a1", text: "Hi there." } });
    expect(strip()?.dataset.phase).toBe("speaking");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await advance(0);
    expect(voice.stopSpeaking).toHaveBeenCalledOnce();
    expect(strip()?.dataset.phase).toBe("listening");
    expect(captures).toHaveLength(2);
  });

  it("never sends while typing, and waits until the draft is sent or cleared", async () => {
    await render({});
    await turnOn();
    await act(async () => latest().handlers.onPartial?.("draft this"));

    await act(async () => {
      textarea().dispatchEvent(
        new KeyboardEvent("keydown", { key: "!", bubbles: true }),
      );
      textarea().value = "draft this!";
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(voice.cancel).toHaveBeenCalledOnce();
    await advance(5000);
    expect(voice.stop).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(strip()?.dataset.phase).toBe("paused");
    expect(captures).toHaveLength(1);

    await act(async () => {
      textarea().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
      );
      textarea().value = "";
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await advance(1000);
    expect(captures).toHaveLength(1);
    await advance(600);
    expect(captures).toHaveLength(2);
  });

  it("keeps listening through silence and retries a capture that ends at once", async () => {
    await render({});
    await turnOn();
    await advance(10_000);
    expect(voice.stop).not.toHaveBeenCalled();

    await act(async () => latest().handlers.onFinal(""));
    await advance(0);
    expect(captures).toHaveLength(2);
    await act(async () => latest().handlers.onFinal(""));
    await advance(0);
    expect(captures).toHaveLength(2);
    await advance(1600);
    expect(captures).toHaveLength(3);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses the configured pause", async () => {
    saveVoiceSettings({ conversationPauseMs: 2000 });
    await render({});
    await turnOn();
    await say("think it over", 1500);
    expect(voice.stop).not.toHaveBeenCalled();
    await advance(600);
    expect(voice.stop).toHaveBeenCalledOnce();
  });

  it("only reads replies aloud when that is on", async () => {
    saveVoiceSettings({ readReplies: false });
    await render({});
    await turnOn();
    await say("hi");
    await act(async () => latest().handlers.onFinal("hi"));
    await render({ busy: true });
    await render({ busy: false, voiceReply: { id: "a1", text: "Hello." } });
    expect(voice.speak).not.toHaveBeenCalled();
    expect(captures).toHaveLength(2);
  });

  it("reads Gemini's summary when there is one", async () => {
    voice.summarize.mockResolvedValue("I fixed the build. Should I push?");
    saveVoiceSettings({ locale: "en-GB" });
    await render({});
    await turnOn();
    await say("fix it");
    await act(async () => latest().handlers.onFinal("fix it"));
    const text = "Fixed the build.\n\n- `a.ts`\n\nShould I push?";
    await render({ busy: true });
    await render({ busy: false, voiceReply: { id: "a1", text } });
    expect(voice.summarize).toHaveBeenCalledExactlyOnceWith(text, "en-GB");
    expect(voice.speak).toHaveBeenCalledExactlyOnceWith(
      "I fixed the build. Should I push?",
      "drama",
    );
  });

  it("reads the whole reply when the summary is off", async () => {
    saveVoiceSettings({ speechSummary: false });
    await render({});
    await turnOn();
    await say("hi");
    await act(async () => latest().handlers.onFinal("hi"));
    await render({ busy: true });
    await render({
      busy: false,
      voiceReply: { id: "a1", text: "## Done\nAll **42** tests pass." },
    });
    expect(voice.summarize).not.toHaveBeenCalled();
    expect(voice.speak).toHaveBeenCalledExactlyOnceWith(
      "Done. All 42 tests pass.",
      "drama",
    );
  });

  it("skips the reading when Escape lands while the summary is on its way", async () => {
    let answer!: (summary: string | null) => void;
    voice.summarize.mockReturnValue(
      new Promise<string | null>((resolve) => (answer = resolve)),
    );
    await render({});
    await turnOn();
    await say("hi");
    await act(async () => latest().handlers.onFinal("hi"));
    await render({ busy: true });
    await render({ busy: false, voiceReply: { id: "a1", text: "Hi there." } });
    expect(strip()?.dataset.phase).toBe("speaking");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await advance(0);
    expect(strip()?.dataset.phase).toBe("listening");
    await act(async () => answer("Hello."));
    await advance(0);
    expect(voice.speak).not.toHaveBeenCalled();
    expect(captures).toHaveLength(2);
  });

  it("clears a failed reading when voice mode turns off", async () => {
    voice.speak.mockRejectedValue(new Error("EMA is unreachable"));
    await render({});
    await turnOn();
    await say("hi");
    await act(async () => latest().handlers.onFinal("hi"));
    await render({ busy: true });
    await render({ busy: false, voiceReply: { id: "a1", text: "Hello." } });
    expect(container.textContent).toContain("EMA is unreachable");
    await act(async () => modeButton().click());
    await advance(0);
    expect(container.textContent).not.toContain("EMA is unreachable");
  });

  it("turns off from the strip, keeping what was heard", async () => {
    await render({});
    await turnOn();
    await act(async () => latest().handlers.onPartial?.("half a thought"));
    const end = strip()!.querySelector<HTMLButtonElement>(
      '[aria-label="End voice mode"]',
    )!;
    await act(async () => end.click());
    await advance(3000);

    expect(strip()).toBeNull();
    expect(voice.cancel).toHaveBeenCalledOnce();
    expect(textarea().value).toBe("half a thought");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(captures).toHaveLength(1);
  });

  it("toggles with its shortcut and turns off when the microphone is refused", async () => {
    voice.status.mockResolvedValue({ ...GRANTED, microphone: "denied" });
    await render({});
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "l",
          code: "KeyL",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    await advance(0);
    expect(strip()).toBeNull();
    expect(modeButton().getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Microphone access is off",
    );
    await advance(5000);
    expect(voice.start).not.toHaveBeenCalled();
  });
});
