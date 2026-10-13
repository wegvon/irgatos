import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  irgatReaction,
  irgatReactionBlocks,
  irgatReplyText,
} from "./irgatReaction";

const user = (id: string, extra: Partial<Block> = {}): Block => ({
  id,
  role: "user",
  text: id,
  ...extra,
});
const reply = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id,
  role: "assistant",
  text,
  ...extra,
});

describe("Irgat reactions", () => {
  it("reads a reply that is only one emoji in the tag", () => {
    expect(irgatReaction("<reaction>👍</reaction>")).toBe("👍");
    expect(irgatReaction(" <reaction> 👍🏽 </reaction>\n")).toBe("👍🏽");
    expect(irgatReaction("<reaction>👍👍</reaction>")).toBeUndefined();
    expect(irgatReaction("<reaction>ok</reaction>")).toBeUndefined();
    expect(irgatReaction("Sure! <reaction>👍</reaction>")).toBeUndefined();
    expect(irgatReplyText("<reaction>🎉</reaction>")).toBe(
      "Reacted 🎉 to your message",
    );
    expect(irgatReplyText("Done.")).toBe("Done.");
  });

  it("moves the reaction onto the message it answers", () => {
    const blocks = [
      user("a"),
      reply("r1", "Here you go."),
      user("b"),
      reply("r2", "<reaction>👍</reaction>"),
    ];
    const shown = irgatReactionBlocks(blocks);
    expect(shown.map((block) => block.id)).toEqual(["a", "r1", "b"]);
    expect(shown[2]).toMatchObject({ id: "b", irgatReaction: "👍" });
    expect(shown[0]).toBe(blocks[0]);
    // The same input gives the same blocks, so turn caches hold.
    expect(irgatReactionBlocks(blocks)).toBe(shown);
    expect(irgatReactionBlocks([...blocks])[2]).toBe(shown[2]);
  });

  it("drops the work behind a reaction but keeps errors", () => {
    const shown = irgatReactionBlocks([
      user("a"),
      { id: "think", role: "reasoning", text: "They are wrapping up." },
      { id: "tool", role: "tool", text: "", tool: { title: "memory.add" } },
      { id: "err", role: "system", text: "Hook failed", notice: "error" },
      reply("r", "<reaction>👍</reaction>"),
    ]);
    expect(shown.map((block) => block.id)).toEqual(["a", "err"]);
    expect(shown[0].irgatReaction).toBe("👍");
  });

  it("leaves chats without reactions untouched", () => {
    const blocks = [user("a"), reply("r", "<reaction>hi</reaction>")];
    expect(irgatReactionBlocks(blocks)).toBe(blocks);
  });

  it("hides a reply while it may still become a reaction", () => {
    for (const text of ["<", "<react", "<reaction>", "<reaction>👍"])
      expect(
        irgatReactionBlocks([user("a"), reply("r", text, { streaming: true })]),
      ).toHaveLength(1);
    expect(
      irgatReactionBlocks([user("a"), reply("r", "Sure", { streaming: true })]),
    ).toHaveLength(2);
    // Once finished, a malformed tag is shown as written.
    expect(
      irgatReactionBlocks([user("a"), reply("r", "<reaction>👍")]),
    ).toHaveLength(2);
  });

  it("shows the emoji on its own when there is no message to sit on", () => {
    const shown = irgatReactionBlocks([
      user("report", { internal: true }),
      reply("r", "<reaction>🎉</reaction>"),
    ]);
    expect(shown[1]).toMatchObject({ role: "assistant", text: "🎉" });
  });
});
