import type { Block } from "../../sessions/model/session";

export type AdhdFocus =
  | {
      kind: "progress";
      done: number;
      total: number;
      /** The step being worked on, or the next one waiting. */
      current?: string;
    }
  | { kind: "next"; text: string };

const NEXT_LINE =
  /^\s*(?:[-*>]\s+)?(?:\*\*|__)?(?:next(?: step)?|sonraki(?: adım)?|sıradaki(?: adım)?)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+?)\s*$/i;

function plain(text: string): string {
  return text
    .replace(/\*\*|__/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The reply's closing "Next: …" line, the one action upstream rule 3 asks for. */
export function nextStepLine(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let found: string | undefined;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(NEXT_LINE);
    if (match?.[1]) found = plain(match[1]) || found;
  }
  return found;
}

function isTurnStart(block: Block): boolean {
  return block.role === "user" && !block.draft && !block.internal;
}

/**
 * What the reader needs on screen for the latest turn: where a running agent
 * is in its task list, or the next step its finished reply ended with.
 */
export function adhdFocus(
  blocks: readonly Block[],
  busy: boolean,
): AdhdFocus | null {
  let start = blocks.length - 1;
  while (start >= 0 && !isTurnStart(blocks[start]!)) start -= 1;
  const turn = blocks.slice(start + 1);

  const tasks = [...turn]
    .reverse()
    .find((block) => block.role === "tasks" && block.taskList?.items.length)
    ?.taskList?.items.filter((item) => item.status !== "cancelled");
  const current = plain(
    (
      tasks?.find((item) => item.status === "in_progress") ??
      tasks?.find((item) => item.status === "pending")
    )?.text ?? "",
  );
  const progress: AdhdFocus | null = tasks?.length
    ? {
        kind: "progress",
        done: tasks.filter((item) => item.status === "completed").length,
        total: tasks.length,
        ...(current ? { current } : {}),
      }
    : null;
  if (busy) return progress;

  const reply = [...turn]
    .reverse()
    .find(
      (block) =>
        block.role === "assistant" && !block.streaming && block.text.trim(),
    );
  const next = reply ? nextStepLine(reply.text) : undefined;
  if (next) return { kind: "next", text: next };
  return progress;
}

export function adhdFocusLabel(focus: AdhdFocus, busy: boolean): string {
  if (focus.kind === "next") return `Next: ${focus.text}`;
  if (focus.done >= focus.total) return `${focus.done} of ${focus.total} done`;
  if (busy && focus.current)
    return `Step ${focus.done + 1} of ${focus.total}: ${focus.current}`;
  return `${focus.done} of ${focus.total} done${
    focus.current ? ` · next: ${focus.current}` : ""
  }`;
}
