import { describe, expect, it } from "vitest";
import {
  defaultPicked,
  handoffTargets,
  mentionedMembers,
  mentionHandle,
  mentionSuggestions,
  resolveGroupSpeakers,
} from "./irgatGroupMentions";

const members = [
  { id: "a", name: "Architect" },
  { id: "s", name: "Security Bot" },
  { id: "f", name: "IrgatFrontend" },
];

describe("@mention speaker resolution", () => {
  it("writes a name without spaces as its handle", () => {
    expect(mentionHandle("Security Bot")).toBe("SecurityBot");
    expect(mentionHandle("IrgatCrab")).toBe("IrgatCrab");
  });

  it("finds the mentioned members in the order first named, once each", () => {
    expect(
      mentionedMembers(
        "@irgatfrontend and @SecurityBot, then @IrgatFrontend again.",
        members,
      ),
    ).toEqual(["f", "s"]);
  });

  it("allows punctuation after a handle and ignores unknown handles and emails", () => {
    expect(mentionedMembers("Thoughts, @Architect?", members)).toEqual(["a"]);
    expect(mentionedMembers("(@Architect.)", members)).toEqual(["a"]);
    expect(mentionedMembers("mail ops@Architect.io or @nobody", members)).toEqual([]);
  });

  it("matches names in any script", () => {
    expect(
      mentionedMembers("@Güvenlik bak", [{ id: "g", name: "Güvenlik" }]),
    ).toEqual(["g"]);
  });

  it("lets mentions decide who replies, in mention order", () => {
    expect(
      resolveGroupSpeakers({
        text: "@SecurityBot then @Architect: review this",
        members,
        picked: ["a", "s", "f"],
      }),
    ).toEqual(["s", "a"]);
  });

  it("falls back to the picked members, in member order", () => {
    expect(
      resolveGroupSpeakers({ text: "What do you all think?", members, picked: ["f", "a"] }),
    ).toEqual(["a", "f"]);
    expect(
      resolveGroupSpeakers({ text: "hi", members, picked: [] }),
    ).toEqual([]);
  });

  it("picks everyone by default in round mode and nobody in pick mode", () => {
    expect(defaultPicked("round", members)).toEqual(["a", "s", "f"]);
    expect(defaultPicked("pick", members)).toEqual([]);
  });

  it("hands off only to other members a reply mentions", () => {
    expect(
      handoffTargets("@Architect I agree; @SecurityBot can you check auth?", "a", members),
    ).toEqual(["s"]);
  });

  it("suggests handles that start with what was typed first", () => {
    expect(mentionSuggestions("sec", members).map((m) => m.id)).toEqual(["s"]);
    expect(mentionSuggestions("bot", members).map((m) => m.id)).toEqual(["s"]);
    expect(mentionSuggestions("front", members).map((m) => m.id)).toEqual(["f"]);
    expect(mentionSuggestions("", members)).toHaveLength(3);
    expect(mentionSuggestions("zzz", members)).toEqual([]);
  });
});
