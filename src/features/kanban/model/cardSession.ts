import {
  HARNESSES,
  hasPendingApproval,
  sessionDisplayTitle,
  sessionDraftBlock,
  sessionNeedsInput,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import { looksLikeProject } from "../../projects/model/recents";
import {
  kanbanProject,
  type KanbanCardSession,
  type KanbanSessionSync,
  type StoredSessionStatus,
} from "./kanban";

/**
 * What a card shows for its session. `interrupted` is a stored running state
 * whose session is no longer loaded, so nothing can still be working on it;
 * `missing` is a link to a session that was never saved or has been deleted.
 */
export type CardSessionState = StoredSessionStatus | "interrupted" | "missing";

/**
 * Why a session is waiting on the user: a tool permission, or questions it
 * asked (AskUserQuestion and the like). Both are `needs-input`.
 */
export type SessionAttention = "approval" | "question";

export type LiveCardSession = {
  status: StoredSessionStatus;
  title: string;
  harness: HarnessId;
  /** Board the session belongs on, when it is project work. */
  project?: string;
  attention?: SessionAttention;
};

export const SESSION_ATTENTION_LABEL: Record<SessionAttention, string> = {
  approval: "Need approval",
  question: "Waiting for answers",
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

export function liveSessionAttention(
  session: Pick<Session, "blocks" | "pendingQuestion" | "worktreeRemoved">,
): SessionAttention | undefined {
  if (session.worktreeRemoved) return undefined;
  if (session.pendingQuestion != null) return "question";
  if (hasPendingApproval(session.blocks)) return "approval";
  return undefined;
}

export function liveCardSession(session: Session): LiveCardSession {
  const status = liveSessionStatus(session);
  const attention = status === "needs-input" ? liveSessionAttention(session) : undefined;
  return {
    status,
    title: sessionDisplayTitle(session.title, session.harness),
    harness: session.harness,
    ...(looksLikeProject(session.cwd) ? { project: kanbanProject(session.cwd) } : {}),
    ...(attention ? { attention } : {}),
  };
}

/** A loaded session as the board sees it. */
export type BoardSession = LiveCardSession & {
  /** Gets a card of its own; otherwise it only updates cards linked to it. */
  fileable: boolean;
};

/**
 * Loaded sessions that belong on a project board. Chats that aren't project
 * work (Irgat conversations, inbox discussions, habit runs) are left out, and
 * orchestration workers report through their lead: a worker waiting on the
 * user makes the lead's card need input.
 */
export function boardSessions(
  sessions: readonly Session[],
  irgatSessionIds: ReadonlySet<string> = new Set(),
): Map<string, BoardSession> {
  const workers = new Map<string, { needsInput: boolean; busy: boolean }>();
  for (const session of sessions) {
    const lead = session.orchestrationLeadId;
    if (!lead) continue;
    const seen = workers.get(lead) ?? { needsInput: false, busy: false };
    if (sessionNeedsInput(session)) seen.needsInput = true;
    if (session.busy) seen.busy = true;
    workers.set(lead, seen);
  }
  const board = new Map<string, BoardSession>();
  for (const session of sessions) {
    if (
      session.ephemeral ||
      session.inboxAsk ||
      session.orchestrationLeadId ||
      irgatSessionIds.has(session.id) ||
      !looksLikeProject(session.cwd)
    ) {
      continue;
    }
    let live = liveCardSession(session);
    const team = workers.get(session.id);
    if (team?.needsInput && live.status !== "needs-input") {
      live = { ...live, status: "needs-input" };
    } else if (team?.busy && live.status !== "needs-input" && live.status !== "running") {
      live = { ...live, status: "running" };
    }
    board.set(session.id, {
      ...live,
      fileable:
        live.status !== "draft" ||
        sessionDraftBlock(session) !== undefined ||
        session.handoffCard !== undefined,
    });
  }
  return board;
}

/** What to send the store for sessions whose board state changed since `sent`. */
export function boardSyncBatches(
  sessions: ReadonlyMap<string, BoardSession>,
  linked: ReadonlySet<string>,
  sent: Map<string, string>,
): Map<string, KanbanSessionSync[]> {
  const batches = new Map<string, KanbanSessionSync[]>();
  for (const [sessionId, session] of sessions) {
    if (!session.project || (!session.fileable && !linked.has(sessionId))) continue;
    const key = `${session.status}\u0000${session.title}`;
    if (sent.get(sessionId) === key) continue;
    sent.set(sessionId, key);
    const batch = batches.get(session.project) ?? [];
    batch.push({ sessionId, title: session.title, status: session.status });
    batches.set(session.project, batch);
  }
  return batches;
}

export type ProjectActivity = { project: string; waiting: number; running: number };

/** A coding agent in a raw terminal, counted with the project's sessions. */
export type TerminalAgentActivity = {
  project: string;
  state: "working" | "blocked" | "idle" | "done";
};

/**
 * Projects other than `current` with sessions working or waiting on the
 * user, those waiting first, so the board can point at them.
 */
export function projectActivity(
  sessions: ReadonlyMap<string, LiveCardSession>,
  current: string | null,
  terminalAgents: readonly TerminalAgentActivity[] = [],
): ProjectActivity[] {
  const byProject = new Map<string, ProjectActivity>();
  type Live = Pick<LiveCardSession, "project" | "status">;
  const live: Live[] = [...sessions.values()];
  for (const agent of terminalAgents) {
    if (agent.state === "blocked") {
      live.push({ project: agent.project, status: "needs-input" });
    } else if (agent.state === "working") {
      live.push({ project: agent.project, status: "running" });
    }
  }
  for (const session of live) {
    if (!session.project || session.project === current) continue;
    if (session.status !== "needs-input" && session.status !== "running") continue;
    const entry = byProject.get(session.project) ?? {
      project: session.project,
      waiting: 0,
      running: 0,
    };
    if (session.status === "needs-input") entry.waiting += 1;
    else entry.running += 1;
    byProject.set(session.project, entry);
  }
  return [...byProject.values()].sort(
    (a, b) =>
      b.waiting - a.waiting || b.running - a.running || a.project.localeCompare(b.project),
  );
}

export type CardSessionView = {
  state: CardSessionState;
  title: string;
  harness: HarnessId | null;
  live: boolean;
  attention?: SessionAttention;
};

export function cardSessionLabel(view: Pick<CardSessionView, "state" | "attention">): string {
  return view.attention ? SESSION_ATTENTION_LABEL[view.attention] : CARD_SESSION_LABEL[view.state];
}

export function cardSessionView(
  link: KanbanCardSession,
  live: LiveCardSession | undefined,
): CardSessionView {
  if (live) {
    return {
      state: live.status,
      title: live.title,
      harness: live.harness,
      live: true,
      ...(live.attention ? { attention: live.attention } : {}),
    };
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
    key += `${id}\u0000${session.status}\u0000${session.harness}\u0000${session.title}\u0000${
      session.project ?? ""
    }\u0000${session.attention ?? ""}\u0001`;
  }
  return key;
}
