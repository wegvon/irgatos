import type { IrgatSender } from "../../sessions/model/session";

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
