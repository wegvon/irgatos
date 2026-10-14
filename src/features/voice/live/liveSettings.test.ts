// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_MODELS,
  LIVE_SETTINGS_DEFAULTS,
  LIVE_VOICES,
  loadLiveSettings,
  normalizeLiveModel,
  saveLiveSettings,
  subscribeLiveSettings,
} from "./liveSettings";

afterEach(() => localStorage.clear());

describe("live voice settings", () => {
  it("defaults to the native audio model and Puck", () => {
    expect(loadLiveSettings()).toEqual(LIVE_SETTINGS_DEFAULTS);
    expect(LIVE_SETTINGS_DEFAULTS.model).toBe(
      "models/gemini-2.5-flash-native-audio-preview-12-2025",
    );
    expect(LIVE_MODELS.map((model) => model.value)).toContain("models/gemini-2.0-flash-live-001");
    expect(LIVE_VOICES).toEqual(["Puck", "Charon", "Kore", "Fenrir", "Aoede"]);
  });

  it("saves, notifies and stays stable between changes", () => {
    const listener = vi.fn();
    const stop = subscribeLiveSettings(listener);
    saveLiveSettings({ voice: "Aoede", model: "gemini-live-2.5-flash-preview" });
    expect(listener).toHaveBeenCalledTimes(1);
    const loaded = loadLiveSettings();
    expect(loaded.voice).toBe("Aoede");
    expect(loaded.model).toBe("models/gemini-live-2.5-flash-preview");
    expect(loadLiveSettings()).toBe(loaded);
    stop();
  });

  it("drops stored values it does not recognise", () => {
    localStorage.setItem(
      "irgat.liveVoice",
      JSON.stringify({ voice: "Siri", model: "  ", localBargeIn: "yes", saveTranscript: false }),
    );
    expect(loadLiveSettings()).toEqual({ ...LIVE_SETTINGS_DEFAULTS, saveTranscript: false });
    localStorage.setItem("irgat.liveVoice", "{");
    expect(loadLiveSettings()).toEqual(LIVE_SETTINGS_DEFAULTS);
  });

  it("normalizes model ids", () => {
    expect(normalizeLiveModel(" gemini-x ")).toBe("models/gemini-x");
    expect(normalizeLiveModel("models/gemini-y")).toBe("models/gemini-y");
    expect(normalizeLiveModel("")).toBe(LIVE_SETTINGS_DEFAULTS.model);
  });
});
