import { useRef, useState, type ReactNode } from "react";
import { suppressTextSelection } from "../../../shared/lib/drag";
import { resizeSidePanes, type SidePanes } from "../model/sidePanes";

export type SidePaneEntry = { id: string; node: ReactNode };

/**
 * The Irgat or Chat view's own chat on the left and the chats opened beside
 * it on the right, split by edges that drag to resize.
 */
export function SidePaneRow({
  main,
  panes,
  layout,
  onResize,
  onFocusMain,
  onFocusPane,
}: {
  main: ReactNode;
  panes: readonly SidePaneEntry[];
  layout: SidePanes;
  onResize: (layout: SidePanes) => void;
  onFocusMain: () => void;
  onFocusPane: (id: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // Sizes follow the pointer while an edge is dragged and are saved on release.
  const [preview, setPreview] = useState<SidePanes | null>(null);
  const shown = preview ?? layout;
  const sizes = shown.sizes;

  const startDrag = (index: number, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const row = rowRef.current;
    if (!row) return;
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const rect = row.getBoundingClientRect();
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    let next: SidePanes | null = null;
    const move = (ev: PointerEvent) => {
      if (rect.width <= 0) return;
      next = resizeSidePanes(layout, index, (ev.clientX - rect.left) / rect.width);
      setPreview(next);
    };
    const finish = (commit: boolean) => {
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      setPreview(null);
      if (commit && next) onResize(next);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  };

  return (
    <div
      ref={rowRef}
      data-side-pane-row
      className="flex h-full min-h-0 min-w-0 flex-1 flex-row"
    >
      <div
        data-side-pane-main
        className="relative flex min-h-0 min-w-0 flex-col"
        style={{ flex: `${sizes[0]} 1 0%` }}
        onPointerDownCapture={onFocusMain}
      >
        {main}
      </div>
      {panes.map((pane, index) => (
        <div key={pane.id} className="contents">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
            className="relative z-10 w-px shrink-0 bg-stroke"
          >
            <div
              className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize touch-none"
              onPointerDown={(event) => startDrag(index, event)}
            />
          </div>
          <div
            data-side-pane={pane.id}
            className="relative flex min-h-0 min-w-0 flex-col"
            style={{ flex: `${sizes[index + 1] ?? 1} 1 0%` }}
            onPointerDownCapture={() => onFocusPane(pane.id)}
          >
            {pane.node}
          </div>
        </div>
      ))}
    </div>
  );
}
