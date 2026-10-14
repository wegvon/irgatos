import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import { latestReply, spokenReply } from "./spokenReply";

function block(id: string, role: Block["role"], text: string): Block {
  return { id, role, text } as Block;
}

describe("latestReply", () => {
  it("is the last assistant message after the latest prompt", () => {
    const blocks = [
      block("u1", "user", "fix it"),
      block("a1", "assistant", "Looking at the build."),
      block("t1", "tool", "npm test"),
      block("a2", "assistant", "Fixed the failing test."),
      block("a3", "assistant", "  "),
    ];
    expect(latestReply(blocks)).toEqual({
      id: "a2",
      text: "Fixed the failing test.",
    });
  });

  it("is nothing until the agent answers the newest prompt", () => {
    expect(
      latestReply([
        block("a1", "assistant", "Old answer"),
        block("u2", "user", "next question"),
      ]),
    ).toBeNull();
  });

  it("looks past a queued follow-up that is already on screen", () => {
    const blocks = [
      block("u1", "user", "first"),
      block("a1", "assistant", "Answer"),
      block("u2", "user", "queued"),
    ];
    expect(
      latestReply(blocks, [
        { id: "q1", blockId: "u2", text: "queued", attachments: [] },
      ]),
    ).toEqual({ id: "a1", text: "Answer" });
  });
});

describe("spokenReply", () => {
  it("reads prose and drops markup, code, and link targets", () => {
    const reply = [
      "## Done",
      "",
      "I **fixed** the `parseConfig` bug in [config.ts](src/config.ts).",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "- Added a test",
      "- Ran `npm test`",
      "",
      "See https://example.com/docs for more.",
    ].join("\n");
    expect(spokenReply(reply)).toBe(
      "Done. I fixed the parseConfig bug in config.ts. Added a test. Ran npm test. See a link for more.",
    );
  });

  it("reads table rows as lists and skips the divider", () => {
    expect(
      spokenReply("| File | Status |\n| --- | --- |\n| a.ts | changed |"),
    ).toBe("File, Status. a.ts, changed.");
  });

  it("says the reply is on screen when it is only code", () => {
    expect(spokenReply("```diff\n- a\n+ b\n```")).toBe(
      "The reply is code. It is on screen.",
    );
    expect(spokenReply("   ")).toBe("");
  });

  it("stops a long reply at a sentence and points at the screen", () => {
    const sentence = "This sentence is about forty characters. ";
    const spoken = spokenReply(sentence.repeat(40), 200);
    expect(spoken.length).toBeLessThan(260);
    expect(spoken).toMatch(/characters\. The rest is on screen\.$/);
  });

  it("keeps snake_case and single asterisks in maths intact", () => {
    expect(spokenReply("Use max_retries, so 2 * 3 is 6")).toBe(
      "Use max_retries, so 2 * 3 is 6.",
    );
  });
});
