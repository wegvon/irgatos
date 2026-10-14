import { useEffect } from "react";
import {
  notifyTerminalAgent,
  type TerminalAgentNotice,
} from "../../notifications/model/notifications";
import {
  terminalAgentStore,
  terminalTargetId,
  type TerminalAgentStore,
  type TerminalAgentTransition,
} from "../model/agentDetection/terminalAgentStore";

/** The banner a terminal agent's state change earns, if any. */
export function terminalAgentNotice({
  entry,
  from,
}: TerminalAgentTransition): TerminalAgentNotice | null {
  const base = {
    targetId: terminalTargetId(entry.terminalId),
    cwd: entry.cwd,
    tabLabel: entry.tabLabel,
    agentLabel: entry.agentLabel,
  };
  if (entry.state === "blocked" && from !== "blocked") {
    return { ...base, event: "blocked" };
  }
  if (entry.state === "done" && from === "working") {
    return { ...base, event: "done" };
  }
  return null;
}

/** OS banners when an agent in a raw terminal needs the user or finishes. */
export function useTerminalAgentNotifications(
  store: TerminalAgentStore = terminalAgentStore,
  notify: typeof notifyTerminalAgent = notifyTerminalAgent,
): void {
  useEffect(
    () =>
      store.onTransition((transition) => {
        const notice = terminalAgentNotice(transition);
        if (notice) void notify(notice, transition.entry.seen);
      }),
    [store, notify],
  );
}
