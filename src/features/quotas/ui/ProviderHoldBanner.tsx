import { Gauge, Play } from "../../../shared/ui/icons";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { useCountdownNow, useUsageLimitHold } from "../hooks/useUsageLimitHold";
import {
  formatHoldCountdown,
  formatHoldTime,
  queueHold,
  type UsageLimitHold,
} from "../model/usageLimitRegistry";
import { usageLimitRegistry } from "../model/usageLimitStore";

const BUTTON =
  "flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content";

/**
 * The selected provider is on quota hold, from this session or another one.
 * Queued and scheduled turns wait for the reset; typing still sends.
 */
export function ProviderHoldBanner({
  hold,
  queuedCount = 0,
  variant = "composer",
  onResumeNow,
}: {
  hold: UsageLimitHold;
  queuedCount?: number;
  variant?: "composer" | "irgat";
  onResumeNow?: () => void;
}) {
  const now = useCountdownNow(hold.resetAt);
  const remaining = hold.resetAt - now;
  const provider = HARNESS_TITLE[hold.harness] ?? hold.harness;
  const resumeNow = () => {
    usageLimitRegistry.release(hold.harness, hold.accountId);
    onResumeNow?.();
  };
  const detail =
    remaining > 0
      ? `${hold.exact ? "Resets" : "Retrying"} at ${formatHoldTime(hold.resetAt, now)} · in ${formatHoldCountdown(remaining)}`
      : "Resuming…";
  const waiting =
    queuedCount > 0
      ? `${queuedCount} queued ${queuedCount === 1 ? "message waits" : "messages wait"} for the reset`
      : "Scheduled runs wait for the reset";
  return (
    <div
      className={
        variant === "irgat"
          ? "mx-1.5 mb-2 rounded-lg border border-amber-400/20 bg-amber-400/6 px-3 py-2 text-[12px] text-content/60"
          : "px-2 text-content/55"
      }
      data-quota-hold={hold.key}
      role="status"
      aria-live="polite"
    >
      <div
        className={
          variant === "irgat"
            ? "flex flex-wrap items-center gap-x-2 gap-y-1"
            : "relative z-0 flex h-8 items-center gap-2 rounded-t-[10px] border border-b-0 border-amber-400/25 bg-amber-400/10 px-2 text-[12px]"
        }
      >
        <Gauge className="size-3.5 shrink-0 text-amber-400" />
        <span className="shrink-0 text-content/85">
          {provider} on quota hold
        </span>
        <span
          className="min-w-0 flex-1 truncate tabular-nums"
          title={`${detail}. ${waiting}.`}
        >
          {detail}
          <span className="max-sm:hidden"> · {waiting}</span>
        </span>
        <button
          type="button"
          onClick={resumeNow}
          title="Lift the hold and send queued and scheduled turns now"
          className={BUTTON}
        >
          <Play className="size-3.5" />
          Resume now
        </button>
      </div>
    </div>
  );
}

/** The hold banner for one session's provider and account, when it is held. */
export function SessionProviderHold({
  harness,
  providerAccountId,
  cwd,
  queuedCount,
  queueOverride,
  variant,
}: {
  harness: HarnessId;
  providerAccountId?: string;
  cwd?: string;
  queuedCount?: number;
  /** The queue was told to run anyway for this hold; it is not waiting. */
  queueOverride?: number;
  variant?: "composer" | "irgat";
}) {
  const hold = useUsageLimitHold(harness, providerAccountId, cwd);
  return hold ? (
    <ProviderHoldBanner
      hold={hold}
      queuedCount={queueHold(hold, queueOverride) ? queuedCount : 0}
      variant={variant}
    />
  ) : null;
}
