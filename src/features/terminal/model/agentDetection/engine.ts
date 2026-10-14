/**
 * Reads which coding agent owns a raw terminal and what it is doing from the
 * live screen. The rules are data (see `catalog.ts`); this file only knows
 * how to evaluate them.
 */

/** What the screen says right now. `unknown`: an agent, but no clear signal. */
export type ScreenAgentState = "working" | "blocked" | "idle" | "unknown";

export type ScreenRegion =
  /** The OSC 0/2 window title the program set. */
  | { kind: "title" }
  /** The last `lines` non-empty lines of the live screen. */
  | { kind: "bottom"; lines: number }
  /** Every non-empty line of the live screen. */
  | { kind: "screen" };

/**
 * Every listed condition must hold. `contains` needles are matched
 * case-insensitively, `regex` against the region as one text, and each
 * `lineRegex` must match at least one line on its own.
 */
export type ScreenMatcher = {
  contains?: readonly string[];
  regex?: readonly RegExp[];
  lineRegex?: readonly RegExp[];
  any?: readonly ScreenMatcher[];
  all?: readonly ScreenMatcher[];
  not?: readonly ScreenMatcher[];
};

export type ScreenRule = ScreenMatcher & {
  id: string;
  state: ScreenAgentState;
  /** Higher wins when several rules match. */
  priority: number;
  region: ScreenRegion;
};

export type AgentManifest = {
  id: string;
  label: string;
  /** Foreground process names that identify the agent, lowercase. */
  executables: readonly string[];
  /** Window titles that identify the agent when the process name is generic. */
  titleHints?: readonly RegExp[];
  rules: readonly ScreenRule[];
};

export type ScreenSnapshot = {
  /** Foreground process label, or null while the shell owns the terminal. */
  process?: string | null;
  title?: string;
  /** Live screen rows, top to bottom; scrollback the user moved to is not here. */
  lines: readonly string[];
};

export type ScreenDetection = {
  agent: AgentManifest;
  state: ScreenAgentState;
  /** The rule that decided, for debugging catalogs. */
  ruleId?: string;
};

/**
 * Launchers that hand off to the real CLI, so their name says nothing. The
 * pty reports `node …/cli.js` as `cli.js`, hence the entry-script names.
 */
const GENERIC_LAUNCHERS = new Set([
  "cli",
  "index",
  "main",
  "node",
  "nodejs",
  "npx",
  "bunx",
  "bun",
  "deno",
  "pnpm",
  "pnpx",
  "yarn",
  "uv",
  "uvx",
  "python",
  "python3",
  "pipx",
]);

export function normalizeProcessName(process: string): string {
  const first = process.trim().split(/\s+/)[0] ?? "";
  const base = first.split(/[\\/]/).pop() ?? "";
  return base.toLowerCase().replace(/\.(?:js|mjs|cjs|cmd|exe|ps1|sh)$/, "");
}

/**
 * The agent a terminal is running, from its foreground process and, for
 * launchers like `npx`, its title. A shell in the foreground is never an
 * agent, whatever its title says.
 */
export function identifyAgent(
  catalog: readonly AgentManifest[],
  process: string | null | undefined,
  title = "",
): AgentManifest | undefined {
  if (!process?.trim()) return undefined;
  const name = normalizeProcessName(process);
  const byName = catalog.find((agent) =>
    agent.executables.some(
      (exe) => exe === name || (exe.endsWith("*") && name.startsWith(exe.slice(0, -1))),
    ),
  );
  if (byName) return byName;
  if (!GENERIC_LAUNCHERS.has(name) || !title.trim()) return undefined;
  return catalog.find((agent) =>
    agent.titleHints?.some((hint) => hint.test(title)),
  );
}

type Region = { text: string; lower: string; lines: readonly string[] };

function nonEmpty(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/\s+$/, "")).filter((line) => line.trim());
}

function regionOf(
  region: ScreenRegion,
  snapshot: ScreenSnapshot,
  screen: readonly string[],
): Region {
  const lines =
    region.kind === "title"
      ? snapshot.title?.trim()
        ? [snapshot.title.trim()]
        : []
      : region.kind === "bottom"
        ? screen.slice(-region.lines)
        : screen;
  const text = lines.join("\n");
  return { text, lower: text.toLowerCase(), lines };
}

function test(regex: RegExp, text: string): boolean {
  regex.lastIndex = 0;
  return regex.test(text);
}

export function matches(matcher: ScreenMatcher, region: Region): boolean {
  if (
    matcher.contains &&
    !matcher.contains.every((needle) => region.lower.includes(needle.toLowerCase()))
  ) {
    return false;
  }
  if (matcher.regex && !matcher.regex.every((regex) => test(regex, region.text))) {
    return false;
  }
  if (
    matcher.lineRegex &&
    !matcher.lineRegex.every((regex) => region.lines.some((line) => test(regex, line)))
  ) {
    return false;
  }
  if (matcher.any && !matcher.any.some((inner) => matches(inner, region))) return false;
  if (matcher.all && !matcher.all.every((inner) => matches(inner, region))) return false;
  if (matcher.not && matcher.not.some((inner) => matches(inner, region))) return false;
  return true;
}

/** The highest-priority rule the screen satisfies, if any. */
export function evaluateRules(
  agent: AgentManifest,
  snapshot: ScreenSnapshot,
): ScreenRule | undefined {
  const screen = nonEmpty(snapshot.lines);
  const regions = new Map<string, Region>();
  const ordered = [...agent.rules].sort((a, b) => b.priority - a.priority);
  for (const rule of ordered) {
    const key =
      rule.region.kind === "bottom" ? `bottom:${rule.region.lines}` : rule.region.kind;
    let region = regions.get(key);
    if (!region) {
      region = regionOf(rule.region, snapshot, screen);
      regions.set(key, region);
    }
    if (!region.lines.length) continue;
    if (matches(rule, region)) return rule;
  }
  return undefined;
}

/**
 * The agent in the terminal and its state. An identified agent whose screen
 * matches no rule is `idle` once it has drawn something: every catalog entry
 * describes its busy and waiting screens, so silence means its prompt.
 */
export function detectScreenAgent(
  catalog: readonly AgentManifest[],
  snapshot: ScreenSnapshot,
  /**
   * The agent already identified for this same foreground process. A busy
   * title (a spinner and the task) no longer names an agent launched by `node`.
   */
  known?: AgentManifest,
): ScreenDetection | undefined {
  if (!snapshot.process?.trim()) return undefined;
  const agent = identifyAgent(catalog, snapshot.process, snapshot.title) ?? known;
  if (!agent) return undefined;
  const rule = evaluateRules(agent, snapshot);
  if (rule) return { agent, state: rule.state, ruleId: rule.id };
  const drawn = snapshot.lines.some((line) => line.trim());
  return { agent, state: drawn ? "idle" : "unknown" };
}
