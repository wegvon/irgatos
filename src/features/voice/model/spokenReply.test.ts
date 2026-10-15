import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import { latestReply, replySummary, spokenReply } from "./spokenReply";

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

describe("replySummary", () => {
  it("keeps the lead and the closing question, not the file list or code", () => {
    const reply = [
      "I fixed the flaky login test by waiting for the session cookie before asserting.",
      "",
      "**Files changed:**",
      "- `src/auth/login.ts`",
      "- `tests/login.test.ts`",
      "",
      "```ts",
      "await page.waitForResponse(/session/);",
      "```",
      "",
      "| Suite | Result |",
      "| --- | --- |",
      "| auth | 12 passed |",
      "",
      "All 12 auth tests pass now. Should I also open a PR?",
    ].join("\n");
    expect(replySummary(reply)).toBe(
      "I fixed the flaky login test by waiting for the session cookie before asserting. Should I also open a PR?",
    );
  });

  it("reads Next: lines and the first item under a next-steps label", () => {
    const reply = [
      "## Summary",
      "",
      "The release workflow now uploads the notarized build.",
      "",
      "- Bumped the action to v4",
      "- Removed the stale cache step",
      "",
      "Next steps:",
      "1. Tag v0.4.1 to try it",
      "2. Watch the run",
    ].join("\n");
    expect(replySummary(reply)).toBe(
      "The release workflow now uploads the notarized build. Next steps: Tag v0.4.1 to try it.",
    );
    expect(
      replySummary(
        "Moved the cache to Redis.\n\nDetails are below.\n\n**Next:** restart the worker.",
      ),
    ).toBe("Moved the cache to Redis. Next: restart the worker.");
  });

  it("summarises a Turkish reply the same way", () => {
    const reply = [
      "Ses modundaki gecikmeyi düzelttim; mikrofon artık cevap bitince hemen açılıyor.",
      "",
      "Değişen dosyalar:",
      "- `useVoiceConversation.ts`",
      "- `voice.rs`",
      "",
      "Testler geçti.",
      "",
      "Sonraki adım: uygulamayı yeniden başlatıp denemen yeterli. Değişikliği commit edeyim mi?",
    ].join("\n");
    expect(replySummary(reply)).toBe(
      "Ses modundaki gecikmeyi düzelttim; mikrofon artık cevap bitince hemen açılıyor. Sonraki adım: uygulamayı yeniden başlatıp denemen yeterli. Değişikliği commit edeyim mi?",
    );
  });

  it("keeps a closing offer and questions asked in a list", () => {
    const reply = [
      "Two options for the migration:",
      "",
      "- Keep the old column and backfill. Which one do you prefer?",
      "- Drop it in one step",
      "",
      "I left the schema untouched for now.",
      "",
      "If you want, I can write the backfill script.",
    ].join("\n");
    expect(replySummary(reply)).toBe(
      "I left the schema untouched for now. Which one do you prefer? If you want, I can write the backfill script.",
    );
  });

  it("shortens a long lead but never drops the question", () => {
    const lead = "This sentence is about forty characters. ".repeat(20);
    const spoken = replySummary(`${lead}\n\nShall I continue?`);
    expect(spoken.length).toBeLessThanOrEqual(400);
    expect(spoken).toMatch(/characters\. Shall I continue\?$/);
  });

  it("drops the name a reply opens with, but not an answer", () => {
    expect(
      replySummary(
        "Boss, evet; otomatik dil algılamayı kapatıp her canlı oturumu Türkçeye sabitleyeceğim. “Merhaba” ve “selam” gibi kısa ifadelerle de test edeceğim.",
      ),
    ).toBe(
      "evet; otomatik dil algılamayı kapatıp her canlı oturumu Türkçeye sabitleyeceğim. “Merhaba” ve “selam” gibi kısa ifadelerle de test edeceğim.",
    );
    expect(replySummary("Evet, Türkçeye sabitledim.")).toBe(
      "Evet, Türkçeye sabitledim.",
    );
  });

  it("keeps the lead to two sentences", () => {
    expect(
      replySummary(
        "Fixed the cache. Restarted the worker. Cleared old keys. Checked the logs.",
      ),
    ).toBe("Fixed the cache. Restarted the worker.");
  });

  it("falls back to the whole reply when it has no prose", () => {
    expect(replySummary("- one\n- two")).toBe("one. two.");
    expect(replySummary("```diff\n- a\n+ b\n```")).toBe(
      "The reply is code. It is on screen.",
    );
    expect(replySummary("")).toBe("");
  });
});
