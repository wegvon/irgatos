import { useState, useSyncExternalStore } from "react";
import { MessageSquare, Plus } from "../../../shared/ui/icons";
import {
  lastConversationFor,
  loadLastConversations,
  requestContinueConversation,
  subscribeLastConversations,
  type LastConversation,
} from "../../projects/model/lastConversation";
import { formatRelativeTime } from "../../inbox/model/githubTasks";
import { sessionDisplayTitle } from "../model/session";

/** Blank chats the user already answered with “New conversation”. */
const dismissed = new Set<string>();

type Props = {
  /** The blank chat the offer sits in. */
  sessionId: string;
  cwd: string;
  /** Fixed clock for previews and tests. */
  now?: number;
};

export function continueConversationLabel(
  entry: LastConversation,
  now = Date.now(),
): { title: string; when: string } {
  const shown = entry.harness
    ? sessionDisplayTitle(entry.title, entry.harness)
    : entry.title;
  const title = shown.trim() || "Untitled chat";
  const when =
    entry.at > 0 ? formatRelativeTime(new Date(entry.at).toISOString(), now) : "";
  return { title, when };
}

/**
 * Coming back to a project whose tabs were closed: the conversation it was
 * last worked in, one click away, beside starting fresh.
 */
export function ContinueConversation({ sessionId, cwd, now }: Props) {
  const memory = useSyncExternalStore(
    subscribeLastConversations,
    loadLastConversations,
    loadLastConversations,
  );
  const [hidden, setHidden] = useState(() => dismissed.has(sessionId));
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const entry = lastConversationFor(memory, cwd);
  if (hidden || !entry || entry.sessionId === sessionId) return null;
  const { title, when } = continueConversationLabel(entry, now);

  const startNew = () => {
    dismissed.add(sessionId);
    setHidden(true);
    // The composer is right below; typing there is the new conversation.
    root
      ?.closest("[data-empty-session]")
      ?.querySelector<HTMLElement>(
        '[data-composer] textarea, [data-composer] [contenteditable="true"]',
      )
      ?.focus();
  };

  return (
    <div
      ref={setRoot}
      data-continue-conversation
      className="mb-3 flex flex-wrap items-center gap-2 px-2.5"
    >
      <button
        type="button"
        data-continue-last
        onClick={() =>
          requestContinueConversation({
            sessionId: entry.sessionId,
            fromSessionId: sessionId,
          })
        }
        title={`Open “${title}” again`}
        className="inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-lg border border-content/15 bg-content/[0.07] pl-2.5 pr-3 text-left text-sm text-content transition-colors hover:bg-content/12 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-content/30"
      >
        <MessageSquare className="size-3.5 shrink-0 text-content/60" />
        <span className="shrink-0">Continue last conversation</span>
        <span className="min-w-0 truncate text-content/55">
          {title}
          {when ? ` · ${when}` : ""}
        </span>
      </button>
      <button
        type="button"
        data-new-conversation
        onClick={startNew}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-content/65 transition-colors hover:bg-content/7 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-content/30"
      >
        <Plus className="size-3.5" />
        New conversation
      </button>
    </div>
  );
}
