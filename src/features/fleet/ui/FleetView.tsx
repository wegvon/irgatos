import { useEffect, useMemo, useState, type ReactNode } from "react";
import { OverlayNav } from "../../../app/shell/TitleBar";
import { WindowControls } from "../../../app/shell/WindowControls";
import { IS_MAC } from "../../../platform/tauri/platform";
import { basename } from "../../../platform/tauri/fs";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  MoreHorizontal,
  RotateCcw,
  FileDiff,
  GitBranch,
  LoaderCircle,
  Radar,
  Search,
} from "../../../shared/ui/icons";
import { irgatForSession, irgatLook } from "../../irgats/model/irgat";
import type { HabitApprovalEntry } from "../../irgats/model/habitApprovals";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import type { Session } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../files/ui/ExplorerMenu";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
} from "../../workspace/model/tabGroups";
import {
  FLEET_BUCKETS,
  FLEET_BUCKET_LABEL,
  buildFleet,
  filterFleet,
  type FleetBucket,
  type FleetEntry,
  type FleetRequest,
} from "../model/fleet";

type Props = {
  /** Every open session across all projects. */
  sessions: readonly Session[];
  unseenFinishedIds: ReadonlySet<string>;
  /** Sessions whose agent stopped mid-turn, listed apart so they get resumed. */
  interruptedSessionIds?: ReadonlySet<string>;
  /** Row actions, as the sidebar offers them. */
  actions?: FleetRowActions;
  besideRail?: boolean;
  sidebar?: boolean;
  compactRail?: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  onOpenSession: (sessionId: string) => void;
  onApproval: (
    sessionId: string,
    requestId: number,
    decision: "allow" | "deny",
  ) => void;
  onQuestionReply: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ) => void;
  onQuestionInteraction?: (sessionId: string, requestId: number) => void;
  /** Habit runs across every Irgat waiting on the user's approval. */
  habitApprovals?: readonly HabitApprovalEntry[];
  onHabitApproval?: (
    entry: HabitApprovalEntry,
    decision: "approve" | "skip",
  ) => void;
};

export type FleetRowActions = {
  onStop?: (sessionId: string) => void;
  onArchive?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onBoard?: (sessionId: string) => void;
  /** Sessions that already have a card on the board. */
  boardIds?: ReadonlySet<string>;
};

function fleetMenuItems(
  entry: FleetEntry,
  actions: FleetRowActions,
): ExplorerMenuItem[] {
  return [
    { kind: "item", id: "open", label: "Open" },
    ...(actions.onStop && entry.bucket === "running"
      ? [{ kind: "item" as const, id: "stop", label: "Stop" }]
      : []),
    ...(actions.onBoard
      ? [
          {
            kind: "item" as const,
            id: "board",
            label: actions.boardIds?.has(entry.sessionId)
              ? "Show on Board"
              : "Add to Board",
          },
        ]
      : []),
    ...(actions.onArchive
      ? [{ kind: "item" as const, id: "archive", label: "Archive" }]
      : []),
    ...(actions.onDelete
      ? [
          { kind: "sep" as const },
          {
            kind: "item" as const,
            id: "delete",
            label: "Delete",
            danger: true,
          },
        ]
      : []),
  ];
}

const EMPTY_COPY: Record<FleetBucket, string> = {
  needsYou: "No agent is waiting on you.",
  interrupted: "No session stopped mid-turn.",
  review: "Nothing new to review.",
  running: "No agent is working right now.",
  idle: "No idle sessions.",
};

const BUCKET_TONE: Record<FleetBucket, string> = {
  needsYou: "text-amber-400",
  interrupted: "text-rose-400",
  review: "text-accent",
  running: "text-content/60",
  idle: "text-content/40",
};

function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function FleetView({
  sessions,
  unseenFinishedIds,
  interruptedSessionIds,
  actions,
  besideRail = false,
  sidebar = false,
  compactRail = false,
  onClose,
  onToggleSidebar,
  onOpenSession,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
  habitApprovals = [],
  onHabitApproval,
}: Props) {
  const now = useMinuteClock();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<FleetBucket>>(
    () => new Set(["idle"]),
  );
  const [menu, setMenu] = useState<{
    entry: FleetEntry;
    x: number;
    y: number;
  } | null>(null);
  const fleet = useMemo(() => {
    const labels = loadTabGroupLabels();
    return buildFleet(sessions, {
      now,
      unseenFinishedIds,
      interruptedIds: interruptedSessionIds,
      irgatName: (sessionId) => {
        const irgat = irgatForSession(sessionId);
        return irgat ? irgatLook(irgat).name : undefined;
      },
      projectLabel: (cwd) =>
        resolveTabGroupLabel(projectKey(cwd), labels, projectName(cwd)),
    });
  }, [interruptedSessionIds, now, sessions, unseenFinishedIds]);
  const shown = useMemo(() => filterFleet(fleet, query), [fleet, query]);
  const filtering = query.trim().length > 0;
  const shownHabits = useMemo(
    () => filterHabitApprovals(habitApprovals, query),
    [habitApprovals, query],
  );
  const empty = fleet.total === 0 && habitApprovals.length === 0;

  const toggle = (bucket: FleetBucket) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });

  return (
    <div
      role="region"
      aria-label="Fleet"
      data-app-fleet
      className={
        sidebar
          ? "flex min-h-0 max-h-[40vh] shrink-0 flex-col border-t border-stroke text-content [&_[data-fleet-request]]:flex-col [&_[data-fleet-request]]:items-stretch [&_article>button]:flex-wrap [&_article>button]:gap-1.5 [&_article>button]:px-2"
          : "flex min-h-0 min-w-0 flex-1 flex-col text-content"
      }
    >
      {sidebar ? (
        <div className="px-3 pt-2 text-[12px] text-content/50">Fleet</div>
      ) : (
        <div
          className="flex h-10 shrink-0 select-none items-center border-b border-stroke"
          data-tauri-drag-region="deep"
        >
          {IS_MAC && compactRail ? <div className="w-4 shrink-0" /> : null}
          {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
          {besideRail ? null : (
            <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
            <Radar
              className="size-3.5 shrink-0 text-content/45"
              strokeWidth={1.75}
            />
            <span className="shrink-0 text-content">Fleet</span>
            <span className="hidden truncate text-[12px] text-content/40 sm:inline">
              {fleet.total === 0
                ? "Every project"
                : `${fleet.total} ${fleet.total === 1 ? "session" : "sessions"} across every project`}
            </span>
          </div>
          {!empty ? (
            <label
              className="relative mr-2 flex h-7 w-56 min-w-0 shrink items-center"
              data-tauri-drag-region="false"
            >
              <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    setQuery("");
                  }
                }}
                placeholder="Filter sessions"
                aria-label="Filter sessions"
                spellCheck={false}
                autoComplete="off"
                data-tauri-drag-region="false"
                className="h-7 w-full rounded-md border border-content/10 bg-transparent pl-7 pr-2 text-[12px] text-content outline-none select-text placeholder:text-content/40 focus:border-content/25"
              />
            </label>
          ) : null}
          {IS_MAC ? null : <WindowControls />}
        </div>
      )}
      {empty ? (
        <FleetMessage
          title="No agents yet"
          body="Sessions from every project show up here, sorted by what needs you first: approvals and questions, finished work to review, then what is still running."
        />
      ) : filtering && shown.total === 0 && shownHabits.length === 0 ? (
        <FleetMessage
          title="No sessions match"
          body={`Nothing matches “${query.trim()}”.`}
          action={
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-md bg-content/10 px-2.5 py-1 text-[12px] text-content/80 hover:bg-content/15"
            >
              Clear filter
            </button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            className={
              sidebar
                ? "flex flex-col gap-2 px-2 py-2"
                : "mx-auto flex w-full max-w-4xl flex-col gap-5 px-3 py-4 sm:px-6 sm:py-6"
            }
          >
            {FLEET_BUCKETS.map((bucket) => {
              const entries = shown[bucket];
              const habits = bucket === "needsYou" ? shownHabits : [];
              const count = entries.length + habits.length;
              if (filtering && count === 0) return null;
              const open = filtering || !collapsed.has(bucket);
              return (
                <section
                  key={bucket}
                  aria-label={FLEET_BUCKET_LABEL[bucket]}
                  data-fleet-bucket={bucket}
                  className="flex flex-col gap-2"
                >
                  <button
                    type="button"
                    onClick={() => toggle(bucket)}
                    aria-expanded={open}
                    className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-[12px] font-medium text-content/70 hover:text-content"
                  >
                    {open ? (
                      <ChevronDown className="size-3 opacity-60" />
                    ) : (
                      <ChevronRight className="size-3 opacity-60" />
                    )}
                    <span className={BUCKET_TONE[bucket]}>
                      {FLEET_BUCKET_LABEL[bucket]}
                    </span>
                    <span className="tabular-nums text-content/40">
                      {count}
                    </span>
                  </button>
                  {open ? (
                    count === 0 ? (
                      <p className="pl-6 text-[12px] text-content/35">
                        {EMPTY_COPY[bucket]}
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {habits.map((approval) => (
                          <li
                            key={`habit:${approval.irgatId}:${approval.habit.id}`}
                          >
                            <HabitApprovalCard
                              entry={approval}
                              now={now}
                              onOpen={
                                approval.irgatSessionId
                                  ? () =>
                                      onOpenSession(approval.irgatSessionId!)
                                  : undefined
                              }
                              onDecide={(decision) =>
                                onHabitApproval?.(approval, decision)
                              }
                            />
                          </li>
                        ))}
                        {entries.map((entry) => (
                          <li key={entry.sessionId}>
                            <FleetRow
                              entry={entry}
                              now={now}
                              actions={actions}
                              onMenu={(x, y) => setMenu({ entry, x, y })}
                              onOpen={() => onOpenSession(entry.sessionId)}
                              onApproval={(requestId, decision) =>
                                onApproval(entry.sessionId, requestId, decision)
                              }
                              onQuestionReply={(requestId, reply) =>
                                onQuestionReply(
                                  entry.sessionId,
                                  requestId,
                                  reply,
                                )
                              }
                              onQuestionInteraction={
                                onQuestionInteraction
                                  ? (requestId) =>
                                      onQuestionInteraction(
                                        entry.sessionId,
                                        requestId,
                                      )
                                  : undefined
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )}
      {menu && actions ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={fleetMenuItems(menu.entry, actions)}
          ariaLabel="Session actions"
          onPick={(id) => {
            const sessionId = menu.entry.sessionId;
            setMenu(null);
            if (id === "open") onOpenSession(sessionId);
            else if (id === "stop") actions.onStop?.(sessionId);
            else if (id === "board") actions.onBoard?.(sessionId);
            else if (id === "archive") actions.onArchive?.(sessionId);
            else if (id === "delete") actions.onDelete?.(sessionId);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

function FleetRow({
  entry,
  now,
  actions,
  onMenu,
  onOpen,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
}: {
  entry: FleetEntry;
  now: number;
  actions?: FleetRowActions;
  onMenu: (x: number, y: number) => void;
  onOpen: () => void;
  onApproval: (requestId: number, decision: "allow" | "deny") => void;
  onQuestionReply: (requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (requestId: number) => void;
}) {
  const waiting = entry.bucket === "needsYou";
  return (
    <article
      data-fleet-session={entry.sessionId}
      onContextMenu={
        actions
          ? (event) => {
              event.preventDefault();
              onMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      className={`group relative overflow-hidden rounded-xl border ${
        waiting
          ? "border-amber-400/30 bg-amber-400/[0.04]"
          : "border-content/10 bg-content/[0.02]"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${entry.title}`}
        className="flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-content/5"
      >
        <HarnessIcon harness={entry.harness} className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-content">
              {entry.title}
            </span>
            {entry.unseen ? (
              <span
                aria-label="New"
                className="size-1.5 shrink-0 rounded-full bg-accent"
              />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-content/45">
            <span className="truncate">{entry.projectLabel}</span>
            {entry.branch ? (
              <span className="flex min-w-0 items-center gap-1">
                <GitBranch className="size-3 shrink-0 opacity-70" />
                <span className="truncate">{entry.branch}</span>
              </span>
            ) : null}
            {entry.worktree ? (
              <span className="rounded bg-content/8 px-1 py-px text-[10px] text-content/55">
                worktree
              </span>
            ) : null}
            {entry.leadId ? (
              <span className="rounded bg-content/8 px-1 py-px text-[10px] text-content/55">
                worker
              </span>
            ) : null}
          </span>
        </span>
        {entry.at > 0 ? (
          <span
            className={`shrink-0 text-[11px] tabular-nums text-content/35 ${actions ? "group-hover:invisible" : ""}`}
          >
            {formatLiveElapsed(entry.at, now)} ago
          </span>
        ) : null}
        <ChevronRight className="size-3.5 shrink-0 text-content/35" />
      </button>
      {actions ? (
        <button
          type="button"
          aria-label={`More actions for ${entry.title}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMenu(rect.left, rect.bottom);
          }}
          className="absolute right-9 top-2 grid size-6 place-items-center rounded text-content/45 opacity-0 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      ) : null}
      {entry.bucket === "interrupted" ? (
        <RowDetail>
          <RotateCcw className="size-3 shrink-0 text-rose-400/80" />
          <span className="min-w-0 truncate">
            The agent stopped mid-turn. Open it to resume.
          </span>
        </RowDetail>
      ) : null}
      {entry.bucket === "running" && entry.activity ? (
        <RowDetail>
          <LoaderCircle className="size-3 shrink-0 animate-spin text-content/45" />
          <span className="min-w-0 truncate">{entry.activity}</span>
        </RowDetail>
      ) : null}
      {entry.bucket === "review" ? <ReviewDetail entry={entry} /> : null}
      {entry.requests.map((request) => (
        <RequestCard
          key={`${request.kind}-${request.requestId}`}
          request={request}
          onApproval={onApproval}
          onQuestionReply={onQuestionReply}
          onQuestionInteraction={onQuestionInteraction}
        />
      ))}
    </article>
  );
}

function filterHabitApprovals(
  entries: readonly HabitApprovalEntry[],
  query: string,
): readonly HabitApprovalEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    `${entry.habit.name}\n${entry.irgatName}\n${entry.habit.instructions}`
      .toLocaleLowerCase()
      .includes(needle),
  );
}

/** A habit run that waits for the user before it starts. */
function HabitApprovalCard({
  entry,
  now,
  onOpen,
  onDecide,
}: {
  entry: HabitApprovalEntry;
  now: number;
  onOpen?: () => void;
  onDecide: (decision: "approve" | "skip") => void;
}) {
  const { habit } = entry;
  const trigger =
    habit.trigger?.source === "webhook"
      ? "Started by its trigger"
      : "Due on its schedule";
  return (
    <article
      data-fleet-habit={habit.id}
      className="overflow-hidden rounded-xl border border-amber-400/30 bg-amber-400/[0.04]"
    >
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        aria-label={`Open ${entry.irgatName}`}
        className="flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2.5 text-left enabled:hover:bg-content/5"
      >
        <Clock
          className="size-4 shrink-0"
          style={{ color: entry.color }}
          strokeWidth={1.75}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="min-w-0 truncate text-[13px] font-medium text-content">
            {habit.name}
          </span>
          <span className="truncate text-[11px] text-content/45">
            {entry.irgatName} · habit · {trigger}
          </span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-content/35">
          {formatLiveElapsed(entry.requestedAt, now)} ago
        </span>
        {onOpen ? (
          <ChevronRight className="size-3.5 shrink-0 text-content/35" />
        ) : null}
      </button>
      <div
        data-fleet-request="habit-approval"
        className="flex flex-col gap-2 border-t border-stroke px-3.5 py-2.5 sm:flex-row sm:items-center"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-content/80">
            <CircleAlert className="size-3.5 shrink-0 text-amber-400" strokeWidth={1.75} />
            <span className="min-w-0 truncate">Run this habit now?</span>
          </span>
          <span className="line-clamp-2 text-[11px] leading-relaxed text-content/50">
            {habit.instructions}
          </span>
        </span>
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            className="flex-1 rounded-md bg-content px-3 py-1 text-[12px] font-medium text-background-base hover:bg-content/80 sm:flex-none"
            onClick={() => onDecide("approve")}
          >
            Approve
          </button>
          <button
            type="button"
            className="flex-1 rounded-md bg-content/10 px-3 py-1 text-[12px] font-medium text-content/70 hover:bg-content/20 sm:flex-none"
            onClick={() => onDecide("skip")}
          >
            Skip
          </button>
        </span>
      </div>
    </article>
  );
}

function RowDetail({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-stroke px-3.5 py-2 text-[12px] text-content/60">
      {children}
    </div>
  );
}

function ReviewDetail({ entry }: { entry: FleetEntry }) {
  const files = entry.editedPaths.length;
  const parts = [
    files ? `${files} ${files === 1 ? "file" : "files"} changed` : "",
    entry.artifacts
      ? `${entry.artifacts} ${entry.artifacts === 1 ? "artifact" : "artifacts"}`
      : "",
  ].filter(Boolean);
  const names = entry.editedPaths.slice(0, 3).map((path) => basename(path));
  return (
    <RowDetail>
      <FileDiff className="size-3 shrink-0 text-accent" />
      <span className="shrink-0">{parts.join(" · ")}</span>
      {names.length ? (
        <span className="min-w-0 truncate font-mono text-[11px] text-content/40">
          {names.join(", ")}
          {files > names.length ? `, +${files - names.length}` : ""}
        </span>
      ) : null}
    </RowDetail>
  );
}

function RequestCard({
  request,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
}: {
  request: FleetRequest;
  onApproval: (requestId: number, decision: "allow" | "deny") => void;
  onQuestionReply: (requestId: number, reply: UserQuestionReply) => void;
  onQuestionInteraction?: (requestId: number) => void;
}) {
  if (request.kind === "question") {
    return (
      <div
        data-fleet-request="question"
        className="border-t border-stroke px-3.5 py-3"
      >
        <QuestionForm
          prompt={request.prompt}
          onReply={onQuestionReply}
          onInteraction={onQuestionInteraction}
        />
      </div>
    );
  }
  return (
    <div
      data-fleet-request="approval"
      className="flex flex-col gap-2 border-t border-stroke px-3.5 py-2.5 sm:flex-row sm:items-center"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-content/80">
          <CircleAlert className="size-3.5 shrink-0 text-amber-400" strokeWidth={1.75} />
          <span className="min-w-0 truncate">{request.label}</span>
        </span>
        {request.detail ? (
          <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-content/5 px-2 py-1 font-mono text-[11px] leading-relaxed text-content/70 select-text">
            {request.detail}
          </code>
        ) : null}
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          className="flex-1 rounded-md bg-content px-3 py-1 text-[12px] font-medium text-background-base hover:bg-content/80 sm:flex-none"
          onClick={() => onApproval(request.requestId, "allow")}
        >
          Allow
        </button>
        <button
          type="button"
          className="flex-1 rounded-md bg-content/10 px-3 py-1 text-[12px] font-medium text-content/70 hover:bg-content/20 sm:flex-none"
          onClick={() => onApproval(request.requestId, "deny")}
        >
          Deny
        </button>
      </span>
    </div>
  );
}

function FleetMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 pb-12 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-content/5">
        <Radar className="size-5 text-content/35" strokeWidth={1.5} />
      </span>
      <p className="mt-1 text-[13px] font-medium text-content/85">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-content/50">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
