import type { ReactNode } from "react";
import { FolderTree, Sparkles, Wrench } from "../../../shared/ui/icons";
import {
  CHAT_STARTERS,
  CHAT_STARTER_FILE_HINT,
  draftWithStarter,
  type ChatStarter,
  type ChatStarterId,
} from "../model/chatStarters";
import { getComposerDraft } from "../model/draftCache";
import { insertSessionMessageIntoComposer } from "../model/sessionReferenceEvents";

const ICONS: Record<ChatStarterId, ReactNode> = {
  explain: <FolderTree className="size-3.5" />,
  fix: <Wrench className="size-3.5" />,
  build: <Sparkles className="size-3.5" />,
};

type Props = {
  sessionId: string;
  starters?: readonly ChatStarter[];
};

/**
 * Starting points under the empty chat's composer. A pick only fills the
 * composer with an editable draft; the user still sends it themselves.
 */
export function ChatStarters({ sessionId, starters = CHAT_STARTERS }: Props) {
  const pick = (starter: ChatStarter) =>
    insertSessionMessageIntoComposer(
      sessionId,
      draftWithStarter(getComposerDraft(sessionId) ?? "", starter),
      { replace: true, focus: true },
    );

  return (
    <div data-chat-starters className="mt-3 px-2.5">
      <div className="flex flex-wrap gap-2">
        {starters.map((starter) => (
          <button
            key={starter.id}
            type="button"
            data-chat-starter={starter.id}
            onClick={() => pick(starter)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-content/10 bg-content/5 pl-2.5 pr-3 text-sm text-content/80 transition-colors hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-content/30"
          >
            <span className="flex text-content/50">
              {ICONS[starter.id] ?? null}
            </span>
            {starter.label}
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-xs leading-snug text-content/50">
        {CHAT_STARTER_FILE_HINT}
      </p>
    </div>
  );
}
