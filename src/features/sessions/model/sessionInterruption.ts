import { detectUsageLimit } from "../../quotas/model/usageLimitReset";
import { buildDeterministicHandoff } from "./handoff";
import { CONTINUE_PROMPT, INTERRUPT_MESSAGE } from "./inFlight";
import type { Attachment, Block, Session } from "./session";

/**
 * A turn that ended because its agent went away rather than because it was
 * done: the CLI exited or crashed, the connection dropped, or Irgatos itself
 * quit or restarted mid-turn. Read from the transcript, so it survives a
 * restart and clears itself once a later turn is sent.
 */
export type InterruptionKind = "restart" | "exit" | "crash" | "disconnect";

export type SessionInterruption = {
  kind: InterruptionKind;
  /** The notice block that recorded it; dismissing remembers this id. */
  blockId: string;
  message: string;
};

const CRASH =
  /\b(?:crash(?:ed|es)?|panick?ed|panic:|segmentation fault|segfault|core dumped|fatal error|unhandled (?:exception|rejection)|out of memory|OOM[- ]killed)/i;
const EXIT =
  /\b(?:exited|exit(?:ed)? (?:with )?(?:code|status)|process (?:exited|ended|died|terminated|stopped)|terminated unexpectedly|was terminated|killed|SIG(?:KILL|TERM|SEGV|ABRT|HUP|PIPE|BUS)\b|non-zero exit|stopped responding)/i;
const DISCONNECT =
  /\b(?:connection (?:closed|lost|reset|dropped|refused|terminated|interrupted)|disconnected|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|broken pipe|socket hang ?up|(?:web)?socket (?:closed|error|disconnected)|stream (?:closed|ended|terminated) unexpectedly|unexpected end of (?:stream|file|input|JSON input)|network (?:error|connection was lost|is unreachable)|fetch failed|transport (?:closed|error)|pipe (?:closed|broken)|server (?:closed the connection|went away|disconnected)|tunnel (?:closed|lost))/i;

/** What a provider error says about the agent, when it says it went away. */
export function classifySessionError(
  message: string,
): Exclude<InterruptionKind, "restart"> | undefined {
  if (!message) return undefined;
  // A usage limit has its own recovery: wait for the reset.
  if (detectUsageLimit(message, Date.now())) return undefined;
  if (CRASH.test(message)) return "crash";
  if (EXIT.test(message)) return "exit";
  if (DISCONNECT.test(message)) return "disconnect";
  return undefined;
}

export const INTERRUPTION_TITLE: Record<InterruptionKind, string> = {
  restart: "Interrupted when Irgatos closed",
  exit: "Interrupted — the agent exited",
  crash: "Interrupted — the agent crashed",
  disconnect: "Interrupted — the connection dropped",
};

/** The interruption still waiting at the end of the transcript, if any. */
export function sessionInterruption(
  session: Session,
): SessionInterruption | undefined {
  if (
    session.busy ||
    session.worktreeRemoved ||
    session.usageLimit ||
    session.inboxAsk ||
    !session.blocks.some((block) => block.role === "user" && !block.draft)
  ) {
    return undefined;
  }
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role !== "system") return undefined;
    const found = interruptionFromBlock(block);
    if (found) {
      return session.dismissedInterruptionId === found.blockId
        ? undefined
        : found;
    }
    // Plain status rows can trail the failure; anything else ends the search.
    if (block.notice || block.interjection) return undefined;
  }
  return undefined;
}

function interruptionFromBlock(block: Block): SessionInterruption | undefined {
  if (block.notice === "interrupt" && block.text === INTERRUPT_MESSAGE) {
    return { kind: "restart", blockId: block.id, message: block.text };
  }
  if (block.notice !== "error") return undefined;
  const kind = classifySessionError(block.text);
  return kind ? { kind, blockId: block.id, message: block.text } : undefined;
}

export type ResumePlan = {
  /** What the user turn says. */
  prompt: string;
  attachments: Attachment[];
  /**
   * "continue" resumes the provider's own thread; "resend" repeats a prompt
   * the agent never answered; either may also carry a transcript recap when
   * the provider has no thread to resume.
   */
  mode: "continue" | "resend";
  /** Transcript recap for a fresh provider thread, appended for the agent. */
  context?: string;
  /** Queued follow-ups were paused by the failure; send them after. */
  releaseQueue: boolean;
};

/**
 * How to pick the conversation back up in one click. With a provider thread
 * the harness resumes it natively; without one, the prompt carries a recap
 * of the transcript so the new thread starts with the old context.
 */
export function planSessionResume(
  session: Session,
  nativeResume: boolean,
): ResumePlan | undefined {
  if (!sessionInterruption(session)) return undefined;
  const userIndex = lastUserIndex(session.blocks);
  if (userIndex < 0) return undefined;
  const lastUser = session.blocks[userIndex];
  const answered = session.blocks
    .slice(userIndex + 1)
    .some(
      (block) =>
        (block.role === "assistant" && block.text.trim().length > 0) ||
        !!block.tool,
    );
  const resend = !answered && lastUser.text.trim().length > 0;
  const releaseQueue =
    session.queueStatus === "paused" && !!session.queuedMessages?.length;
  const plan: ResumePlan = {
    prompt: resend ? lastUser.text : CONTINUE_PROMPT,
    attachments: resend ? (lastUser.attachments ?? []) : [],
    mode: resend ? "resend" : "continue",
    releaseQueue,
  };
  if (nativeResume && session.providerSessionId) return plan;
  // The recap covers the transcript before the prompt being re-sent.
  const recapSource = resend
    ? { ...session, blocks: session.blocks.slice(0, userIndex) }
    : session;
  const recap = recapSource.blocks.some((block) => block.role === "user")
    ? buildDeterministicHandoff(recapSource).trim()
    : "";
  return recap ? { ...plan, context: resumeContext(recap) } : plan;
}

export function resumeContext(recap: string): string {
  return `<resumed_session>\nThe previous agent process for this conversation stopped unexpectedly and its thread could not be resumed. This is the same conversation, not a new one; continue from the recap below without redoing finished work.\n\n${recap}\n</resumed_session>`;
}

/** Hide the banner for this interruption only; a later one shows again. */
export function dismissSessionInterruption(session: Session): Session {
  const found = sessionInterruption(session);
  return found ? { ...session, dismissedInterruptionId: found.blockId } : session;
}

function lastUserIndex(blocks: Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index].role === "user" && !blocks[index].draft) return index;
  }
  return -1;
}
