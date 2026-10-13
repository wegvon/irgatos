import { describe, expect, it } from "vitest";
import {
  boardCardCount,
  cardMatches,
  dropColumnAt,
  dropIndexAt,
  filterBoardColumns,
  fullDropIndex,
  insertCardInBoard,
  insertColumnInBoard,
  keyboardCardTarget,
  moveCardInBoard,
  moveColumnInBoard,
  neighbourCard,
  removeCardFromBoard,
  removeColumnFromBoard,
} from "./boardOps";
import type { KanbanBoard, KanbanCard } from "./kanban";

function card(id: string, columnId: string, extra: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id,
    columnId,
    title: id.toUpperCase(),
    notes: "",
    labels: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function board(): KanbanBoard {
  return {
    id: "board",
    project: "/work/app",
    createdAt: 1,
    columns: [
      { id: "backlog", title: "Backlog", createdAt: 1, updatedAt: 1, cards: [card("a", "backlog"), card("b", "backlog"), card("c", "backlog")] },
      { id: "doing", title: "In progress", createdAt: 1, updatedAt: 1, cards: [card("d", "doing")] },
      { id: "review", title: "Review", createdAt: 1, updatedAt: 1, cards: [] },
      { id: "done", title: "Done", createdAt: 1, updatedAt: 1, cards: [card("e", "done"), card("f", "done")] },
    ],
  };
}

function ids(value: KanbanBoard) {
  return value.columns.map((column) => column.cards.map((item) => item.id));
}

describe("moveCardInBoard", () => {
  it("reorders within a column without touching the update time", () => {
    const next = moveCardInBoard(board(), "c", { columnId: "backlog", index: 0 }, 99);
    expect(ids(next)[0]).toEqual(["c", "a", "b"]);
    expect(next.columns[0]!.cards[0]!.updatedAt).toBe(1);
  });

  it("moves across columns and stamps the card", () => {
    const next = moveCardInBoard(board(), "a", { columnId: "review", index: 5 }, 99);
    expect(ids(next)).toEqual([["b", "c"], ["d"], ["a"], ["e", "f"]]);
    expect(next.columns[2]!.cards[0]).toMatchObject({ columnId: "review", updatedAt: 99 });
  });

  it("returns the same board for a no-op or unknown target", () => {
    const start = board();
    expect(moveCardInBoard(start, "b", { columnId: "backlog", index: 1 })).toBe(start);
    expect(moveCardInBoard(start, "b", { columnId: "missing", index: 0 })).toBe(start);
    expect(moveCardInBoard(start, "missing", { columnId: "done", index: 0 })).toBe(start);
  });
});

describe("keyboardCardTarget", () => {
  it("steps within the column and stops at its ends", () => {
    expect(keyboardCardTarget(board(), "b", "up")).toEqual({ columnId: "backlog", index: 0 });
    expect(keyboardCardTarget(board(), "b", "down")).toEqual({ columnId: "backlog", index: 2 });
    expect(keyboardCardTarget(board(), "a", "up")).toBeNull();
    expect(keyboardCardTarget(board(), "c", "down")).toBeNull();
    expect(keyboardCardTarget(board(), "c", "top")).toEqual({ columnId: "backlog", index: 0 });
    expect(keyboardCardTarget(board(), "a", "bottom")).toEqual({ columnId: "backlog", index: 2 });
  });

  it("crosses columns on the same row where it can, including empty ones", () => {
    expect(keyboardCardTarget(board(), "c", "right")).toEqual({ columnId: "doing", index: 1 });
    expect(keyboardCardTarget(board(), "d", "right")).toEqual({ columnId: "review", index: 0 });
    expect(keyboardCardTarget(board(), "f", "left")).toEqual({ columnId: "review", index: 0 });
    expect(keyboardCardTarget(board(), "a", "left")).toBeNull();
    expect(keyboardCardTarget(board(), "e", "right")).toBeNull();
  });
});

describe("neighbourCard", () => {
  it("moves focus between cards and skips empty columns", () => {
    const columns = board().columns;
    expect(neighbourCard(columns, "b", "up")).toBe("a");
    expect(neighbourCard(columns, "a", "up")).toBeNull();
    expect(neighbourCard(columns, "c", "right")).toBe("d");
    expect(neighbourCard(columns, "d", "right")).toBe("e");
    expect(neighbourCard(columns, "f", "left")).toBe("d");
    expect(neighbourCard(columns, "a", "left")).toBeNull();
  });
});

describe("remove and restore", () => {
  it("puts a removed card back where it was", () => {
    const start = board();
    const removed = removeCardFromBoard(start, "b");
    expect(ids(removed)[0]).toEqual(["a", "c"]);
    const restored = insertCardInBoard(removed, start.columns[0]!.cards[1]!, 1);
    expect(ids(restored)).toEqual(ids(start));
  });

  it("puts a removed column back with its cards", () => {
    const start = board();
    const removed = removeColumnFromBoard(start, "doing");
    expect(removed.columns.map((column) => column.id)).toEqual(["backlog", "review", "done"]);
    const restored = insertColumnInBoard(removed, start.columns[1]!, 1);
    expect(ids(restored)).toEqual(ids(start));
  });

  it("reorders columns", () => {
    const next = moveColumnInBoard(board(), "done", 0);
    expect(next.columns.map((column) => column.id)).toEqual(["done", "backlog", "doing", "review"]);
    const start = board();
    expect(moveColumnInBoard(start, "backlog", 0)).toBe(start);
  });
});

describe("drop geometry", () => {
  it("picks the slot before the first card whose middle is below the pointer", () => {
    expect(dropIndexAt([10, 30, 50], 5)).toBe(0);
    expect(dropIndexAt([10, 30, 50], 31)).toBe(2);
    expect(dropIndexAt([10, 30, 50], 80)).toBe(3);
    expect(dropIndexAt([], 80)).toBe(0);
  });

  it("uses the column under the pointer, else the nearest", () => {
    const rects = [
      { id: "a", left: 0, right: 100 },
      { id: "b", left: 110, right: 210 },
    ];
    expect(dropColumnAt(rects, 50)).toBe("a");
    expect(dropColumnAt(rects, 106)).toBe("b");
    expect(dropColumnAt(rects, 400)).toBe("b");
    expect(dropColumnAt([], 10)).toBeNull();
  });
});

describe("fullDropIndex", () => {
  const cards = ["a", "b", "c", "d", "e"].map((id) => card(id, "backlog"));
  const shown = [cards[1]!, cards[3]!];

  it("drops before the shown card at the slot", () => {
    expect(fullDropIndex(cards, shown, 0, "x")).toBe(1);
    expect(fullDropIndex(cards, shown, 1, "x")).toBe(3);
  });

  it("drops after the last shown card, or at the end when none show", () => {
    expect(fullDropIndex(cards, shown, 2, "x")).toBe(4);
    expect(fullDropIndex(cards, [], 0, "x")).toBe(5);
  });

  it("counts without the moving card", () => {
    expect(fullDropIndex(cards, cards, 4, "a")).toBe(4);
    expect(fullDropIndex(cards, cards, 0, "a")).toBe(0);
    expect(fullDropIndex(cards, shown, 1, "b")).toBe(3);
  });
});

describe("filtering", () => {
  const sample = card("x", "backlog", {
    title: "Fix login redirect",
    notes: "Happens after **OAuth** callback",
    labels: ["bug", "auth"],
  });

  it("matches every term across title, notes, and labels", () => {
    expect(cardMatches(sample, "")).toBe(true);
    expect(cardMatches(sample, "login oauth")).toBe(true);
    expect(cardMatches(sample, "login billing")).toBe(false);
    expect(cardMatches(sample, "auth")).toBe(true);
  });

  it("limits #terms to labels", () => {
    expect(cardMatches(sample, "#bu")).toBe(true);
    expect(cardMatches(sample, "#login")).toBe(false);
  });

  it("keeps every column while filtering its cards", () => {
    const filtered = filterBoardColumns(board().columns, "e");
    expect(filtered.map((column) => column.cards.map((item) => item.id))).toEqual([[], [], [], ["e"]]);
    expect(boardCardCount(board())).toBe(6);
  });
});
