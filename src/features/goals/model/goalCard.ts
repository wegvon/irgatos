import { isLiveHarness } from "../../../integrations/harness/core/registry";
import type { Session } from "../../sessions/model/session";
import { sessionInterruption } from "../../sessions/model/sessionInterruption";
import type { GoalMemberView, GoalView } from "./goals";
import { recoveryBrief, type RecoveryBrief, type RecoveryCause } from "./recovery";

/** What a goal's card reads: its count, its main chat and what stopped it. */

export function progressText(view: GoalView): string | undefined {
  const progress = view.progress;
  if (!progress) return undefined;
  if (progress.done === progress.total)
    return progress.source === "workers" ? "All agents finished" : "All steps done";
  return progress.source === "workers"
    ? `${progress.done} of ${progress.total} agents finished`
    : `${progress.done} of ${progress.total} steps`;
}

export function primarySession(view: GoalView): GoalMemberView | undefined {
  return (
    view.members.find((member) => member.open && member.link.role === "main") ??
    view.members.find((member) => member.open && member.link.role !== "worker") ??
    view.members.find((member) => member.link.role === "main") ??
    view.members[0]
  );
}

export type GoalRecovery = {
  sessionId: string;
  title: string;
  cause: RecoveryCause;
  brief: RecoveryBrief;
  /** A usage limit with a reset still ahead. */
  resetsAt?: number;
  resumeAtReset?: boolean;
};

/** The first of the goal's chats that stopped short and can be picked up. */
export function goalRecovery(
  view: GoalView,
  sessionsById: ReadonlyMap<string, Session>,
  now: number,
): GoalRecovery | undefined {
  for (const member of view.members) {
    if (!member.open) continue;
    const session = sessionsById.get(member.link.sessionId);
    if (!session || session.busy) continue;
    const cause: RecoveryCause | undefined = session.usageLimit
      ? "limit"
      : sessionInterruption(session)
        ? "interrupted"
        : undefined;
    if (!cause) continue;
    const brief = recoveryBrief(session, cause, {
      goal: view.goal,
      now,
      nativeResume: isLiveHarness(session.harness),
    });
    if (!brief) continue;
    const resetsAt = session.usageLimit?.resetsAt;
    return {
      sessionId: session.id,
      title: member.link.title,
      cause,
      brief,
      ...(resetsAt && resetsAt > now ? { resetsAt } : {}),
      ...(session.usageLimit?.resumeAtReset ? { resumeAtReset: true } : {}),
    };
  }
  return undefined;
}
