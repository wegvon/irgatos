import { Gauge, Zap } from "../../../shared/ui/icons";
import type { HarnessId } from "../../sessions/model/session";
import {
  useCountdownNow,
  useUsageLimitHold,
  useUsageLimitSnapshot,
} from "../hooks/useUsageLimitHold";
import { heldUntilLabel, queueHold } from "../model/usageLimitRegistry";
import { usageLimitRegistry } from "../model/usageLimitStore";

/**
 * "Paused until quota reset (3:16 AM)" with a Run anyway override, for a
 * scheduled run that is waiting on its provider instead of failing.
 */
export function HeldWorkNotice({
  harness,
  accountId,
  until,
  onRunAnyway,
  compact = false,
}: {
  harness: HarnessId;
  accountId?: string;
  /** Shown when the registry has no hold, e.g. one saved with a habit. */
  until?: number;
  onRunAnyway: () => void;
  compact?: boolean;
}) {
  useUsageLimitSnapshot();
  const resetAt = usageLimitRegistry.get(harness, accountId)?.resetAt ?? until;
  const now = useCountdownNow(resetAt);
  if (resetAt == null || resetAt <= now) return null;
  const label = heldUntilLabel(resetAt, now);
  return (
    <span
      data-held-work
      className={`inline-flex min-w-0 items-center gap-1.5 text-amber-500 dark:text-amber-300 ${
        compact ? "text-[11px]" : "text-[12px]"
      }`}
    >
      <Gauge className="size-3 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRunAnyway();
        }}
        title="Run now, even though the provider may still refuse"
        className="inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-content/60 hover:bg-content/8 hover:text-content"
      >
        <Zap className="size-3" strokeWidth={1.75} />
        Run anyway
      </button>
    </span>
  );
}

/** The queue's header row while its prompts wait on a quota hold. */
export function QueuedHoldNotice({
  harness,
  providerAccountId,
  cwd,
  override,
  onRunAnyway,
}: {
  harness: HarnessId;
  providerAccountId?: string;
  cwd?: string;
  override?: number;
  onRunAnyway: () => void;
}) {
  const hold = queueHold(
    useUsageLimitHold(harness, providerAccountId, cwd),
    override,
  );
  if (!hold) return null;
  return (
    <div
      className="flex h-7 items-center border-b border-stroke"
      data-queue-quota-hold
    >
      <HeldWorkNotice
        harness={hold.harness}
        accountId={hold.accountId}
        onRunAnyway={onRunAnyway}
        compact
      />
    </div>
  );
}
