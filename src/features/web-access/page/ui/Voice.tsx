import { useEffect, useRef, useState } from "react";
import type { WebVoice } from "../../model/protocol";
import { read, usePoll } from "../client";
import {
  canDictate,
  speakReply,
  startDictation,
  type Dictation,
  type Speech,
} from "../voice";
import { Spinner, useToast } from "./parts";
import { Mic, Square, VolumeHigh } from "../../../../shared/ui/icons";

/** The Mac's voice settings; dictation hides when it is off there. */
export function useVoice(): WebVoice | null {
  return usePoll(
    "voice",
    () => read<WebVoice>("voice"),
    () => 120_000,
  ).data;
}

function joined(base: string, heard: string): string {
  const said = heard.trim();
  if (!said) return base;
  return base && !/\s$/.test(base) ? `${base} ${said}` : `${base}${said}`;
}

/**
 * The composer's microphone: tap to talk, tap again to stop. What is heard
 * goes into the draft as it comes, after anything already typed.
 */
export function DictateButton({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const voice = useVoice();
  const toast = useToast();
  const [phase, setPhase] = useState<"idle" | "starting" | "on" | "ending">(
    "idle",
  );
  const [level, setLevel] = useState(0);
  const dictation = useRef<Dictation | null>(null);
  const base = useRef("");
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => () => dictation.current?.cancel(), []);

  if (!voice?.dictation || !canDictate()) return null;

  const start = async () => {
    base.current = value;
    setPhase("starting");
    try {
      dictation.current = await startDictation({
        onText: (text) => latest.current(joined(base.current, text)),
        onLevel: setLevel,
      });
      setPhase("on");
    } catch (error) {
      setPhase("idle");
      const denied =
        error instanceof DOMException && error.name === "NotAllowedError";
      toast(
        denied
          ? "Allow the microphone for this page in Safari's settings."
          : error instanceof Error
            ? error.message
            : String(error),
        "error",
      );
    }
  };

  const stop = async () => {
    const current = dictation.current;
    dictation.current = null;
    if (!current) return;
    setPhase("ending");
    try {
      const text = await current.stop();
      latest.current(joined(base.current, text));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPhase("idle");
      setLevel(0);
    }
  };

  const on = phase === "on";
  return (
    <button
      type="button"
      aria-label={on ? "Stop dictation" : "Dictate"}
      aria-pressed={on}
      disabled={disabled || phase === "starting" || phase === "ending"}
      onClick={() => void (on ? stop() : start())}
      className={`web-press relative flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${
        on
          ? "bg-rose-500 text-white"
          : "text-(--ink-2) active:bg-content/8"
      }`}
    >
      {on ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-rose-500/40 transition-transform duration-100"
          style={{ transform: `scale(${1 + level * 0.45})` }}
        />
      ) : null}
      <span className="relative">
        {phase === "starting" || phase === "ending" ? (
          <Spinner className="size-5" />
        ) : on ? (
          <Square className="size-4 fill-current" strokeWidth={0} />
        ) : (
          <Mic className="size-[22px]" />
        )}
      </span>
    </button>
  );
}

/** Under the last reply: the Mac's voice reads its summary on the phone. */
export function ReadAloud({ sessionId }: { sessionId: string }) {
  const voice = useVoice();
  const toast = useToast();
  const [stage, setStage] = useState<"idle" | "preparing" | "speaking">(
    "idle",
  );
  const speech = useRef<Speech | null>(null);

  useEffect(() => () => speech.current?.stop(), [sessionId]);

  if (!voice) return null;

  const toggle = () => {
    if (speech.current) {
      speech.current.stop();
      speech.current = null;
      setStage("idle");
      return;
    }
    try {
      const current = speakReply(sessionId, setStage);
      speech.current = current;
      current.done
        .catch((error) =>
          toast(error instanceof Error ? error.message : String(error), "error"),
        )
        .finally(() => {
          if (speech.current === current) {
            speech.current = null;
            setStage("idle");
          }
        });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const label =
    stage === "preparing"
      ? "Preparing…"
      : stage === "speaking"
        ? "Stop"
        : voice.summary
          ? "Listen to summary"
          : "Read aloud";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={stage !== "idle"}
      className="web-press inline-flex h-8 items-center gap-1.5 self-start rounded-full bg-content/6 px-3 text-[13px] font-medium text-(--ink-2) shadow-[inset_0_0_0_1px_var(--hairline)]"
    >
      {stage === "preparing" ? (
        <Spinner className="size-3.5" />
      ) : stage === "speaking" ? (
        <Square className="size-3 fill-current" strokeWidth={0} />
      ) : (
        <VolumeHigh className="size-4" />
      )}
      {label}
    </button>
  );
}
