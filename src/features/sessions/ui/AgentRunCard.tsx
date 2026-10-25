import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  File,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Terminal,
  Wrench,
  X,
  type IconComponent,
} from "../../../shared/ui/icons";
import type { ApprovalDecision } from "../../../integrations/harness/core/types";
import {
  agentRunFromSession,
  formatClock,
  formatStepDuration,
  stepElapsed,
  updateStepTimings,
  type AgentRun,
  type AgentRunIntent,
  type AgentRunStep,
  type AgentRunStepIcon,
  type StepTiming,
} from "../model/agentRunCard";
import type { Session } from "../model/session";

const ROW_HEIGHT = 30;
const MAX_ROWS = 5;
const TICK_MS = 250;
/** How long a finished run stays before the card steps aside. */
const SETTLED_MS = 20_000;

// Kept outside the component so a pane switch or split does not forget them.
const timingsBySession = new Map<string, Map<string, StepTiming>>();
const intentBySession = new Map<
  string,
  { turnId: string; intent: AgentRunIntent }
>();
const liveTurns = new Set<string>();
const settledAt = new Map<string, number>();
const dismissedTurns = new Set<string>();

type Props = {
  session: Pick<
    Session,
    "id" | "blocks" | "busy" | "cwd" | "harness" | "model"
  >;
  onStop: () => void;
  onApproval: (requestId: number, decision: ApprovalDecision) => void;
  /** Picks a paused or failed run back up. */
  onContinue: () => void;
  onOpenRun: (turnId: string) => void;
};

/**
 * Live status for the turn in flight, above a coding chat's composer: what the
 * agent is doing now, its last five steps, and Pause/Stop or Approve/Deny.
 * Only runs that were live while Irgatos was open get a card.
 */
export function AgentRunCard({
  session,
  onStop,
  onApproval,
  onContinue,
  onOpenRun,
}: Props) {
  const remembered = intentBySession.get(session.id);
  const run = useMemo(() => {
    const latest = agentRunFromSession(session);
    const intent =
      latest && remembered?.turnId === latest.turnId
        ? remembered.intent
        : undefined;
    return intent ? agentRunFromSession(session, intent) : latest;
  }, [session, remembered]);
  const [now, setNow] = useState(() => Date.now());
  const [, rerender] = useState(0);

  const live = run?.state === "running" || run?.state === "waiting_approval";
  if (run && live) liveTurns.add(run.turnId);
  const seen = !!run && liveTurns.has(run.turnId);

  let timings = timingsBySession.get(session.id);
  if (!timings) {
    timings = new Map();
    timingsBySession.set(session.id, timings);
  }
  if (run && seen) updateStepTimings(timings, run, Date.now());

  // The clock and the running row tick; a settled run only waits to step aside.
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [live]);

  const transient = run?.state === "done" || run?.state === "stopped";
  useEffect(() => {
    if (!run || !seen || !transient) return;
    const key = `${session.id}:${run.turnId}:${run.state}`;
    const since = settledAt.get(key) ?? Date.now();
    settledAt.set(key, since);
    const timer = window.setTimeout(
      () => rerender((n) => n + 1),
      Math.max(0, since + SETTLED_MS - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [run, seen, transient, session.id]);

  if (!run || !seen || dismissedTurns.has(run.turnId)) return null;
  if (transient) {
    const since = settledAt.get(`${session.id}:${run.turnId}:${run.state}`);
    if (since != null && Date.now() - since > SETTLED_MS) return null;
  }

  const remember = (intent: AgentRunIntent) => {
    intentBySession.set(session.id, { turnId: run.turnId, intent });
    rerender((n) => n + 1);
  };
  const dismiss = () => {
    dismissedTurns.add(run.turnId);
    rerender((n) => n + 1);
  };

  return (
    <AgentRunCardView
      run={run}
      now={live ? now : Date.now()}
      timings={timings}
      onPause={() => {
        remember("paused");
        onStop();
      }}
      onStop={() => {
        remember("stopped");
        if (run.state !== "paused") onStop();
      }}
      onApprove={() => {
        if (run.approvalRequestId != null)
          onApproval(run.approvalRequestId, "allow");
      }}
      onDeny={() => {
        if (run.approvalRequestId != null)
          onApproval(run.approvalRequestId, "deny");
      }}
      onResume={() => {
        intentBySession.delete(session.id);
        onContinue();
      }}
      onDismiss={dismiss}
      onOpenRun={() => onOpenRun(run.turnId)}
    />
  );
}

type ViewProps = {
  run: AgentRun;
  now: number;
  timings: ReadonlyMap<string, StepTiming>;
  onPause: () => void;
  onStop: () => void;
  onApprove: () => void;
  onDeny: () => void;
  onResume: () => void;
  onDismiss: () => void;
  onOpenRun: () => void;
};

/** The card itself, free of session wiring so previews can drive it. */
export function AgentRunCardView({
  run,
  now,
  timings,
  onPause,
  onStop,
  onApprove,
  onDeny,
  onResume,
  onDismiss,
  onOpenRun,
}: ViewProps) {
  const live = run.state === "running" || run.state === "waiting_approval";
  const clock =
    live && run.startedAt != null ? formatClock(now - run.startedAt) : null;
  return (
    <section
      data-agent-run-card
      data-state={run.state}
      aria-live="polite"
      className="agent-run-card mx-3 mb-2 rounded-[18px] border border-content/10 bg-content/[0.035] px-4 pt-3.5 pb-3 text-content shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset]"
    >
      <header className="flex h-7 items-center gap-2.5">
        <RunStateIcon state={run.state} />
        <h3
          className={`min-w-0 flex-1 truncate text-[14px] font-medium ${
            run.state === "waiting_approval"
              ? "text-content"
              : "text-content/90"
          }`}
          title={run.title}
        >
          {run.title}
        </h3>
        {clock ? (
          <span className="shrink-0 text-[13px] tabular-nums text-content/55">
            {clock}
          </span>
        ) : null}
        {run.state === "failed" || run.state === "paused" ? (
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={onDismiss}
            className="grid size-6 shrink-0 place-items-center rounded-full text-content/45 transition-colors hover:bg-content/8 hover:text-content/80"
          >
            <X size={13} />
          </button>
        ) : null}
      </header>
      <div className="mt-1.5 flex items-center text-[12.5px] text-content/50">
        <span className="truncate">{run.model}</span>
      </div>
      <RunProgress state={run.state} />
      <StepLog steps={run.steps} now={now} timings={timings} />
      <footer className="mt-2.5 flex items-center gap-2">
        {run.state === "running" ? (
          <>
            <PillButton onClick={onPause} icon={<Pause size={13} />}>
              Pause
            </PillButton>
            <PillButton onClick={onStop} icon={<Square size={12} />}>
              Stop
            </PillButton>
          </>
        ) : run.state === "waiting_approval" ? (
          <>
            <PillButton tone="primary" onClick={onApprove}>
              Approve
            </PillButton>
            <PillButton onClick={onDeny}>Deny</PillButton>
          </>
        ) : run.state === "paused" ? (
          <>
            <PillButton onClick={onResume} icon={<Play size={13} />}>
              Resume
            </PillButton>
            <PillButton onClick={onStop} icon={<Square size={12} />}>
              Stop
            </PillButton>
          </>
        ) : run.state === "failed" ? (
          <PillButton
            tone="danger"
            onClick={onResume}
            icon={<RotateCcw size={13} />}
          >
            Retry
          </PillButton>
        ) : null}
        <button
          type="button"
          onClick={onOpenRun}
          className="ml-auto flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] text-content/60 transition-colors hover:bg-content/6 hover:text-content/90"
        >
          Open run
          <span aria-hidden className="text-[14px] leading-none">
            {"\u2197"}
          </span>
        </button>
      </footer>
    </section>
  );
}

function PillButton({
  children,
  icon,
  tone = "outline",
  onClick,
}: {
  children: string;
  icon?: ReactNode;
  tone?: "outline" | "primary" | "danger";
  onClick: () => void;
}) {
  const style =
    tone === "primary"
      ? "border-transparent bg-accent text-on-accent hover:brightness-110"
      : tone === "danger"
        ? "border-red-400/40 text-red-400 hover:bg-red-400/10"
        : "border-content/14 text-content/80 hover:bg-content/6 hover:text-content";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${style}`}
    >
      {icon}
      {children}
    </button>
  );
}

const STAR_PATH =
  "M12 1.5c.7 5.1 4.3 8.8 9.5 9.5-5.2.7-8.8 4.4-9.5 9.5-.7-5.1-4.3-8.8-9.5-9.5 5.2-.7 8.8-4.4 9.5-9.5Z";

function RunStateIcon({ state }: { state: AgentRun["state"] }) {
  if (state === "done") {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-diff-add text-white">
        <Check size={13} strokeWidth={2.6} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-red-500 text-white">
        <X size={13} strokeWidth={2.6} />
      </span>
    );
  }
  if (state === "paused" || state === "stopped") {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-content/15 text-content/60">
        {state === "paused" ? <Pause size={12} /> : <Square size={10} />}
      </span>
    );
  }
  const waiting = state === "waiting_approval";
  return (
    <span
      className={`agent-run-star grid size-6 shrink-0 place-items-center ${
        waiting ? "agent-run-star--waiting" : "agent-run-star--running"
      }`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <defs>
          <linearGradient id="agent-run-star-fire" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff9a3c" />
            <stop offset="50%" stopColor="#f2545b" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <path
          d={STAR_PATH}
          fill={waiting ? "var(--color-accent)" : "url(#agent-run-star-fire)"}
        />
      </svg>
    </span>
  );
}

/** No step total exists, so the bar shows motion, not a fraction. */
function RunProgress({ state }: { state: AgentRun["state"] }) {
  return (
    <div
      className="agent-run-progress mt-2.5 h-[3px] overflow-hidden rounded-full bg-content/10"
      data-state={state}
    >
      <div className="agent-run-progress-fill h-full rounded-full" />
    </div>
  );
}

const STEP_ICONS: Record<AgentRunStepIcon, IconComponent> = {
  read: File,
  search: Search,
  edit: PenLine,
  run: Terminal,
  agent: Bot,
  tool: Wrench,
  approval: Sparkles,
  error: CircleAlert,
};

function StepLog({
  steps,
  now,
  timings,
}: {
  steps: AgentRunStep[];
  now: number;
  timings: ReadonlyMap<string, StepTiming>;
}) {
  const seen = useRef(new Set<string>());
  const fresh = new Set(
    steps.filter((step) => !seen.current.has(step.id)).map((step) => step.id),
  );
  useEffect(() => {
    for (const step of steps) seen.current.add(step.id);
  }, [steps]);
  if (!steps.length) return <div className="h-2" />;
  const visible = Math.min(MAX_ROWS, steps.length);
  const offset = (steps.length - visible) * ROW_HEIGHT;
  return (
    <div
      className="agent-run-log mt-2 overflow-hidden"
      style={{ height: visible * ROW_HEIGHT }}
    >
      <ol
        className="agent-run-log-list"
        style={{ transform: `translateY(-${offset}px)` }}
      >
        {steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            elapsed={stepElapsed(step, timings, now)}
            fresh={fresh.has(step.id) && seen.current.size > 0}
          />
        ))}
      </ol>
    </div>
  );
}

function StepRow({
  step,
  elapsed,
  fresh,
}: {
  step: AgentRunStep;
  elapsed?: number;
  fresh: boolean;
}) {
  const Icon = STEP_ICONS[step.icon];
  const settled = step.state === "done";
  const tone =
    step.state === "waiting"
      ? "text-accent"
      : step.state === "failed"
        ? "text-red-400"
        : step.state === "active"
          ? "text-content/60"
          : "text-content/85";
  const label =
    settled || step.state === "failed" ? step.pastLabel : step.presentLabel;
  return (
    <li
      className={`flex items-center gap-3 ${tone} ${fresh ? "agent-run-row-enter" : ""}`}
      style={{ height: ROW_HEIGHT }}
    >
      <Icon size={15} className="shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate text-[13.5px]" title={label}>
        {label}
      </span>
      {elapsed != null && step.state !== "waiting" ? (
        <span className="shrink-0 text-[12.5px] tabular-nums text-content/45">
          {formatStepDuration(elapsed)}
        </span>
      ) : null}
    </li>
  );
}
