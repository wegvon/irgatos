import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalAgentStrip } from "../../kanban/ui/KanbanView";
import type { TerminalAgentEntry } from "../model/agentDetection/terminalAgentStore";
import { TerminalAgentPill, terminalAgentTitle } from "./TerminalAgentBadge";

describe("TerminalAgentPill", () => {
  it("labels working, blocked and done agents", () => {
    const blocked = renderToStaticMarkup(
      createElement(TerminalAgentPill, {
        entry: { agentLabel: "Claude Code", state: "blocked" },
      }),
    );
    expect(blocked).toContain('data-terminal-agent-state="blocked"');
    expect(blocked).toContain('role="status"');
    expect(blocked).toContain("Needs input");
    expect(blocked).toContain('aria-label="Claude Code — Needs input"');
    expect(
      renderToStaticMarkup(
        createElement(TerminalAgentPill, { entry: { agentLabel: "Codex", state: "done" } }),
      ),
    ).toContain("Done");
  });

  it("shrinks idle and compact agents to a dot", () => {
    const idle = renderToStaticMarkup(
      createElement(TerminalAgentPill, { entry: { agentLabel: "Codex", state: "idle" } }),
    );
    expect(idle).not.toContain(">Idle<");
    expect(idle).toContain('title="Codex — Idle"');
    const compact = renderToStaticMarkup(
      createElement(TerminalAgentPill, {
        entry: { agentLabel: "Codex", state: "working" },
        compact: true,
      }),
    );
    expect(compact).not.toContain("Working<");
  });

  it("titles the agent and its state", () => {
    expect(terminalAgentTitle({ agentLabel: "Amp", state: "working" })).toBe("Amp — Working");
  });
});

describe("TerminalAgentStrip", () => {
  it("lists terminal agents with their tab and state", () => {
    const agents: TerminalAgentEntry[] = [
      {
        terminalId: "t1",
        agentId: "claude",
        agentLabel: "Claude Code",
        state: "blocked",
        since: 1,
        cwd: "/repo",
        tabLabel: "claude",
        seen: false,
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(TerminalAgentStrip, { agents, onOpen: () => {} }),
    );
    expect(markup).toContain('aria-label="Agents running in terminals"');
    expect(markup).toContain('data-terminal-agent="t1"');
    expect(markup).toContain("Claude Code · claude");
    expect(markup).toContain("Needs input");
    expect(markup).not.toContain(`disabled=""`);
  });

  it("disables the buttons without a way to open terminals", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminalAgentStrip, {
        agents: [
          {
            terminalId: "t1",
            agentId: "codex",
            agentLabel: "Codex",
            state: "working",
            since: 1,
            cwd: "/repo",
            tabLabel: "zsh",
            seen: false,
          },
        ],
      }),
    );
    expect(markup).toContain(`disabled=""`);
  });
});
