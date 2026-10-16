import { useLayoutEffect, useRef } from "react";

/**
 * Adopts a dock rendered elsewhere (through a portal into `host`) while this
 * slot is mounted. The dock itself never remounts, so its shells live on
 * while the view holding the slot comes and goes.
 */
export function DockHostSlot({
  host,
  height,
  className = "min-h-0 min-w-0 shrink-0",
}: {
  host: HTMLElement;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    if (!slot) return;
    slot.appendChild(host);
    return () => {
      if (host.parentNode === slot) slot.removeChild(host);
    };
  }, [host]);
  return (
    <div
      ref={ref}
      className={className}
      style={height === undefined ? undefined : { height }}
    />
  );
}
