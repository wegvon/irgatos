import { pathKey, projectName } from "../../../shared/lib/paths";
import type { Block, Session } from "../../sessions/model/session";
import {
  addIrgatProject,
  findIrgat,
  irgatForSession,
  irgatWorksOn,
} from "./irgat";

/** Reuse an unanswered request rather than asking again on a CLI retry. */
export function projectAccessBlock(
  session: Session,
  irgatId: string,
  project: string,
): Block {
  const pending = session.blocks.find(
    (block) =>
      block.irgatProjectAccess?.irgatId === irgatId &&
      pathKey(block.irgatProjectAccess.project) === pathKey(project) &&
      block.approval &&
      !block.approval.decided,
  );
  if (pending) return pending;
  return {
    id: crypto.randomUUID(),
    role: "approval",
    text: `${projectName(project)} projesine erişmeme izin veriyor musun? Onay verirsen bu Irgat projeye eklenir ve tekrar sormadan erişebilir.\n${project}`,
    approval: {
      requestId: session.blocks.reduce(
        (id, block) => Math.min(id, (block.approval?.requestId ?? 0) - 1),
        -Date.now(),
      ),
    },
    irgatProjectAccess: {
      irgatId,
      project,
      userTurnId: session.blocks
        .slice()
        .reverse()
        .find((block) => block.role === "user")?.id,
    },
  };
}

/** Only the user's approval handler calls this; the CLI cannot grant access. */
export function approveProjectAccess(session: Session, block: Block): boolean {
  const request = block.irgatProjectAccess;
  if (
    !request ||
    block.approval?.decided ||
    irgatForSession(session.id)?.id !== request.irgatId
  )
    return false;
  addIrgatProject(request.irgatId, request.project);
  const saved = findIrgat(request.irgatId);
  return !!saved && irgatWorksOn(saved, request.project);
}
