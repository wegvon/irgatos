// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubStorage(entries: [string, string][]) {
  const stored = new Map(entries);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  return stored;
}

it("turns each project's Irgat into one of its own that works on that project", async () => {
  const stored = stubStorage([
    ["irgat:project-agents", JSON.stringify({ "/code/app": "chat-1" })],
    [
      "irgat:project-agent-profiles",
      JSON.stringify({
        "/code/app": { name: "Skull", claim: "claimed" },
        "/code/site": { claim: "claimed" },
        "/code/off": { claim: "declined" },
      }),
    ],
    ["irgat:tab-group:mascots", JSON.stringify({ "/code/app": "skull" })],
  ]);
  const { isIrgatSession, listIrgats, irgatForSession } = await import("./irgat");

  const irgats = listIrgats();
  expect(irgats.map((irgat) => irgat.projects)).toEqual([
    ["/code/app"],
    ["/code/site"],
  ]);
  expect(irgatForSession("chat-1")).toMatchObject({
    name: "Skull",
    mascot: "skull",
    projects: ["/code/app"],
    legacyProject: "/code/app",
  });
  expect(isIrgatSession("chat-1")).toBe(true);
  expect(irgats[1].sessionId).toBeUndefined();
  expect(
    [...stored.keys()].filter((key) => /agent|irgats|profiles/.test(key)),
  ).toEqual([]);
});

it("migrates only once, so a deleted Irgat stays deleted", async () => {
  stubStorage([["irgat:irgats", JSON.stringify({ "/code/app": "chat-1" })]]);
  const irgat = await import("./irgat");
  const [only] = irgat.listIrgats();
  irgat.removeIrgat(only.id);
  vi.resetModules();
  const again = await import("./irgat");
  expect(again.listIrgats()).toEqual([]);
});
