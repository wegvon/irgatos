import { useState } from "react";
import { orchestrator } from "../model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
  WorkerGuidance,
} from "../model/orchestrationState";
import {
  dependentTasks,
  waitDetail,
  type WaitReason,
} from "../model/orchestrationWaiting";

const solid =
  "rounded bg-content/15 px-1.5 py-0.5 text-[11px] text-content/75 hover:bg-content/25 hover:text-content disabled:opacity-35";
const quiet =
  "rounded px-1.5 py-0.5 text-[11px] text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-35";

/** Why a queued worker has not started, with a way to the task holding it. */
export function WorkerWaitLine({
  reason,
  onReveal,
}: {
  reason: WaitReason;
  /** Shows the blocking task; absent where there is nowhere to go. */
  onReveal?: (sessionId: string) => void;
}) {
  const blocker = "blocker" in reason ? reason.blocker : undefined;
  return (
    <p
      data-worker-wait={reason.kind}
      className={`text-[11px] leading-relaxed ${
        reason.stuck ? "text-amber-400" : "text-content/55"
      }`}
    >
      {waitDetail(reason)}
      {blocker && onReveal ? (
        <>
          {" "}
          <button
            type="button"
            className="underline decoration-content/30 underline-offset-2 hover:text-content hover:decoration-content/60"
            onClick={() => onReveal(blocker.sessionId)}
          >
            Show {blocker.title}
          </button>
        </>
      ) : null}
    </p>
  );
}

/** Whether a worker can still be guided at all. */
export function canGuide(run: OrchestrationRun, task: OrchestrationTask) {
  return (
    (run.status === "active" || run.status === "paused") &&
    task.status !== "cancelled" &&
    task.status !== "cancelling"
  );
}

export function guidanceStatusLabel(entry: WorkerGuidance): string {
  if (entry.status === "failed")
    return `Not delivered${entry.error ? `: ${entry.error}` : ""}`;
  if (entry.status === "delivered")
    return entry.via === "lead"
      ? "Passed to the lead (the agent had stopped)"
      : entry.via === "prompt"
        ? "Delivered when the agent started"
        : "Delivered to the agent";
  return entry.via === "prompt"
    ? "Pending: added when the agent starts"
    : entry.via === "lead"
      ? "Pending: waiting for the lead"
      : "Sending…";
}

/** "Send guidance" for one worker, routed through the run's lead. */
export function WorkerGuidanceButton({
  open,
  onToggle,
  disabled,
}: {
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={solid}
      aria-expanded={open}
      disabled={disabled}
      title="Send this agent a note; the lead is told too"
      onClick={onToggle}
    >
      Send guidance
    </button>
  );
}

export function WorkerGuidanceForm({
  leadId,
  task,
  onClose,
}: {
  leadId: string;
  task: OrchestrationTask;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await orchestrator.guide(leadId, task.id, text);
      setText("");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };
  return (
    <div data-worker-guidance-form={task.id} className="space-y-1">
      <textarea
        // The row a user opened this from is the target; nothing to pick.
        autoFocus
        rows={2}
        value={text}
        aria-label={`Guidance for ${task.title}`}
        placeholder={`Guidance for ${task.title}`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        className="block w-full resize-y rounded-md border border-content/15 bg-transparent px-2 py-1 text-[12px] leading-snug text-content outline-none select-text placeholder:text-content/35 focus:border-content/30"
      />
      {error ? (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-1">
        <span className="mr-auto text-[10.5px] text-content/35">
          Goes through the lead · ⌘↩
        </span>
        <button type="button" className={quiet} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={solid}
          disabled={!text.trim() || sending}
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

/** The latest notes for this worker and where each one ended up. */
export function WorkerGuidanceLog({ task }: { task: OrchestrationTask }) {
  const notes = (task.guidance ?? []).slice(-3);
  if (!notes.length) return null;
  return (
    <ul aria-label="Guidance sent" className="space-y-0.5">
      {notes.map((entry) => (
        <li
          key={entry.id}
          data-guidance-status={entry.status}
          className="text-[11px] leading-snug"
        >
          <span className="line-clamp-2 text-content/65">“{entry.text}”</span>
          <span
            className={
              entry.status === "failed"
                ? "text-red-400"
                : entry.status === "delivered"
                  ? "text-emerald-400"
                  : "text-content/45"
            }
          >
            {guidanceStatusLabel(entry)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Cancel with a second step that names what else stops: queued tasks that
 * depend on this one can never start on their own afterwards.
 */
export function CancelTaskControl({
  run,
  task,
  disabled,
  onCancel,
}: {
  run: OrchestrationRun;
  task: OrchestrationTask;
  disabled?: boolean;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <button
        type="button"
        className={solid}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        Cancel task
      </button>
    );
  const affected = dependentTasks(run, task.id);
  return (
    <div
      role="group"
      aria-label={`Cancel ${task.title}?`}
      data-cancel-impact={affected.length}
      className="basis-full space-y-1 rounded-md border border-amber-400/30 px-2 py-1.5"
    >
      <p className="text-[11px] leading-relaxed text-content/70">
        {affected.length ? (
          <>
            {affected.length === 1 ? "1 waiting task depends" : `${affected.length} waiting tasks depend`}{" "}
            on this and will not start until the lead re-plans:{" "}
            <span className="text-amber-400">
              {affected.map((entry) => entry.title).join(", ")}
            </span>
          </>
        ) : (
          "No other task depends on this one."
        )}
      </p>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          className={quiet}
          onClick={() => setConfirming(false)}
        >
          Keep
        </button>
        <button
          type="button"
          className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-400 hover:bg-red-500/25 disabled:opacity-35"
          disabled={disabled}
          onClick={() => {
            setConfirming(false);
            onCancel();
          }}
        >
          Cancel task
        </button>
      </div>
    </div>
  );
}
