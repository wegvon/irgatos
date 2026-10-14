import { describe, expect, it } from "vitest";
import {
  countReviewNotes,
  createReviewNote,
  formatLineRange,
  formatReviewBatch,
  locateSelection,
  MAX_REVIEW_TEXT,
  orderReviewNotes,
  reviewSubject,
  sanitizeReviewNote,
  type ReviewNote,
  type ReviewNoteInput,
} from "./reviewNotes";

function note(
  partial: Partial<ReviewNote> & Pick<ReviewNote, "id">,
): ReviewNote {
  return {
    kind: "change",
    source: "file",
    targetPath: "src/app.ts",
    selection: "",
    note: "Fix it",
    status: "open",
    createdAt: 1,
    ...partial,
  };
}

const input: ReviewNoteInput = {
  kind: "question",
  source: "file",
  targetPath: "src/app.ts",
  lineRange: { start: 4, end: 6 },
  selection: "const a = 1;\r\nconst b = 2;  \n",
  note: "  Why two constants?\r\n",
};

describe("createReviewNote", () => {
  it("normalizes text and starts open", () => {
    expect(createReviewNote(input, 50, "rv-1")).toEqual({
      id: "rv-1",
      kind: "question",
      source: "file",
      targetPath: "src/app.ts",
      lineRange: { start: 4, end: 6 },
      selection: "const a = 1;\nconst b = 2;",
      note: "Why two constants?",
      status: "open",
      createdAt: 50,
    });
  });

  it("refuses notes with nothing to say or nowhere to point", () => {
    expect(createReviewNote({ ...input, note: "   " }, 1, "a")).toBeNull();
    expect(createReviewNote({ ...input, targetPath: " \n" }, 1, "a")).toBeNull();
    expect(
      createReviewNote({ ...input, kind: "nit" as never }, 1, "a"),
    ).toBeNull();
    expect(
      createReviewNote({ ...input, source: "web" as never }, 1, "a"),
    ).toBeNull();
  });

  it("drops a backwards or fractional line range but keeps the note", () => {
    const backwards = createReviewNote(
      { ...input, lineRange: { start: 9, end: 2 } },
      1,
      "a",
    );
    expect(backwards?.lineRange).toBeUndefined();
    const fractional = createReviewNote(
      { ...input, lineRange: { start: 1.5, end: 2 } },
      1,
      "a",
    );
    expect(fractional?.lineRange).toBeUndefined();
    expect(fractional?.note).toBe("Why two constants?");
  });

  it("clips oversized text and folds a multi-line target onto one line", () => {
    const created = createReviewNote(
      {
        ...input,
        targetPath: "Reply in\n“Plan”",
        selection: "x".repeat(MAX_REVIEW_TEXT + 50),
        note: "y".repeat(MAX_REVIEW_TEXT + 50),
      },
      1,
      "a",
    )!;
    expect(created.targetPath).toBe("Reply in “Plan”");
    expect(created.selection).toHaveLength(MAX_REVIEW_TEXT);
    expect(created.selection.endsWith("…")).toBe(true);
    expect(created.note).toHaveLength(MAX_REVIEW_TEXT);
  });
});

describe("sanitizeReviewNote", () => {
  it("keeps a valid stored note", () => {
    const stored = note({
      id: "a",
      status: "sent",
      sentAt: 5,
      lineRange: { start: 2, end: 2 },
    });
    expect(sanitizeReviewNote(JSON.parse(JSON.stringify(stored)))).toEqual(
      stored,
    );
  });

  it("drops notes a hand-edited store got wrong", () => {
    expect(sanitizeReviewNote(null)).toBeNull();
    expect(sanitizeReviewNote({ ...note({ id: "" }) })).toBeNull();
    expect(sanitizeReviewNote({ ...note({ id: "a" }), kind: "nit" })).toBeNull();
    expect(
      sanitizeReviewNote({ ...note({ id: "a" }), status: "draft" }),
    ).toBeNull();
    expect(sanitizeReviewNote({ ...note({ id: "a" }), note: " " })).toBeNull();
  });

  it("repairs optional fields instead of dropping the note", () => {
    const repaired = sanitizeReviewNote({
      ...note({ id: "a" }),
      selection: 12,
      lineRange: { start: "1", end: 2 },
      createdAt: "yesterday",
      resolvedAt: Number.NaN,
    });
    expect(repaired).toMatchObject({ id: "a", selection: "", createdAt: 0 });
    expect(repaired?.lineRange).toBeUndefined();
    expect(repaired?.resolvedAt).toBeUndefined();
  });
});

describe("formatLineRange", () => {
  it("labels single lines and spans the way redline does", () => {
    expect(formatLineRange({ start: 7, end: 7 })).toBe("L7");
    expect(formatLineRange({ start: 7, end: 12 })).toBe("L7-12");
    expect(formatLineRange(undefined)).toBe("");
  });
});

describe("locateSelection", () => {
  const source = [
    "# Rollout plan",
    "",
    "1. Ship the **migration** first.",
    "2. Flip the flag for staff.",
    "3. Watch error rates.",
  ].join("\n");

  it("finds an exact selection", () => {
    expect(locateSelection(source, "Flip the flag for staff.")).toEqual({
      start: 4,
      end: 4,
    });
    expect(
      locateSelection(source, "Flip the flag for staff.\n3. Watch"),
    ).toEqual({ start: 4, end: 5 });
  });

  it("falls back to lines when rendering stripped the Markdown", () => {
    expect(locateSelection(source, "Rollout plan")).toEqual({ start: 1, end: 1 });
    expect(
      locateSelection(source, "Ship the migration first.\nWatch error rates."),
    ).toEqual({ start: 3, end: 5 });
  });

  it("reads through links, checklists, and inline code", () => {
    const doc = [
      "- [x] Read [the spec](https://example.com/spec)",
      "- [ ] Call `migrate()` before deploy",
    ].join("\n");
    expect(locateSelection(doc, "Read the spec")).toEqual({ start: 1, end: 1 });
    expect(locateSelection(doc, "Call migrate() before")).toEqual({
      start: 2,
      end: 2,
    });
  });

  it("returns nothing it cannot place", () => {
    expect(locateSelection(source, "not in the plan")).toBeUndefined();
    expect(locateSelection(source, "  ")).toBeUndefined();
    expect(locateSelection("", "anything")).toBeUndefined();
  });

  it("handles CRLF sources", () => {
    expect(locateSelection("a\r\nb\r\nc", "c")).toEqual({ start: 3, end: 3 });
  });
});

describe("orderReviewNotes", () => {
  it("groups by target in first-seen order, then sorts by line", () => {
    const ordered = orderReviewNotes([
      note({ id: "b1", targetPath: "b.md", lineRange: { start: 9, end: 9 } }),
      note({ id: "a1", targetPath: "a.ts", lineRange: { start: 20, end: 21 } }),
      note({ id: "b0", targetPath: "b.md" }),
      note({ id: "b2", targetPath: "b.md", lineRange: { start: 2, end: 2 } }),
      note({ id: "a0", targetPath: "a.ts", lineRange: { start: 3, end: 3 } }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "b2",
      "b1",
      "b0",
      "a0",
      "a1",
    ]);
  });
});

describe("reviewSubject", () => {
  it("names up to two targets and counts the rest", () => {
    expect(reviewSubject([note({ id: "1" })])).toBe("src/app.ts");
    expect(
      reviewSubject([
        note({ id: "1", targetPath: "a" }),
        note({ id: "2", targetPath: "b" }),
      ]),
    ).toBe("a, b");
    expect(
      reviewSubject([
        note({ id: "1", targetPath: "a" }),
        note({ id: "2", targetPath: "b" }),
        note({ id: "3", targetPath: "c" }),
        note({ id: "4", targetPath: "a" }),
        note({ id: "5", targetPath: "d" }),
      ]),
    ).toBe("a, b and 2 more");
  });
});

describe("formatReviewBatch", () => {
  it("formats one target's notes as a numbered redline batch", () => {
    const text = formatReviewBatch([
      note({
        id: "2",
        kind: "question",
        lineRange: { start: 30, end: 30 },
        selection: "retry(3)",
        note: "Why three retries?",
      }),
      note({
        id: "1",
        kind: "change",
        lineRange: { start: 12, end: 14 },
        selection: "const x = 1;\nconst y = 2;",
        note: "Rename x to count.\n\nKeep y.",
      }),
      note({ id: "3", kind: "comment", note: "Nice structure overall." }),
    ]);
    expect(text).toBe(
      [
        "⁂ redline — review of src/app.ts (3 notes)",
        "",
        "Handle every note below in this one turn:",
        "- [change]: apply it by editing the named file or document in place. Do not create a new copy or file.",
        "- [question]: answer it directly. Change nothing unless the answer requires it.",
        "- [comment]: take it into account; reply only if it changes the work.",
        "Reply with a numbered list that matches these notes, saying what you did for each.",
        "",
        "1. [change] L12-14",
        "   > const x = 1;",
        "   > const y = 2;",
        "   → Rename x to count.",
        "",
        "     Keep y.",
        "",
        "2. [question] L30",
        "   > retry(3)",
        "   → Why three retries?",
        "",
        "3. [comment]",
        "   → Nice structure overall.",
      ].join("\n"),
    );
  });

  it("names each target when the review spans several", () => {
    const text = formatReviewBatch([
      note({ id: "1", targetPath: "src/a.ts", lineRange: { start: 1, end: 1 } }),
      note({
        id: "2",
        source: "message",
        targetPath: "Reply in “Fix `login`”",
        selection: "We could cache it.",
      }),
    ]);
    expect(text.split("\n")[0]).toBe(
      "⁂ redline — review of src/a.ts, Reply in “Fix `login`” (2 notes)",
    );
    expect(text).toContain("1. [change] `src/a.ts` L1\n   → Fix it");
    expect(text).toContain(
      "2. [change] `Reply in “Fix 'login'”`\n   > We could cache it.",
    );
  });

  it("only explains the kinds the batch uses, in the singular for one note", () => {
    const text = formatReviewBatch([note({ id: "1", kind: "question" })]);
    expect(text.split("\n")[0]).toBe("⁂ redline — review of src/app.ts (1 note)");
    expect(text).toContain("- [question]");
    expect(text).not.toContain("- [change]");
    expect(text).not.toContain("- [comment]");
  });

  it("shortens long quotes but keeps the full instruction", () => {
    const selection = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const text = formatReviewBatch([
      note({ id: "1", selection, note: "Collapse this block." }),
    ]);
    const quoted = text.split("\n").filter((line) => line.startsWith("   >"));
    expect(quoted).toHaveLength(8);
    expect(quoted[7]).toBe("   > line 8…");
    expect(text.endsWith("   → Collapse this block.")).toBe(true);

    const wide = formatReviewBatch([
      note({ id: "1", selection: "z".repeat(1000) }),
    ]);
    const quote = wide.split("\n").find((line) => line.startsWith("   >"))!;
    expect(quote.length).toBeLessThan(420);
    expect(quote.endsWith("…")).toBe(true);
  });

  it("keeps blank lines inside a quote as bare markers", () => {
    const text = formatReviewBatch([
      note({ id: "1", selection: "first\n\nthird" }),
    ]);
    expect(text).toContain("   > first\n   >\n   > third");
  });

  it("is empty for an empty review", () => {
    expect(formatReviewBatch([])).toBe("");
  });
});

describe("countReviewNotes", () => {
  it("counts each status", () => {
    expect(
      countReviewNotes([
        note({ id: "1" }),
        note({ id: "2", status: "sent" }),
        note({ id: "3", status: "resolved" }),
        note({ id: "4" }),
      ]),
    ).toEqual({ open: 2, sent: 1, resolved: 1 });
  });
});
