import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  LiveTranscript,
  liveBlock,
  liveTurnsContext,
  unseenLiveTurns,
} from "./liveTranscript";

describe("LiveTranscript", () => {
  it("joins fragments into whole turns for each side", () => {
    const transcript = new LiveTranscript();
    transcript.addUser(" Can you");
    transcript.addUser("check");
    transcript.addUser(" the build?");
    transcript.addAssistant("Sure");
    transcript.addAssistant(", starting");
    transcript.addAssistant(" now.");
    expect(transcript.pendingUser).toBe("Can you check the build?");
    expect(transcript.takeUser()).toBe("Can you check the build?");
    expect(transcript.takeUser()).toBe("");
    expect(transcript.takeAssistant()).toBe("Sure, starting now.");
  });
});

describe("liveBlock", () => {
  it("marks the block as said in a live call", () => {
    const block = liveBlock("assistant", "Done.", { at: 5, interrupted: true });
    expect(block).toMatchObject({ role: "assistant", text: "Done.", liveVoice: { at: 5, interrupted: true } });
    expect(liveBlock("user", "hi", { at: 1 }).liveVoice).toEqual({ at: 1 });
  });
});

const typed = (text: string, extra: Partial<Block> = {}): Block => ({
  id: crypto.randomUUID(),
  role: "user",
  text,
  ...extra,
});

describe("unseenLiveTurns", () => {
  it("collects what was said since the last typed message", () => {
    const blocks = [
      typed("first"),
      liveBlock("user", "old live", { at: 1 }),
      typed("typed after"),
      { id: "a", role: "assistant", text: "reply" } as Block,
      liveBlock("user", "new live", { at: 2 }),
      typed("internal", { internal: true }),
      liveBlock("assistant", "answer", { at: 3 }),
    ];
    expect(unseenLiveTurns(blocks).map((block) => block.text)).toEqual(["new live", "answer"]);
  });

  it("finds nothing when the last message was typed", () => {
    expect(unseenLiveTurns([liveBlock("user", "x"), typed("y")])).toEqual([]);
  });
});

describe("liveTurnsContext", () => {
  it("hands the agent the call as a quoted conversation", () => {
    const text = liveTurnsContext([
      liveBlock("user", "is CI green?"),
      liveBlock("assistant", "Checking", { interrupted: true }),
    ]);
    expect(text).toMatch(/^<live_voice_conversation>/);
    expect(text).toContain("- User: is CI green?");
    expect(text).toContain("- You (live voice): Checking [cut off]");
    expect(liveTurnsContext([])).toBe("");
  });
});
