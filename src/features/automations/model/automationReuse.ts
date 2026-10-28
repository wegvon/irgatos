import { pathKey } from "../../../shared/lib/paths";
import { sessionWorkCwd, type Session } from "../../sessions/model/session";
import type { Automation } from "./automations";

/**
 * What "Continue the last run" does with the previous conversation.
 * - `reuse`: continue it (it was loaded from history if its tab was closed).
 * - `busy`: it is still working (or another run holds it); this run is
 *   skipped rather than talking over it or silently forking a new chat.
 * - `new`: it is gone or no longer matches the automation's agent or
 *   folder; a new conversation starts and the run says why.
 */
export type PreviousConversation =
  | { kind: "reuse"; session: Session }
  | { kind: "busy"; reason: string }
  | { kind: "new"; note?: string };

export const PREVIOUS_BUSY =
  "Skipped: the previous run's conversation was still working.";
export const PREVIOUS_GONE =
  "The previous conversation no longer exists, so this run started a new one.";
export const PREVIOUS_MISMATCH =
  "The previous conversation uses a different agent or folder, so this run started a new one.";

export function previousConversation(
  automation: Automation,
  previous: Session | null | undefined,
  reserved: ReadonlySet<string>,
): PreviousConversation {
  // A worktree automation gets a fresh worktree, and so a fresh chat, each run.
  if (
    !automation.reuseSession ||
    !automation.lastSessionId ||
    automation.workspaceMode === "worktree"
  )
    return { kind: "new" };
  if (!previous) return { kind: "new", note: PREVIOUS_GONE };
  const sameWorkspace =
    automation.workspaceMode === "current"
      ? previous.workspaceMode !== "worktree" &&
        !previous.worktreeCwd &&
        pathKey(previous.cwd) === pathKey(automation.cwd)
      : pathKey(sessionWorkCwd(previous)) === pathKey(automation.worktreeCwd ?? "");
  if (
    previous.harness !== automation.harness ||
    previous.worktreeRemoved ||
    !sameWorkspace
  )
    return { kind: "new", note: PREVIOUS_MISMATCH };
  if (previous.busy || reserved.has(previous.id))
    return { kind: "busy", reason: PREVIOUS_BUSY };
  return { kind: "reuse", session: previous };
}
