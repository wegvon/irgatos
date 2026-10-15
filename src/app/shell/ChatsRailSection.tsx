import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "../../shared/ui/icons";
import type { FreeChatRow } from "../../features/freechat/model/freeChat";
import {
  CHAT_STATE_LABEL,
  ChatList,
  ChatStateMark,
  chatsState,
  type ChatListActions,
} from "../../features/freechat/ui/ChatList";

export type ChatsRailProps = ChatListActions & {
  rows: readonly FreeChatRow[];
  activeId?: string;
  /** Chats that already have a card on the board. */
  boardIds?: ReadonlySet<string>;
  onNew(): void;
};

export function ChatsRailSection({
  rows,
  activeId,
  boardIds,
  onNew,
  ...actions
}: ChatsRailProps) {
  const [collapsed, setCollapsed] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  // A collapsed list still says when a chat works, waits on you or replied.
  const hidden = collapsed ? chatsState(rows) : "idle";
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
          {hidden !== "idle" ? (
            <>
              <span className="sr-only">, {CHAT_STATE_LABEL[hidden]}</span>
              <span className="ml-1 flex items-center">
                <ChatStateMark state={hidden} />
              </span>
            </>
          ) : null}
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
        <ChatList
          rows={rows}
          activeId={activeId}
          boardIds={boardIds}
          className="flex flex-col gap-px px-2"
          {...actions}
        />
      ) : null}
    </section>
  );
}
