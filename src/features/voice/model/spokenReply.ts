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
