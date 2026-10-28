import { basename } from "../../../platform/tauri/fs";
import type { Block, Session } from "./session";
import { isThinkingBlock, toolCategory } from "./transcriptActivity";
import { stepLabels } from "./agentRunCard";

/**
 * An approval in plain words: what will happen, why the agent wants it, what
 * it touches and whether it can be taken back. The exact command stays one
 * click away for whoever wants it, so the user can decide without reading
 * shell. Built from the tool call alone, so every harness gets it.
 */

/** "none" means there is nothing to undo: it only reads or checks. */
export type Reversibility = "none" | "yes" | "partly" | "no" | "unknown";

export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalBrief = {
  /** "Run the tests", "Change export.ts". */
  what: string;
  /** The agent's own words just before it asked, when it gave a reason. */
  why?: string;
  /** What it touches. */
  impact: string;
  reversible: Reversibility;
  /** "Yes: the edit can be rolled back". */
  undo: string;
  risk: ApprovalRisk;
  /** The exact command, path or tool input. */
  technical?: string;
};

type Effect = Pick<ApprovalBrief, "impact" | "reversible" | "undo" | "risk"> & {
  what?: string;
  /** Reaches past this Mac, so a worktree does not contain it. */
  outside?: boolean;
};

const RISK_RANK: Record<ApprovalRisk, number> = { low: 0, medium: 1, high: 2 };
const WHY_MAX = 180;
const TECHNICAL_MAX = 400;

const ONLY_READS = "Only reads. Nothing changes.";

const SHELL_RULES: Array<{ test: RegExp; effect: Effect }> = [
  {
    test: /\bgit\s+push\b.*(?:\s--force(?:-with-lease)?\b|\s-f\b)/,
    effect: {
      what: "Force-push to the remote",
      outside: true,
      impact: "Overwrites the branch on the remote, including commits others may have.",
      reversible: "no",
      undo: "No: overwritten commits are gone from the remote",
      risk: "high",
    },
  },
  {
    test: /\brm\s+(?:-[a-zA-Z]+\s+)*\S|\bunlink\s|\brmdir\s|\bfind\b.*\s-delete\b/,
    effect: {
      what: "Delete files",
      impact: "Removes files from disk.",
      reversible: "no",
      undo: "No, unless the files are committed in git",
      risk: "high",
    },
  },
  {
    test: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|checkout\s+\.(?:\s|$)|restore\s)/,
    effect: {
      what: "Discard uncommitted changes",
      impact: "Throws away changes that are not committed yet.",
      reversible: "no",
      undo: "No: uncommitted work is lost",
      risk: "high",
    },
  },
  {
    test: /\b(?:drop\s+(?:table|database)|truncate\s+table|delete\s+from)\b/i,
    effect: {
      what: "Delete data from a database",
      outside: true,
      impact: "Removes rows or tables.",
      reversible: "no",
      undo: "No, unless there is a backup",
      risk: "high",
    },
  },
  {
    test: /\b(?:gh\s+pr\s+merge|gh\s+release\s+create|npm\s+publish|cargo\s+publish|terraform\s+apply|kubectl\s+(?:apply|delete)|vercel\s+(?:--prod|deploy)|fly\s+deploy)\b/,
    effect: {
      what: "Publish or deploy",
      outside: true,
      impact: "Changes something outside this Mac that other people or systems use.",
      reversible: "no",
      undo: "Hard to undo: it is already out",
      risk: "high",
    },
  },
  {
    test: /\bgit\s+push\b/,
    effect: {
      what: "Push commits to the remote",
      outside: true,
      impact: "Publishes the commits, so others can see them.",
      reversible: "partly",
      undo: "Partly: commits can be reverted, but they stay visible",
      risk: "high",
    },
  },
  {
    test: /\bgh\s+(?:pr|issue)\s+(?:create|comment|close|edit|review)\b|\bgh\s+api\b.*\s-X\s*(?:POST|PATCH|PUT|DELETE)\b/,
    effect: {
      what: "Post on GitHub",
      outside: true,
      impact: "Writes on GitHub where others can see it.",
      reversible: "partly",
      undo: "Partly: it can be edited or closed, but people may have been notified",
      risk: "high",
    },
  },
  {
    test: /\bcurl\b.*(?:\s-X\s*(?:POST|PUT|PATCH|DELETE)\b|\s(?:-d|--data(?:-\w+)?|-F|--form)\s)/,
    effect: {
      what: "Send data to a web service",
      outside: true,
      impact: "Sends a request that can change something on that service.",
      reversible: "unknown",
      undo: "Depends on the service",
      risk: "high",
    },
  },
  {
    test: /\bsudo\s/,
    effect: {
      what: "Run a command as administrator",
      outside: true,
      impact: "Can change anything on this Mac.",
      reversible: "unknown",
      undo: "Depends on the command",
      risk: "high",
    },
  },
  {
    test: /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|remove|uninstall|update|upgrade)|pip3?\s+(?:install|uninstall)|brew\s+(?:install|uninstall|upgrade)|cargo\s+(?:add|remove|install)|go\s+get|uv\s+(?:add|pip))\b/,
    effect: {
      what: "Change dependencies",
      impact: "Installs or removes packages for the project.",
      reversible: "yes",
      undo: "Yes: the lockfile can be restored",
      risk: "medium",
    },
  },
  {
    test: /\bgit\s+(?:merge|rebase|cherry-pick|stash|checkout|switch|pull)\b/,
    effect: {
      what: "Change the checked-out code",
      impact: "Moves the folder to other code or brings in other changes.",
      reversible: "partly",
      undo: "Partly: git keeps the history, but conflicts may need sorting out",
      risk: "medium",
    },
  },
  {
    test: /\bgit\s+(?:commit|add|tag)\b/,
    effect: {
      what: "Commit changes",
      impact: "Records the current changes in git on this Mac.",
      reversible: "yes",
      undo: "Yes: a local commit can be undone",
      risk: "low",
    },
  },
  {
    test: /\b(?:mv|cp|mkdir|touch|chmod|chown|ln)\s|\bsed\s+-i|(?:^|[^>&0-9])>{1,2}\s*(?!\/dev\/null)[^\s&|>]/,
    effect: {
      impact: "Changes files on disk.",
      reversible: "partly",
      undo: "Partly: easy if the files are in git",
      risk: "medium",
    },
  },
  {
    test: /\b(?:test|tests|e2e|vitest|jest|pytest|playwright|mocha|go\s+test|cargo\s+(?:test|nextest)|rspec)\b/,
    effect: {
      what: "Run the tests",
      impact: "Runs the checks. Code is not changed; test output may be written.",
      reversible: "none",
      undo: "Nothing to undo",
      risk: "low",
    },
  },
  {
    test: /\b(?:build|tsc|lint|clippy|eslint|prettier\s+--check|typecheck|check|make|cargo\s+(?:build|check|fmt\s+--check))\b/,
    effect: {
      what: "Build and check the project",
      impact: "Writes only build output. Code is not changed.",
      reversible: "none",
      undo: "Nothing to undo",
      risk: "low",
    },
  },
  {
    test: /\bcurl\b|\bwget\b/,
    effect: {
      what: "Download from the web",
      impact: "Reads from the internet.",
      reversible: "none",
      undo: "Nothing to undo",
      risk: "low",
    },
  },
  {
    test: /^\s*(?:cd|export|ls|cat|head|tail|less|grep|rg|ag|find|fd|pwd|echo|printf|wc|which|whoami|env|date|tree|stat|file|du|df|ps|jq|diff|git\s+(?:status|diff|log|show|branch|remote|rev-parse|blame|ls-files)|gh\s+(?:pr|issue|run)\s+(?:view|list|status|diff|checks))\b/,
    effect: {
      impact: ONLY_READS,
      reversible: "none",
      undo: "Nothing to undo",
      risk: "low",
    },
  },
];

const UNKNOWN_COMMAND: Effect = {
  impact: "Runs a command on this Mac.",
  reversible: "unknown",
  undo: "Not sure: see the command",
  risk: "medium",
};

/** Commands chained with &&, ||, ; or | each count; the riskiest one wins. */
function commandParts(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function shellEffect(command: string): Effect {
  let worst: Effect | undefined;
  let worstRank = -1;
  for (const part of commandParts(command)) {
    const rule = SHELL_RULES.find((entry) => entry.test.test(part));
    const effect = rule?.effect ?? UNKNOWN_COMMAND;
    const rank = RISK_RANK[effect.risk] * 2 + (rule ? 1 : 0);
    if (rank > worstRank) {
      worst = effect;
      worstRank = rank;
    }
  }
  return worst ?? UNKNOWN_COMMAND;
}

function upperFirst(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The last thing the agent said before it asked: usually "Let me run the
 * tests to confirm the fix." Only from the same turn, never a stale reason.
 */
export function approvalReason(blocks: readonly Block[], block: Block): string | undefined {
  const index = blocks.indexOf(block);
  if (index < 0) return undefined;
  for (let at = index - 1; at >= 0; at--) {
    const candidate = blocks[at];
    if (candidate.role === "user" && !candidate.draft) return undefined;
    if (candidate.role !== "assistant" || isThinkingBlock(candidate)) continue;
    const text = candidate.text.replace(/```[\s\S]*?```/g, " ").trim();
    if (!text) continue;
    const sentences = text
      .split(/(?<=[.!?:])\s+|\n+/)
      .map((part) => part.replace(/^[-*>#\s]+/, "").trim())
      .filter((part) => /[a-zA-ZÀ-ɏ]/.test(part));
    const last = sentences[sentences.length - 1];
    return last ? clip(last.replace(/:$/, "."), WHY_MAX) : undefined;
  }
  return undefined;
}

export function approvalBrief(
  block: Block,
  context: { cwd?: string; workCwd?: string; blocks?: readonly Block[] } = {},
): ApprovalBrief {
  const { cwd } = context;
  const tool = block.tool;
  const preview = tool?.preview;
  const labels = stepLabels(block, cwd);
  const category = toolCategory(block);
  const command = (
    preview?.kind === "shell"
      ? preview.query || preview.title || ""
      : category === "run" && !preview
        ? block.text || tool?.title || ""
        : ""
  ).trim();
  const rawTechnical = (command || tool?.detail || preview?.path || "").trim();
  const technical = rawTechnical ? clip(rawTechnical, TECHNICAL_MAX) : undefined;
  const why = context.blocks ? approvalReason(context.blocks, block) : undefined;
  const isolated = !!context.workCwd && !!cwd && context.workCwd !== cwd;
  const where = isolated
    ? ` Only in its own worktree (${basename(context.workCwd!)}); your project folder stays as it is.`
    : "";

  let effect: Effect;
  let what = upperFirst(labels.ask);
  if (command) {
    effect = shellEffect(command);
    if (effect.what) what = effect.what;
    else if (command.length <= 60 && !command.includes("\n")) what = `Run ${command}`;
    if (effect.reversible !== "none" && !effect.outside)
      effect = { ...effect, impact: effect.impact + where };
  } else if (category === "edit") {
    const file = labels.file ? basename(labels.file) : undefined;
    if (/^delete\b/i.test(labels.ask)) {
      effect = {
        impact: `Removes ${file ?? "a file"}.${where}`,
        reversible: "partly",
        undo: "Only if the file is committed in git",
        risk: isolated ? "medium" : "high",
      };
    } else {
      const lines =
        preview?.additions || preview?.deletions
          ? ` (+${preview.additions ?? 0} −${preview.deletions ?? 0} lines)`
          : "";
      const files = tool?.paths?.length ?? 0;
      effect = {
        impact: `${files > 1 ? `Changes ${files} files` : `Changes ${file ?? "a file"}`}${lines}.${where}`,
        reversible: "yes",
        undo: "Yes: the edit can be rolled back",
        risk: "low",
      };
      if (file) what = `${upperFirst(labels.ask.split(" ")[0])} ${file}`;
    }
  } else if (category === "research") {
    effect = { impact: ONLY_READS, reversible: "none", undo: "Nothing to undo", risk: "low" };
  } else if (category === "agent") {
    effect = {
      impact: "Starts a helper agent that works on its own and reports back.",
      reversible: "yes",
      undo: "Yes: it can be stopped",
      risk: "low",
    };
  } else if (/^fetch$/i.test(tool?.kind ?? "") || /^(?:fetch|web\s?fetch|web\s?search)\b/i.test(labels.ask)) {
    effect = { impact: "Reads from the internet.", reversible: "none", undo: "Nothing to undo", risk: "low" };
  } else {
    effect = {
      impact: "Uses a tool whose effect Irgatos cannot tell in advance.",
      reversible: "unknown",
      undo: "Not sure: see the details",
      risk: "medium",
    };
  }

  return {
    what: clip(what, 120),
    ...(why ? { why } : {}),
    impact: effect.impact,
    reversible: effect.reversible,
    undo: effect.undo,
    risk: effect.risk,
    ...(technical && technical !== what ? { technical } : {}),
  };
}

/** For a request listed outside its chat: the session supplies the context. */
export function sessionApprovalBrief(session: Session, block: Block): ApprovalBrief {
  return approvalBrief(block, {
    cwd: session.cwd,
    workCwd: session.worktreeCwd || session.cwd,
    blocks: session.blocks,
  });
}
