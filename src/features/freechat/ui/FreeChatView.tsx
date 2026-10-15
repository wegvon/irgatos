import { useEffect, useRef, useState, type ReactNode } from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import {
  ChevronRight,
  Kanban,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  Search,
} from "../../../shared/ui/icons";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import type { FreeChatRow } from "../model/freeChat";

type Props = {
  rows: readonly FreeChatRow[];
  activeId?: string;
  /** The open chat's conversation pane. */
  pane?: ReactNode;
  /** Shown under the pane, e.g. the usage footer. */
  footer?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Chats that already have a card on the board. */
  boardIds?: ReadonlySet<string>;
  shortcut: string;
  besideRail?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onShowList?: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onBoard: (id: string) => void;
};

const STATE_LABEL: Record<FreeChatRow["state"], string> = {
  "needs-input": "Needs you",
  running: "Running",
  unread: "New reply",
  idle: "",
};

export function FreeChatView({
  rows,
  activeId,
  pane,
  footer,
  loading = false,
  error = null,
  onRetry,
  boardIds,
  shortcut,
  besideRail = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
  onNewChat,
  onSelect,
  onShowList,
  onRename,
  onPin,
  onDelete,
  onBoard,
}: Props) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => row.title.toLowerCase().includes(needle))
    : rows;
  const active = rows.find((row) => row.id === activeId);
  const onBoardAlready = (id: string) => boardIds?.has(id) ?? false;
  const menuRow = menu ? rows.find((row) => row.id === menu.id) : undefined;
  const menuItems: ExplorerMenuItem[] = menuRow
    ? [
        { kind: "item", id: "rename", label: "Rename" },
        {
          kind: "item",
          id: "pin",
          label: menuRow.pinned ? "Unpin" : "Pin",
        },
        {
          kind: "item",
          id: "board",
          label: onBoardAlready(menuRow.id) ? "Show on Board" : "Add to Board",
          disabled: menuRow.blank,
        },
        { kind: "sep" },
        { kind: "item", id: "delete", label: "Delete", danger: true },
      ]
    : [];

  const onPick = (action: string) => {
    if (!menuRow) return;
    if (action === "rename") setRenaming(menuRow.id);
    else if (action === "pin") onPin(menuRow.id, !menuRow.pinned);
    else if (action === "board") onBoard(menuRow.id);
    else if (action === "delete") onDelete(menuRow.id);
    setMenu(null);
  };

  const list = (
    <nav
      aria-label="Chats"
      data-free-chat-list
      className={`min-h-0 w-full shrink-0 flex-col border-stroke md:w-64 md:border-r ${
        activeId ? "hidden md:flex" : "flex"
      }`}
    >
      <label className="relative m-2 flex h-7 min-w-0 items-center">
        <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="Filter chats"
          aria-label="Filter chats"
          spellCheck={false}
          autoComplete="off"
          className="h-7 w-full rounded-md border border-content/10 bg-transparent pl-7 pr-2 text-[12px] text-content outline-none select-text placeholder:text-content/40 focus:border-content/25"
        />
      </label>
      {error ? (
        <div className="mx-2 rounded-md bg-red-500/10 px-2.5 py-2 text-[12px] text-content/75">
          <p>{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 text-[12px] font-medium text-content underline-offset-2 hover:underline"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
      {loading && rows.length === 0 ? (
        <p className="flex items-center gap-2 px-3 py-2 text-[12px] text-content/45">
          <LoaderCircle className="size-3 animate-spin" />
          Loading chats…
        </p>
      ) : shown.length === 0 && rows.length > 0 ? (
        <p className="px-3 py-2 text-[12px] text-content/45">
          No chats match “{query.trim()}”.
        </p>
      ) : null}
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
        {shown.map((row) => (
          <li key={row.id} className="list-none">
            <ChatRow
              row={row}
              active={row.id === activeId}
              renaming={renaming === row.id}
              onSelect={() => onSelect(row.id)}
              onMenu={(x, y) => setMenu({ id: row.id, x, y })}
              onRename={(title) => {
                setRenaming(null);
                const trimmed = title.trim();
                if (trimmed && trimmed !== row.title) onRename(row.id, trimmed);
              }}
              onCancelRename={() => setRenaming(null)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div
      role="region"
      aria-label="Chat"
      data-app-chat
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        {besideRail ? null : (
          <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          {activeId && onShowList ? (
            <button
              type="button"
              onClick={onShowList}
              className="flex shrink-0 items-center gap-1 text-content/60 hover:text-content md:hidden"
              data-tauri-drag-region="false"
            >
              All chats
              <ChevronRight className="size-3 opacity-60" />
            </button>
          ) : null}
          <MessageSquare
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="shrink-0 text-content">Chat</span>
          <span className="hidden truncate text-[12px] text-content/40 sm:inline">
            {active ? active.title : "No project needed"}
          </span>
        </div>
        <div
          className="mr-2 flex shrink-0 items-center gap-1"
          data-tauri-drag-region="false"
        >
          {active && !active.blank ? (
            <button
              type="button"
              onClick={() => onBoard(active.id)}
              aria-label={
                onBoardAlready(active.id) ? "Show on Board" : "Add to Board"
              }
              title={onBoardAlready(active.id) ? "Show on Board" : "Add to Board"}
              className="grid size-7 place-items-center rounded-md text-content/55 hover:bg-content/10 hover:text-content"
            >
              <Kanban className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onNewChat}
            aria-label={`New chat (${shortcut})`}
            className="flex h-7 items-center gap-1.5 rounded-md bg-content/10 px-2.5 text-[12px] text-content/85 hover:bg-content/15"
          >
            <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
            New chat
          </button>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        {rows.length > 0 || loading || error ? list : null}
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col ${
            activeId || rows.length === 0 ? "flex" : "hidden md:flex"
          }`}
        >
          {activeId && pane ? (
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{pane}</div>
              {footer}
            </>
          ) : (
            <ChatMessage
              title={rows.length === 0 ? "Ask anything" : "Pick a chat"}
              body={
                rows.length === 0
                  ? "Chats run in a private scratch folder, outside any project. Use them for quick questions, drafts and ideas that don't belong to a repo."
                  : "Choose a chat on the left, or start a new one."
              }
              action={
                <button
                  type="button"
                  onClick={onNewChat}
                  className="flex items-center gap-1.5 rounded-md bg-content/10 px-2.5 py-1 text-[12px] text-content/85 hover:bg-content/15"
                >
                  New chat
                  <span aria-hidden className="text-content/45">
                    {shortcut}
                  </span>
                </button>
              }
            />
          )}
        </div>
      </div>
      {menu && menuRow ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          ariaLabel="Chat actions"
          onPick={onPick}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function ChatRow({
  row,
  active,
  renaming,
  onSelect,
  onMenu,
  onRename,
  onCancelRename,
}: {
  row: FreeChatRow;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    if (!renaming) return;
    done.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);
  const stateLabel = STATE_LABEL[row.state];
  return (
    <div
      data-free-chat-row={row.id}
      data-state={row.state}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      className={`group relative flex h-8 items-center gap-2 rounded-md pl-2 pr-1 ${
        active
          ? "bg-selection text-content"
          : "text-content/70 hover:bg-content/10 hover:text-content"
      }`}
    >
      <HarnessIcon harness={row.harness} className="size-3.5 shrink-0 opacity-70" />
      {renaming ? (
        <input
          ref={inputRef}
          defaultValue={row.title}
          aria-label="Chat title"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              done.current = true;
              onRename(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              done.current = true;
              onCancelRename();
            }
          }}
          onBlur={(event) => {
            if (!done.current) onRename(event.currentTarget.value);
          }}
          className="h-6 min-w-0 flex-1 rounded border border-content/20 bg-transparent px-1 text-[13px] text-content outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          aria-label={stateLabel ? `${row.title}, ${stateLabel}` : row.title}
          className="min-w-0 flex-1 truncate text-left text-[13px]"
        >
          {row.title}
        </button>
      )}
      {row.pinned ? (
        <Pin aria-hidden className="size-3 shrink-0 opacity-50" />
      ) : null}
      {row.state === "needs-input" ? (
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-amber-500" />
      ) : row.state === "running" ? (
        <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin opacity-60" />
      ) : row.state === "unread" ? (
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
      ) : null}
      <button
        type="button"
        aria-label={`More actions for ${row.title}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left, rect.bottom);
        }}
        className="grid size-6 shrink-0 place-items-center rounded text-content/50 opacity-0 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
    </div>
  );
}

function ChatMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 pb-12 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-content/5">
        <MessageSquare className="size-5 text-content/35" strokeWidth={1.5} />
      </span>
      <p className="mt-1 text-[13px] font-medium text-content/85">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-content/50">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
