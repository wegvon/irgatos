import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Calendar,
  CheckList,
  Idea,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  X,
} from "../../../shared/ui/icons";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import type { RecentProject } from "../../projects/model/recents";
import {
  EMPTY_FILTER,
  LABEL_STYLES,
  boardProjects,
  createBoard,
  createCard,
  createList,
  deleteBoard,
  deleteCard,
  deleteLabel,
  deleteList,
  dueState,
  filterActive,
  findCard,
  loadIdeas,
  matchesFilter,
  moveCard,
  moveList,
  newIdeaId,
  parseQuickIdea,
  projectLabel,
  renameBoard,
  renameList,
  restoreCard,
  saveLabel,
  searchIdeas,
  subscribeIdeas,
  taskProgress,
  updateCard,
  withCardMoved,
  withCardRemoved,
  withCardReplaced,
  withListMoved,
  type IdeaBoard,
  type IdeaCard,
  type IdeaCardInput,
  type IdeaFilter,
  type IdeaLabel,
  type IdeaList,
  type IdeaSearchResult,
  type IdeasState,
} from "../model/ideas";
import { IdeaCardDialog } from "./IdeaCardDialog";
import { useIdeaDrag, type IdeaDrag, type IdeaDropSlot } from "./useIdeaDrag";

type Props = {
  besideRail?: boolean;
  compactRail?: boolean;
  recents: RecentProject[];
  onOpenSettings?: () => void;
  onClose: () => void;
  onToggleSidebar?: () => void;
};

const BOARD_KEY = "irgat:ideas-board";

function rememberedBoard(): string | null {
  try {
    return localStorage.getItem(BOARD_KEY);
  } catch {
    return null;
  }
}

function rememberBoard(id: string) {
  try {
    localStorage.setItem(BOARD_KEY, id);
  } catch {
    // Not kept; the first board opens next time.
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Undo = { card: IdeaCard; index: number };

export function IdeasView({
  besideRail,
  compactRail,
  recents,
  onOpenSettings,
  onClose,
  onToggleSidebar,
}: Props) {
  const [state, setState] = useState<IdeasState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(rememberedBoard);
  const [filter, setFilter] = useState<IdeaFilter>(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [addingList, setAddingList] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openCardRef = useRef(openCardId);
  openCardRef.current = openCardId;

  const reload = useCallback(async () => {
    try {
      setState(await loadIdeas());
      setError(null);
    } catch (err: unknown) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    return subscribeIdeas(() => void reload());
  }, [reload]);

  /** Applies a change on screen at once, then saves it; a failure reloads. */
  const apply = useCallback(
    async (local: ((s: IdeasState) => IdeasState) | null, save: () => Promise<unknown>) => {
      if (local) setState((current) => (current ? local(current) : current));
      try {
        await save();
      } catch (err: unknown) {
        setError(message(err));
        await reload();
      }
    },
    [reload],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=dialog]")) return;
      if (openCardRef.current) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const board: IdeaBoard | null = useMemo(() => {
    if (!state || state.boards.length === 0) return null;
    return state.boards.find((b) => b.id === boardId) ?? state.boards[0];
  }, [state, boardId]);

  const selectBoard = useCallback((id: string) => {
    setBoardId(id);
    rememberBoard(id);
    setFilter(EMPTY_FILTER);
  }, []);

  const openCard = useCallback(
    (cardId: string) => {
      if (!state) return;
      const found = findCard(state, cardId);
      if (!found) return;
      if (found.board.id !== board?.id) selectBoard(found.board.id);
      setOpenCardId(cardId);
    },
    [state, board?.id, selectBoard],
  );

  const onDrop = useCallback(
    (cardId: string, slot: IdeaDropSlot) => {
      if (!state || !board) return;
      const list = board.lists.find((l) => l.id === slot.listId);
      const found = findCard(state, cardId);
      if (!list || !found) return;
      // The slot counts shown cards; the backend counts all of the list's cards.
      const shown = list.cards.filter((c) => c.id !== cardId && matchesFilter(c, filter));
      const before = shown[slot.index];
      const others = list.cards.filter((c) => c.id !== cardId);
      const index = before ? others.findIndex((c) => c.id === before.id) : others.length;
      if (found.list.id === list.id && found.index === index) return;
      void apply(
        (s) => withCardMoved(s, cardId, list.id, index),
        () => moveCard(cardId, list.id, index),
      );
    },
    [state, board, filter, apply],
  );

  const { drag, onCardPointerDown, consumeClick } = useIdeaDrag({ boardRef, onDrop });

  const addIdea = useCallback(
    async (list: IdeaList, text: string) => {
      if (!board) return;
      const { title, labelIds } = parseQuickIdea(text, board.labels);
      if (!title) return;
      const id = newIdeaId();
      const now = Date.now();
      const card: IdeaCard = {
        id,
        listId: list.id,
        title,
        description: "",
        labelIds,
        project: filter.project && filter.project !== "none" ? filter.project : null,
        tasks: [],
        dueAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await apply(
        (s) => ({
          boards: s.boards.map((b) => ({
            ...b,
            lists: b.lists.map((l) =>
              l.id === list.id ? { ...l, cards: [...l.cards, card] } : l,
            ),
          })),
        }),
        () => createCard(list.id, card),
      );
    },
    [board, filter.project, apply],
  );

  const saveCard = useCallback(
    (input: IdeaCardInput) => {
      if (!state) return;
      const found = findCard(state, input.id);
      if (!found) return;
      const next: IdeaCard = { ...found.card, ...input, updatedAt: Date.now() };
      void apply(
        (s) => withCardReplaced(s, next),
        async () => {
          const saved = await updateCard(input);
          setState((s) => (s ? withCardReplaced(s, saved) : s));
        },
      );
    },
    [state, apply],
  );

  const removeCard = useCallback(
    (cardId: string) => {
      if (!state) return;
      const found = findCard(state, cardId);
      if (!found) return;
      setOpenCardId(null);
      setUndo({ card: found.card, index: found.index });
      void apply((s) => withCardRemoved(s, cardId), () => deleteCard(cardId));
    },
    [state, apply],
  );

  const onSaveLabel = useCallback(
    async (label: IdeaLabel) => {
      if (!board) return null;
      try {
        const saved = await saveLabel(board.id, label);
        await reload();
        return saved;
      } catch (err: unknown) {
        setError(message(err));
        return null;
      }
    },
    [board, reload],
  );

  const header = (
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
        <Idea className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
        <span className="min-w-0 truncate text-content">Ideas</span>
      </div>
      {state ? (
        <IdeaSearch
          state={state}
          onOpen={openCard}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      {IS_MAC ? null : <WindowControls />}
    </div>
  );

  if (!state || !board) {
    return (
      <Shell header={header}>
        <div className="flex flex-1 items-center justify-center text-[12px] text-content/50">
          {error ?? <LoaderCircle className="size-4 animate-spin" />}
        </div>
      </Shell>
    );
  }

  const projects = boardProjects(board);
  const openFound = openCardId ? findCard(state, openCardId) : null;
  const dragged = drag ? findCard(state, drag.cardId)?.card : undefined;

  return (
    <Shell header={header}>
      <BoardBar
        state={state}
        board={board}
        filterOn={filterActive(filter)}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((open) => !open)}
        onSelect={selectBoard}
        onCreate={(title) => {
          const id = newIdeaId();
          void apply(null, async () => {
            await createBoard(id, title);
            await reload();
            selectBoard(id);
          });
        }}
        onRename={(title) => void apply(null, () => renameBoard(board.id, title))}
        onDelete={() =>
          void apply(null, async () => {
            await deleteBoard(board.id);
            await reload();
          })
        }
      />
      {filterOpen ? (
        <FilterBar
          board={board}
          projects={projects}
          filter={filter}
          onChange={setFilter}
        />
      ) : null}
      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke bg-red-500/10 px-3 py-1.5 text-[12px] text-red-600 dark:text-red-300">
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setError(null)}
            className="grid size-5 place-items-center rounded hover:bg-content/8"
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        </div>
      ) : null}
      <div ref={boardRef} className="relative flex min-h-0 flex-1 flex-col">
        <div
          data-idea-scroller
          className="flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden p-3"
        >
          {board.lists.map((list, listIndex) => (
            <ListColumn
              key={list.id}
              list={list}
              board={board}
              filter={filter}
              drag={drag}
              first={listIndex === 0}
              last={listIndex === board.lists.length - 1}
              onAdd={(text) => addIdea(list, text)}
              onOpen={(id) => {
                if (!consumeClick()) setOpenCardId(id);
              }}
              onCardPointerDown={onCardPointerDown}
              onRename={(title) =>
                void apply(
                  (s) => ({
                    boards: s.boards.map((b) => ({
                      ...b,
                      lists: b.lists.map((l) => (l.id === list.id ? { ...l, title } : l)),
                    })),
                  }),
                  () => renameList(list.id, title),
                )
              }
              onMove={(delta) => {
                const index = listIndex + delta;
                void apply(
                  (s) => withListMoved(s, list.id, index),
                  () => moveList(list.id, index),
                );
              }}
              onDelete={() =>
                void apply(
                  (s) => ({
                    boards: s.boards.map((b) => ({
                      ...b,
                      lists: b.lists.filter((l) => l.id !== list.id),
                    })),
                  }),
                  () => deleteList(list.id),
                )
              }
              canDelete={board.lists.length > 1}
            />
          ))}
          <div className="w-72 shrink-0">
            {addingList ? (
              <InlineInput
                placeholder="List name"
                onSubmit={(title) => {
                  const id = newIdeaId();
                  void apply(
                    (s) => ({
                      boards: s.boards.map((b) =>
                        b.id === board.id
                          ? { ...b, lists: [...b.lists, { id, title, cards: [] }] }
                          : b,
                      ),
                    }),
                    () => createList(board.id, id, title),
                  );
                }}
                onCancel={() => setAddingList(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingList(true)}
                className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-content/15 px-3 py-2 text-[12px] text-content/50 hover:border-content/30 hover:text-content"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
                Add list
              </button>
            )}
          </div>
        </div>
        {drag && dragged ? (
          <div
            className="pointer-events-none fixed z-50"
            style={{
              left: drag.x - drag.offsetX,
              top: drag.y - drag.offsetY,
              width: drag.width,
            }}
          >
            <CardFace card={dragged} board={board} overlay />
          </div>
        ) : null}
        {undo ? (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-stroke bg-background-base px-3 py-2 text-[12px] shadow-lg">
            <span className="text-content/70">Idea deleted.</span>
            <button
              type="button"
              onClick={() => {
                const { card, index } = undo;
                setUndo(null);
                void apply(null, async () => {
                  await restoreCard(card, index);
                  await reload();
                });
              }}
              className="font-medium text-accent hover:underline"
            >
              Undo
            </button>
          </div>
        ) : null}
      </div>
      {openFound ? (
        <IdeaCardDialog
          key={openFound.card.id}
          board={openFound.board}
          card={openFound.card}
          recents={recents}
          onSave={saveCard}
          onMove={(listId) => {
            const target = openFound.board.lists.find((l) => l.id === listId);
            if (!target || listId === openFound.list.id) return;
            void apply(
              (s) => withCardMoved(s, openFound.card.id, listId, target.cards.length),
              () => moveCard(openFound.card.id, listId, target.cards.length),
            );
          }}
          onDelete={() => removeCard(openFound.card.id)}
          onSaveLabel={onSaveLabel}
          onDeleteLabel={(id) =>
            void apply(null, async () => {
              await deleteLabel(id);
              await reload();
            })
          }
          onClose={() => setOpenCardId(null)}
        />
      ) : null}
    </Shell>
  );
}

function Shell({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Ideas"
      data-app-ideas
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      {header}
      {children}
    </div>
  );
}

// ---- board bar ------------------------------------------------------------

function BoardBar({
  state,
  board,
  filterOn,
  filterOpen,
  onToggleFilter,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  state: IdeasState;
  board: IdeaBoard;
  filterOn: boolean;
  filterOpen: boolean;
  onToggleFilter: () => void;
  onSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "new" | "rename" | "menu" | "confirm">("idle");
  const count = board.lists.reduce((sum, list) => sum + list.cards.length, 0);
  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-stroke px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Boards">
        {state.boards.map((b) =>
          mode === "rename" && b.id === board.id ? (
            <div key={b.id} className="w-44 shrink-0">
              <InlineInput
                initial={b.title}
                placeholder="Board name"
                compact
                onSubmit={(title) => {
                  onRename(title);
                  setMode("idle");
                }}
                onCancel={() => setMode("idle")}
              />
            </div>
          ) : (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === board.id}
              onClick={() => onSelect(b.id)}
              onDoubleClick={() => b.id === board.id && setMode("rename")}
              className={`shrink-0 rounded-md px-2.5 py-1 text-[12px] ${
                b.id === board.id
                  ? "bg-selection text-content"
                  : "text-content/55 hover:bg-content/5 hover:text-content"
              }`}
            >
              {b.title}
            </button>
          ),
        )}
        {mode === "new" ? (
          <div className="w-44 shrink-0">
            <InlineInput
              placeholder="Board name"
              compact
              onSubmit={(title) => {
                onCreate(title);
                setMode("idle");
              }}
              onCancel={() => setMode("idle")}
            />
          </div>
        ) : (
          <button
            type="button"
            title="New board"
            aria-label="New board"
            onClick={() => setMode("new")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/5 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <span className="shrink-0 px-1 text-[11px] tabular-nums text-content/40">
        {count} {count === 1 ? "idea" : "ideas"}
      </span>
      <button
        type="button"
        title="Filter"
        aria-label="Filter"
        aria-pressed={filterOpen}
        onClick={onToggleFilter}
        className={`relative grid size-7 shrink-0 place-items-center rounded-md hover:bg-content/5 ${
          filterOpen || filterOn ? "bg-selection text-content" : "text-content/60 hover:text-content"
        }`}
      >
        <ListFilter className="size-3.5" strokeWidth={1.75} />
        {filterOn ? (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" />
        ) : null}
      </button>
      <div className="relative shrink-0">
        <button
          type="button"
          title="Board options"
          aria-label="Board options"
          aria-expanded={mode === "menu" || mode === "confirm"}
          onClick={() => setMode(mode === "menu" ? "idle" : "menu")}
          className="grid size-7 place-items-center rounded-md text-content/60 hover:bg-content/5 hover:text-content"
        >
          <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
        </button>
        {mode === "menu" || mode === "confirm" ? (
          <Menu onClose={() => setMode("idle")}>
            {mode === "confirm" ? (
              <div className="flex flex-col gap-2 p-2 text-[12px]">
                <p className="text-content/70">
                  Delete “{board.title}” and its {count} {count === 1 ? "idea" : "ideas"}?
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onDelete();
                      setMode("idle");
                    }}
                    className="rounded-md bg-red-500/90 px-2.5 py-1 font-medium text-white hover:bg-red-500"
                  >
                    Delete board
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("idle")}
                    className="rounded-md px-2 py-1 text-content/60 hover:bg-content/8 hover:text-content"
                  >
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <>
                <MenuItem onClick={() => setMode("rename")}>Rename board</MenuItem>
                <MenuItem
                  disabled={state.boards.length <= 1}
                  danger
                  onClick={() => setMode("confirm")}
                >
                  Delete board…
                </MenuItem>
              </>
            )}
          </Menu>
        ) : null}
      </div>
    </div>
  );
}

function FilterBar({
  board,
  projects,
  filter,
  onChange,
}: {
  board: IdeaBoard;
  projects: string[];
  filter: IdeaFilter;
  onChange: (filter: IdeaFilter) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-stroke px-3 py-1.5 text-[12px]">
      <select
        value={filter.project}
        aria-label="Project"
        onChange={(event) => onChange({ ...filter, project: event.target.value })}
        className="rounded-md border border-stroke bg-transparent px-2 py-0.5 text-[12px] text-content outline-none focus:border-content/40"
      >
        <option value="">All projects</option>
        <option value="none">Not about a project</option>
        {projects.map((project) => (
          <option key={project} value={project}>
            {projectLabel(project)}
          </option>
        ))}
      </select>
      {board.labels.map((label) => {
        const on = filter.labelIds.includes(label.id);
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange({
                ...filter,
                labelIds: on
                  ? filter.labelIds.filter((id) => id !== label.id)
                  : [...filter.labelIds, label.id],
              })
            }
            className={`rounded-md px-2 py-0.5 text-[11.5px] font-medium ${LABEL_STYLES[label.color]} ${
              on ? "ring-1 ring-content/40" : "opacity-50 hover:opacity-80"
            }`}
          >
            {label.name}
          </button>
        );
      })}
      {board.labels.length === 0 ? (
        <span className="text-content/40">Labels you create on ideas show up here.</span>
      ) : null}
      {filterActive(filter) ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="ml-auto rounded px-1.5 py-0.5 text-content/55 hover:bg-content/8 hover:text-content"
        >
          Clear filter
        </button>
      ) : null}
    </div>
  );
}

// ---- lists and cards ------------------------------------------------------

function ListColumn({
  list,
  board,
  filter,
  drag,
  first,
  last,
  canDelete,
  onAdd,
  onOpen,
  onCardPointerDown,
  onRename,
  onMove,
  onDelete,
}: {
  list: IdeaList;
  board: IdeaBoard;
  filter: IdeaFilter;
  drag: IdeaDrag | null;
  first: boolean;
  last: boolean;
  canDelete: boolean;
  onAdd: (text: string) => Promise<void>;
  onOpen: (cardId: string) => void;
  onCardPointerDown: (
    cardId: string,
    origin: IdeaDropSlot,
    event: React.PointerEvent,
  ) => void;
  onRename: (title: string) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"idle" | "rename" | "menu" | "confirm">("idle");
  const shown = list.cards.filter((card) => matchesFilter(card, filter));
  const visible = drag ? shown.filter((card) => card.id !== drag.cardId) : shown;
  const placeholderAt = drag?.slot.listId === list.id ? drag.slot.index : -1;

  return (
    <section
      data-idea-list={list.id}
      aria-label={list.title}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-xl bg-content/[0.035]"
    >
      <header className="flex shrink-0 items-center gap-1 px-2.5 pb-1 pt-2">
        {mode === "rename" ? (
          <div className="min-w-0 flex-1">
            <InlineInput
              initial={list.title}
              placeholder="List name"
              compact
              onSubmit={(title) => {
                onRename(title);
                setMode("idle");
              }}
              onCancel={() => setMode("idle")}
            />
          </div>
        ) : (
          <h2
            className="min-w-0 flex-1 truncate px-0.5 text-[12.5px] font-semibold text-content"
            onDoubleClick={() => setMode("rename")}
            title="Double-click to rename"
          >
            {list.title}
          </h2>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-content/40">
          {filterActive(filter) ? `${shown.length}/${list.cards.length}` : list.cards.length}
        </span>
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label={`${list.title} options`}
            onClick={() => setMode(mode === "menu" ? "idle" : "menu")}
            className="grid size-6 place-items-center rounded text-content/45 hover:bg-content/8 hover:text-content"
          >
            <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
          </button>
          {mode === "menu" || mode === "confirm" ? (
            <Menu onClose={() => setMode("idle")}>
              {mode === "confirm" ? (
                <div className="flex flex-col gap-2 p-2 text-[12px]">
                  <p className="text-content/70">
                    Delete “{list.title}”
                    {list.cards.length
                      ? ` and its ${list.cards.length} ${list.cards.length === 1 ? "idea" : "ideas"}`
                      : ""}
                    ?
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete();
                        setMode("idle");
                      }}
                      className="rounded-md bg-red-500/90 px-2.5 py-1 font-medium text-white hover:bg-red-500"
                    >
                      Delete list
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("idle")}
                      className="rounded-md px-2 py-1 text-content/60 hover:bg-content/8 hover:text-content"
                    >
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <MenuItem
                    onClick={() => {
                      setMode("idle");
                      setAdding(true);
                    }}
                  >
                    Add idea
                  </MenuItem>
                  <MenuItem onClick={() => setMode("rename")}>Rename list</MenuItem>
                  <MenuItem
                    disabled={first}
                    onClick={() => {
                      setMode("idle");
                      onMove(-1);
                    }}
                  >
                    Move left
                  </MenuItem>
                  <MenuItem
                    disabled={last}
                    onClick={() => {
                      setMode("idle");
                      onMove(1);
                    }}
                  >
                    Move right
                  </MenuItem>
                  <MenuItem
                    disabled={!canDelete}
                    danger
                    onClick={() => (list.cards.length ? setMode("confirm") : onDelete())}
                  >
                    Delete list{list.cards.length ? "…" : ""}
                  </MenuItem>
                </>
              )}
            </Menu>
          ) : null}
        </div>
      </header>
      <div
        data-idea-list-body
        className="flex min-h-2 flex-col gap-1.5 overflow-y-auto px-2 pb-1"
      >
        {visible.map((card, index) => (
          <div key={card.id} className="contents">
            {placeholderAt === index ? <DropPlaceholder /> : null}
            <div
              data-idea-card={card.id}
              role="button"
              tabIndex={0}
              aria-label={card.title}
              onPointerDown={(event) =>
                onCardPointerDown(card.id, { listId: list.id, index }, event)
              }
              onClick={() => onOpen(card.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(card.id);
                }
              }}
              className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <CardFace card={card} board={board} />
            </div>
          </div>
        ))}
        {placeholderAt >= visible.length ? <DropPlaceholder /> : null}
      </div>
      <footer className="shrink-0 px-2 pb-2 pt-1">
        {adding ? (
          <InlineInput
            multiline
            keepOpen
            placeholder={
              board.labels.length
                ? `Type an idea, #${board.labels[0].name} adds a label`
                : "Type an idea and press Enter"
            }
            onSubmit={(text) => void onAdd(text)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-content/50 hover:bg-content/5 hover:text-content"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            Add idea
          </button>
        )}
      </footer>
    </section>
  );
}

function DropPlaceholder() {
  return <div className="h-10 shrink-0 rounded-lg border-2 border-dashed border-accent/40 bg-accent/5" />;
}

const DUE_STYLES = {
  none: "",
  overdue: "bg-red-500/15 text-red-600 dark:text-red-300",
  today: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  soon: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  later: "text-content/50",
} as const;

function CardFace({
  card,
  board,
  overlay = false,
}: {
  card: IdeaCard;
  board: IdeaBoard;
  overlay?: boolean;
}) {
  const labels = card.labelIds
    .map((id) => board.labels.find((label) => label.id === id))
    .filter((label): label is IdeaLabel => Boolean(label));
  const progress = taskProgress(card);
  const due = dueState(card.dueAt, Date.now());
  const hasMeta =
    card.project || progress.total || card.dueAt !== null || card.description.trim();
  return (
    <div
      className={`flex cursor-grab select-none flex-col gap-1.5 rounded-lg border bg-background-base px-2.5 py-2 ${
        overlay
          ? "rotate-1 cursor-grabbing border-content/25 shadow-xl shadow-black/30"
          : "border-content/10 shadow-sm shadow-black/5 hover:border-content/25"
      }`}
    >
      {labels.length ? (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label.id}
              className={`max-w-full truncate rounded px-1.5 py-px text-[10.5px] font-medium ${LABEL_STYLES[label.color]}`}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      <span className="line-clamp-4 break-words text-[13px] leading-snug text-content">
        {card.title}
      </span>
      {hasMeta ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-content/50">
          {card.project ? (
            <span className="max-w-[10rem] truncate rounded bg-content/[0.06] px-1.5 py-px" title={card.project}>
              {projectLabel(card.project)}
            </span>
          ) : null}
          {card.description.trim() ? (
            <span title="Has a description">
              <StickyNote className="size-3" strokeWidth={1.75} />
            </span>
          ) : null}
          {progress.total ? (
            <span
              className={`flex items-center gap-0.5 tabular-nums ${
                progress.done === progress.total ? "text-green-600 dark:text-green-400" : ""
              }`}
            >
              <CheckList className="size-3" strokeWidth={1.75} />
              {progress.done}/{progress.total}
            </span>
          ) : null}
          {card.dueAt !== null ? (
            <span className={`flex items-center gap-0.5 rounded px-1 py-px ${DUE_STYLES[due]}`}>
              <Calendar className="size-3" strokeWidth={1.75} />
              {new Date(card.dueAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---- search ---------------------------------------------------------------

function IdeaSearch({
  state,
  onOpen,
  onOpenSettings,
}: {
  state: IdeasState;
  onOpen: (cardId: string) => void;
  onOpenSettings?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<IdeaSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const request = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = query.trim();
    const id = ++request.current;
    if (!text) {
      setResult(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = window.setTimeout(() => {
      searchIdeas(text, 20)
        .then((next) => {
          if (id !== request.current) return;
          setResult(next);
          setActive(0);
        })
        .catch((err: unknown) => {
          if (id === request.current)
            setResult({ hits: [], semantic: "unavailable", note: message(err) });
        })
        .finally(() => {
          if (id === request.current) setBusy(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const hits = (result?.hits ?? [])
    .map((hit) => ({ hit, found: findCard(state, hit.cardId) }))
    .filter((row) => row.found !== null);

  const choose = (cardId: string) => {
    setOpen(false);
    onOpen(cardId);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && hits[active]) {
      event.preventDefault();
      choose(hits[active].hit.cardId);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery("");
      else (event.target as HTMLInputElement).blur();
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative mr-2 w-72 shrink-0" data-no-drag>
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-stroke px-2 focus-within:border-content/40">
        {busy ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-content/40" />
        ) : (
          <Search className="size-3.5 shrink-0 text-content/40" strokeWidth={1.75} />
        )}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search ideas by words or meaning"
          aria-label="Search ideas"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-content/35"
        />
      </div>
      {open && query.trim() && result ? (
        <div className="absolute right-0 top-8 z-40 flex max-h-[60vh] w-[26rem] flex-col overflow-hidden rounded-lg border border-stroke bg-background-base shadow-xl">
          <ul className="min-h-0 flex-1 overflow-y-auto p-1" role="listbox" aria-label="Matching ideas">
            {hits.length === 0 ? (
              <li className="px-2 py-3 text-[12px] text-content/45">No matching ideas.</li>
            ) : null}
            {hits.map(({ hit, found }, index) => (
              <li key={hit.cardId} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(hit.cardId)}
                  className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left ${
                    index === active ? "bg-selection" : "hover:bg-content/5"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-content">
                      {found!.card.title}
                    </span>
                    {hit.semanticOnly ? (
                      <span
                        className="flex shrink-0 items-center gap-0.5 rounded bg-accent/10 px-1 py-px text-[10px] text-accent"
                        title="Found by meaning, not by the words you typed"
                      >
                        <Sparkles className="size-2.5" strokeWidth={2} />
                        meaning
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-[11px] text-content/45">
                    {found!.board.title} · {found!.list.title}
                    {found!.card.project ? ` · ${projectLabel(found!.card.project)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <SearchNote result={result} onOpenSettings={onOpenSettings} />
        </div>
      ) : null}
    </div>
  );
}

function SearchNote({
  result,
  onOpenSettings,
}: {
  result: IdeaSearchResult;
  onOpenSettings?: () => void;
}) {
  if (result.semantic === "on") {
    return (
      <p className="flex shrink-0 items-center gap-1 border-t border-stroke px-2.5 py-1.5 text-[11px] text-content/40">
        <Sparkles className="size-3" strokeWidth={1.75} />
        Words and meaning
      </p>
    );
  }
  return (
    <p className="shrink-0 border-t border-stroke px-2.5 py-1.5 text-[11px] text-content/50">
      {result.note ??
        "Matching words only. Turn on Semantic search to also find ideas by meaning."}
      {result.semantic === "off" && onOpenSettings ? (
        <>
          {" "}
          <button type="button" onClick={onOpenSettings} className="text-accent hover:underline">
            Open settings
          </button>
        </>
      ) : null}
    </p>
  );
}

// ---- small pieces ---------------------------------------------------------

function InlineInput({
  initial = "",
  placeholder,
  multiline = false,
  keepOpen = false,
  compact = false,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  multiline?: boolean;
  /** Stay open after a submit, for adding several in a row. */
  keepOpen?: boolean;
  compact?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => {
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) {
      onCancel();
      return;
    }
    onSubmit(text);
    if (keepOpen) setValue("");
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  const className = `w-full rounded-md border border-content/20 bg-background-base text-content outline-none placeholder:text-content/35 focus:border-accent ${
    compact ? "px-2 py-0.5 text-[12px]" : "px-2 py-1.5 text-[13px]"
  }`;
  return multiline ? (
    <textarea
      autoFocus
      rows={2}
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (!value.trim()) onCancel();
      }}
      className={`${className} resize-none`}
    />
  ) : (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => (value.trim() && value.trim() !== initial ? submit() : onCancel())}
      className={className}
    />
  );
}

function Menu({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-0 top-7 z-40 flex w-52 flex-col rounded-lg border border-stroke bg-background-base p-1 shadow-xl"
    >
      {children}
    </div>
  );
}

function MenuItem({
  disabled = false,
  danger = false,
  onClick,
  children,
}: {
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-left text-[12px] disabled:opacity-35 ${
        danger ? "text-red-600 hover:bg-red-500/10 dark:text-red-300" : "text-content hover:bg-content/5"
      }`}
    >
      {children}
    </button>
  );
}
