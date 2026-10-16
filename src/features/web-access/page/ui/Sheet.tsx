import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent,
} from "react";
import { X } from "../../../../shared/ui/icons";

/**
 * A bottom sheet on the phone (drag the top down to close) and a centered
 * card on the iPad. The screen underneath stays as it was.
 */
export function Sheet({
  title,
  wide,
  onClose,
  children,
}: {
  title: string;
  wide: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grab = wide
    ? {}
    : {
        onTouchStart: (event: TouchEvent) => {
          start.current = event.touches[0]?.clientY ?? null;
        },
        onTouchMove: (event: TouchEvent) => {
          if (start.current === null) return;
          setDrag(
            Math.max(0, (event.touches[0]?.clientY ?? 0) - start.current),
          );
        },
        onTouchEnd: () => {
          start.current = null;
          if (drag > 110) onClose();
          else setDrag(0);
        },
      };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="web-fade-in absolute inset-0 bg-[rgb(40_30_80/0.28)] backdrop-blur-[2px]"
        style={drag ? { opacity: Math.max(0.2, 1 - drag / 400) } : undefined}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={
          drag
            ? { transform: `translateY(${drag}px)` }
            : { transition: "transform 200ms var(--motion-ease-out)" }
        }
        className={`flex flex-col overflow-hidden bg-[linear-gradient(180deg,#faf8ff_0%,#f3effc_100%)] shadow-[inset_0_0_0_1px_white,0_30px_80px_-20px_rgb(50_30_120/0.45)] ${
          wide
            ? "web-pop-in absolute left-1/2 top-1/2 max-h-[min(86%,920px)] w-[min(620px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 rounded-[32px]"
            : "web-sheet-up absolute inset-x-0 bottom-0 max-h-[calc(var(--app-height,100dvh)-var(--safe-top)-8px)] rounded-t-[32px]"
        }`}
      >
        <div {...grab} className="shrink-0 touch-none">
          {wide ? null : (
            <div className="mx-auto mt-2 h-[5px] w-10 rounded-full bg-(--ink-3)/50" />
          )}
          <div className="flex h-16 items-center gap-2 px-5">
            <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-[-0.02em] text-(--ink)">
              {title}
            </h2>
            <button
              aria-label="Close"
              onClick={onClose}
              className="glass web-press flex size-9 shrink-0 items-center justify-center rounded-full text-(--ink-2)"
            >
              <X className="size-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>
        <div className="web-scroll min-h-0 flex-1 pb-(--safe-bottom)">
          {children}
        </div>
      </div>
    </div>
  );
}
