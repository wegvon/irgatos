// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  serviceLanguage,
  subscribeVoiceSettings,
  VOICE_LANGUAGES,
  VOICE_SETTINGS_DEFAULTS,
} from "./voiceSettings";

afterEach(() => {
  localStorage.clear();
});

describe("voice settings", () => {
  it("defaults to Qwen streaming dictation", () => {
    expect(loadVoiceSettings()).toEqual(VOICE_SETTINGS_DEFAULTS);
    expect(VOICE_SETTINGS_DEFAULTS).toMatchObject({
      dictation: true,
      engine: "qwen",
      allowServer: false,
    });
  });

  it("saves a patch, announces it, and stays referentially stable", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeVoiceSettings(onChange);
    saveVoiceSettings({ locale: "tr-TR", engine: "cloud" });
    unsubscribe();
    saveVoiceSettings({ dictation: false });

    expect(onChange).toHaveBeenCalledOnce();
    const loaded = loadVoiceSettings();
    expect(loaded).toMatchObject({
      locale: "tr-TR",
      engine: "cloud",
      dictation: false,
    });
    expect(loadVoiceSettings()).toBe(loaded);
  });

  it("keeps Drama for existing settings and persists either alternative", () => {
    localStorage.setItem("irgat.voice", JSON.stringify({ readReplies: false }));
    expect(loadVoiceSettings()).toMatchObject({
      speechProvider: "drama",
      readReplies: false,
    });
    for (const speechProvider of ["ema", "kahya", "drama"] as const) {
      saveVoiceSettings({ speechProvider });
      expect(loadVoiceSettings().speechProvider).toBe(speechProvider);
      expect(
        JSON.parse(localStorage.getItem("irgat.voice")!).speechProvider,
      ).toBe(speechProvider);
    }
    localStorage.setItem(
      "irgat.voice",
      JSON.stringify({ speechProvider: "unknown" }),
    );
    expect(loadVoiceSettings().speechProvider).toBe("drama");
  });

  it("falls back per field on stored values it does not understand", () => {
    localStorage.setItem(
      "irgat.voice",
      JSON.stringify({
        engine: "whisper",
        dictation: "yes",
        locale: "de-DE",
        cloudEndpoint: "  ",
        cloudModel: "whisper-1",
      }),
    );
    expect(loadVoiceSettings()).toEqual({
      ...VOICE_SETTINGS_DEFAULTS,
      locale: "de-DE",
      cloudModel: "whisper-1",
    });

    localStorage.setItem("irgat.voice", "{not json");
    expect(loadVoiceSettings()).toEqual(VOICE_SETTINGS_DEFAULTS);
  });

  it("offers the system language first and Turkish among the choices", () => {
    expect(VOICE_LANGUAGES[0]).toEqual({ value: "", label: "System language" });
    expect(VOICE_LANGUAGES.map((language) => language.value)).toContain(
      "tr-TR",
    );
    expect(
      new Set(VOICE_LANGUAGES.map((language) => language.value)).size,
    ).toBe(VOICE_LANGUAGES.length);
  });

  it("hands a transcription service the bare language code", () => {
    expect(serviceLanguage("tr-TR")).toBe("tr");
    expect(serviceLanguage("zh_CN")).toBe("zh");
    expect(serviceLanguage("")).toBe("");
  });
});

it("migrates saved Apple dictation to Qwen without losing microphone preferences", () => {
  localStorage.setItem(
    "irgat.voice",
    JSON.stringify({
      engine: "apple",
      dictation: false,
      locale: "tr-TR",
      conversationPauseMs: 2000,
    }),
  );
  expect(loadVoiceSettings()).toMatchObject({
    engine: "qwen",
    dictation: false,
    locale: "tr-TR",
    conversationPauseMs: 2000,
  });
});
