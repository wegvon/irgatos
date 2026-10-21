import type { Block } from "../../sessions/model/session";
import {
  readStoredJson,
  writeStoredJson,
} from "../../../shared/lib/safeStorage";

/** User turns a new Irgat chat waits for before it asks to be named. */
export const CHAT_NAME_PROMPT_TURNS = 2;
const DISMISSED_KEY = "irgat:chat-name-prompt-dismissed";
/** Enough for every chat a roster keeps; the oldest are dropped first. */
const MAX_DISMISSED = 500;
const MAX_SUGGESTION = 48;

/** True for the names a chat gets before anyone names it. */
export function isPlaceholderChatTitle(displayTitle: string): boolean {
  const title = displayTitle.trim();
  return !title || /^Chat \d+$/.test(title) || title === "New session";
}

/** The turns the user typed, not the ones another Irgat sent. */
export function userTurnTexts(blocks: readonly Block[]): string[] {
  return blocks
    .filter(
      (block) => block.role === "user" && !block.fromIrgat && !block.draft,
    )
    .map((block) => block.text);
}

export function shouldPromptChatName(input: {
  displayTitle: string;
  blocks: readonly Block[];
  busy: boolean;
  /** Read last: it goes to storage. */
  dismissed: () => boolean;
}): boolean {
  return (
    !input.busy &&
    isPlaceholderChatTitle(input.displayTitle) &&
    userTurnTexts(input.blocks).length >= CHAT_NAME_PROMPT_TURNS &&
    !input.dismissed()
  );
}

/** A short name from the first thing the user asked; empty when nothing fits. */
export function suggestChatName(blocks: readonly Block[]): string {
  for (const text of userTurnTexts(blocks)) {
    const line = text
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
    if (!line) continue;
    const words = line
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/(^|\s)[@/][\w.-]+/g, " ")
      .replace(/[`*_#>~[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // The first sentence is usually the ask itself.
      .split(/(?<=[.!?])\s/)[0]
      .replace(/[.!?:;,]+$/, "")
      .trim();
    if (!words) continue;
    const name =
      words.length <= MAX_SUGGESTION
        ? words
        : `${words.slice(0, MAX_SUGGESTION).replace(/\s+\S*$/, "")}…`;
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
  }
  return "";
}

function dismissedIds(): string[] {
  const value = readStoredJson(DISMISSED_KEY);
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

export function chatNamePromptDismissed(sessionId: string): boolean {
  return dismissedIds().includes(sessionId);
}

/** "Later" is for good: the chat keeps its name until renamed by hand. */
export function dismissChatNamePrompt(sessionId: string): void {
  const ids = dismissedIds().filter((id) => id !== sessionId);
  ids.push(sessionId);
  try {
    writeStoredJson(DISMISSED_KEY, ids.slice(-MAX_DISMISSED));
  } catch {
    // Without storage the prompt simply comes back next launch.
  }
}
