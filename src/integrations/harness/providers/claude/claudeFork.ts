import { claudeForkTranscript } from "../../../../platform/tauri/fs";
import type { ForkSessionInput } from "../../core/types";

/**
 * Claude keeps each conversation as a JSONL transcript; a fork is a copy of
 * its first turns under a new id, which the fork's first send resumes. That
 * is what `--fork-session` writes too, without starting a process for it.
 */
export function forkClaudeSession(
  input: ForkSessionInput,
): Promise<string | null> {
  return claudeForkTranscript({
    providerSessionId: input.providerSessionId,
    providerAccountId: input.providerAccountId,
    keepTurns: input.keepTurns,
    nextPrompt: input.nextPrompt,
  });
}
