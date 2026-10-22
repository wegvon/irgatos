import type { ReactNode } from "react";
import type { WebBoardProject } from "../../model/protocol";
import { Search, X } from "../../../../shared/ui/icons";

/** Remembers a choice like the last project, where the browser allows it. */
export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The frame of the Feed, Notes, Board and Artifacts screens, as Ideas has it:
 * the page's own header row, a large title with an action beside it, then
 * the screen's controls and its scrolling body.
 */
export function ScreenFrame({
  header,
  title,
  action,
  wide,
  controls,
  children,
}: {
  header?: ReactNode;
  title: ReactNode;
  action?: ReactNode;
  wide: boolean;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <header
        className={`flex shrink-0 flex-col gap-3.5 ${wide ? "px-8 pt-[calc(var(--safe-top)+22px)]" : "px-4 pt-[calc(var(--safe-top)+10px)]"}`}
      >
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <div className="flex items-end justify-between gap-3">
          <h1 className="min-w-0 truncate text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
            {title}
          </h1>
          {action ? <div className="mb-1 flex shrink-0 gap-2">{action}</div> : null}
        </div>
        {controls}
      </header>
      <div
        className={`web-scroll min-h-0 flex-1 ${wide ? "px-8 pb-8 pt-4" : "px-4 pb-[calc(var(--safe-bottom)+24px)] pt-3"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** One of the user's projects, for the Board and Artifacts. */
export function ProjectSelect({
  projects,
  value,
  onChange,
}: {
  projects: WebBoardProject[];
  value: string;
  onChange: (path: string) => void;
}) {
  if (projects.length < 2) return null;
  return (
    <select
      aria-label="Project"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="glass web-field h-9 max-w-[46vw] rounded-full px-3 text-[14px] font-semibold text-(--ink) outline-none"
    >
      {projects.map((project) => (
        <option key={project.path} value={project.path}>
          {project.label}
        </option>
      ))}
    </select>
  );
}

/** A filter that scrolls sideways; the drawer's swipe leaves it alone. */
export function ChipStrip({ children }: { children: ReactNode }) {
  return (
    <div
      data-scroll-x
      className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
    >
      {children}
    </div>
  );
}

export function FilterChip({
  on,
  count,
  onClick,
  children,
}: {
  on: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`web-press flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-medium ${
        on
          ? "bg-(--ink) text-(--color-background-base)"
          : "bg-content/6 text-(--ink-2)"
      }`}
    >
      {children}
      {count ? <span className="tabular-nums opacity-70">{count}</span> : null}
    </button>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-11 items-center gap-2.5 rounded-[14px] bg-content/6 px-3.5 text-(--ink-3) focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]">
      <Search className="size-[18px] shrink-0" />
      <input
        className="web-field min-w-0 flex-1 bg-transparent text-(--ink) outline-none"
        placeholder={placeholder}
        value={value}
        type="search"
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          aria-label="Clear search"
          className="flex size-6 items-center justify-center rounded-full bg-(--ink-3) text-(--color-background-base)"
          onClick={() => onChange("")}
        >
          <X className="size-3.5" strokeWidth={2.5} />
        </button>
      ) : null}
    </label>
  );
}

/** A small round action next to a screen's title. */
export function TitleButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="glass web-press flex size-9 items-center justify-center rounded-full text-(--ink-2) disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export const fieldClass =
  "web-field w-full rounded-[14px] bg-content/6 px-3.5 py-3 text-(--ink) outline-none shadow-[inset_0_0_0_1px_var(--hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--accent)]";

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 px-1 text-[13px] font-semibold text-(--ink-2)">
      {children}
    </div>
  );
}

/** "a, #b c" → ["a", "b", "c"]: tags as people type them on a phone. */
export function splitTags(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#+/, "").trim())
    .filter(Boolean);
}
