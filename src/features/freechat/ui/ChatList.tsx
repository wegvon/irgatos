import { useEffect, useRef, useState } from "react";
import {
  Columns,
  LoaderCircle,
  MoreHorizontal,
  Pin,
} from "../../../shared/ui/icons";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../files/ui/ExplorerMenu";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import type { FreeChatRow } from "../model/freeChat";

export type ChatListActions = {
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onBoard: (id: string) => void;
  /** Shows the chat next to the one open, in its own pane. */
  onOpenBeside?: (id: string) => void;
};

export const CHAT_STATE_LABEL: Record<FreeChatRow["state"], string> = {
  "needs-input": "Needs you",
  running: "Running",
  unread: "New reply",
  idle: "",
};

/**
 * Chat rows with their state (running, needs you, new reply) and the
 * Rename, Pin, Board and Delete actions, on right-click or the row's menu.
 * Option-click, or the row's columns button, opens a chat beside the open one.
 */
export function ChatList({
  rows,
  activeId,
  boardIds,
  className = "flex flex-col gap-px",
  onSelect,
  onRename,
  onPin,
  onDelete,
  onBoard,
  onOpenBeside,
}: ChatListActions & {
  rows: readonly FreeChatRow[];
  activeId?: string;
  /** Chats that already have a card on the board. */
  boardIds?: ReadonlySet<string>;
  className?: string;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const onBoardAlready = (id: string) => boardIds?.has(id) ?? false;
  const menuRow = menu ? rows.find((row) => row.id === menu.id) : undefined;
  const menuItems: ExplorerMenuItem[] = menuRow
    ? [
        ...(onOpenBeside
          ? [
              { kind: "item" as const, id: "beside", label: "Open beside" },
              { kind: "sep" as const },
            ]
          : []),
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
          disabled: menuRow.blank && !onBoardAlready(menuRow.id),
        },
        { kind: "sep" },
        { kind: "item", id: "delete", label: "Delete", danger: true },
      ]
    : [];

  const onPick = (action: string) => {
    if (!menuRow) return;
    if (action === "beside") onOpenBeside?.(menuRow.id);
    else if (action === "rename") setRenaming(menuRow.id);
    else if (action === "pin") onPin(menuRow.id, !menuRow.pinned);
    else if (action === "board") onBoard(menuRow.id);
    else if (action === "delete") onDelete(menuRow.id);
    setMenu(null);
  };

  return (
    <>
      <ul className={className}>
        {rows.map((row) => (
          <li key={row.id} className="list-none">
            <ChatRow
              row={row}
              active={row.id === activeId}
              renaming={renaming === row.id}
              onSelect={() => onSelect(row.id)}
              onOpenBeside={
                onOpenBeside ? () => onOpenBeside(row.id) : undefined
              }
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
    </>
  );
}

function ChatRow({
  row,
  active,
  renaming,
  onSelect,
  onOpenBeside,
  onMenu,
  onRename,
  onCancelRename,
}: {
  row: FreeChatRow;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onOpenBeside?: () => void;
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
  const stateLabel = CHAT_STATE_LABEL[row.state];
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
      <HarnessIcon
        harness={row.harness}
        className="size-3.5 shrink-0 opacity-70"
      />
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
          onClick={(event) => {
            if (event.altKey && onOpenBeside) onOpenBeside();
            else onSelect();
          }}
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
      <ChatStateMark state={row.state} />
      {onOpenBeside && !active ? (
        <button
          type="button"
          aria-label={`Open ${row.title} beside`}
          title="Open beside (⌥-click)"
          onClick={onOpenBeside}
          className="grid size-6 shrink-0 place-items-center rounded text-content/50 opacity-0 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Columns className="size-3.5" />
        </button>
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

/** The running, needs-you or new-reply mark a chat row shows. */
export function ChatStateMark({ state }: { state: FreeChatRow["state"] }) {
  return state === "needs-input" ? (
    <span aria-hidden className="size-2 shrink-0 rounded-full bg-amber-500" />
  ) : state === "running" ? (
    <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin opacity-60" />
  ) : state === "unread" ? (
    <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
  ) : null;
}

/** The most pressing state among `rows`: needs you, then running, then new reply. */
export function chatsState(rows: readonly FreeChatRow[]): FreeChatRow["state"] {
  for (const state of ["needs-input", "running", "unread"] as const)
    if (rows.some((row) => row.state === state)) return state;
  return "idle";
}
