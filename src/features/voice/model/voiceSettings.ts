import type { VoiceEngine } from "../../../platform/tauri/voice";

const KEY = "monocode.voice";

export const VOICE_SETTINGS_CHANGE_EVENT = "monocode:voice-settings-change";

export const DEFAULT_CLOUD_ENDPOINT =
  "https://api.openai.com/v1/audio/transcriptions";
export const DEFAULT_CLOUD_MODEL = "gpt-4o-mini-transcribe";

export type VoiceSettings = {
  /** Shows the microphone in the composer. */
  dictation: boolean;
  engine: VoiceEngine;
  /** BCP-47 such as "tr-TR"; empty follows the system language. */
  locale: string;
  /** Lets Apple's servers transcribe a language with no on-device model. */
  allowServer: boolean;
  cloudEndpoint: string;
  cloudModel: string;
  /** Silence after speech that sends the message in voice mode. */
  conversationPauseMs: number;
  /** Voice mode reads each finished reply aloud. */
  readReplies: boolean;
  /** A `say` voice name; empty uses the Spoken Content voice. */
  speechVoice: string;
  /** Words per minute; 0 uses the Spoken Content rate. */
  speechRate: number;
};

export const CONVERSATION_PAUSES = [800, 1200, 2000] as const;
export const SPEECH_RATES = [160, 0, 230] as const;

export const VOICE_SETTINGS_DEFAULTS: VoiceSettings = {
  dictation: true,
  engine: "apple",
  locale: "",
  allowServer: false,
  cloudEndpoint: DEFAULT_CLOUD_ENDPOINT,
  cloudModel: DEFAULT_CLOUD_MODEL,
  conversationPauseMs: 1200,
  readReplies: true,
  speechVoice: "",
  speechRate: 0,
};

/** Languages Apple's recognizer ships on-device models for on recent macOS. */
export const VOICE_LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "System language" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "tr-TR", label: "Türkçe" },
  { value: "de-DE", label: "Deutsch" },
  { value: "fr-FR", label: "Français" },
  { value: "es-ES", label: "Español (España)" },
  { value: "es-MX", label: "Español (México)" },
  { value: "it-IT", label: "Italiano" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "nl-NL", label: "Nederlands" },
  { value: "ru-RU", label: "Русский" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "zh-CN", label: "中文（普通话）" },
  { value: "ar-SA", label: "العربية" },
];

let cached: { raw: string | null; value: VoiceSettings } | null = null;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): VoiceSettings {
  if (!raw) return VOICE_SETTINGS_DEFAULTS;
  try {
    const stored = JSON.parse(raw) as Partial<VoiceSettings>;
    const pick = <K extends keyof VoiceSettings>(
      key: K,
      valid: (value: unknown) => boolean,
    ): VoiceSettings[K] =>
      valid(stored[key])
        ? (stored[key] as VoiceSettings[K])
        : VOICE_SETTINGS_DEFAULTS[key];
    const isBool = (value: unknown) => typeof value === "boolean";
    const isText = (value: unknown) => typeof value === "string";
    return {
      dictation: pick("dictation", isBool),
      engine: pick("engine", (value) => value === "apple" || value === "cloud"),
      locale: pick("locale", isText),
      allowServer: pick("allowServer", isBool),
      cloudEndpoint: pick(
        "cloudEndpoint",
        (value) => isText(value) && (value as string).trim() !== "",
      ),
      cloudModel: pick(
        "cloudModel",
        (value) => isText(value) && (value as string).trim() !== "",
      ),
      conversationPauseMs: pick("conversationPauseMs", (value) =>
        (CONVERSATION_PAUSES as readonly unknown[]).includes(value),
      ),
      readReplies: pick("readReplies", isBool),
      speechVoice: pick("speechVoice", isText),
      speechRate: pick("speechRate", (value) =>
        (SPEECH_RATES as readonly unknown[]).includes(value),
      ),
    };
  } catch {
    return VOICE_SETTINGS_DEFAULTS;
  }
}

/** Stable between changes, so it can back `useSyncExternalStore`. */
export function loadVoiceSettings(): VoiceSettings {
  const raw = read();
  if (cached?.raw !== raw) cached = { raw, value: parse(raw) };
  return cached.value;
}

export function saveVoiceSettings(patch: Partial<VoiceSettings>) {
  const next = { ...loadVoiceSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VOICE_SETTINGS_CHANGE_EVENT));
}

export function subscribeVoiceSettings(onChange: () => void) {
  window.addEventListener(VOICE_SETTINGS_CHANGE_EVENT, onChange);
  return () =>
    window.removeEventListener(VOICE_SETTINGS_CHANGE_EVENT, onChange);
}

/** The ISO-639-1 hint a transcription service takes, such as "tr". */
export function serviceLanguage(locale: string): string {
  return locale.trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
}
