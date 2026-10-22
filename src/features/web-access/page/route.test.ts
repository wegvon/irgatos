import { describe, expect, it } from "vitest";
import {
  href,
  isSheet,
  mailThreadId,
  parseMailThreadId,
  parseRoute,
} from "./route";

describe("browser page routes", () => {
  it("reads every screen and sheet from the hash", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/today")).toEqual({ name: "today" });
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
    for (const name of ["feed", "notes", "board", "artifacts"] as const) {
      expect(parseRoute(`#/${name}`)).toEqual({ name });
      expect(isSheet({ name })).toBe(false);
    }
  });

  it("falls back instead of opening an empty chat or idea", () => {
    expect(parseRoute("#/chat/")).toEqual({ name: "chats" });
    expect(parseRoute("#/idea")).toEqual({ name: "ideas" });
    expect(parseRoute("#/chats/everything")).toEqual({ name: "chats" });
    expect(parseRoute("#/nowhere")).toEqual({ name: "home" });
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

  it("opens a mail thread by its account and id", () => {
    const id = mailThreadId("google_gmail.user.work.", "18f2a");
    const route = { name: "mailThread", id } as const;
    expect(parseRoute(href(route))).toEqual(route);
    expect(parseMailThreadId(id)).toEqual({
      account: "google_gmail.user.work.",
      thread: "18f2a",
    });
    expect(parseRoute("#/mail")).toEqual({ name: "mail" });
    expect(parseRoute("#/mailThread")).toEqual({ name: "mail" });
    expect(isSheet(route)).toBe(false);
  });

  it("tells sheets from screens", () => {
    expect(isSheet({ name: "new" })).toBe(true);
    expect(isSheet({ name: "idea", id: "c1" })).toBe(true);
    expect(isSheet({ name: "chat", id: "a" })).toBe(false);
  });
});
