import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { MoreHorizontal, Plus } from "../../../shared/ui/icons";
import { MAX_CARD_TITLE, MAX_COLUMN_TITLE, type KanbanCard, type KanbanColumn } from "../model/kanban";
import type { CardDrag, CardDragSlot } from "./useCardDrag";
import { KanbanCardItem } from "./KanbanCardItem";

type Props = {
  /** The column as shown, which is filtered while a filter is active. */
  column: KanbanColumn;
  totalCards: number;
  filtering: boolean;
  drag: CardDrag | null;
  liftedId: string | null;
  highlightId?: string | null;
  tabbableId: string | null;
  hintId: string;
  editing: boolean;
  composing: boolean;
  columnDragging: boolean;
  dropSide: "before" | "after" | null;
  cardAccessory?: (card: KanbanCard) => ReactNode;
  onHeaderPointerDown: (event: ReactPointerEvent) => void;
  onCardPointerDown: (cardId: string, slot: CardDragSlot, event: ReactPointerEvent) => void;
  onCardOpen: (cardId: string) => void;
  onCardKeyDown: (cardId: string, event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onCardFocus: (cardId: string) => void;
  onAddCard: (text: string) => void;
  onCompose: (open: boolean) => void;
  onRename: (title: string | null) => void;
  onStartRename: () => void;
  onMenu: (anchor: HTMLElement) => void;
};

export function KanbanColumnView({
  column,
  totalCards,
  filtering,
  drag,
  liftedId,
  highlightId,
  tabbableId,
  hintId,
  editing,
  composing,
  columnDragging,
  dropSide,
  cardAccessory,
  onHeaderPointerDown,
  onCardPointerDown,
  onCardOpen,
  onCardKeyDown,
  onCardFocus,
  onAddCard,
  onCompose,
  onRename,
  onStartRename,
  onMenu,
}: Props) {
  const cards = drag ? column.cards.filter((card) => card.id !== drag.cardId) : column.cards;
  const placeholderAt = drag?.slot.columnId === column.id ? drag.slot.slot : -1;
  const countLabel = filtering ? `${column.cards.length} of ${totalCards}` : String(totalCards);

  return (
    <section
      data-kanban-column={column.id}
      aria-label={`${column.title}, ${totalCards} ${totalCards === 1 ? "card" : "cards"}`}
      className={`relative flex max-h-full w-[272px] shrink-0 flex-col rounded-xl bg-content/[0.035] transition-opacity ${
        columnDragging ? "opacity-50" : ""
      }`}
    >
      {dropSide ? (
        <span
          aria-hidden
          className={`absolute inset-y-1 w-0.5 rounded-full bg-accent ${
            dropSide === "before" ? "-left-1.5" : "-right-1.5"
          }`}
        />
      ) : null}
      <header
        onPointerDown={onHeaderPointerDown}
        className="flex h-9 shrink-0 cursor-grab items-center gap-1.5 pl-3 pr-1.5"
      >
        {editing ? (
          <ColumnTitleInput title={column.title} onDone={onRename} />
        ) : (
          <h3
            className="min-w-0 truncate text-[12.5px] font-medium text-content/85"
            title="Double-click to rename"
            onDoubleClick={onStartRename}
          >
            {column.title}
          </h3>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-content/40">{countLabel}</span>
        <span className="ml-auto flex shrink-0 items-center" data-no-drag>
          <button
            type="button"
            title={`Add card to ${column.title}`}
            aria-label={`Add card to ${column.title}`}
            onClick={() => onCompose(true)}
            className="grid size-6 place-items-center rounded-md text-content/40 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Column actions"
            aria-label={`${column.title} column actions`}
            aria-haspopup="menu"
            onClick={(event) => onMenu(event.currentTarget)}
            className="grid size-6 place-items-center rounded-md text-content/40 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
          >
            <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </header>
      <div
        data-kanban-list
        className="flex min-h-12 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-2"
      >
        {cards.map((card, index) => (
          <Fragment key={card.id}>
            {index === placeholderAt ? <DropPlaceholder height={drag!.height} /> : null}
            <KanbanCardItem
              card={card}
              tabbable={card.id === tabbableId}
              lifted={card.id === liftedId}
              highlighted={card.id === highlightId}
              hintId={hintId}
              accessory={cardAccessory?.(card)}
              onPointerDown={(event) =>
                onCardPointerDown(card.id, { columnId: column.id, slot: index }, event)
              }
              onClick={() => onCardOpen(card.id)}
              onKeyDown={(event) => onCardKeyDown(card.id, event)}
              onFocus={() => onCardFocus(card.id)}
            />
          </Fragment>
        ))}
        {placeholderAt >= cards.length ? <DropPlaceholder height={drag!.height} /> : null}
        {cards.length === 0 && placeholderAt < 0 && !composing ? (
          <p className="grid min-h-16 place-items-center rounded-lg border border-dashed border-content/10 px-3 text-center text-[11.5px] text-content/35">
            {filtering && totalCards > 0
              ? "No matching cards"
              : drag
                ? "Drop here"
                : "No cards yet"}
          </p>
        ) : null}
        {composing ? (
          <CardComposer onAdd={onAddCard} onClose={() => onCompose(false)} />
        ) : (
          <button
            type="button"
            onClick={() => onCompose(true)}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-content/40 hover:bg-content/8 hover:text-content/80 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            Add card
          </button>
        )}
      </div>
    </section>
  );
}

function DropPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      data-kanban-placeholder
      style={{ height }}
      className="shrink-0 rounded-lg border border-dashed border-accent/60 bg-accent/10"
    />
  );
}

function ColumnTitleInput({
  title,
  onDone,
}: {
  title: string;
  onDone: (title: string | null) => void;
}) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      autoFocus
      data-no-drag
      aria-label="Column name"
      value={value}
      maxLength={MAX_COLUMN_TITLE}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
      spellCheck={false}
      autoComplete="off"
      className="h-6.5 min-w-0 flex-1 rounded-md border border-accent/60 bg-background-base px-1.5 text-[12.5px] font-medium text-content outline-none"
    />
  );
}

export function CardComposer({
  onAdd,
  onClose,
}: {
  onAdd: (text: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const submit = () => {
    if (!value.trim()) {
      onClose();
      return;
    }
    onAdd(value);
    setValue("");
  };
  return (
    <div className="flex shrink-0 flex-col gap-1.5" data-no-drag>
      <textarea
        ref={ref}
        aria-label="New card title"
        value={value}
        rows={2}
        maxLength={MAX_CARD_TITLE + 64}
        placeholder="What needs doing? Add #labels at the end."
        onChange={(event) => setValue(event.target.value.replace(/\s*\n\s*/g, " "))}
        onBlur={() => {
          if (!value.trim()) onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        spellCheck={false}
        className="w-full resize-none rounded-lg border border-accent/50 bg-background-base px-2.5 py-2 text-[13px] leading-snug text-content outline-none placeholder:text-content/35"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={submit}
          className="inline-flex h-6.5 items-center rounded-md bg-content px-2.5 text-[12px] font-medium text-background-base hover:bg-content/80"
        >
          Add card
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
          className="inline-flex h-6.5 items-center rounded-md px-2 text-[12px] text-content/55 hover:bg-content/10 hover:text-content"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10.5px] text-content/30">Enter to add</span>
      </div>
    </div>
  );
}
