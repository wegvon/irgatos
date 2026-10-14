import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { notePreview } from "../../notes/notes";
import type { KanbanCard } from "../model/kanban";
import { formatCardTime } from "./cardTime";

const LABEL_TONES = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-lime-500",
] as const;

/** Stable dot colour per label, so the same label reads the same everywhere. */
export function labelTone(label: string): string {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return LABEL_TONES[hash % LABEL_TONES.length]!;
}

export function CardLabels({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex h-4.5 max-w-32 items-center gap-1 rounded bg-content/8 px-1.5 text-[10.5px] text-content/70"
        >
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${labelTone(label)}`} />
          <span className="truncate">{label}</span>
        </span>
      ))}
    </span>
  );
}

type Props = {
  card: KanbanCard;
  /** Roving tab stop: only one card in the board is tabbable. */
  tabbable?: boolean;
  lifted?: boolean;
  highlighted?: boolean;
  /** Its session is waiting on the user. */
  attention?: boolean;
  overlay?: boolean;
  hintId?: string;
  style?: CSSProperties;
  accessory?: ReactNode;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
};

export function KanbanCardItem({
  card,
  tabbable = false,
  lifted = false,
  highlighted = false,
  attention = false,
  overlay = false,
  hintId,
  style,
  accessory,
  onPointerDown,
  onClick,
  onKeyDown,
  onFocus,
}: Props) {
  const preview = card.notes
    ? notePreview(card.notes, card.title).replace(/\[[ xX]\]\s*/g, "")
    : "";
  const label = card.labels.length
    ? `${card.title}. Labels: ${card.labels.join(", ")}`
    : card.title;
  return (
    <div
      data-kanban-card={overlay ? undefined : card.id}
      data-kanban-highlighted={highlighted || undefined}
      data-kanban-attention={attention || undefined}
      role={overlay ? undefined : "button"}
      tabIndex={overlay ? undefined : tabbable ? 0 : -1}
      aria-roledescription={overlay ? undefined : "card"}
      aria-label={overlay ? undefined : label}
      aria-describedby={overlay ? undefined : hintId}
      aria-hidden={overlay || undefined}
      style={style}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={`group/card relative flex w-full shrink-0 cursor-grab select-none flex-col gap-1.5 rounded-lg border bg-background-base px-2.5 py-2 text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent ${
        overlay
          ? "cursor-grabbing border-content/25 shadow-xl shadow-black/30"
          : lifted
            ? "border-accent shadow-lg shadow-black/20 ring-2 ring-accent/60"
            : highlighted
              ? "border-accent/70 ring-2 ring-accent/40"
              : attention
                ? "border-amber-400/50 shadow-sm shadow-amber-500/10 hover:border-amber-400/70"
                : "border-content/10 shadow-sm shadow-black/5 hover:border-content/20"
      }`}
    >
      <span className="line-clamp-3 break-words text-[13px] leading-snug text-content">
        {card.title}
      </span>
      {preview ? (
        <span className="line-clamp-2 break-words text-[11.5px] leading-snug text-content/45">
          {preview}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <CardLabels labels={card.labels} />
        {accessory}
        <span
          className="ml-auto shrink-0 text-[10.5px] text-content/35"
          title={`Updated ${new Date(card.updatedAt).toLocaleString()}`}
        >
          {formatCardTime(card.updatedAt)}
        </span>
      </span>
    </div>
  );
}
