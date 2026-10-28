import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Pause, Play, Square, Trash2, Zap } from "../../../shared/ui/icons";
import { IconButton } from "../../../app/shell/TitleBar";
import { PageHeader } from "./irgatPanelParts";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import {
  habitDelayLabel,
  type HabitGuardSettings,
} from "../model/habitGuards";
import { HabitGuardsSection, HabitTriggerSection } from "./HabitGuardsSection";
import {
  habitAwaitingApproval,
  habitQuotaHeld,
  habitRunningSince,
  habitScheduleLabel,
  habitStarting,
  habitStopRequested,
  stopHabitRun,
  subscribeHabitsRunning,
  type Habit,
  type HabitRun,
} from "../model/irgatHabits";
import type { HarnessId, Session } from "../../sessions/model/session";
import { IrgatActivityTrail } from "../../sessions/ui/AgentTranscript";
import { HeldWorkNotice } from "../../quotas/ui/HeldWorkNotice";

const dayTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function when(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString())
    return `Today ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at)}`;
  return now - at < 6 * 24 * 60 * 60 * 1000
    ? dayTime.format(at)
    : dateTime.format(at);
}

function duration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

const OUTCOME: Record<HabitRun["outcome"], { label: string; dot: string }> = {
  posted: { label: "Messaged you", dot: "bg-[var(--irgat-color)]" },
  quiet: { label: "Nothing to report", dot: "bg-content/25" },
  failed: { label: "Couldn't finish", dot: "bg-red-500/70" },
  skipped: { label: "Skipped", dot: "bg-amber-400/60" },
};

/** Guard edits from the habit's page; without them the sections are hidden. */
export type HabitPageGuardActions = {
  onApprove: () => void;
  onSkip: () => void;
  onGuardsChange: (settings: HabitGuardSettings) => Promise<void>;
  onTriggerTokenChange: (token: string | null) => Promise<void>;
};

/** One habit up close: what it does, when, and how its recent runs went. */
export function HabitPage({
  habit,
  color,
  cwd,
  onBack,
  onRunNow,
  onToggle,
  onRemove,
  guards,
  irgatPaused = false,
  runSession,
}: {
  habit: Habit;
  /** The Irgat's color, for runs that reached the user. */
  color: string;
  cwd: string;
  onBack: () => void;
  onRunNow: () => void;
  onToggle: () => void;
  onRemove: () => void;
  guards?: HabitPageGuardActions;
  /** Its Irgat is paused: a due run waits for the resume. */
  irgatPaused?: boolean;
  /** The hidden session of the run in progress, to watch its steps live. */
  runSession?: Session;
}) {
  const runningSince = useHabitRunning(habit.id);
  const now = Date.now();
  const starting =
    runningSince == null && habitStarting(habit, now, irgatPaused);
  const held = runningSince == null && habitQuotaHeld(habit, now);
  const awaiting = runningSince == null && habitAwaitingApproval(habit, now);
  const delayedUntil =
    runningSince == null &&
    habit.delayedUntil != null &&
    habit.delayedUntil > now
      ? habit.delayedUntil
      : undefined;
  const guardSummary = habitGuardSummary(habit);
  const runs = habit.runs ?? [];
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      style={{ "--irgat-color": color } as CSSProperties}
      data-habit-page={habit.id}
    >
      <PageHeader title={habit.name} onBack={onBack}>
        {runningSince != null ? <StopRunButton habitId={habit.id} /> : null}
        <IconButton
          label={
            runningSince != null
              ? "Already running"
              : held
                ? "Run anyway"
                : starting
                  ? "Starting"
                  : "Run now"
          }
          disabled={runningSince != null || starting}
          onClick={onRunNow}
        >
          <Zap className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        {habit.finishedAt == null ? (
          <IconButton
            label={habit.enabled ? "Pause" : "Resume"}
            onClick={onToggle}
          >
            {habit.enabled ? (
              <Pause className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Play className="size-3.5" strokeWidth={1.75} />
            )}
          </IconButton>
        ) : null}
        <IconButton label="Remove" onClick={onRemove}>
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        <dl className="flex flex-col gap-0.5 px-4 py-3 text-[12px]">
          <Row label="Runs">
            {habit.finishedAt != null
              ? `${habitScheduleLabel(habit.schedule)} · done ${when(habit.finishedAt, now)}`
              : habit.enabled
                ? habitScheduleLabel(habit.schedule)
                : "Paused"}
          </Row>
          {guardSummary ? <Row label="Guards">{guardSummary}</Row> : null}
          {awaiting ? (
            <Row label="Next">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-amber-500 dark:text-amber-300">
                  Waiting for your approval
                </span>
                {guards ? (
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={guards.onApprove}
                      className="rounded-md bg-content px-2 py-0.5 text-[11px] font-medium text-background-base hover:bg-content/80"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={guards.onSkip}
                      className="rounded-md bg-content/10 px-2 py-0.5 text-[11px] font-medium text-content/70 hover:bg-content/20"
                    >
                      Skip
                    </button>
                  </span>
                ) : null}
              </span>
            </Row>
          ) : delayedUntil != null ? (
            <Row label="Next">Delayed · starts {when(delayedUntil, now)}</Row>
          ) : held && habit.quotaHold ? (
            <Row label="Next">
              <HeldWorkNotice
                harness={habit.quotaHold.harness as HarnessId}
                accountId={habit.quotaHold.accountId}
                until={habit.quotaHold.until}
                onRunAnyway={onRunNow}
                compact
              />
            </Row>
          ) : starting ? (
            <Row label="Next">Starting…</Row>
          ) : habit.enabled ? (
            <Row label="Next">{when(habit.nextRunAt)}</Row>
          ) : null}
        </dl>

        <Section title="What it does">
          <p className="whitespace-pre-wrap px-2 text-[12px] leading-5 text-content/75">
            {habit.instructions}
          </p>
        </Section>

        {guards ? (
          <>
            <Section title="Guards">
              <HabitGuardsSection
                habit={habit}
                onSave={guards.onGuardsChange}
              />
            </Section>
            <Section title="Trigger">
              <HabitTriggerSection
                habit={habit}
                onTokenChange={guards.onTriggerTokenChange}
              />
            </Section>
          </>
        ) : null}

        {runningSince != null && runSession ? (
          <Section title="Working on it now">
            <div className="px-1" data-habit-live-trail>
              <IrgatActivityTrail
                blocks={runSession.blocks}
                live
                cwd={runSession.cwd}
              />
            </div>
          </Section>
        ) : null}

        <Section title="Recent runs">
          {runningSince != null ? <RunningRow since={runningSince} /> : null}
          {runs.length === 0 && runningSince == null ? (
            <p className="px-2 py-3 text-[12px] text-content/40">
              It hasn't run yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-px">
              {runs.map((run) => (
                <RunRow key={run.at} run={run} cwd={cwd} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/** "Asks first · If test -f READY · Waits 5 min", or empty without guards. */
export function habitGuardSummary(habit: Habit): string {
  const condition = habit.ifCondition;
  return [
    habit.requestApproval ? "Asks first" : "",
    habit.readOnly ? "Only looks" : "",
    condition
      ? `If ${condition.kind === "shell" ? condition.command : condition.expression}`
      : "",
    habit.delaySeconds ? `Waits ${habitDelayLabel(habit.delaySeconds)}` : "",
    habit.triggerToken ? "Has a trigger" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center">
      <dt className="flex h-7 items-center text-content/45">{label}</dt>
      <dd className="min-w-0 truncate text-content/85">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-stroke px-2 pb-4 pt-3">
      <h4 className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-content/40">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** When the habit's current run started, or undefined while it is idle. */
export function useHabitRunning(habitId: string): number | undefined {
  return useSyncExternalStore(subscribeHabitsRunning, () =>
    habitRunningSince(habitId),
  );
}

/** How long it has been running, ticking each second. */
export function RunningFor({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{duration(now - since)}</span>;
}

/** Whether the user asked the habit's run to stop and it has not yet. */
export function useHabitStopping(habitId: string): boolean {
  return useSyncExternalStore(subscribeHabitsRunning, () =>
    habitStopRequested(habitId),
  );
}

/**
 * Stops the run in progress. The run notices within a couple of seconds;
 * until then the button says it is stopping.
 */
export function StopRunButton({ habitId }: { habitId: string }) {
  const stopping = useHabitStopping(habitId);
  return (
    <IconButton
      label={stopping ? "Stopping…" : "Stop this run"}
      disabled={stopping}
      onClick={() => stopHabitRun(habitId)}
    >
      <Square className="size-3.5" strokeWidth={1.75} />
    </IconButton>
  );
}

function RunningRow({ since }: { since: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-2 text-[12px]">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--irgat-color)]" />
      <span className="flex-1 text-content/85">Running now</span>
      <span className="text-content/40">
        <RunningFor since={since} />
      </span>
    </div>
  );
}

function RunRow({ run, cwd }: { run: HabitRun; cwd: string }) {
  const [open, setOpen] = useState(false);
  const detail = run.report ?? run.error ?? run.reason;
  const outcome = OUTCOME[run.outcome];
  const expanded = open && !!detail;
  return (
    // An open run is one card: the row and its report share a background,
    // and the report starts where the outcome text does.
    <li className={`rounded-md ${expanded ? "bg-content/5" : ""}`}>
      <button
        type="button"
        disabled={!detail}
        aria-expanded={detail ? open : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[12px] ${
          expanded ? "" : "enabled:hover:bg-content/5"
        }`}
      >
        <span className={`size-2 shrink-0 rounded-full ${outcome.dot}`} />
        <span className="min-w-0 flex-1 truncate text-content/85">
          {outcome.label}
        </span>
        <span className="shrink-0 tabular-nums text-content/40">
          {when(run.at)}
          {run.durationMs ? ` · ${duration(run.durationMs)}` : ""}
        </span>
      </button>
      {expanded ? (
        // 8px row padding + 8px dot + 10px gap: the outcome text's left edge.
        <div className="pb-3 pl-[26px] pr-3 text-[12px] leading-5 text-content/75">
          {run.report ? (
            <AgentMarkdown
              className="agent-chat-bubble-md irgat-run-report"
              text={run.report}
              streaming={false}
              cwd={cwd}
            />
          ) : run.error ? (
            <p className="whitespace-pre-wrap text-red-500/80">{run.error}</p>
          ) : (
            <p className="whitespace-pre-wrap text-content/60">{run.reason}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}
