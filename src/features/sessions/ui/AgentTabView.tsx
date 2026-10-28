import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentTranscript } from "./AgentTranscript";
import { TranscriptFind } from "./TranscriptFind";
import {
  clearTranscriptJump,
  peekTranscriptJump,
  subscribeTranscriptJump,
} from "../model/transcriptJump";
import { HarnessIcon } from "./HarnessIcon";
import { findModel } from "../model/models";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionWorkCwd,
  type Session,
} from "../model/session";
import { noteTitle, saveNoteOnce } from "../../notes";
import { requestOpenReferencedSession } from "../model/sessionReferenceEvents";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";

/**
 * One orchestration worker, watched from its lead's workspace.
 *
 * Read-only on purpose: the run belongs to the orchestrator, which decides
 * what each worker is asked and when. A composer here would put a second
 * voice into a conversation the lead is holding, so the way to change course
 * is to say so in the lead's own transcript.
 */
export function AgentTabView({
  title,
  session,
  visible,
  focused = visible,
  onOpenFile,
  leadId,
  restored = false,
}: {
  title: string;
  session?: Session;
  visible: boolean;
  focused?: boolean;
  onOpenFile?: (path: string) => void;
  /** The orchestrator's conversation, where the worker's work is summarised. */
  leadId?: string;
  /** Reopened after a restart: a saved transcript, not a running worker. */
  restored?: boolean;
}) {
  const navigateBlockRef = useRef<
    ((blockId: string | null, query?: string) => boolean) | null
  >(null);
  const [navigatorReady, setNavigatorReady] = useState(false);
  const onNavigateReady = useCallback(
    (navigate: (blockId: string | null, query?: string) => boolean) => {
      navigateBlockRef.current = navigate;
      setNavigatorReady(true);
    },
    [],
  );
  const navigateBlock = useCallback(
    (blockId: string | null, query?: string) =>
      navigateBlockRef.current?.(blockId, query) ?? false,
    [],
  );
  const jumpRequest = useSyncExternalStore(
    subscribeTranscriptJump,
    () => peekTranscriptJump(session?.id ?? ""),
    () => null,
  );
  useEffect(() => {
    if (!visible || !navigatorReady || !session || !jumpRequest) return;
    const frame = requestAnimationFrame(() => {
      if (navigateBlock(jumpRequest.blockId, jumpRequest.query)) {
        clearTranscriptJump(session.id, jumpRequest.token);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, navigatorReady, jumpRequest, navigateBlock, session?.id]);
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const saveNote = useCallback(
    async (text: string) => {
      if (!session) return;
      const sessionTitle = sessionDisplayTitle(session.title, session.harness);
      await saveNoteOnce({
        title:
          sessionTitle && sessionTitle !== "New session"
            ? sessionTitle
            : noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session?.cwd, session?.harness, session?.id, session?.title],
  );
  const saveSelectionNote = useCallback(
    async (text: string) => {
      if (!session) return;
      await saveNoteOnce({
        title: noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session?.cwd, session?.id],
  );
  const openLead = leadId
    ? () => requestOpenReferencedSession({ sessionId: leadId })
    : undefined;
  if (!session) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="flex max-w-sm flex-col items-center gap-2">
          <p
            role="status"
            className="text-[12px] leading-5 text-content/45"
          >
            {restored
              ? "This view was saved before Irgatos restarted, but the agent's transcript could not be found. Its work is summarised in the orchestrator's conversation."
              : "This agent is no longer running. Its work is summarised in the orchestrator's conversation."}
          </p>
          {openLead ? (
            <OpenConversationButton onClick={openLead}>
              Open the orchestrator's conversation
            </OpenConversationButton>
          ) : null}
        </div>
      </div>
    );
  }
  // A restored worker is a record of what it did; it only runs again if its
  // orchestrator picks the run back up.
  const savedOnly = restored && !session.busy;
  const model = findModel(session.model)?.name ?? session.model;
  return (
    <div data-agent-tab className="flex h-full min-h-0 flex-col">
      {savedOnly ? (
        <div
          data-restored-view
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-stroke bg-content/[0.03] px-3 py-1.5 font-sans text-[11.5px] text-content/60"
        >
          <span>
            Restored after a restart: this is the saved transcript. The agent is
            not running.
          </span>
          {openLead ? (
            <button
              type="button"
              onClick={openLead}
              className="ml-auto shrink-0 underline decoration-content/25 underline-offset-2 hover:text-content"
            >
              Open orchestrator
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="@container relative min-h-0 flex-1">
        <AgentTranscript
          blocks={session.blocks}
          busy={session.busy}
          cwd={sessionWorkCwd(session)}
          harness={session.harness}
          model={session.model}
          visible={visible}
          onOpenFile={onOpenFile}
          onSaveNote={notesEnabled ? saveNote : undefined}
          onSaveSelectionNote={notesEnabled ? saveSelectionNote : undefined}
          onNavigateReady={onNavigateReady}
          managed
        />
        <TranscriptFind
          blocks={session.blocks}
          visible={visible}
          focused={focused}
          onNavigate={navigateBlock}
        />
      </div>
      <footer className="flex shrink-0 items-center gap-1.5 border-t border-stroke px-3 py-1.5 font-sans text-[11px] text-content/45">
        <HarnessIcon harness={session.harness} className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate" title={title}>
          {model} · {HARNESS_TITLE[session.harness]}
        </span>
        <span className="ml-auto shrink-0">
          {savedOnly
            ? "Saved transcript · not running"
            : "Run by the orchestrator · read-only"}
        </span>
      </footer>
    </div>
  );
}

function OpenConversationButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-content/15 px-2.5 py-1 text-[12px] text-content/75 transition-colors hover:bg-content/7 hover:text-content"
    >
      {children}
    </button>
  );
}
