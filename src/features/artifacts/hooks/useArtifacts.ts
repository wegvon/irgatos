import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getSession, type SessionSummary } from "../../sessions/data/sessionStore";
import type { Session } from "../../sessions/model/session";
import { pathKey } from "../../../shared/lib/paths";
import {
  getRegisteredArtifact,
  registerArtifacts,
  subscribeArtifactRegistry,
} from "../model/artifactRegistry";
import {
  irgatArtifactScope,
  listPinnedArtifacts,
  projectArtifactScope,
  subscribePinnedArtifacts,
} from "../model/pinnedArtifacts";
import {
  extractSessionArtifacts,
  mergeArtifacts,
  type ArtifactScope,
  type WorkspaceArtifact,
} from "../model/workspaceArtifacts";

export function usePinnedArtifacts(scope: string | undefined): WorkspaceArtifact[] {
  const read = useCallback(
    () => (scope ? listPinnedArtifacts(scope) : EMPTY),
    [scope],
  );
  return useSyncExternalStore(subscribePinnedArtifacts, read, read);
}

export function useRegisteredArtifact(id: string): WorkspaceArtifact | undefined {
  const read = useCallback(() => getRegisteredArtifact(id), [id]);
  return useSyncExternalStore(subscribeArtifactRegistry, read, read);
}

const EMPTY: WorkspaceArtifact[] = [];

type Extracted = {
  blocks: Session["blocks"];
  title: string;
  scope?: string;
  artifacts: WorkspaceArtifact[];
};
const extracted = new Map<string, Extracted>();

/** Extraction is a full pass over a transcript; reuse it until the blocks change. */
export function sessionArtifacts(
  session: Pick<Session, "id" | "title" | "cwd" | "worktreeCwd" | "blocks">,
  options: { fallbackAt?: number; scope?: string } = {},
): WorkspaceArtifact[] {
  const cached = extracted.get(session.id);
  if (
    cached &&
    cached.blocks === session.blocks &&
    cached.title === session.title &&
    cached.scope === options.scope
  )
    return cached.artifacts;
  const artifacts = extractSessionArtifacts(session, options);
  extracted.set(session.id, {
    blocks: session.blocks,
    title: session.title,
    scope: options.scope,
    artifacts,
  });
  return artifacts;
}

const stored = new Map<string, { updatedAt: number; artifacts: WorkspaceArtifact[] }>();
export const PROJECT_SESSION_LIMIT = 40;

function sameProject(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/**
 * Artifacts of saved sessions that are not open, read from the store a few
 * at a time and kept until the session changes.
 */
export function useStoredSessionArtifacts(
  wanted: readonly SessionSummary[],
  enabled: boolean,
  pinScope?: string,
): {
  lists: WorkspaceArtifact[][];
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [loadTick, setLoadTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedVersion, setStoredVersion] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const missing = wanted.filter(
      (summary) => stored.get(summary.id)?.updatedAt !== summary.updatedAt,
    );
    if (!missing.length) {
      setLoading(false);
      return;
    }
    const run = ++generation.current;
    setLoading(true);
    setError(null);
    void (async () => {
      let failed = 0;
      for (let index = 0; index < missing.length; index += 4) {
        const batch = missing.slice(index, index + 4);
        const loaded = await Promise.all(
          batch.map((summary) => getSession(summary.id).catch(() => null)),
        );
        if (run !== generation.current) return;
        loaded.forEach((session, offset) => {
          const summary = batch[offset];
          if (!session) {
            failed += 1;
            return;
          }
          stored.set(summary.id, {
            updatedAt: summary.updatedAt,
            artifacts: extractSessionArtifacts(session, {
              sessionTitle: summary.title || session.title,
              fallbackAt: summary.updatedAt,
              scope: pinScope,
            }),
          });
        });
        setStoredVersion((value) => value + 1);
      }
      if (run !== generation.current) return;
      setLoading(false);
      if (failed && failed === missing.length)
        setError("Could not read the saved sessions.");
    })();
    return () => {
      generation.current += 1;
    };
  }, [enabled, wanted, loadTick, pinScope]);

  const lists = useMemo(() => {
    if (!enabled) return [];
    const out: WorkspaceArtifact[][] = [];
    for (const summary of wanted) {
      const entry = stored.get(summary.id);
      if (entry) out.push(entry.artifacts);
    }
    return out;
    // storedVersion re-reads the module cache after a batch lands.
  }, [enabled, wanted, storedVersion]);

  const retry = useCallback(() => {
    setError(null);
    setLoadTick((value) => value + 1);
  }, []);

  return { lists, loading: enabled && loading, error: enabled ? error : null, retry };
}

export type ProjectArtifacts = {
  artifacts: WorkspaceArtifact[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  /** Whether a chat is in front to scope "This session" to. */
  hasActiveSession: boolean;
};

/**
 * The project's artifacts for the Artifacts tab: the active chat's, or every
 * session's, with the project's pins on top. Saved sessions that are not open
 * are read from the store on demand, newest first.
 */
export function useProjectArtifacts({
  cwd,
  sessions,
  history,
  activeSessionId,
  scope,
  enabled,
}: {
  cwd: string;
  sessions: readonly Session[];
  history: readonly SessionSummary[];
  activeSessionId?: string;
  scope: ArtifactScope;
  /** Whether the list is on screen; saved sessions are only read then. */
  enabled: boolean;
}): ProjectArtifacts {
  const project = cwd && cwd !== "~" ? cwd : "";
  const pinScope = project ? projectArtifactScope(project) : undefined;
  const pinned = usePinnedArtifacts(pinScope);
  const updatedAt = useMemo(() => {
    const map = new Map<string, number>();
    for (const summary of history) map.set(summary.id, summary.updatedAt);
    return map;
  }, [history]);

  const found = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId)
    : undefined;
  const active = found && project && sameProject(found.cwd, project) ? found : undefined;
  const activeArtifacts = useMemo(
    () =>
      active
        ? sessionArtifacts(active, {
            fallbackAt: updatedAt.get(active.id),
            scope: pinScope,
          })
        : EMPTY,
    [active, updatedAt, pinScope],
  );

  const liveProject = useMemo(
    () =>
      project
        ? sessions.filter(
            (session) =>
              sameProject(session.cwd, project) &&
              !session.ephemeral &&
              !session.inboxAsk &&
              !session.sidebarHidden &&
              session.blocks.length > 0,
          )
        : [],
    [sessions, project],
  );

  const wanted = useMemo(() => {
    if (!project) return [];
    const live = new Set(liveProject.map((session) => session.id));
    return [...history]
      .filter(
        (summary) =>
          sameProject(summary.cwd, project) &&
          !summary.archived &&
          !summary.draft &&
          !live.has(summary.id),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, PROJECT_SESSION_LIMIT);
  }, [history, liveProject, project]);

  const saved = useStoredSessionArtifacts(
    wanted,
    enabled && scope === "project",
    pinScope,
  );

  const artifacts = useMemo(() => {
    if (scope === "session") return mergeArtifacts(pinned, activeArtifacts);
    const lists: WorkspaceArtifact[][] = [pinned];
    for (const session of liveProject)
      lists.push(
        sessionArtifacts(session, {
          fallbackAt: updatedAt.get(session.id),
          scope: pinScope,
        }),
      );
    return mergeArtifacts(...lists, ...saved.lists);
  }, [scope, pinned, activeArtifacts, liveProject, updatedAt, pinScope, saved.lists]);

  useEffect(() => registerArtifacts(artifacts), [artifacts]);

  return {
    artifacts,
    loading: scope === "project" && saved.loading,
    error: scope === "project" ? saved.error : null,
    retry: saved.retry,
    hasActiveSession: !!active,
  };
}

/**
 * A Irgat's artifacts: from its own conversation, the sessions it started,
 * and what was pinned to it.
 */
export function useIrgatArtifacts({
  irgatId,
  sessionId,
  launchedIds,
  sessions,
  history,
  enabled,
}: {
  irgatId: string;
  sessionId?: string;
  launchedIds: readonly string[];
  sessions: readonly Session[];
  history?: readonly SessionSummary[];
  enabled: boolean;
}): ProjectArtifacts {
  const pinScope = irgatArtifactScope(irgatId);
  const pinned = usePinnedArtifacts(pinScope);
  const ids = useMemo(
    () => [...new Set([...(sessionId ? [sessionId] : []), ...launchedIds])],
    [sessionId, launchedIds],
  );
  const live = useMemo(
    () =>
      ids.flatMap((id) => {
        const session = sessions.find((entry) => entry.id === id);
        return session ? [session] : [];
      }),
    [ids, sessions],
  );
  const wanted = useMemo(() => {
    const open = new Set(live.map((session) => session.id));
    const want = new Set(ids.filter((id) => !open.has(id)));
    return (history ?? []).filter((summary) => want.has(summary.id));
  }, [ids, live, history]);
  const saved = useStoredSessionArtifacts(wanted, enabled, pinScope);
  const artifacts = useMemo(
    () =>
      mergeArtifacts(
        pinned,
        ...live.map((session) => sessionArtifacts(session, { scope: pinScope })),
        ...saved.lists,
      ),
    [pinned, live, saved.lists, pinScope],
  );
  useEffect(() => registerArtifacts(artifacts), [artifacts]);
  return {
    artifacts,
    loading: saved.loading,
    error: saved.error,
    retry: saved.retry,
    hasActiveSession: live.length > 0,
  };
}
