// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchableProjectPicker } from "./SearchableProjectPicker";

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(activeId?: string) {
  const onSelectProject = vi.fn();
  const onOpen = vi.fn();
  act(() =>
    root.render(
      createElement(SearchableProjectPicker, {
        cwd: "/code/app",
        recents: [{ path: "/code/app", openedAt: 1 }],
        compact: true,
        onSelectProject,
        irgats: {
          items: [{ id: "m1", name: "IrgatCat", mascot: "cat", color: "#fff" }],
          activeId,
          onOpen,
        },
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  act(() => trigger.click());
  return { trigger, onSelectProject, onOpen };
}

it("lists irgats above the projects and opens one", () => {
  const { trigger, onOpen } = render();
  expect(trigger.getAttribute("aria-label")).toContain("current project app");
  const irgat = document.body.querySelector<HTMLButtonElement>(
    '[data-picker-irgat="m1"]',
  )!;
  expect(irgat.textContent).toContain("IrgatCat");
  act(() => irgat.click());
  expect(onOpen).toHaveBeenCalledWith("m1");
});

it("shows the open irgat, and lets the current project lead back out of it", () => {
  const { trigger, onSelectProject } = render("m1");
  expect(trigger.getAttribute("aria-label")).toContain("current irgat IrgatCat");
  const project = [...document.body.querySelectorAll("button")].find(
    (button) => button.title === "/code/app",
  )!;
  act(() => project.click());
  expect(onSelectProject).toHaveBeenCalledWith("/code/app");
});

it("marks a working Irgat with unread replies and a project with an agent at work", () => {
  act(() =>
    root.render(
      createElement(SearchableProjectPicker, {
        cwd: "/code/app",
        recents: [
          { path: "/code/app", openedAt: 2 },
          { path: "/code/api", openedAt: 1 },
        ],
        busyPaths: ["/code/api"],
        compact: true,
        onSelectProject: vi.fn(),
        irgats: {
          items: [
            {
              id: "m1",
              name: "IrgatCat",
              mascot: "cat",
              color: "#fff",
              status: "working",
              unseen: 3,
            },
            { id: "m2", name: "Quiet", mascot: "cat", color: "#fff" },
          ],
          onOpen: vi.fn(),
        },
      }),
    ),
  );
  act(() => container.querySelector("button")!.click());
  const irgat = (id: string) =>
    document.body.querySelector<HTMLElement>(`[data-picker-irgat="${id}"]`)!;
  expect(irgat("m1").textContent).toContain("Working");
  expect(irgat("m1").querySelector('[aria-label="3 unread"]')).not.toBeNull();
  expect(irgat("m2").textContent).toContain("Irgat");
  const row = (path: string) =>
    [...document.body.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.title === path,
    )!;
  expect(
    row("/code/api").querySelector("[data-picker-project-busy]"),
  ).not.toBeNull();
  expect(
    row("/code/app").querySelector("[data-picker-project-busy]"),
  ).toBeNull();
});
