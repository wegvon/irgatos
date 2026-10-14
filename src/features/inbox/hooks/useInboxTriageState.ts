import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  loadInboxSnoozes,
  subscribeInboxSnoozes,
  type InboxSnoozeState,
} from "../model/inboxSnooze";
import {
  loadInboxDrafts,
  subscribeInboxDrafts,
  type InboxDrafts,
} from "../model/inboxDrafts";
import {
  loadInboxTriageFilter,
  saveInboxTriageFilter,
  subscribeInboxTriageFilter,
  type InboxTriageFilter,
} from "../model/inboxTriage";

export function useInboxSnoozes(): InboxSnoozeState {
  return useSyncExternalStore(
    subscribeInboxSnoozes,
    loadInboxSnoozes,
    loadInboxSnoozes,
  );
}

export function useInboxDrafts(): InboxDrafts {
  return useSyncExternalStore(
    subscribeInboxDrafts,
    loadInboxDrafts,
    loadInboxDrafts,
  );
}

/** The remembered triage pill, kept in step with other windows and toasts. */
export function useInboxTriageFilter(): [
  InboxTriageFilter,
  (next: InboxTriageFilter) => void,
] {
  const [filter, setFilter] = useState(loadInboxTriageFilter);
  useEffect(
    () => subscribeInboxTriageFilter(() => setFilter(loadInboxTriageFilter())),
    [],
  );
  const choose = useCallback((next: InboxTriageFilter) => {
    setFilter(next);
    saveInboxTriageFilter(next);
  }, []);
  return [filter, choose];
}
