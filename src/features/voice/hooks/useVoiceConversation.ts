import { useCallback, useEffect, useRef, useState } from "react";
import { speak, type SpeechHandle } from "../../../platform/tauri/voice";
import { createEndpointer, type Endpointer } from "../model/endpointing";
import { spokenReply, type Reply } from "../model/spokenReply";
import { loadVoiceSettings } from "../model/voiceSettings";
import type { Dictation } from "./useDictation";

export type ConversationPhase =
  | "off"
  /** Between turns, about to open the microphone. */
  | "ready"
  | "listening"
  /** The pause was long enough; the transcript is settling, then it sends. */
  | "sending"
  | "waiting"
  | "speaking"
  /** The draft has typed text, or a key was just pressed. */
  | "paused";

type Options = {
  dictation: Dictation;
  /** The composer can take voice right now: visible, enabled, supported. */
  available: boolean;
  busy: boolean;
  draftEmpty: boolean;
  /** The agent's last finished reply in this session. */
  reply: Reply | null;
  /** Finish the capture and send what was heard. */
  send: () => void;
};

/** Typing, then a pause this long, before the microphone opens again. */
export const TYPING_GRACE_MS = 1500;
/** A capture that ends this quickly with nothing heard waits before retrying. */
const RETRY_MS = 1500;
/** A quiet capture restarts before the recognizer's own one-minute limit. */
const IDLE_RESTART_MS = 50_000;
const TICK_MS = 100;
const SENT_HOLD_MS = 1500;

export function useVoiceConversation({
  dictation,
  available,
  busy,
  draftEmpty,
  reply,
  send,
}: Options) {
  const [on, setOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const speakingRef = useRef(false);
  const speechRef = useRef<SpeechHandle | null>(null);
  const spokenRef = useRef<string | null>(null);
  const ownsCaptureRef = useRef(false);
  const endpointerRef = useRef<Endpointer | null>(null);
  const captureStartedRef = useRef(0);
  const holdUntilRef = useRef(0);
  const holdReasonRef = useRef<"typing" | "retry" | "sent">("retry");
  const sendRef = useRef(send);
  sendRef.current = send;
  const replyRef = useRef(reply);
  replyRef.current = reply;

  const stopSpeaking = useCallback(() => {
    speechRef.current?.stop();
  }, []);

  const hold = useCallback(
    (until: number, reason: "typing" | "retry" | "sent") => {
      if (until > holdUntilRef.current) {
        holdUntilRef.current = until;
        holdReasonRef.current = reason;
      }
      setTick((value) => value + 1);
    },
    [],
  );

  const startSpeaking = useCallback((text: string) => {
    speakingRef.current = true;
    setSpeaking(true);
    const finish = () => {
      speechRef.current = null;
      speakingRef.current = false;
      setSpeaking(false);
    };
    void speak(text, loadVoiceSettings().speechProvider)
      .then((handle) => {
        speechRef.current = handle;
        if (!speakingRef.current) handle.stop();
        return handle.done;
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(finish);
  }, []);

  const { phase: capturePhase, error: captureError } = dictation;
  const { start: startCapture, detach: detachCapture } = dictation;

  const turnOff = useCallback(() => {
    setOn(false);
    setHeard(false);
    speakingRef.current = false;
    speechRef.current?.stop();
    if (ownsCaptureRef.current) detachCapture();
    ownsCaptureRef.current = false;
  }, [detachCapture]);

  const turnOn = useCallback(() => {
    setError(null);
    spokenRef.current = replyRef.current?.id ?? null;
    holdUntilRef.current = 0;
    setOn(true);
  }, []);

  const toggle = useCallback(() => {
    if (on) turnOff();
    else turnOn();
  }, [on, turnOff, turnOn]);

  useEffect(() => {
    if (on && !available) turnOff();
  }, [available, on, turnOff]);

  // A refused permission or a broken microphone would fail every retry.
  useEffect(() => {
    if (on && captureError) turnOff();
  }, [captureError, on, turnOff]);

  useEffect(() => {
    if (capturePhase !== "idle") return;
    if (ownsCaptureRef.current) {
      ownsCaptureRef.current = false;
      setHeard(false);
      if (
        !endpointerRef.current?.heard() &&
        Date.now() - captureStartedRef.current < RETRY_MS
      )
        hold(Date.now() + RETRY_MS, "retry");
    }
  }, [capturePhase, hold]);

  // Decides what happens next between turns: read the new reply, or listen.
  useEffect(() => {
    if (!on || !available || busy || speakingRef.current) return;
    const latest = replyRef.current;
    if (latest && latest.id !== spokenRef.current) {
      spokenRef.current = latest.id;
      const text = spokenReply(latest.text);
      if (text && loadVoiceSettings().readReplies && capturePhase === "idle") {
        startSpeaking(text);
        return;
      }
    }
    if (capturePhase !== "idle" || captureError || !draftEmpty) return;
    const wait = holdUntilRef.current - Date.now();
    if (wait > 0) {
      const timer = window.setTimeout(
        () => setTick((value) => value + 1),
        wait,
      );
      return () => window.clearTimeout(timer);
    }
    ownsCaptureRef.current = true;
    endpointerRef.current = createEndpointer({
      pauseMs: loadVoiceSettings().conversationPauseMs,
    });
    captureStartedRef.current = Date.now();
    void startCapture();
  }, [
    available,
    busy,
    captureError,
    capturePhase,
    draftEmpty,
    on,
    reply?.id,
    speaking,
    startCapture,
    startSpeaking,
    tick,
  ]);

  // Watches a voice-mode capture for the pause that ends the turn.
  const { levels, cancel: cancelCapture } = dictation;
  useEffect(() => {
    if (!on || capturePhase !== "listening" || !ownsCaptureRef.current) return;
    const endpointer = endpointerRef.current;
    if (!endpointer) return;
    const unsubscribe = levels.subscribe(() =>
      endpointer.level(levels.get(), Date.now()),
    );
    const timer = window.setInterval(() => {
      const now = Date.now();
      setHeard(endpointer.heard());
      if (endpointer.ended(now)) {
        window.clearInterval(timer);
        // The send is async; the agent may not report busy right away.
        hold(now + SENT_HOLD_MS, "sent");
        sendRef.current();
      } else if (
        !endpointer.heard() &&
        now - captureStartedRef.current > IDLE_RESTART_MS
      ) {
        window.clearInterval(timer);
        cancelCapture();
      }
    }, TICK_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [cancelCapture, capturePhase, hold, levels, on]);

  useEffect(() => {
    if (busy && holdReasonRef.current === "sent") holdUntilRef.current = 0;
  }, [busy]);

  // A turn started some other way; nothing said yet is not worth keeping open.
  useEffect(() => {
    if (!on || !busy || capturePhase === "idle" || !ownsCaptureRef.current)
      return;
    if (!endpointerRef.current?.heard()) cancelCapture();
  }, [busy, cancelCapture, capturePhase, on]);

  useEffect(
    () => () => {
      speakingRef.current = false;
      speechRef.current?.stop();
    },
    [],
  );

  /** The recognizer produced new words in a voice-mode capture. */
  const noteWords = useCallback(() => {
    if (ownsCaptureRef.current) endpointerRef.current?.words(Date.now());
  }, []);

  /** A key went down in the composer: reading stops and listening waits. */
  const noteTyping = useCallback(() => {
    if (!on) return;
    stopSpeaking();
    hold(Date.now() + TYPING_GRACE_MS, "typing");
  }, [hold, on, stopSpeaking]);

  const phase: ConversationPhase = !on
    ? "off"
    : speaking
      ? "speaking"
      : capturePhase === "finishing"
        ? "sending"
        : capturePhase !== "idle"
          ? "listening"
          : busy
            ? "waiting"
            : !draftEmpty ||
                (holdReasonRef.current === "typing" &&
                  holdUntilRef.current > Date.now())
              ? "paused"
              : "ready";

  return {
    on,
    phase,
    /** Speech was heard in this capture, so a pause will send it. */
    heard,
    error,
    clearError: useCallback(() => setError(null), []),
    toggle,
    turnOff,
    stopSpeaking,
    noteWords,
    noteTyping,
  };
}

export type VoiceConversation = ReturnType<typeof useVoiceConversation>;
