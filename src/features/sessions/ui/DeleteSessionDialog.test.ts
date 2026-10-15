// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteSessionDialog } from "./DeleteSessionDialog";

let root: Root;
let container: HTMLElement;
beforeEach(() => {
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

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === label,
  )!;

it("asks before deleting a session that has no worktree to clean up", () => {
  const onClose = vi.fn();
  act(() =>
    root.render(
      createElement(DeleteSessionDialog, { title: "Fix login", onClose }),
    ),
  );
  expect(document.body.textContent).toContain(
    "“Fix login” will be permanently deleted.",
  );
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  act(() => button("Cancel").click());
  expect(onClose).toHaveBeenLastCalledWith({
    confirmed: false,
    deleteWorktree: false,
  });
  act(() => button("Delete session").click());
  expect(onClose).toHaveBeenLastCalledWith({
    confirmed: true,
    deleteWorktree: false,
  });
});

it("offers the unused worktree when there is one", () => {
  act(() =>
    root.render(
      createElement(DeleteSessionDialog, {
        title: "Fix login",
        unusedWorktree: "/tmp/wt",
        onClose: () => {},
      }),
    ),
  );
  expect(document.body.textContent).toContain(
    "Also delete the unused worktree",
  );
});
