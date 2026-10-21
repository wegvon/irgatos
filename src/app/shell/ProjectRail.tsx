import {
  Artifacts,
  BellOff,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Internet,
  Inbox,
  Mail,
  Idea,
  Feed,
  Kanban,
  MoreHorizontal,
  Pin,
  PinOff,
  File,
  Pencil,
  Plus,
  Search,
  Settings,
  Zap,
} from "../../shared/ui/icons";
import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useDragResize } from "../../shared/hooks/useDragResize";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import { useProjectDiffStats } from "../../features/source-control/hooks/useProjectDiffStats";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
import { useTabGroupLogos } from "../../features/projects/hooks/useTabGroupLogos";
import {
  loadProjectRailWidth,
  PROJECT_RAIL_WIDTH_DEFAULT,
  PROJECT_RAIL_WIDTH_MAX,
  PROJECT_RAIL_WIDTH_MIN,
  saveProjectRailWidth,
} from "../../features/settings/model/appearance";
import {
  basename,
  type GitDiffStats,
} from "../../platform/tauri/fs";
import { IS_MAC, MOD, SHIFT } from "../../platform/tauri/platform";
import { formatInteger } from "../../shared/lib/numbers";
import { pathKey, projectKey, projectName } from "../../shared/lib/paths";
import {
  collectRailProjects,
  loadPinnedProjects,
  loadProjectRailOrder,
  projectRailSections,
  sameProjectPath,
  savePinnedProjects,
  saveProjectRailOrder,
  subscribeProjectPathsChanged,
  syncProjectRailOrder,
  toggleProjectPin,
  type RecentProject,
} from "../../features/projects/model/recents";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  projectGroupColor,
  projectGroupIdForPath,
  updateProjectGroup,
  type ProjectGroup,
} from "../../features/projects/model/projectGroups";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import { LiveAgentsPreview } from "../../features/sessions/ui/LiveAgentsPreview";
import { ProjectLogoIcon } from "../../features/projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import {
  ArtifactCount,
  artifactsLabel,
  RailAction,
  RailSearch,
  type ChatIndicator,
} from "./RailAction";
import { DevModeSlot, TabVisitNav } from "./TitleBar";
import { CompactRailAction } from "./CompactRailAction";
import { AppVersionBadge, SidebarUpdateFooter } from "./SidebarUpdate";
import type { InstalledUpdate } from "../model/updateNotice";
import { SettingsNav } from "./SettingsRail";
import { Shimmer } from "../../shared/ui/Shimmer";
import type { SettingsSectionId } from "../../features/settings/model/settings";
import { InboxNotificationMenu } from "../../features/inbox/ui/InboxNotificationMenu";
import { notificationMuteStatus } from "../../features/notifications/ui/notificationMuteActions";
import { useProjectNotificationPreferences } from "../../features/notifications/hooks/useProjectNotificationPreferences";
import { useNotificationProjects } from "../../features/notifications/hooks/useNotificationProjects";
import { GithubStarPrompt } from "./GithubStarPrompt";
import { ChatsRailSection, type ChatsRailProps } from "./ChatsRailSection";
import { Popover } from "../../shared/ui/Popover";
import { OPEN_REMOTE_PROJECT_EVENT } from "../../features/connections/model/connections";
import {
  useRemoteMachineOnline,
  useRemoteMachines,
} from "../../features/connections/model/connections";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { useProjectMenu } from "./useProjectMenu";
import { IrgatRailSection, type IrgatRailProps } from "./IrgatRailSection";
import {
  ProjectAlertsContext,
  RailAlertBadge,
  RailAlertEdge,
  hasRailAlert,
  railAlertLabel,
  useProjectAlert,
  useProjectsAlert,
  type RailAlertCounts,
} from "./RailAlert";

type Props = {
  visible?: boolean;
  cwd: string;
  recents: RecentProject[];
  inboxUnseen?: boolean;
  busyPaths?: Iterable<string>;
  /** Sessions waiting on the user or unread, per project (`pathKey`). */
  projectAlerts?: ReadonlyMap<string, RailAlertCounts>;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onSearch?: () => void;
  searchActive?: boolean;
  onOpenInbox?: () => void;
  inboxActive?: boolean;
  /** Opens the project-free Chat view; works with no project open. */
  onOpenChat?: () => void;
  chatActive?: boolean;
  chatIndicator?: ChatIndicator;
  chatShortcut?: string;
  chats?: ChatsRailProps;
  notesEnabled?: boolean;
  onOpenNotes?: () => void;
  notesActive?: boolean;
  onOpenAutomations?: () => void;
  automationsActive?: boolean;
  onOpenKanban?: () => void;
  fleetPanel?: ReactNode;
  kanbanActive?: boolean;
  fleetActive?: boolean;
  onOpenMail?: () => void;
  onOpenIdeas?: () => void;
  onOpenFeed?: () => void;
  mailActive?: boolean;
  ideasActive?: boolean;
  feedActive?: boolean;
  /** Shows the project's Artifacts panel; absent outside a project. */
  onOpenArtifacts?: () => void;
  artifactsActive?: boolean;
  artifactCount?: number;
  onTogglePanel?: () => void;
  onSelectProject: (path: string) => void;
  onOpenProject: () => void;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void;
  liveAgents?: LiveAgent[];
  activeSessionId?: string;
  onSelectAgent?: (sessionId: string) => void;
  settingsOpen?: boolean;
  settingsSection?: SettingsSectionId;
  onOpenSettings?: () => void;
  onOpenNotificationSettings?: (projectPath?: string) => void;
  onSelectSettingsSection?: (section: SettingsSectionId) => void;
  onCloseSettings?: () => void;
  updateNotice?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
  /** The Irgats section above the projects; absent while Irgats are off. */
  irgats?: IrgatRailProps;
};

export function ProjectRail({
  visible = true,
  cwd,
  recents,
  inboxUnseen = false,
  busyPaths,
  projectAlerts = NO_PROJECT_ALERTS,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onSearch,
  searchActive = false,
  onOpenInbox,
  inboxActive = false,
  chatActive = false,
  chats,
  notesEnabled = true,
  onOpenNotes,
  notesActive = false,
  onOpenAutomations,
  automationsActive = false,
  onOpenKanban,
  fleetPanel,
  kanbanActive = false,
  fleetActive = false,
  onOpenMail,
  onOpenIdeas,
  onOpenFeed,
  mailActive = false,
  ideasActive = false,
  feedActive = false,
  onOpenArtifacts,
  artifactsActive = false,
  artifactCount = 0,
  onTogglePanel,
  onSelectProject,
  onOpenProject,
  onRemoveProject,
  liveAgents = [],
  activeSessionId,
  onSelectAgent,
  settingsOpen = false,
  settingsSection = "general",
  onOpenSettings,
  onOpenNotificationSettings,
  onSelectSettingsSection,
  onCloseSettings,
  updateNotice = null,
  onOpenWhatsNew,
  onDismissUpdate,
  irgats,
}: Props) {
  const resize = useDragResize({
    min: PROJECT_RAIL_WIDTH_MIN,
    max: () =>
      Math.min(PROJECT_RAIL_WIDTH_MAX, Math.floor(window.innerWidth * 0.35)),
    defaultWidth: PROJECT_RAIL_WIDTH_DEFAULT,
    initial: loadProjectRailWidth(),
    onCommit: saveProjectRailWidth,
  });
  const [railOrder, setRailOrder] = useState(loadProjectRailOrder);
  const [pinnedPaths, setPinnedPaths] = useState(loadPinnedProjects);
  const [groupLabels, setGroupLabels] = useState(loadTabGroupLabels);
  const [groupColors, setGroupColors] = useState(loadTabGroupColors);
  const [groupMascots, setGroupMascots] = useState(loadTabGroupMascots);
  const [groupCustomColors, setGroupCustomColors] = useState(
    loadTabGroupCustomColors,
  );
  const [projectGroups, setProjectGroups] = useState(loadProjectGroups);
  const [projectGroupAssignments, setProjectGroupAssignments] = useState(
    loadProjectGroupAssignments,
  );
  useEffect(
    () =>
      subscribeProjectPathsChanged(() => {
        setRailOrder(loadProjectRailOrder());
        setPinnedPaths(loadPinnedProjects());
        setGroupLabels(loadTabGroupLabels());
        setGroupColors(loadTabGroupColors());
        setGroupMascots(loadTabGroupMascots());
        setGroupCustomColors(loadTabGroupCustomColors());
        setProjectGroups(loadProjectGroups());
        setProjectGroupAssignments(loadProjectGroupAssignments());
      }),
    [],
  );
  const [inboxMenu, setInboxMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const projectMenu = useProjectMenu({
    onRemoveProject,
    onOpenNotificationSettings,
    onOpen: () => setInboxMenu(null),
  });
  useEffect(() => {
    if (visible) return;
    projectMenu.dismiss();
    setInboxMenu(null);
  }, [visible]);
  const notificationPreferences = useProjectNotificationPreferences();
  const allProjects = useMemo(
    () => collectRailProjects(recents, cwd),
    [cwd, recents],
  );
  const notificationProjects = useNotificationProjects([...allProjects.keys()]);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const groupLogos = useTabGroupLogos();
  const muteStatuses = new Map<string, string | null>();
  for (const project of notificationProjects.projects) {
    const status = notificationMuteStatus(notificationPreferences[project.id]);
    for (const path of project.paths) muteStatuses.set(pathKey(path), status);
  }
  const sections = useMemo(
    () => projectRailSections(recents, cwd, railOrder, pinnedPaths),
    [cwd, pinnedPaths, railOrder, recents],
  );
  const groupedProjectSections = useMemo(() => {
    const byGroup = new Map<string, RecentProject[]>(
      projectGroups.map((group) => [group.id, []]),
    );
    const ungrouped: RecentProject[] = [];
    for (const project of sections.projects) {
      const groupId = projectGroupIdForPath(
        project.path,
        projectGroupAssignments,
      );
      const items = groupId ? byGroup.get(groupId) : undefined;
      if (items) items.push(project);
      else ungrouped.push(project);
    }
    return {
      ungrouped,
      grouped: projectGroups.map((group) => ({
        group,
        items: byGroup.get(group.id) ?? [],
      })),
    };
  }, [projectGroupAssignments, projectGroups, sections.projects]);
  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const path of busyPaths ?? []) set.add(path);
    return set;
  }, [busyPaths]);

  useEffect(() => {
    setRailOrder((prev) => {
      const synced = syncProjectRailOrder(prev, allProjects);
      if (synced.join("\0") === prev.join("\0")) return prev;
      saveProjectRailOrder(synced);
      return synced;
    });
  }, [allProjects]);

  useEffect(() => {
    // Saving announces the change, which reloads `pinnedPaths`.
    const pinned = loadPinnedProjects();
    const next = pinned.filter((path) => allProjects.has(path));
    if (next.length !== pinned.length) savePinnedProjects(next);
  }, [allProjects]);

  useEffect(() => {
    if (!projectMenu.isOpen) return;
    const onScroll = () => projectMenu.close();
    const scrollParent = scrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [projectMenu.isOpen]);

  const onProjectContextMenu = (
    path: string,
    event: MouseEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
    projectMenu.open(path, event.clientX, event.clientY);
  };

  const reorderSubset = (
    fullOrder: string[],
    subsetOrder: string[],
    subsetPaths: Set<string>,
  ) => {
    const next: string[] = [];
    let subsetIndex = 0;
    for (const path of fullOrder) {
      if (!subsetPaths.has(path)) {
        next.push(path);
        continue;
      }
      if (subsetIndex < subsetOrder.length) {
        next.push(subsetOrder[subsetIndex++]);
      }
    }
    return next;
  };

  const onReorderPinned = (ids: string[]) => {
    const subset = new Set(sections.pinned.map((item) => item.path));
    const next = reorderSubset(railOrder, ids, subset);
    setRailOrder(next);
    saveProjectRailOrder(next);
  };

  const onReorderProjects = (ids: string[]) => {
    const subset = new Set(ids);
    const next = reorderSubset(railOrder, ids, subset);
    setRailOrder(next);
    saveProjectRailOrder(next);
  };

  // Another view in the main area means no project row is the current one.
  const otherViewActive =
    searchActive ||
    inboxActive ||
    notesActive ||
    automationsActive ||
    kanbanActive ||
    fleetActive ||
    mailActive ||
    ideasActive ||
    feedActive ||
    chatActive ||
    !!irgats?.activeId;
  const pinnedIds = sections.pinned.map((item) => item.path);
  const projectIds = groupedProjectSections.ungrouped.map((item) => item.path);
  const pinnedSortable = useAnimatedReorder(pinnedIds, onReorderPinned, "y");
  const projectSortable = useAnimatedReorder(projectIds, onReorderProjects, "y");
  return (
    <ProjectAlertsContext.Provider value={projectAlerts}>
    <nav
      aria-label="Projects"
      className={`sidebar-glass relative shrink-0 flex-col border-r border-stroke ${visible ? "flex" : "hidden"}`}
    >
      <div
        className="flex h-10 shrink-0 select-none items-center pr-1.5"
        data-tauri-drag-region="deep"
      >
        {IS_MAC ? <div className="w-[78px] shrink-0" /> : null}
        <DevModeSlot />
        <TabVisitNav
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
          onTogglePanel={settingsOpen ? undefined : onTogglePanel}
          panelActive
        />
      </div>

      <div className="flex min-h-0 flex-1">
      <div
        role="navigation"
        aria-label="Views"
        data-view-rail
        className="flex w-12 shrink-0 flex-col items-center border-r border-stroke"
      >
        <div className="flex w-full flex-col items-center gap-1.5 py-1.5">
          <CompactRailAction
            label={inboxUnseen ? "Inbox, new items" : "Inbox"}
            icon={Inbox}
            active={inboxActive}
            dot={inboxUnseen}
            onClick={onOpenInbox}
            onOpenContextMenu={(x, y) => {
              menuTrigger.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              projectMenu.close();
              setInboxMenu({ x, y });
            }}
          />
          {onOpenMail ? (
            <CompactRailAction
              label="Mail"
              icon={Mail}
              active={mailActive}
              onClick={onOpenMail}
            />
          ) : null}
          {onOpenIdeas ? (
            <CompactRailAction
              label="Ideas"
              icon={Idea}
              active={ideasActive}
              onClick={onOpenIdeas}
            />
          ) : null}
          {onOpenFeed ? (
            <CompactRailAction
              label="Feed"
              icon={Feed}
              active={feedActive}
              onClick={onOpenFeed}
            />
          ) : null}
          {notesEnabled ? (
            <CompactRailAction
              label="Notes"
              icon={File}
              active={notesActive}
              onClick={onOpenNotes}
            />
          ) : null}
          <CompactRailAction
            label="Automations"
            icon={Zap}
            active={automationsActive}
            onClick={onOpenAutomations}
          />
          {onOpenKanban ? (
            <CompactRailAction
              label="Board"
              icon={Kanban}
              active={kanbanActive}
              onClick={onOpenKanban}
            />
          ) : null}
          <CompactRailAction
            label={artifactsLabel(artifactCount)}
            icon={Artifacts}
            active={artifactsActive}
            onClick={onOpenArtifacts}
            badge={
              <ArtifactCount
                count={artifactCount}
                className="absolute -right-0.5 -top-0.5 h-3.5 min-w-3.5 px-0.5 text-[9px]"
              />
            }
          />
        </div>
        <div className="min-h-2 flex-1" />
        <div className="flex w-full flex-col items-center gap-1 py-2">
          <CompactRailAction
            label={`Settings (${MOD},)`}
            icon={Settings}
            active={settingsOpen}
            onClick={settingsOpen ? onCloseSettings : onOpenSettings}
          />
          <AppVersionBadge />
        </div>
      </div>

      <div
        ref={resize.setPaneRef}
        data-project-panel
        className="flex min-w-0 flex-col"
      >
      {settingsOpen ? (
        <SettingsNav
          section={settingsSection}
          onSelect={(next) => onSelectSettingsSection?.(next)}
          onClose={() => onCloseSettings?.()}
        />
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-px px-2 pb-2 pt-0.5">
            <RailSearch
              label="Search"
              icon={Search}
              onClick={onSearch}
              active={searchActive}
              shortcut={`${MOD}K`}
              ariaLabel={`Search (${MOD}K)`}
            />
            {chats ? (
              <>
                <div className="mt-0.5" />
                <RailAction
                  label="New chat"
                  icon={Pencil}
                  onClick={chats.onNew}
                  shortcut={`${MOD}${SHIFT}H`}
                  ariaLabel={`New chat (${MOD}${SHIFT}H)`}
                />
              </>
            ) : null}
          </div>
          <div
            ref={(el) => {
              lockOverscroll(el);
              scrollRef.current = el;
            }}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none pb-2"
          >
            {irgats ? (
              <IrgatRailSection
                {...irgats}
                introAvailable={visible && !!irgats.introAvailable}
              />
            ) : null}

            {sections.pinned.length > 0 ? (
              <ProjectSection
                label="Pinned"
                items={sections.pinned}
                muteStatuses={muteStatuses}
                cwd={cwd}
                busy={busy}
                statsEnabled={visible}
                sortable={pinnedSortable}
                pinned
                searchActive={otherViewActive}
                onSelect={onSelectProject}
                onTogglePin={toggleProjectPin}
                onContextMenu={onProjectContextMenu}
                onOpenMenu={projectMenu.open}
                groupLabels={groupLabels}
                groupColors={groupColors}
                groupCustomColors={groupCustomColors}
                groupLogos={groupLogos}
                groupMascots={groupMascots}
              />
            ) : null}

            {projectGroups.length > 0 ? (
              <div className="mb-2 shrink-0">
                <ProjectSectionHeader
                  label="Groups"
                  onAddGroup={(x, y) => projectMenu.createGroup(x, y)}
                />
                <div className="flex flex-col gap-px px-2">
                  {groupedProjectSections.grouped.map(({ group, items }) => (
                    <ProjectGroupSection
                      key={group.id}
                      group={group}
                      items={items}
                      muteStatuses={muteStatuses}
                      cwd={cwd}
                      busy={busy}
                      statsEnabled={visible}
                      searchActive={otherViewActive}
                      onSelect={onSelectProject}
                      onTogglePin={toggleProjectPin}
                      onContextMenu={onProjectContextMenu}
                      onOpenMenu={projectMenu.open}
                      onReorder={onReorderProjects}
                      onToggleCollapsed={() =>
                        updateProjectGroup(group.id, (current) => ({
                          ...current,
                          collapsed: !current.collapsed,
                        }))
                      }
                      onOpenGroupMenu={(x, y) =>
                        projectMenu.openGroupMenu(group.id, x, y)
                      }
                      groupLabels={groupLabels}
                      groupColors={groupColors}
                      groupCustomColors={groupCustomColors}
                      groupLogos={groupLogos}
                      groupMascots={groupMascots}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <ProjectSection
              label="Projects"
              items={groupedProjectSections.ungrouped}
              muteStatuses={muteStatuses}
              emptyLabel={
                sections.projects.length === 0 && projectGroups.length === 0
                  ? "No projects yet"
                  : undefined
              }
              onAdd={onOpenProject}
              cwd={cwd}
              busy={busy}
              statsEnabled={visible}
              sortable={projectSortable}
              pinned={false}
              searchActive={otherViewActive}
              onSelect={onSelectProject}
              onTogglePin={toggleProjectPin}
              onContextMenu={onProjectContextMenu}
              onOpenMenu={projectMenu.open}
              groupLabels={groupLabels}
              groupColors={groupColors}
              groupCustomColors={groupCustomColors}
              groupLogos={groupLogos}
              groupMascots={groupMascots}
            />
            {chats ? <ChatsRailSection {...chats} /> : null}
          </div>
          {fleetPanel}
          {fleetPanel ? null : (
          <LiveAgentsPreview
            agents={liveAgents}
            activeSessionId={activeSessionId}
            onSelect={onSelectAgent}
            groupLabels={groupLabels}
            groupColors={groupColors}
            groupCustomColors={groupCustomColors}
            groupMascots={groupMascots}
          />
          )}
          <SidebarUpdateFooter
            update={updateNotice}
            onOpenWhatsNew={onOpenWhatsNew}
            onDismissUpdate={onDismissUpdate}
          />
          <div className="flex shrink-0 flex-col gap-px px-2 pb-2 empty:hidden">
            <GithubStarPrompt />
          </div>
        </>
      )}
      </div>
      </div>
      {visible ? projectMenu.element : null}
      {visible && inboxMenu ? (
        <InboxNotificationMenu
          {...inboxMenu}
          projectPaths={[...allProjects.keys()]}
          onOpenSettings={onOpenNotificationSettings}
          onClose={() => {
            setInboxMenu(null);
            menuTrigger.current?.focus();
          }}
        />
      ) : null}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize project sidebar"
        aria-valuenow={resize.width}
        aria-valuemin={PROJECT_RAIL_WIDTH_MIN}
        aria-valuemax={PROJECT_RAIL_WIDTH_MAX}
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
    </nav>
    </ProjectAlertsContext.Provider>
  );
}

const NO_PROJECT_ALERTS: ReadonlyMap<string, RailAlertCounts> = new Map();

type SortableHandle = ReturnType<typeof useAnimatedReorder>;

function ProjectSection({
  label,
  items,
  muteStatuses,
  emptyLabel,
  onAdd,
  cwd,
  busy,
  statsEnabled,
  sortable,
  pinned,
  searchActive,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  label: string;
  items: RecentProject[];
  muteStatuses: ReadonlyMap<string, string | null>;
  emptyLabel?: string;
  onAdd?: () => void;
  cwd: string;
  busy: Set<string>;
  statsEnabled: boolean;
  sortable: SortableHandle;
  pinned: boolean;
  searchActive: boolean;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (path: string, x: number, y: number) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  return (
    <div className="shrink-0 mb-2">
      <ProjectSectionHeader
        label={label}
        onAdd={onAdd}
        paths={items.map((item) => item.path)}
      />
      {items.length === 0 && emptyLabel ? (
        <p className="px-4 pb-1 text-[11px] leading-tight text-content/40">
          {emptyLabel}
        </p>
      ) : null}
      <div className="flex flex-col gap-px px-2">
        {items.map((item) => (
          <ProjectCard
            key={item.path}
            item={item}
            muteStatus={muteStatuses.get(pathKey(item.path)) ?? undefined}
            selected={!searchActive && sameProjectPath(item.path, cwd)}
            busy={isBusyPath(item.path, busy)}
            statsEnabled={statsEnabled}
            pinned={pinned}
            sortable={sortable}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
            onContextMenu={onContextMenu}
            onOpenMenu={onOpenMenu}
            groupLabels={groupLabels}
            groupColors={groupColors}
            groupCustomColors={groupCustomColors}
            groupLogos={groupLogos}
            groupMascots={groupMascots}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectSectionHeader({
  label,
  onAdd,
  onAddGroup,
  paths = [],
}: {
  label: string;
  onAdd?: () => void;
  onAddGroup?: (x: number, y: number) => void;
  /** The projects listed under it, whose alerts it sums. */
  paths?: readonly string[];
}) {
  const alert = useProjectsAlert(paths);
  const alertLabel = railAlertLabel(alert);
  return (
    <div className="flex items-center gap-1 px-3 pb-1.5 pt-1">
      {/* As tall as the header buttons, so every section header matches. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-xs leading-5 text-content/50">
        <span className="min-w-0 truncate">{label}</span>
        {alertLabel ? (
          <span className="sr-only">, {alertLabel}</span>
        ) : null}
        <RailAlertBadge counts={alert} />
      </div>
      {onAddGroup ? (
        <button
          type="button"
          title="New project group"
          aria-label="New project group"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onAddGroup(rect.left, rect.bottom);
          }}
          className="grid size-5 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content"
        >
          <FolderPlus className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
      {onAdd ? <AddProjectButton onOpenFolder={onAdd} /> : null}
    </div>
  );
}

function ProjectGroupSection({
  group,
  items,
  muteStatuses,
  cwd,
  busy,
  statsEnabled,
  searchActive,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  onReorder,
  onToggleCollapsed,
  onOpenGroupMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  group: ProjectGroup;
  items: RecentProject[];
  muteStatuses: ReadonlyMap<string, string | null>;
  cwd: string;
  busy: Set<string>;
  statsEnabled: boolean;
  searchActive: boolean;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (path: string, x: number, y: number) => void;
  onReorder: (ids: string[]) => void;
  onToggleCollapsed: () => void;
  onOpenGroupMenu: (x: number, y: number) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  const sortable = useAnimatedReorder(
    items.map((item) => item.path),
    onReorder,
    "y",
  );
  const countLabel = `${items.length} ${items.length === 1 ? "project" : "projects"}`;
  const expanded = !group.collapsed;
  // Open groups show it on each project; a closed one carries it itself.
  const groupAlert = useProjectsAlert(items.map((item) => item.path));
  const shownAlert = expanded ? undefined : groupAlert;
  const groupAlertLabel = railAlertLabel(shownAlert);
  const openMenu = (target: HTMLElement, x?: number, y?: number) => {
    const rect = target.getBoundingClientRect();
    onOpenGroupMenu(x ?? rect.left, y ?? rect.bottom);
  };

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-md ${
        expanded ? "mb-1.5 bg-content/5" : ""
      }`}
      data-project-group={group.id}
      role="group"
      aria-label={group.name}
    >
      <div
        className={`project-reorder-item group relative flex h-8 items-stretch rounded-md px-2 cursor-default ${
          hasRailAlert(shownAlert) ? "" : "opacity-65"
        }`}
        onContextMenu={(event) => {
          event.preventDefault();
          event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
          openMenu(event.currentTarget, event.clientX, event.clientY);
        }}
      >
        <button
          type="button"
          aria-expanded={!group.collapsed}
          aria-label={[group.name, countLabel, groupAlertLabel]
            .filter(Boolean)
            .join(", ")}
          title={[`${group.name} · ${countLabel}`, groupAlertLabel]
            .filter(Boolean)
            .join("\n")}
          onClick={onToggleCollapsed}
          className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left transition-[padding] duration-150 motion-reduce:transition-none group-hover:pr-6 group-has-[:focus-visible]:pr-6"
        >
          <div className="grid size-4 shrink-0 place-items-center">
            {group.collapsed ? (
              <>
                <span
                  data-group-mascot
                  className="grid size-4 place-items-center group-hover:hidden group-has-[:focus-visible]:hidden"
                >
                  <ProjectMascot
                    project={group.id}
                    color={projectGroupColor(group)}
                    name={group.mascot ?? null}
                    className="size-3"
                  />
                </span>
                <ChevronRight
                  data-group-chevron
                  className="hidden size-3.5 group-hover:block group-has-[:focus-visible]:block"
                  strokeWidth={1.75}
                />
              </>
            ) : (
              <ChevronDown
                data-group-chevron
                className="size-3.5"
                strokeWidth={1.75}
              />
            )}
          </div>
          <span
            className={
              hasRailAlert(shownAlert) ? alertNameClassName : nameClassName
            }
          >
            {group.name}
          </span>
          <RailAlertBadge
            counts={shownAlert}
            className="group-hover:hidden group-has-[:focus-visible]:hidden"
          />
        </button>
        <RailAlertEdge counts={shownAlert} />
        <button
          type="button"
          data-no-drag
          title="Group options"
          aria-label={`${group.name} group options`}
          aria-haspopup="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openMenu(event.currentTarget);
          }}
          className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content group-hover:grid group-has-[:focus-visible]:grid"
        >
          <MoreHorizontal className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      {expanded ? (
        <div data-project-group-items className="flex flex-col gap-px p-1">
          {items.map((item) => (
            <ProjectCard
              key={item.path}
              item={item}
              muteStatus={muteStatuses.get(pathKey(item.path)) ?? undefined}
              selected={!searchActive && sameProjectPath(item.path, cwd)}
              busy={isBusyPath(item.path, busy)}
              statsEnabled={statsEnabled}
              pinned={false}
              sortable={sortable}
              onSelect={onSelect}
              onTogglePin={onTogglePin}
              onContextMenu={onContextMenu}
              onOpenMenu={onOpenMenu}
              groupLabels={groupLabels}
              groupColors={groupColors}
              groupCustomColors={groupCustomColors}
              groupLogos={groupLogos}
              groupMascots={groupMascots}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const nameClassName =
  "min-w-0 flex-1 truncate text-sm font-medium leading-tight";
/** A row's name while it holds sessions waiting on the user or unread. */
const alertNameClassName =
  "min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-content";

function ProjectCard({
  item,
  muteStatus,
  selected,
  busy,
  statsEnabled,
  pinned,
  sortable,
  onSelect,
  onTogglePin,
  onContextMenu,
  onOpenMenu,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupLogos,
  groupMascots,
}: {
  item: RecentProject;
  muteStatus?: string;
  selected: boolean;
  busy: boolean;
  statsEnabled: boolean;
  pinned: boolean;
  sortable: SortableHandle;
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onContextMenu: (path: string, event: MouseEvent<HTMLElement>) => void;
  onOpenMenu: (path: string, x: number, y: number) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupLogos: ReturnType<typeof useTabGroupLogos>;
  groupMascots: Record<string, string>;
}) {
  const fallbackName = basename(item.path);
  const key = projectKey(item.path);
  const seed = projectName(item.path);
  const name = resolveTabGroupLabel(key, groupLabels, fallbackName);
  const logoPath = resolveTabGroupLogo(key, groupLogos);
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const diffEnabled = statsEnabled && Boolean(item.path) && item.path !== "~";
  const stats = useProjectDiffStats(item.path, diffEnabled);
  const alert = useProjectAlert(item.path);
  const alerted = hasRailAlert(alert);
  const alertLabel = railAlertLabel(alert);
  const remote = remoteProjectFor(item.path);
  const { machines } = useRemoteMachines(!!remote);
  const machine = remote
    ? machines.find((entry) => entry.environmentId === remote.environmentId)
    : undefined;
  const online = useRemoteMachineOnline(machine?.id);
  const connection = !remote
    ? ""
    : !machine
      ? "Machine not connected on this computer"
      : online === undefined
        ? "Connecting"
        : online
          ? "Connected"
          : "Reconnecting";
  const cardTitle = projectCardTitle(
    remote
      ? `${remote.cwd} on ${machine?.name ?? "another machine"} (${connection})`
      : item.path,
    name,
    stats,
    busy,
  );
  const cardAriaLabel = projectCardAriaLabel(
    machine ? `${name} on ${machine.name}` : name,
    stats,
    busy,
  );
  const labelClassName = machine
    ? `min-w-0 max-w-[75%] shrink-0 truncate text-sm leading-tight ${alerted ? "font-semibold text-content" : "font-medium"}`
    : alerted
      ? alertNameClassName
      : nameClassName;
  const rowTitle = [cardTitle, alertLabel, muteStatus]
    .filter(Boolean)
    .join("\n");
  const rowAriaLabel = [cardAriaLabel, alertLabel, muteStatus]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      ref={(el) => sortable.setItemRef(item.path, el)}
      data-selected={selected || undefined}
      className={`reorder-item project-reorder-item group relative flex touch-none items-stretch rounded-md px-2 h-8 ${
        selected
          ? "bg-selection-strong text-content"
          : alerted
            ? ""
            : "opacity-65"
      } cursor-default`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        sortable.onItemPointerDown(item.path, event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        if (sortable.consumeClick()) return;
        onSelect(item.path);
      }}
      onContextMenu={(event) => onContextMenu(item.path, event)}
      onKeyDown={(event) => {
        if (
          event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10")
        ) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onOpenMenu(item.path, rect.left, rect.bottom);
      }}
    >
      <button
        type="button"
        title={rowTitle}
        aria-label={rowAriaLabel}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 cursor-default items-center gap-2 text-left transition-[padding] duration-150 motion-reduce:transition-none group-hover:pr-6 group-has-[:focus-visible]:pr-6"
      >
        <div className="project-card-logo grid size-4 shrink-0 place-items-center transition-opacity group-hover:opacity-0">
          {logoPath && !busy ? (
            <ProjectLogoIcon
              path={logoPath}
              className="size-4 rounded-sm"
              imageClassName="size-4"
            />
          ) : (
            <ProjectMascot
              project={seed}
              color={color}
              name={resolveTabGroupMascot(key, groupMascots)}
              className="size-3"
              active={busy}
            />
          )}
        </div>
        {busy ? (
          <Shimmer as="span" duration={1.4} className={labelClassName}>
            {name}
          </Shimmer>
        ) : (
          <span className={labelClassName}>{name}</span>
        )}
        {machine ? (
          <span className="min-w-0 flex-1 truncate text-[11px] leading-tight text-content/45">
            {machine.name}
          </span>
        ) : null}
        <RailAlertBadge
          counts={alert}
          className="group-hover:hidden group-has-[:focus-visible]:hidden"
        />
        {remote ? (
          <span
            role="img"
            aria-label={connection}
            className="relative grid size-4 shrink-0 place-items-center text-content/45"
          >
            <Internet className="size-3" strokeWidth={1.75} aria-hidden="true" />
            <span
              aria-hidden="true"
              className={`absolute right-0 bottom-0 size-1.5 rounded-full ring-1 ring-background-base ${
                online ? "bg-emerald-400" : "bg-content/35"
              }`}
            />
          </span>
        ) : null}
        {muteStatus ? (
          <span
            role="img"
            aria-label={muteStatus}
            title={muteStatus}
            className="grid size-4 shrink-0 place-items-center text-amber-400"
          >
            <BellOff className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        data-no-drag
        title="Project options"
        aria-label="Project options"
        aria-haspopup="menu"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(
            item.path,
            event.detail === 0 ? rect.left : event.clientX,
            event.detail === 0 ? rect.bottom : event.clientY,
          );
        }}
        className="absolute right-1 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content group-hover:grid group-has-[:focus-visible]:grid"
      >
        <MoreHorizontal className="size-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        data-no-drag
        title={pinned ? "Unpin project" : "Pin project"}
        aria-label={pinned ? "Unpin project" : "Pin project"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onTogglePin(item.path);
        }}
        className="absolute left-2 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-content/55 opacity-0 pointer-events-none transition-opacity hover:text-content group-hover:pointer-events-auto group-hover:opacity-100"
      >
        {pinned ? (
          <PinOff className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Pin className="size-3.5" strokeWidth={1.75} />
        )}
      </button>
      <RailAlertEdge counts={alert} />
    </div>
  );
}

function isBusyPath(path: string, busy: Set<string>): boolean {
  for (const other of busy) {
    if (sameProjectPath(path, other)) return true;
  }
  return false;
}

function projectCardTitle(
  path: string,
  name: string,
  stats: GitDiffStats | null,
  busy: boolean,
): string {
  const parts = [name, path];
  if (busy) parts.push("Working");
  const files = stats?.files ?? 0;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  if (files > 0 || additions > 0 || deletions > 0) {
    parts.push(
      [
        files > 0 ? `${files} ${files === 1 ? "file" : "files"} changed` : "",
        additions > 0 ? `+${formatInteger(additions)}` : "",
        deletions > 0 ? `-${formatInteger(deletions)}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return parts.join("\n");
}

function projectCardAriaLabel(
  name: string,
  stats: GitDiffStats | null,
  busy: boolean,
): string {
  const parts = [name];
  if (busy) parts.push("working");
  const files = stats?.files ?? 0;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;
  if (files > 0) {
    parts.push(`${files} ${files === 1 ? "file" : "files"} changed`);
  }
  if (additions > 0) parts.push(`+${formatInteger(additions)}`);
  if (deletions > 0) parts.push(`-${formatInteger(deletions)}`);
  return parts.join(", ");
}

/** Adds a folder on this computer, or one on a connected machine. */
function AddProjectButton({ onOpenFolder }: { onOpenFolder: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-content/80 hover:bg-content/8 hover:text-content";
  return (
    <>
      <button
        ref={anchor}
        type="button"
        title="Open project"
        aria-label="Open project"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid size-5 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content aria-expanded:bg-content/8 aria-expanded:text-content"
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          align="start"
          width={230}
          onDismiss={() => setOpen(false)}
          role="menu"
          aria-label="Open project"
          className="p-1"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onOpenFolder();
            }}
          >
            <FolderPlus className="size-3.5 shrink-0" strokeWidth={1.75} />
            Open folder…
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event(OPEN_REMOTE_PROJECT_EVENT));
            }}
          >
            <Internet className="size-3.5 shrink-0" strokeWidth={1.75} />
            Open folder on a machine…
          </button>
        </Popover>
      ) : null}
    </>
  );
}
