import { useCallback, useEffect, useRef, useState } from "react";
import {
  requestVoiceAccess,
  startCapture,
  voiceStatus,
  type CaptureHandle,
} from "../../../platform/tauri/voice";
import { createLevelStore, type LevelStore } from "../model/levelStore";
import { loadVoiceSettings, serviceLanguage } from "../model/voiceSettings";

export type DictationPhase = "idle" | "starting" | "listening" | "finishing";

export type DictationError = {
  message: string;
  /** The Privacy & Security pane that turns the missing permission on. */
  pane?: "microphone" | "speech";
};

/** Where the audio is transcribed, for the privacy hint beside the meter. */
export type DictationVenue = "device" | "apple" | "service";

export type DictationEnd = "final" | "cancel" | "error" | "detach";

type Options = {
  /** Just before the microphone opens; the draft is still untouched. */
  onBegin: () => void;
  /** The whole transcript so far. `final` arrives once, last. */
  onTranscript: (text: string, final: boolean) => void;
  onEnd?: (reason: DictationEnd) => void;
};

/** The recognizer normally answers Stop within a second. */
const FINAL_TIMEOUT_MS = 4000;

export function useDictation({ onBegin, onTranscript, onEnd }: Options) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState<DictationError | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [venue, setVenue] = useState<DictationVenue>("device");
  const [levels] = useState<LevelStore>(createLevelStore);
  const handleRef = useRef<CaptureHandle | null>(null);
  const generationRef = useRef(0);
  const heardRef = useRef("");
  const timeoutRef = useRef<number | undefined>(undefined);
  const callbacks = useRef({ onBegin, onTranscript, onEnd });
  callbacks.current = { onBegin, onTranscript, onEnd };
  const phaseRef = useRef<DictationPhase>("idle");
  phaseRef.current = phase;

  const finish = useCallback(
    (reason: DictationEnd) => {
      window.clearTimeout(timeoutRef.current);
      generationRef.current += 1;
      handleRef.current = null;
      levels.set(0);
      setPhase("idle");
      phaseRef.current = "idle";
      callbacks.current.onEnd?.(reason);
    },
    [levels],
  );

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    const generation = ++generationRef.current;
    const stale = () => generationRef.current !== generation;
    setError(null);
    setPhase("starting");
    phaseRef.current = "starting";
    const settings = loadVoiceSettings();
    const apple = settings.engine === "apple";
    let status = await voiceStatus(settings.locale);
    if (
      status.supported &&
      (status.microphone === "prompt" || (apple && status.speech === "prompt"))
    ) {
      status = await requestVoiceAccess(settings.engine, settings.locale);
    }
    if (stale()) return;
    const fail = (next: DictationError) => {
      setError(next);
      setPhase("idle");
      phaseRef.current = "idle";
    };
    if (status.setupError) {
      return fail({ message: status.setupError });
    }
    if (!status.supported) {
      return fail({ message: "Voice input is available on macOS for now." });
    }
    if (status.microphone !== "granted") {
      return fail({
        message: "Microphone access is off for MonoCode.",
        pane: "microphone",
      });
    }
    if (apple && status.speech !== "granted") {
      return fail({
        message: "Speech recognition is off for MonoCode.",
        pane: "speech",
      });
    }
    setVenue(!apple ? "service" : status.onDevice ? "device" : "apple");
    heardRef.current = "";
    callbacks.current.onBegin();
    try {
      const handle = await startCapture(
        {
          engine: settings.engine,
          locale: settings.locale,
          allowServer: settings.allowServer,
          cloud: apple
            ? undefined
            : {
                endpoint: settings.cloudEndpoint,
                model: settings.cloudModel,
                language: serviceLanguage(settings.locale),
              },
        },
        {
          onLevel: (level) => {
            if (!stale()) levels.set(level);
          },
          onPartial: (text) => {
            if (stale()) return;
            heardRef.current = text;
            callbacks.current.onTranscript(text, false);
          },
          onFinal: (text) => {
            if (stale()) return;
            callbacks.current.onTranscript(text, true);
            finish("final");
          },
          onError: (message) => {
            if (stale()) return;
            setError({ message });
            finish("error");
          },
        },
      );
      if (stale()) {
        handle.cancel();
        return;
      }
      handleRef.current = handle;
      setStartedAt(Date.now());
      setPhase("listening");
      phaseRef.current = "listening";
    } catch (reason) {
      if (stale()) return;
      setError({
        message: reason instanceof Error ? reason.message : String(reason),
      });
      finish("error");
    }
  }, [finish, levels]);

  /** Stop listening and keep the transcript. */
  const stop = useCallback(() => {
    const handle = handleRef.current;
    if (phaseRef.current !== "listening" || !handle) return;
    setPhase("finishing");
    phaseRef.current = "finishing";
    levels.set(0);
    handle.stop();
    // A service upload has its own timeout in Rust; the local recognizer
    // gets a short one, after which what was already on screen stands.
    if (loadVoiceSettings().engine === "cloud") return;
    const generation = generationRef.current;
    timeoutRef.current = window.setTimeout(() => {
      if (generationRef.current !== generation) return;
      handle.cancel();
      callbacks.current.onTranscript(heardRef.current, true);
      finish("final");
    }, FINAL_TIMEOUT_MS);
  }, [finish, levels]);

  const end = useCallback(
    (reason: "cancel" | "detach") => {
      if (phaseRef.current === "idle") return;
      handleRef.current?.cancel();
      finish(reason);
    },
    [finish],
  );

  /** Stop listening and drop the transcript. */
  const cancel = useCallback(() => end("cancel"), [end]);
  /** Stop listening and leave the draft as it is, for typing that takes over. */
  const detach = useCallback(() => end("detach"), [end]);

  const toggle = useCallback(() => {
    if (phaseRef.current === "idle") void start();
    else if (phaseRef.current === "listening") stop();
  }, [start, stop]);

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current);
      generationRef.current += 1;
      handleRef.current?.cancel();
    },
    [],
  );

  return {
    phase,
    active: phase !== "idle",
    error,
    clearError: useCallback(() => setError(null), []),
    startedAt,
    venue,
    levels,
    start,
    stop,
    cancel,
    detach,
    toggle,
  };
}

export type Dictation = ReturnType<typeof useDictation>;
