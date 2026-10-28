import type { Block } from "../../sessions/model/session";

/**
 * Completion criteria: a few plain sentences saying when a goal is done,
 * written by the agent before it starts and checked by it when it delivers.
 * The agent writes them as tagged lists in its reply; the chat shows them as
 * readable lists and the goal keeps them.
 */

export type CriterionVerdict = "met" | "unmet" | "unverified";

export type GoalCriterion = {
  text: string;
  verdict?: CriterionVerdict;
  /** What the agent pointed to for its verdict. */
  evidence?: string;
};

export const MAX_CRITERIA = 8;
const MAX_CRITERION_CHARS = 300;

const CRITERIA_TAG = "completion_criteria";
const CHECK_TAG = "criteria_check";

function lastTagBody(text: string, tag: string): string | undefined {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const end = text.lastIndexOf(close);
  if (end < 0) return undefined;
  const start = text.lastIndexOf(open, end);
  if (start < 0) return undefined;
  return text.slice(start + open.length, end);
}

function listItems(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

function clip(text: string): string {
  return text.length > MAX_CRITERION_CHARS
    ? `${text.slice(0, MAX_CRITERION_CHARS - 1)}…`
    : text;
}

/** The criteria a reply set out, when it has a finished list of them. */
export function parseCriteria(text: string): string[] | undefined {
  const body = lastTagBody(text, CRITERIA_TAG);
  if (body == null) return undefined;
  const items = listItems(body).slice(0, MAX_CRITERIA).map(clip);
  return items.length ? items : undefined;
}

const VERDICT = /^\[(met|unmet|unverified|x| |~|\?)\]\s*/i;

function verdictOf(mark: string): CriterionVerdict {
  const value = mark.toLowerCase();
  if (value === "met" || value === "x") return "met";
  if (value === "unmet" || value === " ") return "unmet";
  return "unverified";
}

export type CriterionCheck = {
  text: string;
  verdict: CriterionVerdict;
  evidence?: string;
};

/** The verdicts a reply gave, when it has a finished check. */
export function parseCriteriaCheck(text: string): CriterionCheck[] | undefined {
  const body = lastTagBody(text, CHECK_TAG);
  if (body == null) return undefined;
  const checks: CriterionCheck[] = [];
  for (const item of listItems(body)) {
    const match = VERDICT.exec(item);
    if (!match) continue;
    const rest = item.slice(match[0].length).trim();
    const split = rest.search(/\s+[—–]\s+|\s+-\s+/);
    const claim = split >= 0 ? rest.slice(0, split).trim() : rest;
    const evidence =
      split >= 0 ? rest.slice(split).replace(/^\s+[—–-]\s+/, "").trim() : "";
    if (!claim) continue;
    checks.push({
      text: clip(claim),
      verdict: verdictOf(match[1]),
      ...(evidence ? { evidence: clip(evidence) } : {}),
    });
  }
  return checks.length ? checks : undefined;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );
}

function overlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * Put each verdict on the criterion it speaks to: by position when the agent
 * kept the list as it was, else by the words they share.
 */
export function applyCriteriaCheck(
  criteria: readonly GoalCriterion[],
  checks: readonly CriterionCheck[],
): GoalCriterion[] {
  const plain = criteria.map(({ text }) => ({ text }));
  if (checks.length === criteria.length) {
    return plain.map((criterion, index) => ({
      ...criterion,
      verdict: checks[index].verdict,
      ...(checks[index].evidence ? { evidence: checks[index].evidence } : {}),
    }));
  }
  const used = new Set<number>();
  return plain.map((criterion) => {
    let best = -1;
    let score = 0.5;
    checks.forEach((check, index) => {
      if (used.has(index)) return;
      const next = overlap(criterion.text, check.text);
      if (next > score) {
        score = next;
        best = index;
      }
    });
    if (best < 0) return criterion;
    used.add(best);
    const check = checks[best];
    return {
      ...criterion,
      verdict: check.verdict,
      ...(check.evidence ? { evidence: check.evidence } : {}),
    };
  });
}

export type CriteriaFound = {
  criteria?: string[];
  check?: CriterionCheck[];
  /** When the turn that wrote the newest of them started. */
  at: number;
};

/** The newest criteria and check a conversation's finished replies hold. */
export function criteriaInBlocks(blocks: readonly Block[]): CriteriaFound {
  const found: CriteriaFound = { at: 0 };
  let turnAt = 0;
  for (const block of blocks) {
    if (block.role === "user" && !block.draft) {
      turnAt = block.startedAt ?? block.sentAt ?? turnAt;
      continue;
    }
    if (block.role !== "assistant" || block.streaming) continue;
    if (!block.text.includes("</")) continue;
    const criteria = parseCriteria(block.text);
    const check = parseCriteriaCheck(block.text);
    if (criteria) {
      found.criteria = criteria;
      // New criteria void an older check.
      found.check = undefined;
      found.at = turnAt;
    }
    if (check) {
      found.check = check;
      found.at = turnAt;
    }
  }
  return found;
}

const MARK: Record<CriterionVerdict, string> = {
  met: "✓",
  unmet: "✗",
  unverified: "?",
};

function renderCheckLine(line: string): string {
  const item = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "");
  const match = VERDICT.exec(item);
  if (!match) return line;
  return `- ${MARK[verdictOf(match[1])]} ${item.slice(match[0].length)}`;
}

/**
 * The reply as the reader sees it: the tagged lists become headed lists. Works
 * on a reply still streaming in, so a half-written tag never flashes.
 */
export function renderCriteriaMarkdown(text: string): string {
  if (!text.includes("<completion_criteria") && !text.includes("<criteria_check"))
    return text;
  let out = text
    .replace(/<completion_criteria>\s*/g, "\n**Done when**\n\n")
    .replace(/\s*<\/completion_criteria>/g, "\n")
    .replace(/<criteria_check>\s*/g, "\n**Checked against the goal**\n\n")
    .replace(/\s*<\/criteria_check>/g, "\n");
  out = out
    .split("\n")
    .map((line) => (VERDICT.test(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")) ? renderCheckLine(line) : line))
    .join("\n");
  // A tag cut off mid-stream.
  return out.replace(/<\/?(?:completion_criteria|criteria_check)?[a-z_]*$/, "");
}

const rendered = new WeakMap<Block, Block>();
const renderedLists = new WeakMap<readonly Block[], Block[]>();

/** The chat's blocks with criteria lists made readable; same array when none. */
export function goalCriteriaBlocks(blocks: Block[]): Block[] {
  const cached = renderedLists.get(blocks);
  if (cached) return cached;
  let changed = false;
  const out = blocks.map((block) => {
    if (block.role !== "assistant") return block;
    const hit = rendered.get(block);
    if (hit) {
      changed = true;
      return hit;
    }
    const text = renderCriteriaMarkdown(block.text);
    if (text === block.text) return block;
    const copy = { ...block, text };
    rendered.set(block, copy);
    changed = true;
    return copy;
  });
  const result = changed ? out : blocks;
  renderedLists.set(blocks, result);
  return result;
}

const CHECK_FORMAT = `<criteria_check>
- [met] <criterion> — <what shows it: a test, a command's output, a file, a preview>
- [unmet] <criterion> — <what is missing>
- [unverified] <criterion> — <why it could not be checked>
</criteria_check>`;

/** For the turn that starts a goal: set out criteria first, then work. */
export function draftCriteriaContext(): string {
  return `<goal_criteria>
Irgatos tracks this request as the user's goal. Before you start, write 2 to 5 brief completion criteria: plain sentences a non-programmer can check, about the result the user asked for, not about your process. Put them at the top of your reply exactly like this:

<completion_criteria>
- <criterion>
</completion_criteria>

Then do the work. Do not wait for approval of the criteria. Ask a clarifying question first only if an ambiguity would change what "done" means; otherwise pick the sensible reading and name the assumption in a criterion.

When you deliver, end your final reply with a check of each criterion, one line each, in the same order:

${CHECK_FORMAT}
</goal_criteria>`;
}

/** For a chat that joins a goal, or after the user changed its criteria. */
export function goalBriefContext(goal: {
  title: string;
  scope?: string;
  criteria?: readonly GoalCriterion[];
}): string {
  const criteria = goal.criteria?.length
    ? goal.criteria.map((criterion) => `- ${criterion.text}`).join("\n")
    : "";
  return `<goal_criteria>
This chat works on the user's goal "${goal.title}".${goal.scope ? `\nScope: ${goal.scope}` : ""}${
    criteria
      ? `\nIt is done when:\n${criteria}`
      : `\nIt has no completion criteria yet. Before you start, set out 2 to 5 brief ones in plain language:\n\n<completion_criteria>\n- <criterion>\n</completion_criteria>`
  }

When you deliver, end your final reply with a check of each criterion, one line each, in the same order:

${CHECK_FORMAT}
</goal_criteria>`;
}

export function criteriaVersion(goal: {
  title: string;
  scope?: string;
  criteria?: readonly GoalCriterion[];
}): string {
  const text = `${goal.title}\n${goal.scope ?? ""}\n${(goal.criteria ?? []).map((c) => c.text).join("\n")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function criteriaSummary(
  criteria: readonly GoalCriterion[] | undefined,
): { met: number; total: number; checked: boolean } | undefined {
  if (!criteria?.length) return undefined;
  return {
    met: criteria.filter((criterion) => criterion.verdict === "met").length,
    total: criteria.length,
    checked: criteria.some((criterion) => criterion.verdict != null),
  };
}
