import { useEffect, useRef, useState, type ReactNode } from "react";
import { LIST_PAGE_SIZE, listWindowSize } from "../../../shared/lib/listWindow";
import { projectName } from "../../../shared/lib/paths";
import { IconButton } from "../../../app/shell/TitleBar";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  PanelRightToggle,
  Search,
} from "../../../shared/ui/icons";
import { fleetActivity } from "../../fleet/model/fleet";
import {
  getSession,
  listSessionsByProject,
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import {
  filterSessionsByArchive,
  filterSessionsByQuery,
  summaryFromSession,
} from "../../sessions/data/sessionHistory";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  filterSessionsByHarness,
  hasActiveSessionFilters,
  filterSessionsByStatus,
  filterSessionsByTime,
  type SessionSidebarFilters,
} from "../../sessions/model/sessionFilters";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { isRemoteProjectPath } from "../../projects/model/recents";
import {
  hasPendingApproval,
  type IrgatSpawnedSession,
  type Session,
} from "../../sessions/model/session";
import { SessionCard, SessionRenameRow } from "../../../app/shell/Sidebar";
import {
  ExplorerMenu,
  type ExplorerMenuItem,
} from "../../files/ui/ExplorerMenu";
import type { IrgatLook } from "../model/irgat";
import { EmptyState, PageHeader } from "./irgatPanelParts";

/** A launched session open over the overview, live and fully usable. */
export type ShownIrgatSession = {
  sessionId: string;
  title: string;
  /** The session's pane. */
  pane: ReactNode;
};

/**
 * Saved sessions already looked up, kept across lists. Switching Irgats
 * remounts the overview, and its cards should come back as they were rather
 * than reload from blank.
 */
const storedSessions = new Map<string, SessionSummary>();

/** What the sidebar's session cards can do and show, for the same cards here. */
export type IrgatSessionActions = {
  /** Finished sessions the user has not looked at yet. */
  unseenIds?: ReadonlySet<string>;
  interruptedIds?: ReadonlySet<string>;
  onRename?: (sessionId: string, title: string) => void;
  onArchive?: (sessionId: string, archived: boolean) => void;
  onDelete?: (sessionId: string) => void;
};

const LAUNCH_GROUPS = ["needsYou", "working", "done"] as const;
type LaunchGroup = (typeof LAUNCH_GROUPS)[number];
const LAUNCH_GROUP_LABEL: Record<LaunchGroup, string> = {
  needsYou: "Waiting on you",
  working: "Working",
  done: "Done",
};
const LAUNCH_GROUP_TONE: Record<LaunchGroup, string> = {
  needsYou: "text-amber-400",
  working: "text-content/60",
  done: "text-content/40",
};

/** Cards for launched sessions, with where each stands, open or saved. */
export function IrgatSessionList({
  agent,
  launches,
  sessions,
  history = [],
  query = "",
  filters = DEFAULT_SESSION_SIDEBAR_FILTERS,
  onOpenSession,
  actions = {},
}: {
  agent: IrgatLook;
  launches: readonly IrgatSpawnedSession[];
  sessions: readonly Session[];
  history?: readonly SessionSummary[];
  /** Narrows the cards as the sidebar's session search does. */
  query?: string;
  filters?: SessionSidebarFilters;
  onOpenSession: (sessionId: string) => void | Promise<void>;
  actions?: IrgatSessionActions;
}) {
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const launchesKey = JSON.stringify(
    launches.map((entry) => [entry.sessionId, entry.cwd]),
  );
  // Refresh saved status when a launched session closes, archives or moves.
  const liveSessionsKey = JSON.stringify(
    launches.map((launch) => {
      const session = sessions.find((entry) => entry.id === launch.sessionId);
      return session ? [session.id, session.cwd] : null;
    }),
  );
  const [stored, setStored] = useState<{
    byId: Map<string, SessionSummary>;
    loaded: Set<string>;
    failed: Set<string>;
  }>(() => ({
    byId: new Map(
      launches.flatMap((launch) => {
        const known = storedSessions.get(launch.sessionId);
        return known ? [[launch.sessionId, known] as const] : [];
      }),
    ),
    loaded: new Set(),
    failed: new Set(),
  }));
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    // Sessions on another machine live in its host, not this computer's
    // store, so they always stand in from their launch.
    const refs: [string, string][] = (
      JSON.parse(launchesKey) as [string, string][]
    ).filter(([, cwd]) => !isRemoteProjectPath(cwd));
    const projects = [...new Set(refs.map(([, cwd]) => cwd))];
    void Promise.allSettled(
      projects.map((cwd) => listSessionsByProject(cwd)),
    ).then(async (results) => {
      if (cancelled) return;
      const byId = new Map<string, SessionSummary>();
      const loaded = new Set<string>();
      const failed = new Set<string>();
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") {
          failed.add(projects[index]);
          return;
        }
        loaded.add(projects[index]);
        result.value.forEach((session) => byId.set(session.id, session));
      });
      // Project membership can change after launch; the session id stays stable.
      const missing = refs.filter(
        ([id, cwd]) => !byId.has(id) && loaded.has(cwd),
      );
      const restored = await Promise.allSettled(
        missing.map(([id]) => getSession(id)),
      );
      if (cancelled) return;
      restored.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          byId.set(result.value.id, summaryFromSession(result.value));
        } else if (result.status === "rejected") {
          loaded.delete(missing[index][1]);
          failed.add(missing[index][1]);
        }
      });
      for (const [id, summary] of byId) storedSessions.set(id, summary);
      setStored({ byId, loaded, failed });
    });
    return () => {
      cancelled = true;
    };
  }, [launchesKey, liveSessionsKey]);

  const open = async (id: string) => {
    setOpening(id);
    setError(undefined);
    try {
      await onOpenSession(id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open this session.",
      );
    } finally {
      setOpening(undefined);
    }
  };

  const projectLabel = (cwd: string) =>
    agent.projects.find((project) => project.path === cwd)?.name ??
    projectName(cwd);
  // Each launch as the sidebar would list it, so its search and filters
  // apply as they do there. One not yet looked up stands in from its launch.
  const rows = launches.map((launch): SessionSummary => {
    const live = sessions.find((entry) => entry.id === launch.sessionId);
    const saved =
      history.find((entry) => entry.id === launch.sessionId) ??
      stored.byId.get(launch.sessionId);
    if (live)
      return {
        ...saved,
        ...summaryFromSession(live, saved),
        updatedAt: saved?.updatedAt ?? Date.now(),
      };
    return (
      saved ?? {
        id: launch.sessionId,
        cwd: launch.cwd,
        harness: launch.harness,
        model: launch.model,
        runtimeMode: "auto",
        title: launch.title,
        createdAt: 0,
        updatedAt: 0,
      }
    );
  });
  // Launched, then deleted: its project's sessions are known, and it is not
  // among them.
  const unavailableIds = new Set(
    launches
      .filter(
        (launch) =>
          stored.loaded.has(launch.cwd) &&
          !sessions.some((entry) => entry.id === launch.sessionId) &&
          !history.some((entry) => entry.id === launch.sessionId) &&
          !stored.byId.has(launch.sessionId),
      )
      .map((launch) => launch.sessionId),
  );
  const busyIds = new Set<string>();
  const approvalIds = new Set<string>();
  const doneIds = new Set<string>();
  for (const row of rows) {
    const live = sessions.find((entry) => entry.id === row.id);
    if (live?.busy) busyIds.add(row.id);
    else if (live && (hasPendingApproval(live.blocks) || live.pendingQuestion))
      approvalIds.add(row.id);
    else if (live || row.createdAt) doneIds.add(row.id);
  }
  const filtered = filterSessionsByStatus(
    filterSessionsByTime(
      filterSessionsByHarness(
        // Archived launches stay with the rest; the filter narrows to them.
        // Deleted ones are hidden unless the filter asks for just them.
        (filters.showArchived
          ? filterSessionsByArchive(rows, true)
          : rows
        ).filter(
          (row) => unavailableIds.has(row.id) === !!filters.showUnavailable,
        ),
        filters.hiddenHarnesses,
      ),
      filters.time,
      Date.now(),
    ),
    filters.status,
    busyIds,
    approvalIds,
    doneIds,
  );
  // The project a session runs in is on its card, so it is searched too.
  const needle = query.trim();
  const matched = new Set(
    needle
      ? [
          ...filterSessionsByQuery(filtered, needle),
          ...filtered.filter(
            (row) => fuzzyMatch(needle, projectLabel(row.cwd)) != null,
          ),
        ].map((row) => row.id)
      : filtered.map((row) => row.id),
  );
  // Grouped as the Fleet is: what waits on the user, what is still working,
  // then what has finished.
  const groupOf = (id: string): LaunchGroup =>
    approvalIds.has(id) ? "needsYou" : busyIds.has(id) ? "working" : "done";
  const matching = LAUNCH_GROUPS.flatMap((group) =>
    launches.filter(
      (launch) =>
        matched.has(launch.sessionId) && groupOf(launch.sessionId) === group,
    ),
  );
  const counts = Object.fromEntries(
    LAUNCH_GROUPS.map((group) => [
      group,
      matching.filter((launch) => groupOf(launch.sessionId) === group).length,
    ]),
  ) as Record<LaunchGroup, number>;
  // Finished ones fold away while others are going, as resolved threads do,
  // unless the user opened or closed a group themselves.
  const [toggled, setToggled] = useState<Partial<Record<LaunchGroup, boolean>>>(
    {},
  );
  const isOpen = (group: LaunchGroup) =>
    toggled[group] ??
    !(group === "done" && counts.needsYou + counts.working > 0);
  // A page of cards mounts at a time, as in the sidebar; the sentinel below
  // asks for the next one as it nears the panel's bottom. Searching or
  // filtering starts over from the first page.
  const [limit, setLimit] = useState(LIST_PAGE_SIZE);
  const list = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLDivElement>(null);
  const listKey = `${needle}\0${JSON.stringify(filters)}`;
  useEffect(() => {
    setLimit(LIST_PAGE_SIZE);
    const scroller = scrollParent(list.current);
    if (scroller) scroller.scrollTop = 0;
  }, [listKey]);
  const visible =
    needle || hasActiveSessionFilters(filters)
      ? matching
      : matching.filter((launch) => isOpen(groupOf(launch.sessionId)));
  const shown = visible.slice(0, listWindowSize(visible.length, limit));
  const hasMore = shown.length < visible.length;
  useEffect(() => {
    const sentinel = loadMore.current;
    if (!hasMore || !sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting)
          setLimit((current) => current + LIST_PAGE_SIZE);
      },
      { root: scrollParent(sentinel), rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, shown.length]);

  const hasActions = !!(
    actions.onRename ||
    actions.onArchive ||
    actions.onDelete
  );
  const menuSession = menu
    ? (sessions.find((entry) => entry.id === menu.id) ??
      history.find((entry) => entry.id === menu.id) ??
      stored.byId.get(menu.id))
    : undefined;
  const archived = !!(
    menuSession &&
    "archived" in menuSession &&
    menuSession.archived
  );
  const menuItems: ExplorerMenuItem[] = [
    ...(actions.onRename
      ? [{ kind: "item" as const, id: "rename", label: "Rename" }]
      : []),
    ...(actions.onArchive
      ? [
          {
            kind: "item" as const,
            id: "archive",
            label: archived ? "Unarchive" : "Archive",
          },
        ]
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
  const onPick = (action: string) => {
    if (!menu) return;
    if (action === "rename") setRenaming(menu.id);
    else if (action === "archive") actions.onArchive?.(menu.id, !archived);
    else if (action === "delete") actions.onDelete?.(menu.id);
    setMenu(undefined);
  };
  const actionMenu = menu ? (
    <ExplorerMenu
      x={menu.x}
      y={menu.y}
      items={menuItems}
      ariaLabel="Session actions"
      onPick={onPick}
      onClose={() => setMenu(undefined)}
    />
  ) : null;

  if (launches.length > 0 && matching.length === 0)
    return (
      <EmptyState icon={Search}>
        {needle
          ? "No sessions match this search."
          : hasActiveSessionFilters(filters)
            ? "No sessions match these filters."
            : // Every one it started is gone; the filter still lists them.
              `The sessions ${agent.name} started have since been deleted.`}
      </EmptyState>
    );

  const filtering = !!needle || hasActiveSessionFilters(filters);
  const renderLaunch = (launch: IrgatSpawnedSession) => {
    const live = sessions.find((entry) => entry.id === launch.sessionId);
    const saved =
      history.find((entry) => entry.id === launch.sessionId) ??
      stored.byId.get(launch.sessionId);
    // Once it is known, it gets the sidebar's own card: model, status,
    // title, branch or worktree, and any linked PR or issue.
    const summary: SessionSummary | undefined = live
      ? {
          ...saved,
          ...summaryFromSession(live, saved),
          updatedAt: saved?.updatedAt ?? Date.now(),
        }
      : saved;
    if (summary) {
      const needsApproval =
        !!live && (hasPendingApproval(live.blocks) || !!live.pendingQuestion);
      return (
        <div key={launch.sessionId} data-irgat-session={launch.sessionId}>
          {renaming === launch.sessionId && actions.onRename ? (
            <SessionRenameRow
              session={summary}
              isActive={false}
              needsApproval={needsApproval}
              onCommit={(title) => {
                setRenaming(undefined);
                actions.onRename?.(launch.sessionId, title);
              }}
              onCancel={() => setRenaming(undefined)}
            />
          ) : (
            <SessionCard
              session={summary}
              modelInFooter
              activity={
                live?.busy && !needsApproval ? fleetActivity(live) : undefined
              }
              isActive={false}
              isSelected={false}
              busy={!!live?.busy}
              done={!!actions.unseenIds?.has(launch.sessionId)}
              linkedUpdate={false}
              needsApproval={needsApproval}
              interrupted={!!actions.interruptedIds?.has(launch.sessionId)}
              project={
                agent.projects.find((project) => project.path === summary.cwd)
                  ?.name ?? projectName(summary.cwd)
              }
              now={Date.now()}
              onSelect={(id, event) => {
                if (!opening && !repeatClick(event)) void open(id);
              }}
              onContextMenu={
                hasActions
                  ? (id, event) => {
                      event.preventDefault();
                      setMenu({ id, x: event.clientX, y: event.clientY });
                    }
                  : undefined
              }
              onArchive={actions.onArchive}
              onRename={actions.onRename ? setRenaming : undefined}
              onDelete={actions.onDelete}
            />
          )}
        </div>
      );
    }
    // Not known, either deleted or not looked up: the sidebar's card
    // still, from what the launch recorded.
    const unavailable = unavailableIds.has(launch.sessionId);
    const failed = !unavailable && stored.failed.has(launch.cwd);
    // One on another machine is listed by its host: open it there.
    const remote = isRemoteProjectPath(launch.cwd);
    const loading = !unavailable && !failed && !remote;
    return (
      <div
        key={launch.sessionId}
        data-irgat-session={loading ? undefined : launch.sessionId}
        data-irgat-session-loading={loading ? launch.sessionId : undefined}
        data-irgat-session-unavailable={unavailable ? "" : undefined}
        // Until it is known, hold its place without a card of another
        // look that the real one would replace a moment later.
        aria-hidden={loading || undefined}
        aria-disabled={unavailable || undefined}
        inert={loading || unavailable}
        className={loading ? "invisible" : unavailable ? "opacity-50" : ""}
      >
        <SessionCard
          session={{
            id: launch.sessionId,
            cwd: launch.cwd,
            harness: launch.harness,
            model: launch.model,
            runtimeMode: "auto",
            title: launch.title,
            createdAt: 0,
            updatedAt: 0,
          }}
          modelInFooter
          statusLabel={
            unavailable
              ? "Unavailable"
              : opening === launch.sessionId
                ? "Opening…"
                : failed
                  ? "Status unavailable"
                  : ""
          }
          isActive={false}
          isSelected={false}
          busy={false}
          done={false}
          linkedUpdate={false}
          needsApproval={false}
          project={projectLabel(launch.cwd)}
          now={0}
          onSelect={(id, event) => {
            if ((failed || remote) && !opening && !repeatClick(event))
              void open(id);
          }}
        />
      </div>
    );
  };

  return (
    <div ref={list}>
      <div className="flex flex-col gap-3">
        {LAUNCH_GROUPS.map((group) => {
          const count = counts[group];
          if (count === 0) return null;
          const open = filtering || isOpen(group);
          const cards = shown.filter(
            (launch) => groupOf(launch.sessionId) === group,
          );
          return (
            <section
              key={group}
              aria-label={LAUNCH_GROUP_LABEL[group]}
              data-irgat-session-group={group}
              className="flex flex-col gap-1"
            >
              <button
                type="button"
                onClick={() =>
                  setToggled((previous) => ({ ...previous, [group]: !open }))
                }
                aria-expanded={open}
                className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-[12px] font-medium text-content/70 hover:text-content"
              >
                {open ? (
                  <ChevronDown className="size-3 opacity-60" />
                ) : (
                  <ChevronRight className="size-3 opacity-60" />
                )}
                <span className={LAUNCH_GROUP_TONE[group]}>
                  {LAUNCH_GROUP_LABEL[group]}
                </span>
                <span className="tabular-nums text-content/40">{count}</span>
              </button>
              {open ? cards.map(renderLaunch) : null}
            </section>
          );
        })}
      </div>
      {hasMore ? <div ref={loadMore} aria-hidden className="h-px" /> : null}
      {error ? (
        <p role="alert" className="px-1 pt-3 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      {actionMenu}
    </div>
  );
}

/**
 * The second click of a double-click. Clicking the shown session again hides
 * it, so a double-click would open it and close it at once.
 */
function repeatClick(event: object): boolean {
  return (
    "detail" in event && typeof event.detail === "number" && event.detail > 1
  );
}

/** The nearest ancestor that scrolls, which the list pages against. */
function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

/** A launched session open over the overview, live and fully usable. */
export function LaunchedSessionPage({
  title,
  onBack,
  onOpenInWorkspace,
  onClose,
  children,
}: {
  title: string;
  onBack: () => void;
  onOpenInWorkspace: () => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [error, setError] = useState<string>();
  return (
    <>
      <PageHeader title={title} onBack={onBack}>
        <IconButton
          label="Open in workspace"
          onClick={() => {
            setError(undefined);
            void Promise.resolve(onOpenInWorkspace()).catch((cause) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not open this session.",
              ),
            );
          }}
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Hide overview" active onClick={onClose}>
          <PanelRightToggle className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      </PageHeader>
      {error ? (
        <p role="alert" className="px-4 pt-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}
      <div
        data-irgat-launched-session=""
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {children}
      </div>
    </>
  );
}
