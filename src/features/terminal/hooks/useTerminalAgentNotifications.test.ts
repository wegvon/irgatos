import { describe, expect, it } from "vitest";
import { terminalAgentNotificationText } from "../../notifications/model/notifications";
import type { TerminalAgentEntry } from "../model/agentDetection/terminalAgentStore";
import type { TerminalAgentState } from "../model/agentDetection/tracker";
import { terminalAgentNotice } from "./useTerminalAgentNotifications";

const entry = (state: TerminalAgentState): TerminalAgentEntry => ({
  terminalId: "t1",
  agentId: "codex",
  agentLabel: "Codex",
  state,
  since: 1,
  cwd: "/repo",
  tabLabel: "codex",
  seen: false,
});

describe("terminalAgentNotice", () => {
  it("announces an agent that starts waiting on the user", () => {
    for (const from of [null, "working", "idle", "done"] as const) {
      expect(terminalAgentNotice({ entry: entry("blocked"), from })).toEqual({
        targetId: "terminal:t1",
        cwd: "/repo",
        tabLabel: "codex",
        agentLabel: "Codex",
        event: "blocked",
      });
    }
  });

  it("announces a finished turn only when it was seen working", () => {
    expect(terminalAgentNotice({ entry: entry("done"), from: "working" })?.event).toBe("done");
    expect(terminalAgentNotice({ entry: entry("done"), from: null })).toBeNull();
  });

  it("stays quiet for working and idle", () => {
    expect(terminalAgentNotice({ entry: entry("working"), from: "idle" })).toBeNull();
    expect(terminalAgentNotice({ entry: entry("idle"), from: "blocked" })).toBeNull();
    expect(terminalAgentNotice({ entry: entry("blocked"), from: "blocked" })).toBeNull();
  });
});

describe("terminalAgentNotificationText", () => {
  it("names the agent and the terminal tab", () => {
    const blocked = terminalAgentNotificationText({
      targetId: "terminal:t1",
      cwd: "/repo",
      tabLabel: "zsh",
      agentLabel: "Claude Code",
      event: "blocked",
    });
    expect(blocked.subtitle).toBe("Claude Code · zsh");
    expect(blocked.body).toContain("waiting for your approval or answer");
    const done = terminalAgentNotificationText({
      targetId: "terminal:t1",
      cwd: "/repo",
      tabLabel: "zsh",
      agentLabel: "Claude Code",
      event: "done",
    });
    expect(done.body).toBe("Claude Code finished in the terminal");
  });
});
