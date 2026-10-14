import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  CircleAlert,
  CloudUpload,
  Loader,
  X,
} from "../../../shared/ui/icons";
import {
  gitCommitPushCheck,
  gitCommitPushCommit,
  gitCommitPushPush,
  gitCommitPushRebase,
  gitCommitPushStage,
  type GitCommitPushCommit,
} from "../../../platform/tauri/fs";
import {
  describeCommitPushFailure,
  phaseLabel,
  runCommitPush,
  successText,
  type CommitPushApi,
  type CommitPushFailure,
  type CommitPushPhase,
  type CommitPushRequest,
} from "../model/commitPush";

const api: CommitPushApi = {
  check: (cwd, setUpstream, allowSubmodules) =>
    gitCommitPushCheck(cwd, setUpstream, allowSubmodules),
  stage: (cwd) => gitCommitPushStage(cwd),
  commit: (cwd, message) => gitCommitPushCommit(cwd, message),
  push: (cwd, setUpstream) => gitCommitPushPush(cwd, setUpstream),
  rebase: (cwd) => gitCommitPushRebase(cwd),
};

export const COMMIT_PUSH_BUSY = "commitPush";

const STEPS: { phase: CommitPushPhase; label: string }[] = [
  { phase: "stage", label: "Stage" },
  { phase: "commit", label: "Commit" },
  { phase: "push", label: "Push" },
];

type Result =
  | { kind: "success"; text: string }
  | { kind: "failure"; failure: CommitPushFailure };

/**
 * One click to stage, commit and push. Staging follows the commit form: what is
 * staged is committed as is, and when nothing is, every change is staged.
 */
export function CommitPushButton({
  cwd,
  message,
  target,
  busy,
  setBusy,
  disabledReason,
  onCommitted,
  onPushed,
  onSettled,
}: {
  cwd: string;
  message: string;
  /** Where a push goes now, e.g. `origin/main`. */
  target: string | null;
  busy: string | null;
  setBusy: (value: string | null) => void;
  disabledReason?: string;
  onCommitted: (commit: GitCommitPushCommit) => void;
  onPushed: () => void;
  onSettled: () => void;
}) {
  const [phase, setPhase] = useState<CommitPushPhase | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (result?.kind !== "success") return;
    const timer = window.setTimeout(() => setResult(null), 6000);
    return () => window.clearTimeout(timer);
  }, [result]);

  const running = phase !== null;
  const disabled = running || !!disabledReason || (!!busy && busy !== COMMIT_PUSH_BUSY);

  const run = async (request: CommitPushRequest) => {
    if (runningRef.current || (busy && busy !== COMMIT_PUSH_BUSY)) return;
    runningRef.current = true;
    setResult(null);
    setBusy(COMMIT_PUSH_BUSY);
    try {
      const outcome = await runCommitPush(api, cwd, request, setPhase);
      if (!outcome) return;
      if (outcome.commit) onCommitted(outcome.commit);
      if (outcome.ok) onPushed();
      setResult(
        outcome.ok
          ? { kind: "success", text: successText(outcome) }
          : {
              kind: "failure",
              failure: describeCommitPushFailure(outcome, message),
            },
      );
    } finally {
      runningRef.current = false;
      setPhase(null);
      setBusy(null);
      onSettled();
    }
  };

  const title =
    disabledReason ??
    `Stage, commit and push in one click${target ? ` to ${target}` : ""}. ` +
      "Staged files are committed as they are; with nothing staged, every change is staged first.";
  // A rebase runs after the commit, so it shows with staging and commit done.
  const activeStep =
    phase === "pull" ? 2 : STEPS.findIndex((step) => step.phase === phase);

  return (
    <div className="mt-1.5 flex flex-col gap-1.5" data-commit-push>
      <button
        type="button"
        title={title}
        aria-busy={running}
        disabled={disabled}
        onClick={() => void run({ message })}
        className="flex h-7 w-full min-w-0 items-center justify-center gap-1.5 rounded-md bg-content/10 px-2 text-[12px] font-medium text-content hover:bg-content/15 disabled:opacity-40"
      >
        {running ? (
          <Loader className="size-3.5 shrink-0 animate-spin" strokeWidth={1.75} />
        ) : (
          <CloudUpload className="size-3.5 shrink-0" strokeWidth={1.75} />
        )}
        <span className="shrink-0">
          {running ? `${phaseLabel(phase)}…` : "Commit & Push"}
        </span>
        {!running && target ? (
          <span className="min-w-0 shrink truncate font-normal text-content/45">
            {target}
          </span>
        ) : null}
      </button>
      {running ? (
        <ol
          aria-label="Commit and push progress"
          className="flex items-center gap-1 px-0.5 text-[11px]"
        >
          {STEPS.map((step, index) => {
            const state =
              index < activeStep
                ? "done"
                : index === activeStep && phase !== "pull"
                  ? "active"
                  : "pending";
            return (
              <li
                key={step.phase}
                aria-current={state === "active" ? "step" : undefined}
                className={`flex min-w-0 flex-1 flex-col gap-1 ${
                  state === "pending" ? "text-content/35" : "text-content/70"
                }`}
              >
                <span
                  className={`h-0.5 rounded-full ${
                    state === "done"
                      ? "bg-content/60"
                      : state === "active"
                        ? "animate-pulse bg-content"
                        : "bg-content/15"
                  }`}
                />
                <span className="truncate">{step.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {result?.kind === "success" ? (
        <p
          role="status"
          className="flex min-w-0 items-start gap-1.5 px-0.5 text-[11px] leading-4 text-content/60"
        >
          <CheckCircle className="size-3.5 shrink-0 text-emerald-400" strokeWidth={1.75} />
          <span className="min-w-0 break-words">{result.text}</span>
        </p>
      ) : null}
      {result?.kind === "failure" ? (
        <CommitPushFailureCard
          failure={result.failure}
          disabled={disabled}
          onAction={(request) => void run(request)}
          onDismiss={() => setResult(null)}
        />
      ) : null}
    </div>
  );
}

function CommitPushFailureCard({
  failure,
  disabled,
  onAction,
  onDismiss,
}: {
  failure: CommitPushFailure;
  disabled: boolean;
  onAction: (request: CommitPushRequest) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-[12px] text-content"
    >
      <div className="flex items-start gap-1.5">
        <CircleAlert
          className="mt-px size-3.5 shrink-0 text-amber-400"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{failure.title}</p>
          {failure.body ? (
            <p className="mt-0.5 text-[11px] leading-4 text-content/65">
              {failure.body}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
          className="grid size-4 shrink-0 place-items-center rounded text-content/50 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      {failure.detail ? (
        <pre className="max-h-24 overflow-auto rounded bg-background-base/70 p-1.5 font-mono text-[10.5px] leading-4 whitespace-pre-wrap text-content/80 select-text">
          {failure.detail}
        </pre>
      ) : null}
      {failure.actions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {failure.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={disabled}
              onClick={() => onAction(action.request)}
              className="h-6 rounded-md bg-content px-2 text-[11px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
