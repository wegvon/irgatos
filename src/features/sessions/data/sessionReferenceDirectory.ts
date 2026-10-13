import { isIrgatSession } from "../../irgats/model/irgat";
import type { Session } from "../model/session";
import {
  injectSessionReferences,
  planSessionReferences,
  sessionReferenceId,
  sessionReferenceTokens,
  type SessionReferencePlan,
  type SessionReferenceSource,
  type SessionReferenceTarget,
  type SessionReferenceToken,
} from "../model/sessionReferences";
import {
  getSession,
  listRecentSessions,
  type SessionSummary,
} from "./sessionStore";

/** A chat the composer can reference, newest activity first. */
export type SessionReferenceCandidate = {
  id: string;
  title: string;
  harness: Session["harness"];
  cwd: string;
  worktreeCwd?: string;
  branch?: string;
  updatedAt: number;
  busy: boolean;
  /** Open in this window, so its blocks are current. */
  live: boolean;
};

const RECENT_LIMIT = 200;
const RECENT_TTL_MS = 4_000;
const STORED_CACHE_LIMIT = 16;

let liveSessions: readonly Session[] = [];
const liveListeners = new Set<() => void>();

/** The app's in-memory chats; running turns are only current here. */
export function publishLiveSessions(sessions: readonly Session[]): void {
  if (sessions === liveSessions) return;
  liveSessions = sessions;
  for (const listener of liveListeners) listener();
}

export function peekLiveSessions(): readonly Session[] {
  return liveSessions;
}

export function subscribeLiveSessions(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

/** Referenceable: a real, saved-style chat the user wrote in. */
export function isReferenceableSession(session: Session): boolean {
  return (
    !session.ephemeral &&
    !session.inboxAsk &&
    !session.orchestrationLeadId &&
    !isIrgatSession(session.id) &&
    sessionReferenceId(session.id) != null &&
    session.blocks.some((block) => block.role === "user" && !block.draft)
  );
}

/** Latest moment something happened in a chat, from its own blocks. */
export function sessionActivityAt(session: Session, now = Date.now()): number {
  if (session.busy) return now;
  let at = 0;
  for (const block of session.blocks) {
    const start = block.sentAt ?? block.startedAt;
    if (start == null) continue;
    at = Math.max(at, start + (block.durationMs ?? 0));
  }
  return at;
}

/** Saved chats merged with open ones; open chats win because they are current. */
export function referenceCandidates(
  summaries: readonly SessionSummary[],
  live: readonly Session[],
  currentSessionId: string | undefined,
  now = Date.now(),
): SessionReferenceCandidate[] {
  const byId = new Map<string, SessionReferenceCandidate>();
  for (const summary of summaries) {
    if (summary.id === currentSessionId) continue;
    if (summary.archived || summary.sidebarHidden) continue;
    if (sessionReferenceId(summary.id) == null) continue;
    byId.set(summary.id, {
      id: summary.id,
      title: summary.title,
      harness: summary.harness,
      cwd: summary.cwd,
      ...(summary.worktreeCwd ? { worktreeCwd: summary.worktreeCwd } : {}),
      ...(summary.branch ? { branch: summary.branch } : {}),
      updatedAt: summary.updatedAt,
      busy: false,
      live: false,
    });
  }
  for (const session of live) {
    if (session.id === currentSessionId || !isReferenceableSession(session)) {
      continue;
    }
    const saved = byId.get(session.id);
    byId.set(session.id, {
      id: session.id,
      title: session.title,
      harness: session.harness,
      cwd: session.cwd,
      ...(session.worktreeCwd ? { worktreeCwd: session.worktreeCwd } : {}),
      ...(session.branch ? { branch: session.branch } : {}),
      updatedAt: Math.max(
        saved?.updatedAt ?? 0,
        sessionActivityAt(session, now),
      ),
      busy: !!session.busy,
      live: true,
    });
  }
  return [...byId.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

let recent: { at: number; rows: SessionSummary[] } | null = null;
let recentFlight: Promise<SessionSummary[]> | null = null;

export function peekRecentSessionSummaries(): SessionSummary[] | null {
  return recent?.rows ?? null;
}

export async function loadRecentSessionSummaries(
  refresh = false,
): Promise<SessionSummary[]> {
  if (!refresh && recent && Date.now() - recent.at < RECENT_TTL_MS) {
    return recent.rows;
  }
  if (recentFlight) return recentFlight;
  const flight = listRecentSessions(RECENT_LIMIT)
    .then((rows) => {
      recent = { at: Date.now(), rows };
      return rows;
    })
    .catch(() => recent?.rows ?? [])
    .finally(() => {
      if (recentFlight === flight) recentFlight = null;
    });
  recentFlight = flight;
  return flight;
}

const stored = new Map<
  string,
  { updatedAt: number; source: SessionReferenceSource }
>();

function rememberStored(
  id: string,
  updatedAt: number,
  source: SessionReferenceSource,
) {
  stored.delete(id);
  stored.set(id, { updatedAt, source });
  while (stored.size > STORED_CACHE_LIMIT) {
    const oldest = stored.keys().next().value;
    if (oldest == null) break;
    stored.delete(oldest);
  }
}

export function liveReferenceSource(
  session: Session,
  now = Date.now(),
): SessionReferenceSource {
  return {
    id: session.id,
    title: session.title,
    harness: session.harness,
    cwd: session.cwd,
    ...(session.worktreeCwd ? { worktreeCwd: session.worktreeCwd } : {}),
    ...(session.branch ? { branch: session.branch } : {}),
    busy: !!session.busy,
    updatedAt: sessionActivityAt(session, now),
    blocks: session.blocks,
  };
}

function liveByPrefix(prefix: string): Session | undefined {
  return liveSessions.find(
    (session) => sessionReferenceId(session.id) === prefix && !session.inboxAsk,
  );
}

async function storedByPrefix(
  prefix: string,
): Promise<SessionReferenceSource | undefined> {
  const summaries = peekRecentSessionSummaries() ?? [];
  let summary = summaries.find((row) => sessionReferenceId(row.id) === prefix);
  if (!summary) {
    const rows = await listRecentSessions(2, prefix).catch(() => []);
    summary = rows.find((row) => sessionReferenceId(row.id) === prefix);
  }
  if (!summary) return undefined;
  const cached = stored.get(summary.id);
  if (cached && cached.updatedAt === summary.updatedAt) return cached.source;
  const session = await getSession(summary.id).catch(() => null);
  if (!session) return undefined;
  const source: SessionReferenceSource = {
    id: session.id,
    title: session.title,
    harness: session.harness,
    cwd: session.cwd,
    ...(session.worktreeCwd ? { worktreeCwd: session.worktreeCwd } : {}),
    ...(session.branch ? { branch: session.branch } : {}),
    updatedAt: summary.updatedAt,
    blocks: session.blocks,
  };
  rememberStored(summary.id, summary.updatedAt, source);
  return source;
}

/** Resolve short ids to sessions: open chats first, then the saved store. */
export async function loadReferenceSources(
  prefixes: readonly string[],
): Promise<Map<string, SessionReferenceSource | undefined>> {
  const out = new Map<string, SessionReferenceSource | undefined>();
  await Promise.all(
    [...new Set(prefixes)].map(async (prefix) => {
      const live = liveByPrefix(prefix);
      out.set(
        prefix,
        live ? liveReferenceSource(live) : await storedByPrefix(prefix),
      );
    }),
  );
  return out;
}

/** Synchronous view for the composer: only sessions already in memory. */
export function peekReferenceSource(
  prefix: string,
): SessionReferenceSource | undefined {
  const live = liveByPrefix(prefix);
  if (live) return liveReferenceSource(live);
  for (const { source } of stored.values()) {
    if (sessionReferenceId(source.id) === prefix) return source;
  }
  return undefined;
}

export function referenceTarget(context: {
  sessionId?: string;
  harness: Session["harness"];
  cwd: string;
}): SessionReferenceTarget {
  const current = context.sessionId
    ? liveSessions.find((session) => session.id === context.sessionId)
    : undefined;
  return current
    ? {
        sessionId: current.id,
        harness: context.harness,
        cwd: current.cwd,
        ...(current.worktreeCwd ? { worktreeCwd: current.worktreeCwd } : {}),
      }
    : { ...context };
}

export async function planReferencesInText(
  text: string,
  context: { sessionId?: string; harness: Session["harness"]; cwd: string },
): Promise<SessionReferencePlan[]> {
  const tokens: SessionReferenceToken[] = sessionReferenceTokens(text);
  if (tokens.length === 0) return [];
  const sources = await loadReferenceSources(
    tokens.map((token) => token.idPrefix),
  );
  return planSessionReferences(
    tokens,
    (prefix) => sources.get(prefix),
    referenceTarget(context),
  );
}

/**
 * Send path: append the sessions the user referenced to the harness prompt.
 * Tokens are read from what the user typed, never from expanded notes or
 * skills, so a reference inside other content does not pull in more.
 */
export async function applySessionReferencesToTurn(
  typed: string,
  prepared: string,
  context: { sessionId?: string; harness: Session["harness"]; cwd: string },
): Promise<string> {
  const plans = await planReferencesInText(typed, context);
  return injectSessionReferences(prepared, plans);
}
