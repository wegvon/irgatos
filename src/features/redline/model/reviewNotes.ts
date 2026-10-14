export type ReviewKind = "change" | "question" | "comment";

export type ReviewStatus = "open" | "sent" | "resolved";

export type ReviewSource = "file" | "diff" | "document" | "artifact" | "message";

export type ReviewLineRange = { start: number; end: number };

export type ReviewNote = {
  id: string;
  kind: ReviewKind;
  source: ReviewSource;
  /** File path, document name, artifact title, or message label. */
  targetPath: string;
  lineRange?: ReviewLineRange;
  selection: string;
  note: string;
  status: ReviewStatus;
  createdAt: number;
  sentAt?: number;
  resolvedAt?: number;
};

export type ReviewNoteInput = {
  kind: ReviewKind;
  source: ReviewSource;
  targetPath: string;
  lineRange?: ReviewLineRange;
  selection: string;
  note: string;
};

export const REVIEW_KINDS: readonly ReviewKind[] = [
  "change",
  "question",
  "comment",
];

export const REVIEW_KIND_META: Record<
  ReviewKind,
  { glyph: string; label: string }
> = {
  change: { glyph: "✎", label: "Change" },
  question: { glyph: "◇", label: "Question" },
  comment: { glyph: "◆", label: "Comment" },
};

const SOURCES: readonly ReviewSource[] = [
  "file",
  "diff",
  "document",
  "artifact",
  "message",
];
const STATUSES: readonly ReviewStatus[] = ["open", "sent", "resolved"];

/** One note's selection or instruction; longer text is cut, not refused. */
export const MAX_REVIEW_TEXT = 4000;
const MAX_TARGET = 300;
const QUOTE_LINES = 8;
const QUOTE_CHARS = 400;

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isReviewKind(value: unknown): value is ReviewKind {
  return REVIEW_KINDS.includes(value as ReviewKind);
}

function validRange(value: unknown): ReviewLineRange | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { start, end } = value as Record<string, unknown>;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  const from = start as number;
  const to = end as number;
  if (from < 1 || to < from) return undefined;
  return { start: from, end: to };
}

/** Builds a fresh open note, or null when it would have nothing to say. */
export function createReviewNote(
  input: ReviewNoteInput,
  now: number,
  id: string,
): ReviewNote | null {
  const note = normalizeText(input.note).trim();
  const selection = normalizeText(input.selection).replace(/^\n+|\s+$/g, "");
  const targetPath = input.targetPath.replace(/[\r\n]+/g, " ").trim();
  if (!isReviewKind(input.kind) || !SOURCES.includes(input.source)) return null;
  if (!note || !targetPath) return null;
  const lineRange = validRange(input.lineRange);
  return {
    id,
    kind: input.kind,
    source: input.source,
    targetPath: clip(targetPath, MAX_TARGET),
    ...(lineRange ? { lineRange } : {}),
    selection: clip(selection, MAX_REVIEW_TEXT),
    note: clip(note, MAX_REVIEW_TEXT),
    status: "open",
    createdAt: now,
  };
}

/** Restores a stored note, dropping anything a hand-edited store got wrong. */
export function sanitizeReviewNote(raw: unknown): ReviewNote | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  if (!isReviewKind(value.kind)) return null;
  if (!SOURCES.includes(value.source as ReviewSource)) return null;
  if (!STATUSES.includes(value.status as ReviewStatus)) return null;
  if (typeof value.targetPath !== "string" || !value.targetPath) return null;
  if (typeof value.note !== "string" || !value.note.trim()) return null;
  const lineRange = validRange(value.lineRange);
  const time = (key: string) =>
    typeof value[key] === "number" && Number.isFinite(value[key])
      ? (value[key] as number)
      : undefined;
  return {
    id: value.id,
    kind: value.kind,
    source: value.source as ReviewSource,
    targetPath: clip(value.targetPath, MAX_TARGET),
    ...(lineRange ? { lineRange } : {}),
    selection:
      typeof value.selection === "string"
        ? clip(value.selection, MAX_REVIEW_TEXT)
        : "",
    note: clip(value.note, MAX_REVIEW_TEXT),
    status: value.status as ReviewStatus,
    createdAt: time("createdAt") ?? 0,
    ...(time("sentAt") != null ? { sentAt: time("sentAt") } : {}),
    ...(time("resolvedAt") != null ? { resolvedAt: time("resolvedAt") } : {}),
  };
}

export function formatLineRange(range: ReviewLineRange | undefined): string {
  if (!range) return "";
  return range.start === range.end
    ? `L${range.start}`
    : `L${range.start}-${range.end}`;
}

/** A Markdown line as it reads once rendered: no block markers or inline syntax. */
function plainMarkdownLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Where a selection sits in its source, by line. Rendered Markdown loses its
 * syntax on the way to the DOM, so an exact match falls back to the first
 * selected line found inside a source line.
 */
export function locateSelection(
  source: string,
  selection: string,
): ReviewLineRange | undefined {
  const text = normalizeText(source);
  const wanted = normalizeText(selection).trim();
  if (!text || !wanted) return undefined;
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length;

  const exact = text.indexOf(wanted);
  if (exact >= 0) {
    return {
      start: lineOf(exact),
      end: lineOf(exact + wanted.length),
    };
  }

  const wantedLines = wanted
    .split("\n")
    .map(plainMarkdownLine)
    .filter(Boolean);
  if (!wantedLines.length) return undefined;
  const sourceLines = text.split("\n").map(plainMarkdownLine);
  const find = (needle: string, from: number) => {
    for (let index = from; index < sourceLines.length; index += 1) {
      if (sourceLines[index].includes(needle)) return index;
    }
    return -1;
  };
  const first = find(wantedLines[0], 0);
  if (first < 0) return undefined;
  const lastLine = wantedLines[wantedLines.length - 1];
  const last = wantedLines.length > 1 ? find(lastLine, first) : first;
  return { start: first + 1, end: (last < 0 ? first : last) + 1 };
}

function quoteLines(selection: string): string[] {
  const text = normalizeText(selection).replace(/^\n+|\s+$/g, "");
  if (!text) return [];
  let lines = text.split("\n");
  let cut = false;
  if (lines.length > QUOTE_LINES) {
    lines = lines.slice(0, QUOTE_LINES);
    cut = true;
  }
  let joined = lines.join("\n");
  if (joined.length > QUOTE_CHARS) {
    joined = joined.slice(0, QUOTE_CHARS);
    cut = true;
  }
  const out = joined.split("\n");
  if (cut) out[out.length - 1] = `${out[out.length - 1]}…`;
  return out.map((line) => (line ? `> ${line}` : ">"));
}

function codeSpan(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

/** Notes grouped by target in first-seen order, then by line within a target. */
export function orderReviewNotes(notes: readonly ReviewNote[]): ReviewNote[] {
  const targets: string[] = [];
  for (const note of notes) {
    if (!targets.includes(note.targetPath)) targets.push(note.targetPath);
  }
  return targets.flatMap((target) =>
    notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.targetPath === target)
      .sort((a, b) => {
        const left = a.note.lineRange?.start ?? Number.POSITIVE_INFINITY;
        const right = b.note.lineRange?.start ?? Number.POSITIVE_INFINITY;
        return left === right ? a.index - b.index : left - right;
      })
      .map(({ note }) => note),
  );
}

export function reviewSubject(notes: readonly ReviewNote[]): string {
  const targets = [...new Set(notes.map((note) => note.targetPath))];
  if (targets.length <= 2) return targets.join(", ");
  return `${targets.slice(0, 2).join(", ")} and ${targets.length - 2} more`;
}

/**
 * The single turn a review becomes: a header naming what was reviewed, how to
 * treat each kind, then every note with its anchor, quote, and instruction.
 */
export function formatReviewBatch(notes: readonly ReviewNote[]): string {
  if (!notes.length) return "";
  const ordered = orderReviewNotes(notes);
  const single = new Set(ordered.map((note) => note.targetPath)).size === 1;
  const count = `${ordered.length} ${ordered.length === 1 ? "note" : "notes"}`;
  const kinds = new Set(ordered.map((note) => note.kind));

  const header = [
    `⁂ redline — review of ${reviewSubject(ordered)} (${count})`,
    "",
    "Handle every note below in this one turn:",
    ...(kinds.has("change")
      ? [
          "- [change]: apply it by editing the named file or document in place. Do not create a new copy or file.",
        ]
      : []),
    ...(kinds.has("question")
      ? ["- [question]: answer it directly. Change nothing unless the answer requires it."]
      : []),
    ...(kinds.has("comment")
      ? ["- [comment]: take it into account; reply only if it changes the work."]
      : []),
    "Reply with a numbered list that matches these notes, saying what you did for each.",
  ];

  const items = ordered.map((note, index) => {
    const anchor = [
      single ? "" : codeSpan(note.targetPath),
      formatLineRange(note.lineRange),
    ]
      .filter(Boolean)
      .join(" ");
    const head = `${index + 1}. [${note.kind}]${anchor ? ` ${anchor}` : ""}`;
    const [first, ...rest] = normalizeText(note.note).trim().split("\n");
    return [
      head,
      ...quoteLines(note.selection).map((line) => `   ${line}`),
      `   → ${first}`,
      ...rest.map((line) => (line ? `     ${line}` : "")),
    ].join("\n");
  });

  return [...header, "", items.join("\n\n")].join("\n");
}

export type ReviewCounts = Record<ReviewStatus, number>;

export function countReviewNotes(notes: readonly ReviewNote[]): ReviewCounts {
  const counts: ReviewCounts = { open: 0, sent: 0, resolved: 0 };
  for (const note of notes) counts[note.status] += 1;
  return counts;
}
