export const ADD_TO_CHAT_EVENT = "irgat:add-to-chat";

export type AddToChatMode = "quote" | "plain";

export type AddToChatRequest = {
  text: string;
  mode: AddToChatMode;
};

export type QuoteRequest = {
  id: number;
  text: string;
  mode?: AddToChatMode;
};

export function requestAddToChat(text: string, mode: AddToChatMode = "quote") {
  if (typeof window === "undefined") return;
  const value = text.replace(/\r\n?/g, "\n").trim();
  if (!value) return;
  window.dispatchEvent(
    new CustomEvent<AddToChatRequest>(ADD_TO_CHAT_EVENT, {
      detail: { text: value, mode },
    }),
  );
}

export const INSERT_INTO_CHAT_EVENT = "irgat:insert-into-chat";

export type InsertIntoChatRequest = {
  sessionId: string;
  text: string;
  /** Set by the pane that took it, so a second pane on the same chat skips it. */
  handled?: boolean;
};

/**
 * Append `text` to one particular chat's draft, leaving what is typed there
 * in place. False when no mounted pane holds that chat.
 */
export function requestInsertIntoChat(
  sessionId: string,
  text: string,
): boolean {
  if (typeof window === "undefined") return false;
  const detail: InsertIntoChatRequest = { sessionId, text };
  window.dispatchEvent(
    new CustomEvent<InsertIntoChatRequest>(INSERT_INTO_CHAT_EVENT, { detail }),
  );
  return !!detail.handled;
}

/** Initial composer text for an add-to-chat request that opens a new session. */
export function composerSeedForAddToChat(
  text: string,
  mode: AddToChatMode = "quote",
): string {
  return mode === "plain"
    ? appendComposerInsert("", text)
    : appendSelectionQuote("", text);
}

export type QuoteConsumption = {
  draft: string;
  consumedId: number | null;
  changed: boolean;
};

export function isMarkdownBlockquotePosition(
  text: string,
  position: number,
): boolean {
  const index = Math.max(0, Math.min(position, text.length));
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  return /^ {0,3}>/.test(text.slice(lineStart, index));
}

export function appendSelectionQuote(draft: string, text: string): string {
  const selected = text.replace(/\r\n?/g, "\n").trim();
  if (!selected) return draft;

  const quote = selected
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return joinComposerInsert(draft, quote);
}

export function appendComposerInsert(draft: string, text: string): string {
  const selected = text.replace(/\r\n?/g, "\n").trim();
  if (!selected) return draft;
  return joinComposerInsert(draft, selected);
}

export function consumeQuoteRequest(
  draft: string,
  consumedId: number | null,
  request: QuoteRequest | undefined,
): QuoteConsumption {
  if (!request || request.id === consumedId) {
    return { draft, consumedId, changed: false };
  }

  const next =
    request.mode === "plain"
      ? appendComposerInsert(draft, request.text)
      : appendSelectionQuote(draft, request.text);
  return {
    draft: next,
    consumedId: request.id,
    changed: next !== draft,
  };
}

export function acknowledgeQuoteRequest(
  current: QuoteRequest | undefined,
  handledId: number,
): QuoteRequest | undefined {
  return current?.id === handledId ? undefined : current;
}

function joinComposerInsert(draft: string, block: string): string {
  const separator =
    draft.length === 0
      ? ""
      : draft.endsWith("\n\n")
        ? ""
        : draft.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${draft}${separator}${block}\n\n`;
}
