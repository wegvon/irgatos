import type { IrgatLook } from "./irgat";
import { irgatContext, irgatTurn, type IrgatFiles } from "./irgatFiles";
import { mentionHandle } from "./irgatGroupMentions";
import type { IrgatGroupMessage, IrgatGroupTrigger } from "./irgatGroups";

/** A member as the others in the room are told about it. */
export type GroupRosterEntry = {
  id: string;
  name: string;
  /** What it does, from its SOUL.md. */
  role?: string;
};

/** Why a member is speaking now. */
export type GroupTurnReason =
  | { kind: "round"; messageId: string }
  | IrgatGroupTrigger;

/** Older lines than this drop out of the transcript a turn carries. */
export const GROUP_CONTEXT_MESSAGES = 40;
export const GROUP_CONTEXT_CHARS = 32_000;
const LINE_MAX_CHARS = 4_000;
const ROLE_MAX_CHARS = 180;

const PLACEHOLDER = /^\(Add anything it should always keep in mind\.\)$/;

/**
 * A member's role in a line, from its standing instructions: the first
 * things it was told, or nothing while it still has the default soul.
 */
export function soulRole(soul: string | undefined): string | undefined {
  if (!soul) return undefined;
  const lines = soul
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/[*_`]/g, "")
        .trim(),
    )
    .filter((line) => line && !line.startsWith("#") && !PLACEHOLDER.test(line));
  if (!lines.length) return undefined;
  const text = lines.slice(0, 2).join(" ").replace(/\s+/g, " ");
  return text.length > ROLE_MAX_CHARS
    ? `${text.slice(0, ROLE_MAX_CHARS - 1).trimEnd()}…`
    : text;
}

function clip(text: string, max = LINE_MAX_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}… [cut]`
    : trimmed;
}

/** "[User]" or "[Irgat: Name]", with "(you)" on the speaker's own lines. */
export function speakerLabel(
  message: Pick<IrgatGroupMessage, "role" | "irgatId" | "name">,
  selfId?: string,
): string {
  if (message.role === "user") return "[User]";
  const name = message.name || "A former member";
  return message.irgatId && message.irgatId === selfId
    ? `[Irgat: ${name} (you)]`
    : `[Irgat: ${name}]`;
}

/** One message as a labeled transcript line. */
export function transcriptLine(
  message: IrgatGroupMessage,
  selfId?: string,
): string | undefined {
  if (message.role === "notice") return undefined;
  const label = speakerLabel(message, selfId);
  if (message.reaction) return `${label} reacted ${message.reaction}`;
  const files = message.attachments?.length
    ? `\n(Attached: ${message.attachments
        .map((file) => file.path ?? file.name)
        .join(", ")})`
    : "";
  const body = clip(message.text);
  if (!body && !files) return undefined;
  return `${label} ${body}${files}`;
}

/** The newest lines that fit the budget, oldest first. */
export function transcriptWindow(
  messages: readonly IrgatGroupMessage[],
  selfId?: string,
  limits = { messages: GROUP_CONTEXT_MESSAGES, chars: GROUP_CONTEXT_CHARS },
): { lines: string[]; dropped: number } {
  const lines: string[] = [];
  let chars = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = transcriptLine(messages[i], selfId);
    if (line) {
      if (lines.length >= limits.messages || chars + line.length > limits.chars)
        break;
      lines.unshift(line);
      chars += line.length;
    }
    start = i;
  }
  const dropped = messages
    .slice(0, start)
    .filter((message) => transcriptLine(message, selfId)).length;
  return { lines, dropped };
}

/** Where this round starts: the latest user message at or before `anchor`. */
function exchangeStart(
  messages: readonly IrgatGroupMessage[],
  anchorId: string,
): number {
  let anchor = messages.findIndex((message) => message.id === anchorId);
  if (anchor < 0) anchor = messages.length - 1;
  for (let i = anchor; i >= 0; i--) if (messages[i].role === "user") return i;
  return Math.max(0, anchor);
}

/** Who the others in the room are, and how to take part. */
export function groupRoomBlock({
  room,
  self,
  roster,
}: {
  room: string;
  self: GroupRosterEntry;
  roster: readonly GroupRosterEntry[];
}): string {
  const members = roster
    .map((member) => {
      const you = member.id === self.id ? " (you)" : "";
      const handle = mentionHandle(member.name);
      return `- ${member.name}${you}, @${handle}: ${member.role ?? "No standing role written yet."}`;
    })
    .join("\n");
  return `<group_room>
You are in "${room}", a group chat in Irgatos where the user talks with several Irgats at once. Each member is a separate agent with its own soul, memory and model. You are ${self.name}, and you only ever speak for yourself.

Members, in reply order:
${members}

How the room works: the user's messages go to the whole room unless they @mention someone, and members reply one after another. Everyone sees every reply. Transcript lines are labeled [User] or [Irgat: <Name>].

When it is your turn:
- Answer from your own expertise and role. Read what the other members already said and build on it, refine it or challenge it. Never repeat their points or give the same generic answer again; if you agree, say so in a line and add what only you would add.
- Keep to your part; the others cover theirs.
- To hand a question to another member, address them with their @handle; they may get a follow-up turn. Do not @mention members otherwise.
- Never write lines for other members or the user, and do not start your reply with your own label.
- Stay in this conversation: answer inline, and do not start sessions or save artifacts from this room unless the user asks you to.
</group_room>`;
}

function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** What this turn asks of the speaker. */
function yourTurn({
  self,
  reason,
  messages,
  start,
  after,
}: {
  self: GroupRosterEntry;
  reason: GroupTurnReason;
  messages: readonly IrgatGroupMessage[];
  start: number;
  after: readonly string[];
}): string {
  const lines: string[] = [];
  if (reason.kind === "round") {
    const earlier = [
      ...new Set(
        messages
          .slice(start + 1)
          .filter((message) => message.role === "irgat" && message.irgatId !== self.id)
          .map((message) => message.name ?? "A member"),
      ),
    ];
    lines.push(
      earlier.length
        ? `It is your turn, ${self.name}. ${names(earlier)} already replied to the user above. Build on, refine or challenge what they said from your own expertise; do not repeat it.`
        : `It is your turn, ${self.name}. You reply first to the user's message above; give your own view from your expertise.`,
    );
  } else {
    const from = messages.find((message) => message.id === reason.messageId);
    const who =
      from?.role === "user" ? "The user" : (from?.name ?? "Another member");
    lines.push(
      reason.kind === "handoff"
        ? `It is your turn, ${self.name}. ${who} addressed you in the message above. Answer them directly, from your own expertise.`
        : `It is your turn, ${self.name}. The user asked you to review ${from?.role === "user" ? "their" : `${who}'s`} message above and respond: say what holds up, what is wrong or missing, and what you would change.`,
    );
  }
  if (after.length)
    lines.push(`${names(after)} will reply after you, so leave their parts to them.`);
  return `<your_turn>\n${lines.join(" ")}\n</your_turn>`;
}

/**
 * The whole message one member's turn sends: who it is (soul and memory),
 * who else is in the room, the earlier transcript, then this exchange labeled
 * by speaker, so a member reads both the user and the members before it.
 */
export function groupTurnPrompt({
  room,
  self,
  look,
  files,
  roster,
  messages,
  reason,
  after = [],
}: {
  room: string;
  self: GroupRosterEntry;
  look: IrgatLook;
  files: IrgatFiles;
  roster: readonly GroupRosterEntry[];
  /** The room's transcript so far, including this round's replies. */
  messages: readonly IrgatGroupMessage[];
  reason: GroupTurnReason;
  /** Names of the members still to reply this round. */
  after?: readonly string[];
}): string {
  const start = exchangeStart(messages, reason.messageId);
  const earlier = transcriptWindow(messages.slice(0, start), self.id);
  const exchange = messages
    .slice(start)
    .flatMap((message) => transcriptLine(message, self.id) ?? []);
  const context = [
    irgatContext(look, files, { soul: true, memory: true }),
    groupRoomBlock({ room, self, roster }),
  ];
  if (earlier.lines.length)
    context.push(
      `<group_transcript>\nEarlier in this room${
        earlier.dropped ? ` (${earlier.dropped} older lines left out)` : ""
      }:\n${earlier.lines.join("\n\n")}\n</group_transcript>`,
    );
  const message = [
    ...exchange,
    yourTurn({ self, reason, messages, start, after }),
  ].join("\n\n");
  return irgatTurn(message, context);
}

/** The reply as it should be stored: without a label the model echoed back. */
export function cleanGroupReply(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`^\\s*\\[Irgat:\\s*${escaped}(?:\\s*\\(you\\))?\\]\\s*`, "i"), "")
    .trim();
}
