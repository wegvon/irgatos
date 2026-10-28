import { isPreparingHandoff } from "./handoff";
import type { QueuedMessage, Session } from "./session";

export function queuedHead(session: Session): QueuedMessage | undefined {
  return session.queuedMessages?.[0];
}

/** Hold auto-dispatch only while the item about to send is being edited. */
export function isEditingQueuedHead(session: Session): boolean {
  const head = queuedHead(session);
  return Boolean(head && session.editingQueuedMessageId === head.id);
}

export function dequeueQueuedMessage(
  session: Session,
  messageId: string,
): Session {
  const queuedMessages = (session.queuedMessages ?? []).filter(
    (message) => message.id !== messageId,
  );
  return {
    ...session,
    queuedMessages: queuedMessages.length > 0 ? queuedMessages : undefined,
    queueStatus: queuedMessages.length > 0 ? session.queueStatus : undefined,
    editingQueuedMessageId:
      session.editingQueuedMessageId === messageId
        ? undefined
        : session.editingQueuedMessageId,
  };
}

/**
 * True when the idle session can send its queued head as a new turn.
 * Busy / paused / resuming / usage-limited / preparing-handoff /
 * editing-the-head all wait.
 */
export function canDispatchQueuedHead(session: Session): boolean {
  if (session.busy) return false;
  if (session.worktreePreparing || session.worktreeRemoved) return false;
  if (session.usageLimit) return false;
  if (session.queueStatus === "paused" || session.queueStatus === "resuming") {
    return false;
  }
  const head = queuedHead(session);
  if (!head) return false;
  if (isEditingQueuedHead(session)) return false;
  // Still being steered into the turn that just ended; its outcome decides.
  if (session.sendingQueuedMessageId === head.id) return false;
  if (isPreparingHandoff(session)) return false;
  return true;
}

/** Irgats deliver one waiting follow-up at a time after the provider is ready. */
export function canSteerQueuedHead(session: Session): boolean {
  const head = queuedHead(session);
  return (
    !!head &&
    !head.irgatSessionCompletion &&
    !!session.busy &&
    !!session.turnReady &&
    !session.worktreePreparing &&
    !session.worktreeRemoved &&
    !session.pendingSwitch &&
    !session.usageLimit &&
    !(
      session.pendingQuestion && session.pendingQuestion.autoResolveAt == null
    ) &&
    session.queueStatus !== "paused" &&
    session.queueStatus !== "resuming" &&
    !isEditingQueuedHead(session) &&
    !isPreparingHandoff(session) &&
    head.intent !== "plan" &&
    head.intent !== "orchestrate"
  );
}

/** Resolve a queued row for auto-dispatch (head, idle) or an explicit Steer. */
export function queuedMessageForSubmit(
  session: Session,
  messageId: string,
  mode: "dispatch" | "steer",
): QueuedMessage | undefined {
  const message = session.queuedMessages?.find(
    (entry) => entry.id === messageId,
  );
  if (!message) return undefined;
  if (mode === "steer") {
    if (message.irgatSessionCompletion) return undefined;
    // A busy turn cannot take a plan; steering it would only queue a copy.
    return session.busy && !canSteerQueuedMessage(message) ? undefined : message;
  }
  if (queuedHead(session)?.id !== messageId) return undefined;
  if (!canDispatchQueuedHead(session)) return undefined;
  return message;
}

/** Plans and orchestration proposals start their own turn; they cannot steer one. */
export function canSteerQueuedMessage(message: QueuedMessage): boolean {
  return (
    !message.irgatSessionCompletion &&
    message.intent !== "plan" &&
    message.intent !== "orchestrate"
  );
}

/**
 * Keep a follow-up the provider never accepted. It keeps its identity (a queued
 * row is updated in place, a typed one is added) and waits, paused, for Retry.
 */
export function keepUnsentMessage(
  session: Session,
  message: QueuedMessage,
  error: string,
): Session {
  const queued = session.queuedMessages ?? [];
  const exists = queued.some((entry) => entry.id === message.id);
  return {
    ...session,
    queuedMessages: exists
      ? queued.map((entry) =>
          entry.id === message.id ? { ...entry, error } : entry,
        )
      : [...queued, { ...message, error }],
    queueStatus: "paused",
    sendingQueuedMessageId:
      session.sendingQueuedMessageId === message.id
        ? undefined
        : session.sendingQueuedMessageId,
  };
}

/** Retry failed follow-ups: clear their errors and let the queue send them. */
export function retryUnsentMessages(session: Session): Session {
  return {
    ...session,
    queueStatus: "active",
    queuedMessages: session.queuedMessages?.map(({ error: _error, ...entry }) =>
      entry,
    ),
  };
}
