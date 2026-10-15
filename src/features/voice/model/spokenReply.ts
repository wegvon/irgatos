import type { Block, QueuedMessage } from "../../sessions/model/session";

export type Reply = { id: string; text: string };

/**
 * The agent's closing message for the latest turn, once the turn is over.
 * Text before tool calls in the same turn is narration; only the last
 * assistant block answers.
 */
export function latestReply(
  blocks: readonly Block[],
  queued: readonly QueuedMessage[] = [],
): Reply | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (queued.some((message) => message.blockId === block.id)) continue;
    if (block.role === "user") return null;
    if (block.role === "assistant" && block.text.trim())
      return { id: block.id, text: block.text };
  }
  return null;
}

const ON_SCREEN = "The rest is on screen.";

/**
 * Markdown as a person would read it aloud: no code, no link targets, no
 * markup. Long replies stop at a sentence and point at the screen.
 */
export function spokenReply(markdown: string, limit = 900): string {
  let code = false;
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, () => {
      code = true;
      return "\n";
    })
    .replace(/<[^>\n]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/`([^`]+)`/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !/^\|?\s*:?-{3,}/.test(line))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^([-*+]|\d+[.)])\s+/, "")
        .replace(/^\|(.*)\|$/, (_, cells: string) =>
          cells
            .split("|")
            .map((cell) => cell.trim())
            .filter(Boolean)
            .join(", "),
        )
        .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1$2"),
    )
    .filter(Boolean)
    .map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return code ? "The reply is code. It is on screen." : "";
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
  );
  const head = end > limit / 3 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  return `${head} ${ON_SCREEN}`;
}

const SUMMARY_LIMIT = 400;
/** The lead is a sentence or two; the rest of the reply stays on screen. */
const LEAD_SENTENCES = 2;
const LEAD_LIMIT = 240;
/** Ways a reply addresses the user; only these are dropped as an opener. */
const ADDRESSES = new Set(
  "boss chief sir captain patron şef hocam abi abla efendim reis kaptan usta".split(
    " ",
  ),
);
const BULLET = /^([-*+]|\d+[.)])\s+/;
const NEXT_STEP =
  /^(\*\*|__)?(next( steps?)?|sonraki( adım(lar)?)?|bir sonraki adım)\b/i;
const CLOSING =
  /^(\*\*|__)?(next( steps?)?|sonraki|bir sonraki|want me to|should i|shall i|let me know|if you('d)? (want|like)|istersen|isterseniz|dilersen|dilerseniz)\b/i;

type Paragraph = { text: string; prose: boolean };

/** Prose paragraphs and single list items, with code, tables and headings gone. */
function paragraphs(markdown: string): Paragraph[] {
  const result: Paragraph[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) result.push({ text: prose.join(" "), prose: true });
    prose = [];
  };
  const lines = markdown.replace(/```[\s\S]*?(```|$)/g, "\n\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || line.startsWith("|")) {
      flush();
    } else if (BULLET.test(line)) {
      flush();
      result.push({ text: line, prose: false });
    } else {
      prose.push(line);
    }
  }
  flush();
  return result;
}

/** Ignores trailing markup, so `**Ship it?**` still ends with a question mark. */
const asks = (text: string) => /\?\W*$/.test(text.replace(/[*_`)\]]+$/, ""));

/** The leading sentences of `text` that fit in `limit`, or a clean cut. */
function sentences(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
  );
  if (end > limit / 3) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > limit / 2 ? space : limit).trimEnd()}…`;
}

/** Sentences that ask the user something. */
const questions = (text: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .filter(asks)
    .join(" ");

/** "Boss, done." → "done.": the name a reply opens with is not news. */
function dropAddress(text: string): string {
  const match = /^(\p{L}{2,15}),\s+(?=\S)/u.exec(text);
  if (!match || !ADDRESSES.has(match[1].toLocaleLowerCase("tr"))) return text;
  return text.slice(match[0].length);
}

/** At most `count` sentences of `text`. */
const firstSentences = (text: string, count: number) =>
  text
    .split(/(?<=[.!?…])\s+/)
    .slice(0, count)
    .join(" ");

/**
 * What voice mode says when no model summarises the reply: the lead
 * paragraph, every question to the user, `Next:` lines, and a closing
 * paragraph that offers the next step. Lists, code and tables stay on screen.
 */
export function replySummary(markdown: string, limit = SUMMARY_LIMIT): string {
  const parts = paragraphs(markdown);
  const label = (part: Paragraph) =>
    /:\W*$/.test(part.text.replace(/[*_]+$/, ""));
  const prose = parts.filter((part) => part.prose && !label(part));
  const lead = prose[0];
  if (!lead) return spokenReply(markdown, limit);
  const last = prose[prose.length - 1];
  const tail: string[] = [];
  parts.forEach((part, index) => {
    if (part === lead) return;
    const text = part.text.replace(BULLET, "");
    if (NEXT_STEP.test(text)) {
      // "Next steps:" over a list: the first item is the step.
      const item = parts[index + 1];
      tail.push(
        label(part) && item && !item.prose
          ? `${text} ${item.text.replace(BULLET, "")}`
          : text,
      );
    } else if (part === last && CLOSING.test(text)) {
      tail.push(text);
    } else if (questions(text)) {
      tail.push(questions(text));
    }
  });
  const spokenTail = [...new Set(tail.map((text) => spokenReply(text, limit)))];
  const room = limit - spokenTail.join(" ").length - 1;
  const spokenLead = sentences(
    firstSentences(
      dropAddress(spokenReply(lead.text, Infinity)),
      LEAD_SENTENCES,
    ),
    Math.max(Math.min(room, LEAD_LIMIT), 120),
  );
  return [spokenLead, ...spokenTail].filter(Boolean).join(" ");
}
