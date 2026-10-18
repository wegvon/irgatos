import type { IrgatSender, Session } from "../../sessions/model/session";

/** One Irgat as another Irgat sees it in app irgats.list. */
export type IrgatContact = {
  id: string;
  name: string;
  busy: boolean;
};

/** Finds the Irgat a message is for by id or by its unique name. */
export function resolveIrgatContact(
  contacts: readonly IrgatContact[],
  ref: string,
  selfId: string,
): IrgatContact {
  const wanted = ref.trim().toLowerCase();
  const byId = contacts.find((contact) => contact.id === ref.trim());
  const byName = contacts.filter(
    (contact) => contact.name.trim().toLowerCase() === wanted,
  );
  const target = byId ?? (byName.length === 1 ? byName[0] : undefined);
  if (!target)
    throw new Error(
      byName.length > 1
        ? `Several Irgats are named ${ref}; use its id from irgats.list`
        : "No Irgat by that name or id; run app irgats.list",
    );
  if (target.id === selfId)
    throw new Error("You cannot message yourself; answer in this chat");
  return target;
}

/**
 * What the receiving Irgat's model reads. Its chat shows only the message,
 * labeled with the sender, so the user sees the exchange as written.
 */
export function irgatMessagePrompt(sender: IrgatSender, message: string): string {
  return `Irgatos delivers this message from ${sender.name}, another Irgat, not from the user. Answer it in your reply as you would answer the user, using your own knowledge, memory and projects. Irgatos returns your reply to ${sender.name} automatically, so do not message ${sender.name} back with app irgats.send. The user can read this exchange in your chat.\n\n<irgat_message from="${sender.name.replace(/"/g, "'")}">\n${message}\n</irgat_message>`;
}

/**
 * How many agent messages a Irgat chat may take part in before its user
 * writes again. Two Irgats that keep answering each other, or a ring of them,
 * stop here instead of talking on their own indefinitely.
 */
export const AGENT_EXCHANGE_LIMIT = 6;

/**
 * Agent messages in this chat since its user last wrote: messages that came
 * in from another Irgat, and answers to the ones it sent out.
 */
export function agentExchangesSinceUser(session: Pick<Session, "blocks">): number {
  let count = 0;
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role !== "user" || block.draft) continue;
    if (block.fromIrgat || block.irgatSessionCompletion?.agentReply) count++;
    else if (!block.internal && !block.irgatSessionCompletion) break;
  }
  return count;
}

/** Refuses another agent message once the chat reached the limit. */
export function assertAgentExchangeAllowed(session: Pick<Session, "blocks">): void {
  if (agentExchangesSinceUser(session) >= AGENT_EXCHANGE_LIMIT)
    throw new Error(
      `This chat already exchanged ${AGENT_EXCHANGE_LIMIT} messages with other agents since the user last wrote. Do not message again: give the user what you have and let them decide whether to continue.`,
    );
}
