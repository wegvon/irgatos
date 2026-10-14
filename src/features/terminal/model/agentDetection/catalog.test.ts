import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERMINAL_AGENT_CATALOG, TERMINAL_AGENT_IDS } from "./catalog";
import { detectScreenAgent, type ScreenSnapshot } from "./engine";

const detect = (snapshot: ScreenSnapshot) =>
  detectScreenAgent(TERMINAL_AGENT_CATALOG, snapshot);

const screen = (process: string, lines: string[], title?: string) =>
  detect({ process, lines, title });

describe("TERMINAL_AGENT_CATALOG", () => {
  it("covers 24 agents with unique ids and executables", () => {
    expect(TERMINAL_AGENT_CATALOG).toHaveLength(24);
    expect(new Set(TERMINAL_AGENT_IDS).size).toBe(24);
    const executables = TERMINAL_AGENT_CATALOG.flatMap((agent) => agent.executables);
    expect(new Set(executables).size).toBe(executables.length);
    for (const exe of executables) expect(exe).toBe(exe.toLowerCase());
  });

  it("gives every agent the shared rules and ranks its blockers above busy hints", () => {
    for (const agent of TERMINAL_AGENT_CATALOG) {
      const ids = agent.rules.map((rule) => rule.id);
      expect(ids).toContain("common_confirm_dialog");
      expect(ids).toContain("common_select_menu");
      expect(ids).toContain("common_interrupt_hint");
      expect(new Set(ids).size).toBe(ids.length);
      const topBlocker = Math.max(
        ...agent.rules.filter((rule) => rule.state === "blocked").map((rule) => rule.priority),
      );
      const screenWorking = agent.rules.filter(
        (rule) => rule.state === "working" && rule.region.kind !== "title",
      );
      for (const rule of screenWorking) {
        expect(rule.priority, `${agent.id}/${rule.id}`).toBeLessThan(topBlocker);
      }
    }
  });

  it("keeps the Apache-2.0 attribution for the adapted herdr manifests", () => {
    const source = readFileSync(new URL("./catalog.ts", import.meta.url), "utf8");
    const header = source.slice(0, source.indexOf("*/"));
    expect(header).toContain("https://github.com/herdrdev/herdr");
    expect(header).toContain("Apache License");
    expect(header).toContain("Changes from the original");
  });

  it("leaves the shell alone even with an agent-looking title", () => {
    expect(screen("zsh", ["✻ Thinking… (esc to interrupt)"], "✳ Claude Code")).toBeUndefined();
  });
});

describe("Claude Code", () => {
  it("is working while a turn streams", () => {
    expect(
      screen("claude", [
        "> fix the failing test",
        "",
        "✻ Pondering… (12s · ↑ 1.2k tokens · esc to interrupt)",
        "",
        "> ",
        "  ? for shortcuts",
      ]),
    ).toMatchObject({ agent: { id: "claude" }, state: "working" });
  });

  it("is working from a spinner title", () => {
    expect(screen("claude", ["> "], "⠂ Editing files")?.state).toBe("working");
  });

  it("is blocked on a permission dialog", () => {
    expect(
      screen("claude", [
        "Bash command",
        "  rm -rf build",
        "Do you want to proceed?",
        "❯ 1. Yes",
        "  2. No, and tell Claude what to do differently (esc)",
      ]),
    ).toMatchObject({ state: "blocked", ruleId: "permission_dialog" });
  });

  it("is idle at its prompt", () => {
    expect(screen("claude", ["╭─────╮", "│ >   │", "╰─────╯", "  ? for shortcuts"])?.state).toBe(
      "idle",
    );
  });

  it("is found through npx by its title", () => {
    expect(screen("node", ["> "], "✳ Claude Code")?.agent.id).toBe("claude");
  });
});

describe("Codex", () => {
  it("is working during a timed turn", () => {
    expect(
      screen("codex", ["• Working (14s • esc to interrupt)", "", "› Ask Codex to do anything"])
        ?.state,
    ).toBe("working");
  });

  it("is blocked on an approval prompt", () => {
    expect(
      screen("codex", [
        "Would you like to run the following command?",
        "  $ npm test",
        "› 1. Yes, proceed (y)",
        "Press enter to confirm or esc to cancel",
      ])?.state,
    ).toBe("blocked");
  });

  it("is blocked when its title asks for action", () => {
    expect(screen("codex", ["› "], "Action Required — codex")?.state).toBe("blocked");
  });
});

describe("Cursor Agent", () => {
  it("is working while generating", () => {
    expect(screen("cursor-agent", ["⬢ Generating", "  ctrl+c to stop"])?.state).toBe("working");
  });

  it("is blocked on a command approval", () => {
    expect(
      screen("cursor-agent", ["Run this command?", "  npm test", "→ Run (y) (enter)", "  Skip (esc or n)"])
        ?.state,
    ).toBe("blocked");
  });
});

describe("other agents", () => {
  it.each([
    ["gemini", ["Apply this change?", "● 1. Yes, allow once"], "blocked"],
    ["gemini", ["⠏ Reticulating splines (esc to cancel, 3s)"], "working"],
    ["opencode", ["△ Permission required", "  bash: ls"], "blocked"],
    ["opencode", ["■■■■⬝⬝⬝⬝  esc interrupt"], "working"],
    ["pi", ["⠋ Working"], "working"],
    ["devin", ["Approve once", "esc cancel"], "blocked"],
    ["cline", ["Let Cline use this tool?", "Yes"], "blocked"],
    ["copilot", ["◎ Waiting for background agents"], "working"],
    ["kimi", ["Apply these edits?", "↵ confirm"], "blocked"],
    ["kiro", ["Kiro is working", "type to steer"], "working"],
    ["kiro", ["> Ask a question or describe a task"], "idle"],
    ["droid", ["> Yes, allow", "enter to select · esc to cancel"], "blocked"],
    ["amp", ["╰ smart  thinking ─────"], "working"],
    ["grok", ["Yes, proceed", "No, reject"], "blocked"],
    ["hermes", ["Hermes needs your answer", "type your answer"], "blocked"],
    ["kilo", ["working... esc interrupt"], "working"],
    ["qodercli", ["Awaiting approval for shell"], "blocked"],
    ["qwen", ["⠋ Thinking (esc to cancel, 4s)"], "working"],
    ["letta", ["Run this command?"], "blocked"],
    ["maki", [" ⠋ [BUILD] writing"], "working"],
    ["maki", [" [PLAN] ready"], "idle"],
    ["muse", ["Do you trust this workspace?"], "blocked"],
    ["mastracode", ["Overwrite config? [y/N]"], "blocked"],
    ["agy", ["Requesting permission for:", "  write file"], "blocked"],
  ] as const)("%s reads %j as %s", (process, lines, state) => {
    expect(screen(process, [...lines])?.state).toBe(state);
  });

  it("reads the title spinners agents set", () => {
    expect(screen("amp", ["> "], "⠋ refactor - amp - repo")?.state).toBe("working");
    expect(screen("amp", ["> "], "Plugin confirmation needed")?.state).toBe("blocked");
    expect(screen("hermes", ["> "], "⏳ hermes")?.state).toBe("working");
    expect(screen("hermes", ["> "], "⚠️ hermes")?.state).toBe("blocked");
    expect(screen("qwen", ["> "], "◐ qwen")?.state).toBe("working");
    expect(screen("letta", ["> "], "[ ! ] Action Required")?.state).toBe("blocked");
  });

  it("lets a dialog over a live status line count as blocked", () => {
    expect(
      screen("gemini", ["Allow execution of: rm?", "enter to select · esc to cancel"])?.state,
    ).toBe("blocked");
  });
});
