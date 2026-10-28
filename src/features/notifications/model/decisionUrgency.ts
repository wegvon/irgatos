/**
 * Pure helpers for decision notices, shared by the Mac app and the phone
 * page (which must not pull in the app's stores).
 */
import type { UserQuestionPrompt } from "../../sessions/model/userQuestion";

/**
 * A request blocks its agent unless the harness set a deadline after which
 * the agent goes on without an answer (an optional question).
 */
export type DecisionUrgency =
  | { blocking: true }
  | { blocking: false; deadline: number };

export function decisionUrgency(
  kind: "approval" | "question",
  question?: Pick<UserQuestionPrompt, "autoResolveAt">,
): DecisionUrgency {
  if (kind === "question" && question?.autoResolveAt != null) {
    return { blocking: false, deadline: question.autoResolveAt };
  }
  return { blocking: true };
}

export const BLOCKING_LABEL = "Waiting for your answer";
export const OPTIONAL_LABEL = "Optional — continues without an answer";

export function urgencyLabel(urgency: DecisionUrgency): string {
  return urgency.blocking ? BLOCKING_LABEL : OPTIONAL_LABEL;
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "at 14:32 (in 4 min)", or "in 40s" in the last minute. */
export function deadlineText(deadline: number, now = Date.now()): string {
  const left = deadline - now;
  if (left <= 0) return "now";
  if (left < 60_000) return `in ${Math.ceil(left / 1000)}s`;
  const minutes = Math.round(left / 60_000);
  const span =
    minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim();
  return `at ${formatClock(deadline)} (in ${span})`;
}

/** One line: "Waiting for your answer" or "Optional — continues without an answer at 14:32 (in 4 min)". */
export function urgencyLine(urgency: DecisionUrgency, now = Date.now()): string {
  return urgency.blocking
    ? BLOCKING_LABEL
    : `${OPTIONAL_LABEL} ${deadlineText(urgency.deadline, now)}`;
}

/** Stable id of one request, shared by cards, banners, phone pushes and deferrals. */
export function decisionKey(
  sessionId: string,
  kind: "approval" | "question",
  requestId: number,
): string {
  return `decision:${sessionId}:${kind}:${requestId}`;
}
