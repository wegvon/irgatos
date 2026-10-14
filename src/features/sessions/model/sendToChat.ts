import type { Attachment } from "./session";

export const SEND_TO_CHAT_EVENT = "irgat:send-to-chat";

export type ChatDelivery =
  | {
      status: "sent";
      sessionId: string;
      title: string;
      /** Attachments the chat's harness couldn't take, so weren't sent. */
      droppedAttachments: number;
    }
  | { status: "rejected"; sessionId: string; title: string };

export type SendToChatRequest = {
  text: string;
  attachments: Attachment[];
  /** Set by the session pane that took the message. */
  delivery?: ChatDelivery;
};

/**
 * Send a turn, files included, to the chat that receives Add to Chat. Unlike
 * Add to Chat it doesn't touch that chat's draft; it submits on its own.
 * Null when no chat is open to take it.
 */
export function requestSendToChat(
  text: string,
  attachments: Attachment[],
): ChatDelivery | null {
  if (typeof window === "undefined") return null;
  const detail: SendToChatRequest = { text, attachments };
  window.dispatchEvent(
    new CustomEvent<SendToChatRequest>(SEND_TO_CHAT_EVENT, { detail }),
  );
  return detail.delivery ?? null;
}

/** Submit a request through a session pane's own submit path, once. */
export function acceptSendToChat(
  request: SendToChatRequest,
  target: {
    sessionId: string;
    title: string;
    attachmentsSupported: boolean;
    submit: (text: string, attachments: Attachment[]) => boolean | void;
  },
) {
  if (request.delivery) return;
  const attachments = target.attachmentsSupported ? request.attachments : [];
  const accepted = target.submit(request.text, attachments);
  request.delivery =
    accepted === false
      ? { status: "rejected", sessionId: target.sessionId, title: target.title }
      : {
          status: "sent",
          sessionId: target.sessionId,
          title: target.title,
          droppedAttachments: request.attachments.length - attachments.length,
        };
}
