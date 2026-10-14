import { describe, expect, it } from "vitest";
import {
  diffCommentLocation,
  diffCommentReviewTarget,
  formatDiffComment,
} from "./diffComment";

describe("diff comments", () => {
  it("formats a comment on a current line for the composer", () => {
    const target = {
      path: "src/auth.ts",
      line: {
        kind: "add" as const,
        text: "const token = readCookie();",
        oldNumber: null,
        newNumber: 42,
      },
    };

    expect(diffCommentLocation(target)).toBe("src/auth.ts:42");
    expect(formatDiffComment(target, " Please handle a missing cookie. ")).toBe(
      [
        "Diff comment on `src/auth.ts:42`:",
        "",
        "> +const token = readCookie();",
        "",
        "Please handle a missing cookie.",
      ].join("\n"),
    );
  });

  it("uses the old line number and labels deleted lines", () => {
    expect(
      formatDiffComment(
        {
          path: "src/old.ts",
          line: {
            kind: "del",
            text: "legacy();",
            oldNumber: 8,
            newNumber: null,
          },
        },
        "Keep this behavior.",
      ),
    ).toContain("`src/old.ts:8` (deleted line)");
  });

  it("ignores an empty comment", () => {
    expect(
      formatDiffComment(
        {
          path: "README.md",
          line: {
            kind: "context",
            text: "Title",
            oldNumber: 1,
            newNumber: 1,
          },
        },
        " \n ",
      ),
    ).toBe("");
  });
});

describe("diff review targets", () => {
  it("anchors an added line to its new number", () => {
    expect(
      diffCommentReviewTarget({
        path: "src\\auth.ts",
        line: { kind: "add", text: "const t = 1;", oldNumber: null, newNumber: 8 },
      }),
    ).toEqual({
      source: "diff",
      targetPath: "src/auth.ts",
      lineRange: { start: 8, end: 8 },
      selection: "+const t = 1;",
    });
  });

  it("anchors a deleted line to its old number and says so", () => {
    expect(
      diffCommentReviewTarget({
        path: "src/auth.ts",
        line: { kind: "del", text: "retry(5);", oldNumber: 41, newNumber: null },
      }),
    ).toMatchObject({
      lineRange: { start: 41, end: 41 },
      selection: "-retry(5);  (deleted line)",
    });
  });

  it("leaves out a line range it does not know", () => {
    const target = diffCommentReviewTarget({
      path: "src/auth.ts",
      line: { kind: "context", text: "}", oldNumber: null, newNumber: null },
    });
    expect(target.lineRange).toBeUndefined();
    expect(target.selection).toBe(" }");
  });
});
