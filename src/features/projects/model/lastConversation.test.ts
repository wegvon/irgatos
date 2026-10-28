import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newTab } from "../../workspace/model/layout";
import { newSession, type Session } from "../../sessions/model/session";
import {
  focusedConversation,
  forgetConversations,
  isReturnableConversation,
  lastConversationFor,
  loadLastConversations,
  rememberLastConversation,
  withLastConversation,
} from "./lastConversation";
import { ContinueConversation } from "../../sessions/ui/ContinueConversation";
import { EmptySession } from "../../sessions/ui/EmptySession";

const storedValues = new Map<string, string>();
vi.stubGlobal("localStorage", {
  clear: () => storedValues.clear(),
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => storedValues.set(key, value),
  removeItem: (key: string) => storedValues.delete(key),
});

beforeEach(() => localStorage.clear());

function chat(id: string, cwd = "/work/demo", spoken = true): Session {
  return {
    ...newSession("claude", cwd, "sonnet", "supervised"),
    id,
    title: `Chat ${id}`,
    blocks: spoken ? [{ id: `${id}-u`, role: "user", text: "hi" } as never] : [],
  };
}

describe("returnable conversations", () => {
  it("keeps only spoken project chats", () => {
    expect(isReturnableConversation(chat("a"))).toBe(true);
    expect(isReturnableConversation(chat("b", "/work/demo", false))).toBe(false);
    expect(
      isReturnableConversation({ ...chat("c"), orchestrationLeadId: "lead" }),
    ).toBe(false);
    expect(isReturnableConversation({ ...chat("d"), ephemeral: true })).toBe(
      false,
    );
    expect(isReturnableConversation(chat("e", "~"))).toBe(false);
    expect(isReturnableConversation(chat("f"), (id) => id === "f")).toBe(false);
  });

  it("reads the focused chat of the active tab", () => {
    const tab = newTab("a");
    expect(focusedConversation([tab], [chat("a")], tab.id)?.id).toBe("a");
    expect(focusedConversation([tab], [chat("a")], "other")).toBeUndefined();
  });
});

describe("last conversation memory", () => {
  it("outlives the tabs: nothing here reads the workspace", () => {
    rememberLastConversation(chat("a"), 1000);
    expect(lastConversationFor(loadLastConversations(), "/work/demo/")).toEqual(
      { sessionId: "a", title: "Chat a", harness: "claude", at: 1000 },
    );
  });

  it("moves to the newer chat and keeps the time across a rename", () => {
    const first = withLastConversation({}, chat("a"), 1000);
    const renamed = withLastConversation(
      first,
      { ...chat("a"), title: "Renamed" },
      5000,
    );
    expect(renamed["/work/demo"]).toMatchObject({ title: "Renamed", at: 1000 });
    expect(withLastConversation(renamed, chat("b"), 6000)["/work/demo"]).toMatchObject(
      { sessionId: "b", at: 6000 },
    );
    expect(withLastConversation(first, chat("a"), 9000)).toBe(first);
  });

  it("forgets deleted or archived chats", () => {
    rememberLastConversation(chat("a"), 1000);
    rememberLastConversation(chat("z", "/work/other"), 1000);
    forgetConversations(["a"]);
    const memory = loadLastConversations();
    expect(lastConversationFor(memory, "/work/demo")).toBeUndefined();
    expect(lastConversationFor(memory, "/work/other")?.sessionId).toBe("z");
  });

  it("ignores damaged storage", () => {
    localStorage.setItem("irgatos.lastConversation.v1", "{not json");
    expect(loadLastConversations()).toEqual({});
    localStorage.setItem(
      "irgatos.lastConversation.v1",
      JSON.stringify({ "/work/demo": { title: "no id" } }),
    );
    expect(loadLastConversations()).toEqual({});
  });
});

describe("continue offer on a blank chat", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");

  it("offers the last conversation and a new one", () => {
    rememberLastConversation(chat("a"), now - 2 * 3600_000);
    const markup = renderToStaticMarkup(
      createElement(ContinueConversation, {
        sessionId: "blank",
        cwd: "/work/demo",
        now,
      }),
    );
    expect(markup).toContain("Continue last conversation");
    expect(markup).toContain("Chat a");
    expect(markup).toContain("2 hours ago");
    expect(markup).toContain("New conversation");
  });

  it("stays away from other projects and from the chat itself", () => {
    rememberLastConversation(chat("a"), now);
    const render = (sessionId: string, cwd: string) =>
      renderToStaticMarkup(
        createElement(ContinueConversation, { sessionId, cwd, now }),
      );
    expect(render("blank", "/work/other")).toBe("");
    expect(render("a", "/work/demo")).toBe("");
  });

  it("sits above the composer of the empty chat", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptySession, {
        cwd: "/work/demo",
        composer: createElement("textarea"),
        resume: createElement("div", { "data-resume": "" }),
      }),
    );
    expect(markup.indexOf("data-resume")).toBeLessThan(
      markup.indexOf("<textarea"),
    );
  });
});
