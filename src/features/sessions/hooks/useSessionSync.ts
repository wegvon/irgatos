import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { updateSessionState } from "../../../app/model/sessionState";
import type { Session } from "../model/session";
import {
  refreshStoredSession,
  subscribeSessionRebase,
} from "../data/sessionStore";

export const SESSION_SAVED = "irgat:session-saved";
/** Coalesces the saves a streaming turn makes in another window. */
const REFRESH_DELAY_MS = 2_500;

type SessionSaved = { sessionId: string; revision: number; origin: string };

/**
 * Keeps chats that are open in several windows in step. A window that sees
 * another window save one of its open chats pulls the stored copy in and
 * merges it, so it shows the new messages and its own next save (or its
 * close) builds on them instead of being refused or reverting them.
 */
export function useSessionSync(
  sessionsRef: RefObject<Session[]>,
  setSessions: Dispatch<SetStateAction<Session[]>>,
  /** `clean` sessions match the store exactly and need no write. */
  onRebased: (sessionId: string, clean?: Session) => void,
): void {
  useEffect(
    () =>
      subscribeSessionRebase((sessionId, rebase) => {
        let clean: Session | undefined;
        updateSessionState(sessionsRef, setSessions, (sessions) =>
          sessions.some((session) => session.id === sessionId)
            ? sessions.map((session) => {
                if (session.id !== sessionId) return session;
                const next = rebase(session);
                clean = next.dirty ? undefined : next.session;
                return next.session;
              })
            : sessions,
        );
        onRebased(sessionId, clean);
      }),
    [onRebased, sessionsRef, setSessions],
  );

  useEffect(() => {
    let label: string | undefined;
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      return;
    }
    const latest = new Map<string, number>();
    const timers = new Map<string, number>();
    const refresh = (sessionId: string) => {
      timers.delete(sessionId);
      if (document.hidden) return;
      const revision = latest.get(sessionId);
      latest.delete(sessionId);
      if (revision === undefined) return;
      void refreshStoredSession(sessionId, revision, () =>
        sessionsRef.current.find((session) => session.id === sessionId),
      ).catch(() => undefined);
    };
    const schedule = (sessionId: string) => {
      if (timers.has(sessionId)) return;
      timers.set(
        sessionId,
        window.setTimeout(() => refresh(sessionId), REFRESH_DELAY_MS),
      );
    };
    const onVisible = () => {
      if (document.hidden) return;
      for (const sessionId of latest.keys()) schedule(sessionId);
    };
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<SessionSaved>(SESSION_SAVED, ({ payload }) => {
      if (payload.origin === label) return;
      if (!sessionsRef.current.some((session) => session.id === payload.sessionId))
        return;
      latest.set(
        payload.sessionId,
        Math.max(latest.get(payload.sessionId) ?? 0, payload.revision),
      );
      if (!document.hidden) schedule(payload.sessionId);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      stop?.();
      document.removeEventListener("visibilitychange", onVisible);
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [sessionsRef]);
}
