import { useEffect, useMemo, useRef, useState } from "react";
import { listIrgats } from "../../irgats/model/irgat";
import type { Session } from "../../sessions/model/session";
import {
  loadKanbanSessionLinks,
  subscribeKanban,
  syncKanbanSessions,
  type KanbanSessionLink,
} from "../model/kanban";
import {
  boardSessions,
  boardSyncBatches,
  liveCardSession,
  liveSessionsKey,
  type BoardSession,
  type LiveCardSession,
} from "../model/cardSession";

export type KanbanSessions = {
  links: ReadonlyMap<string, KanbanSessionLink>;
  linkedIds: ReadonlySet<string>;
  /** Loaded sessions the board shows: project work, plus any linked from a card. */
  live: ReadonlyMap<string, LiveCardSession>;
};

/**
 * Keeps every board in step with the loaded sessions. Project sessions get a
 * card without anyone filing one, and a card moves when its session starts
 * working, asks for approval or answers, or finishes. Cards remember the last
 * state they saw, so they still read right after the app restarts.
 */
export function useKanbanSessions(sessions: readonly Session[]): KanbanSessions {
  const [links, setLinks] = useState<ReadonlyMap<string, KanbanSessionLink>>(
    () => new Map(),
  );
  const liveRef = useRef<{ key: string; map: ReadonlyMap<string, BoardSession> }>({
    key: "",
    map: new Map(),
  });
  const sent = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      loadKanbanSessionLinks()
        .then((list) => {
          if (cancelled || current !== generation) return;
          setLinks(new Map(list.map((link) => [link.sessionId, link])));
        })
        .catch(() => undefined);
    };
    load();
    const stop = subscribeKanban(load);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const linkedIds = useMemo(() => new Set(links.keys()), [links]);

  const sessionIdsKey = sessions.map((session) => session.id).join("\u0000");
  // The roster only changes alongside the set of loaded sessions.
  const irgatSessionIds = useMemo(
    () => new Set(listIrgats().flatMap((irgat) => (irgat.sessionId ? [irgat.sessionId] : []))),
    [sessionIdsKey],
  );

  const live = useMemo(() => {
    const map = boardSessions(sessions, irgatSessionIds);
    for (const session of sessions) {
      if (linkedIds.has(session.id) && !map.has(session.id)) {
        map.set(session.id, { ...liveCardSession(session), fileable: false });
      }
    }
    const key = liveSessionsKey(map);
    if (key !== liveRef.current.key) liveRef.current = { key, map };
    return liveRef.current.map;
  }, [irgatSessionIds, linkedIds, sessions]);

  useEffect(() => {
    for (const [project, batch] of boardSyncBatches(live, linkedIds, sent.current)) {
      const keys = new Map(batch.map((entry) => [entry.sessionId, sent.current.get(entry.sessionId)]));
      syncKanbanSessions(project, batch).catch(() => {
        for (const [sessionId, key] of keys) {
          if (sent.current.get(sessionId) === key) sent.current.delete(sessionId);
        }
      });
    }
  }, [linkedIds, live]);

  return { links, linkedIds, live };
}
