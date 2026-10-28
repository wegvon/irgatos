import { TurnNotReadyError } from "../../../integrations/harness/core/types";
import { canSteerQueuedHead, queuedHead } from "./messageQueue";
import type { QueuedMessage, Session } from "./session";

/** Keep the pending message until the provider accepts it. Preparation is part of delivery. */
export async function deliverQueuedFollowUp<T>(options: {
  message: QueuedMessage;
  current: () => Session | undefined;
  isCurrentTurn: () => boolean;
  prepare: () => Promise<T>;
  steer: (prepared: T) => Promise<void>;
  delivered: () => void;
  deferred: () => void;
  failed: (error: string) => void;
}): Promise<boolean> {
  const canDeliver = () => {
    const session = options.current();
    return (
      options.isCurrentTurn() &&
      !!session &&
      queuedHead(session) === options.message &&
      canSteerQueuedHead(session)
    );
  };
  if (!canDeliver()) return false;
  try {
    const prepared = await options.prepare();
    // An edit, cancellation, provider switch or stop during preparation must win.
    if (!canDeliver()) return false;
    await options.steer(prepared);
  } catch (error) {
    if (!options.isCurrentTurn()) return false;
    if (error instanceof TurnNotReadyError) options.deferred();
    else options.failed(error instanceof Error ? error.message : String(error));
    return false;
  }
  options.delivered();
  return true;
}

export const STALE_FOLLOW_UP_ERROR =
  "Not sent: the turn it was meant for ended. Retry to send it now.";

/**
 * A normal chat's Steer: bound to the turn it was aimed at and unsent until the
 * provider accepts it. Preparation (attachments, prompt) can take long enough
 * for that turn to be stopped and replaced, so the turn is checked again after
 * it and a stale or rejected message is handed back as unsent, never delivered.
 */
export async function steerFollowUp<T>(options: {
  isCurrentTurn: () => boolean;
  prepare: () => Promise<T>;
  steer: (prepared: T) => Promise<void>;
  delivered: () => void;
  unsent: (error: string) => void;
}): Promise<boolean> {
  try {
    const prepared = await options.prepare();
    if (!options.isCurrentTurn()) {
      options.unsent(STALE_FOLLOW_UP_ERROR);
      return false;
    }
    await options.steer(prepared);
  } catch (error) {
    options.unsent(
      options.isCurrentTurn()
        ? error instanceof Error
          ? error.message
          : String(error)
        : STALE_FOLLOW_UP_ERROR,
    );
    return false;
  }
  options.delivered();
  return true;
}
