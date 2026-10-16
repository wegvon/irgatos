import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  withCardMoved,
  type IdeaBoard,
  type IdeaCard,
  type IdeasState,
} from "../../../ideas/model/ideas";
import { write } from "../client";
import { basename, dueLabel } from "../format";
import { openSheet } from "../route";
import {
  Empty,
  Pill,
  Spinner,
  TONE,
  Ticks,
  useAction,
  type Tone,
} from "./parts";
import { Calendar, Folder, Idea, Plus } from "../../../../shared/ui/icons";

const BOARD_KEY = "irgatos.web.board";

/** Each list keeps one color, in board order: Inbox blue, Exploring violet… */
const LIST_TONES: Tone[] = [
  "blue",
  "purple",
  "orange",
  "gray",
  "green",
  "pink",
  "teal",
];
const listTone = (index: number): Tone =>
  LIST_TONES[index % LIST_TONES.length]!;

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
        className={`flex shrink-0 flex-col gap-4 ${wide ? "px-8 pt-[calc(var(--safe-top)+22px)]" : "px-4 pt-[calc(var(--safe-top)+10px)]"}`}
      >
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <div className="flex items-end justify-between gap-3">
          <h1 className="min-w-0 truncate text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
            {board && ideas && ideas.boards.length > 1 ? board.title : "Ideas"}
          </h1>
          {ideas && ideas.boards.length > 1 ? (
            <select
              aria-label="Board"
              value={board?.id}
              onChange={(event) => setBoardId(event.target.value)}
              className="glass web-field mb-1 h-9 max-w-[45%] shrink-0 rounded-full px-3 text-[14px] font-semibold text-(--ink) outline-none"
            >
              {ideas.boards.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>
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
          <div className="glass -mx-1 flex gap-1 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none]">
            {lists.map((list, index) => (
              <button
                key={list.id}
                onClick={() => showPage(index)}
                aria-pressed={index === page}
                className={`web-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold ${
                  index === page
                    ? "bg-white text-(--ink) shadow-[0_4px_14px_-6px_rgb(64_44_150/0.35)]"
                    : "text-(--ink-2)"
                }`}
              >
                <span
                  className={`${TONE[listTone(index)]} tone-dot size-2 rounded-full`}
                />
                {list.title}
                <span className="font-medium tabular-nums text-(--ink-3)">
                  {list.cards.length}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {!ideas ? (
        <div className="flex flex-1 justify-center py-20 text-(--ink-3)">
          <Spinner className="size-6" />
        </div>
      ) : !board ? (
        <Empty title="No boards yet">Make a board in Ideas on your Mac.</Empty>
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
            wide ? "gap-4 px-8 pb-8 pt-5" : "snap-x snap-mandatory pt-1"
          }`}
        >
          {board.lists.map((list, index) => (
            <Column
              key={list.id}
              tone={listTone(index)}
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
      className="glass flex h-[52px] items-center gap-2 rounded-full pl-4 pr-1.5 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent),var(--shadow-card)]"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Idea className="size-[18px] shrink-0 text-(--accent)" />
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
          className="h-9 shrink-0 rounded-full bg-white/80 px-3 text-[14px] font-semibold text-(--ink-2) shadow-[inset_0_0_0_1px_var(--hairline)] outline-none"
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
        className="accent-fill web-press flex size-10 shrink-0 items-center justify-center rounded-full disabled:bg-none disabled:bg-(--accent-soft) disabled:text-(--accent)/50 disabled:shadow-none"
      >
        {busy ? <Spinner /> : <Plus className="size-5" strokeWidth={2.4} />}
      </button>
    </form>
  );
}

function Column({
  board,
  tone,
  listId,
  title,
  cards,
  now,
  wide,
  onDrop,
}: {
  board: IdeaBoard;
  tone: Tone;
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
          ? `w-[310px] rounded-[28px] bg-white/35 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.7)] ${over ? "shadow-[inset_0_0_0_2px_var(--accent)]" : ""}`
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
        <div className="flex items-center gap-2 px-4 pb-2.5 pt-4">
          <span className={`${TONE[tone]} tone-dot size-2.5 rounded-full`} />
          <h2 className="flex-1 text-[16px] font-semibold text-(--ink)">
            {title}
          </h2>
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-white/85 px-1.5 text-[12px] font-semibold tabular-nums text-(--ink-2)">
            {cards.length}
          </span>
        </div>
      ) : null}
      <div
        className={`web-scroll flex min-h-0 flex-1 flex-col gap-2.5 ${
          wide
            ? "px-2.5 pb-3"
            : "px-4 pb-[calc(var(--tab-height)+var(--safe-bottom)+40px)] pt-3"
        }`}
      >
        {cards.map((card) => (
          <CardView
            key={card.id}
            tone={tone}
            card={card}
            board={board}
            now={now}
            draggable={wide}
          />
        ))}
        {cards.length === 0 ? (
          <div className="rounded-[22px] border-[1.5px] border-dashed border-white/90 bg-white/30 px-4 py-9 text-center text-[14px] font-medium text-(--ink-3)">
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
  tone,
  now,
  draggable,
}: {
  card: IdeaCard;
  board: IdeaBoard;
  tone: Tone;
  now: number;
  draggable: boolean;
}) {
  const labels = card.labelIds
    .map((id) => board.labels.find((label) => label.id === id))
    .filter((label) => !!label);
  const done = card.tasks.filter((task) => task.done).length;
  const description = preview(card.description);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  // A labelled idea takes its first label's color, like a priority.
  const tint: Tone = labels[0]?.color ?? tone;
  return (
    <button
      data-idea={card.id}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/x-irgatos-idea", card.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => openSheet({ name: "idea", id: card.id })}
      className={`${TONE[tint]} tinted web-press flex w-full flex-col gap-2 rounded-[24px] p-4 text-left`}
    >
      {labels.length ? (
        <span className="flex flex-wrap gap-1.5">
          {labels.map((label) => (
            <Pill key={label.id} tone={label.color}>
              {label.name}
            </Pill>
          ))}
        </span>
      ) : null}
      <span className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-(--ink)">
        {card.title}
      </span>
      {description ? (
        <span className="-mt-1 line-clamp-2 text-[13.5px] leading-snug text-(--ink-2)">
          {description}
        </span>
      ) : null}
      {card.tasks.length ? (
        <span className="mt-1 flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-(--ink-2)">
            Progress
          </span>
          <span className="flex items-center gap-2.5">
            <Ticks
              value={done / card.tasks.length}
              tone={tint}
              className="flex-1"
            />
            <span className="shrink-0 rounded-full bg-white/85 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-(--ink-2)">
              {Math.round((done / card.tasks.length) * 100)}%
            </span>
          </span>
        </span>
      ) : null}
      {card.dueAt || card.project ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] font-medium text-(--ink-2)">
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
