import { useSyncExternalStore } from "react";
import { AiVoice, CallEnd, Mic, MicOff } from "../../../../shared/ui/icons";
import type { LevelStore } from "../../model/levelStore";
import type { LivePhase, LiveState } from "../liveSession";
import { liveVoice, useLiveVoice } from "../liveVoice";

const DOTS = 4;

export const LIVE_PHASE_LABEL: Record<Exclude<LivePhase, "idle">, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  delegating: "Delegating task…",
  error: "Live voice stopped",
};

export function livePhaseLabel(state: LiveState): string {
  if (state.phase === "idle") return "";
  if (state.muted && state.phase === "listening") return "Muted";
  return LIVE_PHASE_LABEL[state.phase];
}

/** Starts and ends a Live voice call with this chat's agent. */
export function LiveVoiceButton({
  sessionId,
  disabled = false,
}: {
  sessionId: string;
  disabled?: boolean;
}) {
  const state = useLiveVoice(sessionId);
  const on = state.phase !== "idle" && state.phase !== "error";
  const label = on ? "End live voice" : "Live voice";
  return (
    <button
      type="button"
      title={on ? label : "Live voice: talk with the agent in real time"}
      aria-label={label}
      aria-pressed={on}
      data-live-voice-button
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void liveVoice().toggle(sessionId)}
      className={`grid size-6.5 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-60 ${
        on
          ? "bg-accent/15 text-accent"
          : "text-content/55 hover:bg-selection-hover hover:text-content"
      }`}
    >
      <AiVoice className="size-3.75" strokeWidth={1.75} />
    </button>
  );
}

/**
 * Four dots that breathe while the call waits, and rise with the voice
 * that is talking: the user's while listening, the agent's while speaking.
 */
export function LiveDots({
  phase,
  muted,
  input,
  output,
}: {
  phase: LivePhase;
  muted: boolean;
  input: LevelStore;
  output: LevelStore;
}) {
  const source = phase === "speaking" ? output : input;
  const level = useSyncExternalStore(source.subscribe, source.get, () => 0);
  const active = (phase === "listening" && !muted) || phase === "speaking";
  const waiting = phase === "connecting" || phase === "thinking" || phase === "delegating";
  return (
    <span
      aria-hidden
      data-live-dots
      data-phase={phase}
      className="flex h-4 shrink-0 items-center gap-0.75"
    >
      {Array.from({ length: DOTS }, (_, index) => {
        // The middle dots rise most, like a voice's shape.
        const weight = index === 1 || index === 2 ? 1 : 0.6;
        const height = active ? 4 + Math.min(1, level * 6) * 12 * weight : 4;
        return (
          <span
            key={index}
            className={`w-1 rounded-full transition-[height] duration-75 ${
              phase === "error"
                ? "bg-red-400/70"
                : muted && phase === "listening"
                  ? "bg-content/30"
                  : "bg-accent"
            } ${waiting ? "animate-pulse" : ""}`}
            style={{
              height: `${height}px`,
              ...(waiting ? { animationDelay: `${index * 150}ms` } : {}),
            }}
          />
        );
      })}
    </span>
  );
}

/** The call in progress, floating over the composer it was started from. */
export function LiveVoicePill({ sessionId }: { sessionId: string }) {
  const state = useLiveVoice(sessionId);
  if (state.phase === "idle") return null;
  const live = liveVoice();
  const failed = state.phase === "error";
  const caption = failed ? state.error : state.caption?.text;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-2 flex justify-center px-2">
      <div
        data-live-voice-pill
        data-phase={state.phase}
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex h-9 max-w-full min-w-0 items-center gap-2.5 rounded-full border bg-background-base/95 pl-3.5 pr-1 text-[12px] shadow-lg backdrop-blur-sm ${
          failed ? "border-red-400/40" : "border-content/12"
        }`}
      >
        <LiveDots
          phase={state.phase}
          muted={state.muted}
          input={live.inputLevels}
          output={live.outputLevels}
        />
        <span className="shrink-0 font-medium text-content/85">{livePhaseLabel(state)}</span>
        {caption ? (
          <span
            data-live-caption
            className={`min-w-0 max-w-72 truncate ${failed ? "text-red-400" : "text-content/45"}`}
          >
            {caption}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {failed ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void live.start(sessionId)}
              className="rounded-full px-2.5 py-1 text-content/70 hover:bg-content/10 hover:text-content"
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              title={state.muted ? "Unmute" : "Mute"}
              aria-label={state.muted ? "Unmute" : "Mute"}
              aria-pressed={state.muted}
              data-live-mute
              disabled={state.phase === "connecting"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => live.setMuted(!state.muted)}
              className={`grid size-7 place-items-center rounded-full transition-colors disabled:opacity-50 ${
                state.muted
                  ? "bg-content/12 text-content"
                  : "text-content/60 hover:bg-content/10 hover:text-content"
              }`}
            >
              {state.muted ? (
                <MicOff className="size-3.5" strokeWidth={1.75} />
              ) : (
                <Mic className="size-3.5" strokeWidth={1.75} />
              )}
            </button>
          )}
          <button
            type="button"
            title="End live voice"
            aria-label="End live voice"
            data-live-end
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => live.end()}
            className="grid size-7 place-items-center rounded-full bg-red-500/85 text-white hover:bg-red-500"
          >
            <CallEnd className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
