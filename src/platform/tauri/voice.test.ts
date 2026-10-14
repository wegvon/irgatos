import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

type VoiceModule = typeof import("./voice");

async function load(): Promise<VoiceModule> {
  vi.resetModules();
  return import("./voice");
}

function emit(payload: unknown) {
  const handler = vi.mocked(listen).mock.calls[0][1];
  handler({ event: "irgat:voice", id: 0, payload });
}

function handlers() {
  return {
    onLevel: vi.fn(),
    onPartial: vi.fn(),
    onFinal: vi.fn(),
    onError: vi.fn(),
  };
}

const OPTIONS = {
  engine: "apple",
  locale: "tr-TR",
  allowServer: false,
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("voiceStatus", () => {
  it("reports no support outside Tauri without calling Rust", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const voice = await load();
    expect(await voice.voiceStatus("tr-TR")).toMatchObject({
      supported: false,
      microphone: "unsupported",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks Rust for the requested language, and survives a failure", async () => {
    const status = {
      supported: true,
      microphone: "granted",
      speech: "prompt",
      onDevice: true,
      languageAvailable: true,
      locale: "tr-TR",
      cloudKey: false,
    };
    vi.mocked(invoke).mockResolvedValueOnce(status);
    const voice = await load();
    expect(await voice.voiceStatus("tr-TR")).toEqual(status);
    expect(invoke).toHaveBeenCalledWith("voice_status", { locale: "tr-TR" });

    vi.mocked(invoke).mockRejectedValueOnce(new Error("gone"));
    expect((await voice.voiceStatus()).supported).toBe(false);
  });

  it("requests access for the chosen engine", async () => {
    const voice = await load();
    await voice.requestVoiceAccess("cloud", "de-DE");
    expect(invoke).toHaveBeenCalledWith("voice_request_access", {
      engine: "cloud",
      locale: "de-DE",
    });
  });
});

describe("startCapture", () => {
  it("routes each event to its own capture until it finishes", async () => {
    const voice = await load();
    const first = handlers();
    const second = handlers();
    const a = await voice.startCapture(OPTIONS, first);
    const b = await voice.startCapture(OPTIONS, second);

    expect(listen).toHaveBeenCalledOnce();
    expect(a.id).not.toBe(b.id);
    expect(invoke).toHaveBeenCalledWith("voice_start", {
      options: { capture: a.id, ...OPTIONS },
    });

    emit({ kind: "level", capture: a.id, level: 0.5 });
    emit({ kind: "partial", capture: b.id, text: "merhaba" });
    emit({ kind: "final", capture: a.id, text: "selam" });
    emit({ kind: "partial", capture: a.id, text: "late" });
    emit({ kind: "error", capture: b.id, message: "Mic unplugged" });
    emit({ kind: "final", capture: b.id, text: "late" });

    expect(first.onLevel).toHaveBeenCalledExactlyOnceWith(0.5);
    expect(first.onFinal).toHaveBeenCalledExactlyOnceWith("selam");
    expect(first.onPartial).not.toHaveBeenCalled();
    expect(second.onPartial).toHaveBeenCalledExactlyOnceWith("merhaba");
    expect(second.onError).toHaveBeenCalledExactlyOnceWith("Mic unplugged");
    expect(second.onFinal).not.toHaveBeenCalled();
  });

  it("stops and cancels by capture id, and a cancelled capture hears nothing", async () => {
    const voice = await load();
    const events = handlers();
    const capture = await voice.startCapture(OPTIONS, events);

    capture.stop();
    expect(invoke).toHaveBeenLastCalledWith("voice_stop", {
      capture: capture.id,
    });
    capture.cancel();
    expect(invoke).toHaveBeenLastCalledWith("voice_cancel", {
      capture: capture.id,
    });
    emit({ kind: "final", capture: capture.id, text: "dropped" });
    expect(events.onFinal).not.toHaveBeenCalled();
  });

  it("rejects with Rust's message when the microphone cannot open", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("No microphone is connected");
    const voice = await load();
    const events = handlers();
    await expect(voice.startCapture(OPTIONS, events)).rejects.toThrow(
      "No microphone is connected",
    );
  });
});

describe("transcription key", () => {
  it("hands the key to Rust", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    const voice = await load();
    expect(await voice.saveTranscriptionKey("sk-test")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("voice_set_cloud_key", {
      key: "sk-test",
    });
  });
});

describe("speak", () => {
  function emitSpeech(payload: { id: string; interrupted: boolean }) {
    const call = vi
      .mocked(listen)
      .mock.calls.find(([event]) => event === "irgat:voice-speech")!;
    call[1]({ event: "irgat:voice-speech", id: 0, payload });
  }

  it("reads aloud through Rust and settles when that utterance ends", async () => {
    const voice = await load();
    const handle = await voice.speak("Done.", { voice: "Yelda", rate: 230 });
    expect(invoke).toHaveBeenCalledWith("voice_speak", {
      id: handle.id,
      text: "Done.",
      voice: "Yelda",
      rate: 230,
    });
    const settled = vi.fn();
    void handle.done.then(settled);

    emitSpeech({ id: "someone-else", interrupted: true });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    emitSpeech({ id: handle.id, interrupted: false });
    await expect(handle.done).resolves.toEqual({ interrupted: false });
  });

  it("uses the system voice and rate unless they are set", async () => {
    const voice = await load();
    await voice.speak("Hi", { voice: "", rate: 0 });
    expect(invoke).toHaveBeenCalledWith("voice_speak", {
      id: expect.any(String),
      text: "Hi",
      voice: null,
      rate: null,
    });
  });

  it("stops only its own utterance", async () => {
    const voice = await load();
    const handle = await voice.speak("Long reply");
    handle.stop();
    expect(invoke).toHaveBeenLastCalledWith("voice_stop_speaking", {
      id: handle.id,
    });
  });

  it("falls back to the webview voice where Rust cannot speak", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "voice_speak")
        throw "Reading aloud uses the macOS system voice";
    });
    const spoken: { text: string; rate: number; onend?: () => void }[] = [];
    class Utterance {
      rate = 1;
      voice: unknown = null;
      onend?: () => void;
      onerror?: () => void;
      constructor(public text: string) {}
    }
    const synth = {
      speak: vi.fn((utterance: Utterance) => spoken.push(utterance)),
      cancel: vi.fn(),
      getVoices: () => [],
    };
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    vi.stubGlobal("speechSynthesis", synth);
    try {
      const voice = await load();
      const handle = await voice.speak("Hello", { rate: 270 });
      expect(spoken[0]).toMatchObject({ text: "Hello", rate: 1.5 });
      spoken[0].onend?.();
      await expect(handle.done).resolves.toEqual({ interrupted: false });

      const second = await voice.speak("Again");
      second.stop();
      expect(synth.cancel).toHaveBeenCalled();
      await expect(second.done).resolves.toEqual({ interrupted: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lists system voices, and none outside Tauri", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { name: "Yelda", locale: "tr-TR" },
    ]);
    const voice = await load();
    expect(await voice.systemVoices()).toEqual([
      { name: "Yelda", locale: "tr-TR" },
    ]);
    vi.mocked(isTauri).mockReturnValue(false);
    expect(await voice.systemVoices()).toEqual([]);
  });
});
