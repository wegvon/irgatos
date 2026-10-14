import type { ScreenAgentState, ScreenDetection } from "./engine";

/**
 * What a terminal tab shows. `done` is a finished turn nobody has looked at
 * yet; it becomes `idle` once the terminal is seen.
 */
export type TerminalAgentState = "working" | "blocked" | "idle" | "done";

export type TerminalAgentStatus = {
  agentId: string;
  agentLabel: string;
  state: TerminalAgentState;
  /** When `state` last changed. */
  since: number;
  /** An idle screen seen during a turn, waiting to prove it is not a redraw. */
  idleSince?: number;
  /** The agent has been seen working since it appeared. */
  worked?: boolean;
};

/**
 * A turn's screen flickers between frames (spinners redraw, status lines
 * clear), so leaving `working` needs the quiet screen to hold this long.
 */
export const IDLE_SETTLE_MS = 1_500;

function at(
  prev: TerminalAgentStatus,
  state: TerminalAgentState,
  now: number,
  extra: Partial<TerminalAgentStatus> = {},
): TerminalAgentStatus {
  const { idleSince: _drop, ...rest } = prev;
  return {
    ...rest,
    ...extra,
    state,
    since: prev.state === state ? prev.since : now,
  };
}

/**
 * Next status for a terminal from one screen reading. Working and blocked
 * take effect at once; a working turn only ends after `IDLE_SETTLE_MS` of
 * quiet, and ends as `done` unless the terminal is being looked at.
 */
export function nextTerminalAgentStatus(
  prev: TerminalAgentStatus | null,
  detection: ScreenDetection | undefined,
  { now, seen }: { now: number; seen: boolean },
): TerminalAgentStatus | null {
  if (!detection) return null;
  const screen: ScreenAgentState = detection.state;
  const identity = { agentId: detection.agent.id, agentLabel: detection.agent.label };
  if (!prev || prev.agentId !== identity.agentId) {
    const state: TerminalAgentState =
      screen === "working" ? "working" : screen === "blocked" ? "blocked" : "idle";
    return {
      ...identity,
      state,
      since: now,
      ...(state === "working" ? { worked: true } : {}),
    };
  }
  if (screen === "working") return at(prev, "working", now, { worked: true });
  if (screen === "blocked") return at(prev, "blocked", now);
  if (screen === "unknown") {
    if (prev.state === "done" && seen) return at(prev, "idle", now);
    return prev;
  }
  if (prev.state === "working") {
    const idleSince = prev.idleSince ?? now;
    if (now - idleSince < IDLE_SETTLE_MS) {
      return prev.idleSince === idleSince ? prev : { ...prev, idleSince };
    }
    return at(prev, seen ? "idle" : "done", now);
  }
  if (prev.state === "blocked") return at(prev, "idle", now);
  if (prev.state === "done") return seen ? at(prev, "idle", now) : prev;
  return prev.idleSince === undefined ? prev : at(prev, prev.state, now);
}

export function sameTerminalAgentStatus(
  a: TerminalAgentStatus | null,
  b: TerminalAgentStatus | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.agentId === b.agentId &&
    a.state === b.state &&
    a.since === b.since &&
    a.idleSince === b.idleSince &&
    a.worked === b.worked
  );
}

export const TERMINAL_AGENT_STATE_LABEL: Record<TerminalAgentState, string> = {
  working: "Working",
  blocked: "Needs input",
  idle: "Idle",
  done: "Done",
};
