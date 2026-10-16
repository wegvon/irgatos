import { useRef, useState, type ReactNode } from "react";

const EDGE = 28;
const CLOSE_AT = 90;

/**
 * A Home Screen web app has no back swipe of its own, so a chat opened from
 * the list closes with the same edge swipe as any iOS screen. In Safari
 * proper the browser's own swipe does this, so it stays off there.
 */
export function SwipeBack({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (!standalone)
    return (
      <div className="web-push-in absolute inset-0 z-20 bg-background-base">
        {children}
      </div>
    );

  return (
    <div
      className="web-push-in absolute inset-0 z-20 bg-background-base shadow-[-12px_0_30px_rgb(0_0_0/0.35)]"
      style={
        dx
          ? { transform: `translateX(${dx}px)` }
          : { transition: "transform 220ms var(--motion-ease-out)" }
      }
      onTouchStart={(event) => {
        const touch = event.touches[0];
        start.current =
          touch && touch.clientX < EDGE
            ? { x: touch.clientX, y: touch.clientY, on: false }
            : null;
      }}
      onTouchMove={(event) => {
        const touch = event.touches[0];
        const from = start.current;
        if (!touch || !from) return;
        const moved = touch.clientX - from.x;
        if (!from.on) {
          // Decide once: a mostly vertical drag is a scroll, not a swipe.
          if (Math.abs(touch.clientY - from.y) > Math.abs(moved)) {
            start.current = null;
            return;
          }
          if (moved < 8) return;
          from.on = true;
        }
        setDx(Math.max(0, moved));
      }}
      onTouchEnd={() => {
        const swiped = start.current?.on && dx > CLOSE_AT;
        start.current = null;
        setDx(0);
        if (swiped) onBack();
      }}
    >
      {children}
    </div>
  );
}
