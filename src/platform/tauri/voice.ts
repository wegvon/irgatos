import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Rust emits every capture event here; the payload names its capture. */
export const VOICE_EVENT = "irgat:voice";

export type VoicePermission = "prompt" | "granted" | "denied" | "unsupported";

export type VoiceEngine = "apple" | "cloud" | "qwen";

export type VoiceStatus = {
  supported: boolean;
  /** A missing macOS privacy declaration that would make TCC terminate the app. */
  setupError?: string | null;
  microphone: VoicePermission;
  speech: VoicePermission;
  /** The requested language transcribes without a network. */
  onDevice: boolean;
  /** Apple's recognizer handles the requested language at all. */
  languageAvailable: boolean;
  /** What the recognizer resolved the language to, such as "en-US". */
  locale: string | null;
  cloudKey: boolean;
};

export type VoiceEvent =
  | { kind: "level"; capture: string; level: number }
  | { kind: "partial"; capture: string; text: string }
  | { kind: "final"; capture: string; text: string }
  | { kind: "error"; capture: string; message: string };

export type CaptureOptions = {
  engine: VoiceEngine;
  /** BCP-47 such as "tr-TR"; empty follows the system language. */
  locale: string;
  allowServer: boolean;
  cloud?: { endpoint: string; model: string; language: string };
};

export type CaptureHandlers = {
  onLevel?: (level: number) => void;
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
};

export type CaptureHandle = {
  id: string;
  /** Stop listening; the transcript arrives through `onFinal`. */
  stop: () => void;
  /** Stop listening and drop the transcript. No handler runs afterwards. */
  cancel: () => void;
};

const UNSUPPORTED: VoiceStatus = {
  supported: false,
  microphone: "unsupported",
  speech: "unsupported",
  onDevice: false,
  languageAvailable: false,
  locale: null,
  cloudKey: false,
};

const captures = new Map<string, CaptureHandlers>();
let subscription: Promise<UnlistenFn | void> | null = null;
let sequence = 0;

function subscribe() {
  subscription ??= listen<VoiceEvent>(VOICE_EVENT, (event) =>
    deliver(event.payload),
  ).catch(console.error);
  return subscription;
}

function deliver(event: VoiceEvent) {
  const handlers = captures.get(event.capture);
  if (!handlers) return;
  switch (event.kind) {
    case "level":
      handlers.onLevel?.(event.level);
      return;
    case "partial":
      handlers.onPartial?.(event.text);
      return;
    case "final":
      captures.delete(event.capture);
      handlers.onFinal(event.text);
      return;
    case "error":
      captures.delete(event.capture);
      handlers.onError(event.message);
  }
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export async function voiceStatus(locale = ""): Promise<VoiceStatus> {
  try {
    if (!isTauri()) return UNSUPPORTED;
    return await invoke<VoiceStatus>("voice_status", { locale });
  } catch {
    return UNSUPPORTED;
  }
}

/** Raises whichever macOS permission prompts are still undecided. */
export async function requestVoiceAccess(
  engine: VoiceEngine,
  locale = "",
): Promise<VoiceStatus> {
  try {
    if (!isTauri()) return UNSUPPORTED;
    return await invoke<VoiceStatus>("voice_request_access", {
      engine,
      locale,
    });
  } catch {
    return UNSUPPORTED;
  }
}

export async function startCapture(
  options: CaptureOptions,
  handlers: CaptureHandlers,
): Promise<CaptureHandle> {
  const id = `capture-${Date.now().toString(36)}-${++sequence}`;
  captures.set(id, handlers);
  await subscribe();
  try {
    await invoke("voice_start", { options: { capture: id, ...options } });
  } catch (reason) {
    captures.delete(id);
    throw new Error(errorText(reason));
  }
  return {
    id,
    stop: () => {
      void invoke("voice_stop", { capture: id }).catch(console.error);
    },
    cancel: () => {
      captures.delete(id);
      void invoke("voice_cancel", { capture: id }).catch(console.error);
    },
  };
}

/** Stores the transcription service key in Rust; an empty key removes it. */
export async function saveTranscriptionKey(key: string): Promise<boolean> {
  return invoke<boolean>("voice_set_cloud_key", { key });
}

export function openVoicePrivacySettings(pane: "microphone" | "speech") {
  void invoke("voice_open_privacy_settings", { pane }).catch(console.error);
}

/** Rust reports here when an utterance stops, for whatever reason. */
export const SPEECH_EVENT = "irgat:voice-speech";

export type SpeechProvider = "drama" | "ema" | "kahya";

export type SpeechHandle = {
  id: string;
  /** Settles when speech ends; `interrupted` when it was cut short. */
  done: Promise<{ interrupted: boolean }>;
  stop: () => void;
};

type SpeechResult = { interrupted: boolean; error?: string };
const utterances = new Map<string, (result: SpeechResult) => void>();
let speechSubscription: Promise<UnlistenFn | void> | null = null;

function subscribeSpeech() {
  speechSubscription ??= listen<SpeechResult & { id: string }>(
    SPEECH_EVENT,
    ({ payload }) => {
      const resolve = utterances.get(payload.id);
      utterances.delete(payload.id);
      resolve?.(payload);
    },
  ).catch((reason) => {
    speechSubscription = null;
    throw reason;
  });
  return speechSubscription;
}

/** The chosen service generates speech; macOS plays its WAV. */
export async function speak(
  text: string,
  provider: SpeechProvider = "drama",
): Promise<SpeechHandle> {
  if (!isTauri())
    throw new Error("Speech playback is available in the desktop app");
  const id = `speech-${Date.now().toString(36)}-${++sequence}`;
  let settle!: (result: SpeechResult) => void;
  const result = new Promise<SpeechResult>((resolve) => {
    settle = resolve;
  });
  utterances.set(id, settle);
  try {
    await subscribeSpeech();
    await invoke("voice_speak", { id, text, provider });
  } catch (reason) {
    utterances.delete(id);
    throw new Error(errorText(reason));
  }
  return {
    id,
    done: result.then(({ interrupted, error }) => {
      if (error) throw new Error(error);
      return { interrupted };
    }),
    stop: () => {
      utterances.delete(id);
      settle({ interrupted: true });
      void invoke("voice_stop_speaking", { id }).catch(console.error);
    },
  };
}
