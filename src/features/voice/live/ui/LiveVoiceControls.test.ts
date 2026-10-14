// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLevelStore } from "../../model/levelStore";
import type { LiveServerEvent } from "../geminiLiveClient";
import type { EngineHandlers } from "../liveAudioEngine";
import { LIVE_SETTINGS_DEFAULTS } from "../liveSettings";
import { LIVE_IDLE, LiveVoiceController } from "../liveSession";
import { setLiveVoice } from "../liveVoice";
import {
  LiveDots,
  LiveVoiceButton,
  LiveVoicePill,
  livePhaseLabel,
} from "./LiveVoiceControls";

let container: HTMLDivElement;
let root: Root;
let emit: (event: LiveServerEvent) => void;
let engine: { handlers: EngineHandlers | null; muted: boolean; stopped: number };
let closed: number;
let key: string | null;

function controller() {
  engine = { handlers: null, muted: false, stopped: 0 };
  closed = 0;
  return new LiveVoiceController({
    host: () => ({
      session: (id) => ({ id, title: "Chat", cwd: "/", blocks: [] }),
      append: () => {},
      delegate: async () => ({ started: true }),
    }),
    apiKey: async () => key,
    createClient: () => ({
      connected: true,
      connect: async () => {},
      onEvent: (listener) => {
        emit = listener;
        return () => {};
      },
      onClose: () => () => {},
      sendAudio: () => {},
      sendAudioStreamEnd: () => {},
      sendText: () => {},
      sendToolResponse: () => {},
      close: () => {
        closed++;
      },
    }),
    createEngine: () => ({
      start: async (handlers) => {
        engine.handlers = handlers;
      },
      stop: () => {
        engine.stopped++;
      },
      setMuted: (muted) => {
        engine.muted = muted;
      },
      play: () => {},
      flush: () => false,
      outputLevel: () => 0,
      playing: false,
    }),
    settings: () => LIVE_SETTINGS_DEFAULTS,
    instruction: async () => ({ text: "", memoryTool: false }),
    tools: () => ({ saveNote: async () => ({ created: true }) }),
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  key = "AIza";
  setLiveVoice(controller());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setLiveVoice(null);
  vi.unstubAllGlobals();
});

async function render(sessionId = "chat") {
  await act(async () =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(LiveVoicePill, { sessionId }),
        createElement(LiveVoiceButton, { sessionId }),
      ),
    ),
  );
}

const button = () => container.querySelector<HTMLButtonElement>("[data-live-voice-button]")!;
const pill = () => container.querySelector<HTMLElement>("[data-live-voice-pill]");
const click = async (element: Element | null) => {
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("LiveVoiceButton and LiveVoicePill", () => {
  it("starts a call from the button and shows the pill while listening", async () => {
    await render();
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(button().getAttribute("aria-label")).toBe("Live voice");
    expect(pill()).toBeNull();
    await click(button());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(button().getAttribute("aria-label")).toBe("End live voice");
    expect(pill()?.dataset.phase).toBe("listening");
    expect(pill()?.textContent).toContain("Listening");
  });

  it("follows the call through speaking, captions and delegating", async () => {
    await render();
    await click(button());
    await act(async () => {
      emit({ type: "audio", data: "AAA=", rate: 24_000 });
      emit({ type: "outputTranscript", text: "On it." });
    });
    expect(pill()?.dataset.phase).toBe("speaking");
    expect(pill()?.textContent).toContain("Speaking");
    expect(container.querySelector("[data-live-caption]")?.textContent).toBe("On it.");
    await act(async () => {
      emit({
        type: "toolCall",
        calls: [{ id: "c", name: "delegate_to_irgat_session", args: { prompt: "go" } }],
      });
    });
    expect(container.querySelector("[data-live-voice-pill]")?.textContent).toMatch(
      /Delegating task…|Thinking|Speaking/,
    );
  });

  it("mutes and unmutes the microphone", async () => {
    await render();
    await click(button());
    const mute = () => container.querySelector<HTMLButtonElement>("[data-live-mute]")!;
    expect(mute().getAttribute("aria-label")).toBe("Mute");
    await click(mute());
    expect(engine.muted).toBe(true);
    expect(mute().getAttribute("aria-pressed")).toBe("true");
    expect(pill()?.textContent).toContain("Muted");
    await click(mute());
    expect(engine.muted).toBe(false);
  });

  it("ends the call from the pill", async () => {
    await render();
    await click(button());
    await click(container.querySelector("[data-live-end]"));
    expect(pill()).toBeNull();
    expect(closed).toBe(1);
    expect(engine.stopped).toBe(1);
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a missing key as an error with Try again", async () => {
    key = null;
    await render();
    await click(button());
    expect(pill()?.dataset.phase).toBe("error");
    expect(pill()?.textContent).toContain("Add a Gemini API key");
    expect(button().getAttribute("aria-pressed")).toBe("false");
    key = "AIza";
    const retry = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Try again",
    );
    await click(retry!);
    expect(pill()?.dataset.phase).toBe("listening");
  });

  it("stays out of other chats' composers", async () => {
    await render("other");
    const live = controller();
    setLiveVoice(live);
    await render("other");
    await act(async () => live.start("chat"));
    expect(pill()).toBeNull();
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });
});

describe("labels and dots", () => {
  it("names each phase", () => {
    expect(livePhaseLabel(LIVE_IDLE)).toBe("");
    expect(livePhaseLabel({ ...LIVE_IDLE, phase: "listening" })).toBe("Listening");
    expect(livePhaseLabel({ ...LIVE_IDLE, phase: "listening", muted: true })).toBe("Muted");
    expect(livePhaseLabel({ ...LIVE_IDLE, phase: "thinking" })).toBe("Thinking");
    expect(livePhaseLabel({ ...LIVE_IDLE, phase: "speaking" })).toBe("Speaking");
    expect(livePhaseLabel({ ...LIVE_IDLE, phase: "delegating" })).toBe("Delegating task…");
  });

  it("raises the dots with the voice that is talking and pulses while waiting", async () => {
    const input = createLevelStore();
    const output = createLevelStore();
    await act(async () =>
      root.render(createElement(LiveDots, { phase: "speaking", muted: false, input, output })),
    );
    const heights = () =>
      [...container.querySelectorAll<HTMLElement>("[data-live-dots] > span")].map(
        (dot) => dot.style.height,
      );
    expect(heights()).toEqual(["4px", "4px", "4px", "4px"]);
    await act(async () => output.set(1));
    expect(heights()).toEqual(["11.2px", "16px", "16px", "11.2px"]);
    await act(async () => input.set(1));
    expect(heights()[1]).toBe("16px");
    expect(container.innerHTML).not.toContain("animate-pulse");
    const thinking = renderToStaticMarkup(
      createElement(LiveDots, { phase: "thinking", muted: false, input, output }),
    );
    expect(thinking).toContain("animate-pulse");
    expect(thinking).toContain("height:4px");
  });
});
