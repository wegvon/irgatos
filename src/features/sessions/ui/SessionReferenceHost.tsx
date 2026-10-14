import { useEffect, useState } from "react";
import {
  OPEN_REFERENCED_SESSION_EVENT,
  SEND_TO_SESSION_EVENT,
  type OpenReferencedSessionRequest,
  type SendToSessionRequest,
} from "../model/sessionReferenceEvents";
import { SendToSessionDialog } from "./SendToSessionDialog";

type Props = {
  /** Bring a chat to the front, scrolled to `blockId` when given. */
  onOpenSession: (sessionId: string, blockId?: string) => void | Promise<void>;
};

/** App-level handler for opening referenced chats and sending messages on. */
export function SessionReferenceHost({ onOpenSession }: Props) {
  const [sending, setSending] = useState<SendToSessionRequest | null>(null);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<OpenReferencedSessionRequest>)
        .detail;
      if (!detail?.sessionId) return;
      void Promise.resolve(
        onOpenSession(detail.sessionId, detail.blockId),
      ).catch(console.error);
    };
    const send = (event: Event) => {
      const detail = (event as CustomEvent<SendToSessionRequest>).detail;
      if (detail?.sourceSessionId && detail.blockId) setSending(detail);
    };
    window.addEventListener(OPEN_REFERENCED_SESSION_EVENT, open);
    window.addEventListener(SEND_TO_SESSION_EVENT, send);
    return () => {
      window.removeEventListener(OPEN_REFERENCED_SESSION_EVENT, open);
      window.removeEventListener(SEND_TO_SESSION_EVENT, send);
    };
  }, [onOpenSession]);

  if (!sending) return null;
  return (
    <SendToSessionDialog
      request={sending}
      onClose={() => setSending(null)}
      onSent={({ mode, targetIds }) => {
        setSending(null);
        // A turn sent to run stays put; its pill links to the other session.
        if (mode === "run" || targetIds.length !== 1) return;
        void Promise.resolve(onOpenSession(targetIds[0]!)).catch(console.error);
      }}
    />
  );
}
