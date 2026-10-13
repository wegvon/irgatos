import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { projectKey } from "../../../shared/lib/paths";

export const KANBAN_CHANGED = "irgat:kanban-changed";
export const DEFAULT_KANBAN_COLUMNS = [
  "Backlog",
  "In progress",
  "Review",
  "Done",
] as const;
export const MAX_CARD_TITLE = 200;
export const MAX_COLUMN_TITLE = 60;
export const MAX_CARD_LABELS = 3;
export const MAX_CARD_LABEL_LENGTH = 32;

export type KanbanCard = {
  id: string;
  columnId: string;
  title: string;
  notes: string;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  session?: KanbanCardSession | null;
};

/** Last state the app saw for a stored session; live sessions report their own. */
export type StoredSessionStatus =
  | "running"
  | "needs-input"
  | "finished"
  | "failed"
  | "stopped"
  | "draft";

export type KanbanCardSession = {
  id: string;
  status?: StoredSessionStatus | null;
  title?: string | null;
  harness?: string | null;
  /** False until the session has been saved, or once it was deleted. */
  saved: boolean;
};

export type KanbanSessionLink = {
  sessionId: string;
  cardId: string;
  project: string;
  status?: StoredSessionStatus | null;
};

export type KanbanColumn = {
  id: string;
  title: string;
  cards: KanbanCard[];
  createdAt: number;
  updatedAt: number;
};

export type KanbanBoard = {
  id: string;
  project: string;
  columns: KanbanColumn[];
  createdAt: number;
};

export type KanbanCardInput = {
  id: string;
  title: string;
  notes: string;
  labels: string[];
};

const boards = new Map<string, KanbanBoard>();

export function kanbanProject(cwd: string): string {
  return projectKey(cwd);
}

export function peekKanbanBoard(project: string): KanbanBoard | null {
  return boards.get(kanbanProject(project)) ?? null;
}

/** Keep the cached copy current with optimistic edits so reopening the view shows them. */
export function rememberKanbanBoard(board: KanbanBoard) {
  boards.set(kanbanProject(board.project), board);
}

export function forgetKanbanBoards() {
  boards.clear();
}

export async function loadKanbanBoard(project: string): Promise<KanbanBoard> {
  const board = await invoke<KanbanBoard>("kanban_board", {
    project: kanbanProject(project),
  });
  rememberKanbanBoard(board);
  return board;
}

let writes: Promise<unknown> = Promise.resolve();
let pendingWrites = 0;
const drained = new Set<() => void>();

/**
 * Board edits are applied optimistically, so their writes must land in the
 * order they were made. A refresh that arrives mid-sequence would show an
 * intermediate state; listeners wait for the queue to drain instead.
 */
export function enqueueKanbanWrite<T>(write: () => Promise<T>): Promise<T> {
  pendingWrites += 1;
  const run = writes.then(write, write);
  writes = run
    .catch(() => undefined)
    .finally(() => {
      pendingWrites -= 1;
      if (pendingWrites > 0) return;
      for (const listener of [...drained]) listener();
    });
  return run;
}

export function kanbanWritesPending(): boolean {
  return pendingWrites > 0;
}

/** Runs `onChange` for board edits from any window, after local writes settle. */
export function subscribeKanban(
  onChange: (project: string) => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const waiting = new Set<string>();
  const flush = () => {
    for (const project of waiting) onChange(project);
    waiting.clear();
  };
  drained.add(flush);
  void listen<{ project: string }>(KANBAN_CHANGED, (event) => {
    const project = event.payload?.project;
    if (!project) return;
    boards.delete(project);
    waiting.add(project);
    if (!kanbanWritesPending()) flush();
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

export function createKanbanCard(
  columnId: string,
  card: KanbanCardInput,
  index?: number,
): Promise<KanbanCard> {
  return enqueueKanbanWrite(() =>
    invoke<KanbanCard>("kanban_card_create", {
      columnId,
      card,
      index: index ?? null,
    }),
  );
}

export function updateKanbanCard(card: KanbanCardInput): Promise<KanbanCard> {
  return enqueueKanbanWrite(() =>
    invoke<KanbanCard>("kanban_card_update", { card }),
  );
}

export function moveKanbanCard(
  id: string,
  columnId: string,
  index: number,
): Promise<void> {
  return enqueueKanbanWrite(() =>
    invoke<void>("kanban_card_move", { id, columnId, index }),
  );
}

export function deleteKanbanCard(id: string): Promise<void> {
  return enqueueKanbanWrite(() => invoke<void>("kanban_card_delete", { id }));
}

export function restoreKanbanCard(
  card: KanbanCard,
  index: number,
): Promise<KanbanCard> {
  return enqueueKanbanWrite(() =>
    invoke<KanbanCard>("kanban_card_restore", { card, index }),
  );
}

export function createKanbanColumn(
  boardId: string,
  id: string,
  title: string,
): Promise<KanbanColumn> {
  return enqueueKanbanWrite(() =>
    invoke<KanbanColumn>("kanban_column_create", { boardId, id, title }),
  );
}

export function renameKanbanColumn(id: string, title: string): Promise<void> {
  return enqueueKanbanWrite(() =>
    invoke<void>("kanban_column_rename", { id, title }),
  );
}

export function moveKanbanColumn(id: string, index: number): Promise<void> {
  return enqueueKanbanWrite(() =>
    invoke<void>("kanban_column_move", { id, index }),
  );
}

export function deleteKanbanColumn(id: string): Promise<void> {
  return enqueueKanbanWrite(() =>
    invoke<void>("kanban_column_delete", { id }),
  );
}

export function restoreKanbanColumn(
  boardId: string,
  column: KanbanColumn,
  index: number,
): Promise<void> {
  return enqueueKanbanWrite(() =>
    invoke<void>("kanban_column_restore", { boardId, column, index }),
  );
}

export function linkKanbanSession(
  id: string,
  sessionId: string | null,
): Promise<KanbanCard> {
  return enqueueKanbanWrite(() =>
    invoke<KanbanCard>("kanban_card_link_session", { id, sessionId }),
  );
}

export function recordKanbanSessionStatus(
  sessionId: string,
  status: StoredSessionStatus,
): Promise<void> {
  return enqueueKanbanWrite(() =>
    invoke<void>("kanban_session_status", { sessionId, status }),
  );
}

export function loadKanbanSessionLinks(): Promise<KanbanSessionLink[]> {
  return invoke<KanbanSessionLink[]>("kanban_session_links");
}

/** Mirrors the store's label rules so chips render as they will be saved. */
export function normalizeCardLabels(labels: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const input of labels) {
    const label = input
      .trim()
      .replace(/^#+/, "")
      .split(/\s+/)
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .slice(0, MAX_CARD_LABEL_LENGTH)
      .replace(/-+$/g, "");
    if (!label || normalized.includes(label)) continue;
    normalized.push(label);
    if (normalized.length === MAX_CARD_LABELS) break;
  }
  return normalized;
}

export function cardTitleFromText(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_CARD_TITLE);
}

const QUICK_LABEL = /^#[\p{L}\p{N}_-]+$/u;

/**
 * Quick-add text: trailing `#tags` become labels, so "Fix login #bug" files a
 * labelled card. Issue refs like `#123` stay in the title.
 */
export function parseQuickCard(text: string): { title: string; labels: string[] } {
  const words = text.split(/\s+/).filter(Boolean);
  let end = words.length;
  while (end > 0 && QUICK_LABEL.test(words[end - 1]!) && !/^#\d+$/.test(words[end - 1]!)) {
    end -= 1;
  }
  if (end === 0) return { title: cardTitleFromText(text), labels: [] };
  return {
    title: cardTitleFromText(words.slice(0, end).join(" ")),
    labels: normalizeCardLabels(words.slice(end)),
  };
}
