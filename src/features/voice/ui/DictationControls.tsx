import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Mic, X } from "../../../shared/ui/icons";
import { openVoicePrivacySettings } from "../../../platform/tauri/voice";
import type {
  DictationError,
  DictationPhase,
  DictationVenue,
} from "../hooks/useDictation";
import type { LevelStore } from "../model/levelStore";

const BARS = 18;

const PHASE_LABEL: Record<Exclude<DictationPhase, "idle">, string> = {
  starting: "Starting microphone…",
  listening: "Listening",
  finishing: "Transcribing…",
};

const VENUE_LABEL: Record<DictationVenue, string> = {
  device: "On this Mac",
  apple: "Apple servers",
  service: "Transcription service",
  qwen: "Qwen3-ASR · Rem",
};

export function DictationButton({
  phase,
  levels,
  shortcut,
  disabled = false,
  onToggle,
}: {
  phase: DictationPhase;
  levels: LevelStore;
  /** Display form of the shortcut, or null when it is unbound. */
  shortcut: string | null;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const level = useSyncExternalStore(levels.subscribe, levels.get, () => 0);
  const listening = phase === "listening";
  const label = listening
    ? "Finish dictation"
    : shortcut
      ? `Dictate (${shortcut})`
      : "Dictate";
  return (
    <button
      type="button"
      title={label}
      aria-label={listening ? "Finish dictation" : "Dictate"}
      aria-pressed={phase !== "idle"}
      data-dictation-button
      disabled={disabled || phase === "starting" || phase === "finishing"}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      style={
        listening
          ? {
              boxShadow: `0 0 0 ${1 + level * 4}px rgb(248 113 113 / ${0.18 + level * 0.25})`,
            }
          : undefined
      }
      className={`grid size-6.5 shrink-0 place-items-center rounded-md transition-[background-color,color,box-shadow] duration-75 ${
        phase === "idle"
          ? "text-content/50 hover:bg-selection-hover hover:text-content"
          : "bg-red-400/15 text-red-300"
      } disabled:opacity-60`}
    >
      <Mic className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

export function DictationStrip({
  phase,
  startedAt,
  venue,
  levels,
  onCancel,
  onDone,
}: {
  phase: Exclude<DictationPhase, "idle">;
  startedAt: number;
  venue: DictationVenue;
  levels: LevelStore;
  onCancel: () => void;
  onDone: () => void;
}) {
  return (
    <div
      data-dictation-strip
      role="status"
      aria-live="polite"
      className="mx-2 mb-1.5 flex h-8 min-w-0 items-center gap-2.5 rounded-md bg-content/5 pl-2.5 pr-1 text-[12px] text-content/70"
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${
          phase === "listening" ? "animate-pulse bg-red-400" : "bg-content/30"
        }`}
      />
      <LevelBars levels={levels} live={phase === "listening"} />
      <span className="shrink-0 font-medium text-content/80">
        {PHASE_LABEL[phase]}
      </span>
      {phase === "listening" ? <Elapsed since={startedAt} /> : null}
      <span className="min-w-0 truncate text-content/35">
        {VENUE_LABEL[venue]}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title="Cancel dictation (Esc)"
          aria-label="Cancel dictation"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCancel}
          className="grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3.5" />
        </button>
        <button
          type="button"
          title="Finish dictation"
          aria-label="Finish dictation"
          disabled={phase !== "listening"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onDone}
          className="grid size-6 place-items-center rounded-md text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Check className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/** A rolling view of the last second of input loudness. */
export function LevelBars({
  levels,
  live,
}: {
  levels: LevelStore;
  live: boolean;
}) {
  const [history, setHistory] = useState<number[]>(() =>
    Array.from({ length: BARS }, () => 0),
  );
  useEffect(() => {
    if (!live) return;
    return levels.subscribe(() => {
      const level = levels.get();
      setHistory((previous) => [...previous.slice(1), level]);
    });
  }, [levels, live]);
  return (
    <span
      aria-hidden
      data-level-bars
      className="flex h-4 shrink-0 items-center gap-[2px]"
    >
      {history.map((level, index) => (
        <span
          key={index}
          className="w-[2px] rounded-full bg-current transition-[height] duration-75"
          style={{ height: `${Math.max(12, Math.round(level * 100))}%` }}
        />
      ))}
    </span>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="shrink-0 tabular-nums text-content/45">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

export function DictationErrorNotice({
  error,
  onDismiss,
}: {
  error: DictationError;
  onDismiss: () => void;
}) {
  const pane = error.pane;
  return (
    <p
      role="alert"
      className="flex items-center gap-2 px-3 pt-2 text-xs text-red-400"
    >
      <span className="min-w-0 flex-1">{error.message}</span>
      {pane ? (
        <button
          type="button"
          onClick={() => openVoicePrivacySettings(pane)}
          className="shrink-0 rounded px-1 text-content/70 underline-offset-2 hover:text-content hover:underline"
        >
          Open System Settings
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="grid size-4 shrink-0 place-items-center rounded text-content/40 hover:text-content"
      >
        <X className="size-3" />
      </button>
    </p>
  );
}
