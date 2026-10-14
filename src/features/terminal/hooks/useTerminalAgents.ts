import { useSyncExternalStore } from "react";
import {
  terminalAgentStore,
  type TerminalAgentEntry,
  type TerminalAgentStore,
} from "../model/agentDetection/terminalAgentStore";

/** The agent running in one terminal, if any. */
export function useTerminalAgent(
  terminalId: string,
  store: TerminalAgentStore = terminalAgentStore,
): TerminalAgentEntry | undefined {
  useSyncExternalStore(store.subscribe, store.version, store.version);
  return store.get(terminalId);
}

/** Every terminal running a recognized agent. */
export function useTerminalAgents(
  store: TerminalAgentStore = terminalAgentStore,
): readonly TerminalAgentEntry[] {
  useSyncExternalStore(store.subscribe, store.version, store.version);
  return store.list();
}
