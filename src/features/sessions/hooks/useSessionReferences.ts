import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  loadRecentSessionSummaries,
  peekLiveSessions,
  peekRecentSessionSummaries,
  planReferencesInText,
  referenceCandidates,
  subscribeLiveSessions,
  type SessionReferenceCandidate,
} from "../data/sessionReferenceDirectory";
import type { HarnessId } from "../model/session";
import {
  sessionReferenceTokens,
  type SessionReferencePlan,
} from "../model/sessionReferences";

export function useLiveSessions() {
  return useSyncExternalStore(
    subscribeLiveSessions,
    peekLiveSessions,
    peekLiveSessions,
  );
}

/** Chats the picker offers while it is open, newest activity first. */
export function useSessionReferenceCandidates(
  open: boolean,
  currentSessionId: string | undefined,
): { candidates: SessionReferenceCandidate[]; loading: boolean } {
  const live = useLiveSessions();
  const [summaries, setSummaries] = useState(peekRecentSessionSummaries);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadRecentSessionSummaries().then((rows) => {
      if (!cancelled) setSummaries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  const candidates = useMemo(
    () => referenceCandidates(summaries ?? [], live, currentSessionId),
    [summaries, live, currentSessionId],
  );
  return { candidates, loading: open && summaries === null };
}

/**
 * What each `@session/…` token in the draft will add when sent. Re-plans as
 * the referenced chats change, so a running source shows its latest size.
 */
export function useSessionReferencePlans(
  text: string,
  context: { sessionId?: string; harness: HarnessId; cwd: string },
  enabled = true,
): { plans: SessionReferencePlan[]; loading: boolean } {
  const live = useLiveSessions();
  const key = useMemo(
    () =>
      enabled
        ? sessionReferenceTokens(text)
            .map((token) => token.label)
            .join(" ")
        : "",
    [enabled, text],
  );
  const textRef = useRef(text);
  textRef.current = text;
  const [state, setState] = useState<{
    key: string;
    plans: SessionReferencePlan[];
  }>({ key: "", plans: [] });
  const { sessionId, harness, cwd } = context;
  useEffect(() => {
    if (!key) {
      setState({ key: "", plans: [] });
      return;
    }
    let cancelled = false;
    void planReferencesInText(textRef.current, { sessionId, harness, cwd })
      .then((plans) => {
        if (!cancelled) setState({ key, plans });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, live, sessionId, harness, cwd]);
  return {
    plans: key ? state.plans : [],
    loading: !!key && state.key !== key,
  };
}
