import {
  HARNESSES,
  sessionNeedsInput,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import type { KanbanCardSession, StoredSessionStatus } from "./kanban";

/**
 * What a card shows for its session. `interrupted` is a stored running state
 * whose session is no longer loaded, so nothing can still be working on it;
 * `missing` is a link to a session that was never saved or has been deleted.
 */
export type CardSessionState = StoredSessionStatus | "interrupted" | "missing";

export type LiveCardSession = {
  status: StoredSessionStatus;
  title: string;
  harness: HarnessId;
};

export const CARD_SESSION_LABEL: Record<CardSessionState, string> = {
  running: "Running",
  "needs-input": "Needs input",
  finished: "Finished",
  failed: "Failed",
  stopped: "Stopped",
  draft: "Not started",
  interrupted: "Interrupted",
  missing: "Session gone",
};

export type LiveSessionLike = Pick<
  Session,
  "busy" | "blocks" | "pendingQuestion" | "worktreeRemoved"
>;

export function liveSessionStatus(session: LiveSessionLike): StoredSessionStatus {
  if (sessionNeedsInput(session as Session)) return "needs-input";
  if (session.busy) return "running";
  let lastTurn = -1;
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index]!;
    if (block.role === "user" && !block.draft) {
      lastTurn = index;
      break;
    }
  }
  if (lastTurn < 0) return "draft";
  let status: StoredSessionStatus = "finished";
  for (const block of session.blocks.slice(lastTurn + 1)) {
    if (block.role !== "system") continue;
    if (block.notice === "error") status = "failed";
    else if (block.notice === "interrupt") status = "stopped";
  }
  return status;
}

export function liveCardSession(session: Session): LiveCardSession {
  return {
    status: liveSessionStatus(session),
    title: session.title,
    harness: session.harness,
  };
}

export type CardSessionView = {
  state: CardSessionState;
  title: string;
  harness: HarnessId | null;
  live: boolean;
};

export function cardSessionView(
  link: KanbanCardSession,
  live: LiveCardSession | undefined,
): CardSessionView {
  if (live) {
    return { state: live.status, title: live.title, harness: live.harness, live: true };
  }
  const harness = HARNESSES.includes(link.harness as HarnessId)
    ? (link.harness as HarnessId)
    : null;
  const title = link.title?.trim() || "Untitled session";
  if (!link.saved) return { state: "missing", title, harness, live: false };
  const stored = link.status ?? "finished";
  const state: CardSessionState =
    stored === "running" || stored === "needs-input" ? "interrupted" : stored;
  return { state, title, harness, live: false };
}

/** Stable key for a set of live sessions, so consumers re-render only on real changes. */
export function liveSessionsKey(sessions: ReadonlyMap<string, LiveCardSession>): string {
  let key = "";
  for (const [id, session] of sessions) {
    key += `${id}\u0000${session.status}\u0000${session.harness}\u0000${session.title}\u0001`;
  }
  return key;
}
