import type { ReactNode } from "react";
import type { IconComponent } from "../../shared/ui/icons";
import { FleetNeedsYouCount } from "./RailAction";

/** A square icon button for the narrow rails; the label shows as its tooltip. */
export function CompactRailAction({
  label,
  icon: Icon,
  tab = false,
  active = false,
  dot = false,
  count = 0,
  badge,
  onClick,
  onOpenContextMenu,
}: {
  label: string;
  icon: IconComponent;
  tab?: boolean;
  active?: boolean;
  dot?: boolean;
  count?: number;
  /** Replaces the Fleet-style count with a custom corner badge. */
  badge?: ReactNode;
  onClick?: () => void;
  onOpenContextMenu?: (x: number, y: number) => void;
}) {
  return (
    <button
      type="button"
      role={tab ? "tab" : undefined}
      title={label}
      aria-label={label}
      aria-selected={tab ? active : undefined}
      aria-pressed={tab ? undefined : active}
      disabled={!onClick}
      onClick={onClick}
      onContextMenu={
        onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              onOpenContextMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      onKeyDown={
        onOpenContextMenu
          ? (event) => {
              if (
                event.key !== "ContextMenu" &&
                !(event.shiftKey && event.key === "F10")
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(rect.right, rect.top);
            }
          : undefined
      }
      className={`relative grid size-8 shrink-0 place-items-center rounded-md active:scale-[0.97] ${
        active
          ? "bg-selection text-content"
          : "text-content/50 hover:bg-content/10 hover:text-content"
      } disabled:cursor-default disabled:opacity-35`}
    >
      <Icon
        className={`size-4 ${dot ? "compact-rail-icon-with-dot" : ""}`}
        strokeWidth={1.75}
      />
      {dot ? (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent"
        />
      ) : null}
      {badge ?? (
        <FleetNeedsYouCount
          count={count}
          className="absolute -right-0.5 -top-0.5 h-3.5 min-w-3.5 px-0.5 text-[9px]"
        />
      )}
    </button>
  );
}
