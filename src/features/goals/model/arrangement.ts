/**
 * Before the first message: the user describes the outcome, and Irgatos
 * suggests how to run it (one agent, plan first, or a team of agents; in the
 * project folder or a separate worktree) with the reason in a sentence. The
 * provider, model, mode and worktree controls stay where they are for anyone
 * who wants to pick them by hand.
 */

export type ArrangementMode = "direct" | "plan" | "orchestrate";

export type Arrangement = {
  mode: ArrangementMode;
  worktree: boolean;
  /** "Plan first · own worktree". */
  title: string;
  /** Why this setup helps, in a sentence. */
  benefit: string;
};

export type ArrangementOptions = {
  canPlan?: boolean;
  canOrchestrate?: boolean;
  /** A worktree can be made for this project. */
  canWorktree?: boolean;
};

const MIN_WORDS = 4;
const LONG_WORDS = 70;

const QUESTION = /^(?:what|why|how|where|when|which|who|can you explain|explain|tell me|show me|summari[sz]e|review|look at|check|find out|is there|are there|does|do we|should)\b/i;
const SMALL = /\b(?:typo|rename|bump|tweak|small|tiny|quick|one[- ]line|wording|copy change|fix (?:the|a) (?:typo|label|link|color|colour))\b/i;
const BIG = /\b(?:refactor|redesign|rewrite|re-?architect|architecture|migrat(?:e|ion)|overhaul|new (?:feature|screen|page|view|system|module)|from scratch|end[- ]to[- ]end|integrat(?:e|ion)|implement|build (?:a|an|the)|add support)\b/i;
const SPREAD = /\b(?:across (?:the|all|every)|each of|every (?:screen|page|module|service|package)|all (?:the )?(?:screens|pages|modules|services|packages|endpoints))\b/i;

/** Separate parts: list items, or "1) … 2) …", or "; " joined asks. */
export function workParts(text: string): number {
  const items = text
    .split("\n")
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;
  if (items) return items;
  const inline = text.match(/(?:^|\s)\d+[.)]\s+\S/g)?.length ?? 0;
  return inline;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function title(mode: ArrangementMode, worktree: boolean): string {
  const how = mode === "orchestrate" ? "Team of agents" : mode === "plan" ? "Plan first" : "One agent";
  return worktree ? `${how} · own worktree` : how;
}

export function recommendArrangement(
  text: string,
  options: ArrangementOptions = {},
): Arrangement | undefined {
  const trimmed = text.trim();
  if (words(trimmed) < MIN_WORDS || trimmed.startsWith("/")) return undefined;
  const firstLine = trimmed.split("\n")[0];
  // A question or a look-around only reads: nothing to arrange.
  if (QUESTION.test(firstLine) || (/\?\s*$/.test(trimmed) && !BIG.test(trimmed))) return undefined;

  const worktree = !!options.canWorktree;
  const parts = workParts(trimmed);
  if (options.canOrchestrate && (parts >= 3 || (SPREAD.test(trimmed) && BIG.test(trimmed)))) {
    return {
      mode: "orchestrate",
      worktree,
      title: title("orchestrate", worktree),
      benefit: worktree
        ? "It splits into separate parts, so agents can work on them side by side, each in its own worktree, and one lead checks the result."
        : "It splits into separate parts, so agents can work on them side by side and one lead checks the result.",
    };
  }
  if (options.canPlan && (BIG.test(trimmed) || words(trimmed) >= LONG_WORDS || parts >= 2)) {
    return {
      mode: "plan",
      worktree,
      title: title("plan", worktree),
      benefit: worktree
        ? "A bigger change: agree on the approach before code is written, and keep it in a separate worktree so your folder stays usable."
        : "A bigger change: agree on the approach before code is written.",
    };
  }
  if (SMALL.test(trimmed) || words(trimmed) < 25) {
    return {
      mode: "direct",
      worktree: false,
      title: title("direct", false),
      benefit: "A focused change: one agent does it straight away, in this folder.",
    };
  }
  return {
    mode: "direct",
    worktree,
    title: title("direct", worktree),
    benefit: worktree
      ? "One agent can do this; a separate worktree keeps your folder free while it works."
      : "One agent can do this straight away.",
  };
}

/** The suggestion only shows when it would change something. */
export function differsFromCurrent(
  arrangement: Arrangement,
  current: { mode: ArrangementMode; worktree: boolean },
): boolean {
  return arrangement.mode !== current.mode || (arrangement.worktree && !current.worktree);
}
