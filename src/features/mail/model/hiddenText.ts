import type { MailHiddenPart } from "./mail";

const KIND_LABELS: Record<MailHiddenPart["kind"], string> = {
  comment: "HTML comment",
  invisibleStyle: "Invisible text",
  invisibleCharacters: "Invisible characters",
  base64: "Encoded text",
};

export const hiddenKindLabel = (kind: MailHiddenPart["kind"]) =>
  KIND_LABELS[kind] ?? "Hidden text";

/** The line shown above a message that had hidden text, or null when it
 *  had none. A warning when any part looks aimed at an AI assistant. */
export function hiddenTextNotice(
  parts: MailHiddenPart[] | undefined,
): { warning: boolean; text: string } | null {
  if (!parts?.length) return null;
  if (parts.some((part) => part.suspicious)) {
    return {
      warning: true,
      text: "This email has hidden text that may be instructions for an AI assistant. Agents don't see it.",
    };
  }
  const count = parts.length === 1 ? "1 part" : `${parts.length} parts`;
  return {
    warning: false,
    text: `Hidden text removed (${count}). Agents don't see it.`,
  };
}
