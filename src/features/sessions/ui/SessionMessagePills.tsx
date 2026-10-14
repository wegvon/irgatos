import { useContext, useMemo } from "react";
import {
  Bot,
  CornerDownRight,
  RotateCcw,
  Share,
  X,
} from "../../../shared/ui/icons";
import { useSessionMessages } from "../hooks/useSessionMessages";
import {
  dismissSessionMessage,
  retrySessionMessage,
} from "../model/sessionMessageRouter";
import {
  messagesAtBlocks,
  pendingIncomingMessages,
  sessionMessageJump,
  type InterSessionMessage,
  type SessionMessageAnchor,
} from "../model/sessionMessaging";
import { requestOpenReferencedSession } from "../model/sessionReferenceEvents";
import { SessionReferenceSourceContext } from "./SendToSessionButton";

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function sessionMessageStatusLabel(
  message: InterSessionMessage,
): string {
  switch (message.status) {
    case "queued":
      return "Queued";
    case "delivered":
      if (message.mode === "composer" && !message.deliveredBlockId) {
        return "In composer";
      }
      return message.deliveredAt
        ? `Delivered ${clock(message.deliveredAt)}`
        : "Delivered";
    case "replied":
      return message.repliedAt
        ? `Replied ${clock(message.repliedAt)}`
        : "Replied";
    case "failed":
      return "Not delivered";
  }
}

const STATUS_TONE: Record<InterSessionMessage["status"], string> = {
  queued: "bg-content/8 text-content/60",
  delivered: "bg-accent/15 text-accent",
  replied: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
};

function receiptTitle(message: InterSessionMessage): string {
  const lines = [`Sent ${new Date(message.createdAt).toLocaleString()}`];
  if (message.deliveredAt) {
    lines.push(`Delivered ${new Date(message.deliveredAt).toLocaleString()}`);
  }
  if (message.repliedAt) {
    lines.push(`Replied ${new Date(message.repliedAt).toLocaleString()}`);
  }
  if (message.error) lines.push(message.error);
  return lines.join("\n");
}

/** Inter-session messages sent from, or delivered into, these blocks. */
export function SessionMessagePills({
  blockIds,
  align = "start",
}: {
  blockIds: readonly string[];
  align?: "start" | "end";
}) {
  const sessionId = useContext(SessionReferenceSourceContext);
  const messages = useSessionMessages();
  const key = blockIds.join(" ");
  const anchors = useMemo(
    () => (sessionId ? messagesAtBlocks(messages, sessionId, blockIds) : []),
    // blockIds is a fresh array each render; its contents are the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, sessionId, key],
  );
  if (!anchors.length) return null;
  return (
    <div
      data-session-message-pills
      className={`flex flex-wrap items-center gap-1.5 px-4 pb-2 ${align === "end" ? "justify-end pt-1" : ""}`}
    >
      {anchors.map((anchor) => (
        <SessionMessagePill key={anchor.message.id} anchor={anchor} />
      ))}
    </div>
  );
}

export function SessionMessagePill({
  anchor,
}: {
  anchor: SessionMessageAnchor;
}) {
  const { message, direction } = anchor;
  const incoming = direction === "incoming";
  const other = incoming ? message.fromTitle : message.toTitle;
  const verb = incoming
    ? message.inReplyTo
      ? "Reply from"
      : "From"
    : message.inReplyTo
      ? "Reply to"
      : "To";
  const canJump = !!(incoming ? message.fromSessionId : message.toSessionId);
  const jump = () => {
    if (!canJump) return;
    requestOpenReferencedSession(sessionMessageJump(anchor));
  };
  return (
    <span
      data-session-message-pill={message.id}
      data-direction={direction}
      data-status={message.status}
      title={receiptTitle(message)}
      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-content/10 bg-content/4 py-0.5 pr-1 pl-2 text-[11px] leading-4 text-content/65"
    >
      {incoming ? (
        <CornerDownRight
          aria-hidden
          className="size-3 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
      ) : (
        <Share
          aria-hidden
          className="size-3 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
      )}
      {message.origin === "agent" ? (
        <Bot
          aria-label="Sent by an agent"
          className="size-3 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
      ) : null}
      <button
        type="button"
        disabled={!canJump}
        onClick={jump}
        aria-label={`${verb} session “${other}”${canJump ? ", open it" : ""}`}
        className="min-w-0 truncate rounded text-left hover:text-content hover:underline disabled:no-underline disabled:hover:text-content/65"
      >
        {verb} “{other}”
      </button>
      <span
        data-session-message-status
        className={`shrink-0 rounded-full px-1.5 text-[10px] font-medium ${STATUS_TONE[message.status]}`}
      >
        {sessionMessageStatusLabel(message)}
      </span>
      {message.status === "failed" && !incoming ? (
        <>
          {message.toSessionId ? (
            <button
              type="button"
              title="Send again"
              aria-label="Send again"
              onClick={() => retrySessionMessage(message.id)}
              className="grid size-4 shrink-0 place-items-center rounded-full text-content/50 hover:bg-content/10 hover:text-content"
            >
              <RotateCcw className="size-2.5" strokeWidth={2} />
            </button>
          ) : null}
          <button
            type="button"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => dismissSessionMessage(message.id)}
            className="grid size-4 shrink-0 place-items-center rounded-full text-content/50 hover:bg-content/10 hover:text-content"
          >
            <X className="size-2.5" strokeWidth={2} />
          </button>
        </>
      ) : null}
    </span>
  );
}

/** Messages on their way into this session that no turn carries yet. */
export function PendingSessionMessages({ sessionId }: { sessionId: string }) {
  const messages = useSessionMessages();
  const pending = useMemo(
    () => pendingIncomingMessages(messages, sessionId),
    [messages, sessionId],
  );
  if (!pending.length) return null;
  return (
    <div
      data-pending-session-messages
      className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5"
    >
      {pending.map((message) => (
        <SessionMessagePill
          key={message.id}
          anchor={{ message, direction: "incoming" }}
        />
      ))}
    </div>
  );
}
