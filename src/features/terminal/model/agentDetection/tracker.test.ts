import { describe, expect, it } from "vitest";
import type { AgentManifest, ScreenAgentState, ScreenDetection } from "./engine";
import {
  IDLE_SETTLE_MS,
  nextTerminalAgentStatus,
  sameTerminalAgentStatus,
  type TerminalAgentStatus,
} from "./tracker";

const agent = (id = "claude"): AgentManifest => ({
  id,
  label: id === "claude" ? "Claude Code" : id,
  executables: [id],
  rules: [],
});

const reading = (state: ScreenAgentState, id?: string): ScreenDetection => ({
  agent: agent(id),
  state,
});

function step(
  prev: TerminalAgentStatus | null,
  state: ScreenAgentState | null,
  now: number,
  seen = false,
) {
  return nextTerminalAgentStatus(prev, state ? reading(state) : undefined, { now, seen });
}

describe("nextTerminalAgentStatus", () => {
  it("drops the status once no agent is detected", () => {
    const working = step(null, "working", 0);
    expect(step(working, null, 10)).toBeNull();
  });

  it("starts a new agent in the state its screen shows", () => {
    expect(step(null, "working", 5)).toMatchObject({
      agentId: "claude",
      agentLabel: "Claude Code",
      state: "working",
      since: 5,
      worked: true,
    });
    expect(step(null, "blocked", 5)?.state).toBe("blocked");
    expect(step(null, "idle", 5)?.state).toBe("idle");
    expect(step(null, "unknown", 5)?.state).toBe("idle");
  });

  it("restarts when a different agent takes the terminal", () => {
    const claude = step(null, "working", 0);
    const codex = nextTerminalAgentStatus(claude, reading("idle", "codex"), {
      now: 50,
      seen: false,
    });
    expect(codex).toMatchObject({ agentId: "codex", state: "idle", since: 50 });
  });

  it("waits for a quiet screen to hold before ending a turn", () => {
    const working = step(null, "working", 0);
    const flicker = step(working, "idle", 100);
    expect(flicker).toMatchObject({ state: "working", idleSince: 100 });
    const busyAgain = step(flicker, "working", 200);
    expect(busyAgain).toMatchObject({ state: "working", since: 0 });
    expect(busyAgain?.idleSince).toBeUndefined();
    const quiet = step(busyAgain, "idle", 300);
    expect(step(quiet, "idle", 300 + IDLE_SETTLE_MS - 1)?.state).toBe("working");
    expect(step(quiet, "idle", 300 + IDLE_SETTLE_MS)).toMatchObject({
      state: "done",
      since: 300 + IDLE_SETTLE_MS,
    });
  });

  it("ends a turn the user watched as idle, not done", () => {
    const quiet = step(step(null, "working", 0), "idle", 10, true);
    expect(step(quiet, "idle", 10 + IDLE_SETTLE_MS, true)?.state).toBe("idle");
  });

  it("clears done once the terminal is seen", () => {
    const done = step(step(step(null, "working", 0), "idle", 1), "idle", 1 + IDLE_SETTLE_MS);
    expect(done?.state).toBe("done");
    expect(step(done, "idle", 5_000, false)).toBe(done);
    expect(step(done, "idle", 5_000, true)?.state).toBe("idle");
    expect(step(done, "unknown", 5_000, true)?.state).toBe("idle");
  });

  it("applies blocked at once and releases it on an idle screen", () => {
    const working = step(null, "working", 0);
    const blocked = step(working, "blocked", 10);
    expect(blocked).toMatchObject({ state: "blocked", since: 10, worked: true });
    expect(step(blocked, "idle", 20)?.state).toBe("idle");
    expect(step(blocked, "working", 20)?.state).toBe("working");
  });

  it("keeps the last state through unclear readings", () => {
    const working = step(null, "working", 0);
    expect(step(working, "unknown", 10)).toBe(working);
    const blocked = step(working, "blocked", 10);
    expect(step(blocked, "unknown", 20)).toBe(blocked);
  });

  it("returns the same object when nothing changes", () => {
    const idle = step(null, "idle", 0);
    expect(step(idle, "idle", 99)).toBe(idle);
  });
});

describe("sameTerminalAgentStatus", () => {
  it("compares every field", () => {
    const a = step(null, "working", 0)!;
    expect(sameTerminalAgentStatus(a, { ...a })).toBe(true);
    expect(sameTerminalAgentStatus(a, { ...a, idleSince: 3 })).toBe(false);
    expect(sameTerminalAgentStatus(a, null)).toBe(false);
    expect(sameTerminalAgentStatus(null, null)).toBe(true);
  });
});
