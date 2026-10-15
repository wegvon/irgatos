import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
} from "../../shared/ui/icons";
import type { FreeChatRow } from "../../features/freechat/model/freeChat";

export type ChatsRailProps = {
  rows: readonly FreeChatRow[];
  activeId?: string;
  onSelect(id?: string): void;
  onNew(): void;
};

export function ChatsRailSection({
  rows,
  activeId,
  onSelect,
  onNew,
}: ChatsRailProps) {
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section aria-label="Chats" className="mb-2 shrink-0">
      <div className="flex items-center gap-1 px-3 pb-1.5 pt-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs leading-5 text-content/50 hover:text-content"
        >
          <Chevron className="size-3" /> Chats
        </button>
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          onClick={onNew}
          className="grid size-5 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {!collapsed ? (
        <div className="flex flex-col gap-px px-2">
          <button
            type="button"
            onClick={() => onSelect()}
            className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-content/55 hover:bg-content/8"
          >
            <MessageSquare className="size-3.5" /> All chats
          </button>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
              aria-current={activeId === row.id ? "page" : undefined}
              className={`flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-content/8 ${activeId === row.id ? "bg-selection-strong text-content" : "text-content/65"}`}
            >
              <MessageSquare className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              {row.state === "needs-input" || row.state === "unread" ? (
                <span
                  aria-label={
                    row.state === "needs-input" ? "Needs you" : "Unread"
                  }
                  className="size-1.5 rounded-full bg-accent"
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
