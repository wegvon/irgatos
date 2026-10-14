import {
  sameTerminalAgentStatus,
  type TerminalAgentState,
  type TerminalAgentStatus,
} from "./tracker";

/** A terminal running a recognized agent, as the rest of the app sees it. */
export type TerminalAgentEntry = TerminalAgentStatus & {
  terminalId: string;
  cwd: string;
  /** The terminal's tab label when it was last read. */
  tabLabel: string;
  /** The terminal was on screen and focused at that read. */
  seen: boolean;
};

export type TerminalAgentContext = Pick<TerminalAgentEntry, "cwd" | "tabLabel" | "seen">;

export type TerminalAgentTransition = {
  entry: TerminalAgentEntry;
  from: TerminalAgentState | null;
};

type Listener = () => void;
type TransitionListener = (transition: TerminalAgentTransition) => void;

export type TerminalAgentStore = {
  get: (terminalId: string) => TerminalAgentEntry | undefined;
  list: () => readonly TerminalAgentEntry[];
  /** Changes whenever any entry does, for `useSyncExternalStore`. */
  version: () => number;
  set: (
    terminalId: string,
    status: TerminalAgentStatus | null,
    context: TerminalAgentContext,
  ) => void;
  remove: (terminalId: string) => void;
  subscribe: (listener: Listener) => () => void;
  /** Called once per state change, after the store has the new entry. */
  onTransition: (listener: TransitionListener) => () => void;
};

export function createTerminalAgentStore(): TerminalAgentStore {
  const entries = new Map<string, TerminalAgentEntry>();
  let list: readonly TerminalAgentEntry[] = [];
  let version = 0;
  const listeners = new Set<Listener>();
  const transitions = new Set<TransitionListener>();
  const publish = () => {
    list = [...entries.values()];
    version += 1;
    for (const listener of listeners) listener();
  };
  return {
    get: (terminalId) => entries.get(terminalId),
    list: () => list,
    version: () => version,
    set: (terminalId, status, context) => {
      const prev = entries.get(terminalId) ?? null;
      if (!status) {
        if (!prev) return;
        entries.delete(terminalId);
        publish();
        return;
      }
      if (
        prev &&
        sameTerminalAgentStatus(prev, status) &&
        prev.cwd === context.cwd &&
        prev.tabLabel === context.tabLabel &&
        prev.seen === context.seen
      ) {
        return;
      }
      const entry: TerminalAgentEntry = { ...status, terminalId, ...context };
      entries.set(terminalId, entry);
      publish();
      if (!prev || prev.state !== entry.state || prev.agentId !== entry.agentId) {
        const from = prev && prev.agentId === entry.agentId ? prev.state : null;
        for (const listener of transitions) listener({ entry, from });
      }
    },
    remove: (terminalId) => {
      if (!entries.delete(terminalId)) return;
      publish();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onTransition: (listener) => {
      transitions.add(listener);
      return () => transitions.delete(listener);
    },
  };
}

export const terminalAgentStore = createTerminalAgentStore();

/** Terminal agents on a project, those waiting on the user first. */
export function terminalAgentsForProject(
  entries: readonly TerminalAgentEntry[],
  project: (cwd: string) => string,
  current: string | null,
): TerminalAgentEntry[] {
  const order: Record<TerminalAgentState, number> = {
    blocked: 0,
    working: 1,
    done: 2,
    idle: 3,
  };
  return entries
    .filter((entry) => current != null && project(entry.cwd) === current)
    .sort((a, b) => order[a.state] - order[b.state] || b.since - a.since);
}

/** Ids for notifications and links that point at a terminal, not a session. */
export const TERMINAL_TARGET_PREFIX = "terminal:";

export function terminalTargetId(terminalId: string): string {
  return `${TERMINAL_TARGET_PREFIX}${terminalId}`;
}

export function terminalIdFromTarget(target: string): string | undefined {
  return target.startsWith(TERMINAL_TARGET_PREFIX)
    ? target.slice(TERMINAL_TARGET_PREFIX.length) || undefined
    : undefined;
}
