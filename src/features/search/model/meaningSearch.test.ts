import { describe, expect, it } from "vitest";
import { flattenGrouped, groupHits, type AppSearchHit } from "./appSearch";
import {
  hitsFromChatMeaning,
  hitsFromCodeMeaning,
  meaningNotice,
} from "./meaningSearch";

const chatRows = [
  {
    sessionId: "s1",
    blockId: "b1",
    cwd: "/p",
    harness: "claude",
    title: "Mail bugs",
    updatedAt: 1,
    preview: "Why does the list crash?",
    score: 0.4,
  },
  {
    sessionId: "s2",
    blockId: "b2",
    cwd: "/p",
    harness: "claude",
    title: "Theme",
    updatedAt: 2,
    preview: "Dark theme please",
    score: 0.6,
  },
];

describe("meaning hits", () => {
  it("drop turns and files that word search already shows", () => {
    const word: AppSearchHit[] = [
      {
        id: "message:s1:b1",
        kind: "message",
        sessionId: "s1",
        cwd: "/p",
        harness: "claude",
        title: "Mail bugs",
        updatedAt: 1,
        blockId: "b1",
        role: "user",
        preview: "crash",
        score: 20,
      },
      {
        id: "content:/p/a.rs:3:1",
        kind: "content",
        path: "/p/a.rs",
        relative: "a.rs",
        name: "a.rs",
        line: 3,
        column: 1,
        preview: "crash",
      },
    ];
    const code = hitsFromCodeMeaning([
      { path: "/p/a.rs", relative: "a.rs", startLine: 1, endLine: 60, preview: "x", score: 0.5 },
      { path: "/p/b.rs", relative: "b.rs", startLine: 40, endLine: 99, preview: "y", score: 0.4 },
    ]);
    const grouped = groupHits(
      [...word, ...hitsFromChatMeaning(chatRows), ...code],
      "all",
    );
    expect(grouped.chatMeaning.map((hit) => hit.sessionId)).toEqual(["s2"]);
    expect(grouped.codeMeaning.map((hit) => hit.relative)).toEqual(["b.rs"]);
    expect(grouped.codeMeaning[0].line).toBe(40);
    // Meaning-only hits follow the word hits of the same kind.
    expect(flattenGrouped(grouped).map((hit) => hit.kind)).toEqual([
      "message",
      "chatMeaning",
      "content",
      "codeMeaning",
    ]);
  });

  it("stay out of scopes that do not search their kind", () => {
    const grouped = groupHits(hitsFromChatMeaning(chatRows), "files");
    expect(grouped.chatMeaning).toHaveLength(0);
    const conversations = groupHits(hitsFromChatMeaning(chatRows), "conversations");
    expect(conversations.chatMeaning.map((hit) => hit.score)).toEqual([0.6, 0.4]);
  });
});

describe("meaningNotice", () => {
  it("is quiet when everything is indexed", () => {
    expect(
      meaningNotice(
        { semantic: "on", note: null, indexed: 10, total: 10 },
        { semantic: "on", note: null, index: "complete" },
      ),
    ).toBeNull();
    expect(
      meaningNotice({ semantic: "on", note: null, indexed: 3, total: 3 }, {
        semantic: "none",
        note: null,
        index: null,
      }),
    ).toBeNull();
  });

  it("says when meaning search is off, unavailable or still indexing", () => {
    expect(
      meaningNotice({ semantic: "off", note: null, indexed: 0, total: 0 }, null),
    ).toMatch(/Turn on Semantic search/);
    expect(
      meaningNotice({ semantic: "on", note: null, indexed: 40, total: 900 }, null),
    ).toBe("Indexing chat history for meaning: 40 of 900 messages so far.");
    expect(
      meaningNotice(
        { semantic: "unavailable", note: "Down.", indexed: 0, total: 0 },
        { semantic: "unavailable", note: "Down.", index: "complete" },
      ),
    ).toBe("Down.");
    expect(
      meaningNotice(null, { semantic: "on", note: null, index: "partial" }),
    ).toBe("This project's code index is still being built.");
  });
});
