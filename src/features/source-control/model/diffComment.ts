import type { UnifiedLine } from "./unifiedDiff";

export type DiffCommentTarget = {
  path: string;
  line: UnifiedLine;
};

export function diffCommentLocation({ path, line }: DiffCommentTarget): string {
  const number = line.kind === "del" ? line.oldNumber : line.newNumber;
  return number == null ? path : `${path}:${number}`;
}

/** A diff line as a review note's target: its file, line, and marked text. */
export function diffCommentReviewTarget({ path, line }: DiffCommentTarget): {
  source: "diff";
  targetPath: string;
  lineRange?: { start: number; end: number };
  selection: string;
} {
  const number = line.kind === "del" ? line.oldNumber : line.newNumber;
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return {
    source: "diff",
    targetPath: path.replace(/\\/g, "/"),
    ...(number != null ? { lineRange: { start: number, end: number } } : {}),
    selection: `${marker}${line.text}${line.kind === "del" ? "  (deleted line)" : ""}`,
  };
}

export function formatDiffComment(
  target: DiffCommentTarget,
  comment: string,
): string {
  const body = comment.replace(/\r\n?/g, "\n").trim();
  if (!body) return "";

  const marker =
    target.line.kind === "add" ? "+" : target.line.kind === "del" ? "-" : " ";
  const deleted = target.line.kind === "del" ? " (deleted line)" : "";
  const location = diffCommentLocation(target).replace(/`/g, "\\`");

  return [
    `Diff comment on \`${location}\`${deleted}:`,
    "",
    `> ${marker}${target.line.text}`,
    "",
    body,
  ].join("\n");
}
