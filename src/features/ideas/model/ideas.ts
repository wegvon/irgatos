import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Ideas: a Planka-style board of loose ideas, apart from the agents' Kanban. */

export const IDEAS_CHANGED = "irgat:ideas-changed";

export const LABEL_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray",
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

/** Chip classes per label color; each reads on both themes. */
export const LABEL_STYLES: Record<LabelColor, string> = {
  red: "bg-red-500/20 text-red-700 dark:text-red-300",
  orange: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  yellow: "bg-yellow-500/25 text-yellow-800 dark:text-yellow-200",
  green: "bg-green-500/20 text-green-700 dark:text-green-300",
  teal: "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  blue: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  purple: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  pink: "bg-pink-500/20 text-pink-700 dark:text-pink-300",
  gray: "bg-content/10 text-content/70",
};

/** Swatch classes for the color picker. */
export const LABEL_SWATCHES: Record<LabelColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  gray: "bg-zinc-400",
};

export type IdeaLabel = { id: string; name: string; color: LabelColor };
export type IdeaTask = { id: string; text: string; done: boolean };

export type IdeaCard = {
  id: string;
  listId: string;
  title: string;
  description: string;
  labelIds: string[];
  /** Project folder the idea is about; null for anything else. */
  project: string | null;
  tasks: IdeaTask[];
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type IdeaList = { id: string; title: string; cards: IdeaCard[] };

export type IdeaBoard = {
  id: string;
  title: string;
  lists: IdeaList[];
  labels: IdeaLabel[];
  createdAt: number;
};

export type IdeasState = { boards: IdeaBoard[] };

export type IdeaCardInput = Pick<
  IdeaCard,
  "id" | "title" | "description" | "labelIds" | "project" | "tasks" | "dueAt"
>;

export type IdeaSearchHit = {
  cardId: string;
  score: number;
  /** Found by meaning only: none of the query's words are in the card. */
  semanticOnly: boolean;
};

export type IdeaSearchResult = {
  hits: IdeaSearchHit[];
  semantic: "on" | "off" | "unavailable";
  note: string | null;
};

export const newIdeaId = () => crypto.randomUUID();

// ---- backend -------------------------------------------------------------

let pendingWrites = 0;
const drained = new Set<() => void>();

/** Runs writes one at a time, so a reload never lands between two of them. */
let queue: Promise<unknown> = Promise.resolve();
function write<T>(run: () => Promise<T>): Promise<T> {
  pendingWrites += 1;
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next.finally(() => {
    pendingWrites -= 1;
    if (pendingWrites === 0) for (const flush of drained) flush();
  });
}

export const loadIdeas = () => invoke<IdeasState>("ideas_load");

export const createBoard = (id: string, title: string) =>
  write(() => invoke<void>("ideas_board_create", { id, title }));
export const renameBoard = (id: string, title: string) =>
  write(() => invoke<void>("ideas_board_rename", { id, title }));
export const deleteBoard = (id: string) =>
  write(() => invoke<void>("ideas_board_delete", { id }));

export const createList = (boardId: string, id: string, title: string) =>
  write(() => invoke<void>("ideas_list_create", { boardId, id, title }));
export const renameList = (id: string, title: string) =>
  write(() => invoke<void>("ideas_list_rename", { id, title }));
export const moveList = (id: string, index: number) =>
  write(() => invoke<void>("ideas_list_move", { id, index }));
export const deleteList = (id: string) =>
  write(() => invoke<void>("ideas_list_delete", { id }));

export const createCard = (
  listId: string,
  card: IdeaCardInput,
  index?: number,
) =>
  write(() =>
    invoke<IdeaCard>("ideas_card_create", { listId, card, index: index ?? null }),
  );
export const updateCard = (card: IdeaCardInput) =>
  write(() => invoke<IdeaCard>("ideas_card_update", { card }));
export const moveCard = (id: string, listId: string, index: number) =>
  write(() => invoke<void>("ideas_card_move", { id, listId, index }));
export const deleteCard = (id: string) =>
  write(() => invoke<void>("ideas_card_delete", { id }));
export const restoreCard = (card: IdeaCard, index: number) =>
  write(() => invoke<void>("ideas_card_restore", { card, index }));

export const saveLabel = (boardId: string, label: IdeaLabel) =>
  write(() => invoke<IdeaLabel>("ideas_label_save", { boardId, label }));
export const deleteLabel = (id: string) =>
  write(() => invoke<void>("ideas_label_delete", { id }));

export const searchIdeas = (query: string, limit = 20) =>
  invoke<IdeaSearchResult>("ideas_search", { query, limit });

/** Calls `onChange` after the backend changed ideas, once local writes settle. */
export function subscribeIdeas(onChange: () => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  let waiting = false;
  const flush = () => {
    if (!waiting) return;
    waiting = false;
    onChange();
  };
  drained.add(flush);
  void listen(IDEAS_CHANGED, () => {
    waiting = true;
    if (pendingWrites === 0) flush();
  })
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    drained.delete(flush);
    unlisten?.();
  };
}

// ---- pure helpers --------------------------------------------------------

export function findCard(
  state: IdeasState,
  cardId: string,
): { board: IdeaBoard; list: IdeaList; card: IdeaCard; index: number } | null {
  for (const board of state.boards) {
    for (const list of board.lists) {
      const index = list.cards.findIndex((card) => card.id === cardId);
      if (index >= 0) return { board, list, card: list.cards[index], index };
    }
  }
  return null;
}

/** `state` with the card at `index` of `listId` (counted without the card). */
export function withCardMoved(
  state: IdeasState,
  cardId: string,
  listId: string,
  index: number,
): IdeasState {
  const found = findCard(state, cardId);
  if (!found) return state;
  const sameBoard = found.board.lists.some((list) => list.id === listId);
  const moved: IdeaCard = {
    ...found.card,
    listId,
    labelIds: sameBoard ? found.card.labelIds : [],
  };
  return {
    boards: state.boards.map((board) => ({
      ...board,
      lists: board.lists.map((list) => {
        let cards = list.cards.filter((card) => card.id !== cardId);
        if (list.id === listId) {
          cards = [...cards];
          cards.splice(Math.max(0, Math.min(index, cards.length)), 0, moved);
        }
        return cards === list.cards ? list : { ...list, cards };
      }),
    })),
  };
}

export function withListMoved(
  state: IdeasState,
  listId: string,
  index: number,
): IdeasState {
  return {
    boards: state.boards.map((board) => {
      const list = board.lists.find((l) => l.id === listId);
      if (!list) return board;
      const lists = board.lists.filter((l) => l.id !== listId);
      lists.splice(Math.max(0, Math.min(index, lists.length)), 0, list);
      return { ...board, lists };
    }),
  };
}

export function withCardReplaced(state: IdeasState, card: IdeaCard): IdeasState {
  return {
    boards: state.boards.map((board) => ({
      ...board,
      lists: board.lists.map((list) =>
        list.cards.some((c) => c.id === card.id)
          ? {
              ...list,
              cards: list.cards.map((c) => (c.id === card.id ? card : c)),
            }
          : list,
      ),
    })),
  };
}

export function withCardRemoved(state: IdeasState, cardId: string): IdeasState {
  return {
    boards: state.boards.map((board) => ({
      ...board,
      lists: board.lists.map((list) =>
        list.cards.some((c) => c.id === cardId)
          ? { ...list, cards: list.cards.filter((c) => c.id !== cardId) }
          : list,
      ),
    })),
  };
}

export const cardInput = (card: IdeaCard): IdeaCardInput => ({
  id: card.id,
  title: card.title,
  description: card.description,
  labelIds: card.labelIds,
  project: card.project,
  tasks: card.tasks,
  dueAt: card.dueAt,
});

/**
 * Quick add: one line per idea. `#name` picks a board label by name (case
 * and dotted/dotless i ignored) and is taken out of the title; an unknown
 * `#word` stays in the title.
 */
export function parseQuickIdea(
  text: string,
  labels: readonly IdeaLabel[],
): { title: string; labelIds: string[] } {
  const labelIds: string[] = [];
  const title = text
    .replace(/(^|\s)#([^\s#]+)/gu, (match, space: string, name: string) => {
      const label = labels.find((l) => fold(l.name) === fold(name));
      if (!label) return match;
      if (!labelIds.includes(label.id)) labelIds.push(label.id);
      return space;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { title, labelIds };
}

/** Lowercase with Turkish dotted/dotless i folded together, spaces as dashes. */
export function fold(text: string): string {
  return text
    .trim()
    .replace(/[İIı]/g, "i")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export type IdeaFilter = {
  labelIds: string[];
  /** "" for every card, "none" for cards without a project, else a path. */
  project: string;
};

export const EMPTY_FILTER: IdeaFilter = { labelIds: [], project: "" };

export function filterActive(filter: IdeaFilter): boolean {
  return filter.labelIds.length > 0 || filter.project !== "";
}

/** Cards with every chosen label, in the chosen project. */
export function matchesFilter(card: IdeaCard, filter: IdeaFilter): boolean {
  if (!filter.labelIds.every((id) => card.labelIds.includes(id))) return false;
  if (filter.project === "none") return card.project === null;
  if (filter.project) return card.project === filter.project;
  return true;
}

/** Distinct projects on a board's cards, by path. */
export function boardProjects(board: IdeaBoard): string[] {
  const projects = new Set<string>();
  for (const list of board.lists) {
    for (const card of list.cards) if (card.project) projects.add(card.project);
  }
  return [...projects].sort((a, b) => projectLabel(a).localeCompare(projectLabel(b)));
}

export const projectLabel = (path: string) =>
  path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

export function taskProgress(card: IdeaCard): { done: number; total: number } {
  return {
    done: card.tasks.filter((task) => task.done).length,
    total: card.tasks.length,
  };
}

const DAY = 24 * 60 * 60 * 1000;

/** Due dates are whole days, stored as local midnight. */
export function dueState(
  dueAt: number | null,
  now: number,
): "none" | "overdue" | "today" | "soon" | "later" {
  if (dueAt === null) return "none";
  const today = startOfDay(now);
  if (dueAt < today) return "overdue";
  if (dueAt < today + DAY) return "today";
  if (dueAt < today + 3 * DAY) return "soon";
  return "later";
}

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** `yyyy-mm-dd` for a date input, in local time. */
export function dateInputValue(ms: number | null): string {
  if (ms === null) return "";
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
}

/** Index of the slot a pointer at `y` falls into, given card midpoints. */
export function dropIndexAt(midpoints: readonly number[], y: number): number {
  const index = midpoints.findIndex((mid) => y < mid);
  return index === -1 ? midpoints.length : index;
}

/** The list whose column spans `x`, or the nearest one. */
export function dropListAt(
  lists: readonly { id: string; left: number; right: number }[],
  x: number,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const list of lists) {
    if (x >= list.left && x <= list.right) return list.id;
    const distance = x < list.left ? list.left - x : x - list.right;
    if (!best || distance < best.distance) best = { id: list.id, distance };
  }
  return best?.id ?? null;
}
