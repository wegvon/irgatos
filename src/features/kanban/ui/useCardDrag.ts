import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { setGrabbing, suppressTextSelection } from "../../../shared/lib/drag";
import { dropColumnAt, dropIndexAt } from "../model/boardOps";

const THRESHOLD = 5;
const EDGE = 48;
const MAX_SCROLL_STEP = 18;

export type CardDragSlot = {
  columnId: string;
  /** Slot among the column's shown cards, not counting the dragged one. */
  slot: number;
};

export type CardDrag = {
  cardId: string;
  slot: CardDragSlot;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type Pending = {
  cardId: string;
  pointerId: number;
  startX: number;
  startY: number;
  origin: CardDragSlot;
  element: HTMLElement;
};

/**
 * Pointer-driven card dragging across columns. Columns are found through
 * `[data-kanban-column]` and cards through `[data-kanban-card]` inside the
 * board element, so the hook reads live layout instead of tracking refs.
 */
export function useCardDrag({
  boardRef,
  onDrop,
}: {
  boardRef: { current: HTMLElement | null };
  onDrop: (cardId: string, slot: CardDragSlot) => void;
}) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const dragRef = useRef<CardDrag | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const suppressClickUntil = useRef(0);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const slotAt = useCallback(
    (cardId: string, x: number, y: number): CardDragSlot | null => {
      const board = boardRef.current;
      if (!board) return null;
      const columns = [
        ...board.querySelectorAll<HTMLElement>("[data-kanban-column]"),
      ];
      const columnId = dropColumnAt(
        columns.map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            id: element.dataset.kanbanColumn ?? "",
            left: rect.left,
            right: rect.right,
          };
        }),
        x,
      );
      const column = columns.find(
        (element) => element.dataset.kanbanColumn === columnId,
      );
      if (!columnId || !column) return null;
      const midpoints = [
        ...column.querySelectorAll<HTMLElement>("[data-kanban-card]"),
      ]
        .filter((element) => element.dataset.kanbanCard !== cardId)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
      return { columnId, slot: dropIndexAt(midpoints, y) };
    },
    [boardRef],
  );

  const onCardPointerDown = useCallback(
    (cardId: string, origin: CardDragSlot, event: ReactPointerEvent) => {
      if (event.button !== 0 || dragRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-no-drag], input, textarea, button")) return;
      const element = event.currentTarget as HTMLElement;
      const pending: Pending = {
        cardId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin,
        element,
      };
      let active = false;
      let restoreSelection: (() => void) | null = null;
      let frame = 0;
      let pointer = { x: event.clientX, y: event.clientY };

      const update = (next: CardDrag | null) => {
        dragRef.current = next;
        setDrag(next);
      };

      const autoScroll = () => {
        frame = 0;
        const current = dragRef.current;
        const board = boardRef.current;
        if (!current || !board) return;
        const scroller = board.querySelector<HTMLElement>("[data-kanban-scroller]");
        let moved = false;
        if (scroller) {
          const rect = scroller.getBoundingClientRect();
          const step = edgeStep(pointer.x, rect.left, rect.right);
          if (step) {
            scroller.scrollLeft += step;
            moved = true;
          }
        }
        const list = (document.elementsFromPoint?.(pointer.x, pointer.y) ?? []).find(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element.dataset.kanbanList != null,
        );
        if (list) {
          const rect = list.getBoundingClientRect();
          const step = edgeStep(pointer.y, rect.top, rect.bottom);
          if (step) {
            list.scrollTop += step;
            moved = true;
          }
        }
        if (moved) {
          const slot = slotAt(current.cardId, pointer.x, pointer.y);
          if (slot) update({ ...current, slot });
          frame = requestAnimationFrame(autoScroll);
        }
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pending.pointerId) return;
        pointer = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          if (
            Math.hypot(ev.clientX - pending.startX, ev.clientY - pending.startY) <
            THRESHOLD
          ) {
            return;
          }
          active = true;
          setGrabbing(true);
          restoreSelection = suppressTextSelection();
          const rect = pending.element.getBoundingClientRect();
          update({
            cardId,
            slot: pending.origin,
            x: ev.clientX,
            y: ev.clientY,
            offsetX: pending.startX - rect.left,
            offsetY: pending.startY - rect.top,
            width: rect.width,
            height: rect.height,
          });
        }
        const current = dragRef.current;
        if (!current) return;
        const slot = slotAt(cardId, ev.clientX, ev.clientY) ?? current.slot;
        update({ ...current, x: ev.clientX, y: ev.clientY, slot });
        if (!frame) frame = requestAnimationFrame(autoScroll);
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pending.pointerId) return;
        stop(true);
      };
      const onCancel = () => stop(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape" || !active) return;
        ev.preventDefault();
        ev.stopPropagation();
        stop(false);
      };

      function stop(commit: boolean) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        cleanup.current = null;
        if (frame) cancelAnimationFrame(frame);
        const current = dragRef.current;
        update(null);
        if (!active) return;
        setGrabbing(false);
        restoreSelection?.();
        suppressClickUntil.current = performance.now() + 300;
        if (commit && current) onDropRef.current(current.cardId, current.slot);
      }

      cleanup.current = () => stop(false);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
    },
    [boardRef, slotAt],
  );

  const consumeClick = useCallback(
    () => performance.now() < suppressClickUntil.current,
    [],
  );

  return { drag, onCardPointerDown, consumeClick };
}

function edgeStep(position: number, start: number, end: number): number {
  if (position < start + EDGE) {
    return -Math.ceil(((start + EDGE - position) / EDGE) * MAX_SCROLL_STEP);
  }
  if (position > end - EDGE) {
    return Math.ceil(((position - (end - EDGE)) / EDGE) * MAX_SCROLL_STEP);
  }
  return 0;
}
