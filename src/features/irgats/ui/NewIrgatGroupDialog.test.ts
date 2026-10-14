// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createIrgat, saveIrgatName, findIrgat, type Irgat } from "../model/irgat";
import { NewIrgatGroupDialog } from "./NewIrgatGroupDialog";

let stored: Map<string, string>;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  stored = new Map([["irgat:irgat-roster", "[]"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function roster(names: string[]): Irgat[] {
  return names.map((name) => {
    const irgat = createIrgat();
    saveIrgatName(irgat.id, name);
    return findIrgat(irgat.id)!;
  });
}

function render(irgats: Irgat[], onCreate = vi.fn(), initial?: string[]) {
  act(() =>
    root.render(
      createElement(NewIrgatGroupDialog, { irgats, initial, onCreate, onClose: () => undefined }),
    ),
  );
  return onCreate;
}

const box = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const create = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Create group",
  )!;

it("creates a group once two Irgats are picked, in reply order", () => {
  const irgats = roster(["Architect", "Security", "Frontend"]);
  const onCreate = render(irgats);
  expect(create().disabled).toBe(true);
  act(() => box("Frontend").click());
  expect(create().disabled).toBe(true);
  act(() => box("Architect").click());
  expect(create().disabled).toBe(false);
  expect(document.querySelector(`[data-group-candidate="${irgats[0].id}"]`)!.textContent).toContain(
    "replies first",
  );
  expect(document.querySelector(`[data-group-candidate="${irgats[2].id}"]`)!.textContent).toContain(
    "replies #2",
  );
  expect(
    document.querySelector<HTMLInputElement>('input[placeholder="Architect + Frontend"]'),
  ).not.toBeNull();
  act(() => create().click());
  expect(onCreate).toHaveBeenCalledWith([irgats[0].id, irgats[2].id], "");
});

it("passes the name the user gave", () => {
  const irgats = roster(["Architect", "Security"]);
  const onCreate = render(irgats, vi.fn(), irgats.map((i) => i.id));
  const name = document.querySelector<HTMLInputElement>('input[maxlength="60"]')!;
  const props = Object.entries(name).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => props.onChange({ target: { value: "  Launch review " } }));
  act(() => create().click());
  expect(onCreate).toHaveBeenCalledWith([irgats[0].id, irgats[1].id], "Launch review");
});

it("explains that a group needs two Irgats when there is only one", () => {
  render(roster(["Solo"]));
  expect(document.body.textContent).toContain("A group needs at least two Irgats.");
  expect(create().disabled).toBe(true);
});
