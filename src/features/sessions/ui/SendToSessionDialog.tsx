import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Modal } from "../../../shared/ui/Modal";
import { MatchText } from "../../../shared/ui/MatchText";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { Search, Share } from "../../../shared/ui/icons";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { projectName } from "../../../shared/lib/paths";
import { MOD } from "../../../platform/tauri/platform";
import { saveCooperativeMode } from "../data/sessionMessageStore";
import { useLiveSessions } from "../hooks/useSessionReferences";
import { useCooperativeMode } from "../hooks/useSessionMessages";
import { resolveModel } from "../model/models";
import { HARNESS_TITLE, sessionDisplayTitle, type Session } from "../model/session";
import {
  isMessageableSession,
  sendSessionMessage,
} from "../model/sessionMessageRouter";
import {
  SESSION_ACTIVITY_LABEL,
  sessionMessageTargets,
  type SessionActivity,
  type SessionMessageMode,
  type SessionMessageTarget,
} from "../model/sessionMessaging";
import {
  insertSessionReference,
  type SendToSessionRequest,
} from "../model/sessionReferenceEvents";
import {
  formatTokenEstimate,
  rankReferenceCandidates,
  sessionMessageForBlock,
  sessionMessages,
  sessionReferenceLabel,
} from "../model/sessionReferences";
import { HarnessIcon } from "./HarnessIcon";

const ACTIVITY_TONE: Record<SessionActivity, string> = {
  running: "bg-accent/15 text-accent",
  "needs-input": "bg-amber-500/15 text-amber-400",
  queued: "bg-content/8 text-content/60",
  idle: "bg-content/6 text-content/45",
};

type Row =
  | { kind: "broadcast"; targets: SessionMessageTarget[] }
  | { kind: "session"; target: SessionMessageTarget; positions: number[] };

export type SendToSessionResult = {
  mode: SessionMessageMode | "reference";
  targetIds: string[];
};

/**
 * Send a message, or part of one, straight to another open session: into its
 * composer, or as a turn its agent runs right away.
 */
export function SendToSessionDialog({
  request,
  onClose,
  onSent,
}: {
  request: SendToSessionRequest;
  onClose: () => void;
  onSent: (result: SendToSessionResult) => void;
}) {
  const live = useLiveSessions();
  const cooperative = useCooperativeMode();
  const source = live.find((session) => session.id === request.sourceSessionId);
  const message = useMemo(
    () =>
      source
        ? sessionMessageForBlock(sessionMessages(source), request.blockId)
        : undefined,
    [source, request.blockId],
  );
  const [text, setText] = useState(
    () => request.text?.trim() || message?.text || "",
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [expectReply, setExpectReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targets = useMemo(
    () =>
      sessionMessageTargets(live, request.sourceSessionId, isMessageableSession),
    [live, request.sourceSessionId],
  );
  const rows = useMemo(() => buildRows(targets, query), [targets, query]);
  useEffect(() => setActive(0), [query]);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const sourceTitle = source
    ? sessionDisplayTitle(source.title, source.harness)
    : "this session";
  const what = request.text?.trim()
    ? "The selected text"
    : message
      ? `${message.kind === "user" ? "Your message" : `${message.harness ? HARNESS_TITLE[message.harness] : "Agent"} reply`} #${message.ordinal}`
      : "This message";
  const selected = rows[Math.min(active, rows.length - 1)];
  const selectedTargets: Session[] = !selected
    ? []
    : selected.kind === "broadcast"
      ? selected.targets.map((target) => target.session)
      : [selected.target.session];

  const send = (mode: SessionMessageMode, row: Row | undefined = selected) => {
    if (!source || !row) return;
    const to =
      row.kind === "broadcast"
        ? row.targets.map((target) => target.session)
        : [row.target.session];
    if (!text.trim()) {
      setError("Write something to send.");
      return;
    }
    const sent = sendSessionMessage({
      from: source,
      to,
      text,
      mode,
      origin: "user",
      sourceBlockId: request.blockId,
      expectReply: mode === "run" && expectReply,
    });
    const failed = sent.find((entry) => entry.status === "failed");
    if (failed && sent.length === 1) {
      setError(failed.error ?? "The message couldn't be sent.");
      return;
    }
    onSent({ mode, targetIds: to.map((session) => session.id) });
  };
  const reference = () => {
    if (!source || selected?.kind !== "session") return;
    const label = sessionReferenceLabel(
      source,
      message ? [message.ordinal] : null,
    );
    if (!label) {
      setError("This message can't be referenced from here.");
      return;
    }
    insertSessionReference(selected.target.session.id, label);
    onSent({ mode: "reference", targetIds: [selected.target.session.id] });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" && rows.length) {
      event.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (event.key === "ArrowUp" && rows.length) {
      event.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(event.metaKey || event.ctrlKey ? "run" : "composer");
    }
  };

  return (
    <Modal
      title="Send to session"
      description={`${what} from “${sourceTitle}” goes to the session you pick, labelled with where it came from.`}
      onClose={onClose}
      size="md"
    >
      <div data-send-to-session-dialog className="px-4 pt-2 pb-4">
        <label className="block">
          <span className="sr-only">Message</span>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            rows={4}
            aria-label="Message"
            data-session-message-text
            className="max-h-40 min-h-16 w-full resize-y rounded-md border border-content/10 bg-content/4 px-2.5 py-1.5 text-[12px] leading-[18px] text-content/80 outline-none focus:border-content/25"
          />
        </label>
        <p className="mt-0.5 mb-2 font-mono text-[11px] text-content/45">
          {formatTokenEstimate(text.length)} · arrives as [Message from session “
          {sourceTitle}”]
        </p>
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
            placeholder="Search open sessions by title, agent or branch"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/35"
          />
        </label>
        <div className="mt-2 overflow-hidden rounded-lg border border-content/10">
          <TargetList
            rows={rows}
            active={active}
            query={query}
            onActive={setActive}
            onPick={(index) => setActive(index)}
            onRun={(index) => send("run", rows[index])}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-content/60">
            <input
              type="checkbox"
              checked={expectReply}
              onChange={(event) => setExpectReply(event.target.checked)}
              className="accent-accent"
              data-session-message-expect-reply
            />
            Bring the reply back here
          </label>
          <span className="flex-1" />
          <button
            type="button"
            disabled={selected?.kind !== "session"}
            onClick={reference}
            title="Insert an @session reference instead of the text"
            className="rounded-md px-2 py-1 text-[12px] text-content/55 hover:bg-content/8 hover:text-content disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Reference only
          </button>
          <SecondaryButton
            disabled={!selectedTargets.length || !source}
            onClick={() => send("composer")}
            data-session-message-action="composer"
            title="Enter"
          >
            Queue in composer
          </SecondaryButton>
          <button
            type="button"
            disabled={!selectedTargets.length || !source}
            onClick={() => send("run")}
            data-session-message-action="run"
            title={`${MOD}Enter`}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-on-accent hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
          >
            <Share className="size-3.5" strokeWidth={1.75} />
            Send &amp; run
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-[12px] text-red-400">
            {error}
          </p>
        ) : !source ? (
          <p role="alert" className="mt-2 text-[12px] text-red-400">
            This message can't be sent from here.
          </p>
        ) : null}
        <label className="mt-3 flex items-start gap-2 border-t border-content/8 pt-3 text-[12px] text-content/60">
          <input
            type="checkbox"
            checked={cooperative.enabled}
            onChange={(event) => saveCooperativeMode(event.target.checked)}
            className="mt-0.5 accent-accent"
            data-cooperative-mode
          />
          <span>
            Cooperative mode
            <span className="mt-0.5 block text-[11px] text-content/45">
              Agents can hand work to sibling sessions by writing
              {" "}
              <code>@send:"Session"</code> or ask them with{" "}
              <code>@ask:"Session"</code> on its own line.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

function buildRows(targets: SessionMessageTarget[], query: string): Row[] {
  const ranked = rankReferenceCandidates(
    targets.map((target) => ({
      id: target.session.id,
      title: target.session.title,
      harness: target.session.harness,
      cwd: target.session.cwd,
      ...(target.session.branch ? { branch: target.session.branch } : {}),
      updatedAt: 0,
      target,
    })),
    query,
  );
  // Ranking keeps input order on ties, which already puts siblings first.
  const rows: Row[] = ranked.map(({ candidate, positions }) => ({
    kind: "session",
    target: candidate.target,
    positions,
  }));
  const siblings = targets.filter((target) => target.sibling);
  if (!query.trim() && siblings.length > 1) {
    rows.unshift({ kind: "broadcast", targets: siblings });
  }
  return rows;
}

function TargetList({
  rows,
  active,
  query,
  onActive,
  onPick,
  onRun,
}: {
  rows: Row[];
  active: number;
  query: string;
  onActive: (index: number) => void;
  onPick: (index: number) => void;
  onRun: (index: number) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  if (!rows.length) {
    return (
      <p className="px-3 py-2.5 text-[12px] text-content/50">
        {query.trim()
          ? "No open sessions match"
          : "No other sessions are open. Open one in a tab or pane to message it."}
      </p>
    );
  }
  let shownSiblingHeader = false;
  let shownOtherHeader = false;
  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label="Sessions"
      className="max-h-[min(300px,40vh)] overflow-y-auto overscroll-none px-1 py-1"
    >
      {rows.map((row, index) => {
        const highlighted = index === active;
        let header: string | null = null;
        if (row.kind === "session" && !query.trim()) {
          if (row.target.sibling && !shownSiblingHeader) {
            shownSiblingHeader = true;
            header = "This project";
          } else if (!row.target.sibling && !shownOtherHeader) {
            shownOtherHeader = true;
            header = "Other open sessions";
          }
        }
        return (
          <div key={row.kind === "broadcast" ? "broadcast" : row.target.session.id}>
            {header ? (
              <p className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide text-content/40 uppercase">
                {header}
              </p>
            ) : null}
            <div
              ref={highlighted ? activeRef : undefined}
              role="option"
              aria-selected={highlighted}
              data-session-message-target={
                row.kind === "broadcast" ? "siblings" : row.target.session.id
              }
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onActive(index)}
              onClick={() => onPick(index)}
              onDoubleClick={() => onRun(index)}
              className={`flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                highlighted ? "bg-selection" : ""
              }`}
            >
              {row.kind === "broadcast" ? (
                <>
                  <span className="grid size-5 shrink-0 place-items-center">
                    <Share className="size-3.5 text-content/55" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] leading-5 text-content">
                      All sibling sessions
                    </span>
                    <span className="block truncate text-[11px] leading-4 text-content/45">
                      Broadcast to {row.targets.length} sessions in{" "}
                      {projectName(row.targets[0]!.session.cwd)}
                    </span>
                  </span>
                </>
              ) : (
                <TargetRow row={row} query={query} highlighted={highlighted} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TargetRow({
  row,
  query,
  highlighted,
}: {
  row: Extract<Row, { kind: "session" }>;
  query: string;
  highlighted: boolean;
}) {
  const { session, activity, sibling } = row.target;
  const title = sessionDisplayTitle(session.title, session.harness);
  const model = session.model
    ? resolveModel(session.harness, session.model).name
    : "Default model";
  return (
    <>
      <span className="grid size-5 shrink-0 place-items-center">
        <HarnessIcon harness={session.harness} className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`min-w-0 truncate text-[13px] leading-5 ${highlighted ? "text-mention" : "text-content"}`}
          >
            <MatchText
              text={title}
              positions={row.positions}
              active={!!query.trim()}
            />
          </span>
          <span
            data-session-activity={activity}
            className={`shrink-0 rounded px-1 text-[10px] font-medium leading-4 ${ACTIVITY_TONE[activity]}`}
          >
            {SESSION_ACTIVITY_LABEL[activity]}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-content/45">
          <span className="shrink-0">{HARNESS_TITLE[session.harness]}</span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{model}</span>
          {!sibling ? (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{projectName(session.cwd)}</span>
            </>
          ) : session.branch ? (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{session.branch}</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );
}
