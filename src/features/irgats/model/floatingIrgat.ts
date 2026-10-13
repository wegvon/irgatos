import type { ApprovalDecision } from "../../../integrations/harness";
import type { Attachment, Session } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { displayAttachments } from "../../sessions/model/attachments";
import { listIrgats, irgatLook, irgatState, type IrgatStatus } from "./irgat";
import { pixelLayers } from "../../projects/model/pixelMascots";

export const FLOATING_IRGAT_CHANGED = "irgat_chat_changed";
export const FLOATING_IRGAT_REQUEST = "irgat_chat_request";
export type FloatingIrgatEntry = {
  id: string;
  name: string;
  mascot: string;
  color: string;
  sessionId: string | null;
  status: IrgatStatus;
};
export type FloatingIrgatView = {
  irgats: FloatingIrgatEntry[];
  irgatId: string | null;
  session: Session | null;
  error: string | null;
};
export type FloatingIrgatAction =
  | { kind: "open" }
  | { kind: "submit"; text: string; attachments: Attachment[] }
  | { kind: "stop" }
  | { kind: "create" }
  | { kind: "approval"; requestId: number; decision: ApprovalDecision }
  | { kind: "question"; requestId: number; reply: UserQuestionReply }
  | { kind: "questionInteraction"; requestId: number }
  | { kind: "reveal" }
  | { kind: "openFile"; path: string }
  | { kind: "openArtifact"; id: string }
  | { kind: "resume" };
export type FloatingIrgatRequest = {
  id: number;
  irgatId: string;
  action: FloatingIrgatAction;
};

export function floatingIrgatRoster(
  enabled: boolean,
  sessions: readonly Session[] = [],
): FloatingIrgatEntry[] {
  return enabled
    ? listIrgats().map((irgat) => {
        const session = sessions.find((s) => s.id === irgat.sessionId);
        return {
          id: irgat.id,
          ...irgatLook(irgat),
          sessionId: irgat.sessionId ?? null,
          status: session ? irgatState(session).status : "idle",
        };
      })
    : [];
}

/** Draw the same portraits in AppKit without a second set of mascot assets. */
export function floatingIrgatMenuMascots(irgats: FloatingIrgatEntry[]) {
  return irgats.map((irgat) => {
    const { body, open } = pixelLayers(irgat.mascot, irgat.color);
    return { irgatId: irgat.id, rects: [...body, ...open] };
  });
}

/** Blob URLs belong to their webview; send attachment bytes/paths instead. */
export function floatingIrgatSession(session: Session): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.attachments?.length
        ? { ...block, attachments: floatingIrgatAttachments(block.attachments) }
        : block,
    ),
    queuedMessages: session.queuedMessages?.map((message) => ({
      ...message,
      attachments: floatingIrgatAttachments(message.attachments),
    })),
  };
}

export function floatingIrgatAttachments(
  attachments: Attachment[],
): Attachment[] {
  return displayAttachments(attachments).map(
    ({ previewUrl: _preview, ...file }) => file,
  );
}

export type FloatingIrgatHost = {
  open(irgatId: string): Promise<Session | undefined>;
  submit(
    sessionId: string,
    text: string,
    attachments: Attachment[],
  ): boolean | void;
  stop(sessionId: string): void;
  approval(
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ): void;
  question(
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ): void;
  questionInteraction(sessionId: string, requestId: number): void;
  reveal(irgatId: string): Promise<void>;
  openFile(path: string): void | Promise<void>;
  openArtifact?(irgatId: string, id: string): void | Promise<void>;
  resume(sessionId: string): void;
  /** Add a Irgat and show it in place of the chat that asked. */
  create?(fromIrgatId: string): Promise<void>;
};

/** Preparation may await disk; recheck the receipt before mutating a session. */
export async function deliverFloatingIrgatRequest(
  request: FloatingIrgatRequest,
  host: FloatingIrgatHost,
  accept: () => Promise<boolean>,
): Promise<Session | undefined> {
  const session = await host.open(request.irgatId);
  if (!session) throw new Error("That Irgat is no longer available.");
  if (!(await accept())) return undefined;
  const action = request.action;
  switch (action.kind) {
    case "open":
      break;
    case "submit":
      if (host.submit(session.id, action.text, action.attachments) === false)
        throw new Error(
          "The message could not be sent. Try again in a moment.",
        );
      break;
    case "stop":
      host.stop(session.id);
      break;
    case "approval":
      host.approval(session.id, action.requestId, action.decision);
      break;
    case "question":
      host.question(session.id, action.requestId, action.reply);
      break;
    case "questionInteraction":
      host.questionInteraction(session.id, action.requestId);
      break;
    case "reveal":
      await host.reveal(request.irgatId);
      break;
    case "openFile":
      await host.openFile(action.path);
      break;
    case "openArtifact":
      if (!host.openArtifact) throw new Error("Artifacts are unavailable.");
      await host.openArtifact(request.irgatId, action.id);
      break;
    case "resume":
      host.resume(session.id);
      break;
    case "create":
      if (!host.create) throw new Error("New Irgats are unavailable here.");
      await host.create(request.irgatId);
      break;
    default:
      throw new Error("Unknown chat action.");
  }
  return session;
}
