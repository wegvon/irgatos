import { useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  MessageMultiple,
  X,
} from "../../../shared/ui/icons";
import { prettyCwd } from "../../../shared/lib/paths";
import { HARNESS_TITLE, sessionDisplayTitle } from "../model/session";
import {
  compactOrdinals,
  describeSessionReferencePlan,
  formatActivityAge,
  formatTokenEstimate,
  SESSION_REFERENCE_TOTAL_CHARS,
  sessionMessages,
  type SessionReferencePlan,
} from "../model/sessionReferences";
import { HarnessIcon } from "./HarnessIcon";

type Props = {
  plans: SessionReferencePlan[];
  loading?: boolean;
  onRemove: (label: string) => void;
  onOpen: (sessionId: string, blockId?: string) => void;
};

function chipTone(plan: SessionReferencePlan): "error" | "warn" | "normal" {
  if (plan.status !== "ok") return "error";
  if (plan.condensed || plan.truncated || plan.missingOrdinals.length)
    return "warn";
  return "normal";
}

/** Where the reference is from, and what about it the agent will be told. */
function cautions(plan: SessionReferencePlan): string[] {
  if (plan.status !== "ok" || !plan.source) return [];
  return [
    plan.running ? "Still running — the latest reply may be incomplete" : "",
    plan.otherAgent ? `Written by ${HARNESS_TITLE[plan.source.harness]}` : "",
    plan.otherProject
      ? `Different project: ${prettyCwd(plan.source.worktreeCwd || plan.source.cwd)}`
      : plan.otherWorktree
        ? `Different working copy: ${prettyCwd(plan.source.worktreeCwd || plan.source.cwd)}`
        : "",
    plan.missingOrdinals.length
      ? `Message ${compactOrdinals(plan.missingOrdinals)} no longer exists`
      : "",
  ].filter(Boolean);
}

export function SessionReferenceTray({
  plans,
  loading,
  onRemove,
  onOpen,
}: Props) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  if (plans.length === 0) {
    return loading ? (
      <p className="px-3 pt-2 text-[11px] text-content/40">
        Reading referenced session…
      </p>
    ) : null;
  }
  const total = plans.reduce((sum, plan) => sum + plan.includedChars, 0);
  const expanded = plans.find((plan) => plan.token.label === openLabel);

  return (
    <div data-session-reference-tray className="px-3 pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {plans.map((plan) => {
          const tone = chipTone(plan);
          const title = plan.source
            ? sessionDisplayTitle(plan.source.title, plan.source.harness)
            : plan.status === "self"
              ? "This session"
              : "Unknown session";
          const scope = plan.token.selection
            ? `#${compactOrdinals(plan.token.selection)}`
            : "whole";
          const selected = openLabel === plan.token.label;
          return (
            <span
              key={plan.token.label}
              data-session-reference-chip={plan.token.label}
              className={`inline-flex max-w-full items-center rounded-md border text-[12px] leading-none ${
                tone === "error"
                  ? "border-red-400/40 bg-red-400/10"
                  : tone === "warn"
                    ? "border-amber-400/40 bg-amber-400/10"
                    : "border-content/10 bg-content/6"
              } ${selected ? "ring-1 ring-accent/50" : ""}`}
            >
              <button
                type="button"
                aria-expanded={selected}
                title={`${title} — ${describeSessionReferencePlan(plan)}`}
                onClick={() => setOpenLabel(selected ? null : plan.token.label)}
                className="flex min-w-0 items-center gap-1.5 py-1 pl-1.5 pr-1"
              >
                {plan.source ? (
                  <HarnessIcon
                    harness={plan.source.harness}
                    className="size-3.5 shrink-0"
                  />
                ) : (
                  <AlertCircle
                    className="size-3.5 shrink-0 text-red-400"
                    strokeWidth={1.75}
                  />
                )}
                <span className="min-w-0 max-w-[16rem] truncate text-content">
                  {title}
                </span>
                <span className="shrink-0 text-content/45">{scope}</span>
                {plan.status === "ok" ? (
                  <span className="shrink-0 font-mono text-[11px] text-content/50">
                    {formatTokenEstimate(plan.includedChars).replace(
                      " tokens",
                      "",
                    )}
                  </span>
                ) : null}
                {plan.running ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-accent"
                    aria-label="Running"
                  />
                ) : null}
              </button>
              <button
                type="button"
                title="Remove reference"
                aria-label={`Remove reference to ${title}`}
                onClick={() => {
                  if (selected) setOpenLabel(null);
                  onRemove(plan.token.label);
                }}
                className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            </span>
          );
        })}
        <span
          className="text-[11px] text-content/40"
          title={`Referenced sessions are capped at ${formatTokenEstimate(SESSION_REFERENCE_TOTAL_CHARS)} per message`}
        >
          {formatTokenEstimate(total)} added on send
        </span>
      </div>
      {expanded ? (
        <ReferenceDetails
          plan={expanded}
          onOpen={onOpen}
          onClose={() => setOpenLabel(null)}
        />
      ) : null}
    </div>
  );
}

function ReferenceDetails({
  plan,
  onOpen,
  onClose,
}: {
  plan: SessionReferencePlan;
  onOpen: (sessionId: string, blockId?: string) => void;
  onClose: () => void;
}) {
  const source = plan.source;
  const notes = cautions(plan);
  const firstBlock =
    source && plan.token.selection
      ? sessionMessages(source).find((m) =>
          plan.token.selection!.includes(m.ordinal),
        )?.blockId
      : undefined;
  return (
    <div
      data-session-reference-details
      className="mt-1.5 rounded-md border border-content/10 bg-content/4 px-2.5 py-2 text-[12px]"
    >
      {source ? (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <MessageMultiple
              className="size-3.5 shrink-0 text-content/45"
              strokeWidth={1.75}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-content">
              {sessionDisplayTitle(source.title, source.harness)}
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpen(source.id, firstBlock);
              }}
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-content/70 hover:bg-content/10 hover:text-content"
            >
              <ExternalLink className="size-3" strokeWidth={2} />
              Open session
            </button>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-content/45">
            {HARNESS_TITLE[source.harness]} ·{" "}
            {prettyCwd(source.worktreeCwd || source.cwd)}
            {source.branch ? ` · ${source.branch}` : ""}
            {source.updatedAt
              ? ` · ${formatActivityAge(source.updatedAt)}`
              : ""}
          </p>
        </>
      ) : null}
      <p className="mt-1 text-content/75">
        {describeSessionReferencePlan(plan)}
      </p>
      {notes.length ? (
        <ul className="mt-1 space-y-0.5 text-[11px] text-amber-500 dark:text-amber-300">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {plan.status === "ok" ? (
        <p className="mt-1 text-[11px] text-content/40">
          Sent as labelled context after your message. The agent is told it
          comes from another session
          {plan.condensed ? " and which parts were shortened or left out" : ""}.
        </p>
      ) : null}
    </div>
  );
}
