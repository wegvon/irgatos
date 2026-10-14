import { RotateCcw, X } from "../../../shared/ui/icons";
import {
  INTERRUPTION_TITLE,
  type SessionInterruption,
} from "../model/sessionInterruption";

/**
 * The agent went away mid-turn: say so plainly and offer the one click that
 * picks the conversation back up.
 */
export function InterruptedSessionBanner({
  interruption,
  onResume,
  onDismiss,
  variant = "composer",
}: {
  interruption: SessionInterruption;
  onResume: () => void;
  onDismiss?: () => void;
  variant?: "composer" | "irgat";
}) {
  const title = INTERRUPTION_TITLE[interruption.kind];
  const detail =
    interruption.kind === "restart"
      ? "The turn stopped when the app quit."
      : interruption.message;
  return (
    <div
      className={
        variant === "irgat"
          ? "mx-1.5 mb-2 rounded-lg border border-rose-400/25 bg-rose-400/6 px-3 py-2 text-[12px] text-content/60"
          : "px-2 text-content/55"
      }
      data-session-interrupted={interruption.kind}
      role="status"
      aria-live="polite"
    >
      <div
        className={
          variant === "irgat"
            ? "flex flex-wrap items-center gap-x-2 gap-y-1"
            : "relative z-0 flex h-8 items-center gap-2 rounded-t-[10px] border border-b-0 border-rose-400/25 bg-rose-400/10 px-2 text-[12px]"
        }
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-rose-400"
        />
        <span className="shrink-0 text-content/85">{title}</span>
        <span className="min-w-0 flex-1 truncate" title={detail}>
          {detail}
        </span>
        <button
          type="button"
          onClick={onResume}
          title="Continue this conversation where it stopped"
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-content/8 px-2 text-content/85 hover:bg-content/14 hover:text-content"
        >
          <RotateCcw className="size-3.5" />
          Resume session
        </button>
        {onDismiss ? (
          <button
            type="button"
            title="Dismiss"
            aria-label="Dismiss interruption notice"
            onClick={onDismiss}
            className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
