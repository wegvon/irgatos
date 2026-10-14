import type { KanbanBoard, KanbanCard, KanbanColumn } from "./kanban";

export type CardLocation = {
  columnIndex: number;
  index: number;
};

export type CardTarget = {
  columnId: string;
  index: number;
};

export type CardMoveDirection = "up" | "down" | "left" | "right" | "top" | "bottom";

export function findCard(
  board: KanbanBoard,
  cardId: string,
): (CardLocation & { card: KanbanCard; column: KanbanColumn }) | null {
  for (let columnIndex = 0; columnIndex < board.columns.length; columnIndex++) {
    const column = board.columns[columnIndex]!;
    const index = column.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) {
      return { columnIndex, index, card: column.cards[index]!, column };
    }
  }
  return null;
}

/** Place a card at `index` of `columnId`, counted without the card itself. */
export function moveCardInBoard(
  board: KanbanBoard,
  cardId: string,
  target: CardTarget,
  now = Date.now(),
): KanbanBoard {
  const found = findCard(board, cardId);
  if (!found) return board;
  const toColumn = board.columns.findIndex((column) => column.id === target.columnId);
  if (toColumn < 0) return board;
  const crossing = found.column.id !== target.columnId;
  const moved: KanbanCard = crossing
    ? { ...found.card, columnId: target.columnId, updatedAt: now }
    : found.card;
  const columns = board.columns.map((column) => {
    if (column.id !== found.column.id && column.id !== target.columnId) {
      return column;
    }
    const cards = column.cards.filter((card) => card.id !== cardId);
    if (column.id === target.columnId) {
      cards.splice(clamp(target.index, 0, cards.length), 0, moved);
    }
    return { ...column, cards };
  });
  const unchanged =
    !crossing &&
    columns[toColumn]!.cards.every(
      (card, index) => card === found.column.cards[index],
    );
  return unchanged ? board : { ...board, columns };
}

export function removeCardFromBoard(
  board: KanbanBoard,
  cardId: string,
): KanbanBoard {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.cards.some((card) => card.id === cardId)
        ? { ...column, cards: column.cards.filter((card) => card.id !== cardId) }
        : column,
    ),
  };
}

export function insertCardInBoard(
  board: KanbanBoard,
  card: KanbanCard,
  index: number,
): KanbanBoard {
  return {
    ...board,
    columns: board.columns.map((column) => {
      if (column.id !== card.columnId) return column;
      const cards = column.cards.filter((item) => item.id !== card.id);
      cards.splice(clamp(index, 0, cards.length), 0, card);
      return { ...column, cards };
    }),
  };
}

export function replaceCardInBoard(
  board: KanbanBoard,
  card: KanbanCard,
): KanbanBoard {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === card.columnId
        ? {
            ...column,
            cards: column.cards.map((item) => (item.id === card.id ? card : item)),
          }
        : column,
    ),
  };
}

export function moveColumnInBoard(
  board: KanbanBoard,
  columnId: string,
  index: number,
): KanbanBoard {
  const from = board.columns.findIndex((column) => column.id === columnId);
  if (from < 0) return board;
  const columns = board.columns.slice();
  const [column] = columns.splice(from, 1);
  const to = clamp(index, 0, columns.length);
  if (to === from) return board;
  columns.splice(to, 0, column!);
  return { ...board, columns };
}

export function removeColumnFromBoard(
  board: KanbanBoard,
  columnId: string,
): KanbanBoard {
  return {
    ...board,
    columns: board.columns.filter((column) => column.id !== columnId),
  };
}

export function insertColumnInBoard(
  board: KanbanBoard,
  column: KanbanColumn,
  index: number,
): KanbanBoard {
  const columns = board.columns.filter((item) => item.id !== column.id);
  columns.splice(clamp(index, 0, columns.length), 0, column);
  return { ...board, columns };
}

export function renameColumnInBoard(
  board: KanbanBoard,
  columnId: string,
  title: string,
): KanbanBoard {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, title } : column,
    ),
  };
}

/**
 * Where a keyboard move sends a card. Sideways moves keep the card's row
 * where the next column is long enough, so a card can travel straight across.
 */
export function keyboardCardTarget(
  board: KanbanBoard,
  cardId: string,
  direction: CardMoveDirection,
): CardTarget | null {
  const found = findCard(board, cardId);
  if (!found) return null;
  const { columnIndex, index, column } = found;
  const lastIndex = column.cards.length - 1;
  switch (direction) {
    case "up":
      return index > 0 ? { columnId: column.id, index: index - 1 } : null;
    case "down":
      return index < lastIndex ? { columnId: column.id, index: index + 1 } : null;
    case "top":
      return index > 0 ? { columnId: column.id, index: 0 } : null;
    case "bottom":
      return index < lastIndex ? { columnId: column.id, index: lastIndex } : null;
    case "left":
    case "right": {
      const next = board.columns[columnIndex + (direction === "left" ? -1 : 1)];
      if (!next) return null;
      return { columnId: next.id, index: Math.min(index, next.cards.length) };
    }
  }
}

/** Neighbouring card for arrow-key focus, or null at the edges. */
export function neighbourCard(
  columns: readonly KanbanColumn[],
  cardId: string,
  direction: "up" | "down" | "left" | "right",
): string | null {
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    const cards = columns[columnIndex]!.cards;
    const index = cards.findIndex((card) => card.id === cardId);
    if (index < 0) continue;
    if (direction === "up") return cards[index - 1]?.id ?? null;
    if (direction === "down") return cards[index + 1]?.id ?? null;
    const step = direction === "left" ? -1 : 1;
    for (
      let next = columnIndex + step;
      next >= 0 && next < columns.length;
      next += step
    ) {
      const nextCards = columns[next]!.cards;
      if (nextCards.length === 0) continue;
      return nextCards[Math.min(index, nextCards.length - 1)]!.id;
    }
    return null;
  }
  return null;
}

/** Insertion index for a pointer at `y`, given the vertical midpoints of the other cards. */
export function dropIndexAt(midpoints: readonly number[], y: number): number {
  const index = midpoints.findIndex((mid) => y < mid);
  return index < 0 ? midpoints.length : index;
}

/** Column under a pointer at `x`, falling back to the nearest one. */
export function dropColumnAt(
  rects: readonly { id: string; left: number; right: number }[],
  x: number,
): string | null {
  let nearest: { id: string; distance: number } | null = null;
  for (const rect of rects) {
    if (x >= rect.left && x <= rect.right) return rect.id;
    const distance = x < rect.left ? rect.left - x : x - rect.right;
    if (!nearest || distance < nearest.distance) {
      nearest = { id: rect.id, distance };
    }
  }
  return nearest?.id ?? null;
}

/**
 * Filter text matches title, notes, and labels. `#label` terms only match
 * labels, and every term has to match.
 */
export function cardMatches(card: KanbanCard, query: string): boolean {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = `${card.title}\n${card.notes}`.toLocaleLowerCase();
  return terms.every((term) => {
    if (term.startsWith("#") && term.length > 1) {
      const label = term.slice(1);
      return card.labels.some((item) => item.startsWith(label));
    }
    return text.includes(term) || card.labels.some((item) => item.includes(term));
  });
}

export function filterBoardColumns(
  columns: readonly KanbanColumn[],
  query: string,
): KanbanColumn[] {
  if (!query.trim()) return columns as KanbanColumn[];
  return columns.map((column) => ({
    ...column,
    cards: column.cards.filter((card) => cardMatches(card, query)),
  }));
}

/**
 * Translate a slot among the shown (possibly filtered) cards into an index in
 * the full column, counted without the card being moved.
 */
export function fullDropIndex(
  cards: readonly KanbanCard[],
  shown: readonly KanbanCard[],
  slot: number,
  movingId: string,
): number {
  const rest = cards.filter((card) => card.id !== movingId);
  const visible = shown.filter((card) => card.id !== movingId);
  const before = visible[slot];
  if (before) return rest.findIndex((card) => card.id === before.id);
  const after = visible[visible.length - 1];
  if (!after) return rest.length;
  return rest.findIndex((card) => card.id === after.id) + 1;
}

export function boardCardCount(board: KanbanBoard): number {
  return board.columns.reduce((total, column) => total + column.cards.length, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
