// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  chatNamePromptDismissed,
  dismissChatNamePrompt,
  isPlaceholderChatTitle,
  shouldPromptChatName,
  suggestChatName,
} from "./chatNamePrompt";

const user = (text: string, extra: Partial<Block> = {}): Block => ({
  id: text,
  role: "user",
  text,
  ...extra,
});
const reply = (text: string): Block => ({
  id: `r-${text}`,
  role: "assistant",
  text,
});

beforeEach(() => localStorage.clear());

it("treats only the names a chat starts with as placeholders", () => {
  expect(isPlaceholderChatTitle("Chat 2")).toBe(true);
  expect(isPlaceholderChatTitle("New session")).toBe(true);
  expect(isPlaceholderChatTitle("")).toBe(true);
  expect(isPlaceholderChatTitle("Chat about prices")).toBe(false);
  expect(isPlaceholderChatTitle("Release notes")).toBe(false);
});

it("asks after the second user turn has its reply", () => {
  const base = { displayTitle: "Chat 2", busy: false, dismissed: () => false };
  const one = [user("first"), reply("a")];
  const two = [...one, user("second"), reply("b")];
  expect(shouldPromptChatName({ ...base, blocks: one })).toBe(false);
  expect(shouldPromptChatName({ ...base, blocks: two })).toBe(true);
  expect(shouldPromptChatName({ ...base, blocks: two, busy: true })).toBe(
    false,
  );
  expect(
    shouldPromptChatName({ ...base, blocks: two, displayTitle: "Mail fixes" }),
  ).toBe(false);
  expect(
    shouldPromptChatName({ ...base, blocks: two, dismissed: () => true }),
  ).toBe(false);
});

it("does not count messages another Irgat sent or unsent drafts", () => {
  const blocks = [
    user("first"),
    user("from a peer", {
      fromIrgat: { id: "x", name: "Ada" } as Block["fromIrgat"],
    }),
    user("draft", { draft: true }),
  ];
  expect(
    shouldPromptChatName({
      displayTitle: "Chat 3",
      blocks,
      busy: false,
      dismissed: () => false,
    }),
  ).toBe(false);
});

it("suggests a short name from the first ask", () => {
  expect(
    suggestChatName([user("fix the mail undo button. it is broken")]),
  ).toBe("Fix the mail undo button");
  expect(
    suggestChatName([
      user("@Ada look at https://example.com/x and `npm test`"),
    ]),
  ).toBe("Look at and npm test");
  const long = suggestChatName([
    user(
      "please write a detailed comparison of every palette we discussed yesterday evening",
    ),
  ]);
  expect(long.length).toBeLessThanOrEqual(49);
  expect(long.endsWith("…")).toBe(true);
  expect(suggestChatName([user("\n  \n"), user("second ask")])).toBe(
    "Second ask",
  );
  expect(suggestChatName([])).toBe("");
});

it("remembers a put-off chat", () => {
  expect(chatNamePromptDismissed("a")).toBe(false);
  dismissChatNamePrompt("a");
  dismissChatNamePrompt("a");
  expect(chatNamePromptDismissed("a")).toBe(true);
  expect(chatNamePromptDismissed("b")).toBe(false);
});
