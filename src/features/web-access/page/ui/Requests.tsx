import { useState } from "react";
import type { FleetRequest } from "../../../fleet/model/fleet";
import type { WebBlock } from "../../model/protocol";
import type { UserQuestion } from "../../../sessions/model/userQuestion";
import { write } from "../client";
import { Spinner, primaryButton, secondaryButton, useAction } from "./parts";
import { Check, X } from "../../../../shared/ui/icons";

type Props = { sessionId: string; request: FleetRequest };

/** Allow or deny, or answer a question, right where the request shows. */
export function RequestBody({ sessionId, request }: Props) {
  return request.kind === "approval" ? (
    <Approval sessionId={sessionId} request={request} />
  ) : (
    <QuestionForm sessionId={sessionId} request={request} />
  );
}

function Approval({
  sessionId,
  request,
}: {
  sessionId: string;
  request: Extract<FleetRequest, { kind: "approval" }>;
}) {
  const { busy, run } = useAction();
  const decide = (decision: "allow" | "deny") =>
    run(
      decision,
      () =>
        write("approval", {
          sessionId,
          requestId: request.requestId,
          decision,
        }),
      decision === "allow" ? "Allowed" : "Denied",
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[15px] leading-snug">
        <span className="text-(--ink-2)">Wants to </span>
        <span className="font-semibold text-(--ink)">
          {lowerFirst(request.label)}
        </span>
      </div>
      {request.detail ? (
        <pre className="web-selectable max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[16px] bg-content/6 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-(--ink) shadow-[inset_0_0_0_1px_var(--hairline)]">
          {request.detail}
        </pre>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          className={secondaryButton}
          disabled={busy !== null}
          onClick={() => void decide("deny")}
        >
          {busy === "deny" ? <Spinner /> : <X className="size-4" />}
          Deny
        </button>
        <button
          className={primaryButton}
          disabled={busy !== null}
          onClick={() => void decide("allow")}
        >
          {busy === "allow" ? <Spinner /> : <Check className="size-4" />}
          Allow
        </button>
      </div>
    </div>
  );
}

/** A vault value set to "ask": allow it once, for the chat, or deny it. */
export function SecretApprovalBody({
  sessionId,
  block,
}: {
  sessionId: string;
  block: WebBlock;
}) {
  const { busy, run } = useAction();
  const approval = block.secretApproval!;
  const answer = (state: "once" | "chat" | "deny") =>
    run(
      state,
      () => write("secretApproval", { sessionId, blockId: block.id, answer: state }),
      state === "deny" ? "Denied" : "Allowed",
    );
  if (approval.state !== "pending")
    return (
      <div className="self-center px-6 text-center text-[13px] text-(--ink-3)">
        {approval.label}{" "}
        {approval.state === "deny"
          ? "not allowed"
          : approval.state === "chat"
            ? "allowed for this chat"
            : "allowed once"}
      </div>
    );
  return (
    <div className="attention flex flex-col gap-3 rounded-[24px] bg-(--raised) p-4">
      <div className="text-[15px] leading-snug">
        <span className="text-(--ink-2)">Wants to use </span>
        <span className="font-semibold text-(--ink)">{approval.label}</span>
        {approval.target ? (
          <span className="text-(--ink-2)"> for {approval.target}</span>
        ) : null}
      </div>
      <div className="text-[13px] text-(--ink-3)">
        From your vault. The agent never sees the value.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          className={secondaryButton}
          disabled={busy !== null}
          onClick={() => void answer("deny")}
        >
          {busy === "deny" ? <Spinner /> : <X className="size-4" />}
          Deny
        </button>
        <button
          className={primaryButton}
          disabled={busy !== null}
          onClick={() => void answer("once")}
        >
          {busy === "once" ? <Spinner /> : <Check className="size-4" />}
          Allow once
        </button>
        <button
          className={`${secondaryButton} col-span-2`}
          disabled={busy !== null}
          onClick={() => void answer("chat")}
        >
          {busy === "chat" ? <Spinner /> : null}
          Allow in this chat
        </button>
      </div>
    </div>
  );
}

function lowerFirst(label: string) {
  return /^[A-Z][a-z]/.test(label)
    ? label[0]!.toLowerCase() + label.slice(1)
    : label;
}

function QuestionForm({
  sessionId,
  request,
}: {
  sessionId: string;
  request: Extract<FleetRequest, { kind: "question" }>;
}) {
  const questions = request.prompt.questions;
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const complete = questions.every(
    (question) =>
      (answers[question.id]?.length ?? 0) > 0 || !!custom[question.id]?.trim(),
  );

  const toggle = (question: UserQuestion, option: string) =>
    setAnswers((current) => {
      const selected = current[question.id] ?? [];
      const next = question.multiSelect
        ? selected.includes(option)
          ? selected.filter((id) => id !== option)
          : [...selected, option]
        : selected[0] === option
          ? []
          : [option];
      return { ...current, [question.id]: next };
    });

  const send = (skip: boolean) =>
    run(
      skip ? "skip" : "send",
      () =>
        write("answer", {
          sessionId,
          requestId: request.requestId,
          ...(skip ? { skip: true } : { answers, custom }),
        }),
      skip ? "Skipped" : "Answer sent",
    );

  return (
    <div className="flex flex-col gap-4">
      {questions.map((question) => (
        <fieldset key={question.id} className="flex flex-col gap-2">
          <legend className="mb-2 text-[16px] font-semibold leading-snug text-(--ink)">
            {question.prompt}
          </legend>
          {question.options.map((option) => {
            const on = answers[question.id]?.includes(option.id) ?? false;
            return (
              <button
                key={option.id}
                type="button"
                role={question.multiSelect ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => toggle(question, option.id)}
                className={`web-press flex min-h-12 items-start gap-3 rounded-[18px] px-3.5 py-3 text-left ${
                  on
                    ? "bg-(--accent)/12 shadow-[inset_0_0_0_1.5px_var(--accent)]"
                    : "bg-content/6 shadow-[inset_0_0_0_1px_var(--hairline)]"
                }`}
              >
                <span
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center border-[1.5px] ${
                    question.multiSelect ? "rounded-md" : "rounded-full"
                  } ${on ? "border-(--accent) bg-(--accent) text-on-accent" : "border-(--ink-3)"}`}
                >
                  {on ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-(--ink)">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="mt-0.5 block text-[13px] leading-snug text-(--ink-2)">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {question.allowCustom ? (
            <input
              className="web-field h-12 rounded-full bg-content/6 px-4 shadow-[inset_0_0_0_1px_var(--hairline)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
              placeholder="Or write your own answer"
              value={custom[question.id] ?? ""}
              onChange={(event) =>
                setCustom((current) => ({
                  ...current,
                  [question.id]: event.target.value,
                }))
              }
            />
          ) : null}
        </fieldset>
      ))}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button
          className={secondaryButton}
          disabled={busy !== null}
          onClick={() => void send(true)}
        >
          {busy === "skip" ? <Spinner /> : null}
          Skip
        </button>
        <button
          className={primaryButton}
          disabled={busy !== null || !complete}
          onClick={() => void send(false)}
        >
          {busy === "send" ? <Spinner /> : null}
          Send answer
        </button>
      </div>
    </div>
  );
}
