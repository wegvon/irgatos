import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import { Check, ChevronLeft, ChevronRight } from "../../../shared/ui/icons";
import { MatchText } from "../../../shared/ui/MatchText";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { pathKey, prettyCwd, projectName } from "../../../shared/lib/paths";
import {
  loadReferenceSources,
  type SessionReferenceCandidate,
} from "../data/sessionReferenceDirectory";
import { useSessionReferenceCandidates } from "../hooks/useSessionReferences";
import { HARNESS_TITLE, sessionDisplayTitle } from "../model/session";
import {
  formatActivityAge,
  formatTokenEstimate,
  rankReferenceCandidates,
  sessionMessages,
  sessionReferenceId,
  sessionReferenceLabel,
  type RankedReferenceCandidate,
  type SessionMessage,
} from "../model/sessionReferences";
import { HarnessIcon } from "./HarnessIcon";

export type SessionReferencePickerHandle = {
  /** Returns true when the picker consumed the key. */
  handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

type Props = {
  query: string;
  currentSessionId?: string;
  /** Project of the composer, to flag chats from elsewhere. */
  currentCwd: string;
  handleRef?: Ref<SessionReferencePickerHandle>;
  onPick: (label: string) => void;
  onClose: () => void;
};

type Drill = {
  candidate: SessionReferenceCandidate;
  messages: SessionMessage[] | null;
  error?: string;
};

export function SessionReferencePicker({
  query,
  currentSessionId,
  currentCwd,
  handleRef,
  onPick,
  onClose,
}: Props) {
  const { candidates, loading } = useSessionReferenceCandidates(
    true,
    currentSessionId,
  );
  const ranked = useMemo(
    () => rankReferenceCandidates(candidates, query),
    [candidates, query],
  );
  const [active, setActive] = useState(0);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [messageActive, setMessageActive] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const queryAtDrill = useRef(query);
  const drillId = useRef<string | null>(null);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, ranked.length - 1)));
  }, [ranked.length]);
  useEffect(() => {
    if (drill && query !== queryAtDrill.current) setDrill(null);
  }, [drill, query]);

  const openDrill = (candidate: SessionReferenceCandidate) => {
    const prefix = sessionReferenceId(candidate.id);
    if (!prefix) return;
    queryAtDrill.current = query;
    setPicked(new Set());
    setDrill({ candidate, messages: null });
    drillId.current = candidate.id;
    void loadReferenceSources([prefix]).then((sources) => {
      if (drillId.current !== candidate.id) return;
      const source = sources.get(prefix);
      const messages = source ? sessionMessages(source) : [];
      setMessageActive(Math.max(0, messages.length - 1));
      setDrill((current) =>
        current?.candidate.id === candidate.id
          ? {
              ...current,
              messages,
              ...(source ? {} : { error: "This session could not be loaded." }),
            }
          : current,
      );
    });
  };

  const pickWhole = (candidate: SessionReferenceCandidate) => {
    const label = sessionReferenceLabel(candidate);
    if (label) onPick(label);
  };

  const pickMessages = () => {
    if (!drill?.messages?.length) return;
    const ordinals = picked.size
      ? [...picked]
      : [drill.messages[messageActive]!.ordinal];
    const label = sessionReferenceLabel(drill.candidate, ordinals);
    if (label) onPick(label);
  };

  const toggle = (ordinal: number) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(ordinal)) next.delete(ordinal);
      else next.add(ordinal);
      return next;
    });
  };

  useImperativeHandle(handleRef, () => ({
    handleKey: (event) => {
      if (drill) {
        const count = drill.messages?.length ?? 0;
        switch (event.key) {
          case "ArrowDown":
            if (count) setMessageActive((i) => (i + 1) % count);
            break;
          case "ArrowUp":
            if (count) setMessageActive((i) => (i - 1 + count) % count);
            break;
          case " ": {
            const message = drill.messages?.[messageActive];
            if (message) toggle(message.ordinal);
            break;
          }
          case "Enter":
          case "Tab":
            if (event.shiftKey) return false;
            pickMessages();
            break;
          case "ArrowLeft":
          case "Escape":
            setDrill(null);
            break;
          default:
            return false;
        }
        event.preventDefault();
        return true;
      }
      const count = ranked.length;
      switch (event.key) {
        case "ArrowDown":
          if (count) setActive((i) => (i + 1) % count);
          break;
        case "ArrowUp":
          if (count) setActive((i) => (i - 1 + count) % count);
          break;
        case "ArrowRight": {
          const row = ranked[active];
          if (!row) return false;
          openDrill(row.candidate);
          break;
        }
        case "Enter":
        case "Tab": {
          if (event.shiftKey) return false;
          const row = ranked[active];
          if (!row) {
            if (event.key === "Enter") return false;
            break;
          }
          pickWhole(row.candidate);
          break;
        }
        case "Escape":
          onClose();
          break;
        default:
          return false;
      }
      event.preventDefault();
      return true;
    },
  }));

  return (
    <div
      data-mention-picker
      data-session-reference-picker
      className="overflow-hidden rounded-lg border border-content/10 bg-content/5 backdrop-blur-xl"
    >
      {drill ? (
        <MessageList
          drill={drill}
          active={messageActive}
          picked={picked}
          onActive={setMessageActive}
          onToggle={toggle}
          onBack={() => setDrill(null)}
          onInsert={pickMessages}
        />
      ) : (
        <SessionList
          rows={ranked}
          query={query}
          loading={loading}
          active={active}
          currentCwd={currentCwd}
          onActive={setActive}
          onPick={pickWhole}
          onDrill={openDrill}
        />
      )}
    </div>
  );
}

function usePointerActive(dep: unknown) {
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  useEffect(() => {
    pointer.current.allow = false;
  }, [dep]);
  return {
    onMouseMove: (e: ReactMouseEvent) => {
      if (e.clientX === pointer.current.x && e.clientY === pointer.current.y)
        return;
      pointer.current = { x: e.clientX, y: e.clientY, allow: true };
    },
    allow: () => pointer.current.allow,
  };
}

export function SessionList({
  rows,
  query,
  loading,
  active,
  currentCwd,
  onActive,
  onPick,
  onDrill,
  emptyHint,
}: {
  rows: RankedReferenceCandidate<SessionReferenceCandidate>[];
  query: string;
  loading: boolean;
  active: number;
  currentCwd: string;
  onActive: (index: number) => void;
  onPick: (candidate: SessionReferenceCandidate) => void;
  onDrill?: (candidate: SessionReferenceCandidate) => void;
  emptyHint?: string;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLDivElement>(null);
  const pointer = usePointerActive(rows);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const now = Date.now();

  if (rows.length === 0) {
    return (
      <p className="px-3 py-2.5 text-[12px] text-content/50">
        {loading
          ? "Loading sessions…"
          : query.trim()
            ? "No sessions match"
            : (emptyHint ?? "No other sessions yet")}
      </p>
    );
  }
  return (
    <>
      <div
        ref={lockOverscroll}
        role="listbox"
        aria-label="Sessions"
        onMouseMove={pointer.onMouseMove}
        className="max-h-[min(300px,45vh)] overflow-y-auto overscroll-none px-1 py-1"
      >
        {rows.map(({ candidate, positions }, index) => {
          const highlighted = index === active;
          const title = sessionDisplayTitle(candidate.title, candidate.harness);
          const otherProject = pathKey(candidate.cwd) !== pathKey(currentCwd);
          return (
            <div
              key={candidate.id}
              ref={highlighted ? activeRef : undefined}
              role="option"
              aria-selected={highlighted}
              data-session-reference-row={candidate.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => pointer.allow() && onActive(index)}
              onClick={() => onPick(candidate)}
              className={`group flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left ${
                highlighted ? "bg-selection" : ""
              }`}
            >
              <span className="grid size-5 shrink-0 place-items-center">
                <HarnessIcon harness={candidate.harness} className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`min-w-0 truncate text-[13px] leading-5 ${highlighted ? "text-mention" : "text-content"}`}
                  >
                    <MatchText
                      text={title}
                      positions={positions}
                      active={!!query.trim()}
                    />
                  </span>
                  {candidate.busy ? (
                    <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-medium leading-4 text-accent">
                      Running
                    </span>
                  ) : null}
                  {otherProject ? (
                    <span className="shrink-0 rounded bg-content/8 px-1 text-[10px] leading-4 text-content/55">
                      Other project
                    </span>
                  ) : null}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-content/45">
                  <span className="shrink-0">
                    {HARNESS_TITLE[candidate.harness]}
                  </span>
                  <span aria-hidden>·</span>
                  <span
                    className="min-w-0 truncate"
                    title={candidate.worktreeCwd || candidate.cwd}
                  >
                    {otherProject
                      ? prettyCwd(candidate.worktreeCwd || candidate.cwd)
                      : projectName(candidate.cwd)}
                    {candidate.branch ? ` · ${candidate.branch}` : ""}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    {formatActivityAge(candidate.updatedAt, now)}
                  </span>
                </span>
              </span>
              {onDrill ? (
                <button
                  type="button"
                  tabIndex={-1}
                  title="Pick messages"
                  aria-label={`Pick messages from ${title}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDrill(candidate);
                  }}
                  className={`grid size-6 shrink-0 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content ${
                    highlighted ? "" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {onDrill ? (
        <p className="border-t border-content/8 px-3 py-1.5 text-[11px] text-content/40">
          Enter references the whole session · → picks messages
        </p>
      ) : null}
    </>
  );
}

function MessageList({
  drill,
  active,
  picked,
  onActive,
  onToggle,
  onBack,
  onInsert,
}: {
  drill: Drill;
  active: number;
  picked: ReadonlySet<number>;
  onActive: (index: number) => void;
  onToggle: (ordinal: number) => void;
  onBack: () => void;
  onInsert: () => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLDivElement>(null);
  const pointer = usePointerActive(drill.messages);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, drill.messages]);
  const { candidate, messages } = drill;
  const title = sessionDisplayTitle(candidate.title, candidate.harness);
  const pickedChars = (messages ?? [])
    .filter((m) => picked.has(m.ordinal))
    .reduce((sum, m) => sum + m.text.length, 0);

  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-content/8 px-1.5 py-1">
        <button
          type="button"
          title="Back to sessions"
          aria-label="Back to sessions"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onBack}
          className="grid size-6 shrink-0 place-items-center rounded text-content/50 hover:bg-content/10 hover:text-content"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2} />
        </button>
        <HarnessIcon
          harness={candidate.harness}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-content">
          {title}
        </span>
        {candidate.busy ? (
          <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] font-medium leading-4 text-accent">
            Running
          </span>
        ) : null}
      </div>
      {messages == null ? (
        <p className="px-3 py-2.5 text-[12px] text-content/50">
          Loading messages…
        </p>
      ) : messages.length === 0 ? (
        <p className="px-3 py-2.5 text-[12px] text-content/50">
          {drill.error ?? "This session has no readable messages."}
        </p>
      ) : (
        <div
          ref={lockOverscroll}
          role="listbox"
          aria-multiselectable
          aria-label={`Messages in ${title}`}
          onMouseMove={pointer.onMouseMove}
          className="max-h-[min(300px,45vh)] overflow-y-auto overscroll-none px-1 py-1"
        >
          {messages.map((message, index) => {
            const highlighted = index === active;
            const checked = picked.has(message.ordinal);
            const preview = message.text.replace(/\s+/g, " ").trim();
            return (
              <div
                key={message.ordinal}
                ref={highlighted ? activeRef : undefined}
                role="option"
                aria-selected={checked}
                data-session-message={message.ordinal}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => pointer.allow() && onActive(index)}
                onClick={() => onToggle(message.ordinal)}
                className={`flex w-full cursor-default items-start gap-2 rounded-md px-2 py-1.5 ${
                  highlighted ? "bg-selection" : ""
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-[4px] border ${
                    checked
                      ? "border-accent bg-accent text-white"
                      : "border-content/25"
                  }`}
                >
                  {checked ? (
                    <Check className="size-2.5" strokeWidth={3} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px] leading-4 text-content/45">
                    <span className="font-irgat">#{message.ordinal}</span>
                    <span>
                      {message.kind === "user"
                        ? "You"
                        : message.harness
                          ? HARNESS_TITLE[message.harness]
                          : "Agent"}
                    </span>
                    {message.streaming ? (
                      <span className="text-accent">still writing</span>
                    ) : null}
                    <span className="ml-auto shrink-0">
                      {formatTokenEstimate(message.text.length)}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[12.5px] leading-[18px] text-content/85">
                    {preview}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-content/8 px-3 py-1.5 text-[11px] text-content/40">
        <span className="min-w-0 flex-1 truncate">
          {picked.size
            ? `${picked.size} selected · ${formatTokenEstimate(pickedChars)}`
            : "Space selects · Enter inserts the highlighted message"}
        </span>
        {messages?.length ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onInsert}
            className="shrink-0 rounded bg-content/10 px-1.5 py-0.5 text-[11px] text-content/80 hover:bg-content/15"
          >
            {picked.size ? `Insert ${picked.size}` : "Insert"}
          </button>
        ) : null}
      </div>
    </>
  );
}
