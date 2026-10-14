import { describe, expect, it, vi } from "vitest";
import {
  createTerminalAgentStore,
  terminalAgentsForProject,
  terminalIdFromTarget,
  terminalTargetId,
  type TerminalAgentEntry,
  type TerminalAgentTransition,
} from "./terminalAgentStore";
import type { TerminalAgentStatus } from "./tracker";

const status = (patch: Partial<TerminalAgentStatus> = {}): TerminalAgentStatus => ({
  agentId: "claude",
  agentLabel: "Claude Code",
  state: "working",
  since: 1,
  ...patch,
});

const context = { cwd: "/repo", tabLabel: "zsh", seen: false };

describe("createTerminalAgentStore", () => {
  it("stores entries, bumps its version and notifies subscribers", () => {
    const store = createTerminalAgentStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.version();
    store.set("t1", status(), context);
    expect(store.get("t1")).toMatchObject({ terminalId: "t1", state: "working", cwd: "/repo" });
    expect(store.list()).toHaveLength(1);
    expect(store.version()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the same list while nothing changes", () => {
    const store = createTerminalAgentStore();
    const listener = vi.fn();
    store.set("t1", status(), context);
    const list = store.list();
    store.subscribe(listener);
    store.set("t1", status(), context);
    expect(store.list()).toBe(list);
    expect(listener).not.toHaveBeenCalled();
    store.set("t1", status(), { ...context, tabLabel: "claude" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports state changes once, with the state left", () => {
    const store = createTerminalAgentStore();
    const transitions: TerminalAgentTransition[] = [];
    store.onTransition((t) => transitions.push(t));
    store.set("t1", status(), context);
    store.set("t1", status({ idleSince: 5 }), context);
    store.set("t1", status({ state: "blocked", since: 6 }), context);
    store.set("t1", status({ agentId: "codex", agentLabel: "Codex", state: "idle" }), context);
    expect(transitions.map((t) => [t.from, t.entry.state, t.entry.agentId])).toEqual([
      [null, "working", "claude"],
      ["working", "blocked", "claude"],
      [null, "idle", "codex"],
    ]);
  });

  it("removes entries when the agent leaves", () => {
    const store = createTerminalAgentStore();
    const listener = vi.fn();
    store.set("t1", status(), context);
    store.subscribe(listener);
    store.set("t1", null, context);
    store.set("t1", null, context);
    store.remove("t1");
    expect(store.get("t1")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops calling unsubscribed listeners", () => {
    const store = createTerminalAgentStore();
    const listener = vi.fn();
    const transition = vi.fn();
    store.subscribe(listener)();
    store.onTransition(transition)();
    store.set("t1", status(), context);
    expect(listener).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });
});

describe("terminalAgentsForProject", () => {
  const entry = (patch: Partial<TerminalAgentEntry>): TerminalAgentEntry => ({
    ...status(),
    terminalId: "t",
    ...context,
    ...patch,
  });

  it("keeps the project's agents, waiting ones first then newest", () => {
    const entries = [
      entry({ terminalId: "idle", state: "idle", since: 9 }),
      entry({ terminalId: "old", state: "working", since: 1 }),
      entry({ terminalId: "new", state: "working", since: 5 }),
      entry({ terminalId: "ask", state: "blocked", since: 2 }),
      entry({ terminalId: "fin", state: "done", since: 3 }),
      entry({ terminalId: "other", cwd: "/other", state: "blocked" }),
    ];
    const ids = terminalAgentsForProject(entries, (cwd) => cwd, "/repo").map(
      (e) => e.terminalId,
    );
    expect(ids).toEqual(["ask", "new", "old", "fin", "idle"]);
    expect(terminalAgentsForProject(entries, (cwd) => cwd, null)).toEqual([]);
  });
});

describe("terminal targets", () => {
  it("round-trips terminal ids and ignores session ids", () => {
    expect(terminalIdFromTarget(terminalTargetId("abc"))).toBe("abc");
    expect(terminalIdFromTarget("session-1")).toBeUndefined();
    expect(terminalIdFromTarget("terminal:")).toBeUndefined();
  });
});
