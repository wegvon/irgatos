/*
 * Screen-state rules for coding agents run in a raw terminal.
 *
 * Adapted from the agent detection manifests of herdr
 * (https://github.com/herdrdev/herdr, src/detect/manifests/*.toml),
 * Copyright (c) herdr contributors, licensed under the Apache License,
 * Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
 *
 * Changes from the original: rewritten as TypeScript data for this app's
 * matcher (`engine.ts`), regions reduced to title / bottom lines / screen,
 * rules condensed to the visible signals that mark a working turn, an
 * approval or question waiting on the user, and an idle prompt; entries
 * added for omp and mastracode. This file is distributed under the Apache
 * License 2.0; the rest of the project keeps its own license.
 */

import type { AgentManifest, ScreenRule } from "./engine";

const TITLE_SPINNER = /^[\u2800-\u28FF\u25D0-\u25D3] /u;
const DOTS_SPINNER = /(?:^| )[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏](?: |$)/u;

/**
 * Approval and question screens most CLIs draw the same way. They outrank
 * every agent's busy hints, since a dialog can sit above a live status line.
 */
const COMMON_BLOCKERS: readonly ScreenRule[] = [
  {
    id: "common_confirm_dialog",
    state: "blocked",
    priority: 850,
    region: { kind: "bottom", lines: 16 },
    any: [
      { contains: ["do you want to proceed?"] },
      { contains: ["waiting for user confirmation"] },
      { contains: ["waiting for approval"] },
      { contains: ["permission required"] },
      { contains: ["allow once"] },
      { lineRegex: [/\[y\/n\]\s*$/i] },
    ],
  },
  {
    id: "common_select_menu",
    state: "blocked",
    priority: 840,
    region: { kind: "bottom", lines: 8 },
    any: [
      { contains: ["enter to confirm", "esc to cancel"] },
      { contains: ["enter to select", "esc to cancel"] },
      { contains: ["enter confirm", "esc cancel"] },
    ],
  },
];

/** Busy hints shared by many CLIs. */
const COMMON_WORKING: readonly ScreenRule[] = [
  {
    id: "common_interrupt_hint",
    state: "working",
    priority: 400,
    region: { kind: "bottom", lines: 8 },
    any: [
      { contains: ["esc to interrupt"] },
      { contains: ["esc to cancel"] },
      { contains: ["ctrl+c to interrupt"] },
      { contains: ["ctrl+c to stop"] },
      { contains: ["esc to stop"] },
    ],
  },
  {
    id: "common_spinner_line",
    state: "working",
    priority: 300,
    region: { kind: "bottom", lines: 6 },
    lineRegex: [/^\s*[\u2800-\u28FF]+\s+\p{L}+\w*(?:ing|…|\.\.\.)/u],
  },
];

function withCommon(rules: readonly ScreenRule[]): readonly ScreenRule[] {
  return [...rules, ...COMMON_BLOCKERS, ...COMMON_WORKING];
}

export const TERMINAL_AGENT_CATALOG: readonly AgentManifest[] = [
  {
    id: "claude",
    label: "Claude Code",
    executables: ["claude", "claude-code"],
    titleHints: [/claude code/i, /^✳ /u],
    rules: withCommon([
      {
        id: "transcript_viewer",
        state: "unknown",
        priority: 1000,
        region: { kind: "bottom", lines: 3 },
        contains: ["showing detailed transcript"],
      },
      {
        id: "permission_dialog",
        state: "blocked",
        priority: 990,
        region: { kind: "bottom", lines: 24 },
        any: [
          { contains: ["do you want"], any: [{ contains: ["❯"] }, { contains: ["1. yes"] }] },
          { contains: ["esc to cancel"], any: [{ contains: ["tab to amend"] }, { contains: ["ctrl+e to explain"] }] },
          { contains: ["enter to select"], any: [{ contains: ["to navigate"] }] },
          { lineRegex: [/requests your input\s*$/i] },
        ],
      },
      {
        id: "title_working",
        state: "working",
        priority: 980,
        region: { kind: "title" },
        regex: [TITLE_SPINNER],
      },
      {
        id: "live_turn",
        state: "working",
        priority: 970,
        region: { kind: "bottom", lines: 12 },
        any: [
          { lineRegex: [/^\s*[⏸⏵].*esc to interrupt/u] },
          { lineRegex: [/^\s*[*·✢✳✶✻✽]\s+\S.*…(?:\s+\(\d+[smh]|\s*$)/u] },
          { lineRegex: [/Waiting for [1-9]\d* background agents? to finish/] },
        ],
      },
    ]),
  },
  {
    id: "codex",
    label: "Codex",
    executables: ["codex"],
    titleHints: [/\bcodex\b/i],
    rules: withCommon([
      {
        id: "title_blocked",
        state: "blocked",
        priority: 1100,
        region: { kind: "title" },
        contains: ["Action Required"],
      },
      {
        id: "title_working",
        state: "working",
        priority: 1050,
        region: { kind: "title" },
        regex: [DOTS_SPINNER],
      },
      {
        id: "trust_directory",
        state: "blocked",
        priority: 950,
        region: { kind: "screen" },
        any: [
          { regex: [/Do\s+you\s+trust\s+the\s+contents\s+of\s+this\s+directory\?/] },
          { contains: ["Trust this folder?"] },
        ],
      },
      {
        id: "approval_prompt",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 20 },
        any: [
          { contains: ["press enter to confirm or esc to cancel"] },
          { contains: ["enter to submit answer"] },
          { contains: ["allow command?"] },
          { contains: ["would you like to run the following command?"] },
          { contains: ["would you like to make the following edits?"] },
          { contains: ["yes (y)"] },
        ],
      },
      {
        id: "turn_timer",
        state: "working",
        priority: 500,
        region: { kind: "bottom", lines: 10 },
        any: [
          { contains: ["esc to interrupt)"] },
          { lineRegex: [/\((?:\d+[hm] )*\d+s(?: • [^)]*to interrupt)?\)/] },
        ],
        not: [{ contains: ["Reconnect failed"] }],
      },
    ]),
  },
  {
    id: "cursor",
    label: "Cursor Agent",
    executables: ["cursor-agent", "cursor"],
    rules: withCommon([
      {
        id: "write_file_approval",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 8 },
        contains: ["write to this file?"],
      },
      {
        id: "approval_prompt",
        state: "blocked",
        priority: 880,
        region: { kind: "bottom", lines: 16 },
        any: [
          { contains: ["run this command?"] },
          { contains: ["(y) (enter)"] },
          { contains: ["skip (esc or n)"] },
          { contains: ["keep (n)"] },
          { lineRegex: [/^\s*(?:→\s*)?(?:run|allow) .*\(y\)/i] },
        ],
      },
      {
        id: "stop_hint",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 6 },
        any: [
          { contains: ["ctrl+c to stop"] },
          { lineRegex: [/\b[1-9]\d*\s+background\s+tasks?\b/i] },
          { lineRegex: [/^\s*(?:⬡|⬢|[\u2800-\u28FF]+)\s+\p{L}+\w*ing\b/u] },
        ],
      },
    ]),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    executables: ["gemini"],
    titleHints: [/gemini/i],
    rules: withCommon([
      {
        id: "apply_or_allow",
        state: "blocked",
        priority: 900,
        region: { kind: "screen" },
        any: [
          { contains: ["Apply this change"] },
          { contains: ["Allow execution"] },
          { lineRegex: [/^\s*[│|]?\s*❯.*\b(?:yes|allow)\b/i] },
        ],
      },
      {
        id: "esc_cancel",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 10 },
        contains: ["esc to cancel"],
      },
    ]),
  },
  {
    id: "opencode",
    label: "OpenCode",
    executables: ["opencode", "opencode2", "open-code"],
    titleHints: [/opencode/i],
    rules: withCommon([
      {
        id: "permission_required",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 20 },
        any: [
          { contains: ["△ Permission required"] },
          {
            contains: ["esc dismiss"],
            any: [{ contains: ["enter confirm"] }, { contains: ["enter submit"] }],
          },
        ],
      },
      {
        id: "interrupt_hint",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 10 },
        any: [
          { contains: ["esc to interrupt"] },
          { contains: ["esc interrupt"] },
          { regex: [/(?:■|⬝){4,}/u] },
        ],
      },
    ]),
  },
  {
    id: "pi",
    label: "Pi",
    executables: ["pi"],
    rules: withCommon([
      {
        id: "working_literal",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 12 },
        any: [
          { contains: ["Working..."] },
          { lineRegex: [/^(?:── )?[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Working(?: ─+)?$/u] },
        ],
      },
    ]),
  },
  {
    id: "omp",
    label: "omp",
    executables: ["omp"],
    rules: withCommon([
      {
        id: "working_literal",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 12 },
        any: [
          { contains: ["Working..."] },
          { lineRegex: [/^(?:── )?[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Working(?: ─+)?$/u] },
        ],
      },
    ]),
  },
  {
    id: "mastracode",
    label: "MastraCode",
    executables: ["mastracode", "mastra-code"],
    rules: withCommon([]),
  },
  {
    id: "devin",
    label: "Devin",
    executables: ["devin", "devin-cli"],
    rules: withCommon([
      {
        id: "approve_once",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        contains: ["approve once", "esc cancel"],
      },
      {
        id: "running_tools",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 10 },
        any: [
          { contains: ["running tools", "esc to interrupt"] },
          { contains: ["guide devin while it works"] },
        ],
      },
    ]),
  },
  {
    id: "agy",
    label: "Antigravity",
    executables: ["agy", "antigravity", "antigravity-cli"],
    rules: withCommon([
      {
        id: "permission",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 20 },
        any: [
          { contains: ["requesting permission for:"] },
          { contains: ["navigate", "tab amend"] },
          { contains: ["navigate", "esc skip"] },
          { contains: ["do you trust the contents of this project?"] },
        ],
      },
      {
        id: "esc_cancel_rule",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 8 },
        any: [
          { lineRegex: [/^\s*─{3,}\s*esc to cancel\b/u] },
          { lineRegex: [/^\s*[\u2801-\u28FF]+\s+\S/u] },
        ],
      },
    ]),
  },
  {
    id: "cline",
    label: "Cline",
    executables: ["cline", ".cline"],
    rules: withCommon([
      {
        id: "tool_permission",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 24 },
        any: [
          { contains: ["let cline use this tool"] },
          { contains: ["execute command?", "yes"] },
          { contains: ["use this tool?", "yes"] },
          { contains: ["Approve tool call?"] },
          { lineRegex: [/^\s*Cline is asking a question\s*$/] },
        ],
      },
      {
        id: "active_turn",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 20 },
        any: [
          { lineRegex: [/^\s*[\u2801-\u28FF]\s+\S/u] },
          { contains: ["Thinking... (esc to cancel)"] },
        ],
      },
    ]),
  },
  {
    id: "copilot",
    label: "GitHub Copilot CLI",
    executables: ["copilot", "github-copilot", "ghcs"],
    rules: withCommon([
      {
        id: "background_agents",
        state: "working",
        priority: 830,
        region: { kind: "bottom", lines: 6 },
        lineRegex: [/^\s*◎\s+Waiting for background agents/u],
      },
      {
        id: "selection",
        state: "blocked",
        priority: 850,
        region: { kind: "bottom", lines: 12 },
        any: [{ contains: ["enter to select"] }, { contains: ["enter to confirm"] }, { contains: ["enter accept"] }],
        not: [{ contains: ["esc again to cancel"] }],
      },
    ]),
  },
  {
    id: "kimi",
    label: "Kimi Code",
    executables: ["kimi", "kimi-code"],
    rules: withCommon([
      {
        id: "confirm",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        any: [
          { contains: ["↵ confirm"] },
          { contains: ["run this command?"] },
          { contains: ["write this file?"] },
          { contains: ["apply these edits?"] },
          { contains: ["ready to build with this plan?"] },
          { lineRegex: [/^\s*question\s*$/i, /^\s*\? /] },
        ],
      },
    ]),
  },
  {
    id: "kiro",
    label: "Kiro",
    executables: ["kiro", "kiro-cli"],
    rules: withCommon([
      {
        id: "requires_approval",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        any: [
          { regex: [/requires\s+approval/i] },
          { contains: ["to navigate", "to submit", "esc to cancel"] },
        ],
      },
      {
        id: "working",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 8 },
        any: [{ contains: ["kiro is working"] }, { contains: ["type to steer"] }],
      },
      {
        id: "prompt",
        state: "idle",
        priority: 700,
        region: { kind: "bottom", lines: 4 },
        lineRegex: [/^\s*[>›]\s*ask a question or describe a task/i],
      },
    ]),
  },
  {
    id: "droid",
    label: "Droid",
    executables: ["droid"],
    rules: withCommon([
      {
        id: "selection",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 12 },
        any: [
          { contains: ["enter to select", "esc to cancel"] },
          { contains: ["enter select", "esc cancel"] },
          { contains: ["> yes, allow"] },
        ],
      },
      {
        id: "stop_hint",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 10 },
        contains: ["esc to stop"],
      },
    ]),
  },
  {
    id: "amp",
    label: "Amp",
    executables: ["amp", "amp-local"],
    titleHints: [/ - amp - /i],
    rules: withCommon([
      {
        id: "title_plugin_confirmation",
        state: "blocked",
        priority: 1100,
        region: { kind: "title" },
        contains: ["Plugin confirmation needed"],
      },
      {
        id: "title_working",
        state: "working",
        priority: 1050,
        region: { kind: "title" },
        regex: [TITLE_SPINNER],
      },
      {
        id: "approval_footer",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        any: [
          { contains: ["invoke tool"] },
          { contains: ["run this command?"] },
          { contains: ["allow editing file:"] },
          { contains: ["allow creating file:"] },
          { contains: ["confirm tool call"] },
        ],
      },
      {
        id: "status_footer",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 5 },
        lineRegex: [/^\s*╰\s+\S+\s+(?:thinking|streaming|running tools|waiting)\s+─/iu],
      },
    ]),
  },
  {
    id: "grok",
    label: "Grok",
    executables: ["grok", "grok-build"],
    rules: withCommon([
      {
        id: "title_blocked",
        state: "blocked",
        priority: 1100,
        region: { kind: "title" },
        contains: ["Action Required"],
      },
      {
        id: "permission",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        any: [
          { contains: ["yes, proceed", "no, reject"] },
          { contains: ["ctrl+o:yolo", "ctrl+c:cancel"] },
          { contains: ["←/→:scope"] },
        ],
      },
    ]),
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    executables: ["hermes", "hermes-agent"],
    rules: withCommon([
      {
        id: "title_blocked",
        state: "blocked",
        priority: 1100,
        region: { kind: "title" },
        regex: [/^⚠[\uFE0E\uFE0F]?(?:\s|$)/u],
      },
      {
        id: "title_working",
        state: "working",
        priority: 1050,
        region: { kind: "title" },
        regex: [/^⏳[\uFE0E\uFE0F]?(?:\s|$)/u],
      },
      {
        id: "approval",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        any: [
          { contains: ["allow once", "deny"] },
          { contains: ["hermes needs your"] },
          { contains: ["type your answer"] },
        ],
      },
    ]),
  },
  {
    id: "kilo",
    label: "Kilo Code",
    executables: ["kilo", "kilo-code", "kilocode"],
    rules: withCommon([
      {
        id: "permission",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 20 },
        any: [
          { contains: ["△ Permission required"] },
          { contains: ["esc dismiss"], any: [{ contains: ["enter confirm"] }, { contains: ["enter submit"] }] },
        ],
      },
      {
        id: "esc_interrupt",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 10 },
        contains: ["esc interrupt"],
      },
    ]),
  },
  {
    id: "qodercli",
    label: "Qoder CLI",
    executables: ["qodercli", "qoder", "qoderclicn", "qodercn"],
    rules: withCommon([
      {
        id: "confirmation",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 20 },
        any: [
          { contains: ["awaiting approval"] },
          { contains: ["allow once or always?"] },
          { contains: ["asking user"] },
          { contains: ["enter your response"] },
          { contains: ["shell awaiting input"] },
        ],
      },
      {
        id: "cancel_hint",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 10 },
        contains: ["(esc to cancel,"],
      },
    ]),
  },
  {
    id: "qwen",
    label: "Qwen Code",
    executables: ["qwen", "qwen-code"],
    titleHints: [/qwen/i],
    rules: withCommon([
      {
        id: "title_blocked",
        state: "blocked",
        priority: 1100,
        region: { kind: "title" },
        regex: [/^\u2733\uFE0E? /u],
      },
      {
        id: "title_working",
        state: "working",
        priority: 1050,
        region: { kind: "title" },
        regex: [/^\u25D0\uFE0E? /u],
      },
      {
        id: "spinner_working",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 10 },
        lineRegex: [/^\s*[\u2800-\u28FF]\s+.*\(esc to cancel/u],
      },
    ]),
  },
  {
    id: "letta",
    label: "Letta Code",
    executables: ["letta", "letta-code"],
    rules: withCommon([
      {
        id: "title_blocked",
        state: "blocked",
        priority: 1100,
        region: { kind: "title" },
        regex: [/^\[ [!.] \] Action Required/],
      },
      {
        id: "title_working",
        state: "working",
        priority: 1050,
        region: { kind: "title" },
        regex: [DOTS_SPINNER],
      },
      {
        id: "run_command",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        contains: ["Run this command?"],
      },
      {
        id: "running",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 8 },
        any: [
          { lineRegex: [/… \((?:esc to interrupt|interrupting)/u] },
          { lineRegex: [/^\s*(?:└\s*)?Running\.\.\./u] },
        ],
      },
    ]),
  },
  {
    id: "maki",
    label: "Maki",
    executables: ["maki"],
    rules: withCommon([
      {
        id: "permission",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 16 },
        any: [
          { contains: ["y allow", "n deny"] },
          { contains: ["plan complete", "enter confirm"] },
        ],
      },
      {
        id: "mode_spinner",
        state: "working",
        priority: 800,
        region: { kind: "bottom", lines: 4 },
        lineRegex: [/^(?: [\u2800-\u28FF]){1,2} \[(?:BUILD|PLAN|BASH)\]/u],
      },
      {
        id: "mode_idle",
        state: "idle",
        priority: 700,
        region: { kind: "bottom", lines: 4 },
        lineRegex: [/^ \[(?:BUILD|PLAN|BASH)\]/],
      },
    ]),
  },
  {
    id: "muse",
    label: "Muse",
    executables: ["muse", "muse-code", "muse-cli", "muse-*"],
    rules: withCommon([
      {
        id: "trust_or_question",
        state: "blocked",
        priority: 900,
        region: { kind: "bottom", lines: 20 },
        any: [
          { contains: ["Do you trust this workspace?"] },
          { contains: ["Enter to select", "Tab for an optional note"] },
        ],
      },
    ]),
  },
];

export const TERMINAL_AGENT_IDS = TERMINAL_AGENT_CATALOG.map((agent) => agent.id);
