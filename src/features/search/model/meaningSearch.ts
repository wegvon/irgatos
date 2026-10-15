import { invoke } from "@tauri-apps/api/core";
import { sessionDisplayTitle } from "../../sessions/model/session";
import {
  asHarness,
  type ChatMeaningHit,
  type CodeMeaningHit,
} from "./appSearch";

/** "on", "off" (not set up), "none" (project not indexed), "unavailable". */
export type MeaningState = "on" | "off" | "none" | "unavailable";

type ChatMeaningRow = {
  sessionId: string;
  blockId: string;
  cwd: string;
  harness: string;
  title: string;
  updatedAt: number;
  preview: string;
  score: number;
};

export type ChatMeaningResult = {
  hits: ChatMeaningRow[];
  semantic: MeaningState;
  note: string | null;
  indexed: number;
  total: number;
};

type CodeMeaningRow = {
  path: string;
  relative: string;
  startLine: number;
  endLine: number;
  preview: string;
  score: number;
};

export type CodeMeaningResult = {
  hits: CodeMeaningRow[];
  semantic: MeaningState;
  note: string | null;
  index: "complete" | "partial" | "indexing" | "none" | null;
};

/** Brings the chat-history index up to date in the background. */
export function warmChatMeaning(): Promise<void> {
  return invoke<void>("chat_semantic_warm");
}

export function searchChatsByMeaning(
  query: string,
  cwd?: string,
  limit = 16,
): Promise<ChatMeaningResult> {
  return invoke<ChatMeaningResult>("chat_semantic_search", {
    query,
    cwd: cwd ?? null,
    limit,
  });
}

export function searchCodeByMeaning(
  cwd: string,
  query: string,
  limit = 16,
): Promise<CodeMeaningResult> {
  return invoke<CodeMeaningResult>("semantic_code_search", {
    cwd,
    query,
    limit,
  });
}

export function hitsFromChatMeaning(rows: ChatMeaningRow[]): ChatMeaningHit[] {
  return rows.map((row) => {
    const harness = asHarness(row.harness);
    return {
      id: `chatMeaning:${row.sessionId}:${row.blockId}`,
      kind: "chatMeaning",
      sessionId: row.sessionId,
      cwd: row.cwd,
      harness,
      title: sessionDisplayTitle(row.title, harness),
      updatedAt: row.updatedAt,
      blockId: row.blockId,
      preview: row.preview,
      score: row.score,
    };
  });
}

export function hitsFromCodeMeaning(rows: CodeMeaningRow[]): CodeMeaningHit[] {
  return rows.map((row) => ({
    id: `codeMeaning:${row.path}:${row.startLine}`,
    kind: "codeMeaning",
    path: row.path,
    relative: row.relative,
    name: row.relative.split("/").pop() ?? row.relative,
    line: row.startLine,
    preview: row.preview,
    score: row.score,
  }));
}

/**
 * The line under the results: how meaning search stands. Null when it is on
 * and fully indexed, so the usual case stays quiet.
 */
export function meaningNotice(
  chats: Pick<ChatMeaningResult, "semantic" | "note" | "indexed" | "total"> | null,
  code: Pick<CodeMeaningResult, "semantic" | "note" | "index"> | null,
): string | null {
  const notes: string[] = [];
  if (chats?.semantic === "off" || code?.semantic === "off") {
    return "Matching words only. Turn on Semantic search in Settings > Providers to also search by meaning.";
  }
  if (chats?.note) notes.push(chats.note);
  else if (chats?.semantic === "on" && chats.total > chats.indexed) {
    notes.push(
      `Indexing chat history for meaning: ${chats.indexed} of ${chats.total} messages so far.`,
    );
  }
  if (code?.note && code.note !== chats?.note) notes.push(code.note);
  else if (code?.semantic === "on" && code.index && code.index !== "complete") {
    notes.push("This project's code index is still being built.");
  }
  return notes.length > 0 ? notes.join(" ") : null;
}
