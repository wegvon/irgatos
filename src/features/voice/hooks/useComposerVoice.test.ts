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
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("../../../platform/tauri/voice", () => ({
  voiceStatus: voice.status,
  requestVoiceAccess: voice.status,
  startCapture: voice.start,
  speak: vi.fn(),
  systemVoices: async () => [],
  openVoicePrivacySettings: vi.fn(),
  saveTranscriptionKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

import { Composer } from "../../sessions/ui/Composer";
import { IrgatComposer } from "../../irgats/ui/IrgatComposer";
import { resetVoiceSupportForTests } from "./useVoiceSupport";
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

const latest = () => captures[captures.length - 1];

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A session composer and an Irgat chat box on screen together. */
async function renderBoth(owner: "session" | "irgat" | "both") {
  await act(async () =>
    root.render([
      createElement(
        "div",
        { key: "session", id: "session" },
        createElement(Composer, {
          focused: true,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          executionCwd: "~",
          hideTopBar: true,
          hotkeys: owner !== "irgat",
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: vi.fn(),
        }),
      ),
      createElement(
        "div",
        { key: "irgat", id: "irgat" },
        createElement(IrgatComposer, {
          sessionId: "irgat-isolation-test",
          name: "Irgat",
          hotkeys: owner !== "session",
          controls: null,
          onSubmit: vi.fn(),
        }),
      ),
    ]),
  );
  await flush();
}

const field = (pane: "session" | "irgat") =>
  container.querySelector<HTMLTextAreaElement>(`#${pane} textarea`)!;
const micButton = (pane: "session" | "irgat") =>
  container.querySelector<HTMLButtonElement>(
    `#${pane} [data-dictation-button]`,
  )!;
const strip = (pane: "session" | "irgat") =>
  container.querySelector(`#${pane} [data-dictation-strip]`);

function dictateShortcut() {
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
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetVoiceSupportForTests();
  setComposerDraft("irgat-isolation-test", "");
  captures = [];
  voice.status.mockReset().mockResolvedValue(GRANTED);
  voice.stop.mockReset();
  voice.cancel.mockReset();
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

describe("two composers sharing the microphone", () => {
  it("dictates into the Irgat chat box when it owns the shortcuts", async () => {
    await renderBoth("irgat");
    await act(async () => dictateShortcut());
    await flush();

    expect(voice.start).toHaveBeenCalledOnce();
    expect(strip("irgat")).not.toBeNull();
    expect(strip("session")).toBeNull();

    await act(async () => latest().handlers.onPartial?.("over here"));
    expect(field("irgat").value).toBe("over here");
    expect(field("session").value).toBe("");
  });

  it("dictates into the session composer when that one owns them", async () => {
    await renderBoth("session");
    await act(async () => dictateShortcut());
    await flush();

    expect(voice.start).toHaveBeenCalledOnce();
    expect(strip("session")).not.toBeNull();
    expect(strip("irgat")).toBeNull();

    await act(async () => latest().handlers.onPartial?.("over there"));
    expect(field("session").value).toBe("over there");
    expect(field("irgat").value).toBe("");
  });

  it("opens one microphone when both composers listen for the shortcut", async () => {
    await renderBoth("both");
    await act(async () => dictateShortcut());
    await flush();

    expect(voice.start).toHaveBeenCalledOnce();
    expect(captures).toHaveLength(1);
    await act(async () => latest().handlers.onPartial?.("just the one"));
    expect(
      [field("session").value, field("irgat").value].filter(Boolean),
    ).toEqual(["just the one"]);
  });

  it("drops the first capture when the other composer starts one", async () => {
    await renderBoth("irgat");
    await act(async () => micButton("session").click());
    await flush();
    await act(async () => latest().handlers.onPartial?.("first draft"));
    expect(field("session").value).toBe("first draft");

    await act(async () => micButton("irgat").click());
    await flush();
    expect(voice.cancel).toHaveBeenCalledOnce();
    expect(strip("session")).toBeNull();
    expect(captures).toHaveLength(2);

    // The words already heard stay where they were typed, and the second
    // capture writes only into the box that opened it.
    await act(async () => latest().handlers.onPartial?.("second draft"));
    expect(field("session").value).toBe("first draft");
    expect(field("irgat").value).toBe("second draft");
  });
});
