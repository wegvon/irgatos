import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  HABIT_CONDITION_TIMEOUT_MS,
  HABIT_EXPRESSION_NAMES,
  habitConditionError,
  habitTriggerCommand,
  newHabitTriggerToken,
  type HabitGuardSettings,
} from "../model/habitGuards";
import {
  habitWebhookInfo,
  subscribeHabitWebhookInfo,
  type HabitWebhookInfo,
} from "../model/habitWebhook";
import { HABIT_DELAY_MAX_SECONDS, type Habit } from "../model/irgatHabits";

type ConditionKind = "none" | "shell" | "expression";
type DelayUnit = "seconds" | "minutes" | "hours";

const UNIT_SECONDS: Record<DelayUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
};

const NO_WEBHOOK: HabitWebhookInfo = { port: null, error: null };

export type HabitGuardsDraft = {
  requestApproval: boolean;
  kind: ConditionKind;
  command: string;
  expression: string;
  delay: string;
  unit: DelayUnit;
};

/** The form's starting values for a habit's saved guards. */
export function habitGuardsDraft(habit: Habit): HabitGuardsDraft {
  const seconds = habit.delaySeconds ?? 0;
  const unit: DelayUnit =
    seconds && seconds % 3600 === 0
      ? "hours"
      : seconds && seconds % 60 === 0
        ? "minutes"
        : "seconds";
  return {
    requestApproval: !!habit.requestApproval,
    kind: habit.ifCondition?.kind ?? "none",
    command: habit.ifCondition?.kind === "shell" ? habit.ifCondition.command : "",
    expression:
      habit.ifCondition?.kind === "expression"
        ? habit.ifCondition.expression
        : "",
    delay: seconds ? String(seconds / UNIT_SECONDS[unit]) : "",
    unit,
  };
}

/** The settings a draft saves, or why it cannot be saved. */
export function habitGuardsFromDraft(
  draft: HabitGuardsDraft,
): { settings: HabitGuardSettings } | { error: string } {
  const amount = draft.delay.trim() ? Number(draft.delay) : 0;
  if (!Number.isFinite(amount) || amount < 0)
    return { error: "The delay must be a positive number." };
  const delaySeconds = Math.round(amount * UNIT_SECONDS[draft.unit]);
  if (delaySeconds > HABIT_DELAY_MAX_SECONDS)
    return { error: "Keep the delay to a day or less." };
  const ifCondition =
    draft.kind === "shell"
      ? ({ kind: "shell", command: draft.command } as const)
      : draft.kind === "expression"
        ? ({ kind: "expression", expression: draft.expression } as const)
        : null;
  const error = ifCondition ? habitConditionError(ifCondition) : undefined;
  if (error) return { error };
  return {
    settings: { requestApproval: draft.requestApproval, ifCondition, delaySeconds },
  };
}

function sameDraft(a: HabitGuardsDraft, b: HabitGuardsDraft): boolean {
  return (
    a.requestApproval === b.requestApproval &&
    a.kind === b.kind &&
    (a.kind !== "shell" || a.command.trim() === b.command.trim()) &&
    (a.kind !== "expression" || a.expression.trim() === b.expression.trim()) &&
    (Number(a.delay || 0) * UNIT_SECONDS[a.unit] ===
      Number(b.delay || 0) * UNIT_SECONDS[b.unit])
  );
}

/**
 * When a habit may run: an optional wait after it comes due, a condition
 * that skips the run when false, and the user's approval.
 */
export function HabitGuardsSection({
  habit,
  onSave,
}: {
  habit: Habit;
  onSave: (settings: HabitGuardSettings) => Promise<void>;
}) {
  const saved = habitGuardsDraft(habit);
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const savedKey = JSON.stringify(saved);
  // A save from elsewhere (another window, the CLI) resets an untouched form.
  useEffect(() => {
    setDraft(JSON.parse(savedKey) as HabitGuardsDraft);
    setError(undefined);
  }, [savedKey]);
  const dirty = !sameDraft(draft, saved);
  const edit = (patch: Partial<HabitGuardsDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(undefined);
  };
  const save = async () => {
    const result = habitGuardsFromDraft(draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    try {
      await onSave(result.settings);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-habit-guards className="flex flex-col gap-3 px-2 text-[12px]">
      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-content/85" id={`habit-approval-${habit.id}`}>
            Ask before each run
          </span>
          <span className="text-[11px] text-content/45">
            Waits in Fleet and here for Approve or Skip, up to 12 hours.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.requestApproval}
          aria-labelledby={`habit-approval-${habit.id}`}
          onClick={() => edit({ requestApproval: !draft.requestApproval })}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            draft.requestApproval ? "bg-accent" : "bg-content/20"
          }`}
        >
          <span
            className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform ${
              draft.requestApproval ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-content/85">Only run if</span>
        <Segmented
          label="Condition"
          value={draft.kind}
          options={[
            { value: "none", label: "Always" },
            { value: "shell", label: "Command passes" },
            { value: "expression", label: "Expression is true" },
          ]}
          onChange={(kind) => edit({ kind })}
        />
        {draft.kind === "shell" ? (
          <>
            <input
              aria-label="Condition command"
              value={draft.command}
              onChange={(event) => edit({ command: event.target.value })}
              placeholder="test -f deploy/READY"
              spellCheck={false}
              autoComplete="off"
              className="h-7 rounded-md border border-content/10 bg-transparent px-2 font-mono text-[11px] text-content outline-none placeholder:text-content/30 focus:border-content/25"
            />
            <Hint>
              Runs in the Irgat's folder. Exit 0 runs the habit; any other exit
              skips it. Stopped after {HABIT_CONDITION_TIMEOUT_MS / 1000} seconds.
            </Hint>
          </>
        ) : draft.kind === "expression" ? (
          <>
            <input
              aria-label="Condition expression"
              value={draft.expression}
              onChange={(event) => edit({ expression: event.target.value })}
              placeholder='now.weekday != 0 && trigger.json.branch == "main"'
              spellCheck={false}
              autoComplete="off"
              className="h-7 rounded-md border border-content/10 bg-transparent px-2 font-mono text-[11px] text-content outline-none placeholder:text-content/30 focus:border-content/25"
            />
            <Hint>
              Compare {HABIT_EXPRESSION_NAMES.join(", ")} with == != &lt; &gt;
              contains startsWith endsWith, joined by && || !. For example
              now.hour &gt;= 9, trigger.payload contains "error", last.hoursAgo
              &gt; 24.
            </Hint>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-content/85">Wait before running</span>
        <div className="flex items-center gap-2">
          <input
            aria-label="Delay"
            inputMode="decimal"
            value={draft.delay}
            onChange={(event) => edit({ delay: event.target.value })}
            placeholder="0"
            className="h-7 w-20 rounded-md border border-content/10 bg-transparent px-2 tabular-nums text-content outline-none placeholder:text-content/30 focus:border-content/25"
          />
          <Segmented
            label="Delay unit"
            value={draft.unit}
            options={[
              { value: "seconds", label: "sec" },
              { value: "minutes", label: "min" },
              { value: "hours", label: "hours" },
            ]}
            onChange={(unit) => edit({ unit })}
          />
        </div>
        <Hint>Counted from when it comes due or is triggered, up to a day.</Hint>
      </div>

      {error ? (
        <p role="alert" className="text-[11px] text-red-500/90">
          {error}
        </p>
      ) : null}
      {dirty ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-md bg-content px-2.5 py-1 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save guards"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setDraft(saved);
              setError(undefined);
            }}
            className="rounded-md bg-content/10 px-2.5 py-1 text-[12px] text-content/70 hover:bg-content/20"
          >
            Discard
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The habit's local trigger URL: create, copy, replace or remove it. */
export function HabitTriggerSection({
  habit,
  onTokenChange,
}: {
  habit: Habit;
  onTokenChange: (token: string | null) => Promise<void>;
}) {
  const info = useSyncExternalStore(
    subscribeHabitWebhookInfo,
    habitWebhookInfo,
    () => NO_WEBHOOK,
  );
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const change = (token: string | null) =>
    void onTokenChange(token).catch((failure: unknown) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  const token = habit.triggerToken;
  if (!token)
    return (
      <div className="flex items-center justify-between gap-3 px-2 text-[12px]">
        <span className="text-content/50">
          Let scripts, CI or other apps on this computer start this habit.
        </span>
        <button
          type="button"
          onClick={() => change(newHabitTriggerToken())}
          className="shrink-0 rounded-md bg-content/10 px-2.5 py-1 text-content/80 hover:bg-content/15"
        >
          Create trigger
        </button>
      </div>
    );
  const command = info.port ? habitTriggerCommand(info.port, token) : null;
  return (
    <div data-habit-trigger className="flex flex-col gap-2 px-2 text-[12px]">
      {command ? (
        <code className="block whitespace-pre-wrap break-all rounded-md bg-content/5 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-content/75 select-text">
          {command}
        </code>
      ) : (
        <p className="text-content/50">
          {info.error
            ? `The trigger listener could not start: ${info.error}`
            : "Starting the trigger listener…"}
        </p>
      )}
      <Hint>
        Only this computer can reach it. Whatever the request sends reaches the
        run as data and as trigger.payload.
        {habit.enabled ? "" : " Paused habits ignore their trigger."}
      </Hint>
      {error ? (
        <p role="alert" className="text-[11px] text-red-500/90">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!command}
          onClick={() => {
            if (command)
              void copyText(command)
                .then(() => setCopied(true))
                .catch(() => setError("Could not copy the command."));
          }}
          className="rounded-md bg-content/10 px-2.5 py-1 text-content/80 hover:bg-content/15 disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy command"}
        </button>
        <button
          type="button"
          onClick={() => change(newHabitTriggerToken())}
          className="rounded-md px-2.5 py-1 text-content/60 hover:bg-content/10"
        >
          New URL
        </button>
        <button
          type="button"
          onClick={() => change(null)}
          className="rounded-md px-2.5 py-1 text-content/60 hover:bg-content/10"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-4 text-content/45">{children}</p>;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit flex-wrap gap-0.5 rounded-md bg-content/5 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-2 py-0.5 text-[11px] ${
            value === option.value
              ? "bg-background-base text-content shadow-sm"
              : "text-content/55 hover:text-content/80"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
