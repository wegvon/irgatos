/** The draft around the spot dictation writes into. */
export type DictationAnchor = {
  before: string;
  /** Text the selection covered; dictation replaces it, cancel restores it. */
  selected: string;
  after: string;
};

export function dictationAnchor(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): DictationAnchor {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  return {
    before: text.slice(0, start),
    selected: text.slice(start, end),
    after: text.slice(end),
  };
}

const CLOSES_WORD = /^[\s.,;:!?)\]}"'’”…]/;

/**
 * The draft with `transcript` in place of the selection, spaced from the
 * words around it, and where the caret lands after it. Each partial is
 * applied to the same anchor, so a recognizer revising earlier words never
 * leaves stale text behind.
 */
export function spliceTranscript(
  anchor: DictationAnchor,
  transcript: string,
): { text: string; caret: number } {
  const spoken = transcript.trim();
  if (!spoken) {
    const text = anchor.before + anchor.after;
    return { text, caret: anchor.before.length };
  }
  const lead = anchor.before && !/\s$/.test(anchor.before) ? " " : "";
  const trail = anchor.after && !CLOSES_WORD.test(anchor.after) ? " " : "";
  const head = `${anchor.before}${lead}${spoken}`;
  return { text: `${head}${trail}${anchor.after}`, caret: head.length };
}

/** The draft exactly as it was before dictation began. */
export function restoreAnchor(anchor: DictationAnchor): {
  text: string;
  selectionStart: number;
  selectionEnd: number;
} {
  return {
    text: anchor.before + anchor.selected + anchor.after,
    selectionStart: anchor.before.length,
    selectionEnd: anchor.before.length + anchor.selected.length,
  };
}
