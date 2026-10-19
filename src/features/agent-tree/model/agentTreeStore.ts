import type { AgentRetryLinks } from "./agentTree";

/** Retries started from the tree and error boxes the user dismissed. */
export type AgentTreeState = {
  retries: AgentRetryLinks;
  dismissed: readonly string[];
  window: AgentTreeWindow;
};

export const AGENT_TREE_WINDOWS = ["24h", "7d", "all"] as const;
export type AgentTreeWindow = (typeof AGENT_TREE_WINDOWS)[number];

export const AGENT_TREE_WINDOW_LABEL: Record<AgentTreeWindow, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  all: "All",
};

export function windowSince(window: AgentTreeWindow, now: number): number {
  if (window === "24h") return now - 24 * 60 * 60 * 1000;
  if (window === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  return 0;
}

const KEY = "irgatos.agentTree.v1";
/** Old dismissals and retry links are of no use once their sessions are gone. */
const KEEP = 200;

export function loadAgentTreeState(): AgentTreeState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    if (!raw || typeof raw !== "object") throw new Error("empty");
    const record = raw as Record<string, unknown>;
    const retries: Record<string, { from: string; parentId?: string }> = {};
    if (record.retries && typeof record.retries === "object") {
      for (const [id, link] of Object.entries(
        record.retries as Record<string, unknown>,
      )) {
        const value = link as Record<string, unknown> | null;
        if (!value || typeof value.from !== "string") continue;
        retries[id] = {
          from: value.from,
          ...(typeof value.parentId === "string"
            ? { parentId: value.parentId }
            : {}),
        };
      }
    }
    const dismissed = Array.isArray(record.dismissed)
      ? record.dismissed.filter((id): id is string => typeof id === "string")
      : [];
    const window = AGENT_TREE_WINDOWS.includes(record.window as AgentTreeWindow)
      ? (record.window as AgentTreeWindow)
      : "24h";
    return { retries, dismissed, window };
  } catch {
    return { retries: {}, dismissed: [], window: "24h" };
  }
}

export function saveAgentTreeState(state: AgentTreeState): void {
  const retries = Object.entries(state.retries).slice(-KEEP);
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        retries: Object.fromEntries(retries),
        dismissed: state.dismissed.slice(-KEEP),
        window: state.window,
      }),
    );
  } catch {
    // Storage full or unavailable: the tree still works for this run.
  }
}
