import { useEffect, useMemo, useRef } from "react";
import { useDecisionDeferrals } from "./useDecisionDeferrals";
import {
  notifySession,
  pendingInputNotifications,
  retireDecisionNotification,
} from "../model/notifications";
import {
  clearDecisionDeferral,
  loadDecisionDeferrals,
  pruneDecisionDeferrals,
} from "../model/decisionDeferrals";
import type { Session } from "../../sessions/model/session";

export function useInputNotifications(
  sessions: Session[],
  activeSessionId: string | undefined,
) {
  const inputNotifications = useMemo(
    () => pendingInputNotifications(sessions),
    [sessions],
  );
  const deferrals = useDecisionDeferrals();
  const notifiedInputIdsRef = useRef(new Set<string>());
  const latestRef = useRef(inputNotifications);
  latestRef.current = inputNotifications;
  useEffect(() => {
    const notified = notifiedInputIdsRef.current;
    for (const key of notified) {
      if (inputNotifications.has(key)) continue;
      // Answered, denied or expired: the banner would now ask for nothing.
      notified.delete(key);
      retireDecisionNotification(key);
    }
    pruneDecisionDeferrals(
      new Set(inputNotifications.keys()),
      new Set(sessions.map((session) => session.id)),
    );
    const notifiedSessions = new Set<string>();
    for (const [key, { session, event }] of inputNotifications) {
      if (notified.has(key) || notifiedSessions.has(session.id)) continue;
      notifiedSessions.add(session.id);
      // Coalesce this render's banners per session, but leave other requests
      // eligible for the next update (including resolution of the first one).
      notified.add(key);
      void notifySession(
        session,
        event,
        session.id === activeSessionId,
      );
    }
  }, [activeSessionId, inputNotifications, sessions]);

  // A deferral with a reminder brings its request back once: the card
  // returns and the banner is sent again, marked as a reminder.
  useEffect(() => {
    const now = Date.now();
    let next = Infinity;
    for (const deferral of Object.values(deferrals)) {
      if (deferral.remindAt != null) next = Math.min(next, deferral.remindAt);
    }
    if (next === Infinity) return;
    const timer = window.setTimeout(
      () => {
        const at = Date.now();
        for (const [key, deferral] of Object.entries(loadDecisionDeferrals())) {
          if (deferral.remindAt == null || deferral.remindAt > at) continue;
          clearDecisionDeferral(key);
          const pending = latestRef.current.get(key);
          if (pending) {
            void notifySession(pending.session, pending.event, false, {
              reminder: true,
            });
          }
        }
      },
      Math.max(0, next - now),
    );
    return () => window.clearTimeout(timer);
  }, [deferrals]);
}
