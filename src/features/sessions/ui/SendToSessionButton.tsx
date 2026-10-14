import { createContext, useContext } from "react";
import { Share } from "../../../shared/ui/icons";
import { requestSendToSession } from "../model/sessionReferenceEvents";

/** The chat a transcript belongs to; absent where messages cannot be sent on. */
export const SessionReferenceSourceContext = createContext<string | null>(null);

/** "Send to session…" on a message: queue it in, or run it in, another chat. */
export function SendToSessionButton({ blockId }: { blockId?: string }) {
  const sourceSessionId = useContext(SessionReferenceSourceContext);
  if (!sourceSessionId || !blockId) return null;
  return (
    <button
      type="button"
      title="Send to session…"
      aria-label="Send to session…"
      data-send-to-session={blockId}
      className="rounded-md p-1 text-content/40 hover:bg-content/8 hover:text-content/70"
      onClick={() => requestSendToSession({ sourceSessionId, blockId })}
    >
      <Share className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}
