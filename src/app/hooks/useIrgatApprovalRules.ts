import { useEffect, useRef } from "react";
import { listIrgats } from "../../features/irgats/model/irgat";
import {
  irgatRulesFor,
  ruledApprovals,
} from "../../features/irgats/model/irgatRules";
import type { Block, Session } from "../../features/sessions/model/session";

/**
 * Answers the approvals an Irgat's rules cover as soon as they appear, so the
 * user is only asked what the rules leave to them. Each request is answered
 * once; one the user already answered is left alone.
 */
export function useIrgatApprovalRules(
  sessions: readonly Session[],
  answer: (
    session: Session,
    block: Block,
    decision: "allow" | "handoff",
  ) => void,
) {
  const answered = useRef(new Set<string>());
  const answerRef = useRef(answer);
  answerRef.current = answer;
  useEffect(() => {
    const irgats = listIrgats();
    if (!irgats.some((irgat) => irgat.rules)) return;
    for (const session of sessions) {
      const rules = irgatRulesFor(session, irgats);
      for (const { block, decision } of ruledApprovals(session, rules)) {
        const key = `${session.id}:${block.approval!.requestId}`;
        if (answered.current.has(key)) continue;
        answered.current.add(key);
        answerRef.current(session, block, decision);
      }
    }
  }, [sessions]);
}
