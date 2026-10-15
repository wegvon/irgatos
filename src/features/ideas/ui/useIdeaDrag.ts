import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { setGrabbing, suppressTextSelection } from "../../../shared/lib/drag";
import { dropIndexAt, dropListAt } from "../model/ideas";

const THRESHOLD = 5;
const EDGE = 48;
const MAX_SCROLL_STEP = 18;

export type IdeaDropSlot = {
  listId: string;
  /** Slot among the list's shown cards, not counting the dragged one. */
  index: number;
};

export type IdeaDrag = {
  cardId: string;
  slot: IdeaDropSlot;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
};

/**
 * Pointer-driven card dragging. The webview's native drag and drop is taken
 * by file drops, so cards follow the pointer instead. Lists are found by
 * `[data-idea-list]`, cards by `[data-idea-card]`, inside the board element.
 */
export function useIdeaDrag({
  boardRef,
  onDrop,
}: {
  boardRef: { current: HTMLElement | null };
  onDrop: (cardId: string, slot: IdeaDropSlot) => void;
}) {
  const [drag, setDrag] = useState<IdeaDrag | null>(null);
  const dragRef = useRef<IdeaDrag | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const suppressClickUntil = useRef(0);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const slotAt = useCallback(
    (cardId: string, x: number, y: number): IdeaDropSlot | null => {
      const board = boardRef.current;
      if (!board) return null;
      const lists = [...board.querySelectorAll<HTMLElement>("[data-idea-list]")];
      const listId = dropListAt(
        lists.map((element) => {
          const rect = element.getBoundingClientRect();
          return { id: element.dataset.ideaList ?? "", left: rect.left, right: rect.right };
        }),
        x,
      );
      const list = lists.find((element) => element.dataset.ideaList === listId);
      if (!listId || !list) return null;
      const midpoints = [...list.querySelectorAll<HTMLElement>("[data-idea-card]")]
        .filter((element) => element.dataset.ideaCard !== cardId)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
      return { listId, index: dropIndexAt(midpoints, y) };
    },
    [boardRef],
  );

  const onCardPointerDown = useCallback(
    (cardId: string, origin: IdeaDropSlot, event: ReactPointerEvent) => {
      if (event.button !== 0 || dragRef.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-no-drag], input, textarea, button")) return;
      const element = event.currentTarget as HTMLElement;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let restoreSelection: (() => void) | null = null;
      let frame = 0;
      let pointer = { x: startX, y: startY };

      const update = (next: IdeaDrag | null) => {
        dragRef.current = next;
        setDrag(next);
      };

      const autoScroll = () => {
        frame = 0;
        const current = dragRef.current;
        const board = boardRef.current;
        if (!current || !board) return;
        let moved = false;
        const scroller = board.querySelector<HTMLElement>("[data-idea-scroller]");
        if (scroller) {
          const rect = scroller.getBoundingClientRect();
          const step = edgeStep(pointer.x, rect.left, rect.right);
          if (step) {
            scroller.scrollLeft += step;
            moved = true;
          }
        }
        const body = (document.elementsFromPoint?.(pointer.x, pointer.y) ?? []).find(
          (el): el is HTMLElement =>
            el instanceof HTMLElement && el.dataset.ideaListBody != null,
        );
        if (body) {
          const rect = body.getBoundingClientRect();
          const step = edgeStep(pointer.y, rect.top, rect.bottom);
          if (step) {
            body.scrollTop += step;
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
        if (ev.pointerId !== pointerId) return;
        pointer = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
          active = true;
          setGrabbing(true);
          restoreSelection = suppressTextSelection();
          const rect = element.getBoundingClientRect();
          update({
            cardId,
            slot: origin,
            x: ev.clientX,
            y: ev.clientY,
            offsetX: startX - rect.left,
            offsetY: startY - rect.top,
            width: rect.width,
          });
        }
        const current = dragRef.current;
        if (!current) return;
        const slot = slotAt(cardId, ev.clientX, ev.clientY) ?? current.slot;
        update({ ...current, x: ev.clientX, y: ev.clientY, slot });
        if (!frame) frame = requestAnimationFrame(autoScroll);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) stop(true);
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

  /** True right after a drag, so the click that ends it does not open the card. */
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
