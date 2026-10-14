import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenSnapshot } from "./engine";
import { IDLE_SETTLE_MS, type TerminalAgentStatus } from "./tracker";
import {
  SCREEN_READ_THROTTLE_MS,
  createTerminalAgentWatcher,
  liveScreenLines,
} from "./watcher";

describe("liveScreenLines", () => {
  it("reads the rows below baseY, not the scrolled viewport", () => {
    const rows = ["old 1", "old 2", "live 1", "live 2"];
    const buffer = {
      baseY: 2,
      getLine: (y: number) =>
        rows[y] === undefined ? undefined : { translateToString: () => rows[y]! },
    };
    expect(liveScreenLines(buffer, 3)).toEqual(["live 1", "live 2", ""]);
  });
});

describe("createTerminalAgentWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(initial: ScreenSnapshot | null) {
    let snapshot = initial;
    let seen = false;
    const published: (TerminalAgentStatus | null)[] = [];
    const read = vi.fn(() => snapshot);
    const watcher = createTerminalAgentWatcher({
      read,
      publish: (status) => published.push(status),
      seen: () => seen,
      now: () => Date.now(),
    });
    return {
      watcher,
      read,
      published,
      show: (next: ScreenSnapshot | null) => {
        snapshot = next;
      },
      look: (value: boolean) => {
        seen = value;
      },
      last: () => published.at(-1),
    };
  }

  const working: ScreenSnapshot = {
    process: "claude",
    lines: ["✻ Thinking… (3s · esc to interrupt)"],
  };
  const prompt: ScreenSnapshot = { process: "claude", lines: ["> ", "? for shortcuts"] };

  it("throttles bursts of output into one read", () => {
    const t = setup(working);
    t.watcher.poke();
    t.watcher.poke();
    t.watcher.poke();
    expect(t.read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SCREEN_READ_THROTTLE_MS);
    expect(t.read).toHaveBeenCalledTimes(1);
    expect(t.last()?.state).toBe("working");
  });

  it("re-reads after the settle window so a silent finish becomes done", () => {
    const t = setup(working);
    t.watcher.readNow();
    t.show(prompt);
    t.watcher.readNow();
    expect(t.last()?.state).toBe("working");
    vi.advanceTimersByTime(IDLE_SETTLE_MS + 20);
    expect(t.last()?.state).toBe("done");
    t.look(true);
    t.watcher.readNow();
    expect(t.last()?.state).toBe("idle");
  });

  it("publishes only when the status changes", () => {
    const t = setup(prompt);
    t.watcher.readNow();
    t.watcher.readNow();
    expect(t.published).toHaveLength(1);
  });

  it("publishes null when the agent exits and on dispose", () => {
    const t = setup(working);
    t.watcher.readNow();
    t.show(null);
    t.watcher.readNow();
    expect(t.last()).toBeNull();
    t.show(working);
    t.watcher.readNow();
    t.watcher.poke();
    t.watcher.dispose();
    expect(t.last()).toBeNull();
    const reads = t.read.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    t.watcher.readNow();
    expect(t.read).toHaveBeenCalledTimes(reads);
  });
});

describe("createTerminalAgentWatcher identity", () => {
  it("remembers an agent found by title for the same process", () => {
    let snapshot: ScreenSnapshot | null = {
      process: "cli.js",
      title: "✳ Claude Code",
      lines: ["> "],
    };
    const published: (TerminalAgentStatus | null)[] = [];
    const watcher = createTerminalAgentWatcher({
      read: () => snapshot,
      publish: (status) => published.push(status),
      seen: () => false,
    });
    watcher.readNow();
    expect(published.at(-1)?.agentId).toBe("claude");
    snapshot = { process: "cli.js", title: "⠂ Fix tests", lines: ["> "] };
    watcher.readNow();
    expect(published.at(-1)).toMatchObject({ agentId: "claude", state: "working" });
    snapshot = { process: "vim", title: "⠂ Fix tests", lines: ["~"] };
    watcher.readNow();
    expect(published.at(-1)).toBeNull();
    watcher.dispose();
  });
});
