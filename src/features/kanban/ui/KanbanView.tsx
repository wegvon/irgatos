import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { LAYER } from "../../../shared/lib/layers";
import { basename } from "../../../platform/tauri/fs";
import {
  AlertCircle,
  Kanban,
  LoaderCircle,
  Plus,
  Search,
  Undo2,
  X,
} from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import {
  boardCardCount,
  filterBoardColumns,
  findCard,
  fullDropIndex,
  insertCardInBoard,
  insertColumnInBoard,
  keyboardCardTarget,
  moveCardInBoard,
  moveColumnInBoard,
  neighbourCard,
  removeCardFromBoard,
  removeColumnFromBoard,
  renameColumnInBoard,
  replaceCardInBoard,
  type CardMoveDirection,
  type CardTarget,
} from "../model/boardOps";
import {
  DEFAULT_KANBAN_COLUMNS,
  MAX_COLUMN_TITLE,
  createKanbanCard,
  createKanbanColumn,
  deleteKanbanCard,
  deleteKanbanColumn,
  kanbanProject,
  linkKanbanSession,
  loadKanbanBoard,
  moveKanbanCard,
  moveKanbanColumn,
  parseQuickCard,
  peekKanbanBoard,
  rememberKanbanBoard,
  renameKanbanColumn,
  restoreKanbanCard,
  restoreKanbanColumn,
  subscribeKanban,
  updateKanbanCard,
  type KanbanBoard,
  type KanbanCard,
  type KanbanCardInput,
  type KanbanColumn,
} from "../model/kanban";
import type { LiveCardSession } from "../model/cardSession";
import { CardDialog } from "./CardDialog";
import { CardSessionSection, SessionChip } from "./CardSession";
import { KanbanCardItem } from "./KanbanCardItem";
import { KanbanColumnView } from "./KanbanColumnView";
import { useCardDrag } from "./useCardDrag";
import { columnDropSide, useColumnDrag } from "./useColumnDrag";

export const MAX_KANBAN_COLUMNS = 24;
const UNDO_MS = 8000;

export type KanbanFocusRequest = { project: string; cardId: string; token: number };

type SessionProps = {
  /** Loaded sessions linked from cards, keyed by session id. */
  liveSessions?: ReadonlyMap<string, LiveCardSession>;
  onStartSession?: (card: KanbanCard, project: string) => void;
  /** Rejects when the session can't be opened; the board says so and stays put. */
  onOpenSession?: (sessionId: string) => void | Promise<void>;
};

type Props = SessionProps & {
  besideRail?: boolean;
  compactRail?: boolean;
  cwd?: string;
  recents: RecentProject[];
  /** Opens the board on a project with one card focused. */
  focusRequest?: KanbanFocusRequest | null;
  onClose: () => void;
  onToggleSidebar?: () => void;
};

export function KanbanView({
  besideRail = false,
  compactRail = false,
  cwd,
  recents,
  focusRequest,
  onClose,
  onToggleSidebar,
  ...sessionProps
}: Props) {
  const [project, setProject] = useState(focusRequest?.project ?? cwd ?? "");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (cwd && !focusRequest) setProject(cwd);
  }, [cwd, focusRequest]);
  useEffect(() => {
    if (focusRequest) setProject(focusRequest.project);
  }, [focusRequest]);
  useEffect(() => setQuery(""), [project]);
  const hasProject = looksLikeProject(project);

  return (
    <div
      role="region"
      aria-label="Board"
      data-app-kanban
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : (
          <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <Kanban className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
          <span className="shrink-0 text-content">Board</span>
          <span aria-hidden className="shrink-0 text-content/20">
            /
          </span>
          <SearchableProjectPicker
            cwd={project || "~"}
            recents={recents}
            railCwd={cwd}
            buttonClassName="px-1.5"
            onSelectProject={setProject}
          />
        </div>
        {hasProject ? (
          <label
            className="relative mr-2 flex h-7 w-56 min-w-0 shrink items-center"
            data-tauri-drag-region="false"
          >
            <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder="Filter cards or #label"
              aria-label="Filter cards"
              spellCheck={false}
              autoComplete="off"
              data-tauri-drag-region="false"
              className="h-7 w-full rounded-md border border-content/10 bg-transparent pl-7 pr-2 text-[12px] text-content outline-none select-text placeholder:text-content/40 focus:border-content/25"
            />
          </label>
        ) : null}
        {IS_MAC ? null : <WindowControls />}
      </div>
      {hasProject ? (
        <KanbanBoardContent
          key={kanbanProject(project)}
          project={project}
          query={query}
          onClearQuery={() => setQuery("")}
          focus={
            focusRequest && kanbanProject(focusRequest.project) === kanbanProject(project)
              ? focusRequest
              : null
          }
          {...sessionProps}
        />
      ) : (
        <BoardMessage
          icon={<Kanban className="size-5 text-content/35" strokeWidth={1.5} />}
          title="Pick a project to open its board"
          body="Each project has its own board, so cards sit next to the sessions that work on them."
        />
      )}
    </div>
  );
}

type NoticeInput =
  | { kind: "undo"; text: string; undo: () => void }
  | { kind: "error"; text: string };
type Notice = NoticeInput & { id: number };

type Lift = { cardId: string; before: KanbanBoard };

type ContentProps = SessionProps & {
  project: string;
  query: string;
  onClearQuery: () => void;
  focus: KanbanFocusRequest | null;
};

function KanbanBoardContent({
  project,
  query,
  onClearQuery,
  focus,
  liveSessions,
  onStartSession,
  onOpenSession,
}: ContentProps) {
  const [board, setBoard] = useState<KanbanBoard | null>(() => peekKanbanBoard(project));
  const [loading, setLoading] = useState(() => peekKanbanBoard(project) === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [menu, setMenu] = useState<{ columnId: string; anchor: HTMLElement } | null>(null);
  const [confirmColumn, setConfirmColumn] = useState<KanbanColumn | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const handledFocus = useRef<number | null>(null);
  const hintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef(board);
  const liftRef = useRef<Lift | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const noticeSeq = useRef(0);

  const show = useCallback((next: KanbanBoard) => {
    boardRef.current = next;
    setBoard(next);
  }, []);
  const commit = useCallback(
    (next: KanbanBoard) => {
      show(next);
      rememberKanbanBoard(next);
    },
    [show],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await loadKanbanBoard(project);
      if (!liftRef.current) show(next);
      setLoadError(null);
    } catch (reason: unknown) {
      setLoadError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [project, show]);

  useEffect(() => {
    void refresh();
    const key = kanbanProject(project);
    return subscribeKanban((changed) => {
      if (changed === key) void refresh();
    });
  }, [project, refresh]);

  const pushNotice = useCallback((next: NoticeInput) => {
    noticeSeq.current += 1;
    setNotice({ ...next, id: noticeSeq.current });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice((current) => (current?.id === notice.id ? null : current)),
      notice.kind === "undo" ? UNDO_MS : UNDO_MS * 1.5,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  const persist = useCallback(
    (write: Promise<unknown>) => {
      write.catch((reason: unknown) => {
        pushNotice({ kind: "error", text: `Couldn't save that change. ${errorText(reason)}` });
        void refresh();
      });
    },
    [pushNotice, refresh],
  );

  const openSession = useMemo(
    () =>
      onOpenSession
        ? (sessionId: string) => {
            Promise.resolve(onOpenSession(sessionId)).catch((reason: unknown) => {
              pushNotice({ kind: "error", text: `Couldn't open that session. ${errorText(reason)}` });
            });
          }
        : undefined,
    [onOpenSession, pushNotice],
  );

  const announce = (text: string) => {
    setAnnouncement("");
    window.setTimeout(() => setAnnouncement(text), 30);
  };

  const shownColumns = useMemo(
    () => (board ? filterBoardColumns(board.columns, query) : []),
    [board, query],
  );
  const shownRef = useRef(shownColumns);
  shownRef.current = shownColumns;
  const filtering = query.trim().length > 0;

  const focusCard = useCallback((cardId: string | null) => {
    if (!cardId) return;
    setFocusId(cardId);
    const element = rootRef.current?.querySelector<HTMLElement>(
      `[data-kanban-card="${cardId}"]`,
    );
    if (element) {
      element.focus();
      element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else {
      pendingFocus.current = cardId;
    }
  }, []);

  useLayoutEffect(() => {
    const cardId = pendingFocus.current;
    if (!cardId) return;
    const element = rootRef.current?.querySelector<HTMLElement>(
      `[data-kanban-card="${cardId}"]`,
    );
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  useEffect(() => {
    if (!focus || !board || handledFocus.current === focus.token) return;
    if (!findCard(board, focus.cardId)) {
      if (!loading) handledFocus.current = focus.token;
      return;
    }
    handledFocus.current = focus.token;
    onClearQuery();
    focusCard(focus.cardId);
    setHighlightId(focus.cardId);
    const timer = window.setTimeout(() => setHighlightId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [board, focus, focusCard, loading, onClearQuery]);

  const positionText = (current: KanbanBoard, cardId: string) => {
    const found = findCard(current, cardId);
    if (!found) return "";
    return `${found.column.title}, position ${found.index + 1} of ${found.column.cards.length}`;
  };

  const addCard = (columnId: string, text: string) => {
    const current = boardRef.current;
    const column = current?.columns.find((item) => item.id === columnId);
    if (!current || !column) return;
    const { title, labels } = parseQuickCard(text);
    if (!title) return;
    const now = Date.now();
    const card: KanbanCard = {
      id: crypto.randomUUID(),
      columnId,
      title,
      notes: "",
      labels,
      createdAt: now,
      updatedAt: now,
    };
    commit(insertCardInBoard(current, card, column.cards.length));
    persist(createKanbanCard(columnId, { id: card.id, title, notes: "", labels }));
    setFocusId(card.id);
    announce(`Added ${title} to ${column.title}`);
  };

  const updateCard = (input: KanbanCardInput) => {
    const current = boardRef.current;
    const found = current ? findCard(current, input.id) : null;
    if (!current || !found) return;
    commit(replaceCardInBoard(current, { ...found.card, ...input, updatedAt: Date.now() }));
    persist(updateKanbanCard(input));
  };

  const moveCard = (cardId: string, target: CardTarget) => {
    const current = boardRef.current;
    if (!current) return false;
    const next = moveCardInBoard(current, cardId, target);
    if (next === current) return false;
    pendingFocus.current = cardId;
    commit(next);
    persist(moveKanbanCard(cardId, target.columnId, target.index));
    return true;
  };

  const deleteCard = (cardId: string) => {
    const current = boardRef.current;
    const found = current ? findCard(current, cardId) : null;
    if (!current || !found) return;
    const neighbour =
      neighbourCard(shownRef.current, cardId, "down") ??
      neighbourCard(shownRef.current, cardId, "up");
    commit(removeCardFromBoard(current, cardId));
    persist(deleteKanbanCard(cardId));
    if (openCardId === cardId) setOpenCardId(null);
    if (neighbour) pendingFocus.current = neighbour;
    setFocusId(neighbour);
    pushNotice({
      kind: "undo",
      text: `Deleted “${found.card.title}”`,
      undo: () => {
        const latest = boardRef.current;
        if (!latest || !latest.columns.some((column) => column.id === found.column.id)) {
          pushNotice({ kind: "error", text: "That card's column is gone, so it can't come back." });
          return;
        }
        pendingFocus.current = cardId;
        commit(insertCardInBoard(latest, found.card, found.index));
        persist(restoreKanbanCard(found.card, found.index));
        announce(`Restored ${found.card.title}`);
      },
    });
    announce(`Deleted ${found.card.title}. Press ${IS_MAC ? "Command" : "Control"} Z to undo.`);
  };

  const linkCard = (cardId: string, session: { id: string; title: string } | null) => {
    const current = boardRef.current;
    const found = current ? findCard(current, cardId) : null;
    if (!current || !found) return;
    commit(
      replaceCardInBoard(current, {
        ...found.card,
        updatedAt: Date.now(),
        session: session
          ? { id: session.id, title: session.title, status: null, saved: true }
          : null,
      }),
    );
    persist(
      linkKanbanSession(cardId, session?.id ?? null).then((saved) => {
        const latest = boardRef.current;
        if (latest && findCard(latest, cardId)) commit(replaceCardInBoard(latest, saved));
      }),
    );
    announce(session ? `Linked ${session.title}` : "Unlinked the session");
  };

  const addColumn = (title: string) => {
    const current = boardRef.current;
    const name = title.trim().slice(0, MAX_COLUMN_TITLE);
    if (!current || !name || current.columns.length >= MAX_KANBAN_COLUMNS) return;
    const now = Date.now();
    const column: KanbanColumn = {
      id: crypto.randomUUID(),
      title: name,
      cards: [],
      createdAt: now,
      updatedAt: now,
    };
    const next = insertColumnInBoard(current, column, current.columns.length);
    commit(next);
    persist(createKanbanColumn(current.id, column.id, name));
    return next;
  };

  const restoreDefaultColumns = () => {
    for (const title of DEFAULT_KANBAN_COLUMNS) addColumn(title);
  };

  const renameColumn = (columnId: string, title: string | null) => {
    setRenaming(null);
    const current = boardRef.current;
    const column = current?.columns.find((item) => item.id === columnId);
    const name = title?.trim().slice(0, MAX_COLUMN_TITLE);
    if (!current || !column || !name || name === column.title) return;
    commit(renameColumnInBoard(current, columnId, name));
    persist(renameKanbanColumn(columnId, name));
  };

  const moveColumn = (columnId: string, index: number) => {
    const current = boardRef.current;
    if (!current) return;
    const next = moveColumnInBoard(current, columnId, index);
    if (next === current) return;
    commit(next);
    persist(moveKanbanColumn(columnId, index));
    const column = next.columns[index];
    if (column) announce(`Moved ${column.title} to position ${index + 1} of ${next.columns.length}`);
  };

  const deleteColumn = (columnId: string) => {
    setConfirmColumn(null);
    const current = boardRef.current;
    const index = current?.columns.findIndex((item) => item.id === columnId) ?? -1;
    const column = current?.columns[index];
    if (!current || !column) return;
    commit(removeColumnFromBoard(current, columnId));
    persist(deleteKanbanColumn(columnId));
    const count = column.cards.length;
    pushNotice({
      kind: "undo",
      text: count
        ? `Deleted “${column.title}” and ${count} ${count === 1 ? "card" : "cards"}`
        : `Deleted “${column.title}”`,
      undo: () => {
        const latest = boardRef.current;
        if (!latest) return;
        commit(insertColumnInBoard(latest, column, index));
        persist(restoreKanbanColumn(latest.id, column, index));
        announce(`Restored ${column.title}`);
      },
    });
  };

  const requestDeleteColumn = (columnId: string) => {
    const column = boardRef.current?.columns.find((item) => item.id === columnId);
    if (!column) return;
    if (column.cards.length > 0) setConfirmColumn(column);
    else deleteColumn(columnId);
  };

  const runUndo = () => {
    if (notice?.kind !== "undo") return false;
    setNotice(null);
    notice.undo();
    return true;
  };

  const startLift = (cardId: string) => {
    const current = boardRef.current;
    if (!current) return;
    liftRef.current = { cardId, before: current };
    setLiftedId(cardId);
    const found = findCard(current, cardId);
    announce(
      `Picked up ${found?.card.title ?? "card"}. ${positionText(current, cardId)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`,
    );
  };

  const dropLift = () => {
    const lift = liftRef.current;
    const current = boardRef.current;
    liftRef.current = null;
    setLiftedId(null);
    if (!lift || !current) return;
    const before = findCard(lift.before, lift.cardId);
    const after = findCard(current, lift.cardId);
    if (!before || !after) return;
    if (before.column.id === after.column.id && before.index === after.index) {
      show(lift.before);
      announce("Dropped in place");
      return;
    }
    commit(current);
    persist(moveKanbanCard(lift.cardId, after.column.id, after.index));
    announce(`Dropped in ${positionText(current, lift.cardId)}`);
  };

  const cancelLift = () => {
    const lift = liftRef.current;
    liftRef.current = null;
    setLiftedId(null);
    if (!lift) return;
    pendingFocus.current = lift.cardId;
    show(lift.before);
    announce("Move cancelled");
  };

  const onCardKeyDown = (cardId: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = boardRef.current;
    if (!current) return;
    const direction = arrowDirection(event.key);
    if (liftRef.current?.cardId === cardId) {
      const move: CardMoveDirection | null =
        direction ?? (event.key === "Home" ? "top" : event.key === "End" ? "bottom" : null);
      if (move) {
        event.preventDefault();
        const target = keyboardCardTarget(current, cardId, move);
        if (!target) return;
        pendingFocus.current = cardId;
        show(moveCardInBoard(current, cardId, target));
        announce(positionText(boardRef.current!, cardId));
      } else if (event.key === " " || event.key === "Enter" || event.key === "Tab") {
        if (event.key !== "Tab") event.preventDefault();
        dropLift();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelLift();
      }
      return;
    }
    if (direction && event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const target = keyboardCardTarget(current, cardId, direction);
      if (target && moveCard(cardId, target)) {
        announce(`Moved to ${positionText(boardRef.current!, cardId)}`);
      }
      return;
    }
    if (direction && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      focusCard(neighbourCard(shownRef.current, cardId, direction));
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      setOpenCardId(cardId);
    } else if (event.key === " ") {
      event.preventDefault();
      startLift(cardId);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteCard(cardId);
    }
  };

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      event.key.toLowerCase() === "z" &&
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !isTextField(event.target) &&
      runUndo()
    ) {
      event.preventDefault();
    }
  };

  const cardDrag = useCardDrag({
    boardRef: rootRef,
    onDrop: (cardId, { columnId, slot }) => {
      const current = boardRef.current;
      const column = current?.columns.find((item) => item.id === columnId);
      const shown = shownRef.current.find((item) => item.id === columnId);
      if (!current || !column || !shown) return;
      const index = fullDropIndex(column.cards, shown.cards, slot, cardId);
      if (moveCard(cardId, { columnId, index })) {
        announce(`Moved to ${positionText(boardRef.current!, cardId)}`);
      }
    },
  });

  const columnDrag = useColumnDrag({ boardRef: rootRef, onDrop: moveColumn });

  if (!board) {
    if (loading) {
      return (
        <BoardMessage
          icon={<LoaderCircle className="size-5 animate-spin text-content/35" strokeWidth={1.75} />}
          title="Loading board…"
        />
      );
    }
    return (
      <BoardMessage
        icon={<AlertCircle className="size-5 text-red-400" strokeWidth={1.75} />}
        title="This board couldn't be opened"
        body={loadError ?? "Something went wrong reading the board."}
        action={
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
            className="inline-flex h-7 items-center rounded-md border border-content/15 px-3 text-[12px] text-content/80 hover:border-content/30 hover:bg-content/10 hover:text-content"
          >
            Try again
          </button>
        }
      />
    );
  }

  const totalCards = boardCardCount(board);
  const shownCards = shownColumns.reduce((total, column) => total + column.cards.length, 0);
  const visibleIds = new Set(shownColumns.flatMap((column) => column.cards.map((card) => card.id)));
  const tabbableId =
    focusId && visibleIds.has(focusId)
      ? focusId
      : (shownColumns.find((column) => column.cards.length > 0)?.cards[0]?.id ?? null);
  const openCard = openCardId ? findCard(board, openCardId) : null;
  const menuColumnIndex = menu ? board.columns.findIndex((column) => column.id === menu.columnId) : -1;
  const columnIds = board.columns.map((column) => column.id);
  const draggedCard = cardDrag.drag ? findCard(board, cardDrag.drag.cardId)?.card : null;
  const projectName = basename(project) || project;

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={onRootKeyDown}
      data-kanban-board={board.id}
    >
      <p id={hintId} className="sr-only">
        Press Enter to open, Space to pick up and move with the arrow keys, Alt with an arrow key
        to move straight away, Delete to remove.
      </p>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {board.columns.length > 0 && totalCards === 0 ? (
        <div className="mx-4 mt-3 flex shrink-0 items-center gap-2 rounded-lg border border-content/10 px-3 py-2 text-[12px] text-content/55">
          <Kanban className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
          <span className="min-w-0">
            Nothing on the {projectName} board yet. Add a card to {board.columns[0]!.title} to start
            planning — cards are saved on this computer, no account needed.
          </span>
          <button
            type="button"
            onClick={() => setComposing(board.columns[0]!.id)}
            className="ml-auto inline-flex h-6.5 shrink-0 items-center gap-1 rounded-md bg-content px-2.5 text-[12px] font-medium text-background-base hover:bg-content/80"
          >
            <Plus className="size-3" strokeWidth={2} />
            Add card
          </button>
        </div>
      ) : null}
      {filtering && shownCards === 0 && totalCards > 0 ? (
        <div className="mx-4 mt-3 flex shrink-0 items-center gap-2 text-[12px] text-content/55">
          <span>No cards match “{query.trim()}”.</span>
          <button
            type="button"
            onClick={onClearQuery}
            className="rounded-md px-1.5 py-0.5 text-content/75 underline-offset-2 hover:underline"
          >
            Clear filter
          </button>
        </div>
      ) : null}
      {board.columns.length === 0 ? (
        <BoardMessage
          icon={<Kanban className="size-5 text-content/35" strokeWidth={1.5} />}
          title="This board has no columns"
          body="Add one, or bring back Backlog, In progress, Review, and Done."
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={restoreDefaultColumns}
                className="inline-flex h-7 items-center rounded-md bg-content px-3 text-[12px] font-medium text-background-base hover:bg-content/80"
              >
                Use default columns
              </button>
              <button
                type="button"
                onClick={() => setAddingColumn(true)}
                className="inline-flex h-7 items-center rounded-md border border-content/15 px-3 text-[12px] text-content/80 hover:border-content/30 hover:bg-content/10 hover:text-content"
              >
                Add column
              </button>
            </div>
          }
        >
          {addingColumn ? (
            <div className="mt-3 w-[272px]">
              <ColumnComposer onAdd={addColumn} onClose={() => setAddingColumn(false)} />
            </div>
          ) : null}
        </BoardMessage>
      ) : (
        <div
          data-kanban-scroller
          className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4 pt-3"
        >
          {shownColumns.map((column, index) => {
            const full = board.columns[index]!;
            return (
              <KanbanColumnView
                key={column.id}
                column={column}
                totalCards={full.cards.length}
                filtering={filtering}
                drag={cardDrag.drag}
                liftedId={liftedId}
                highlightId={highlightId}
                tabbableId={tabbableId}
                cardAccessory={(card) => (
                  <SessionChip
                    card={card}
                    live={card.session ? liveSessions?.get(card.session.id) : undefined}
                    onOpen={openSession}
                  />
                )}
                hintId={hintId}
                editing={renaming === column.id}
                composing={composing === column.id}
                columnDragging={columnDrag.drag?.columnId === column.id}
                dropSide={columnDropSide(columnDrag.drag, columnIds, index)}
                onHeaderPointerDown={(event) => {
                  if (renaming !== column.id && !cardDrag.drag) {
                    columnDrag.onHeaderPointerDown(column.id, event);
                  }
                }}
                onCardPointerDown={(cardId, slot, event) => {
                  if (liftRef.current) return;
                  cardDrag.onCardPointerDown(cardId, slot, event);
                }}
                onCardOpen={(cardId) => {
                  if (cardDrag.consumeClick() || liftRef.current) return;
                  setFocusId(cardId);
                  setOpenCardId(cardId);
                }}
                onCardKeyDown={onCardKeyDown}
                onCardFocus={setFocusId}
                onAddCard={(text) => addCard(column.id, text)}
                onCompose={(open) => setComposing(open ? column.id : null)}
                onRename={(title) => renameColumn(column.id, title)}
                onStartRename={() => setRenaming(column.id)}
                onMenu={(anchor) => setMenu({ columnId: column.id, anchor })}
              />
            );
          })}
          <div className="w-[272px] shrink-0">
            {addingColumn ? (
              <ColumnComposer onAdd={addColumn} onClose={() => setAddingColumn(false)} />
            ) : (
              <button
                type="button"
                disabled={board.columns.length >= MAX_KANBAN_COLUMNS}
                title={
                  board.columns.length >= MAX_KANBAN_COLUMNS
                    ? `Boards hold up to ${MAX_KANBAN_COLUMNS} columns`
                    : undefined
                }
                onClick={() => setAddingColumn(true)}
                className="flex h-9 w-full items-center gap-1.5 rounded-xl border border-dashed border-content/12 px-3 text-[12px] text-content/45 hover:border-content/25 hover:text-content/80 disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
                Add column
              </button>
            )}
          </div>
        </div>
      )}
      {cardDrag.drag && draggedCard
        ? createPortal(
            <div
              className="pointer-events-none fixed left-0 top-0"
              style={{
                zIndex: LAYER.popover,
                width: cardDrag.drag.width,
                transform: `translate(${cardDrag.drag.x - cardDrag.drag.offsetX}px, ${
                  cardDrag.drag.y - cardDrag.drag.offsetY
                }px) rotate(1.5deg)`,
              }}
            >
              <KanbanCardItem card={draggedCard} overlay />
            </div>,
            document.body,
          )
        : null}
      {menu && menuColumnIndex >= 0 ? (
        <ExplorerMenu
          anchor={menu.anchor}
          ariaLabel="Column actions"
          items={columnMenuItems(menuColumnIndex, board.columns.length)}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            const columnId = menu.columnId;
            setMenu(null);
            if (id === "add-card") setComposing(columnId);
            else if (id === "rename") setRenaming(columnId);
            else if (id === "move-left") moveColumn(columnId, menuColumnIndex - 1);
            else if (id === "move-right") moveColumn(columnId, menuColumnIndex + 1);
            else if (id === "delete") requestDeleteColumn(columnId);
          }}
        />
      ) : null}
      {confirmColumn ? (
        <Modal title={`Delete “${confirmColumn.title}”?`} size="sm" onClose={() => setConfirmColumn(null)}>
          <div className="flex flex-col gap-4 p-4 text-[12px]">
            <p>
              The column and its {confirmColumn.cards.length}{" "}
              {confirmColumn.cards.length === 1 ? "card" : "cards"} will be deleted. You can undo
              this for a few seconds afterwards.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmColumn(null)}
                className="rounded-md px-3 py-1.5 hover:bg-content/8 active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => deleteColumn(confirmColumn.id)}
                className="rounded-md bg-red-500/20 px-3 py-1.5 font-medium text-red-400 hover:bg-red-500/30 active:scale-[0.97]"
              >
                Delete column
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {openCard ? (
        <CardDialog
          key={openCard.card.id}
          card={openCard.card}
          columns={board.columns}
          project={project}
          onSave={updateCard}
          onMove={(columnId) => {
            const target = board.columns.find((column) => column.id === columnId);
            if (!target) return;
            const index = target.cards.filter((card) => card.id !== openCard.card.id).length;
            moveCard(openCard.card.id, { columnId, index });
          }}
          onDelete={() => deleteCard(openCard.card.id)}
          onClose={() => {
            const cardId = openCard.card.id;
            setOpenCardId(null);
            pendingFocus.current = cardId;
          }}
        >
          <CardSessionSection
            card={openCard.card}
            project={project}
            live={
              openCard.card.session ? liveSessions?.get(openCard.card.session.id) : undefined
            }
            onStart={
              onStartSession
                ? () => {
                    const card = openCard.card;
                    setOpenCardId(null);
                    onStartSession(card, project);
                  }
                : undefined
            }
            onOpen={
              openSession
                ? (sessionId) => {
                    setOpenCardId(null);
                    openSession(sessionId);
                  }
                : undefined
            }
            onLink={(session) => linkCard(openCard.card.id, session)}
          />
        </CardDialog>
      ) : null}
      <BoardToast notice={notice} onUndo={runUndo} onDismiss={() => setNotice(null)} />
    </div>
  );
}

function columnMenuItems(index: number, count: number): ExplorerMenuItem[] {
  return [
    { kind: "item", id: "add-card", label: "Add card" },
    { kind: "item", id: "rename", label: "Rename column" },
    { kind: "item", id: "move-left", label: "Move left", disabled: index === 0 },
    { kind: "item", id: "move-right", label: "Move right", disabled: index >= count - 1 },
    { kind: "sep" },
    { kind: "item", id: "delete", label: "Delete column", danger: true },
  ];
}

function ColumnComposer({
  onAdd,
  onClose,
}: {
  onAdd: (title: string) => unknown;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (value.trim()) onAdd(value);
    onClose();
  };
  return (
    <input
      autoFocus
      aria-label="New column name"
      value={value}
      maxLength={MAX_COLUMN_TITLE}
      placeholder="Column name"
      onChange={(event) => setValue(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      spellCheck={false}
      autoComplete="off"
      className="h-9 w-full rounded-xl border border-accent/60 bg-background-base px-3 text-[12.5px] text-content outline-none placeholder:text-content/35"
    />
  );
}

function BoardToast({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: Notice | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
      style={{ zIndex: LAYER.toast }}
    >
      {notice ? (
        <div
          key={notice.id}
          data-kanban-toast={notice.kind}
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-background-base px-3 py-2 text-[12px] shadow-xl shadow-black/30 ${
            notice.kind === "error" ? "border-red-400/30 text-red-300" : "border-content/12 text-content/85"
          }`}
        >
          <span className="min-w-0 truncate">{notice.text}</span>
          {notice.kind === "undo" ? (
            <button
              type="button"
              onClick={onUndo}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-accent/10"
            >
              <Undo2 className="size-3" strokeWidth={2} />
              Undo
              <kbd className="ml-1 font-sans text-[10.5px] font-normal text-content/40">
                {IS_MAC ? "⌘Z" : "Ctrl+Z"}
              </kbd>
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BoardMessage({
  icon,
  title,
  body,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 pb-12 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-content/5">{icon}</span>
      <p className="mt-1 text-[13px] font-medium text-content/85">{title}</p>
      {body ? <p className="max-w-sm text-[12px] leading-relaxed text-content/50">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
      {children}
    </div>
  );
}

function arrowDirection(key: string): "up" | "down" | "left" | "right" | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return null;
}

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
