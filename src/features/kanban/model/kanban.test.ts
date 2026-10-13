import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const emitChange = vi.hoisted(() => ({
  current: undefined as ((event: { payload: { project: string } }) => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    _event: string,
    handler: (event: { payload: { project: string } }) => void,
  ) => {
    emitChange.current = handler;
    return () => {
      emitChange.current = undefined;
    };
  },
}));

import {
  cardTitleFromText,
  enqueueKanbanWrite,
  forgetKanbanBoards,
  kanbanProject,
  kanbanWritesPending,
  loadKanbanBoard,
  moveKanbanCard,
  normalizeCardLabels,
  parseQuickCard,
  peekKanbanBoard,
  subscribeKanban,
} from "./kanban";

beforeEach(() => {
  invoke.mockReset();
  forgetKanbanBoards();
});

afterEach(() => {
  emitChange.current = undefined;
});

describe("normalizeCardLabels", () => {
  it("matches the store's rules", () => {
    expect(normalizeCardLabels([" Bug ", "#bug", "needs review", "p1", "extra"])).toEqual([
      "bug",
      "needs-review",
      "p1",
    ]);
    expect(normalizeCardLabels(["###", "  "])).toEqual([]);
  });
});

describe("cardTitleFromText", () => {
  it("keeps titles on one line", () => {
    expect(cardTitleFromText("  Fix\n the  build ")).toBe("Fix the build");
  });
});

describe("parseQuickCard", () => {
  it("turns trailing tags into labels", () => {
    expect(parseQuickCard("Fix login redirect #bug #P1")).toEqual({
      title: "Fix login redirect",
      labels: ["bug", "p1"],
    });
  });

  it("keeps issue refs and inner tags in the title", () => {
    expect(parseQuickCard("Close #123")).toEqual({ title: "Close #123", labels: [] });
    expect(parseQuickCard("Ship #web build")).toEqual({
      title: "Ship #web build",
      labels: [],
    });
  });

  it("keeps a title made only of tags", () => {
    expect(parseQuickCard("#idea")).toEqual({ title: "#idea", labels: [] });
  });
});

describe("board cache", () => {
  it("loads by project key and caches the result", async () => {
    invoke.mockResolvedValue({ id: "b", project: "/work/app", columns: [], createdAt: 1 });
    await loadKanbanBoard("/work/app/");
    expect(invoke).toHaveBeenCalledWith("kanban_board", { project: "/work/app" });
    expect(peekKanbanBoard("/work/app")?.id).toBe("b");
    expect(kanbanProject("/work/app/")).toBe("/work/app");
  });
});

describe("write queue", () => {
  it("runs writes in order and keeps going after a failure", async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    const first = enqueueKanbanWrite(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push("first");
            resolve();
          };
        }),
    );
    const failing = enqueueKanbanWrite(async () => {
      order.push("second");
      throw new Error("nope");
    });
    const third = enqueueKanbanWrite(async () => {
      order.push("third");
    });
    expect(kanbanWritesPending()).toBe(true);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release!();
    await first;
    await expect(failing).rejects.toThrow("nope");
    await third;
    expect(order).toEqual(["first", "second", "third"]);
    await vi.waitFor(() => expect(kanbanWritesPending()).toBe(false));
  });

  it("holds change notifications until local writes have landed", async () => {
    const changed = vi.fn();
    const stop = subscribeKanban(changed);
    await vi.waitFor(() => expect(emitChange.current).toBeDefined());
    let release: (() => void) | undefined;
    invoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const move = moveKanbanCard("card", "column", 0);
    emitChange.current!({ payload: { project: "/work/app" } });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(changed).not.toHaveBeenCalled();
    release!();
    await move;
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith("/work/app"));
    stop();
  });
});
