import { getComposerDraft, setComposerDraft } from "./draftCache";
import { appendSessionReference } from "./sessionReferences";

export const OPEN_REFERENCED_SESSION_EVENT = "irgat:open-referenced-session";
export const SEND_TO_SESSION_EVENT = "irgat:send-to-session";
export const INSERT_SESSION_REFERENCE_EVENT =
  "irgat:insert-session-reference";
export const INSERT_SESSION_MESSAGE_EVENT = "irgat:insert-session-message";

export type OpenReferencedSessionRequest = {
  sessionId: string;
  /** Message to scroll to once the session is open. */
  blockId?: string;
};

export type SendToSessionRequest = {
  sourceSessionId: string;
  /** Any block of the message being sent. */
  blockId: string;
  /** Selected text to send instead of the whole message. */
  text?: string;
};

export type InsertSessionReferenceRequest = {
  targetSessionId: string;
  label: string;
  /** Set by the mounted composer that took the reference. */
  handled?: boolean;
};

export type InsertSessionMessageRequest = {
  targetSessionId: string;
  text: string;
  /** Replace the whole draft instead of appending to it. */
  replace?: boolean;
  /** Move focus to the composer once the text is in. */
  focus?: boolean;
  /** Set by the mounted composer that took the message. */
  handled?: boolean;
};

export function requestOpenReferencedSession(
  request: OpenReferencedSessionRequest,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenReferencedSessionRequest>(
      OPEN_REFERENCED_SESSION_EVENT,
      { detail: request },
    ),
  );
}

export function requestSendToSession(request: SendToSessionRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SendToSessionRequest>(SEND_TO_SESSION_EVENT, {
      detail: request,
    }),
  );
}

/**
 * Put a reference in another chat's composer. A mounted composer takes it
 * directly; otherwise it lands in the saved draft the composer opens with.
 */
export function insertSessionReference(
  targetSessionId: string,
  label: string,
): void {
  const detail: InsertSessionReferenceRequest = { targetSessionId, label };
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<InsertSessionReferenceRequest>(
        INSERT_SESSION_REFERENCE_EVENT,
        { detail },
      ),
    );
  }
  if (detail.handled) return;
  setComposerDraft(
    targetSessionId,
    appendSessionReference(getComposerDraft(targetSessionId) ?? "", label),
  );
}

/**
 * Put a message in another chat's composer. A mounted composer takes it
 * directly; otherwise it lands in the draft the composer opens with.
 */
export function insertSessionMessageIntoComposer(
  targetSessionId: string,
  text: string,
  options: { replace?: boolean; focus?: boolean } = {},
): void {
  const detail: InsertSessionMessageRequest = {
    targetSessionId,
    text,
    ...options,
  };
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<InsertSessionMessageRequest>(
        INSERT_SESSION_MESSAGE_EVENT,
        { detail },
      ),
    );
  }
  if (detail.handled) return;
  setComposerDraft(
    targetSessionId,
    options.replace
      ? text
      : appendToDraft(getComposerDraft(targetSessionId) ?? "", text),
  );
}

export function appendToDraft(draft: string, text: string): string {
  if (!draft.trim()) return text;
  return `${draft.replace(/\s+$/, "")}\n\n${text}`;
}
