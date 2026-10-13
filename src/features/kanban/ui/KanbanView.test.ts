// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forgetKanbanBoards, type KanbanBoard, type KanbanCard } from "../model/kanban";
import { KanbanView } from "./KanbanView";
import { labelTone } from "./KanbanCardItem";
import { columnDropSide } from "./useColumnDrag";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));

const PROJECT = "/work/Edefyn";
let root: Root;
let container: HTMLDivElement;
let board: KanbanBoard;
let calls: { command: string; args: Record<string, unknown> }[];

function card(id: string, columnId: string, title: string, labels: string[] = []): KanbanCard {
  return { id, columnId, title, notes: "", labels, createdAt: 1, updatedAt: 1 };
}

function seedBoard(withCards = true): KanbanBoard {
  const column = (id: string, title: string, cards: KanbanCard[] = []) => ({
    id,
    title,
    cards,
    createdAt: 1,
    updatedAt: 1,
  });
  return {
    id: "board-1",
    project: PROJECT,
    createdAt: 1,
    columns: [
      column(
        "backlog",
        "Backlog",
        withCards
          ? [card("c1", "backlog", "Write release notes"), card("c2", "backlog", "Fix login", ["bug"])]
          : [],
      ),
      column("doing", "In progress", withCards ? [card("c3", "doing", "Ship board")] : []),
      column("review", "Review"),
      column("done", "Done"),
    ],
  };
}

beforeEach(() => {
  forgetKanbanBoards();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  board = seedBoard();
  calls = [];
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "kanban_board") return structuredClone(board);
    if (command === "kanban_card_create") {
      const input = args.card as KanbanCard;
      return { ...input, columnId: args.columnId, createdAt: 2, updatedAt: 2 };
    }
    if (command.startsWith("kanban_card_restore")) return args.card;
    if (command.startsWith("kanban_")) return null;
    if (command.startsWith("plugin:event|")) return 1;
    throw new Error(`Unexpected command: ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(cwd = PROJECT) {
  await act(async () =>
    root.render(createElement(KanbanView, { cwd, recents: [{ path: PROJECT, openedAt: 1 }], onClose: () => {} })),
  );
  await act(async () => {});
}

function writes(command: string) {
  return calls.filter((call) => call.command === command).map((call) => call.args);
}

function cardElement(id: string) {
  return container.querySelector<HTMLElement>(`[data-kanban-card="${id}"]`)!;
}

function columnCards(columnId: string) {
  return [
    ...container.querySelectorAll<HTMLElement>(
      `[data-kanban-column="${columnId}"] [data-kanban-card]`,
    ),
  ].map((element) => element.dataset.kanbanCard);
}

async function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim().startsWith(label) || element.getAttribute("aria-label") === label,
  );
}

it("asks for a project when the active folder is not one", async () => {
  await render("~");
  expect(container.textContent).toContain("Pick a project to open its board");
  expect(writes("kanban_board")).toHaveLength(0);
});

it("shows the empty board hint and files quick-add tags as labels", async () => {
  board = seedBoard(false);
  await render();
  expect(container.textContent).toContain("Nothing on the Edefyn board yet");
  expect(
    [...container.querySelectorAll("[data-kanban-column] h3")].map((title) => title.textContent),
  ).toEqual(["Backlog", "In progress", "Review", "Done"]);

  await act(async () => button("Add card to Backlog")!.click());
  const field = container.querySelector<HTMLTextAreaElement>('[aria-label="New card title"]')!;
  await act(async () => typeInto(field, "Fix login redirect #bug"));
  await press(field, "Enter");

  expect(writes("kanban_card_create")).toEqual([
    {
      columnId: "backlog",
      card: { id: expect.any(String), title: "Fix login redirect", notes: "", labels: ["bug"] },
      index: null,
    },
  ]);
  expect(columnCards("backlog")).toHaveLength(1);
  expect(container.textContent).not.toContain("Nothing on the Edefyn board yet");
});

it("moves a card with Alt+Arrow and with a Space lift", async () => {
  await render();
  await act(async () => cardElement("c1").focus());
  await press(cardElement("c1"), "ArrowRight", { altKey: true });
  expect(columnCards("doing")).toEqual(["c1", "c3"]);
  expect(writes("kanban_card_move")).toEqual([{ id: "c1", columnId: "doing", index: 0 }]);
  expect(document.activeElement).toBe(cardElement("c1"));

  await press(cardElement("c2"), " ");
  await press(cardElement("c2"), "ArrowRight");
  await press(cardElement("c2"), "ArrowRight");
  await press(cardElement("c2"), "ArrowDown");
  expect(columnCards("review")).toEqual(["c2"]);
  expect(writes("kanban_card_move")).toHaveLength(1);
  await press(cardElement("c2"), " ");
  expect(writes("kanban_card_move")[1]).toEqual({ id: "c2", columnId: "review", index: 0 });
});

it("puts a lifted card back on Escape without saving", async () => {
  await render();
  await press(cardElement("c1"), " ");
  await press(cardElement("c1"), "ArrowRight");
  expect(columnCards("doing")).toContain("c1");
  await press(cardElement("c1"), "Escape");
  expect(columnCards("backlog")).toEqual(["c1", "c2"]);
  expect(writes("kanban_card_move")).toHaveLength(0);
});

it("moves focus between cards with the arrow keys", async () => {
  await render();
  await act(async () => cardElement("c1").focus());
  await press(cardElement("c1"), "ArrowDown");
  expect(document.activeElement).toBe(cardElement("c2"));
  await press(cardElement("c2"), "ArrowRight");
  expect(document.activeElement).toBe(cardElement("c3"));
  expect(cardElement("c3").tabIndex).toBe(0);
  expect(cardElement("c1").tabIndex).toBe(-1);
});

it("undoes a card delete from the toast and with the shortcut", async () => {
  await render();
  await press(cardElement("c1"), "Delete");
  expect(columnCards("backlog")).toEqual(["c2"]);
  expect(writes("kanban_card_delete")).toEqual([{ id: "c1" }]);
  expect(container.querySelector("[data-kanban-toast='undo']")?.textContent).toContain(
    "Deleted “Write release notes”",
  );

  await act(async () => button("Undo")!.click());
  expect(columnCards("backlog")).toEqual(["c1", "c2"]);
  expect(writes("kanban_card_restore")).toEqual([
    { card: expect.objectContaining({ id: "c1" }), index: 0 },
  ]);

  await press(cardElement("c2"), "Delete");
  await press(container.querySelector("[data-kanban-board]")!, "z", { ctrlKey: true });
  expect(columnCards("backlog")).toEqual(["c1", "c2"]);
  expect(writes("kanban_card_restore")).toHaveLength(2);
});

it("confirms before deleting a column that still has cards", async () => {
  await render();
  await act(async () => button("Backlog column actions")!.click());
  const remove = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
    (item) => item.textContent?.includes("Delete column"),
  )!;
  await act(async () => remove.click());
  expect(document.body.textContent).toContain("The column and its 2 cards will be deleted.");
  expect(writes("kanban_column_delete")).toHaveLength(0);

  await act(async () => button("Delete column")!.click());
  expect(writes("kanban_column_delete")).toEqual([{ id: "backlog" }]);
  expect(container.querySelector("[data-kanban-column='backlog']")).toBeNull();

  await act(async () => button("Undo")!.click());
  expect(columnCards("backlog")).toEqual(["c1", "c2"]);
  expect(writes("kanban_column_restore")).toEqual([
    { boardId: "board-1", column: expect.objectContaining({ id: "backlog" }), index: 0 },
  ]);
});

it("deletes an empty column straight away with undo", async () => {
  await render();
  await act(async () => button("Done column actions")!.click());
  const remove = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
    (item) => item.textContent?.includes("Delete column"),
  )!;
  await act(async () => remove.click());
  expect(writes("kanban_column_delete")).toEqual([{ id: "done" }]);
  expect(container.querySelector("[data-kanban-toast='undo']")?.textContent).toContain(
    "Deleted “Done”",
  );
});

it("filters by label and says when nothing matches", async () => {
  await render();
  const filter = container.querySelector<HTMLInputElement>('[aria-label="Filter cards"]')!;
  await act(async () => typeInto(filter, "#bug"));
  expect(columnCards("backlog")).toEqual(["c2"]);
  expect(columnCards("doing")).toEqual([]);
  expect(container.querySelector("[data-kanban-column='doing']")?.textContent).toContain(
    "No matching cards",
  );

  await act(async () => typeInto(filter, "nothing-like-this"));
  expect(container.textContent).toContain("No cards match “nothing-like-this”.");
  await act(async () => button("Clear filter")!.click());
  expect(columnCards("backlog")).toEqual(["c1", "c2"]);
});

it("offers a retry when the board can't be read", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "kanban_board") throw new Error("database is locked");
    return 1;
  });
  await render();
  expect(container.textContent).toContain("This board couldn't be opened");
  expect(container.textContent).toContain("database is locked");
  expect(button("Try again")).toBeTruthy();
});

it("keeps label colours stable", () => {
  expect(labelTone("bug")).toBe(labelTone("bug"));
  expect(labelTone("bug")).toMatch(/^bg-/);
});

it("draws the column drop line where the column will land", () => {
  const ids = ["a", "b", "c", "d"];
  expect(ids.map((_, index) => columnDropSide({ columnId: "a", slot: 2 }, ids, index))).toEqual([
    null,
    null,
    null,
    "before",
  ]);
  expect(ids.map((_, index) => columnDropSide({ columnId: "a", slot: 3 }, ids, index))).toEqual([
    null,
    null,
    null,
    "after",
  ]);
  expect(ids.map((_, index) => columnDropSide({ columnId: "c", slot: 0 }, ids, index))).toEqual([
    "before",
    null,
    null,
    null,
  ]);
  expect(columnDropSide({ columnId: "b", slot: 1 }, ids, 2)).toBeNull();
});
