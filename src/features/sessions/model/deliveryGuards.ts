import type { Session } from "./session";

/**
 * Why a session cannot take a new prompt right now: a tool call waiting for
 * approval, or a question (AskUserQuestion) waiting for an answer. A prompt
 * sent then would queue behind it unseen, or be read as the answer.
 */
export type DeliveryBlock = "approval" | "question";

export function deliveryBlock(
  session: Pick<Session, "pendingQuestion" | "blocks">,
): DeliveryBlock | null {
  if (session.pendingQuestion) return "question";
  return session.blocks.some(
    (block) => block.approval && block.approval.decided == null,
  )
    ? "approval"
    : null;
}

export const DELIVERY_BLOCK_LABEL: Record<DeliveryBlock, string> = {
  approval: "Waiting for approval",
  question: "Waiting for an answer",
};

/** An idle session should start a dispatched turn within this long. */
export const DELIVERY_ACK_TIMEOUT_MS = 20_000;
/** A running session that changes nothing for this long is stuck. */
export const DELIVERY_PROGRESS_TIMEOUT_MS = 90_000;
/** A tool call (a build, a test run) can be silent for much longer. */
export const DELIVERY_TOOL_TIMEOUT_MS = 10 * 60_000;

const TOOL_IN_FLIGHT = new Set(["pending", "in_progress", "running"]);

/** The session's latest block is a tool call that has not finished. */
export function toolInFlight(session: Pick<Session, "blocks">): boolean {
  const last = session.blocks[session.blocks.length - 1];
  return !!last?.tool && (!last.tool.status || TOOL_IN_FLIGHT.has(last.tool.status));
}

/** Changes whenever the session's transcript or run state does. */
export function progressSignature(
  session: Pick<Session, "blocks" | "busy">,
): string {
  const last = session.blocks[session.blocks.length - 1];
  return [
    session.blocks.length,
    last?.id ?? "",
    last?.text.length ?? 0,
    last?.streaming ? 1 : 0,
    last?.tool?.status ?? "",
    session.busy ? 1 : 0,
  ].join(":");
}

/** When each session last showed progress, as seen by `observe` calls. */
export type ProgressTracker = {
  observe: (
    sessions: readonly Pick<Session, "id" | "blocks" | "busy">[],
    now: number,
  ) => void;
  lastProgressAt: (sessionId: string) => number | undefined;
};

export function createProgressTracker(): ProgressTracker {
  const seen = new Map<string, { signature: string; at: number }>();
  return {
    observe: (sessions, now) => {
      const live = new Set<string>();
      for (const session of sessions) {
        live.add(session.id);
        const signature = progressSignature(session);
        const prev = seen.get(session.id);
        if (!prev || prev.signature !== signature) {
          seen.set(session.id, { signature, at: now });
        }
      }
      for (const id of seen.keys()) if (!live.has(id)) seen.delete(id);
    },
    lastProgressAt: (sessionId) => seen.get(sessionId)?.at,
  };
}

/**
 * A dispatched prompt is stalled when its target has shown no progress for
 * too long: an idle target never started the turn, or a running one froze.
 */
export function isDeliveryStalled({
  dispatchedAt,
  busy,
  toolRunning = false,
  lastProgressAt,
  now,
}: {
  dispatchedAt: number;
  busy: boolean;
  toolRunning?: boolean;
  lastProgressAt?: number;
  now: number;
}): boolean {
  const since = Math.max(dispatchedAt, lastProgressAt ?? 0);
  const limit = !busy
    ? DELIVERY_ACK_TIMEOUT_MS
    : toolRunning
      ? DELIVERY_TOOL_TIMEOUT_MS
      : DELIVERY_PROGRESS_TIMEOUT_MS;
  return now - since >= limit;
}
