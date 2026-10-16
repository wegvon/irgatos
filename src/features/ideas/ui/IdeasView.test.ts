// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IdeaCard, IdeaSearchResult, IdeasState } from "../model/ideas";
import { IdeasView } from "./IdeasView";

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

let root: Root;
let container: HTMLDivElement;
let ideas: IdeasState;
let search: IdeaSearchResult;
let calls: { command: string; args: Record<string, unknown> }[];

const card = (id: string, listId: string, title: string, extra: Partial<IdeaCard> = {}): IdeaCard => ({
  id,
  listId,
  title,
  description: "",
  labelIds: [],
  project: null,
  tasks: [],
  dueAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  ideas = {
    boards: [
      {
        id: "b1",
        title: "Ideas",
        createdAt: 1,
        labels: [{ id: "l1", name: "voice", color: "blue" }],
        lists: [
          {
            id: "inbox",
            title: "Inbox",
            cards: [
              card("c1", "inbox", "Read summaries aloud", {
                labelIds: ["l1"],
                project: "/work/irgatos",
                tasks: [
                  { id: "t1", text: "try Kahya", done: true },
                  { id: "t2", text: "ship", done: false },
                ],
              }),
              card("c2", "inbox", "Coffee subscription"),
            ],
          },
          { id: "next", title: "Next up", cards: [] },
        ],
      },
      { id: "b2", title: "Personal", createdAt: 2, labels: [], lists: [{ id: "p", title: "Inbox", cards: [] }] },
    ],
  };
  search = { hits: [], semantic: "off", note: null };
  calls = [];
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    if (command === "ideas_load") return structuredClone(ideas);
    if (command === "ideas_search") return search;
    if (command === "ideas_card_create") {
      const input = args.card as IdeaCard;
      return { ...input, listId: args.listId, createdAt: 2, updatedAt: 2 };
    }
    if (command === "ideas_card_update") {
      const input = args.card as IdeaCard;
      return { ...card(input.id, "inbox", input.title), ...input, updatedAt: 3 };
    }
    if (command.startsWith("ideas_")) return null;
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

async function render(props: Partial<Parameters<typeof IdeasView>[0]> = {}) {
  await act(async () =>
    root.render(createElement(IdeasView, { recents: [], onClose: () => {}, ...props })),
  );
  await act(async () => {});
}

const writes = (command: string) =>
  calls.filter((call) => call.command === command).map((call) => call.args);

function cardIds(listId: string) {
  return [
    ...container.querySelectorAll<HTMLElement>(`[data-idea-list="${listId}"] [data-idea-card]`),
  ].map((element) => element.dataset.ideaCard);
}

function button(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  )!;
}

async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

it("shows the board's lists and cards with labels, project and checklist", async () => {
  await render();
  expect(cardIds("inbox")).toEqual(["c1", "c2"]);
  const first = container.querySelector('[data-idea-card="c1"]')!;
  expect(first.textContent).toContain("voice");
  expect(first.textContent).toContain("irgatos");
  expect(first.textContent).toContain("1/2");
  expect(container.textContent).toContain("2 ideas");
});

it("quick-adds an idea with a #label taken out of the title", async () => {
  await render();
  const list = container.querySelector('[data-idea-list="next"]')!;
  await act(async () => button("Add idea", list).click());
  const box = list.querySelector("textarea")!;
  await type(box, "Podcast mode #voice");
  await press(box, "Enter");
  const [created] = writes("ideas_card_create");
  expect(created.listId).toBe("next");
  expect(created.card).toMatchObject({ title: "Podcast mode", labelIds: ["l1"], project: null });
  expect(cardIds("next")).toHaveLength(1);
});

it("filters cards by label", async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Filter"]')!.click());
  await act(async () => button("voice", container).click());
  expect(cardIds("inbox")).toEqual(["c1"]);
  await act(async () => button("Clear filter", container).click());
  expect(cardIds("inbox")).toEqual(["c1", "c2"]);
});

it("opens a card and saves checklist changes", async () => {
  await render();
  await act(async () => container.querySelector<HTMLElement>('[data-idea-card="c1"]')!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector<HTMLTextAreaElement>('[aria-label="Idea title"]')!.value).toBe(
    "Read summaries aloud",
  );
  await act(async () =>
    dialog.querySelector<HTMLButtonElement>('[role="checkbox"][aria-label="ship"]')!.click(),
  );
  const [update] = writes("ideas_card_update");
  expect((update.card as IdeaCard).tasks.map((task) => task.done)).toEqual([true, true]);
});

it("deletes a card from its dialog and brings it back with undo", async () => {
  await render();
  await act(async () => container.querySelector<HTMLElement>('[data-idea-card="c2"]')!.click());
  await act(async () => button("Delete").click());
  await act(async () => button("Delete idea").click());
  expect(writes("ideas_card_delete")).toEqual([{ id: "c2" }]);
  expect(cardIds("inbox")).toEqual(["c1"]);
  await act(async () => button("Undo").click());
  await act(async () => {});
  expect(writes("ideas_card_restore")[0]).toMatchObject({ index: 1, card: { id: "c2" } });
});

it("searches by words and meaning and opens a hit on another board", async () => {
  vi.useFakeTimers();
  ideas.boards[1].lists[0].cards = [card("c9", "p", "Morning pages journal")];
  search = {
    hits: [
      { cardId: "c9", score: 0.03, semanticOnly: true },
      { cardId: "c2", score: 0.02, semanticOnly: false },
    ],
    semantic: "on",
    note: null,
  };
  await render();
  const input = container.querySelector<HTMLInputElement>('[aria-label="Search ideas"]')!;
  await type(input, "writing habit");
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  await act(async () => {});
  expect(writes("ideas_search")).toEqual([{ query: "writing habit", limit: 20 }]);
  const options = [...container.querySelectorAll('[role="option"]')];
  expect(options).toHaveLength(2);
  expect(options[0].textContent).toContain("Morning pages journal");
  expect(options[0].textContent).toContain("meaning");
  expect(options[0].textContent).toContain("Personal · Inbox");
  expect(container.textContent).toContain("Words and meaning");
  await press(input, "Enter");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Personal");
  expect(container.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe("Personal");
});

it("points to settings when search by meaning is off", async () => {
  vi.useFakeTimers();
  const onOpenSettings = vi.fn();
  search = { hits: [{ cardId: "c2", score: 1, semanticOnly: false }], semantic: "off", note: null };
  await render({ onOpenSettings });
  await type(container.querySelector<HTMLInputElement>('[aria-label="Search ideas"]')!, "coffee");
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  await act(async () => {});
  expect(container.textContent).toContain("Matching words only");
  await act(async () => button("Open settings", container).click());
  expect(onOpenSettings).toHaveBeenCalled();
});

it("shows no date until a due date is added", async () => {
  await render();
  await act(async () => container.querySelector<HTMLElement>('[data-idea-card="c2"]')!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[aria-label="Due date"]')).toBeNull();
  await act(async () => button("Add a due date", dialog).click());
  const input = dialog.querySelector<HTMLInputElement>('[aria-label="Due date"]')!;
  expect(input.value).toBe("");
  await type(input, "2026-10-20");
  const [update] = writes("ideas_card_update");
  expect((update.card as IdeaCard).dueAt).not.toBeNull();
});
