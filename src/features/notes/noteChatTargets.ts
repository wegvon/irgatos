import {
  sessionDisplayTitle,
  type HarnessId,
  type Session,
} from "../sessions/model/session";
import { leafIds, type WorkspaceTab } from "../workspace/model/layout";
import { looksLikeProject } from "../projects/model/recents";
import { projectName } from "../../shared/lib/paths";
import type { NoteComposerCard } from "./notes";

/** An open chat a saved note can be added to. */
export type NoteChatTarget = {
  sessionId: string;
  title: string;
  harness: HarnessId;
  model: string;
  /** Project folder name, or null for a chat outside any project. */
  project: string | null;
  irgat: boolean;
  /** The chat that was in front before Notes opened. */
  current: boolean;
};

type TargetSession = Pick<
  Session,
  | "id"
  | "title"
  | "harness"
  | "model"
  | "cwd"
  | "inboxAsk"
  | "orchestrationLeadId"
>;

/**
 * Every chat open right now, the one in front first: the Irgat in full view
 * if there is one, otherwise the active tab's focused pane, then that tab's
 * other panes, then the other tabs in strip order.
 *
 * Inbox asks and orchestration workers are left out; neither takes a draft.
 */
export function openNoteChatTargets({
  sessions,
  tabs,
  activeTabId,
  irgat,
}: {
  sessions: readonly TargetSession[];
  tabs: readonly Pick<WorkspaceTab, "id" | "layout" | "focusedId">[];
  activeTabId: string;
  /** The Irgat in full view, with the name its chat goes by. */
  irgat?: { sessionId: string; name?: string };
}): NoteChatTarget[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const targets: NoteChatTarget[] = [];
  const seen = new Set<string>();
  const add = (id: string, asIrgat?: { name?: string }) => {
    if (seen.has(id)) return;
    const session = byId.get(id);
    if (!session || session.inboxAsk || session.orchestrationLeadId) return;
    seen.add(id);
    targets.push({
      sessionId: id,
      title:
        asIrgat?.name?.trim() ||
        sessionDisplayTitle(session.title, session.harness),
      harness: session.harness,
      model: session.model,
      project: looksLikeProject(session.cwd) ? projectName(session.cwd) : null,
      irgat: !!asIrgat,
      current: targets.length === 0,
    });
  };
  if (irgat) add(irgat.sessionId, irgat);
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const ordered = active
    ? [active, ...tabs.filter((tab) => tab !== active)]
    : [...tabs];
  for (const tab of ordered) {
    add(tab.focusedId);
    for (const id of leafIds(tab.layout)) add(id);
  }
  return targets;
}

/**
 * How a note lands in an open chat without touching what is already typed
 * there: as the composer's note card when that slot is free (or already
 * holds this note), otherwise as a "Note: …" block appended to the draft.
 * An Irgat's chat box has no card slot, so it always takes the block.
 */
export function noteChatPlacement(
  session: { noteCard?: Pick<NoteComposerCard, "id"> },
  card: Pick<NoteComposerCard, "id">,
  irgat: boolean,
): "card" | "text" {
  if (irgat) return "text";
  return !session.noteCard || session.noteCard.id === card.id ? "card" : "text";
}
