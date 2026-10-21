import type { ReactNode } from "react";
import { formatInteger } from "../../shared/lib/numbers";
import type { IconComponent } from "../../shared/ui/icons";

type Props = {
  label: string;
  icon: IconComponent;
  onClick?: () => void;
  onOpenContextMenu?: (x: number, y: number) => void;
  active?: boolean;
  badge?: number;
  dot?: boolean;
  shortcut?: string;
  ariaLabel?: string;
  /** Quiet trailing detail, e.g. the app version beside Settings. */
  meta?: ReactNode;
};

export function RailAction({
  label,
  icon: Icon,
  onClick,
  onOpenContextMenu,
  active = false,
  badge,
  dot = false,
  shortcut,
  ariaLabel,
  meta,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={
        onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
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
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(rect.left, rect.bottom);
            }
          : undefined
      }
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      className={`relative flex w-full items-center gap-2 rounded-md px-2 h-8  text-left ${
        active
          ? "bg-selection text-content"
          : "text-content/50 hover:bg-content/10 hover:text-content"
      } disabled:cursor-default disabled:opacity-40`}
    >
      {badge != null ? (
        <span
          aria-hidden
          className="absolute left-1 top-1/2 grid min-w-4 -translate-y-1/2 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-on-accent tabular-nums"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <Icon
        className={`size-4 shrink-0 opacity-70 ${badge != null ? "ml-4" : ""}`}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {label}
      </span>
      {meta}
      {dot ? (
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
      ) : shortcut ? (
        <span aria-hidden className="shrink-0 text-[11px] text-content/40">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

/** Live count of sessions waiting on the user; renders nothing at zero. */
export function FleetNeedsYouCount({
  count,
  className = "",
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      data-fleet-needs-you={count}
      className={`grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-black tabular-nums ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export type ChatIndicator = {
  count: number;
  tone: "attention" | "unread" | "none";
};

export function chatLabel(indicator: ChatIndicator | undefined): string {
  if (!indicator || indicator.tone === "none" || indicator.count <= 0)
    return "Chat";
  const count = formatInteger(indicator.count);
  if (indicator.tone === "attention")
    return `Chat, ${count} ${indicator.count === 1 ? "chat needs" : "chats need"} you`;
  return `Chat, ${count} new ${indicator.count === 1 ? "reply" : "replies"}`;
}

/** Chats waiting on the user (amber) or holding unread replies (accent). */
export function ChatCount({
  indicator,
  className = "",
}: {
  indicator: ChatIndicator | undefined;
  className?: string;
}) {
  if (!indicator || indicator.tone === "none" || indicator.count <= 0)
    return null;
  const tone =
    indicator.tone === "attention"
      ? "bg-amber-500 text-black"
      : "bg-accent text-on-accent";
  return (
    <span
      aria-hidden
      data-chat-count={indicator.count}
      data-chat-tone={indicator.tone}
      className={`grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums ${tone} ${className}`}
    >
      {indicator.count > 99 ? "99+" : indicator.count}
    </span>
  );
}

export function artifactsLabel(count: number): string {
  return count ? `Artifacts, ${formatInteger(count)}` : "Artifacts";
}

/** The project's artifact count beside the Artifacts menu item; nothing at zero. */
export function ArtifactCount({
  count,
  className = "",
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      data-artifact-count={count}
      className={`grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium leading-none text-on-accent tabular-nums ${className}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function RailSearch({
  label,
  icon: Icon,
  onClick,
  active = false,
  shortcut,
  ariaLabel,
}: {
  label: string;
  icon: IconComponent;
  onClick?: () => void;
  active?: boolean;
  shortcut?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      className={`relative flex w-full items-center gap-2 rounded-md border border-content/8 px-1.5 shadow-sm h-8 text-left ${
        active
          ? "bg-selection text-content"
          : "text-content/50 hover:bg-content/10 hover:text-content"
      } disabled:cursor-default disabled:opacity-40`}
    >
      <Icon className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {label}
      </span>
      {shortcut ? (
        <span aria-hidden className="shrink-0 text-[11px] text-content/40">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
