import type { IrgatGroupMode } from "./irgatGroups";

/** A member as mentions see it. */
export type MentionMember = { id: string; name: string };

/** What the user writes after @ to address a member: its name without spaces. */
export function mentionHandle(name: string): string {
  return name.replace(/\s+/g, "");
}

const MENTION = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_.-]+)/gu;

function handleKey(text: string): string {
  return text.replace(/[.\-_]+$/u, "").toLocaleLowerCase();
}

/**
 * The members a text addresses with @Name, in the order it first names them.
 * Unknown handles, and emails like a@b.c, are not mentions.
 */
export function mentionedMembers(
  text: string,
  members: readonly MentionMember[],
): string[] {
  const byHandle = new Map(
    members.map((member) => [handleKey(mentionHandle(member.name)), member.id]),
  );
  const found: string[] = [];
  for (const match of text.matchAll(MENTION)) {
    const id = byHandle.get(handleKey(match[2]));
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

/**
 * Who replies to the user's message, in order. Mentions decide when there are
 * any; otherwise the members picked above the composer do, which in round
 * mode starts as everyone.
 */
export function resolveGroupSpeakers({
  text,
  members,
  picked,
}: {
  text: string;
  members: readonly MentionMember[];
  /** Members toggled on above the composer. */
  picked: readonly string[];
}): string[] {
  const mentioned = mentionedMembers(text, members);
  if (mentioned.length) return mentioned;
  const on = new Set(picked);
  return members.filter((member) => on.has(member.id)).map((member) => member.id);
}

/** The members picked by default for the next message. */
export function defaultPicked(
  mode: IrgatGroupMode,
  members: readonly MentionMember[],
): string[] {
  return mode === "round" ? members.map((member) => member.id) : [];
}

/** Members a reply hands the floor to: mentioned, other than the speaker. */
export function handoffTargets(
  reply: string,
  speakerId: string,
  members: readonly MentionMember[],
): string[] {
  return mentionedMembers(reply, members).filter((id) => id !== speakerId);
}

/** Candidates for the @ picker, best match first. */
export function mentionSuggestions<T extends MentionMember>(
  query: string,
  members: readonly T[],
): T[] {
  const needle = query.toLocaleLowerCase();
  if (!needle) return [...members];
  const scored = members.flatMap((member) => {
    const handle = mentionHandle(member.name).toLocaleLowerCase();
    const name = member.name.toLocaleLowerCase();
    const score = handle.startsWith(needle)
      ? 0
      : name.split(/\s+/).some((word) => word.startsWith(needle))
        ? 1
        : handle.includes(needle)
          ? 2
          : -1;
    return score < 0 ? [] : [{ member, score }];
  });
  return scored
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.member);
}
