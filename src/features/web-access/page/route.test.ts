import { describe, expect, it } from "vitest";
import { href, isSheet, parseRoute } from "./route";

describe("browser page routes", () => {
  it("reads every screen and sheet from the hash", () => {
    expect(parseRoute("")).toEqual({ name: "today" });
    expect(parseRoute("#/chats")).toEqual({ name: "chats" });
    expect(parseRoute("#/chats/running")).toEqual({
      name: "chats",
      filter: "running",
    });
    expect(parseRoute("#/chat/a%2Fb")).toEqual({ name: "chat", id: "a/b" });
    expect(parseRoute("#/irgats")).toEqual({ name: "irgats" });
    expect(parseRoute("#/ideas")).toEqual({ name: "ideas" });
    expect(parseRoute("#/idea/c1")).toEqual({ name: "idea", id: "c1" });
    expect(parseRoute("#/new")).toEqual({ name: "new" });
    expect(parseRoute("#/services")).toEqual({ name: "services" });
  });

  it("falls back instead of opening an empty chat or idea", () => {
    expect(parseRoute("#/chat/")).toEqual({ name: "chats" });
    expect(parseRoute("#/idea")).toEqual({ name: "ideas" });
    expect(parseRoute("#/chats/everything")).toEqual({ name: "chats" });
    expect(parseRoute("#/nowhere")).toEqual({ name: "today" });
  });

  it("round-trips through href", () => {
    for (const route of [
      { name: "chat", id: "x y/z" },
      { name: "chats", filter: "needsYou" },
      { name: "ideas" },
      { name: "idea", id: "c-1" },
    ] as const)
      expect(parseRoute(href(route))).toEqual(route);
  });

  it("tells sheets from screens", () => {
    expect(isSheet({ name: "new" })).toBe(true);
    expect(isSheet({ name: "idea", id: "c1" })).toBe(true);
    expect(isSheet({ name: "chat", id: "a" })).toBe(false);
  });
});
