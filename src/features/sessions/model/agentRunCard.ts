import { displayPath } from "../../../shared/lib/paths";
import { resolveModel } from "./models";
import type { Block, Session } from "./session";
import {
  isHiddenTool,
  isNoticeBlock,
  isProseBlock,
  isThinkingBlock,
  isToolBlock,
  needsApproval,
  resolveToolCallDisplay,
  subagentName,
  toolCallLabel,
  toolCallState,
  toolCategory,
} from "./transcriptActivity";

/**
 * The status card above a coding chat's composer: one live line for the turn
 * in flight, its last few steps, and the actions that fit its state. Built
 * from the transcript alone, so it follows every harness without new events.
 */
export type AgentRunState =
  "running" | "waiting_approval" | "paused" | "stopped" | "done" | "failed";

export type AgentRunStepIcon =
  "read" | "search" | "edit" | "run" | "agent" | "tool" | "approval" | "error";

export type AgentRunStepState = "active" | "done" | "waiting" | "failed";

export type AgentRunStep = {
  id: string;
  icon: AgentRunStepIcon;
  /** Shown while the step runs: "Reading 12 files". */
  presentLabel: string;
  /** Shown once it finished: "Read 12 files". */
  pastLabel: string;
  state: AgentRunStepState;
  /** Transcript blocks behind this row; timings are kept per block. */
  blockIds: string[];
};

export type AgentRun = {
  /** The user turn this run answers. */
  turnId: string;
  model: string;
  state: AgentRunState;
  title: string;
  steps: AgentRunStep[];
  startedAt?: number;
  /** Set once the turn ended and the harness reported how long it took. */
  durationMs?: number;
  filesChanged: number;
  /** The request Approve and Deny answer. */
  approvalRequestId?: number;
  error?: string;
};

/** What the user did from the card, which the transcript cannot tell. */
export type AgentRunIntent = "paused" | "stopped";

/** Step start and end times, observed while the card was on screen. */
export type StepTiming = { start: number; end?: number };

const FILE_ACTIONS: Record<string, [present: string, past: string]> = {
  Edit: ["Editing", "Edited"],
  Write: ["Writing", "Wrote"],
  Create: ["Creating", "Created"],
  Delete: ["Deleting", "Deleted"],
  Move: ["Moving", "Moved"],
  List: ["Listing", "Listed"],
  Read: ["Reading", "Read"],
};

type StepLabels = {
  icon: AgentRunStepIcon;
  present: string;
  past: string;
  /** What an approval card asks for: "run git push". */
  ask: string;
  /** Consecutive reads fold into one "Read 12 files" row. */
  read?: boolean;
  file?: string;
};

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Present and past tense for one tool call, in the words the trail uses. */
export function stepLabels(block: Block, cwd?: string): StepLabels {
  const label = toolCallLabel(block, cwd);
  const category = toolCategory(block);
  if (category === "agent") {
    const name = subagentName(block) || label;
    return {
      icon: "agent",
      present: `Delegating: ${name}`,
      past: `Delegated: ${name}`,
      ask: `start an agent for ${lowerFirst(name)}`,
    };
  }
  if (category === "run") {
    return {
      icon: "run",
      present: `Running ${label}`,
      past: `Ran ${label}`,
      ask: `run ${label}`,
    };
  }
  const display = resolveToolCallDisplay(label, block.tool?.preview, cwd);
  if (display.action === "Find" && display.target) {
    return {
      icon: "search",
      present: `Searching for ${display.target}`,
      past: `Searched for ${display.target}`,
      ask: `search for ${display.target}`,
    };
  }
  if (display.action === "Skill" && display.target) {
    return {
      icon: "tool",
      present: `Using skill ${display.target}`,
      past: `Used skill ${display.target}`,
      ask: `use skill ${display.target}`,
    };
  }
  const action = display.action;
  const tenses = action ? FILE_ACTIONS[action] : undefined;
  if (action && tenses && display.target) {
    const [present, past] = tenses;
    return {
      icon: action === "Read" || action === "List" ? "read" : "edit",
      present: `${present} ${display.target}`,
      past: `${past} ${display.target}`,
      ask: `${action.toLowerCase()} ${display.target}`,
      read: action === "Read",
      file: display.filePath ?? display.target,
    };
  }
  return {
    icon: category === "research" ? "search" : "tool",
    present: label,
    past: label,
    ask: lowerFirst(label),
  };
}

/** The user turn the card follows, and the blocks it has produced so far. */
export function latestTurn(
  blocks: Block[],
): { user: Block; blocks: Block[] } | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user" && !block.draft) {
      return { user: block, blocks: blocks.slice(index + 1) };
    }
  }
  return undefined;
}

function stepState(block: Block, live: boolean): AgentRunStepState {
  if (needsApproval(block)) return live ? "waiting" : "failed";
  const state = toolCallState(block);
  if (state === "rejected") return "failed";
  if (state === "pending" && live) return "active";
  return "done";
}

function mergeState(
  a: AgentRunStepState,
  b: AgentRunStepState,
): AgentRunStepState {
  const rank: AgentRunStepState[] = ["waiting", "active", "failed", "done"];
  return rank[Math.min(rank.indexOf(a), rank.indexOf(b))];
}

function readGroupLabels(count: number, single: StepLabels) {
  if (count === 1) return { present: single.present, past: single.past };
  return { present: `Reading ${count} files`, past: `Read ${count} files` };
}

/** Changed files across a turn's edits, counted once each. */
function changedFiles(blocks: Block[], cwd?: string): number {
  const files = new Set<string>();
  for (const block of blocks) {
    if (!isToolBlock(block) || toolCategory(block) !== "edit") continue;
    if (toolCallState(block) === "rejected") continue;
    const paths = block.tool?.paths?.length
      ? block.tool.paths
      : block.tool?.preview?.path
        ? [block.tool.preview.path]
        : [stepLabels(block, cwd).file].filter(Boolean);
    for (const path of paths) {
      if (path) files.add(displayPath(path, cwd));
    }
  }
  return files.size;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "1.9s" under ten seconds, "42s", then "3m 05s". */
export function formatStepDuration(ms: number): string {
  if (ms < 10_000) {
    const tenths = Math.floor(ms / 100) / 10;
    return `${tenths === Math.floor(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)}s`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function errorLine(text: string): string {
  const line =
    text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export function agentRunFromSession(
  session: Pick<Session, "blocks" | "busy" | "cwd" | "harness" | "model">,
  intent?: AgentRunIntent,
): AgentRun | undefined {
  const turn = latestTurn(session.blocks);
  if (!turn) return undefined;
  const live = !!session.busy;
  const cwd = session.cwd;

  const steps: AgentRunStep[] = [];
  let approval: { block: Block; ask: string } | undefined;
  let error: string | undefined;
  let lastWasThought = false;
  let readGroup:
    { step: AgentRunStep; count: number; first: StepLabels } | undefined;

  for (const block of turn.blocks) {
    if (isNoticeBlock(block) && block.notice === "error") {
      error = errorLine(block.text) || "The agent stopped with an error.";
      continue;
    }
    if (isProseBlock(block) || isThinkingBlock(block)) {
      lastWasThought = true;
      continue;
    }
    if (!isToolBlock(block) || isHiddenTool(block)) continue;
    lastWasThought = false;
    const labels = stepLabels(block, cwd);
    const state = stepState(block, live);
    if (state === "waiting" && !approval) approval = { block, ask: labels.ask };
    if (labels.read && readGroup && state !== "waiting") {
      readGroup.count += 1;
      readGroup.step.blockIds.push(block.id);
      readGroup.step.state = mergeState(readGroup.step.state, state);
      const text = readGroupLabels(readGroup.count, readGroup.first);
      readGroup.step.presentLabel = text.present;
      readGroup.step.pastLabel = text.past;
      continue;
    }
    const step: AgentRunStep = {
      id: block.id,
      icon: state === "waiting" ? "approval" : labels.icon,
      presentLabel:
        state === "waiting"
          ? `Waiting for approval to ${labels.ask}`
          : labels.present,
      pastLabel: labels.past,
      state,
      blockIds: [block.id],
    };
    steps.push(step);
    readGroup =
      labels.read && state !== "waiting"
        ? { step, count: 1, first: labels }
        : undefined;
  }

  const startedAt = turn.user.startedAt;
  const durationMs = live ? undefined : turn.user.durationMs;
  const filesChanged = changedFiles(turn.blocks, cwd);
  const model =
    turn.user.turnModel?.name ??
    resolveModel(session.harness, session.model).name;

  let state: AgentRunState;
  if (live) state = approval ? "waiting_approval" : "running";
  else if (intent === "paused") state = "paused";
  else if (intent === "stopped") state = "stopped";
  else if (error) state = "failed";
  else state = "done";

  if (state === "failed" && error) {
    steps.push({
      id: `${turn.user.id}:error`,
      icon: "error",
      presentLabel: error,
      pastLabel: error,
      state: "failed",
      blockIds: [],
    });
  }

  const elapsed =
    durationMs != null ? ` ${formatStepDuration(durationMs)}` : "";
  const active = [...steps].reverse().find((step) => step.state === "active");
  const title = (() => {
    switch (state) {
      case "waiting_approval":
        return `Needs your approval to ${approval?.ask ?? "continue"}`;
      case "running":
        if (active && !lastWasThought) return active.presentLabel;
        return steps.length || lastWasThought ? "Thinking…" : "Starting…";
      case "paused":
        return "Paused";
      case "stopped":
        return `Stopped${elapsed ? ` after${elapsed}` : ""}`;
      case "failed":
        return `Failed${elapsed ? ` after${elapsed}` : ""}`;
      case "done": {
        const files =
          filesChanged > 0
            ? ` · ${filesChanged} ${filesChanged === 1 ? "file" : "files"} changed`
            : "";
        return `Done${elapsed ? ` in${elapsed}` : ""}${files}`;
      }
    }
  })();

  return {
    turnId: turn.user.id,
    model,
    state,
    title,
    steps,
    startedAt,
    durationMs,
    filesChanged,
    approvalRequestId: approval?.block.approval?.requestId,
    error,
  };
}

/** Records when each tool block was first seen running and when it settled. */
export function updateStepTimings(
  timings: Map<string, StepTiming>,
  run: AgentRun,
  now: number,
): void {
  for (const step of run.steps) {
    for (const id of step.blockIds) {
      const settled = step.state === "done" || step.state === "failed";
      const known = timings.get(id);
      if (!known) {
        // A step already finished when first seen has no honest duration.
        if (!settled) timings.set(id, { start: now });
        continue;
      }
      if (settled && known.end == null) known.end = now;
    }
  }
}

/** A row's elapsed time from its blocks' timings, when it was watched. */
export function stepElapsed(
  step: AgentRunStep,
  timings: ReadonlyMap<string, StepTiming>,
  now: number,
): number | undefined {
  let start: number | undefined;
  let end: number | undefined;
  for (const id of step.blockIds) {
    const timing = timings.get(id);
    if (!timing) continue;
    start = start == null ? timing.start : Math.min(start, timing.start);
    const stop = timing.end ?? now;
    end = end == null ? stop : Math.max(end, stop);
  }
  if (start == null || end == null) return undefined;
  return end - start;
}
