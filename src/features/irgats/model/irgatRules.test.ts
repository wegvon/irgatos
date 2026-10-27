// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block, Session } from "../../sessions/model/session";
import { newSession } from "../../sessions/model/session";
import { createIrgat, findIrgat, saveIrgatSessionId } from "./irgat";
import {
  irgatRulesFor,
  normalizePreapproved,
  parseIrgatRules,
  ruleDecision,
  ruledApprovals,
  saveIrgatRules,
} from "./irgatRules";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const step = (kind: string, title: string, path?: string): Block => ({
  id: `${kind}:${title}`,
  role: "tool",
  text: title,
  tool: { title, kind, ...(path ? { preview: { kind: "write", path } } : {}) },
  approval: { requestId: 1 },
});

it("keeps only known levels, with ask as the default left out", () => {
  expect(
    parseIrgatRules({
      execute: "allow",
      edit: "ask",
      read: "whatever",
      preapproved: [" NPM test ", "npm test", "", 3],
    }),
  ).toEqual({ execute: "allow", preapproved: ["npm test"] });
  expect(parseIrgatRules({ edit: "ask" })).toBeUndefined();
  expect(normalizePreapproved(["a", "A", " b "])).toEqual(["a", "b"]);
});

it("answers each kind of step by its rule", () => {
  const rules = parseIrgatRules({
    execute: "preapproved",
    edit: "handoff",
    read: "allow",
    preapproved: ["npm test", "git status"],
  });
  expect(ruleDecision(rules, step("execute", "npm test -- --run"))).toBe("allow");
  expect(ruleDecision(rules, step("execute", "git status"))).toBe("allow");
  expect(ruleDecision(rules, step("execute", "npm testx"))).toBe("ask");
  expect(ruleDecision(rules, step("execute", "git push"))).toBe("ask");
  expect(ruleDecision(rules, step("edit", "Edit app.ts"))).toBe("handoff");
  expect(ruleDecision(rules, step("search", "Search TODO"))).toBe("allow");
  expect(ruleDecision(rules, step("fetch", "Fetch example.com"))).toBe("ask");
  expect(ruleDecision(undefined, step("execute", "rm -rf /"))).toBe("ask");
});

it("lets a listed path through for file changes", () => {
  const rules = parseIrgatRules({ edit: "preapproved", preapproved: ["docs/"] });
  expect(
    ruleDecision(rules, step("edit", "Edit guide.md", "/code/app/docs/guide.md")),
  ).toBe("allow");
  expect(
    ruleDecision(rules, step("edit", "Edit app.ts", "/code/app/src/app.ts")),
  ).toBe("ask");
});

it("covers an Irgat's chats and what it started, never the app's own asks", () => {
  const irgat = createIrgat();
  saveIrgatSessionId(irgat.id, "irgat-chat");
  saveIrgatRules(irgat.id, { execute: "allow" });
  expect(findIrgat(irgat.id)?.rules).toEqual({ execute: "allow" });

  const chat: Session = {
    ...newSession("claude", "/code/app"),
    id: "irgat-chat",
    blocks: [
      step("execute", "npm test"),
      { ...step("execute", "relayed"), irgatHabit: { id: "h", name: "x", at: 1 } } as Block,
    ],
  };
  expect(ruledApprovals(chat, irgatRulesFor(chat)).map(({ block }) => block.text)).toEqual([
    "npm test",
  ]);
  const started = { id: `app-irgat-chat-req1` };
  expect(irgatRulesFor(started)).toEqual({ execute: "allow" });
  expect(irgatRulesFor({ id: "someone-else" })).toBeUndefined();

  saveIrgatRules(irgat.id, {});
  expect(findIrgat(irgat.id)).not.toHaveProperty("rules");
});
