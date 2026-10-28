import { basename } from "../../../platform/tauri/fs";
import { sessionEditPaths } from "../../sessions/model/checkpointEdits";
import { CONTINUE_PROMPT } from "../../sessions/model/inFlight";
import {
  sessionWorkCwd,
  type Block,
  type Session,
  type TaskListItem,
} from "../../sessions/model/session";
import { formatUsageLimitReset } from "../../sessions/model/usageLimit";
import { deliveryChecks } from "./result";
import type { Goal } from "./goals";

/**
 * After a chat stops short (the agent went away, or hit a usage limit), say
 * in plain words what got done, what is safe, what is left, and which one
 * step picks the work back up. The user never has to rebuild the context or
 * pick a recovery mechanism.
 */

export type RecoveryCause = "interrupted" | "limit";

export type RecoveryBrief = {
  done: string[];
  kept: string[];
  left: string[];
  /** The one step we recommend, in a sentence. */
  next: string;
};

const LIST_MAX = 3;

/** Where the stopped work began: the user's request, not an app "continue". */
function workStart(blocks: readonly Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role !== "user" || block.draft) continue;
    if (block.internal || block.text.trim() === CONTINUE_PROMPT) continue;
    return index;
  }
  return -1;
}

function latestSteps(blocks: readonly Block[], start: number): TaskListItem[] | undefined {
  for (let index = blocks.length - 1; index > start; index--) {
    const items = blocks[index].taskList?.items;
    if (items?.length) return items.filter((item) => item.status !== "cancelled");
  }
  return undefined;
}

function firstLine(text: string, max = 90): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function answered(blocks: readonly Block[], start: number): boolean {
  return blocks
    .slice(start + 1)
    .some((block) => (block.role === "assistant" && block.text.trim()) || !!block.tool);
}

function list(items: string[]): string[] {
  return items.length > LIST_MAX
    ? [...items.slice(0, LIST_MAX), `and ${items.length - LIST_MAX} more`]
    : items;
}

export function recoveryBrief(
  session: Session,
  cause: RecoveryCause,
  options: { goal?: Goal; now?: number; nativeResume?: boolean } = {},
): RecoveryBrief | undefined {
  const start = workStart(session.blocks);
  if (start < 0) return undefined;
  const now = options.now ?? Date.now();
  const blocks = session.blocks;
  const steps = latestSteps(blocks, start);
  const files = sessionEditPaths(blocks);
  const checks = deliveryChecks(blocks, start).filter((check) => check.state === "passed");

  const done: string[] = [];
  const doneSteps = steps?.filter((step) => step.status === "completed") ?? [];
  if (steps?.length)
    done.push(
      doneSteps.length
        ? `${doneSteps.length} of ${steps.length} steps: ${list(doneSteps.map((step) => step.text)).join("; ")}`
        : `None of the ${steps.length} planned steps yet`,
    );
  if (files.length)
    done.push(
      `${files.length} ${files.length === 1 ? "file" : "files"} changed (${list(files.map((path) => basename(path))).join(", ")})`,
    );
  if (checks.length) done.push(`Passed: ${list(checks.map((check) => check.label)).join(", ")}`);
  if (!done.length)
    done.push(answered(blocks, start) ? "It had started, with no changes yet" : "Nothing yet: it stopped before starting");

  const kept: string[] = ["This conversation"];
  const workCwd = sessionWorkCwd(session);
  if (files.length)
    kept.push(
      session.branch
        ? `The file changes, on ${session.branch}`
        : workCwd !== session.cwd
          ? `The file changes, in ${basename(workCwd)}`
          : "The file changes, in the project folder",
    );
  const queued = session.queuedMessages?.length ?? 0;
  if (queued) kept.push(`${queued} ${queued === 1 ? "message" : "messages"} you queued`);
  if (options.goal?.criteria?.length) kept.push("The goal and its criteria");

  const left: string[] = [];
  const open = steps?.filter((step) => step.status !== "completed") ?? [];
  if (open.length) left.push(...list(open.map((step) => step.text)));
  else {
    const request = firstLine(blocks[start].text);
    if (request) left.push(`Finish: ${request}`);
  }
  const unchecked = options.goal?.criteria?.filter((criterion) => criterion.verdict !== "met") ?? [];
  if (unchecked.length)
    left.push(`Check ${unchecked.length} of the goal's criteria`);

  let next: string;
  if (cause === "limit") {
    const resetsAt = session.usageLimit?.resetsAt;
    next =
      resetsAt && resetsAt > now
        ? `Resume when the limit resets (${formatUsageLimitReset(resetsAt, now)}), or pick another model now. Either way it carries on from here.`
        : "Resume now. It carries on from here.";
  } else if (!answered(blocks, start)) {
    next = "Resume sends your request again. Nothing was done yet, so nothing is repeated.";
  } else {
    next =
      options.nativeResume && session.providerSessionId
        ? "Resume picks up where it stopped. Finished work is not redone."
        : "Resume starts the agent again with a summary of this chat, so finished work is not redone.";
  }
  return { done, kept, left, next };
}
