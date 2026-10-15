import { describe, expect, it } from "vitest";
import {
  boardProjects,
  dateInputValue,
  dropIndexAt,
  dropListAt,
  dueState,
  matchesFilter,
  parseDateInput,
  parseQuickIdea,
  startOfDay,
  taskProgress,
  withCardMoved,
  withCardRemoved,
  withListMoved,
  type IdeaCard,
  type IdeaLabel,
  type IdeasState,
} from "./ideas";

const card = (id: string, listId: string, extra: Partial<IdeaCard> = {}): IdeaCard => ({
  id,
  listId,
  title: id,
  description: "",
  labelIds: [],
  project: null,
  tasks: [],
  dueAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const state = (): IdeasState => ({
  boards: [
    {
      id: "b1",
      title: "Ideas",
      createdAt: 0,
      labels: [{ id: "l1", name: "app", color: "blue" }],
      lists: [
        { id: "inbox", title: "Inbox", cards: [card("a", "inbox", { labelIds: ["l1"] }), card("b", "inbox")] },
        { id: "next", title: "Next up", cards: [card("c", "next")] },
      ],
    },
    {
      id: "b2",
      title: "Personal",
      createdAt: 0,
      labels: [],
      lists: [{ id: "p", title: "Inbox", cards: [] }],
    },
  ],
});

const titles = (s: IdeasState, board: number, list: number) =>
  s.boards[board].lists[list].cards.map((c) => c.id);

describe("ideas board helpers", () => {
  it("moves a card within and across lists", () => {
    const within = withCardMoved(state(), "a", "inbox", 1);
    expect(titles(within, 0, 0)).toEqual(["b", "a"]);
    const across = withCardMoved(state(), "a", "next", 0);
    expect(titles(across, 0, 0)).toEqual(["b"]);
    expect(titles(across, 0, 1)).toEqual(["a", "c"]);
    expect(across.boards[0].lists[1].cards[0]).toMatchObject({ listId: "next", labelIds: ["l1"] });
  });

  it("drops labels when a card moves to another board", () => {
    const moved = withCardMoved(state(), "a", "p", 5);
    expect(moved.boards[1].lists[0].cards[0]).toMatchObject({ id: "a", listId: "p", labelIds: [] });
  });

  it("moves lists and removes cards", () => {
    expect(withListMoved(state(), "next", 0).boards[0].lists.map((l) => l.id)).toEqual(["next", "inbox"]);
    expect(titles(withCardRemoved(state(), "b"), 0, 0)).toEqual(["a"]);
  });

  it("takes known #labels out of a quick idea and keeps unknown ones", () => {
    const labels: IdeaLabel[] = [
      { id: "l1", name: "İrgatos", color: "blue" },
      { id: "l2", name: "side project", color: "green" },
    ];
    expect(parseQuickIdea("  #irgatos voice  summaries #later ", labels)).toEqual({
      title: "voice summaries #later",
      labelIds: ["l1"],
    });
    expect(parseQuickIdea("#side-project #IRGATOS", labels)).toEqual({
      title: "",
      labelIds: ["l2", "l1"],
    });
  });

  it("filters by every chosen label and by project", () => {
    const tagged = card("x", "l", { labelIds: ["a", "b"], project: "/w/app" });
    expect(matchesFilter(tagged, { labelIds: ["a"], project: "" })).toBe(true);
    expect(matchesFilter(tagged, { labelIds: ["a", "c"], project: "" })).toBe(false);
    expect(matchesFilter(tagged, { labelIds: [], project: "/w/app" })).toBe(true);
    expect(matchesFilter(tagged, { labelIds: [], project: "none" })).toBe(false);
    expect(matchesFilter(card("y", "l"), { labelIds: [], project: "none" })).toBe(true);
  });

  it("lists a board's projects by name", () => {
    const s = state();
    s.boards[0].lists[0].cards[0].project = "/w/zeta";
    s.boards[0].lists[1].cards[0].project = "/w/alpha/";
    expect(boardProjects(s.boards[0])).toEqual(["/w/alpha/", "/w/zeta"]);
  });

  it("counts checklist progress", () => {
    expect(
      taskProgress(
        card("x", "l", {
          tasks: [
            { id: "1", text: "a", done: true },
            { id: "2", text: "b", done: false },
          ],
        }),
      ),
    ).toEqual({ done: 1, total: 2 });
  });

  it("reads due dates as whole local days", () => {
    const now = new Date(2026, 9, 15, 23, 30).getTime();
    const today = startOfDay(now);
    const day = 24 * 60 * 60 * 1000;
    expect(dueState(null, now)).toBe("none");
    expect(dueState(today - day, now)).toBe("overdue");
    expect(dueState(today, now)).toBe("today");
    expect(dueState(today + 2 * day, now)).toBe("soon");
    expect(dueState(today + 5 * day, now)).toBe("later");
    expect(dateInputValue(parseDateInput("2026-10-15"))).toBe("2026-10-15");
    expect(parseDateInput("")).toBeNull();
  });

  it("finds drop slots from layout", () => {
    expect(dropIndexAt([10, 30, 50], 5)).toBe(0);
    expect(dropIndexAt([10, 30, 50], 35)).toBe(2);
    expect(dropIndexAt([10, 30, 50], 99)).toBe(3);
    const lists = [
      { id: "a", left: 0, right: 100 },
      { id: "b", left: 110, right: 210 },
    ];
    expect(dropListAt(lists, 50)).toBe("a");
    expect(dropListAt(lists, 106)).toBe("b");
    expect(dropListAt(lists, 500)).toBe("b");
    expect(dropListAt([], 5)).toBeNull();
  });
});
