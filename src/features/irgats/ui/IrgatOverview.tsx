import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import {
  Artifacts,
  Clock,
  DashboardSquare,
  File,
  FileDiff,
  FolderTree,
  ListFilter,
  MessageMultiple,
  PanelRightToggle,
  Plus,
  Search,
  Settings,
} from "../../../shared/ui/icons";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import type { ArtifactCard } from "../../artifacts/artifacts";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import type { IrgatSpawnedSession, Session } from "../../sessions/model/session";
import type { IrgatLook, IrgatState } from "../model/irgat";
import { HABITS_MAX, habitRunSessionId } from "../model/irgatHabits";
import {
  INITIAL_OVERVIEW_LIMITS,
  showMoreInSection,
} from "../model/overviewSections";
import { HabitPage } from "./HabitPage";
import { NewHabitPage } from "./NewHabitPage";
import { MemoryPage, SoulPage, useIrgatFiles } from "./IrgatFilePages";
import { IrgatSettings, type IrgatSettingsControls } from "./IrgatSettings";
import {
  confirmHabitRemoval,
  habitActions,
  HabitsList,
  useHabitsLoad,
} from "./IrgatHabits";
import { ArtifactReader } from "../../artifacts/ui/ArtifactPanel";
import { useIrgatArtifacts } from "../../artifacts/hooks/useArtifacts";
import { getRegisteredArtifact } from "../../artifacts/model/artifactRegistry";
import { ArtifactDetail } from "../../artifacts/ui/ArtifactDetail";
import { ArtifactsList } from "../../artifacts/ui/ArtifactsList";
import { irgatArtifactScope } from "../../artifacts/model/pinnedArtifacts";
import { DocumentRow } from "./DocumentRow";
import { IrgatOverviewAll } from "./IrgatOverviewAll";
import {
  LaunchedSessionPage,
  IrgatSessionList,
  type IrgatSessionActions,
  type ShownIrgatSession,
} from "./IrgatSessionList";
import { EmptyState, PageHeader } from "./irgatPanelParts";
import { PanelStack, type StackPage } from "./PanelStack";
import { SessionFiltersMenu } from "../../sessions/ui/SessionFiltersMenu";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  hasActiveSessionFilters,
  type SessionSidebarFilters,
} from "../../sessions/model/sessionFilters";
import { HARNESSES, type HarnessId } from "../../sessions/model/session";
import { IrgatSidebar, IrgatSidebarHeader } from "./IrgatSidebar";
import type { SessionChangeTotals } from "../../sessions/ui/SessionReview";
import { IrgatChangesView, type IrgatChangesRequest } from "./IrgatChangesView";
import {
  AgentTreeView,
  type AgentRetryRequest,
} from "../../agent-tree/ui/AgentTreeView";
import type { LaunchRecord } from "../../agent-tree/model/agentTree";

export type IrgatOverviewTab =
  | "all"
  | "sessions"
  | "agents"
  | "habits"
  | "documents"
  | "artifacts"
  | "changes"
  | "settings";

const TABS: { id: IrgatOverviewTab; label: string; icon: typeof Clock }[] = [
  { id: "all", label: "All", icon: DashboardSquare },
  { id: "sessions", label: "Sessions", icon: MessageMultiple },
  { id: "documents", label: "Documents", icon: File },
  { id: "habits", label: "Habits", icon: Clock },
  { id: "changes", label: "Changes", icon: FileDiff },
  { id: "artifacts", label: "Artifacts", icon: Artifacts },
  { id: "agents", label: "Agents", icon: FolderTree },
  { id: "settings", label: "Settings", icon: Settings },
];

/** The conversation's recorded changes, reviewed and committed on their tab. */
export type IrgatOverviewChanges = {
  sessionId: string;
  cwd: string;
  /** Null while the conversation has no changes. */
  totals: SessionChangeTotals | null;
  request: IrgatChangesRequest;
  textHarness?: HarnessId;
  /** The projects the Irgat works on. */
  projects: readonly string[];
};

type Route =
  | { kind: "new-habit" }
  | { kind: "habit"; id: string }
  | { kind: "soul" }
  | { kind: "memory" };

function sameRoute(a: Route | undefined, b: Route): boolean {
  if (!a || a.kind !== b.kind) return false;
  return b.kind !== "habit" || (a.kind === "habit" && a.id === b.id);
}

type Props = {
  open: boolean;
  irgatId: string;
  /** Its conversation's folder, which habits run in. */
  cwd: string;
  agent: IrgatLook;
  state: IrgatState;
  /** Every session it has started, oldest first. */
  launches: readonly IrgatSpawnedSession[];
  sessions: readonly Session[];
  history?: readonly SessionSummary[];
  /** Documents it has written, oldest first. */
  documents: readonly ArtifactCard[];
  changes?: IrgatOverviewChanges;
  /** Its model, permissions and conversation, for the Settings tab. */
  settings?: IrgatSettingsControls;
  tab: IrgatOverviewTab;
  onTabChange: (tab: IrgatOverviewTab) => void;
  onOpenSession: (sessionId: string) => void | Promise<void>;
  /** Rename, archive and delete for its session cards, as in the sidebar. */
  sessionActions?: IrgatSessionActions;
  /** A session it started, open over the list until Back. */
  shownSession?: ShownIrgatSession;
  onBackFromSession?: () => void;
  onOpenSessionInWorkspace?: (sessionId: string) => void | Promise<void>;
  /** A document it wrote, open over the list until Back. */
  shownDocumentId?: string;
  onBackFromDocument?: () => void;
  onOpenFile?: (path: string) => void;
  onOpenDocument: (id: string) => void;
  /** Its own conversation, whose artifacts lead the Artifacts tab. */
  irgatSessionId?: string;
  /** An artifact open over the list until Back. */
  shownArtifactId?: string;
  onOpenArtifact?: (id: string) => void;
  onBackFromArtifact?: () => void;
  onClose: () => void;
  windowControls?: ReactNode;
  /** Starts the session a failed agent's Retry asks for, on the Agents tab. */
  onRetryAgent?: (request: AgentRetryRequest) => Promise<void>;
};

/**
 * The Irgat's work at a glance: the sessions it started, its habits and the
 * documents it wrote, together on All or each on its own tab. Who it is and
 * how it works live on its Settings tab, with its soul and memory under it.
 */
export function IrgatOverview({
  open,
  irgatId,
  cwd,
  agent,
  state,
  launches,
  sessions,
  history,
  documents,
  changes,
  settings,
  tab,
  onTabChange,
  onOpenSession,
  sessionActions,
  shownSession,
  onBackFromSession = () => {},
  onOpenSessionInWorkspace = () => {},
  shownDocumentId,
  onBackFromDocument = () => {},
  onOpenFile,
  onOpenDocument,
  irgatSessionId,
  shownArtifactId,
  onOpenArtifact = () => {},
  onBackFromArtifact = () => {},
  onClose,
  windowControls,
  onRetryAgent,
}: Props) {
  const lock = useLockOverscroll<HTMLDivElement>();
  const habitsLoad = useHabitsLoad(irgatId, state.status);
  const habits = habitsLoad.habits;
  const actions = habitActions(irgatId);
  const files = useIrgatFiles(irgatId, state.status);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SessionSidebarFilters>(
    DEFAULT_SESSION_SIDEBAR_FILTERS,
  );
  const [limits, setLimits] = useState(INITIAL_OVERVIEW_LIMITS);
  // Once opened, the changes stay mounted so a commit draft survives a look
  // at another tab.
  const [changesVisited, setChangesVisited] = useState(tab === "changes");
  if (tab === "changes" && !changesVisited) setChangesVisited(true);
  // Another Irgat starts at its own front page, with all its sessions.
  useEffect(() => {
    setRoutes([]);
    setQuery("");
    setFilters(DEFAULT_SESSION_SIDEBAR_FILTERS);
    setLimits(INITIAL_OVERVIEW_LIMITS);
  }, [irgatId]);
  const launchedIds = useMemo(
    () => launches.map((launch) => launch.sessionId),
    [launches],
  );
  const artifacts = useIrgatArtifacts({
    irgatId,
    sessionId: irgatSessionId,
    launchedIds,
    sessions,
    history,
    enabled: open && tab === "artifacts",
  });
  // A second click on the same row or `+` before the page slides in would
  // otherwise stack the same page twice.
  const push = (route: Route) =>
    setRoutes((current) =>
      sameRoute(current[current.length - 1], route)
        ? current
        : [...current, route],
    );
  const back = () => setRoutes((current) => current.slice(0, -1));

  const pages: StackPage[] = routes.flatMap((route, depth): StackPage[] => {
    if (route.kind === "soul")
      return [
        {
          key: "soul",
          node: (
            <SoulPage irgatId={irgatId} agent={agent} files={files} onBack={back} />
          ),
        },
      ];
    if (route.kind === "memory")
      return [
        {
          key: "memory",
          node: <MemoryPage irgatId={irgatId} files={files} onBack={back} />,
        },
      ];
    if (route.kind === "new-habit")
      return [
        {
          key: "new-habit",
          node: <NewHabitPage irgatId={irgatId} onBack={back} onCreated={back} />,
        },
      ];
    // A habit removed while open closes its page.
    const habit = habits?.find((entry) => entry.id === route.id);
    if (!habit) return [];
    return [
      {
        key: `habit:${route.id}:${depth}`,
        node: (
          <HabitPage
            habit={habit}
            runSession={sessions.find(
              (session) => session.id === habitRunSessionId(habit.id),
            )}
            color={agent.color}
            cwd={cwd}
            onBack={back}
            onRunNow={() => actions.runNow(habit.id)}
            onToggle={() => actions.toggle(habit.id)}
            onRemove={() => {
              if (!confirmHabitRemoval(habit.name)) return;
              actions.remove(habit.id);
              back();
            }}
            guards={{
              onApprove: () => actions.approve(habit.id),
              onSkip: () => actions.skip(habit.id),
              onGuardsChange: (settings) =>
                actions.setGuards(habit.id, settings),
              onTriggerTokenChange: (token) =>
                actions.setTriggerToken(habit.id, token),
            }}
          />
        ),
      },
    ];
  });

  // What the overview opened goes on top of everything, the way it would
  // from the list beneath.
  if (shownSession)
    pages.push({
      key: `session:${shownSession.sessionId}`,
      node: (
        <LaunchedSessionPage
          title={shownSession.title}
          onBack={onBackFromSession}
          onOpenInWorkspace={() =>
            onOpenSessionInWorkspace(shownSession.sessionId)
          }
          onClose={onClose}
        >
          {shownSession.pane}
        </LaunchedSessionPage>
      ),
    });
  if (shownDocumentId)
    pages.push({
      key: `document:${shownDocumentId}`,
      node: (
        <div className="flex min-h-0 flex-1 flex-col" data-irgat-document-page>
          <ArtifactReader
            key={shownDocumentId}
            id={shownDocumentId}
            onBack={onBackFromDocument}
            onClose={onClose}
            onOpenFile={onOpenFile}
          />
        </div>
      ),
    });

  const shownArtifact = shownArtifactId
    ? (artifacts.artifacts.find((entry) => entry.id === shownArtifactId) ??
      getRegisteredArtifact(shownArtifactId))
    : undefined;
  if (shownArtifact)
    pages.push({
      key: `artifact:${shownArtifact.id}`,
      node: (
        <div className="flex min-h-0 flex-1 flex-col" data-irgat-artifact-page>
          <ArtifactDetail
            artifact={shownArtifact}
            header={
              <PageHeader title={shownArtifact.title} onBack={onBackFromArtifact}>
                <IconButton label="Hide overview" active onClick={onClose}>
                  <PanelRightToggle className="size-3.5" strokeWidth={1.75} />
                </IconButton>
              </PageHeader>
            }
          />
        </div>
      ),
    });

  const habitsFull = !habits || habits.length >= HABITS_MAX;
  const counts: Record<IrgatOverviewTab, number | undefined> = {
    all: undefined,
    sessions: launches.length,
    agents: undefined,
    habits: habits?.length,
    documents: documents.length,
    artifacts: artifacts.artifacts.length,
    changes: changes?.totals?.files,
    settings: undefined,
  };

  return (
    <IrgatSidebar
      open={open}
      kind="details"
      label={`${agent.name} overview`}
      color={agent.color}
      windowControls={windowControls}
    >
      <PanelStack pages={pages}>
        {/* Pages replace this header too, keeping their back button at the top. */}
        <IrgatSidebarHeader
          title="Overview"
          heading={
            <OverviewTabs
              tab={tab}
              counts={counts}
              onChange={onTabChange}
            />
          }
          onClose={onClose}
          actions={
            tab === "habits" ? (
              <IconButton
                label={
                  habits && habits.length >= HABITS_MAX
                    ? `At most ${HABITS_MAX} habits`
                    : "New habit"
                }
                disabled={habitsFull}
                onClick={() => push({ kind: "new-habit" })}
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            ) : null
          }
        />
        {tab === "sessions" && launches.length ? (
          <SessionSearchBar
            query={query}
            onQueryChange={setQuery}
            filters={filters}
            onFiltersChange={setFilters}
            harnesses={HARNESSES.filter((harness) =>
              launches.some((launch) => launch.harness === harness),
            )}
          />
        ) : null}
        {changes && changesVisited ? (
          <div
            role="tabpanel"
            aria-label="Changes"
            hidden={tab !== "changes"}
            className="flex min-h-0 flex-1 flex-col"
            data-irgat-overview={tab === "changes" ? "changes" : undefined}
          >
            <IrgatChangesView
              sessionId={changes.sessionId}
              cwd={changes.cwd}
              request={changes.request}
              textHarness={changes.textHarness}
              agentName={agent.name}
              attachedProjects={changes.projects}
            />
          </div>
        ) : null}
        {tab === "settings" && settings ? (
          <div
            role="tabpanel"
            aria-label="Settings"
            className="flex min-h-0 flex-1 flex-col"
            data-irgat-overview="settings"
          >
            <IrgatSettings
              key={irgatId}
              irgatId={irgatId}
              agent={agent}
              files={files}
              onOpenPage={(page) => push({ kind: page })}
              {...settings}
            />
          </div>
        ) : null}
        {tab === "agents" && irgatSessionId ? (
          <div
            role="tabpanel"
            aria-label="Agents"
            className="flex min-h-0 flex-1 flex-col"
            data-irgat-overview="agents"
          >
            <IrgatAgentTree
              irgatSessionId={irgatSessionId}
              name={agent.name}
              launches={launches}
              sessions={sessions}
              history={history}
              interruptedIds={sessionActions?.interruptedIds}
              onOpenSession={(sessionId) => void onOpenSession(sessionId)}
              onRetry={onRetryAgent}
            />
          </div>
        ) : null}
        {tab === "artifacts" ? (
          <div
            role="tabpanel"
            aria-label="Artifacts"
            className="flex min-h-0 flex-1 flex-col"
            data-irgat-overview="artifacts"
          >
            <ArtifactsList
              artifacts={artifacts.artifacts}
              selectedId={shownArtifactId}
              onOpen={(artifact) => onOpenArtifact(artifact.id)}
              loading={artifacts.loading}
              error={artifacts.error}
              onRetry={artifacts.retry}
              createScope={irgatArtifactScope(irgatId)}
            />
          </div>
        ) : null}
        <div
          ref={lock}
          role="tabpanel"
          aria-label={TABS.find((entry) => entry.id === tab)?.label}
          hidden={
            tab === "changes" ||
            tab === "artifacts" ||
            tab === "settings" ||
            tab === "agents"
          }
          className="min-h-0 flex-1 overflow-y-auto overscroll-none px-2 py-2"
          data-irgat-overview={
            tab === "changes" ||
            tab === "artifacts" ||
            tab === "settings" ||
            tab === "agents"
              ? undefined
              : tab
          }
        >
          {tab === "all" ? (
            <IrgatOverviewAll
              agent={agent}
              launches={launches}
              sessions={sessions}
              history={history}
              documents={documents}
              habits={habits}
              habitsError={habitsLoad.error}
              onRetryHabits={habitsLoad.retry}
              habitActions={actions}
              changes={changes ? changes.totals : undefined}
              limits={limits}
              onShowMore={(section) =>
                setLimits((current) => showMoreInSection(current, section))
              }
              onOpenSession={onOpenSession}
              sessionActions={sessionActions}
              onOpenDocument={onOpenDocument}
              onOpenHabit={(id) => push({ kind: "habit", id })}
              onNewHabit={() => push({ kind: "new-habit" })}
              onOpenTab={onTabChange}
            />
          ) : tab === "sessions" ? (
            launches.length ? (
              // Cards carry their own inset; this lines their icons up with
              // the tabs above, as the habit and document rows do.
              <div className="-mx-0.5">
                <IrgatSessionList
                  agent={agent}
                  launches={[...launches].reverse()}
                  sessions={sessions}
                  history={history}
                  query={query}
                  filters={filters}
                  onOpenSession={onOpenSession}
                  actions={sessionActions}
                />
              </div>
            ) : (
              <EmptyState icon={MessageMultiple}>
                Ask {agent.name} to start a session on one of your projects,
                like a bug fix or a review, and it shows up here.
              </EmptyState>
            )
          ) : tab === "habits" ? (
            <HabitsList
              habits={habits}
              actions={actions}
              onOpen={(id) => push({ kind: "habit", id })}
              empty={
                <EmptyState icon={Clock}>
                  Ask {agent.name} to put recurring work on a schedule, like a
                  morning digest or a weekly report.
                </EmptyState>
              }
            />
          ) : tab !== "documents" ? null : documents.length ? (
            <ul className="flex flex-col gap-px">
              {[...documents].reverse().map((card) => (
                <li key={card.id}>
                  <DocumentRow card={card} onOpen={onOpenDocument} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={File}>
              Ask {agent.name} to write something up, like a plan or a summary,
              and it shows up here.
            </EmptyState>
          )}
        </div>
      </PanelStack>
    </IrgatSidebar>
  );
}

/** The sidebar's session search and filters, over the Irgat's sessions. */
function SessionSearchBar({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  harnesses,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  filters: SessionSidebarFilters;
  onFiltersChange: (filters: SessionSidebarFilters) => void;
  harnesses: HarnessId[];
}) {
  const filterButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const active = hasActiveSessionFilters(filters);
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-stroke px-2">
      <div className="relative flex h-7 min-w-0 flex-1 items-center">
        <Search className="pointer-events-none absolute left-2 size-3 shrink-0 opacity-50" />
        <input
          type="text"
          value={query}
          placeholder="Search sessions..."
          aria-label="Search sessions"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query) return;
            event.preventDefault();
            event.stopPropagation();
            onQueryChange("");
          }}
          className="h-full w-full min-w-0 rounded-md bg-transparent py-0 pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/35"
        />
      </div>
      <button
        ref={filterButton}
        type="button"
        title="Filter sessions"
        aria-label="Filter sessions"
        aria-expanded={!!menu}
        aria-haspopup="menu"
        onClick={() => {
          if (menu) return setMenu(null);
          const rect = filterButton.current?.getBoundingClientRect();
          if (rect) setMenu({ x: rect.right - 228, y: rect.bottom + 2 });
        }}
        className={`grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content ${
          menu || active ? "bg-selection text-content" : ""
        }`}
      >
        <ListFilter className="size-3" strokeWidth={1.75} />
      </button>
      {menu ? (
        <SessionFiltersMenu
          x={menu.x}
          y={menu.y}
          harnesses={harnesses}
          unavailableOption
          filters={filters}
          onChange={onFiltersChange}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The overview's tabs: the open one names itself and how many it holds, the
 * others are just their icons.
 */
function OverviewTabs({
  tab,
  counts,
  onChange,
}: {
  tab: IrgatOverviewTab;
  counts: Record<IrgatOverviewTab, number | undefined>;
  onChange: (tab: IrgatOverviewTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Overview"
      className="-ml-2 flex items-center gap-0.5"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const selected = id === tab;
        const count = counts[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={label}
            title={label}
            data-tauri-drag-region="false"
            onClick={() => onChange(id)}
            className={`flex h-7 items-center rounded-lg px-2 text-[12px] transition-colors duration-200 ${
              selected
                ? "bg-content/8 text-content"
                : "text-content/45 hover:bg-content/5 hover:text-content/80"
            }`}
          >
            {/* Folded tabs dot their icon, as the rail does, when they hold something new. */}
            {id === "changes" && !selected && count ? (
              <span className="relative grid shrink-0" data-changes-dot>
                <Icon
                  className="overview-tab-icon-with-dot size-3.5"
                  strokeWidth={1.75}
                />
                <span
                  aria-hidden
                  className="absolute -top-0.5 left-2.5 size-1.5 rounded-full bg-accent"
                />
              </span>
            ) : (
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
            )}
            {/* The name and count open out of the icon, and fold back into it. */}
            <span
              aria-hidden={!selected}
              data-tab-label={selected ? "open" : "closed"}
              className={`grid transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none ${
                selected
                  ? "grid-cols-[1fr] opacity-100"
                  : "grid-cols-[0fr] opacity-0"
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                <span className="pl-1.5">{label}</span>
                {count ? (
                  <span className="min-w-4 rounded bg-accent px-1 text-center text-[10px] font-medium leading-4 tabular-nums text-on-accent">
                    {count}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The sessions the Irgat orchestrated, as the live who-started-whom tree. */
function IrgatAgentTree({
  irgatSessionId,
  name,
  launches,
  sessions,
  history,
  interruptedIds,
  onOpenSession,
  onRetry,
}: {
  irgatSessionId: string;
  name: string;
  launches: readonly IrgatSpawnedSession[];
  sessions: readonly Session[];
  history?: readonly SessionSummary[];
  interruptedIds?: ReadonlySet<string>;
  onOpenSession: (sessionId: string) => void;
  onRetry?: (request: AgentRetryRequest) => Promise<void>;
}) {
  const irgat = useMemo(() => {
    const summaries = new Map((history ?? []).map((entry) => [entry.id, entry]));
    const records: LaunchRecord[] = launches.map((launch) => {
      const summary = summaries.get(launch.sessionId);
      return {
        sessionId: launch.sessionId,
        title: summary?.title || launch.title,
        harness: launch.harness,
        model: launch.model,
        ...(summary
          ? {
              createdAt: summary.createdAt,
              updatedAt: summary.updatedAt,
              ...(summary.archived ? { archived: true } : {}),
            }
          : {}),
      };
    });
    return { sessionId: irgatSessionId, name, launches: records };
  }, [history, irgatSessionId, launches, name]);
  return (
    <AgentTreeView
      sessions={sessions}
      interruptedSessionIds={interruptedIds}
      irgat={irgat}
      onOpenSession={onOpenSession}
      onRetry={onRetry}
    />
  );
}
