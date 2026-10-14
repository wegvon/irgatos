const KEY = "irgat.liveVoice";

export const LIVE_SETTINGS_CHANGE_EVENT = "irgat:live-voice-settings-change";

export const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export const LIVE_MODELS: { value: string; label: string }[] = [
  {
    value: "models/gemini-2.5-flash-native-audio-preview-12-2025",
    label: "Gemini 2.5 Flash native audio",
  },
  {
    value: "models/gemini-2.0-flash-live-001",
    label: "Gemini 2.0 Flash Live",
  },
];

export const LIVE_VOICES = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"] as const;
export type LiveVoiceName = (typeof LIVE_VOICES)[number];

export const LIVE_VOICE_HINTS: Record<LiveVoiceName, string> = {
  Puck: "Upbeat",
  Charon: "Informative",
  Kore: "Firm",
  Fenrir: "Excitable",
  Aoede: "Breezy",
};

export type LiveVoiceSettings = {
  /** A `models/…` name; anything the API accepts, the list is a starting point. */
  model: string;
  voice: LiveVoiceName;
  /** Cuts the Irgat off as soon as the microphone hears the user. */
  localBargeIn: boolean;
  /** Appends what was said in a live call to the chat. */
  saveTranscript: boolean;
};

export const LIVE_SETTINGS_DEFAULTS: LiveVoiceSettings = {
  model: LIVE_MODELS[0].value,
  voice: "Puck",
  localBargeIn: true,
  saveTranscript: true,
};

/** Accepts `gemini-…` as typed and gives the API its `models/` form. */
export function normalizeLiveModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return LIVE_SETTINGS_DEFAULTS.model;
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

let cached: { raw: string | null; value: LiveVoiceSettings } | null = null;

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): LiveVoiceSettings {
  if (!raw) return LIVE_SETTINGS_DEFAULTS;
  try {
    const stored = JSON.parse(raw) as Partial<Record<keyof LiveVoiceSettings, unknown>>;
    const bool = (value: unknown, fallback: boolean) =>
      typeof value === "boolean" ? value : fallback;
    return {
      model:
        typeof stored.model === "string" && stored.model.trim()
          ? normalizeLiveModel(stored.model)
          : LIVE_SETTINGS_DEFAULTS.model,
      voice: (LIVE_VOICES as readonly unknown[]).includes(stored.voice)
        ? (stored.voice as LiveVoiceName)
        : LIVE_SETTINGS_DEFAULTS.voice,
      localBargeIn: bool(stored.localBargeIn, LIVE_SETTINGS_DEFAULTS.localBargeIn),
      saveTranscript: bool(
        stored.saveTranscript,
        LIVE_SETTINGS_DEFAULTS.saveTranscript,
      ),
    };
  } catch {
    return LIVE_SETTINGS_DEFAULTS;
  }
}

/** Stable between changes, so it can back `useSyncExternalStore`. */
export function loadLiveSettings(): LiveVoiceSettings {
  const raw = read();
  if (cached?.raw !== raw) cached = { raw, value: parse(raw) };
  return cached.value;
}

export function saveLiveSettings(patch: Partial<LiveVoiceSettings>) {
  const next = { ...loadLiveSettings(), ...patch };
  next.model = normalizeLiveModel(next.model);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LIVE_SETTINGS_CHANGE_EVENT));
}

export function subscribeLiveSettings(onChange: () => void) {
  window.addEventListener(LIVE_SETTINGS_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(LIVE_SETTINGS_CHANGE_EVENT, onChange);
}
