import type { ControlOutcome } from "../../orchestration/model/orchestration";
import type { HostSession } from "./protocol";

type Load = (known?: HostSession) => Promise<HostSession>;

/** How the turn a session started with ended, from the host's snapshot. */
export function remoteTurnOutcome(snapshot: HostSession): ControlOutcome {
  const blocks = snapshot.session.blocks;
  let start = -1;
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index].role === "user" && !blocks[index].draft) {
      start = index;
      break;
    }
  }
  let text = "";
  for (const block of blocks.slice(start + 1)) {
    if (
      block.role === "assistant" &&
      !block.tool &&
      !block.internal &&
      block.text.trim()
    )
      text = block.text;
  }
  const notice = blocks[blocks.length - 1]?.notice;
  if (snapshot.status === "interrupted" || notice === "interrupt")
    return { status: "cancelled", text };
  if (notice === "error")
    return { status: "failed", text, error: text || "The session failed" };
  return { status: "completed", text };
}

/**
 * Waits for a session started on another machine to finish its turn. The
 * host is polled, as its tab would be, until the session stops running after
 * it was seen running or has answered. A host that stays unreachable ends
 * the wait as a failure rather than leaving the Irgat waiting forever.
 */
export async function waitForRemoteTurn(
  load: Load,
  {
    intervalMs = 5_000,
    maxErrors = 36,
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  }: {
    intervalMs?: number;
    maxErrors?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ControlOutcome> {
  let known: HostSession | undefined;
  let seenRunning = false;
  let errors = 0;
  for (;;) {
    try {
      known = await load(known);
      errors = 0;
      if (known.status === "running") seenRunning = true;
      else {
        const outcome = remoteTurnOutcome(known);
        if (seenRunning || outcome.text || outcome.status !== "completed")
          return outcome;
      }
    } catch (error) {
      errors += 1;
      if (errors >= maxErrors)
        return {
          status: "failed",
          text: "",
          error: `Lost contact with the machine running this session: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
    }
    await sleep(intervalMs);
  }
}
