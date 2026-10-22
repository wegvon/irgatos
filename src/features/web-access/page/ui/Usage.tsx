import { useState } from "react";
import type { WebUsage, WebUsageAccount } from "../../model/protocol";
import { read, usePoll } from "../client";
import { Group, Harness, Spinner, TONE, useNow, type Tone } from "./parts";
import { Gauge, RefreshCw } from "../../../../shared/ui/icons";

const STATUS_TONE: Record<WebUsageAccount["tone"], Tone> = {
  ready: "emerald",
  low: "amber",
  exhausted: "rose",
  checking: "muted",
  unknown: "muted",
};

/** Same bands as the Mac's meters: amber from 80%, red from 90%. */
function barTone(used: number): string {
  if (used >= 90) return "bg-(--tone-rose)";
  if (used >= 80) return "bg-(--tone-amber)";
  return "bg-(--ink-3)";
}

/** "3d 4h", "2h 10m", "25m": how long until a window resets. */
function resetIn(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
  if (hours) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${minutes}m`;
}

function percent(value: number): string {
  return `${Math.round(value)}%`;
}

function Meter({
  window,
  showRemaining,
  now,
}: {
  window: WebUsageAccount["windows"][number];
  showRemaining: boolean;
  now: number;
}) {
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const shown = showRemaining ? 100 - used : used;
  const reset =
    window.resetsAt == null
      ? null
      : window.resetsAt <= now
        ? "reset due"
        : `resets in ${resetIn(window.resetsAt - now)}`;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 truncate text-(--ink-3)">
          {window.title}
          {reset ? ` · ${reset}` : ""}
        </span>
        <span
          className={`shrink-0 font-semibold tabular-nums ${used >= 100 ? "text-(--tone-rose)" : "text-(--ink-2)"}`}
        >
          {showRemaining ? `${percent(shown)} left` : percent(used)}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-content/10"
        role="progressbar"
        aria-label={`${window.title} limit ${showRemaining ? "remaining" : "used"}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown)}
      >
        <span
          className={`block h-full rounded-full ${barTone(used)}`}
          style={{ width: `${shown}%` }}
        />
      </div>
    </div>
  );
}

function AccountRow({
  account,
  showRemaining,
  now,
}: {
  account: WebUsageAccount;
  showRemaining: boolean;
  now: number;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <Harness harness={account.provider} className="size-4" />
          <span className="min-w-0 truncate text-[15px] font-semibold text-(--ink)">
            {account.title}
            {account.account ? (
              <span className="font-normal text-(--ink-2)">
                {" "}
                · {account.account}
              </span>
            ) : null}
          </span>
        </span>
        <span
          className={`${TONE[STATUS_TONE[account.tone]]} flex min-w-0 items-center gap-1.5 pl-6 text-[13px] font-medium text-(--ink-2)`}
        >
          <span
            className={`tone-dot size-1.5 shrink-0 rounded-full ${account.tone === "checking" ? "animate-pulse" : ""}`}
          />
          <span className="truncate">
            {account.status}
            {account.detail ? ` · ${account.detail}` : ""}
          </span>
        </span>
      </div>
      {account.windows.length ? (
        <div className="grid gap-3 pl-6 min-[600px]:grid-cols-2 min-[600px]:gap-5">
          {account.windows.map((window) => (
            <Meter
              key={window.title}
              window={window}
              showRemaining={showRemaining}
              now={now}
            />
          ))}
        </div>
      ) : null}
      {account.extra != null ? (
        <div className="text-[12px] text-(--ink-3)">
          Extra usage balance ${account.extra.toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The provider usage limits the Mac's footer shows: each account's 5-hour,
 * weekly and monthly windows, and when they reset.
 */
export function UsageSection() {
  const usage = usePoll<WebUsage>(
    "usage",
    () => read<WebUsage>("usage"),
    (data) =>
      data?.accounts.some((account) => account.tone === "checking")
        ? 4_000
        : 60_000,
  );
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    read<WebUsage>("usage", { fresh: "1" })
      .then((next) => usage.mutate(() => next))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };
  const data = usage.data;
  const now = useNow(data?.at);

  return (
    <div className="flex flex-col gap-2 px-5 pb-6">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-(--ink)">
          <Gauge className="size-[18px] text-(--ink-2)" />
          Usage limits
        </h2>
        <button
          aria-label="Refresh usage limits"
          disabled={refreshing || !data}
          onClick={refresh}
          className="web-press flex size-9 items-center justify-center rounded-full text-(--ink-2) active:bg-content/8 disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
      <Group>
        {data?.accounts.length ? (
          data.accounts.map((account) => (
            <AccountRow
              key={`${account.provider}:${account.account ?? ""}`}
              account={account}
              showRemaining={data.showRemaining}
              now={now}
            />
          ))
        ) : (
          <div className="flex items-center gap-2 px-4 py-4 text-[15px] text-(--ink-2)">
            {data ? (
              "No provider reports usage limits."
            ) : usage.error ? (
              usage.error.message
            ) : (
              <>
                <Spinner /> Checking…
              </>
            )}
          </div>
        )}
      </Group>
    </div>
  );
}
