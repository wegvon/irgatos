// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  addIrgatProject,
  createIrgat,
  findIrgat,
  listIrgats,
  irgatLook,
  irgatProjectsPhrase,
  irgatWorksOn,
  removeIrgat,
  removeIrgatProject,
  reorderIrgats,
} from "./irgat";
import { irgatBackgroundKey, irgatChatBackground } from "./irgatBackground";
import { saveProjectChatBackgroundSettings } from "../../projects/model/projectChatBackground";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("gives each new Irgat a mascot and color the others are not using", () => {
  const first = createIrgat();
  const second = createIrgat();
  expect(second.mascot).not.toBe(first.mascot);
  expect(second.color).not.toBe(first.color);
  expect(irgatLook(first).name).toMatch(/^Irgat[A-Z]/);
  expect(first.projects).toEqual([]);
});

it("adds each project once and takes one away by its path", () => {
  const { id } = createIrgat(["/code/app"]);
  addIrgatProject(id, "/code/site");
  addIrgatProject(id, "/code/app/");
  expect(findIrgat(id)?.projects).toEqual(["/code/app", "/code/site"]);
  expect(irgatWorksOn(findIrgat(id)!, "/code/site/")).toBe(true);
  removeIrgatProject(id, "/code/app/");
  expect(findIrgat(id)?.projects).toEqual(["/code/site"]);
});

it("keeps the rail's order and forgets a removed Irgat", () => {
  const a = createIrgat();
  const b = createIrgat();
  const c = createIrgat();
  reorderIrgats([c.id, a.id, b.id]);
  expect(listIrgats().map((irgat) => irgat.id)).toEqual([c.id, a.id, b.id]);
  removeIrgat(a.id);
  expect(listIrgats().map((irgat) => irgat.id)).toEqual([c.id, b.id]);
});

it("names its projects the way a sentence would", () => {
  const project = (name: string) => ({ path: `/code/${name}`, name });
  expect(irgatProjectsPhrase([])).toBe("");
  expect(irgatProjectsPhrase([project("app")])).toBe("app");
  expect(
    irgatProjectsPhrase([project("app"), project("site"), project("api")]),
  ).toBe("app, site and api");
});

it("forgets its background along with the Irgat", () => {
  const irgat = createIrgat();
  saveProjectChatBackgroundSettings(irgatBackgroundKey(irgat.id), {
    path: "/bg/irgat.png",
    emptyOpacity: 0.24,
    sessionOpacity: 0.24,
    scope: "all",
    effect: "gradient-blur",
  });
  expect(irgatChatBackground(irgat.id)?.path).toBe("/bg/irgat.png");
  removeIrgat(irgat.id);
  expect(irgatChatBackground(irgat.id)).toBeNull();
});
