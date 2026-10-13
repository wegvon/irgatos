import { AudioWave, VolumeHigh, X } from "../../../shared/ui/icons";
import type { ConversationPhase } from "../hooks/useVoiceConversation";
import type { LevelStore } from "../model/levelStore";
import { LevelBars } from "./DictationControls";

export function VoiceModeButton({
  on,
  shortcut,
  disabled = false,
  onToggle,
}: {
  on: boolean;
  /** Display form of the shortcut, or null when it is unbound. */
  shortcut: string | null;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const label = on ? "End voice mode" : "Voice mode";
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={on}
      data-voice-mode-button
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={`grid size-6.5 shrink-0 place-items-center rounded-md transition-colors disabled:opacity-60 ${
        on
          ? "bg-accent/15 text-accent"
          : "text-content/50 hover:bg-selection-hover hover:text-content"
      }`}
    >
      <AudioWave className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

const PHASE_LABEL: Record<Exclude<ConversationPhase, "off">, string> = {
  ready: "Voice mode",
  listening: "Listening",
  sending: "Sending…",
  waiting: "Agent is working",
  speaking: "Reading the reply",
  paused: "Paused while you type",
};

function hint(phase: ConversationPhase, heard: boolean, pauseMs: number) {
  const pause = `${(pauseMs / 1000).toFixed(pauseMs % 1000 ? 1 : 0)} s`;
  switch (phase) {
    case "listening":
      return heard
        ? `Sends after a ${pause} pause · Esc discards`
        : "Speak when you are ready";
    case "speaking":
      return "Esc or type to interrupt";
    case "paused":
      return "Send or clear the draft to keep talking";
    case "waiting":
      return "The reply will be read aloud";
    default:
      return "";
  }
}

export function VoiceModeStrip({
  phase,
  heard,
  pauseMs,
  readReplies,
  levels,
  onStopSpeaking,
  onEnd,
}: {
  phase: Exclude<ConversationPhase, "off">;
  heard: boolean;
  pauseMs: number;
  readReplies: boolean;
  levels: LevelStore;
  onStopSpeaking: () => void;
  onEnd: () => void;
}) {
  const live = phase === "listening";
  const note =
    phase === "waiting" && !readReplies ? "" : hint(phase, heard, pauseMs);
  return (
    <div
      data-voice-mode-strip
      data-phase={phase}
      role="status"
      aria-live="polite"
      className="mx-2 mb-1.5 flex h-8 min-w-0 items-center gap-2.5 rounded-md bg-accent/8 pl-2.5 pr-1 text-[12px] text-content/70"
    >
      {phase === "speaking" ? (
        <VolumeHigh
          aria-hidden
          className="size-3.5 shrink-0 animate-pulse text-accent"
        />
      ) : (
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${
            live
              ? "animate-pulse bg-accent"
              : phase === "sending" || phase === "waiting"
                ? "bg-accent/60"
                : "bg-content/30"
          }`}
        />
      )}
      {live ? <LevelBars levels={levels} live /> : null}
      <span className="shrink-0 font-medium text-content/80">
        {PHASE_LABEL[phase]}
      </span>
      {note ? (
        <span className="min-w-0 truncate text-content/40">{note}</span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {phase === "speaking" ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onStopSpeaking}
            className="rounded-md px-2 py-1 text-content/70 hover:bg-content/10 hover:text-content"
          >
            Stop reading
          </button>
        ) : null}
        <button
          type="button"
          title="End voice mode"
          aria-label="End voice mode"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onEnd}
          className="grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
