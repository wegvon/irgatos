// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidePaneRow } from "./SidePaneRow";

let root: Root;
let container: HTMLDivElement;

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

describe("SidePaneRow", () => {
  it("shows the main chat alone, then with its side panes", () => {
    const onFocusMain = vi.fn();
    const onFocusPane = vi.fn();
    const main = createElement("p", { id: "main" }, "main");
    const render = (ids: string[], sizes: number[]) =>
      act(() =>
        root.render(
          createElement(SidePaneRow, {
            main,
            layout: { ids, sizes },
            panes: ids.map((id) => ({
              id,
              node: createElement("p", null, id),
            })),
            onResize: vi.fn(),
            onFocusMain,
            onFocusPane,
          }),
        ),
      );

    render([], [1]);
    const mainNode = container.querySelector("#main");
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(0);

    render(["a", "b"], [0.5, 0.25, 0.25]);
    // The main chat stays mounted when panes open beside it.
    expect(container.querySelector("#main")).toBe(mainNode);
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(2);
    const pane = container.querySelector<HTMLElement>('[data-side-pane="b"]')!;
    expect(pane.style.flex).toContain("0.25");

    act(() =>
      pane.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(onFocusPane).toHaveBeenCalledWith("b");
    act(() =>
      mainNode!.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(onFocusMain).toHaveBeenCalled();
  });
});
