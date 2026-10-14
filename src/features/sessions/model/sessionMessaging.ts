import { pathKey } from "../../../shared/lib/paths";
import {
  deliveryBlock,
  isDeliveryStalled,
  toolInFlight,
  type DeliveryBlock,
  type ProgressTracker,
} from "./deliveryGuards";
import type { Block, HarnessId, Session } from "./session";

/**
 * Direct messages between sessions. A message is `queued` until the target
 * holds it (a submitted turn, or text placed in its composer), `delivered`
 * from then, and `replied` once the target's agent has answered the turn the
 * message started. A message to run is `blocked` while its target waits on
 * an approval or a question, and `stalled` when it was handed over but the
 * target showed no progress in time.
 */
export type SessionMessageStatus =
  | "queued"
  | "blocked"
  | "stalled"
  | "delivered"
  | "replied"
  | "failed";

/** `composer` leaves the message in the target's draft; `run` submits it. */
export type SessionMessageMode = "composer" | "run";

/** Who sent it: the user from a menu, or an agent through a directive. */
export type SessionMessageOrigin = "user" | "agent";

export type InterSessionMessage = {
  id: string;
  fromSessionId: string;
  fromTitle: string;
  fromHarness?: HarnessId;
  toSessionId: string;
  toTitle: string;
  text: string;
  mode: SessionMessageMode;
  origin: SessionMessageOrigin;
  status: SessionMessageStatus;
  createdAt: number;
  /** Block in the sender the message was taken from. */
  sourceBlockId?: string;
  /** Shared by every message of one broadcast. */
  broadcastId?: string;
  /** The sender wants the target's reply delivered back to it. */
  expectReply?: boolean;
  /** This message carries a reply to another message. */
  inReplyTo?: string;
  /** Agent-to-agent chain length, to stop sessions messaging in a loop. */
  hop: number;
  deliveredAt?: number;
  /** User turn in the target that carries the message. */
  deliveredBlockId?: string;
  repliedAt?: number;
  /** First block of the target's answer. */
  replyBlockId?: string;
  replyText?: string;
  /** The reply has been sent back to the sender. */
  replyForwardedAt?: number;
  /** When the target's submit path accepted the prompt. */
  dispatchedAt?: number;
  /** What the target was waiting on while the message was `blocked`. */
  blockedBy?: DeliveryBlock;
  stalledAt?: number;
  error?: string;
};

/** Messages chained further than this are refused. */
export const MAX_SESSION_MESSAGE_HOPS = 4;

const REPLY_TEXT_LIMIT = 8_000;
/** Clock skew allowed between creating a message and its turn starting. */
const DELIVERY_SKEW_MS = 5_000;

export function sessionMessageHeader(fromTitle: string): string {
  return `[Message from session "${quoteSafe(fromTitle)}"]`;
}

export function sessionReplyHeader(fromTitle: string): string {
  return `[Reply from session "${quoteSafe(fromTitle)}"]`;
}

function quoteSafe(title: string): string {
  return title.replace(/"/g, "").replace(/\s+/g, " ").trim() || "Untitled session";
}

function headerFor(message: InterSessionMessage): string {
  return message.inReplyTo
    ? sessionReplyHeader(message.fromTitle)
    : sessionMessageHeader(message.fromTitle);
}

/** The text the target receives, in its composer or as a turn. */
export function formatSessionMessagePrompt(
  message: Pick<
    InterSessionMessage,
    "fromTitle" | "text" | "expectReply" | "inReplyTo"
  >,
): string {
  const header = message.inReplyTo
    ? sessionReplyHeader(message.fromTitle)
    : sessionMessageHeader(message.fromTitle);
  const body = message.text.trim();
  const footer = message.expectReply
    ? `\n\n(Answer in this session; your reply is sent back to "${quoteSafe(message.fromTitle)}".)`
    : "";
  return `${header}\n\n${body}${footer}`;
}

export type SessionActivity = "running" | "needs-input" | "queued" | "idle";

export function sessionActivity(session: Session): SessionActivity {
  if (
    session.pendingQuestion ||
    session.blocks.some(
      (block) => block.approval && block.approval.decided == null,
    )
  ) {
    return "needs-input";
  }
  if (session.busy) return "running";
  if (session.queuedMessages?.length) return "queued";
  return "idle";
}

export const SESSION_ACTIVITY_LABEL: Record<SessionActivity, string> = {
  running: "Running",
  "needs-input": "Needs input",
  queued: "Queued",
  idle: "Idle",
};

export type SessionMessageTarget = {
  session: Session;
  /** Same project as the sender. */
  sibling: boolean;
  activity: SessionActivity;
};

/**
 * Open sessions a message can go to: siblings in the sender's project first,
 * then other open sessions, each group by most recent activity.
 */
export function sessionMessageTargets(
  sessions: readonly Session[],
  sourceSessionId: string,
  canMessage: (session: Session) => boolean,
): SessionMessageTarget[] {
  const source = sessions.find((session) => session.id === sourceSessionId);
  const project = source ? pathKey(source.cwd) : null;
  return sessions
    .filter((session) => session.id !== sourceSessionId && canMessage(session))
    .map((session) => ({
      session,
      sibling: project != null && pathKey(session.cwd) === project,
      activity: sessionActivity(session),
      at: lastActivityAt(session),
    }))
    .sort(
      (a, b) =>
        Number(b.sibling) - Number(a.sibling) ||
        Number(!!b.session.busy) - Number(!!a.session.busy) ||
        b.at - a.at ||
        a.session.id.localeCompare(b.session.id),
    )
    .map(({ session, sibling, activity }) => ({ session, sibling, activity }));
}

function lastActivityAt(session: Session): number {
  let at = 0;
  for (const block of session.blocks) {
    const start = block.sentAt ?? block.startedAt;
    if (start != null) at = Math.max(at, start + (block.durationMs ?? 0));
  }
  return at;
}

export type SessionMessagePatch = {
  id: string;
  patch: Partial<InterSessionMessage>;
};

/**
 * Move messages forward from what their target sessions now hold: a queued
 * message is delivered once a user turn carries it, and a delivered message is
 * replied once the agent has finished answering that turn.
 */
export function reconcileSessionMessages(
  messages: readonly InterSessionMessage[],
  sessions: readonly Session[],
  now = Date.now(),
): SessionMessagePatch[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const claimed = new Set(
    messages.flatMap((message) =>
      message.deliveredBlockId
        ? [`${message.toSessionId}:${message.deliveredBlockId}`]
        : [],
    ),
  );
  const patches: SessionMessagePatch[] = [];
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  for (const message of ordered) {
    if (message.status === "failed" || message.status === "replied") continue;
    const target = byId.get(message.toSessionId);
    if (!target) continue;
    const patch: Partial<InterSessionMessage> = {};
    let carrierId = message.deliveredBlockId;
    if (!carrierId) {
      const carrier = findCarrierBlock(message, target.blocks, claimed);
      if (carrier) {
        claimed.add(`${target.id}:${carrier.id}`);
        carrierId = carrier.id;
        patch.deliveredBlockId = carrier.id;
        if (awaitingCarrier(message.status)) {
          patch.status = "delivered";
          patch.deliveredAt = carrier.startedAt ?? carrier.sentAt ?? now;
          if (message.blockedBy) patch.blockedBy = undefined;
          if (message.stalledAt) patch.stalledAt = undefined;
        }
      }
    }
    if (carrierId) {
      const reply = findReply(target, carrierId);
      if (reply) {
        patch.status = "replied";
        patch.repliedAt = now;
        patch.replyBlockId = reply.blockId;
        patch.replyText = reply.text;
        if (awaitingCarrier(message.status) && !patch.deliveredAt) {
          patch.deliveredAt = now;
        }
      }
    }
    if (Object.keys(patch).length) patches.push({ id: message.id, patch });
  }
  return patches;
}

function awaitingCarrier(status: SessionMessageStatus): boolean {
  return status === "queued" || status === "blocked" || status === "stalled";
}

/** What the delivery guards want done after one look at the sessions. */
export type SessionMessageGuardResult = {
  patches: SessionMessagePatch[];
  /** Held back while the target was blocked, and now free to submit. */
  release: InterSessionMessage[];
};

/**
 * Hold, release and flag `run` messages from what their targets are doing.
 * A message not yet submitted waits as `blocked` while its target needs the
 * user, and is released once it does not; one already submitted shows as
 * `blocked` meanwhile and goes back to `queued` after. A submitted message
 * that no turn has picked up turns `stalled` when its target stops making
 * progress (`deliveryGuards.ts`).
 */
export function guardSessionMessages(
  messages: readonly InterSessionMessage[],
  sessions: readonly Session[],
  progress: ProgressTracker,
  now = Date.now(),
): SessionMessageGuardResult {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const patches: SessionMessagePatch[] = [];
  const release: InterSessionMessage[] = [];
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  for (const message of ordered) {
    if (message.mode !== "run" || message.deliveredBlockId) continue;
    if (!awaitingCarrier(message.status)) continue;
    const target = byId.get(message.toSessionId);
    if (!target) continue;
    const block = deliveryBlock(target);
    if (block) {
      if (message.status !== "blocked" || message.blockedBy !== block) {
        patches.push({
          id: message.id,
          patch: { status: "blocked", blockedBy: block, stalledAt: undefined },
        });
      }
      continue;
    }
    if (message.status === "blocked") {
      if (message.dispatchedAt == null) release.push(message);
      else {
        patches.push({
          id: message.id,
          patch: { status: "queued", blockedBy: undefined, dispatchedAt: now },
        });
      }
      continue;
    }
    if (message.status !== "queued" || message.dispatchedAt == null) continue;
    if (
      isDeliveryStalled({
        dispatchedAt: message.dispatchedAt,
        busy: !!target.busy,
        toolRunning: toolInFlight(target),
        lastProgressAt: progress.lastProgressAt(target.id),
        now,
      })
    ) {
      patches.push({ id: message.id, patch: { status: "stalled", stalledAt: now } });
    }
  }
  return { patches, release };
}

/** Messages the guards still have to look at again later. */
export function sessionMessagesNeedGuard(
  messages: readonly InterSessionMessage[],
): boolean {
  return messages.some(
    (message) =>
      message.mode === "run" &&
      !message.deliveredBlockId &&
      (message.status === "blocked" ||
        (message.status === "queued" && message.dispatchedAt != null)),
  );
}

function findCarrierBlock(
  message: InterSessionMessage,
  blocks: readonly Block[],
  claimed: ReadonlySet<string>,
): Block | undefined {
  const header = headerFor(message);
  const firstLine = normalize(message.text.trim().split("\n")[0] ?? "");
  const since = message.createdAt - DELIVERY_SKEW_MS;
  return blocks.find((block) => {
    if (block.role !== "user" || block.draft) return false;
    if (claimed.has(`${message.toSessionId}:${block.id}`)) return false;
    const at = block.startedAt ?? block.sentAt;
    if (at != null && at < since) return false;
    if (!block.text.includes(header)) return false;
    // Composer messages can be edited before sending; only the header binds.
    return message.mode === "composer" || normalize(block.text).includes(firstLine);
  });
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The agent's finished answer to the user turn `carrierId`, if there is one. */
function findReply(
  session: Session,
  carrierId: string,
): { blockId: string; text: string } | undefined {
  const index = session.blocks.findIndex((block) => block.id === carrierId);
  if (index < 0) return undefined;
  let end = session.blocks.length;
  for (let i = index + 1; i < session.blocks.length; i += 1) {
    const block = session.blocks[i]!;
    if (block.role === "user" && !block.draft) {
      end = i;
      break;
    }
  }
  // The turn is still running while it is the session's last one.
  if (end === session.blocks.length && session.busy) return undefined;
  const replies = session.blocks
    .slice(index + 1, end)
    .filter(
      (block) =>
        block.role === "assistant" && !block.streaming && block.text.trim(),
    );
  if (!replies.length) return undefined;
  const text = replies
    .map((block) => block.text.trim())
    .join("\n\n")
    .slice(0, REPLY_TEXT_LIMIT);
  return { blockId: replies[0]!.id, text };
}

/** The message whose delivered turn produced `blockId` in `sessionId`. */
export function messageForTurn(
  messages: readonly InterSessionMessage[],
  session: Pick<Session, "id" | "blocks">,
  blockId: string,
): InterSessionMessage | undefined {
  const index = session.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return undefined;
  for (let i = index; i >= 0; i -= 1) {
    const block = session.blocks[i]!;
    if (block.role !== "user" || block.draft) continue;
    return messages.find(
      (message) =>
        message.toSessionId === session.id &&
        message.deliveredBlockId === block.id,
    );
  }
  return undefined;
}

export type SessionMessageDirection = "incoming" | "outgoing";

export type SessionMessageAnchor = {
  message: InterSessionMessage;
  direction: SessionMessageDirection;
};

/** Messages to show beside `blockIds` in `sessionId`'s transcript. */
export function messagesAtBlocks(
  messages: readonly InterSessionMessage[],
  sessionId: string,
  blockIds: readonly string[],
): SessionMessageAnchor[] {
  if (!blockIds.length) return [];
  const ids = new Set(blockIds);
  const out: SessionMessageAnchor[] = [];
  for (const message of messages) {
    if (
      message.toSessionId === sessionId &&
      message.deliveredBlockId &&
      ids.has(message.deliveredBlockId)
    ) {
      out.push({ message, direction: "incoming" });
    } else if (
      message.fromSessionId === sessionId &&
      message.sourceBlockId &&
      ids.has(message.sourceBlockId)
    ) {
      out.push({ message, direction: "outgoing" });
    }
  }
  return out.sort((a, b) => a.message.createdAt - b.message.createdAt);
}

/** Incoming messages that no transcript block carries yet. */
export function pendingIncomingMessages(
  messages: readonly InterSessionMessage[],
  sessionId: string,
): InterSessionMessage[] {
  return messages
    .filter(
      (message) =>
        message.toSessionId === sessionId &&
        !message.deliveredBlockId &&
        message.status !== "failed" &&
        message.status !== "replied",
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Where to land in the other session when following a message pill. */
export function sessionMessageJump(anchor: SessionMessageAnchor): {
  sessionId: string;
  blockId?: string;
} {
  const { message, direction } = anchor;
  if (direction === "incoming") {
    return {
      sessionId: message.fromSessionId,
      ...(message.sourceBlockId ? { blockId: message.sourceBlockId } : {}),
    };
  }
  const blockId = message.replyBlockId ?? message.deliveredBlockId;
  return { sessionId: message.toSessionId, ...(blockId ? { blockId } : {}) };
}
