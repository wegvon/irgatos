import { TERMINAL_AGENT_CATALOG } from "./catalog";
import { detectScreenAgent, type AgentManifest, type ScreenSnapshot } from "./engine";
import { IDLE_SETTLE_MS, nextTerminalAgentStatus, type TerminalAgentStatus } from "./tracker";

type BufferLineLike = { translateToString(trimRight?: boolean): string };
type BufferLike = {
  baseY: number;
  getLine(y: number): BufferLineLike | undefined;
};

/**
 * The rows the program is drawing now. Reading from `baseY` rather than the
 * viewport keeps a user who scrolled back from changing the agent's state.
 */
export function liveScreenLines(buffer: BufferLike, rows: number): string[] {
  const lines: string[] = [];
  for (let y = buffer.baseY; y < buffer.baseY + rows; y += 1) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return lines;
}

/** Output arrives in bursts; one read per burst is plenty. */
export const SCREEN_READ_THROTTLE_MS = 250;

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type TerminalAgentWatcher = {
  /** Something changed on screen, in the title, or in the foreground process. */
  poke: () => void;
  /** Read now, skipping the throttle (focus changes, tests). */
  readNow: () => void;
  dispose: () => void;
};

/**
 * Reads a terminal's screen after output settles and turns each reading into
 * a status. While a turn may be ending it reads again after the settle
 * window, so `done` arrives even when the agent prints nothing more.
 */
export function createTerminalAgentWatcher({
  read,
  publish,
  seen,
  now = Date.now,
  timers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  catalog = TERMINAL_AGENT_CATALOG,
}: {
  read: () => ScreenSnapshot | null;
  publish: (status: TerminalAgentStatus | null) => void;
  seen: () => boolean;
  now?: () => number;
  timers?: Timers;
  catalog?: readonly AgentManifest[];
}): TerminalAgentWatcher {
  let status: TerminalAgentStatus | null = null;
  let known: { process: string; agent: AgentManifest } | null = null;
  let pending: unknown = null;
  let settle: unknown = null;
  let disposed = false;

  const readNow = () => {
    if (disposed) return;
    if (pending != null) {
      timers.clearTimeout(pending);
      pending = null;
    }
    const snapshot = read();
    const process = snapshot?.process ?? null;
    const detection = snapshot
      ? detectScreenAgent(
          catalog,
          snapshot,
          known && known.process === process ? known.agent : undefined,
        )
      : undefined;
    known = detection && process ? { process, agent: detection.agent } : null;
    const next = nextTerminalAgentStatus(status, detection, { now: now(), seen: seen() });
    if (next !== status) {
      status = next;
      publish(status);
    }
    if (settle != null) {
      timers.clearTimeout(settle);
      settle = null;
    }
    if (status?.idleSince !== undefined) {
      const wait = Math.max(0, status.idleSince + IDLE_SETTLE_MS - now()) + 10;
      settle = timers.setTimeout(() => {
        settle = null;
        readNow();
      }, wait);
    }
  };

  return {
    poke: () => {
      if (disposed || pending != null) return;
      pending = timers.setTimeout(() => {
        pending = null;
        readNow();
      }, SCREEN_READ_THROTTLE_MS);
    },
    readNow,
    dispose: () => {
      disposed = true;
      if (pending != null) timers.clearTimeout(pending);
      if (settle != null) timers.clearTimeout(settle);
      pending = null;
      settle = null;
      if (status) publish(null);
      status = null;
      known = null;
    },
  };
}
