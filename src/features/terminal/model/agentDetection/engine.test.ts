import { describe, expect, it } from "vitest";
import {
  detectScreenAgent,
  evaluateRules,
  identifyAgent,
  matches,
  normalizeProcessName,
  type AgentManifest,
} from "./engine";

const region = (text: string) => ({
  text,
  lower: text.toLowerCase(),
  lines: text.split("\n"),
});

const toy: AgentManifest = {
  id: "toy",
  label: "Toy",
  executables: ["toy", "toy-*"],
  titleHints: [/toy agent/i],
  rules: [
    {
      id: "title_busy",
      state: "working",
      priority: 900,
      region: { kind: "title" },
      regex: [/^\* /],
    },
    {
      id: "ask",
      state: "blocked",
      priority: 800,
      region: { kind: "bottom", lines: 2 },
      contains: ["Allow?"],
    },
    {
      id: "busy",
      state: "working",
      priority: 500,
      region: { kind: "screen" },
      lineRegex: [/^thinking/],
    },
  ],
};

describe("normalizeProcessName", () => {
  it("keeps the lowercase basename without script or binary extensions", () => {
    expect(normalizeProcessName("/usr/local/bin/Claude")).toBe("claude");
    expect(normalizeProcessName("C:\\tools\\codex.exe")).toBe("codex");
    expect(normalizeProcessName("cline.cmd --flag")).toBe("cline");
    expect(normalizeProcessName("cli.mjs")).toBe("cli");
  });
});

describe("identifyAgent", () => {
  it("matches executables exactly or by a trailing wildcard", () => {
    expect(identifyAgent([toy], "toy")?.id).toBe("toy");
    expect(identifyAgent([toy], "toy-nightly")?.id).toBe("toy");
    expect(identifyAgent([toy], "toyota")).toBeUndefined();
  });

  it("uses the title only when a generic launcher runs the agent", () => {
    expect(identifyAgent([toy], "node", "Toy Agent — repo")?.id).toBe("toy");
    expect(identifyAgent([toy], "vim", "Toy Agent — repo")).toBeUndefined();
    expect(identifyAgent([toy], "node", "")).toBeUndefined();
    expect(identifyAgent([toy], "cli.js", "Toy Agent")?.id).toBe("toy");
  });

  it("never treats the shell prompt as an agent", () => {
    expect(identifyAgent([toy], null, "Toy Agent")).toBeUndefined();
    expect(identifyAgent([toy], "  ", "Toy Agent")).toBeUndefined();
  });
});

describe("matches", () => {
  it("compares contains needles case-insensitively and requires all of them", () => {
    expect(matches({ contains: ["ESC", "cancel"] }, region("esc to Cancel"))).toBe(true);
    expect(matches({ contains: ["esc", "confirm"] }, region("esc to cancel"))).toBe(false);
  });

  it("applies lineRegex per line and regex to the whole region", () => {
    const text = "first\n> second";
    expect(matches({ lineRegex: [/^> /] }, region(text))).toBe(true);
    expect(matches({ lineRegex: [/^first\n>/] }, region(text))).toBe(false);
    expect(matches({ regex: [/first\n>/] }, region(text))).toBe(true);
  });

  it("combines any, all and not", () => {
    const r = region("approve once · esc cancel");
    expect(matches({ any: [{ contains: ["nope"] }, { contains: ["approve"] }] }, r)).toBe(true);
    expect(matches({ all: [{ contains: ["approve"] }, { contains: ["nope"] }] }, r)).toBe(false);
    expect(matches({ contains: ["approve"], not: [{ contains: ["esc cancel"] }] }, r)).toBe(false);
  });

  it("is stable with global regexes", () => {
    const global = /x/g;
    const r = region("x");
    expect(matches({ regex: [global] }, r)).toBe(true);
    expect(matches({ regex: [global] }, r)).toBe(true);
  });
});

describe("evaluateRules", () => {
  it("lets the highest-priority matching rule win", () => {
    const rule = evaluateRules(toy, {
      process: "toy",
      title: "* busy",
      lines: ["thinking hard", "Allow?"],
    });
    expect(rule?.id).toBe("title_busy");
  });

  it("only looks at the bottom lines a rule asks for", () => {
    const rule = evaluateRules(toy, {
      process: "toy",
      lines: ["Allow?", "thinking", "more output", "and more", "", "   "],
    });
    expect(rule?.id).toBe("busy");
  });

  it("skips empty title regions", () => {
    expect(evaluateRules(toy, { process: "toy", title: "  ", lines: [] })).toBeUndefined();
  });
});

describe("detectScreenAgent", () => {
  it("returns nothing for a terminal without a known agent", () => {
    expect(detectScreenAgent([toy], { process: "bash", lines: ["$"] })).toBeUndefined();
  });

  it("reports the deciding rule", () => {
    expect(
      detectScreenAgent([toy], { process: "toy", lines: ["", "Allow? [y/n]"] }),
    ).toMatchObject({ state: "blocked", ruleId: "ask" });
  });

  it("calls a drawn screen without signals idle and a blank one unknown", () => {
    expect(detectScreenAgent([toy], { process: "toy", lines: ["> "] })?.state).toBe("idle");
    expect(detectScreenAgent([toy], { process: "toy", lines: ["", " "] })?.state).toBe(
      "unknown",
    );
  });
});

describe("detectScreenAgent with a known agent", () => {
  it("keeps an agent found by title once its busy title stops naming it", () => {
    const found = detectScreenAgent([toy], { process: "cli.js", title: "Toy Agent", lines: ["> "] });
    expect(found?.agent.id).toBe("toy");
    expect(
      detectScreenAgent([toy], { process: "cli.js", title: "* fixing", lines: ["> "] }, toy),
    ).toMatchObject({ agent: { id: "toy" }, state: "working" });
    expect(
      detectScreenAgent([toy], { process: null, title: "* fixing", lines: ["$"] }, toy),
    ).toBeUndefined();
  });
});
