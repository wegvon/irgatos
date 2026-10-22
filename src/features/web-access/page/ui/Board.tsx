import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WebBoard, WebBoardCard } from "../../model/protocol";
import { read, usePoll, write } from "../client";
import { ago } from "../format";
import { navigate } from "../route";
import { Sheet } from "./Sheet";
import {
  Empty,
  Pill,
  Spinner,
  plainButton,
  primaryButton,
  secondaryButton,
  useAction,
} from "./parts";
import {
  FieldLabel,
  ProjectSelect,
  ScreenFrame,
  errorText,
  fieldClass,
  splitTags,
  store,
  stored,
} from "./WorkspaceParts";
import {
  Kanban,
  MessageSquare,
  Plus,
  Trash2,
} from "../../../../shared/ui/icons";

const PROJECT_KEY = "irgatos.web.board.project";

/** Moves a card in the board the page shows, before the Mac confirms it. */
function withMoved(
  board: WebBoard,
  id: string,
  columnId: string,
  index: number,
): WebBoard {
  let card: WebBoardCard | undefined;
  const columns = board.columns.map((column) => {
    const found = column.cards.find((entry) => entry.id === id);
    if (found) card = found;
    return { ...column, cards: column.cards.filter((entry) => entry.id !== id) };
  });
  if (!card) return board;
  return {
    ...board,
    columns: columns.map((column) =>
      column.id === columnId
        ? {
            ...column,
            cards: [
              ...column.cards.slice(0, index),
              card!,
              ...column.cards.slice(index),
            ],
          }
        : column,
    ),
  };
}

/**
 * A project's Board, as on the Mac: columns of cards, each with the state of
 * the chat that works on it. On the phone each column is a page to swipe.
 */
export function Board({
  now,
  wide,
  header,
}: {
  now: number;
  wide: boolean;
  header?: ReactNode;
}) {
  const [project, setProjectState] = useState(() => stored(PROJECT_KEY));
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const pages = useRef<HTMLDivElement>(null);
  const board = usePoll(
    `board:${project ?? ""}`,
    () => read<WebBoard>("board", project ? { project } : {}),
    () => 8000,
  );
  const data = board.data;
  // A project that is no longer recent falls back to the first one.
  const lost = !!board.error && !!project && !data;
  useEffect(() => {
    if (!lost) return;
    store(PROJECT_KEY, null);
    setProjectState(null);
  }, [lost]);
  const setProject = (path: string) => {
    store(PROJECT_KEY, path);
    setProjectState(path);
    setPage(0);
    pages.current?.scrollTo({ left: 0 });
  };
  const columns = data?.columns ?? [];
  const column = columns[Math.min(page, columns.length - 1)];
  const showPage = (index: number) => {
    const element = pages.current;
    if (element)
      element.scrollTo({ left: index * element.clientWidth, behavior: "smooth" });
  };
  const card = open
    ? columns.flatMap((entry) => entry.cards).find((entry) => entry.id === open)
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <ScreenFrame
        header={header}
        wide={wide}
        title={data && data.projects.length > 1 ? data.label : "Board"}
        action={
          data ? (
            <ProjectSelect
              projects={data.projects}
              value={data.project}
              onChange={setProject}
            />
          ) : null
        }
        controls={
          data && column ? (
            <>
              <Capture
                key={`${data.project}:${column.id}`}
                project={data.project}
                columnId={column.id}
                columnTitle={column.title}
                onAdded={board.reload}
              />
              <div className={`glass -mx-1 flex gap-1 overflow-x-auto rounded-full p-1.5 [scrollbar-width:none] ${wide ? "hidden" : ""}`}>
                {columns.map((entry, index) => (
                  <button
                    key={entry.id}
                    onClick={() => showPage(index)}
                    aria-pressed={index === page}
                    className={`web-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold ${
                      index === page ? "bg-selection text-(--ink)" : "text-(--ink-2)"
                    }`}
                  >
                    {entry.title}
                    <span className="font-medium tabular-nums text-(--ink-3)">
                      {entry.cards.length}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null
        }
      >
        {!data ? (
          board.error ? (
            <Empty title="Can't load the Board">{board.error.message}</Empty>
          ) : (
            <div className="flex justify-center py-16 text-(--ink-3)">
              <Spinner className="size-6" />
            </div>
          )
        ) : (
          <div
            ref={pages}
            onScroll={(event) => {
              const element = event.currentTarget;
              setPage(Math.round(element.scrollLeft / element.clientWidth));
            }}
            data-scroll-x
            className={`web-kanban flex h-full overflow-x-auto ${wide ? "gap-4" : "-mx-4 snap-x snap-mandatory"}`}
          >
            {columns.map((entry) => (
              <section
                key={entry.id}
                className={`flex shrink-0 flex-col gap-2.5 overflow-y-auto ${
                  wide
                    ? "w-[310px] rounded-[28px] bg-content/6 p-2.5 shadow-[inset_0_0_0_1px_var(--card-edge)]"
                    : "w-full snap-start px-4 pb-6"
                }`}
              >
                {wide ? (
                  <h2 className="px-1.5 pt-1.5 text-[16px] font-semibold text-(--ink)">
                    {entry.title}
                  </h2>
                ) : null}
                {entry.cards.map((item) => (
                  <CardView key={item.id} card={item} now={now} onOpen={() => setOpen(item.id)} />
                ))}
                {entry.cards.length === 0 ? (
                  <div className="rounded-[22px] border-[1.5px] border-dashed border-(--card-edge) bg-content/6 px-4 py-9 text-center text-[14px] font-medium text-(--ink-3)">
                    Nothing in {entry.title} yet
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </ScreenFrame>
      {open && data ? (
        <Sheet title="Card" wide={wide} onClose={() => setOpen(null)}>
          {card ? (
            <CardDetail
              key={card.id}
              board={data}
              card={card}
              onMove={(columnId) =>
                board.mutate((current) => withMoved(current, card.id, columnId, 0))
              }
              onChanged={board.reload}
              onClose={() => setOpen(null)}
            />
          ) : (
            <Empty icon={<Kanban className="size-12 text-(--ink-3)" />} title="This card is gone">
              It was moved to another board or deleted on your Mac.
            </Empty>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}

function Capture({
  project,
  columnId,
  columnTitle,
  onAdded,
}: {
  project: string;
  columnId: string;
  columnTitle: string;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const { busy, run } = useAction();
  const add = async () => {
    const title = text.trim();
    if (!title) return;
    const added = await run(
      "add",
      () => write("boardAdd", { project, columnId, text: title }),
      `Added to ${columnTitle}`,
    );
    if (added) {
      setText("");
      onAdded();
    }
  };
  return (
    <form
      className="glass flex h-[52px] items-center gap-2 rounded-full pl-4 pr-1.5 focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <Kanban className="size-[18px] shrink-0 text-(--accent)" />
      <input
        className="web-field min-w-0 flex-1 bg-transparent outline-none"
        placeholder={`Add a card to ${columnTitle}  #label`}
        value={text}
        enterKeyHint="done"
        onChange={(event) => setText(event.target.value)}
      />
      <button
        aria-label="Add card"
        disabled={!text.trim() || busy !== null}
        className="primary-action web-press flex size-10 shrink-0 items-center justify-center rounded-full"
      >
        {busy ? <Spinner /> : <Plus className="size-5" strokeWidth={2.4} />}
      </button>
    </form>
  );
}

function CardView({
  card,
  now,
  onOpen,
}: {
  card: WebBoardCard;
  now: number;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="glass web-press flex w-full flex-col gap-2 rounded-[20px] p-4 text-left"
    >
      {card.labels.length ? (
        <span className="flex flex-wrap gap-1.5">
          {card.labels.map((label) => (
            <span
              key={label}
              className="rounded-full bg-content/8 px-2 py-0.5 text-[12px] font-semibold text-(--ink-2)"
            >
              {label}
            </span>
          ))}
        </span>
      ) : null}
      <span className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-(--ink)">
        {card.title}
      </span>
      {card.notes.trim() ? (
        <span className="-mt-1 line-clamp-2 text-[13.5px] leading-snug text-(--ink-2)">
          {card.notes}
        </span>
      ) : null}
      <span className="flex items-center gap-2 text-[12.5px] text-(--ink-3)">
        {card.session ? (
          <Pill tone={card.session.tone} live={card.session.label === "Running"}>
            {card.session.label}
          </Pill>
        ) : null}
        <span className="ml-auto">{ago(card.updatedAt, now)}</span>
      </span>
    </button>
  );
}

function CardDetail({
  board,
  card,
  onMove,
  onChanged,
  onClose,
}: {
  board: WebBoard;
  card: WebBoardCard;
  onMove: (columnId: string) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [labels, setLabels] = useState(card.labels.join(" "));
  const [confirm, setConfirm] = useState(false);
  const { busy, run } = useAction();
  const [error, setError] = useState<string | null>(null);
  const project = board.project;
  const columnId = board.columns.find((column) =>
    column.cards.some((entry) => entry.id === card.id),
  )?.id;
  const changed =
    title.trim() !== card.title ||
    notes !== card.notes ||
    splitTags(labels).join(" ") !== card.labels.join(" ");

  const openChat = async () => {
    const session = card.session;
    if (!session) return;
    if (session.live) {
      onClose();
      navigate({ name: "chat", id: session.sessionId });
      return;
    }
    const opened = await run("chat", () =>
      write<{ sessionId: string }>("boardOpenChat", { project, id: card.id }),
    );
    if (opened) {
      onClose();
      navigate({ name: "chat", id: opened.sessionId });
    }
  };

  return (
    <form
      className="flex flex-col gap-5 px-5 pb-8"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        void run(
          "save",
          () =>
            write("boardUpdate", {
              project,
              id: card.id,
              title,
              notes,
              labels: splitTags(labels),
            }),
          "Saved",
        ).then((done) => {
          if (done) onChanged();
        });
      }}
    >
      <textarea
        rows={2}
        className={`${fieldClass} resize-none text-[18px] font-semibold leading-snug`}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      {card.session ? (
        <button
          type="button"
          disabled={!card.session.saved || busy !== null}
          onClick={() => void openChat()}
          className="glass web-press flex items-center gap-3 rounded-[18px] px-4 py-3 text-left disabled:opacity-50"
        >
          <MessageSquare className="size-5 shrink-0 text-(--ink-2)" />
          <span className="min-w-0 flex-1 text-[15px] font-semibold text-(--ink)">
            {card.session.saved ? "Open its chat" : "Its chat was deleted"}
          </span>
          {busy === "chat" ? (
            <Spinner />
          ) : (
            <Pill tone={card.session.tone}>{card.session.label}</Pill>
          )}
        </button>
      ) : null}
      <div>
        <FieldLabel>Column</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {board.columns.map((column) => (
            <button
              type="button"
              key={column.id}
              aria-pressed={column.id === columnId}
              onClick={() => {
                if (column.id === columnId) return;
                onMove(column.id);
                void run(
                  "move",
                  () =>
                    write("boardMove", {
                      project,
                      id: card.id,
                      columnId: column.id,
                      index: 0,
                    }),
                  `Moved to ${column.title}`,
                ).then(onChanged);
              }}
              className={`web-press h-9 rounded-full px-3.5 text-[14px] font-semibold ${
                column.id === columnId
                  ? "bg-(--ink) text-(--color-background-base)"
                  : "bg-content/6 text-(--ink-2)"
              }`}
            >
              {column.title}
            </button>
          ))}
        </div>
      </div>
      <div>
        <FieldLabel>Notes</FieldLabel>
        <textarea
          className={`${fieldClass} min-h-[140px] resize-y`}
          value={notes}
          placeholder="Add details…"
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>
      <div>
        <FieldLabel>Labels</FieldLabel>
        <input
          className={fieldClass}
          value={labels}
          placeholder="bug ui"
          autoCapitalize="none"
          onChange={(event) => setLabels(event.target.value)}
        />
      </div>
      {error ? <div className="text-[14px] text-(--bad)">{error}</div> : null}
      <button className={primaryButton} disabled={!changed || !title.trim() || busy !== null}>
        {busy === "save" ? <Spinner /> : null}
        Save
      </button>
      <button type="button" className={secondaryButton} onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        onClick={() =>
          confirm
            ? void run(
                "delete",
                () => write("boardDelete", { project, id: card.id }),
                "Card deleted",
              )
                .then((done) => {
                  if (!done) return;
                  onChanged();
                  onClose();
                })
                .catch((cause: unknown) => setError(errorText(cause)))
            : setConfirm(true)
        }
        className={`${plainButton} mt-6 self-center text-(--bad)`}
      >
        <Trash2 className="size-4" />
        {confirm ? "Tap again to delete it" : "Delete card"}
      </button>
    </form>
  );
}
