import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  LABEL_STYLES,
  withCardMoved,
  type IdeaBoard,
  type IdeaCard,
  type IdeasState,
} from "../../../ideas/model/ideas";
import { write } from "../client";
import { basename, dueLabel } from "../format";
import { openSheet } from "../route";
import { Empty, Spinner, useAction } from "./parts";
import {
  ArrowUp,
  Calendar,
  CheckList,
  Folder,
  Idea,
} from "../../../../shared/ui/icons";

const BOARD_KEY = "irgatos.web.board";

function storedBoard(): string | null {
  try {
    return localStorage.getItem(BOARD_KEY);
  } catch {
    return null;
  }
}

/**
 * The Ideas board. On the phone each list is a full-width page you swipe
 * between; on the iPad the lists sit side by side and cards drag across.
 */
export function Ideas({
  ideas,
  mutate,
  now,
  wide,
  header,
}: {
  ideas: IdeasState | null;
  mutate: (update: (state: IdeasState) => IdeasState) => void;
  now: number;
  wide: boolean;
  header?: ReactNode;
}) {
  const [boardId, setBoardId] = useState(storedBoard);
  const [page, setPage] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const pages = useRef<HTMLDivElement>(null);
  const board =
    ideas?.boards.find((entry) => entry.id === boardId) ?? ideas?.boards[0];
  const lists = board?.lists ?? [];
  const targetList = wide
    ? (lists.find((list) => list.id === target) ?? lists[0])
    : lists[Math.min(page, lists.length - 1)];

  useEffect(() => {
    try {
      if (boardId) localStorage.setItem(BOARD_KEY, boardId);
    } catch {
      // private mode
    }
  }, [boardId]);

  const showPage = (index: number) => {
    const element = pages.current;
    if (!element) return;
    element.scrollTo({ left: index * element.clientWidth, behavior: "smooth" });
  };

  const move = (card: string, listId: string, index: number) => {
    mutate((state) => withCardMoved(state, card, listId, index));
    void write("ideaMove", { id: card, listId, index }).catch(() => {});
  };

  return (
    <div className="flex h-full flex-col">
      <header
        className={`shrink-0 ${wide ? "px-8 pt-[calc(var(--safe-top)+20px)]" : "px-4 pt-[calc(var(--safe-top)+10px)]"}`}
      >
        <div className="flex h-9 items-center justify-end gap-3">
          {ideas && ideas.boards.length > 1 ? (
            <select
              aria-label="Board"
              value={board?.id}
              onChange={(event) => setBoardId(event.target.value)}
              className="web-field mr-auto h-8 max-w-[50%] rounded-full bg-(--surface) px-3 text-[14px] font-medium shadow-[0_0_0_0.5px_var(--color-stroke)] outline-none"
            >
              {ideas.boards.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          ) : null}
          {header}
        </div>
        <h1 className="mt-0.5 text-[34px] font-bold leading-tight tracking-[-0.02em]">
          {board && ideas && ideas.boards.length > 1 ? board.title : "Ideas"}
        </h1>
        {targetList ? (
          <Capture
            key={targetList.id}
            listTitle={targetList.title}
            listId={targetList.id}
            lists={wide ? lists : undefined}
            onTarget={setTarget}
          />
        ) : null}
        {!wide && lists.length ? (
          <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {lists.map((list, index) => (
              <button
                key={list.id}
                onClick={() => showPage(index)}
                className={`web-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold ${
                  index === page
                    ? "bg-content text-(--color-background-base)"
                    : "bg-(--surface) text-content/65 shadow-[0_0_0_0.5px_var(--color-stroke)]"
                }`}
              >
                {list.title}
                <span className="tabular-nums opacity-55">
                  {list.cards.length}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {!ideas ? (
        <div className="flex flex-1 justify-center py-20 text-content/40">
          <Spinner className="size-6" />
        </div>
      ) : !board ? (
        <Empty icon={<Idea className="size-6" />} title="No boards yet">
          Make a board in Ideas on your Mac.
        </Empty>
      ) : (
        <div
          ref={pages}
          onScroll={
            wide
              ? undefined
              : (event) => {
                  const element = event.currentTarget;
                  setPage(Math.round(element.scrollLeft / element.clientWidth));
                }
          }
          className={`web-kanban flex min-h-0 flex-1 overflow-x-auto ${
            wide ? "gap-4 px-8 pb-8 pt-5" : "snap-x snap-mandatory"
          }`}
        >
          {board.lists.map((list) => (
            <Column
              key={list.id}
              board={board}
              listId={list.id}
              title={list.title}
              cards={list.cards}
              now={now}
              wide={wide}
              onDrop={move}
            />
          ))}
          {/* Keeps the last column off the edge; scroll padding alone does not. */}
          {wide ? <div aria-hidden className="w-4 shrink-0" /> : null}
        </div>
      )}
    </div>
  );
}

function Capture({
  listId,
  listTitle,
  lists,
  onTarget,
}: {
  listId: string;
  listTitle: string;
  lists?: IdeaBoard["lists"];
  onTarget: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const { busy, run } = useAction();
  const add = async () => {
    const idea = text.trim();
    if (!idea) return;
    const added = await run(
      "add",
      () => write("ideaAdd", { listId, text: idea }),
      `Added to ${listTitle}`,
    );
    if (added) setText("");
  };
  return (
    <form
      className="mt-3 flex h-12 items-center gap-2 rounded-[16px] bg-(--surface) pl-4 pr-1.5 shadow-[0_0_0_0.5px_var(--color-stroke)] focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Idea className="size-[18px] shrink-0 text-content/40" />
      <input
        className="web-field min-w-0 flex-1 bg-transparent outline-none"
        placeholder={`Capture an idea for ${listTitle}  #tag`}
        value={text}
        enterKeyHint="done"
        onChange={(event) => setText(event.target.value)}
      />
      {lists ? (
        <select
          aria-label="List"
          value={listId}
          onChange={(event) => onTarget(event.target.value)}
          className="h-9 shrink-0 rounded-[10px] bg-content/[0.06] px-2 text-[14px] font-medium text-content/70 outline-none"
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.title}
            </option>
          ))}
        </select>
      ) : null}
      <button
        aria-label="Add idea"
        disabled={!text.trim() || busy !== null}
        className="web-press flex size-9 shrink-0 items-center justify-center rounded-full bg-(--accent) text-white disabled:bg-content/15 disabled:text-content/40"
      >
        {busy ? (
          <Spinner />
        ) : (
          <ArrowUp className="size-[18px]" strokeWidth={2.4} />
        )}
      </button>
    </form>
  );
}

function Column({
  board,
  listId,
  title,
  cards,
  now,
  wide,
  onDrop,
}: {
  board: IdeaBoard;
  listId: string;
  title: string;
  cards: IdeaCard[];
  now: number;
  wide: boolean;
  onDrop: (card: string, listId: string, index: number) => void;
}) {
  const [over, setOver] = useState(false);
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const card = event.dataTransfer.getData("text/x-irgatos-idea");
    if (!card) return;
    const rows = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-idea]"),
    ].filter((row) => row.dataset.idea !== card);
    const index = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    onDrop(card, listId, index < 0 ? rows.length : index);
  };

  return (
    <section
      className={`flex min-h-0 shrink-0 flex-col ${
        wide
          ? `w-[300px] rounded-[22px] bg-content/[0.035] ${over ? "shadow-[inset_0_0_0_1.5px_var(--accent)]" : ""}`
          : "w-full snap-start"
      }`}
      onDragOver={
        wide
          ? (event) => {
              event.preventDefault();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={wide ? () => setOver(false) : undefined}
      onDrop={wide ? drop : undefined}
    >
      {wide ? (
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <span className="text-[13px] tabular-nums text-content/40">
            {cards.length}
          </span>
        </div>
      ) : null}
      <div
        className={`web-scroll flex min-h-0 flex-1 flex-col gap-2.5 ${
          wide
            ? "px-2.5 pb-3"
            : "px-4 pb-[calc(var(--tab-height)+var(--safe-bottom)+24px)] pt-3"
        }`}
      >
        {cards.map((card) => (
          <CardView
            key={card.id}
            card={card}
            board={board}
            now={now}
            draggable={wide}
          />
        ))}
        {cards.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-content/15 px-4 py-8 text-center text-[14px] text-content/40">
            {wide ? "Drop ideas here" : `Nothing in ${title} yet`}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function preview(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~[\]()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function CardView({
  card,
  board,
  now,
  draggable,
}: {
  card: IdeaCard;
  board: IdeaBoard;
  now: number;
  draggable: boolean;
}) {
  const labels = card.labelIds
    .map((id) => board.labels.find((label) => label.id === id))
    .filter((label) => !!label);
  const done = card.tasks.filter((task) => task.done).length;
  const description = preview(card.description);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  return (
    <button
      data-idea={card.id}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/x-irgatos-idea", card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => openSheet({ name: "idea", id: card.id })}
      className="web-press flex w-full flex-col gap-2 rounded-[16px] bg-(--surface) p-3.5 text-left shadow-[0_0_0_0.5px_var(--color-stroke),0_1px_2px_rgb(0_0_0/0.06)]"
    >
      {labels.length ? (
        <span className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <span
              key={label.id}
              className={`rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ${LABEL_STYLES[label.color]}`}
            >
              {label.name}
            </span>
          ))}
        </span>
      ) : null}
      <span className="text-[16px] font-medium leading-snug">{card.title}</span>
      {description ? (
        <span className="line-clamp-2 text-[14px] leading-snug text-content/50">
          {description}
        </span>
      ) : null}
      {card.tasks.length || card.dueAt || card.project ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-content/50">
          {card.tasks.length ? (
            <span
              className={`inline-flex items-center gap-1 ${done === card.tasks.length ? "text-(--ok)" : ""}`}
            >
              <CheckList className="size-3.5" />
              {done}/{card.tasks.length}
            </span>
          ) : null}
          {card.dueAt ? (
            <span
              className={`inline-flex items-center gap-1 ${card.dueAt < startOfToday ? "text-(--bad)" : ""}`}
            >
              <Calendar className="size-3.5" />
              {dueLabel(card.dueAt, now)}
            </span>
          ) : null}
          {card.project ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">{basename(card.project)}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
