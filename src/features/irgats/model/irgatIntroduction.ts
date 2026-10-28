import type { Session } from "../../sessions/model/session";
import type { Irgat } from "./irgat";

/**
 * The turn a new Irgat starts with, unseen by the user: it says hello in its
 * own voice, says what it can do here, and offers a first habit or two as
 * cards the user can start or ignore. Nothing is set up without the user.
 */
export function irgatIntroductionPrompt(name: string): string {
  return `Irgatos: you were just created, and the user has your chat open for the first time. This message is from the app, not the user.

Introduce yourself as ${name}, in your own voice and in the user's language if your memory or soul shows it (otherwise English). Keep it short: two or three sentences on who you are and what you can do for them here (watch and start sessions on their projects, keep habits that run on their own and only speak up when something is worth saying, remember what matters, write things up).

Then look around with the app CLI (your projects, recent sessions, memory) and, if something fits, post at most two habit suggestions with chat.card type "habit" that would genuinely help with what you see. They are only suggestions; the user starts them. Finish with a chat.card type "choices" of up to three first things they could ask you. Do not start sessions, add habits or change anything yet.`;
}

/**
 * The Irgats due their introduction now: created to introduce themselves,
 * with a chat that is loaded and idle. One the user already wrote to has
 * moved on, so it is only cleared.
 */
export function irgatsToIntroduce(
  irgats: readonly Irgat[],
  sessions: readonly Session[],
): { irgat: Irgat; session: Session; greet: boolean }[] {
  const due: { irgat: Irgat; session: Session; greet: boolean }[] = [];
  for (const irgat of irgats) {
    if (!irgat.introduce || !irgat.sessionId) continue;
    const session = sessions.find((entry) => entry.id === irgat.sessionId);
    if (!session || session.busy) continue;
    const spoken = session.blocks.some(
      (block) => block.role === "user" && !block.draft,
    );
    due.push({ irgat, session, greet: !spoken });
  }
  return due;
}
