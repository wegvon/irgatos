import { describe, expect, it } from "vitest";
import {
  closeSidePane,
  forgetSidePane,
  MAX_SIDE_PANES,
  MIN_SIDE_PANE_SHARE,
  openBeside,
  parseSidePanes,
  resizeSidePanes,
  shownSidePanes,
} from "./sidePanes";

describe("side panes", () => {
  it("opens a chat beside the main one with equal widths", () => {
    const panes = openBeside(undefined, "main", "a");
    expect(panes).toEqual({ ids: ["a"], sizes: [0.5, 0.5] });
    const two = openBeside(panes, "main", "b");
    expect(two.ids).toEqual(["a", "b"]);
    expect(two.sizes).toHaveLength(3);
    expect(two.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
  });

  it("does not open the main chat or one already shown", () => {
    const panes = openBeside(undefined, "main", "a");
    expect(openBeside(panes, "main", "main")).toBe(panes);
    expect(openBeside(panes, "main", "a")).toBe(panes);
  });

  it("swaps the rightmost chat when the row is full", () => {
    let panes = openBeside(undefined, "main", "a");
    for (const id of ["b", "c", "d"]) panes = openBeside(panes, "main", id);
    expect(panes.ids).toHaveLength(MAX_SIDE_PANES);
    expect(panes.ids).toEqual(["a", "b", "d"]);
  });

  it("closes a pane and drops an empty row", () => {
    const panes = openBeside(openBeside(undefined, "main", "a"), "main", "b");
    expect(closeSidePane(panes, "a")).toEqual({
      ids: ["b"],
      sizes: [0.5, 0.5],
    });
    expect(closeSidePane(closeSidePane(panes, "a"), "b")).toBeUndefined();
  });

  it("resizes only the two panes beside the edge, within limits", () => {
    const panes = openBeside(openBeside(undefined, "main", "a"), "main", "b");
    const moved = resizeSidePanes(panes, 0, 0.5);
    expect(moved.sizes[0]).toBeCloseTo(0.5);
    expect(moved.sizes[1]).toBeCloseTo(1 / 6);
    expect(moved.sizes[2]).toBeCloseTo(1 / 3);
    const squeezed = resizeSidePanes(panes, 0, 0.99);
    expect(squeezed.sizes[1]).toBeCloseTo(MIN_SIDE_PANE_SHARE);
    expect(resizeSidePanes(panes, 5, 0.5)).toBe(panes);
  });

  it("shows only chats that exist and are not the main one", () => {
    const panes = openBeside(openBeside(undefined, "x", "a"), "x", "b");
    expect(shownSidePanes(panes, "a", () => true)?.ids).toEqual(["b"]);
    expect(shownSidePanes(panes, "x", (id) => id !== "b")?.ids).toEqual(["a"]);
    expect(shownSidePanes(panes, "x", () => false)).toBeUndefined();
    const shown = shownSidePanes(panes, "a", () => true);
    expect(shown?.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
  });

  it("forgets a deleted chat in every view", () => {
    const map = {
      chats: openBeside(undefined, "m", "a"),
      "irgat:1": openBeside(openBeside(undefined, "m", "a"), "m", "b"),
    } as const;
    const next = forgetSidePane(map, "a");
    expect(next.chats).toBeUndefined();
    expect(next["irgat:1"]?.ids).toEqual(["b"]);
    expect(forgetSidePane(next, "zzz")).toBe(next);
  });

  it("reads back only well formed rows", () => {
    expect(
      parseSidePanes({
        chats: { ids: ["a", "a", 3, "b"], sizes: [1, 1, 1] },
        "irgat:x": { ids: [] },
        other: { ids: ["c"] },
        "irgat:y": { ids: ["d"], sizes: "bad" },
      }),
    ).toEqual({
      chats: { ids: ["a", "b"], sizes: [1 / 3, 1 / 3, 1 / 3] },
      "irgat:y": { ids: ["d"], sizes: [0.5, 0.5] },
    });
    expect(parseSidePanes(null)).toEqual({});
  });
});
