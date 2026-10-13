import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "../../sessions/model/session";
import {
  loadKanbanSessionLinks,
  recordKanbanSessionStatus,
  subscribeKanban,
  type KanbanSessionLink,
} from "../model/kanban";
import {
  liveCardSession,
  liveSessionsKey,
  type LiveCardSession,
} from "../model/cardSession";

export type KanbanSessions = {
  links: ReadonlyMap<string, KanbanSessionLink>;
  linkedIds: ReadonlySet<string>;
  live: ReadonlyMap<string, LiveCardSession>;
};

/**
 * Card ↔ session links for every board. Open sessions report their state to
 * the cards that track them, so a card still shows how its session ended
 * after the app restarts.
 */
export function useKanbanSessions(sessions: readonly Session[]): KanbanSessions {
  const [links, setLinks] = useState<ReadonlyMap<string, KanbanSessionLink>>(
    () => new Map(),
  );
  const liveRef = useRef<{ key: string; map: ReadonlyMap<string, LiveCardSession> }>({
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

  const live = useMemo(() => {
    const map = new Map<string, LiveCardSession>();
    for (const session of sessions) {
      if (linkedIds.has(session.id)) map.set(session.id, liveCardSession(session));
    }
    const key = liveSessionsKey(map);
    if (key !== liveRef.current.key) liveRef.current = { key, map };
    return liveRef.current.map;
  }, [linkedIds, sessions]);

  useEffect(() => {
    for (const [sessionId, session] of live) {
      const link = links.get(sessionId);
      if (!link || link.status === session.status) {
        sent.current.delete(sessionId);
        continue;
      }
      if (sent.current.get(sessionId) === session.status) continue;
      sent.current.set(sessionId, session.status);
      recordKanbanSessionStatus(sessionId, session.status).catch(() => {
        if (sent.current.get(sessionId) === session.status) {
          sent.current.delete(sessionId);
        }
      });
    }
  }, [links, live]);

  return { links, linkedIds, live };
}
