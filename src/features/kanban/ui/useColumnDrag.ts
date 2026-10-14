import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { setGrabbing, suppressTextSelection } from "../../../shared/lib/drag";
import { dropIndexAt } from "../model/boardOps";

const THRESHOLD = 5;

export type ColumnDrag = {
  columnId: string;
  /** Final index among the other columns. */
  slot: number;
};

/**
 * Header-driven column reordering. Columns stay put while dragging, so the
 * slot is measured against the other columns' midpoints, matching card drops.
 */
export function useColumnDrag({
  boardRef,
  onDrop,
}: {
  boardRef: { current: HTMLElement | null };
  onDrop: (columnId: string, index: number) => void;
}) {
  const [drag, setDrag] = useState<ColumnDrag | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const onHeaderPointerDown = useCallback(
    (columnId: string, event: ReactPointerEvent) => {
      if (event.button !== 0 || cleanup.current) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-no-drag], input, textarea, button")) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let active = false;
      let current: ColumnDrag | null = null;
      let restoreSelection: (() => void) | null = null;

      const slotAt = (x: number) => {
        const columns = [
          ...(boardRef.current?.querySelectorAll<HTMLElement>("[data-kanban-column]") ?? []),
        ].filter((element) => element.dataset.kanbanColumn !== columnId);
        return dropIndexAt(
          columns.map((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left + rect.width / 2;
          }),
          x,
        );
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (!active) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
          active = true;
          setGrabbing(true);
          restoreSelection = suppressTextSelection();
        }
        const slot = slotAt(ev.clientX);
        if (current?.slot === slot) return;
        current = { columnId, slot };
        setDrag(current);
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
        setDrag(null);
        if (!active) return;
        setGrabbing(false);
        restoreSelection?.();
        if (commit && current) onDropRef.current(current.columnId, current.slot);
      }

      cleanup.current = () => stop(false);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
    },
    [boardRef],
  );

  return { drag, onHeaderPointerDown };
}

/** Which side of `index` the drop line belongs on, if any. */
export function columnDropSide(
  drag: ColumnDrag | null,
  columnIds: readonly string[],
  index: number,
): "before" | "after" | null {
  if (!drag) return null;
  const from = columnIds.indexOf(drag.columnId);
  if (from < 0 || drag.slot === from) return null;
  const others = columnIds.filter((id) => id !== drag.columnId);
  const id = columnIds[index];
  if (id === drag.columnId) return null;
  const before = others[drag.slot];
  if (before) return before === id ? "before" : null;
  return others[others.length - 1] === id ? "after" : null;
}
