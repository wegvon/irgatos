import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Modal } from "../../../shared/ui/Modal";
import { Search } from "../../../shared/ui/icons";
import { peekLiveSessions } from "../data/sessionReferenceDirectory";
import { useSessionReferenceCandidates } from "../hooks/useSessionReferences";
import { HARNESS_TITLE, sessionDisplayTitle } from "../model/session";
import {
  insertSessionReference,
  OPEN_REFERENCED_SESSION_EVENT,
  SEND_TO_SESSION_EVENT,
  type OpenReferencedSessionRequest,
  type SendToSessionRequest,
} from "../model/sessionReferenceEvents";
import {
  formatTokenEstimate,
  rankReferenceCandidates,
  sessionMessageForBlock,
  sessionMessages,
  sessionReferenceLabel,
} from "../model/sessionReferences";
import { SessionList } from "./SessionReferencePicker";

type Props = {
  /** Bring a chat to the front, scrolled to `blockId` when given. */
  onOpenSession: (sessionId: string, blockId?: string) => void | Promise<void>;
};

/** App-level handler for opening referenced chats and sending messages on. */
export function SessionReferenceHost({ onOpenSession }: Props) {
  const [sending, setSending] = useState<SendToSessionRequest | null>(null);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<OpenReferencedSessionRequest>)
        .detail;
      if (!detail?.sessionId) return;
      void Promise.resolve(
        onOpenSession(detail.sessionId, detail.blockId),
      ).catch(console.error);
    };
    const send = (event: Event) => {
      const detail = (event as CustomEvent<SendToSessionRequest>).detail;
      if (detail?.sourceSessionId && detail.blockId) setSending(detail);
    };
    window.addEventListener(OPEN_REFERENCED_SESSION_EVENT, open);
    window.addEventListener(SEND_TO_SESSION_EVENT, send);
    return () => {
      window.removeEventListener(OPEN_REFERENCED_SESSION_EVENT, open);
      window.removeEventListener(SEND_TO_SESSION_EVENT, send);
    };
  }, [onOpenSession]);

  if (!sending) return null;
  return (
    <SendToSessionDialog
      request={sending}
      onClose={() => setSending(null)}
      onSent={(targetId) => {
        setSending(null);
        void Promise.resolve(onOpenSession(targetId)).catch(console.error);
      }}
    />
  );
}

function SendToSessionDialog({
  request,
  onClose,
  onSent,
}: {
  request: SendToSessionRequest;
  onClose: () => void;
  onSent: (targetSessionId: string) => void;
}) {
  const source = peekLiveSessions().find(
    (session) => session.id === request.sourceSessionId,
  );
  const message = useMemo(
    () =>
      source
        ? sessionMessageForBlock(sessionMessages(source), request.blockId)
        : undefined,
    [source, request.blockId],
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { candidates, loading } = useSessionReferenceCandidates(
    true,
    request.sourceSessionId,
  );
  const rows = useMemo(
    () => rankReferenceCandidates(candidates, query),
    [candidates, query],
  );
  useEffect(() => setActive(0), [query]);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const label = source
    ? sessionReferenceLabel(source, message ? [message.ordinal] : null)
    : null;
  const send = (targetId: string) => {
    if (!label) return;
    insertSessionReference(targetId, label);
    onSent(targetId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && rows.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (event.key === "ArrowUp" && rows.length) {
      event.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (row) send(row.candidate.id);
    }
  };

  const sourceTitle = source
    ? sessionDisplayTitle(source.title, source.harness)
    : "this session";
  const what = message
    ? `${message.kind === "user" ? "Your message" : `${message.harness ? HARNESS_TITLE[message.harness] : "Agent"} reply`} #${message.ordinal}`
    : "This session";
  return (
    <Modal
      title="Send to another session"
      description={`${what} from “${sourceTitle}” goes into the chat you pick as a reference.`}
      onClose={onClose}
      size="md"
    >
      <div data-send-to-session-dialog className="px-4 pt-2 pb-4">
        {message ? (
          <div className="mb-2 rounded-md bg-content/5 px-2.5 py-1.5 text-[12px] leading-[18px] text-content/70">
            <p className="line-clamp-2">
              {message.text.replace(/\s+/g, " ").trim()}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-content/45">
              {formatTokenEstimate(message.text.length)}
            </p>
          </div>
        ) : null}
        <label className="flex items-center gap-2 rounded-md border border-content/10 bg-content/4 px-2.5 py-1.5 focus-within:border-content/25">
          <Search
            className="size-3.5 shrink-0 text-content/40"
            strokeWidth={1.75}
          />
          <input
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search sessions by title, project, agent or branch"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/35"
          />
        </label>
        <div className="mt-2 overflow-hidden rounded-lg border border-content/10">
          <SessionList
            rows={rows}
            query={query}
            loading={loading}
            active={active}
            currentCwd={source?.cwd ?? ""}
            onActive={setActive}
            onPick={(candidate) => send(candidate.id)}
            emptyHint="No other sessions to send to"
          />
        </div>
        {!label ? (
          <p role="alert" className="mt-2 text-[12px] text-red-400">
            This message can't be referenced from here.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
