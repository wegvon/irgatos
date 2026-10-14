import { useSyncExternalStore } from "react";
import {
  loadCooperativeMode,
  sessionMessageStore,
  subscribeCooperativeMode,
} from "../data/sessionMessageStore";

export function useSessionMessages() {
  return useSyncExternalStore(
    sessionMessageStore.subscribe,
    sessionMessageStore.snapshot,
    sessionMessageStore.snapshot,
  );
}

export function useCooperativeMode() {
  return useSyncExternalStore(
    subscribeCooperativeMode,
    loadCooperativeMode,
    loadCooperativeMode,
  );
}
