import { sessionConversationPage } from "../features/agent-app/model/sessionConversation";
import { appWindowTokens, hasAppWindowUserTurn } from "../features/sessions/model/appWindows";
import { runBrowserTabCommand } from "../features/browser/model/browserTabCommands";
import {
  browserPageContext,
  browserToolsContext,
  claimBrowserPage,
  claimBrowserToolsHint,
  handleBrowserAgentRequest,
  noteBrowserShown,
  PAGE_EXCERPT_CHARS,
} from "../features/browser/model/browserAgent";
import {
  currentBrowserTabs,
  subscribeBrowserTabs,
} from "../features/browser/model/browserTabs";
import {
  browserAction,
  browserPageExcerpt,
  listenBrowserAgentRequests,
  replyBrowserAgent,
  setBrowserAgentView,
} from "../platform/tauri/browser";
import { readIrgatConversation } from "../features/irgats/model/irgatConversation";
import {
  resumeIrgatUsageLimit,
  switchIrgatUsageLimitAccount,
} from "../features/irgats/model/irgatUsageLimit";
import {
  acknowledgeIrgatMessage,
  enqueueIrgatMessage,
} from "../features/irgats/model/irgatMessaging";
import {
  dismissQueuedIrgatSessionCompletion,
  enqueueIrgatSessionCompletion,
  irgatSessionCompletionResult,
  IrgatSessionCompletionBatches,
} from "../features/irgats/model/irgatSessionCompletion";
import { irgatMessagePrompt } from "../features/irgats/model/irgatDirectMessages";
import { acceptQuickLaunch } from "./model/quickLaunchSession";
import { launchRemoteSession } from "../features/connections/model/remoteAgentLaunch";
import { waitForRemoteTurn } from "../features/connections/model/remoteCompletion";
import { loadRemoteSession } from "../features/connections/model/connections";
import { useWorkspaceNavigation } from "./hooks/useWorkspaceNavigation";
import { useIdleSessionDetach } from "./hooks/useIdleSessionDetach";
import { HarnessEventQueue } from "./model/harnessFlush";
import { updateSessionState } from "./model/sessionState";
import { workspaceChatTarget } from "./model/chatTarget";
import {
  handleAgentApp,
  canAccessAgentAppProject,
  canReadAgentAppSession,
  type AppSessionListing,
  type AppSessionPlacement,
} from "../features/agent-app/model/agentApp";
import { submitWithSettlement } from "./model/managedSubmission";
import {
  submitAfterProjectSync,
  type SubmissionAcceptance,
} from "./model/submissionAcceptance";
import type { CiRepairRequest } from "../features/inbox/model/ciRepair";
import { ciRepairSessions } from "../features/inbox/model/ciRepairSessions";
import {
  rebaseCiRepairs,
  trackCiRepair,
} from "../features/inbox/model/ciRepairTracking";
import { invoke } from "@tauri-apps/api/core";
import {
  claimCodeSearchHint,
  codeSearchContext,
} from "../features/settings/model/semanticSearch";
import {
  orchestrationCheckoutCwd,
  orchestrationProjectCwd,
  orchestrator,
  shellPath,
  workspaceIdentity,
  type ControlOutcome,
} from "../features/orchestration/model/orchestration";
import { modelsFor } from "../features/sessions/model/models";
import { isHarnessAvailable } from "../integrations/harness/core/availability";
import {
  completeOrchestrationProposal,
  completeOrRepairOrchestrationProposal,
  orchestrationPlanningPrompt,
  orchestrationRepairPrompt,
  proposalBlock,
  validateOrchestrationSettings,
  withOrchestrationProposal,
  type OrchestrationProposal,
} from "../features/orchestration/model/orchestrationPlan";
import { discoverOrchestrationSettings } from "../features/orchestration/model/orchestrationCatalog";
import {
  attachOrchestrationWorkers,
  consolidateOrchestrationTabs,
  prepareOrchestrationWorkerDetails,
  releaseOrchestrationWorker,
} from "../features/orchestration/model/orchestrationWorkspace";
import {
  OrchestrationActions,
  OrchestrationWorkers,
  type OrchestrationWorkerDetail,
} from "../features/orchestration/ui/OrchestrationActions";
import { createPortal, flushSync } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import {
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useStableValue } from "../shared/hooks/useStableValue";
import { Sidebar } from "./shell/Sidebar";
import { ApprovalToasts } from "../features/sessions/ui/ApprovalToasts";
import { HarnessUpdateNotice } from "../features/providers/ui/HarnessUpdateNotice";
import { WhatsNewDialog } from "./shell/WhatsNewDialog";
import { UpdateDialog } from "./shell/UpdateDialog";
import { ProviderSignInDialog } from "../features/sessions/ui/ProviderSignInDialog";
import { TitleBar, type Tab as TitleTab } from "./shell/TitleBar";
import { WindowControls } from "./shell/WindowControls";
import {
  IrgatOverview,
  type IrgatOverviewTab,
} from "../features/irgats/ui/IrgatOverview";
import { IrgatActivityPanel } from "../features/irgats/ui/IrgatActivityPanel";
import {
  launchedSessionState,
  irgatLaunchesAcrossChats,
  irgatSpawnedSessions,
  recordIrgatSpawnedSession,
  type LaunchedSessionState,
  type LaunchedSessionView,
} from "../features/irgats/model/irgatSpawnedSessions";
import { groupIrgatTurns } from "../features/sessions/model/transcriptActivity";
import { approveProjectAccess, projectAccessBlock } from "../features/irgats/model/irgatProjectAccess";
import {
  resolveIrgatActivity,
  type IrgatActivitySelection,
} from "../features/irgats/model/irgatActivity";
import { MenuBar } from "./shell/MenuBar";
import { FilePicker } from "../features/files/ui/FilePicker";
import {
  DeleteSessionDialog,
  type SessionDeleteChoice,
} from "../features/sessions/ui/DeleteSessionDialog";
import {
  type WorktreeFocus,
  useWorktreeFocus,
  worktreeFocus,
} from "../features/source-control/model/worktreeFocus";
import {
  assertWorktreeFilesClosed,
  createOrchestrationWorktree,
  createWorktree,
  detachSessionWorktree,
  checkWorktreeRemoval,
  listWorktrees,
  namedWorktreeBranch,
  orchestrationWorktreeBranchName,
  removeOrchestrationBranch,
  removeOrchestrationWorktree,
  removeWorktree,
  renameWorktreeBranch,
  sessionInWorktree,
  temporaryWorktreeBranchName,
  worktreeSessionIds,
  type Worktree,
} from "../features/source-control/model/worktrees";
import { OPEN_BROWSER_URL_EVENT } from "../features/source-control/model/worktreeEnv";
import { UsageFooter } from "./shell/UsageFooter";
import { useProjectBranches } from "../features/source-control/hooks/useProjectBranches";
import { useInboxActivity } from "../features/inbox/hooks/useInboxUnseen";
import { useKanbanSessions } from "../features/kanban/hooks/useKanbanSessions";
import {
  cardTitleFromText,
  createKanbanCard,
  createKanbanColumn,
  DEFAULT_KANBAN_COLUMNS,
  kanbanProject,
  linkKanbanSession,
  loadKanbanBoard,
  syncKanbanSessions,
  type KanbanCard,
} from "../features/kanban/model/kanban";
import { liveSessionStatus } from "../features/kanban/model/cardSession";
import { countNeedsYou } from "../features/fleet/model/fleet";
import type { KanbanFocusRequest } from "../features/kanban/ui/KanbanView";
import {
  loadProjectRailOpen,
  loadSessionSidebarOpen,
  saveProjectRailOpen,
  saveSessionSidebarOpen,
  type SidebarTabId,
} from "../features/settings/model/appearance";
import {
  loadProjectSidebarTab,
  saveProjectSidebarTab,
} from "../features/settings/model/projectSidebarTab";
import {
  HAS_NATIVE_GLASS,
  IS_MAC,
  MOD,
  SHIFT,
} from "../platform/tauri/platform";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  UI_SCALE_DEFAULT,
  zoomInUiScale,
  zoomOutUiScale,
} from "../features/settings/model/uiScale";
import { resolveZoomKeybinding } from "../features/settings/model/zoomKeybinding";
import { resolveAppShortcut } from "../features/settings/model/appShortcuts";
import { runUpdateFlow } from "./model/updater";
import {
  displayAttachments,
  prepareAttachments,
} from "../features/sessions/model/attachments";
import {
  basename,
  homeDir,
  notifyGitChanged,
  pickFolders,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../platform/tauri/fs";
import {
  invalidateProjectFiles,
  prefetchProjectFiles,
  rememberOpenedFile,
  resolveFileOpenRequest,
  resolveOpenablePath,
} from "../features/files/model/fileIndex";
import {
  closeLeaf,
  closeSurfacePanes,
  findSurfacePane,
  firstLeafId,
  focusedFileTab,
  isolateTerminalPanes,
  isFilesystemTab,
  isCommitTab,
  isTerminalTab,
  leaf,
  leafIds,
  movePane,
  neighborLeafId,
  newArtifactTab,
  newEditorWorkspaceTab,
  newFileTab,
  newPlanTab,
  newTab,
  newTerminalFile,
  newTerminalWorkspaceTab,
  nextTerminalTitle,
  openChangesTab,
  openCommitTab,
  newAgentTab,
  openEditorTab,
  openSessionChangesTab,
  pinEditorFile,
  openWorkspaceFile,
  previewWorkspaceFile,
  openTerminalTab,
  removePane,
  resetTabToSession,
  replaceLeafId,
  setSplitRatio,
  siblingLeafId,
  splitPane,
  surfacePanes,
  updateTerminalTab,
  withSurfacePanes,
  type EditorPane,
  type FilePaneTab,
  type FocusDir,
  type PaneEdge,
  type SplitDir,
  type WorkspaceTab,
} from "../features/workspace/model/layout";
import {
  closeSidePane,
  forgetSidePane,
  irgatSidePaneKey,
  loadSidePanes,
  openBeside,
  saveSidePanes,
  shownSidePanes,
  type SidePaneKey,
  type SidePaneMap,
  type SidePanes,
} from "../features/workspace/model/sidePanes";
import { SidePaneRow } from "../features/workspace/ui/SidePaneRow";
import {
  releaseNotesForVersion,
  releaseNotesTitle,
} from "./model/releaseNotes";
import { mergeOrderedSubset, orderByIds } from "../shared/lib/reorder";
import {
  addTerminalToDock,
  applyDockGridStyle,
  canOpenDockTerminal,
  closeTerminalInDock,
  createProjectTerminal,
  findProjectTerminal,
  focusedDockTerminalId,
  mapProjectTerminal,
  nextDockTerminalTitle,
  patchProjectTerminals,
  reorderDockTerminals,
  selectDockTerminal,
  viewDock,
  withDockOpen,
  withDockSide,
  withDockSize,
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "../features/projects/model/projectTerminal";
import {
  applyGroupedReorder,
  insertTabBesideActive,
  removeTabFromGroup,
  tabGroupProject,
} from "../features/workspace/model/tabGroups";
import { type WindowTransferPayload } from "./model/windowTransfer";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "../features/terminal/model/terminalClose";
import {
  listRunningTerminals,
  newTerminalCwd,
  terminalTabLabel,
  type TerminalMetaPatch,
} from "../features/terminal/model/terminalTab";
import {
  applyHarnessEvent,
  applyHarnessEvents,
  appendUser,
  appendSteerUser,
  bindHarnessSession,
  cancelHarnessTurn,
  canCompactHarnessContext,
  canRewindHarnessLastTurn,
  canSteerHarness,
  compactHarnessContext,
  rewindHarnessLastTurn,
  forgetHarnessSession,
  generateHarnessTitle,
  generateHarnessBranchName,
  migrateIrgatxSession,
  isLiveHarness,
  latestTurnNeedsHarnessLogin,
  probeHarnessAvailability,
  refreshHarnessCatalogs,
  registerBuiltinHarnesses,
  promoteLastAssistantToPlan,
  respondHarnessApproval,
  respondHarnessQuestion,
  keepHarnessQuestionOpen,
  runHarnessTextPrompt,
  sendHarnessTurn,
  steerHarnessTurn,
  startHarnessBridge,
  stopHarnessSession,
  configureHarnessIdlePark,
  stopHarnessTextPrompts,
  stopStreaming,
  pickTextHarness,
  type ApprovalDecision,
  type HarnessEvent,
  type UserQuestionReply,
} from "../integrations/harness";
import { supportsHarnessLogin } from "../integrations/harness/core/authSupport";
import {
  appendPreparingHandoff,
  buildDeterministicHandoff,
  buildHandoffComposerCard,
  chooseHandoffBrief,
  completeHandoff,
  consumeHandoff,
  HANDOFF_TITLE,
  handoffTurnCard,
  isPreparingHandoff,
  pendingHandoff,
  pendingComposerSwitch,
  planComposerSwitch,
  sessionChildHarnesses,
  sessionThroughTurn,
  shouldAskOutgoingAgent,
  type HandoffComposerCard,
  userMessagesAfterHandoff,
  wrapHandoffPrompt,
} from "../features/sessions/model/handoff";
import { requestOutgoingHandoff } from "../features/sessions/model/handoffTurn";
import {
  applyBtwHarnessEvent,
  btwTurnHarness,
  buildBtwPrompt,
  replaceBtwThread,
  sealBtwResponseBlocks,
  supportsBtwHarness,
} from "../features/sessions/model/btw";

import { isEditTool } from "../integrations/harness/core/preview";
import { sessionEditPaths } from "../features/sessions/model/checkpointEdits";
import { useSessionChangeTotals } from "../features/sessions/ui/SessionReview";
import {
  createEditedResendAttempt,
  createEditedResendCoordinator,
} from "../features/sessions/model/editLastTurn";
import {
  beginSessionTurn,
  finishSessionTurn,
  applySessionCheckpoint,
  captureSessionCheckpoint,
  forgetSessionCheckpoint,
  flushSessionCheckpoint,
  keepSessionChanges,
  notifyReviewChanged,
  prepareSessionCheckpoint,
  sessionCheckpointCleanupSafe,
} from "../features/sessions/model/checkpoint";
import { notifyDirsChanged } from "../features/files/model/fileTree";
import {
  invalidateWatchedFiles,
  nudgeWatchedFiles,
} from "../features/files/model/fileWatch";
import {
  type EditorNavigationTarget,
  type OpenFileFn,
} from "../features/search/model/search";
import {
  mergeModelSettings,
  nativeModelId,
  preferredModelSettings,
  resolveModel,
  saveLastModelSettings,
  saveRecentModelChoice,
} from "../features/sessions/model/models";

import {
  buildPlanPrompt,
  isProviderFailureText,
  planTitle,
  planTurnKey,
  planTurnPrompt,
} from "../features/sessions/model/plan";
import {
  displayPath,
  isEqualOrInside,
  pathKey,
  projectName,
  rebasePath,
  resolveWorkspacePath,
} from "../shared/lib/paths";
import {
  rebaseProjectData,
  removeProjectData,
} from "../features/projects/model/projectData";
import {
  forgetProjectLocation,
  rememberProjectLocation,
  synchronizeProjectLocation,
} from "../features/projects/model/projectLocation";
import {
  archiveProject,
  forgetProject,
  lastProjectPath,
  loadRecents,
  isLocalProject,
  isRemoteProjectPath,
  looksLikeProject,
  normalizeProjectPath,
  projectRailItems,
  rememberProject,
  replaceProjectPath,
  sameProjectPath,
} from "../features/projects/model/recents";
import {
  applyDetachPaneToTab,
  applyPlaceTabOnPane,
  applyPlaceSessionOnPane,
  filterTabsForProject,
  findOpenSessionTab,
  planWorkspaceTabClose,
  switchSessionInTab,
  workspaceTabCwd,
  workspaceTabWorktree,
  focusedWorkspaceTabCwd,
} from "../features/workspace/model/workspaceTabGroups";
import { applyAddToChatRequest } from "../features/sessions/model/addChatToWorkspace";
import { newWorkspaceSession } from "./model/newWorkspaceSession";
import {
  ADD_TO_CHAT_EVENT,
  appendComposerInsert,
  requestAddToChat,
  requestInsertIntoChat,
  type AddToChatRequest,
} from "../features/sessions/model/quoteDraft";
import {
  getComposerDraft,
  setComposerDraft,
} from "../features/sessions/model/draftCache";
import { createSessionRemover } from "../features/sessions/model/sessionRemoval";
import { shouldGenerateSessionTitle } from "../features/sessions/model/sessionTitle";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccountExists,
  selectedProviderAccountId,
  supportsProviderAccounts,
  type ProviderAccountProvider,
} from "../features/providers/model/providerAccounts";
import {
  HARNESSES,
  HARNESS_LABEL,
  HARNESS_TITLE,
  canReplaceSessionTitle,
  formatSessionTitle,
  sessionNeedsInput,
  newDefaultSession,
  newSession,
  retargetSessionToProject,
  removeSessionDraft,
  sessionDisplayTitle,
  sessionDraftBlock,
  sessionWorkCwd,
  titleFromPrompt,
  type Attachment,
  type Block,
  type BtwThread,
  type ComposerTurnOptions,
  type HarnessId,
  type LinkedWorkItem,
  type ModelTarget,
  type PlanBuildTarget,
  type QueuedMessage,
  type RuntimeMode,
  type PlanStatus,
  type SecondOpinionMeta,
  type IrgatSpawnedSession,
  type Session,
  type UsageLimit,
  type WorkspaceMode,
} from "../features/sessions/model/session";
import {
  activeTurnSnapshotDue,
  persistDelay,
} from "../features/sessions/model/persistSchedule";

import {
  canDispatchQueuedHead,
  canSteerQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
} from "../features/sessions/model/messageQueue";
import { deliverQueuedFollowUp } from "../features/sessions/model/queuedFollowUp";
import {
  USAGE_LIMIT_RESUME_GRACE_MS,
  resumeUsageLimitedSession,
  usageLimitResumeDue,
} from "../features/sessions/model/usageLimit";
import {
  dismissSessionInterruption,
  planSessionResume,
  sessionInterruption,
} from "../features/sessions/model/sessionInterruption";
import {
  getAllRateLimits,
  subscribeRateLimits,
} from "../features/providers/model/rateLimitsCache";
import {
  holdAccountId,
  usageLimitRegistry,
} from "../features/quotas/model/usageLimitStore";
import {
  automationHoldId,
  queueHold,
} from "../features/quotas/model/usageLimitRegistry";
import { useUsageLimitSnapshot } from "../features/quotas/hooks/useUsageLimitHold";
import {
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
} from "../features/providers/model/rateLimitsFetch";
import {
  exhaustedWindowResetAt,
  type RateLimitProvider,
} from "../features/providers/model/rateLimits";
import { dropContextWindow } from "../features/sessions/model/contextUsage";
import {
  discardDraftSessionRecord,
  deleteSession,
  getSession,
  listLinkedSessions,
  listSessionsByProject,
  persistFingerprint,
  rebaseProjectSessions,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  setSessionArchived,
  setSessionLinkedWorkItem,
  setSessionPinned,
  shouldPersistSession,
  upsertSession,
  flushSessionWrites,
  type SessionSummary,
} from "../features/sessions/data/sessionStore";
import { rememberLoadedSession } from "../features/sessions/data/sessionCache";
import {
  TranscriptPool,
  TranscriptPoolOutlet,
} from "../features/sessions/ui/TranscriptPool";
import { syncDockBadge } from "../features/notifications/model/dockBadge";
import { liveAgentsFromSessions } from "../features/sessions/model/liveAgents";
import { hiddenApprovalNotices } from "../features/notifications/model/approvalToast";
import { useSessionReminders } from "../features/notifications/hooks/useSessionReminders";
import { ReminderNotices } from "../features/sessions/ui/ReminderNotices";
import { InboxResurfaceNotices } from "../features/inbox/ui/InboxResurfaceNotices";
import {
  cancelCheckCommand,
  createCompletionGateController,
  gateAppliesToTurn,
  loadProjectGate,
  loadSessionGate,
  registerCompletionGateController,
  resolveCompletionGate,
  runCheckCommand,
} from "../features/sessions/model/completionGate";
import { useUnseenFinishedSessions } from "../features/sessions/hooks/useUnseenFinishedSessions";
import {
  projectAlertsFromSessions,
  type RailAlertCounts,
} from "./shell/RailAlert";
import { useUnseenReplyCounts } from "../features/sessions/hooks/useUnseenReplyCounts";
import {
  loadNotificationsEnabled,
  NOTIFICATION_CLICK_EVENT,
  announceSessionFinished,
  primeNotificationPermission,
  setWindowFocused,
} from "../features/notifications/model/notifications";
import { useInputNotifications } from "../features/notifications/hooks/useInputNotifications";
import { useTerminalAgentNotifications } from "../features/terminal/hooks/useTerminalAgentNotifications";
import { terminalIdFromTarget } from "../features/terminal/model/agentDetection/terminalAgentStore";
import { archiveFocusedSession } from "../features/sessions/model/archiveShortcut";
import {
  adjacentItemId,
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldHandleListNavigation,
  shouldStopFocusedTurnOnEscape,
  tabCommand,
  tabCommandForKeybinding,
  tabCommandKeybinding,
} from "../features/workspace/model/tabKeys";
import {
  canTabVisitBack,
  canTabVisitForward,
  emptyTabVisitHistory,
  pruneTabVisitHistory,
  recordTabVisit,
  tabVisitBack,
  tabVisitForward,
  type TabVisitHistory,
} from "../features/workspace/model/tabVisitHistory";
import { preparePrompt } from "../features/sessions/model/promptPreparation";
import {
  adhdEnabledFor,
  applyAdhdCommand,
  parseAdhdCommand,
  planAdhdContext,
  recordAdhdContext,
} from "../features/adhd/model/adhdMode";
import {
  consumeOperatorCommand,
  operatorEnabledInThread,
} from "../features/sessions/model/operatorCommand";
import {
  createIrgat,
  findIrgat,
  updateIrgat,
  isIrgatSession,
  listIrgats,
  loadOpenIrgat,
  irgatForSession,
  irgatSessionIds as allIrgatSessionIds,
  irgatLook,
  irgatKnownProjects,
  irgatsSnapshot,
  irgatState,
  removeIrgat,
  saveOpenIrgat,
  subscribeIrgats,
  type IrgatState,
} from "../features/irgats/model/irgat";
import {
  loadIrgatFiles,
  IRGAT_PROMPT_VERSION,
  planAgentContext,
  irgatContext,
  irgatTurn,
  readAgentFile,
  recordAgentContext,
  writeAgentFile,
} from "../features/irgats/model/irgatFiles";
import { useIrgatHabits } from "./hooks/useIrgatHabits";
import { useHabitWebhooks } from "./hooks/useHabitWebhooks";
import { useHabitApprovals } from "../features/irgats/hooks/useHabitApprovals";
import { decideHabitApproval } from "../features/irgats/model/habitApprovals";
import {
  useIrgatGroupChat,
  useIrgatGroupWatch,
} from "./hooks/useIrgatGroupChat";
import {
  useActiveIrgatGroups,
  useIrgatGroupRun,
} from "../features/irgats/hooks/useIrgatGroup";
import {
  findIrgatGroup,
  irgatGroupName,
  irgatGroupOfView,
  irgatGroupViewKey,
  removeIrgatGroup,
} from "../features/irgats/model/irgatGroups";
import { IrgatGroupView } from "../features/irgats/ui/IrgatGroupView";
import { useLightpandaAutostart } from "./hooks/useLightpandaAutostart";
import { useFloatingIrgat } from "./hooks/useFloatingIrgat";
import {
  dropRelays,
  habitPostsContext,
  habitRunIrgat,
  isHabitRun,
  relayApproval,
  takeRelayedApproval,
  loadHabits,
  unseenHabitPosts,
  updateHabits,
} from "../features/irgats/model/irgatHabits";
import { setLiveHost } from "../features/voice/live/liveHost";
import {
  liveTurnsContext,
  unseenLiveTurns,
} from "../features/voice/live/liveTranscript";
import {
  loadIrgatRotation,
  planRotation,
  rotationReason,
  saveIrgatRotation,
} from "../features/irgats/model/irgatRotation";
import {
  detachIrgatTabs,
  ensureIrgatSession,
  createIrgatChildSession,
  deleteIrgatChildSession,
  resetIrgatSession,
} from "../features/irgats/model/irgatWorkspace";
import {
  warmNativeSkills,
  isNativeCommandPrompt,
} from "../features/skills/model/skills";
import { nativeSkillContextForSession } from "../features/sessions/model/sessionSkills";
import {
  loadSessionFolders,
  placeSessionInFolder,
  saveSessionFolders,
  type SessionFolderTarget,
} from "../features/sessions/model/sessionFolders";
import {
  ADD_NOTE_TO_CHAT_EVENT,
  NOTES_CHANGED_EVENT,
  appendNoteReference,
  composeNoteMessage,
  loadNotes,
  noteCardMeta,
  upsertNote,
  type AddNoteToChatRequest,
  type NoteComposerCard,
} from "../features/notes";
import {
  noteChatPlacement,
  openNoteChatTargets,
} from "../features/notes/noteChatTargets";
import {
  getArtifact,
  saveArtifact,
  artifactCards,
  recordArtifactCard,
  removeArtifactCard,
  ARTIFACT_DELETED_EVENT,
} from "../features/artifacts/artifacts";
import { useProjectArtifacts } from "../features/artifacts/hooks/useArtifacts";
import {
  OPEN_ARTIFACT_EVENT,
  type OpenArtifactRequest,
} from "../features/artifacts/model/artifactActions";
import {
  getRegisteredArtifact,
  registerArtifacts,
} from "../features/artifacts/model/artifactRegistry";
import {
  loadArtifactScope,
  saveArtifactScope,
} from "../features/artifacts/model/artifactScopePref";
import {
  irgatArtifactScope,
  projectArtifactScope,
} from "../features/artifacts/model/pinnedArtifacts";
import {
  artifactFileName,
  type ArtifactScope,
  type WorkspaceArtifact,
} from "../features/artifacts/model/workspaceArtifacts";
import {
  ArtifactHostContext,
  type ArtifactHost,
} from "../features/artifacts/ui/artifactContext";
import {
  irgatReviewScope,
  projectReviewScope,
  setActiveReviewScope,
} from "../features/redline/model/reviewStore";
import { RedlineReviewBadge } from "../features/redline/ui/RedlineReviewBadge";
import { ArtifactsList } from "../features/artifacts/ui/ArtifactsList";
import type { IrgatChangesRequest } from "../features/irgats/ui/IrgatChangesView";
import {
  claimDueAutomations,
  listAutomations,
  recoverAutomationRuns,
  updateAutomationRun,
  type Automation,
  type AutomationRun,
} from "../features/automations/model/automations";
import { useQuickComposerLaunches } from "../features/quick-composer/hooks/useQuickComposerLaunches";
import type { QuickLaunch } from "../features/quick-composer/model/quickComposer";
import { claimInboxAutomationRuns } from "../features/automations/model/automationEvents";
import {
  SECOND_OPINION_TITLE,
  buildSecondOpinionRequest,
  harnessForTurn,
  turnEditedFiles,
  turnUserRequest,
} from "../features/sessions/model/secondOpinion";

import { PaneTree } from "../features/workspace/ui/PaneTree";
import { SessionPane } from "../features/sessions/ui/SessionPane";
import { SessionSurface } from "../features/sessions/ui/SessionSurface";
import { ProjectTerminalDock } from "../features/terminal/ui/ProjectTerminalDock";
import { DockHostSlot } from "../features/terminal/ui/DockHostSlot";
import { lazySurface } from "../shared/ui/lazySurface";
import { preloadNavigationWhenIdle } from "./model/preloadNavigation";
import { requestTranscriptJump } from "../features/sessions/model/transcriptJump";
import { publishLiveSessions } from "../features/sessions/data/sessionReferenceDirectory";
import {
  connectWebAccess,
  webAccessDefaults,
  type WebAccessDeps,
} from "../features/web-access/model/webAccess";
import {
  connectSessionMessageTransport,
  startSessionMessageGuardTimer,
  syncSessionMessages,
} from "../features/sessions/model/sessionMessageRouter";
import { SessionReferenceHost } from "../features/sessions/ui/SessionReferenceHost";
import type { SettingsAnchor } from "../features/settings/ui/SettingsView";
import {
  OPEN_CONNECTIONS_EVENT,
  OPEN_REMOTE_PROJECT_EVENT,
  REMOTE_HISTORY_UPDATED,
  cachedRemoteSessionSummary,
  rememberRemotePendingWorktree,
  rememberRemoteSession,
  remotePendingWorktree,
  remoteTabCwd,
  remoteSessionFor,
} from "../features/connections/model/connections";
import {
  buildRemotePlan,
  remoteSessionActions,
} from "../features/connections/model/remoteSessionActions";
import { remoteSessionState } from "../features/connections/model/remoteSessionState";
import { findRemoteSessionTab } from "../features/connections/model/remoteSessionTabs";
import {
  remotePath,
  remoteProjectFor,
} from "../features/connections/model/remoteProjects";
import type { HostSession } from "../features/connections/model/protocol";
import { AddRemoteProjectDialog } from "../features/connections/ui/AddRemoteProjectDialog";
import type { ConnectableInboxSource } from "../features/inbox/model/inboxFilters";
import type { InboxSessionPortal } from "../features/inbox/ui/InboxDiscussionPanel";
import { inboxAskKey, inboxAskPrompt } from "../features/inbox/model/inboxAsk";
import {
  claimMailHint,
  linkMailSession,
  mailContext,
} from "../features/mail/model/mail";
import type { MailAskRequest, MailChat } from "../features/mail/ui/MailView";
import {
  githubWorkItemThread,
  inboxComposerCard,
  type InboxItem,
} from "../features/inbox/model/githubTasks";
import {
  linkedWorkItemFromAutomationEvent,
  linkedWorkItemFromInboxItem,
  resolveLinkedWorkItem,
} from "../features/sessions/model/sessionWorkItem";
import {
  completeLinkedWorkItemUpdateCard,
  failLinkedWorkItemUpdateCard,
  pendingLinkedWorkItemUpdateCard,
  type LinkedWorkItemUpdateCard,
} from "../features/inbox/model/linkedWorkItemActivity";
import type { LinkedSessionUpdate } from "../features/inbox/model/linkedSessionUpdates";
import { markLinkedSessionUpdateSeen } from "../features/inbox/model/linkedSessionSeen";
import { inboxTrackerDescription } from "../features/inbox/model/inboxContext";
import {
  gitlabWorkItemDetails,
  peekGitlabWorkItemDetails,
} from "../features/inbox/model/gitlab";
import {
  azureDevOpsWorkItemDetails,
  peekAzureDevOpsWorkItemDetails,
} from "../features/inbox/model/azureDevOps";
import {
  loadCloseToTray,
  loadAutosave,
  loadCollapsedProjectRailMode,
  loadFileTabMode,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  loadIrgatsEnabled,
  subscribeIrgatsEnabled,
  loadDiffViewer,
  loadFollowUpBehavior,
  loadIdleAgentLimit,
  loadKeybindingOverrides,
  loadSettingsSection,
  keybindingPressed,
  matchCustomKeybinding,
  saveSettingsSection,
  saveAutosave,
  subscribeLiveAgentsEnabled,
  subscribeNotesEnabled,
  type CollapsedProjectRailMode,
  type SettingsSectionId,
  type FollowUpBehavior,
} from "../features/settings/model/settings";
import {
  handleEditorFindKey,
  openFindInActiveEditor,
} from "../features/files/editor/editorSearch";

import {
  mergeHistorySummary,
  mergeProjectHistorySummary,
  replaceProjectHistory,
  historyWithLiveSessions,
  sameSessionSummaries,
  summaryFromSession,
} from "../features/sessions/data/sessionHistory";
import {
  CONTINUE_PROMPT,
  canAutoContinue,
  inFlightRefs,
  inFlightSnapshotKey,
  shouldWriteInFlightSnapshot,
} from "../features/sessions/model/inFlight";
import {
  isBlankSession,
  reconcileProjectReturn,
  type ProjectReturnMemory,
} from "../features/projects/model/projectReturn";
import {
  planProjectOpenRun,
  type ProjectOpenStep,
} from "../features/projects/model/projectOpenRun";
import {
  collectWorkspaceSnapshot,
  workspaceSnapshotKey,
} from "../features/workspace/model/workspaceSnapshot";
import type { InstalledUpdate } from "./model/updateNotice";
import {
  freeChatBadge,
  freeChatRows,
  isFreeChatCwd,
  isFreeChatSession,
  loadFreeChatView,
  newFreeChatSession,
  resolveFreeChatDir,
  saveFreeChatView,
} from "../features/freechat/model/freeChat";
import {
  bindResumedSessions,
  closeBusyWindow,
  closeCurrentWindow,
  confirmReload,
  hasInFlightSessions,
  hideCurrentWindow,
  isAppQuitting,
  persistLiveTranscripts,
  persistQuitState,
  reapWindowRuntime,
  setQuitWorkspace,
  type ResumedWorkspace,
} from "./model/appLifecycle";

const SearchView = lazySurface(
  async () => {
    const module = await import("../features/search/ui/SearchView");
    return { default: module.SearchView };
  },
  { suspense: false },
);
const SettingsView = lazySurface(
  async () => {
    const module = await import("../features/settings/ui/SettingsView");
    return { default: module.SettingsView };
  },
  { suspense: false },
);
const InboxView = lazySurface(
  async () => {
    const module = await import("../features/inbox/ui/InboxView");
    return { default: module.InboxView };
  },
  { suspense: false },
);
const LinkedWorkItemPanel = lazySurface(async () => {
  const module = await import("../features/inbox/ui/InboxView");
  return { default: module.LinkedWorkItemPanel };
});
const BrowserPanel = lazySurface(async () => {
  const module = await import("../features/browser/ui/BrowserPanel");
  return { default: module.BrowserPanel };
});
const NotesView = lazySurface(
  async () => {
    const module = await import("../features/notes/ui/NotesView");
    return { default: module.NotesView };
  },
  { suspense: false },
);
const AutomationsView = lazySurface(
  async () => {
    const module = await import("../features/automations/ui/AutomationsView");
    return { default: module.AutomationsView };
  },
  { suspense: false },
);
const KanbanView = lazySurface(
  async () => {
    const module = await import("../features/kanban/ui/KanbanView");
    return { default: module.KanbanView };
  },
  { suspense: false },
);
const FleetView = lazySurface(
  async () => {
    const module = await import("../features/fleet/ui/FleetView");
    return { default: module.FleetView };
  },
  { suspense: false },
);
const FeedView = lazySurface(
  async () => {
    const module = await import("../features/feed/ui/FeedView");
    return { default: module.FeedView };
  },
  { suspense: false },
);
const MailView = lazySurface(
  async () => {
    const module = await import("../features/mail/ui/MailView");
    return { default: module.MailView };
  },
  { suspense: false },
);
const IdeasView = lazySurface(
  async () => {
    const module = await import("../features/ideas/ui/IdeasView");
    return { default: module.IdeasView };
  },
  { suspense: false },
);

const FreeChatView = lazySurface(
  async () => {
    const module = await import("../features/freechat/ui/FreeChatView");
    return { default: module.FreeChatView };
  },
  { suspense: false },
);

const NEW_CHAT_SHORTCUT = `${MOD}${SHIFT}H`;

type LinkedWorkItemPanelState = {
  item: LinkedWorkItem;
  sessionId: string;
  cwd: string;
};

type SubmitOptions = ComposerTurnOptions & {
  ciRepair?: CiRepairRequest;
  /** Saved alongside the user turn; does not replace the submitted prompt. */
  ciContext?: string;
  secondOpinion?: SecondOpinionMeta;
  followUpBehavior?: FollowUpBehavior;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  queuedMessageId?: string;
  planBlockId?: string;
  buildTarget?: PlanBuildTarget;
  managed?: boolean;
  orchestrationRetry?: OrchestrationProposal;
  appRequestId?: string;
  /** App-written continuation after a user approves project access. */
  internal?: boolean;
  irgatSessionCompletion?: Block["irgatSessionCompletion"];
  /** Another Irgat sent this message with app irgats.send. */
  fromIrgat?: Block["fromIrgat"];
  /** An automatic retry after the Completion Gate's validator failed. */
  completionGateBounce?: boolean;
  onSettled?: (outcome: ControlOutcome) => void;
  /** Generate a fresh title even when this is not the session's first turn. */
  refreshTitle?: boolean;
  /** Transcript recap for an interrupted chat whose thread is gone. */
  resumeContext?: string;
  /** Internal guard for the retry after resolving a renamed project. */
  projectLocationReady?: boolean;
};

type Submit = (
  sessionId: string,
  text: string,
  attachments?: Attachment[],
  options?: SubmitOptions,
) => SubmissionAcceptance;

/** The session's provider and account are waiting out a usage limit. */
function sessionProviderHold(session: Session) {
  return usageLimitRegistry.get(
    session.harness,
    holdAccountId(session.harness, session.providerAccountId, session.cwd),
  );
}

/** Its queued prompts wait for the reset, unless the user ran them anyway. */
function providerOnHold(session: Session): boolean {
  return !!queueHold(sessionProviderHold(session), session.queueHoldOverride);
}

function withPlanStatus(
  session: Session,
  blockId: string,
  status: PlanStatus,
): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === blockId && block.role === "plan"
        ? {
            ...block,
            plan: { ...(block.plan ?? { status: "ready" }), status },
          }
        : block,
    ),
  };
}

function lastAssistantTextInTurn(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (session.queuedMessages?.some((message) => message.blockId === block.id))
      continue;
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function userTurnCards(
  noteCard: NoteComposerCard | undefined,
  secondOpinion?: SecondOpinionMeta,
) {
  if (!noteCard && !secondOpinion) return undefined;
  return {
    ...(secondOpinion ? { secondOpinion } : {}),
    ...(noteCard ? { noteCard: noteCardMeta(noteCard) } : {}),
  };
}

function withHarnessChoice(
  session: Session,
  harness: HarnessId,
  model: string,
  modelSettings: Record<string, string>,
): Session {
  return {
    ...session,
    harness,
    model,
    modelSettings,
    title:
      session.blocks.length === 0
        ? HARNESS_LABEL[harness]
        : formatSessionTitle(
            harness,
            sessionDisplayTitle(session.title, session.harness),
          ),
    ...(session.model === model
      ? {}
      : { context: dropContextWindow(session.context) }),
    ...(session.harness === harness
      ? {}
      : { providerSessionId: undefined, providerAccountId: undefined }),
  };
}

function withPlanBuildTarget(
  session: Session,
  target: PlanBuildTarget,
): Session {
  const resolved = resolveModel(target.harness, target.model);
  const modelSettings = mergeModelSettings(resolved, target.modelSettings);
  const plan = planComposerSwitch(session, target.harness);
  const next = withHarnessChoice(
    session,
    target.harness,
    resolved.id,
    modelSettings,
  );

  if (plan.kind === "arm") {
    return { ...next, pendingSwitch: plan.pending };
  }
  if (plan.kind === "revert") {
    return {
      ...next,
      pendingSwitch: undefined,
      ...(plan.restoreProviderSessionId
        ? { providerSessionId: plan.restoreProviderSessionId }
        : { providerSessionId: undefined }),
      ...(plan.restoreProviderAccountId
        ? { providerAccountId: plan.restoreProviderAccountId }
        : { providerAccountId: undefined }),
    };
  }
  if (plan.kind === "empty") {
    return { ...next, pendingSwitch: undefined };
  }
  return next;
}

function openSessionIds(tabs: WorkspaceTab[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) ids.add(id);
  }
  return ids;
}

function filesInWorkspaceTabs(tabs: readonly WorkspaceTab[]): FilePaneTab[] {
  return tabs.flatMap((tab) => [
    ...tab.editorPanes.flatMap((pane) => pane.files),
    ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
  ]);
}

/** Stable empty tab list for the title bar while a Irgat is in full view. */
const NO_TITLE_TABS: [] = [];
const NO_USAGE_PROVIDERS: RateLimitProvider[] = [];
const NO_SIDE_PANES: SidePanes = { ids: [], sizes: [1] };

/** Native sheet. `window.confirm` is swallowed when a macOS menu accelerator fires. */
function confirmDiscardUnsaved(message: string): Promise<boolean> {
  return ask(message, { title: "Irgatos", kind: "warning" });
}

function titleTabsEqual(a: TitleTab[], b: TitleTab[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tab, index) => {
    const other = b[index];
    return (
      other != null &&
      tab.id === other.id &&
      tab.project === other.project &&
      tab.title === other.title &&
      tab.sessionCount === other.sessionCount &&
      tab.dirty === other.dirty &&
      tab.more.join("\u0000") === other.more.join("\u0000") &&
      tab.harnesses.join("\u0000") === other.harnesses.join("\u0000") &&
      tab.busyHarnesses.join("\u0000") === other.busyHarnesses.join("\u0000") &&
      (tab.doneHarnesses ?? []).join("\u0000") ===
        (other.doneHarnesses ?? []).join("\u0000") &&
      tab.files.join("\u0000") === other.files.join("\u0000") &&
      tab.multiPane === other.multiPane &&
      tab.fileFocused === other.fileFocused &&
      tab.blank === other.blank &&
      tab.terminal === other.terminal &&
      tab.previewFileId === other.previewFileId &&
      tab.groupId === other.groupId
    );
  });
}

// Register capabilities before composer hooks choose their discovery strategy.
registerBuiltinHarnesses();

type AppProps = {
  windowTransfer?: WindowTransferPayload | null;
  resumed?: ResumedWorkspace | null;
  installedUpdate?: InstalledUpdate | null;
  history?: SessionSummary[];
  historyCwd?: string | null;
};

/** The worktree a project's workspace currently shows. */
function currentWorkspace(project: string): string {
  return worktreeFocus(project)?.path ?? project;
}

export default function App(props: AppProps) {
  return (
    <Suspense fallback={null}>
      <Workspace {...props} />
    </Suspense>
  );
}

function Workspace({
  windowTransfer = null,
  resumed = null,
  installedUpdate = null,
  history: bootHistory = [],
  historyCwd: bootHistoryCwd = null,
}: AppProps) {
  const [projectCwd, setProjectCwd] = useState(
    () =>
      windowTransfer?.projectCwd ??
      resumed?.projectCwd ??
      lastProjectPath() ??
      "~",
  );
  const [recents, setRecents] = useState(() =>
    resumed?.projectCwd && looksLikeProject(resumed.projectCwd)
      ? rememberProject(resumed.projectCwd)
      : loadRecents(),
  );
  const [seed] = useState(() => {
    const cwd = lastProjectPath() ?? "~";
    const session = newDefaultSession(cwd);
    const tab = newTab(session.id);
    return { session, tab };
  });
  const [sessions, setSessions] = useState<Session[]>(
    () => windowTransfer?.sessions ?? resumed?.sessions ?? [seed.session],
  );
  const [sessionDeleteDialog, setSessionDeleteDialog] = useState<{
    title: string;
    unusedWorktree?: string;
    resolve: (choice: SessionDeleteChoice) => void;
  }>();
  const switchingWorktrees = useRef(new Map<string, string>());
  const removingWorktreePaths = useRef(new Set<string>());
  const deleteConfirmationPending = useRef(false);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(
    () => windowTransfer?.tabs ?? resumed?.tabs ?? [seed.tab],
  );
  const [projectTerminals, setProjectTerminals] = useState<ProjectTerminal[]>(
    () => windowTransfer?.projectTerminals ?? resumed?.projectTerminals ?? [],
  );
  /** Dock side a brand-new project's terminal starts with, persisted in the workspace snapshot. */
  const [lastDockSide, setLastDockSide] = useState<DockSide | null>(
    () => resumed?.lastDockSide ?? null,
  );
  const lastDockSideRef = useRef(lastDockSide);
  lastDockSideRef.current = lastDockSide;
  const [projectTerminalFocused, setProjectTerminalFocused] = useState(false);
  const [activeTabId, setActiveTabIdState] = useState(
    () => windowTransfer?.activeTabId ?? resumed?.activeTabId ?? seed.tab.id,
  );
  const [irgatViewId, setIrgatViewId] = useState<string | null>(null);
  // A Irgat opens with its overview beside the chat until it is hidden.
  const [irgatOverviewOpen, setIrgatOverviewOpen] = useState(true);
  const [irgatOverviewTab, setIrgatOverviewTab] =
    useState<IrgatOverviewTab>("all");
  // The Irgat whose settings dialog is open; another Irgat's view closes it.
  // A document opened from the chat shows on the overview's Documents tab,
  // the same page the tab opens it on.
  const onOpenIrgatArtifact = useCallback((_sessionId: string, id: string) => {
    setIrgatActivity(null);
    setIrgatShownSession(null);
    setIrgatOverviewDocument(id);
    setIrgatOverviewTab((tab) => (tab === "all" ? tab : "documents"));
    setIrgatOverviewOpen(true);
  }, []);
  // What the overview's Changes tab was last asked to show.
  const [irgatChangesRequest, setIrgatChangesRequest] =
    useState<IrgatChangesRequest>({});
  useEffect(() => {
    const listening = listen<string>(
      ARTIFACT_DELETED_EVENT,
      ({ payload: id }) => {
        const previous = sessionsRef.current;
        const updated = previous.map((session) =>
          removeArtifactCard(session, id),
        );
        if (updated.some((session, index) => session !== previous[index])) {
          sessionsRef.current = updated;
          setSessions(updated);
        }
        setIrgatOverviewDocument((current) => (current === id ? null : current));
      },
    );
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);
  const [irgatActivity, setIrgatActivity] =
    useState<IrgatActivitySelection | null>(null);
  // A launched session or a document open over the overview's list. Hiding
  // the overview leaves them, so it opens on its list again.
  const [irgatShownSession, setIrgatShownSession] = useState<string | null>(null);
  const [irgatOverviewDocument, setIrgatOverviewDocument] = useState<
    string | null
  >(null);
  const [irgatOverviewArtifact, setIrgatOverviewArtifact] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (irgatOverviewOpen) return;
    setIrgatShownSession(null);
    setIrgatOverviewDocument(null);
    setIrgatOverviewArtifact(null);
  }, [irgatOverviewOpen]);
  // Whether the shown session, rather than the Irgat's chat, holds focus.
  const [irgatShownSessionFocused, setIrgatShownSessionFocused] = useState(false);
  const shownIrgatSessionId =
    irgatViewId && irgatOverviewOpen && irgatShownSession
      ? irgatShownSession
      : undefined;
  const shownIrgatSessionIdRef = useRef(shownIrgatSessionId);
  shownIrgatSessionIdRef.current = shownIrgatSessionId;
  const onShowIrgatActivity = useCallback(
    (sessionId: string, turnId: string, blocks: Block[]) => {
      setIrgatOverviewOpen(false);
      setIrgatActivity((previous) =>
        previous?.sessionId === sessionId && previous.turnId === turnId
          ? null
          : { sessionId, turnId, blocks },
      );
    },
    [],
  );
  const irgatViewIdRef = useRef(irgatViewId);
  irgatViewIdRef.current = irgatViewId;
  const irgatViewRequest = useRef(0);
  const closeIrgatView = useCallback(() => {
    irgatViewRequest.current += 1;
    irgatViewIdRef.current = null;
    saveOpenIrgat(undefined);
    setIrgatViewId(null);
    setIrgatActivity(null);
  }, []);
  const [composerFocused, setComposerFocused] = useState(() => {
    if (windowTransfer) return true;
    if (!resumed) return false;
    const tab =
      resumed.tabs.find((entry) => entry.id === resumed.activeTabId) ??
      resumed.tabs[0];
    return (
      !!tab && resumed.sessions.some((session) => session.id === tab.focusedId)
    );
  });
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  /** Tab id -> project name, kept in sync with the rendered title tabs. */
  const tabProjectsRef = useRef(new Map<string, string>());
  const projectOfTab = useCallback(
    (id: string) => tabProjectsRef.current.get(id),
    [],
  );
  const [projectRailOpen, setProjectRailOpen] = useState(loadProjectRailOpen);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(
    loadSessionSidebarOpen,
  );
  const tabCloseScope = "project" as const;
  const [filesSearchOpen, setFilesSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [searchViewOpen, setSearchViewOpen] = useState(false);
  const [searchViewFocusToken, setSearchViewFocusToken] = useState(0);
  const [inboxViewOpen, setInboxViewOpen] = useState(false);
  // Mounted on first open so the page survives hiding the panel.
  const [browserMounted, setBrowserMounted] = useState(false);
  const [browserHost] = useState(() => {
    const host = document.createElement("div");
    host.className = "contents";
    return host;
  });
  const [browserOpen, setBrowserOpen] = useState(false);
  const onToggleBrowser = useCallback(() => {
    setBrowserMounted(true);
    setBrowserOpen((open) => !open);
  }, []);
  const [browserRequest, setBrowserRequest] = useState<{
    url: string;
    token: number;
  }>();
  useEffect(() => {
    const onOpenUrl = (event: Event) => {
      const url = (event as CustomEvent<unknown>).detail;
      if (typeof url !== "string" || !url) return;
      setBrowserMounted(true);
      setBrowserOpen(true);
      setBrowserRequest((previous) => ({
        url,
        token: (previous?.token ?? 0) + 1,
      }));
    };
    window.addEventListener(OPEN_BROWSER_URL_EVENT, onOpenUrl);
    return () => window.removeEventListener(OPEN_BROWSER_URL_EVENT, onOpenUrl);
  }, []);
  // Agents' browser.* actions that the Browser panel owns arrive here; page
  // work runs natively on the active tab, which Rust learns from the tabs.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const host = {
      show: () => {
        setBrowserMounted(true);
        setBrowserOpen(true);
      },
      openUrl: (url: string) =>
        window.dispatchEvent(
          new CustomEvent<string>(OPEN_BROWSER_URL_EVENT, { detail: url }),
        ),
      navigate: (tabId: string, url: string) =>
        browserAction(tabId, { navigate: url }),
    };
    void listenBrowserAgentRequests((request) => {
      void handleBrowserAgentRequest(request.action, request.input, host).then(
        (result) => replyBrowserAgent(request.id, { result }),
        (reason: unknown) =>
          replyBrowserAgent(request.id, {
            error: reason instanceof Error ? reason.message : String(reason),
          }),
      );
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    let agentView = "";
    const syncView = () => {
      const { activeId } = currentBrowserTabs();
      if (!activeId || activeId === agentView) return;
      agentView = activeId;
      void setBrowserAgentView(activeId).catch(() => undefined);
    };
    syncView();
    const stopTabs = subscribeBrowserTabs(syncView);
    return () => {
      disposed = true;
      unlisten?.();
      stopTabs();
    };
  }, []);
  const [linkedWorkItemPanels, setLinkedWorkItemPanels] = useState<
    ReadonlyMap<string, LinkedWorkItemPanelState>
  >(() => new Map());
  const linkedWorkItemPanelRequest = useRef(0);
  const closeLinkedWorkItemPanel = useCallback((sessionId: string) => {
    linkedWorkItemPanelRequest.current += 1;
    setLinkedWorkItemPanels((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }, []);
  const [inboxAskPortal, setInboxAskPortal] =
    useState<InboxSessionPortal | null>(null);
  const openingInboxSessions = useRef(new Map<string, Promise<string>>());
  const [notesViewOpen, setNotesViewOpen] = useState(false);
  const [automationsViewOpen, setAutomationsViewOpen] = useState(false);
  const [kanbanViewOpen, setKanbanViewOpen] = useState(false);
  const [fleetViewOpen, setFleetViewOpenState] = useState(false);
  const [mailViewOpen, setMailViewOpen] = useState(false);
  const [ideasViewOpen, setIdeasViewOpen] = useState(false);
  const [feedViewOpen, setFeedViewOpen] = useState(false);
  const [chatViewOpen, setChatViewOpen] = useState(
    () => loadFreeChatView().open,
  );
  const [freeChatId, setFreeChatId] = useState<string | undefined>(
    () => loadFreeChatView().activeId,
  );
  // Every navigation that leaves for another view closes Fleet, so Chat and
  // Mail, the other cross-project pages, ride on the same setter.
  const setFleetViewOpen = useCallback((open: boolean) => {
    setFleetViewOpenState(open);
    setChatViewOpen(false);
    setMailViewOpen(false);
    setIdeasViewOpen(false);
    setFeedViewOpen(false);
  }, []);
  const [kanbanFocus, setKanbanFocus] = useState<KanbanFocusRequest | null>(
    null,
  );
  const kanbanSessions = useKanbanSessions(sessions);
  const kanbanLinksRef = useRef(kanbanSessions.links);
  kanbanLinksRef.current = kanbanSessions.links;
  const [inspectedWorkerId, setInspectedWorkerId] = useState<string | null>(
    null,
  );
  // Set while the lead's tab is still opening; the agent tab lands on the
  // commit that brings it in.
  const [workerDetailRequest, setWorkerDetailRequest] = useState<{
    leadId: string;
    workers: OrchestrationWorkerDetail[];
  } | null>(null);
  const orchestrationRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const liveAgentsEnabled = useSyncExternalStore(
    subscribeLiveAgentsEnabled,
    loadLiveAgentsEnabled,
    () => true,
  );
  const [collapsedProjectRailMode, setCollapsedProjectRailMode] =
    useState<CollapsedProjectRailMode>(loadCollapsedProjectRailMode);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsReturnViewRef = useRef({
    search: false,
    inbox: false,
    notes: false,
    automations: false,
    kanban: false,
    fleet: false,
    chat: false,
    mail: false,
    ideas: false,
    feed: false,
  });
  const [updateNotice, setUpdateNotice] = useState(installedUpdate);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const irgatsEnabled = useSyncExternalStore(
    subscribeIrgatsEnabled,
    loadIrgatsEnabled,
    () => true,
  );
  const irgatsSnap = useSyncExternalStore(subscribeIrgats, irgatsSnapshot);
  const [providerSignInRequest, setProviderSignInRequest] = useState<{
    key: string;
    sessionId: string;
    harness: HarnessId;
  } | null>(null);
  const seenProviderSignInRequestsRef = useRef<Set<string> | null>(null);
  const seenProviderSignInRequests =
    seenProviderSignInRequestsRef.current ??
    (seenProviderSignInRequestsRef.current = new Set(
      sessions.flatMap((session) => {
        if (
          !supportsHarnessLogin(session.harness) ||
          !latestTurnNeedsHarnessLogin(session.blocks)
        ) {
          return [];
        }
        return [providerSignInRequestKey(session)];
      }),
    ));
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>(loadSettingsSection);
  const [settingsAnchor, setSettingsAnchor] = useState<SettingsAnchor | null>(
    null,
  );
  const [notificationProjectPath, setNotificationProjectPath] = useState<
    string | null
  >(null);
  const [notificationSettingsRequest, setNotificationSettingsRequest] =
    useState(0);
  const [editorNavigation, setEditorNavigation] =
    useState<EditorNavigationTarget | null>(null);
  const editorNavigationToken = useRef(0);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerInitialQuery, setFilePickerInitialQuery] = useState("");
  const [filePickerResetToken, setFilePickerResetToken] = useState(0);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(
    () => new Set(windowTransfer?.dirtyFileIds ?? []),
  );
  // Not carried across a window transfer the way dirty state is: the editor
  // re-lints whatever it mounts, so the counts rebuild themselves.
  const [fileErrorCounts, setFileErrorCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [history, setHistory] = useState<SessionSummary[]>(() => bootHistory);
  const [, refreshRemoteTabTitles] = useState(0);
  useEffect(() => {
    const updated = () => refreshRemoteTabTitles((value) => value + 1);
    window.addEventListener(REMOTE_HISTORY_UPDATED, updated);
    return () => window.removeEventListener(REMOTE_HISTORY_UPDATED, updated);
  }, []);
  const [storedLinkedSessions, setStoredLinkedSessions] = useState<
    SessionSummary[]
  >(() => bootHistory.filter((session) => session.linkedWorkItem));
  /**
   * Projects whose rows are already in `history`. This has to be state, not a
   * ref: `sidebarCwd` is derived during render, so the frame that first shows
   * a new project must already know the listing has not arrived yet.
   */
  const btwRequestsRef = useRef(
    new Map<string, { sessionId: string; controller: AbortController }>(),
  );
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(
    () =>
      bootHistoryCwd
        ? new Set([normalizeProjectPath(bootHistoryCwd)])
        : new Set(),
  );
  const loadedProjectsRef = useRef(loadedProjects);
  loadedProjectsRef.current = loadedProjects;
  /** Project whose listing failed, so the error cannot leak to another one. */
  const [historyErrorCwd, setHistoryErrorCwd] = useState<string | null>(null);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const linkedSessionUpdatesRef = useRef<
    ReadonlyMap<string, LinkedSessionUpdate>
  >(new Map());
  const linkedWorkItemActivityFetches = useRef(new Map<string, number>());
  const queueDispatchingRef = useRef(new Set<string>());
  const [queueDispatchVersion, setQueueDispatchVersion] = useState(0);
  const usageLimitSnapshot = useUsageLimitSnapshot();
  const usageResumingRef = useRef(new Set<string>());
  const usageResetLookups = useRef(new WeakSet<UsageLimit>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const dirtyFilesRef = useRef(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  const projectTerminalsRef = useRef(projectTerminals);
  projectTerminalsRef.current = projectTerminals;
  const projectTerminalFocusedRef = useRef(projectTerminalFocused);
  projectTerminalFocusedRef.current = projectTerminalFocused;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  useLayoutEffect(() => {
    const migration = detachIrgatTabs(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      (cwd) => newDefaultSession(cwd),
    );
    if (!migration) return;
    tabsRef.current = migration.tabs;
    sessionsRef.current = [...sessions, ...migration.addedSessions];
    setTabs(migration.tabs);
    setSessions(sessionsRef.current);
    setActiveTabIdState(migration.activeTabId);
    if (migration.agentViewId) {
      irgatViewIdRef.current = migration.agentViewId;
      setIrgatViewId(migration.agentViewId);
    }
  }, [tabs, sessions, activeTabId, projectCwd]);

  const projectWorktree = useWorktreeFocus(projectCwd);
  /** Tab or session id -> the workspace it was opened or moved in. A tab
   * belongs to the workspace it was opened in, whatever worktree it runs in:
   * opening a session, or moving one from its composer, never switches the
   * workspace. Unpinned tabs (restored ones) group by their own worktree. */
  // Only the default workspace's tabs were saved, so every restored tab
  // belongs to it, including one its composer moved to a worktree.
  const [restoredPins] = useState(
    () =>
      new Map(
        tabs.flatMap((tab) => {
          const project = workspaceTabCwd(tab, sessions);
          return project && !isRemoteProjectPath(project)
            ? [[tab.id, project] as const]
            : [];
        }),
      ),
  );
  const workspacePins = useRef(restoredPins);
  const tabWorkspace = useCallback(
    (tab: WorkspaceTab, list: readonly Session[]) => {
      const pinnedTab = workspacePins.current.get(tab.id);
      if (pinnedTab) return pinnedTab;
      for (const id of leafIds(tab.layout)) {
        const pinned = workspacePins.current.get(id);
        if (pinned) return pinned;
      }
      return workspaceTabWorktree(tab, list);
    },
    [],
  );
  const tabWorktreeOf = useCallback(
    (tab: WorkspaceTab) => tabWorkspace(tab, sessionsRef.current),
    [tabWorkspace],
  );
  /** Saved tabs: the app reopens on each project's default workspace, so
   * tabs from other worktrees close with it instead of piling up. */
  const keepWorkspaceTab = useCallback(
    (tab: WorkspaceTab) => {
      const project = workspaceTabCwd(tab, sessionsRef.current);
      if (!project || isRemoteProjectPath(project)) return true;
      const workspace = tabWorkspace(tab, sessionsRef.current);
      return !workspace || sameProjectPath(workspace, project);
    },
    [tabWorkspace],
  );

  const workspaceNavigation = useWorkspaceNavigation({
    project: projectCwd,
    activeTabId,
    tabs,
    sessions,
    pins: workspacePins.current,
    tabWorkspace,
    moveSession: (id, tree, isCurrent) =>
      onWorktreeChange(id, tree, false, isCurrent),
    activateTab: (id) => {
      if (tabsRef.current.some((tab) => tab.id === id)) {
        activateTab(id, undefined, "workspace");
      } else {
        // A newly created tab has not rendered into tabsRef yet.
        closeIrgatView();
        setActiveTabIdState(id);
        setComposerFocused(true);
      }
    },
    createTab: (project, focus) => createWorkspaceTab(project, focus),
  });
  // Every ordinary tab activation supersedes an unfinished workspace request,
  // including opening a session in the same tab or selecting a project.
  const setActiveTabId = useCallback(
    (id: string) => {
      workspaceNavigation.cancel();
      closeIrgatView();
      setActiveTabIdState(id);
    },
    [workspaceNavigation.cancel, closeIrgatView],
  );

  const projectCwdRef = useRef(projectCwd);
  projectCwdRef.current = projectCwd;
  const searchViewOpenRef = useRef(searchViewOpen);
  searchViewOpenRef.current = searchViewOpen;
  const inboxViewOpenRef = useRef(inboxViewOpen);
  inboxViewOpenRef.current = inboxViewOpen;
  const foregroundSurfaceRef = useRef<{
    workspaceVisible: boolean;
    standaloneSessionId?: string;
    /** A session shown beside the Irgat's chat. */
    sideSessionId?: string;
  }>({ workspaceVisible: true });
  foregroundSurfaceRef.current = {
    workspaceVisible:
      !searchViewOpen &&
      !inboxViewOpen &&
      !notesViewOpen &&
      !automationsViewOpen &&
      !kanbanViewOpen &&
      !fleetViewOpen &&
      !mailViewOpen &&
      !ideasViewOpen &&
      !feedViewOpen &&
      !chatViewOpen &&
      !settingsOpen &&
      !irgatViewId,
    standaloneSessionId: inboxViewOpen
      ? inboxAskPortal?.sessionId
      : chatViewOpen && !settingsOpen && !searchViewOpen
        ? freeChatId
        : !searchViewOpen &&
            !notesViewOpen &&
            !automationsViewOpen &&
            !kanbanViewOpen &&
            !fleetViewOpen &&
            !mailViewOpen &&
            !ideasViewOpen &&
            !feedViewOpen &&
            !chatViewOpen &&
            !settingsOpen
          ? (irgatViewId ?? undefined)
          : undefined,
    sideSessionId:
      !inboxViewOpen &&
      !searchViewOpen &&
      !notesViewOpen &&
      !automationsViewOpen &&
      !kanbanViewOpen &&
      !fleetViewOpen &&
      !mailViewOpen &&
      !ideasViewOpen &&
      !feedViewOpen &&
      !chatViewOpen &&
      !settingsOpen
        ? shownIrgatSessionId
        : undefined,
  };
  const chatViewOpenRef = useRef(chatViewOpen);
  chatViewOpenRef.current = chatViewOpen;
  const freeChatIdRef = useRef(freeChatId);
  freeChatIdRef.current = freeChatId;
  /** Shows the Chat page, on `id` when given, in place of every other view. */
  const openFreeChat = useCallback(
    (id?: string) => {
      workspaceNavigation.cancel();
      if (irgatViewIdRef.current) closeIrgatView();
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpenState(false);
      setMailViewOpen(false);
      setIdeasViewOpen(false);
      setFeedViewOpen(false);
      if (id !== undefined) setFreeChatId(id);
      setChatViewOpen(true);
      setComposerFocused(true);
      setComposerFocusToken((token) => token + 1);
    },
    [closeIrgatView],
  );
  const notesViewOpenRef = useRef(notesViewOpen);
  notesViewOpenRef.current = notesViewOpen;
  const automationsViewOpenRef = useRef(automationsViewOpen);
  automationsViewOpenRef.current = automationsViewOpen;
  const kanbanViewOpenRef = useRef(kanbanViewOpen);
  kanbanViewOpenRef.current = kanbanViewOpen;
  const fleetViewOpenRef = useRef(fleetViewOpen);
  fleetViewOpenRef.current = fleetViewOpen;
  const mailViewOpenRef = useRef(mailViewOpen);
  mailViewOpenRef.current = mailViewOpen;
  const ideasViewOpenRef = useRef(ideasViewOpen);
  ideasViewOpenRef.current = ideasViewOpen;
  const feedViewOpenRef = useRef(feedViewOpen);
  feedViewOpenRef.current = feedViewOpen;
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const sessionNavigationIdsRef = useRef<readonly string[]>([]);
  const filePickerOpenRef = useRef(filePickerOpen);
  filePickerOpenRef.current = filePickerOpen;
  const whatsNewVersionRef = useRef(whatsNewVersion);
  whatsNewVersionRef.current = whatsNewVersion;
  useEffect(() => {
    const liveSessionIds = new Set(sessions.map((session) => session.id));
    for (const [key, request] of btwRequestsRef.current) {
      if (liveSessionIds.has(request.sessionId)) continue;
      request.controller.abort();
      btwRequestsRef.current.delete(key);
    }
  }, [sessions]);

  useEffect(
    () => () => {
      for (const request of btwRequestsRef.current.values()) {
        request.controller.abort();
      }
      btwRequestsRef.current.clear();
      void stopHarnessTextPrompts();
    },
    [],
  );

  useEffect(() => {
    if (!notesEnabled) setNotesViewOpen(false);
  }, [notesEnabled]);

  useEffect(
    () =>
      preloadNavigationWhenIdle([
        InboxView.preload,
        LinkedWorkItemPanel.preload,
        AutomationsView.preload,
        listAutomations,
        ...(notesEnabled ? [NotesView.preload, loadNotes] : []),
      ]),
    [notesEnabled],
  );

  const projectReturnRef = useRef<ProjectReturnMemory>(
    resumed?.projectReturnMemory ?? new Map(),
  );
  const readProjectReturnMemory = useCallback(() => {
    projectReturnRef.current = reconcileProjectReturn({
      memory: projectReturnRef.current,
      tabs: tabsRef.current,
      sessions: sessionsRef.current,
      activeTabId: activeTabIdRef.current,
    });
    return projectReturnRef.current;
  }, []);
  useEffect(() => {
    readProjectReturnMemory();
  }, [activeTabId, tabs, sessions, readProjectReturnMemory]);

  const tabVisitRef = useRef(emptyTabVisitHistory(activeTabId));
  const tabVisitFromHistoryRef = useRef(false);
  const [tabVisitNav, setTabVisitNav] = useState({
    canBack: false,
    canForward: false,
  });
  const turnGen = useRef(new Map<string, number>());
  const editedResends = useRef(createEditedResendCoordinator()).current;
  const lastPersisted = useRef(new Map<string, string>());
  const lastBoundProvider = useRef(new Map<string, string>());
  const lastPersistedUserBlock = useRef(new Map<string, string>());
  const inFlightSyncKey = useRef<string | null>(null);
  const sawInFlight = useRef(false);
  const workspaceSyncKey = useRef<string | null>(null);
  const observedSessions = useRef(new Map<string, Session>());
  const pendingPersist = useRef(new Map<string, Session>());
  const pendingPersistSince = useRef<number | undefined>(undefined);
  const activeTurnSnapshots = useRef(new Map<string, number>());
  const removingSessionIds = useRef(new Set<string>());
  const loadedSessionCache = useRef(new Map<string, Session>());
  const sessionLoads = useRef(new Map<string, Promise<Session | null>>());
  const sessionLoadEpochs = useRef(new Map<string, number>());
  const openingSessionIds = useRef(new Set<string>());
  const activeSessionPrefetch = useRef<Promise<Session | null> | null>(null);
  const [transcriptPool] = useState(() => new TranscriptPool());
  // Visible output advances per frame; hidden streams keep their own cadence.
  const [harnessEvents] = useState(
    () =>
      new HarnessEventQueue(
        (sessionId) => {
          const tab = tabsRef.current.find(
            (entry) => entry.id === activeTabIdRef.current,
          );
          // Standalone conversations live outside the workspace tab tree.
          return (
            foregroundSurfaceRef.current.standaloneSessionId === sessionId ||
            foregroundSurfaceRef.current.sideSessionId === sessionId ||
            (foregroundSurfaceRef.current.workspaceVisible &&
              !!tab &&
              (leafIds(tab.layout).includes(sessionId) ||
                tab.editorPanes.some((pane) =>
                  pane.files.some(
                    (file) =>
                      file.id === pane.activeFileId &&
                      file.agent?.sessionId === sessionId,
                  ),
                )))
          );
        },
        (batches) => {
          const previous = sessionsRef.current;
          const next = updateSessionState(
            sessionsRef,
            setSessions,
            (current) => {
              const updated = current.map((session) => {
                const events = batches.get(session.id);
                return events ? applyHarnessEvents(session, events) : session;
              });
              return updated.some((session, index) => session !== current[index])
                ? updated
                : current;
            },
          );
          if (next !== previous) syncDockBadge(next);
        },
      ),
  );
  // Cap warm agent CLIs, sparing the conversations on screen.
  useEffect(() => {
    configureHarnessIdlePark({
      limit: loadIdleAgentLimit,
      keep: harnessEvents.isForeground,
    });
  }, [harnessEvents]);
  const skipForgetSessionIds = useRef(new Set<string>());
  const importedSessionsApplied = useRef(false);
  const projectLocationSyncs = useRef(
    new Map<string, ReturnType<typeof synchronizeProjectLocation>>(),
  );
  const submitAfterProjectSyncRef = useRef<Submit>(() => false);
  const completionGateSubmitRef = useRef<Submit>(() => false);
  const completionGate = useRef(
    createCompletionGateController({
      runCheck: runCheckCommand,
      cancelCheck: cancelCheckCommand,
      submitBounce: (sessionId, prompt) =>
        completionGateSubmitRef.current(sessionId, prompt, [], {
          completionGateBounce: true,
        }),
      isCurrent: (sessionId, turn) => turnGen.current.get(sessionId) === turn,
    }),
  ).current;
  useEffect(() => {
    registerCompletionGateController(completionGate);
    return () => registerCompletionGateController(null);
  }, [completionGate]);

  useEffect(() => {
    for (const project of recents) {
      void rememberProjectLocation(project.path).catch(() => undefined);
    }
  }, [recents]);

  useEffect(() => {
    if (importedSessionsApplied.current) return;
    const imported = windowTransfer?.sessions ?? resumed?.sessions;
    if (!imported?.length) return;
    importedSessionsApplied.current = true;
    for (const session of imported) {
      observedSessions.current.set(session.id, session);
      lastPersisted.current.set(session.id, persistFingerprint(session));
      const userId = lastUserBlockId(session);
      if (userId) lastPersistedUserBlock.current.set(session.id, userId);
      if (session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
    }
  }, [windowTransfer, resumed]);

  const flushHarnessEvents = harnessEvents.flush;
  const flushForegroundHarnessEvents = harnessEvents.flushForeground;

  const stopSessionForRemoval = useCallback(
    async (sessionId: string): Promise<Session | undefined> => {
      await orchestrator.stopForSession(sessionId);
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!open?.busy) return open;

      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      await Promise.all(
        sessionChildHarnesses(open).map(async (harness) => {
          await cancelHarnessTurn(harness, sessionId).catch(() => undefined);
          await stopHarnessSession(harness, sessionId);
        }),
      );
      await finishSessionTurn(sessionId, sessionWorkCwd(open));
      flushHarnessEvents();
      return sessionsRef.current.find((session) => session.id === sessionId);
    },
    [flushHarnessEvents],
  );

  const enqueueHarnessEvent = harnessEvents.enqueue;

  useEffect(() => {
    if (resumed?.sessions.length) bindResumedSessions(resumed.sessions);
    const stopBridge = startHarnessBridge();
    const reap = () => {
      if (isAppQuitting()) return;
      void persistQuitState(
        sessionsRef.current,
        tabsRef.current,
        activeTabIdRef.current,
        projectCwdRef.current,
        readProjectReturnMemory(),
        "unload",
        projectTerminalsRef.current,
        lastDockSideRef.current ?? undefined,
      ).finally(() => {
        void reapWindowRuntime(
          sessionsRef.current,
          tabsRef.current,
          projectTerminalsRef.current,
        );
      });
    };
    window.addEventListener("pagehide", reap);
    window.addEventListener("beforeunload", reap);
    return () => {
      window.removeEventListener("pagehide", reap);
      window.removeEventListener("beforeunload", reap);
      stopBridge();
      harnessEvents.cancelScheduled();
    };
  }, [resumed, readProjectReturnMemory, harnessEvents]);

  useEffect(() => {
    let cancelled = false;
    // Retain known existing Irgat threads before hiding their original entries.
    // Sending a turn uses the same migration lock, so it can safely overlap.
    void (async () => {
      for (const irgat of listIrgats()) {
        if (cancelled) return;
        if (!irgat.sessionId) continue;
        try {
          const session =
            sessionsRef.current.find((s) => s.id === irgat.sessionId) ??
            (await getSession(irgat.sessionId));
          if (
            !session ||
            cancelled ||
            sessionsRef.current.find((s) => s.id === session.id)?.busy
          )
            continue;
          const cwd = sessionWorkCwd(session);
          if (!cwd || cwd === "~") continue;
          const threadIds = new Set<string>();
          if (session.harness === "codex" && session.providerSessionId)
            threadIds.add(session.providerSessionId);
          for (const block of session.blocks) {
            for (const thread of block.btwThreads ?? []) {
              if (
                (thread.harness ?? session.harness) === "codex" &&
                thread.providerThreadId
              )
                threadIds.add(thread.providerThreadId);
            }
          }
          for (const threadId of threadIds) {
            if (cancelled) return;
            await migrateIrgatxSession({
              sessionId: session.id,
              threadId,
              cwd,
              providerAccountId: session.providerAccountId,
            });
          }
        } catch (error) {
          // Keep the original context intact; the next native operation retries.
          console.warn("Could not migrate saved Irgat Codex context", error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [irgatsSnap]);

  useEffect(() => {
    void probeHarnessAvailability();
    // Only the harnesses already in this window. Probing every installed CLI
    // at boot left unused agents (especially Pi) running in the background.
    const harnesses = [
      ...new Set(sessionsRef.current.map((session) => session.harness)),
    ];
    void refreshHarnessCatalogs(harnesses).then(() => {
      setSessions((prev) =>
        prev.map((session) => {
          if (!isLiveHarness(session.harness)) return session;
          const resolved = resolveModel(session.harness, session.model);
          const modelSettings = mergeModelSettings(
            resolved,
            session.modelSettings,
          );
          if (
            resolved.id === session.model &&
            sameSettings(modelSettings, session.modelSettings)
          ) {
            return session;
          }
          return { ...session, model: resolved.id, modelSettings };
        }),
      );
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const active =
    sessions.find((session) => session.id === activeTab?.focusedId) ??
    sessions.find(
      (session) => activeTab && leafIds(activeTab.layout).includes(session.id),
    );
  const irgatViewSession = irgatViewId
    ? sessions.find((session) => session.id === irgatViewId)
    : undefined;
  const irgatCovers = !!irgatViewId;
  const irgatViewCwd = irgatViewSession ? sessionWorkCwd(irgatViewSession) : "";
  const freeChat = freeChatId
    ? sessions.find((session) => session.id === freeChatId)
    : undefined;
  const browserShown =
    browserOpen &&
    !searchViewOpen &&
    !settingsOpen &&
    !inboxViewOpen &&
    !notesViewOpen &&
    !automationsViewOpen &&
    !kanbanViewOpen &&
    !fleetViewOpen &&
    !mailViewOpen &&
    !ideasViewOpen &&
    !feedViewOpen &&
    (!chatViewOpen || !!freeChat);
  noteBrowserShown(browserShown);
  // An open chat or a covering Irgat shows its own folder's terminal dock, so
  // the terminal opens where its status bar is instead of leaving the view.
  const currentViewDock = viewDock({
    projectCwd,
    irgatCwd: irgatCovers ? irgatViewCwd : undefined,
    chatCwd: chatViewOpen && freeChat ? freeChat.cwd : undefined,
  });
  const dockPath = currentViewDock.path;
  const viewDockRef = useRef(currentViewDock);
  viewDockRef.current = currentViewDock;
  const dockTerminalAllowed = canOpenDockTerminal(currentViewDock);
  const currentProjectDock = findProjectTerminal(projectTerminals, dockPath);
  const dockVisible = !!currentProjectDock?.open;
  const noteChatTargets = useMemo(() => {
    if (!notesViewOpen) return [];
    return openNoteChatTargets({
      sessions,
      tabs,
      activeTabId,
      ...(irgatViewId
        ? {
            irgat: {
              sessionId: irgatViewId,
              name: irgatForSession(irgatViewId)?.name,
            },
          }
        : {}),
    });
  }, [notesViewOpen, irgatViewId, sessions, tabs, activeTabId]);
  const activeTabSessionIds = activeTab ? leafIds(activeTab.layout) : [];
  const activeLinkedWorkItemPanel = activeTab
    ? (linkedWorkItemPanels.get(activeTab.focusedId) ??
      [...linkedWorkItemPanels.values()]
        .reverse()
        .find((panel) => activeTabSessionIds.includes(panel.sessionId)) ??
      null)
    : null;

  // Panels are tab-local UI. Keep mounted panels alive while their tab is in
  // the workspace so switching away preserves the fetched issue and its UI
  // state, then discard them when their session leaves every open tab.
  useEffect(() => {
    const openSessionIds = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
    setLinkedWorkItemPanels((current) => {
      if ([...current.keys()].every((id) => openSessionIds.has(id))) {
        return current;
      }
      return new Map([...current].filter(([id]) => openSessionIds.has(id)));
    });
  }, [tabs]);

  const sessionDefaults = active ?? sessions[0];

  useEffect(() => {
    const openSessionForAddToChat = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (!detail?.text) return;
      // The Irgat in full view takes it; a new session would open out of sight.
      if (irgatViewIdRef.current) return;

      const result = applyAddToChatRequest({
        sessions: sessionsRef.current,
        tabs: tabsRef.current,
        activeTabId: activeTabIdRef.current,
        projectCwd: projectCwdRef.current,
        fallbackCwd: sessionDefaults?.cwd,
        defaultRuntimeMode: sessionDefaults?.runtimeMode,
        text: detail.text,
        mode: detail.mode,
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    };

    window.addEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
    return () =>
      window.removeEventListener(ADD_TO_CHAT_EVENT, openSessionForAddToChat);
  }, [sessionDefaults?.cwd, sessionDefaults?.runtimeMode]);

  const activeSkillContext = active
    ? nativeSkillContextForSession(active)
    : null;
  const activeSkillCwd = activeSkillContext?.cwd;

  useEffect(() => {
    if (!activeSkillContext || !activeSkillCwd) return;
    warmNativeSkills(activeSkillContext);
  }, [activeSkillCwd, active?.id, active?.harness]);

  const activeFile = activeTab ? focusedFileTab(activeTab) : undefined;
  // A Irgat belongs to no project, so its view keeps the project in place.
  const sidebarCwd =
    activeFile?.projectCwd ?? activeFile?.cwd ?? active?.cwd ?? projectCwd;
  const sidebarCwdRef = useRef(sidebarCwd);
  sidebarCwdRef.current = sidebarCwd;
  const [sidebarTabSelection, setSidebarTabSelection] = useState<{
    project: string;
    tab: SidebarTabId;
  }>(() => ({
    project: pathKey(sidebarCwd),
    tab: loadProjectSidebarTab(sidebarCwd),
  }));
  const sidebarTab =
    sidebarTabSelection.project === pathKey(sidebarCwd)
      ? sidebarTabSelection.tab
      : loadProjectSidebarTab(sidebarCwd);
  const setSidebarTab = useCallback((tab: SidebarTabId, project?: string) => {
    const cwd = project ?? sidebarCwdRef.current;
    saveProjectSidebarTab(cwd, tab);
    setSidebarTabSelection({
      project: pathKey(cwd),
      tab: tab === "inbox" ? "sessions" : tab,
    });
  }, []);
  // The board opens on the project the sidebar shows; an Irgat chat or a
  // file outside any project leaves it on the current one.
  const boardCwd = looksLikeProject(sidebarCwd) ? sidebarCwd : projectCwd;
  const sidebarCwdKey =
    sidebarCwd && sidebarCwd !== "~" ? normalizeProjectPath(sidebarCwd) : null;
  const historyFailed =
    sidebarCwdKey != null && historyErrorCwd === sidebarCwdKey;
  // True from the very first frame that shows a project we have never listed,
  // so the sidebar can stay blank instead of flashing "No sessions yet".
  const historyPending =
    sidebarCwdKey != null &&
    !loadedProjects.has(sidebarCwdKey) &&
    !historyFailed;
  const gitCwd =
    activeFile?.cwd ?? (active ? sessionWorkCwd(active) : sidebarCwd);
  const terminalCwd = newTerminalCwd({
    activeFile,
    session: active,
    fallback: sidebarCwd,
  });
  const gitCwdBranches = useProjectBranches(
    gitCwd,
    Boolean(gitCwd) && gitCwd !== "~" && !isRemoteProjectPath(sidebarCwd),
  );
  const explorerRootLabel =
    active?.worktreeCwd && sameProjectPath(gitCwd, sessionWorkCwd(active))
      ? active.branch || gitCwdBranches?.current || undefined
      : undefined;
  const remoteFilesProject = remoteProjectFor(sidebarCwd);
  const filesCwd = remoteFilesProject
    ? isRemoteProjectPath(gitCwd)
      ? gitCwd
      : remotePath(
          remoteFilesProject.environmentId,
          remoteTabCwd(sidebarCwd, active?.id) ??
            (gitCwd && gitCwd !== sidebarCwd ? gitCwd : remoteFilesProject.cwd),
        )
    : gitCwd;
  const gitCwdRef = useRef(filesCwd);
  gitCwdRef.current = filesCwd;
  const projectBranches = useProjectBranches(
    sidebarCwd,
    Boolean(sidebarCwd) && sidebarCwd !== "~",
  );

  const nextBusySessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.busy) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const busySessionIdsRef = useRef(nextBusySessionIds);
  if (!setsEqual(busySessionIdsRef.current, nextBusySessionIds)) {
    busySessionIdsRef.current = nextBusySessionIds;
  }
  const busySessionIds = busySessionIdsRef.current;

  /** Probe the active session's harness for its live model catalog whenever
   * the active harness changes. Catalogs load lazily (probing spawns a CLI
   * process) and the boot refresh runs before restored sessions land, so a
   * fresh session would otherwise show only the built-in fallback model
   * until the picker happened to be opened. Idempotent: refreshHarnessCatalogs
   * dedupes via hasLiveCatalog and its inflight map. */
  const activeHarness = active?.harness;
  useEffect(() => {
    if (!activeHarness || !isLiveHarness(activeHarness)) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [activeHarness]);

  const usageProviders = useMemo(() => {
    if (
      active?.harness === "claude" ||
      active?.harness === "codex" ||
      active?.harness === "opencode" ||
      active?.harness === "devin"
    ) {
      return [active.harness];
    }
    return [];
  }, [active?.harness]);
  const usageSession = useMemo(() => {
    if (!active) return undefined;
    return {
      id: active.id,
      harness: active.harness,
      model: active.model,
      authRequired: latestTurnNeedsHarnessLogin(active.blocks),
      providerAccountId:
        active.providerAccountId ??
        (active.blocks.some((block) => block.role === "user")
          ? DEFAULT_PROVIDER_ACCOUNT_ID
          : undefined),
    };
  }, [
    active?.id,
    active?.harness,
    active?.model,
    active?.blocks,
    active?.providerAccountId,
  ]);
  const activeProviderSignInRequest = useMemo(() => {
    if (
      !active ||
      !supportsHarnessLogin(active.harness) ||
      !latestTurnNeedsHarnessLogin(active.blocks)
    ) {
      return null;
    }
    return {
      key: providerSignInRequestKey(active),
      sessionId: active.id,
      harness: active.harness,
    };
  }, [active]);
  useEffect(() => {
    if (!activeProviderSignInRequest) return;
    if (seenProviderSignInRequests.has(activeProviderSignInRequest.key)) {
      return;
    }
    seenProviderSignInRequests.add(activeProviderSignInRequest.key);
    setProviderSignInRequest(activeProviderSignInRequest);
  }, [activeProviderSignInRequest, seenProviderSignInRequests]);
  useEffect(() => {
    if (
      providerSignInRequest &&
      active?.id !== providerSignInRequest.sessionId
    ) {
      setProviderSignInRequest(null);
    }
  }, [active?.id, providerSignInRequest]);
  const runningTerminals = useMemo(() => {
    const files: FilePaneTab[] = [];
    const dock = findProjectTerminal(projectTerminals, projectCwd);
    if (dock) files.push(...dock.pane.files);
    for (const tab of tabs) {
      for (const pane of tab.terminalPanes ?? []) {
        files.push(...pane.files);
      }
    }
    return listRunningTerminals(files);
  }, [projectCwd, projectTerminals, tabs]);
  const runningTerminalOpen = useMemo(() => {
    const ids = new Set(runningTerminals.map((terminal) => terminal.id));
    if (
      currentProjectDock?.open &&
      currentProjectDock.pane.files.some((file) => ids.has(file.id))
    ) {
      return true;
    }
    const focused = activeTab ? focusedFileTab(activeTab) : undefined;
    return !!focused && ids.has(focused.id);
  }, [activeTab, currentProjectDock, runningTerminals]);

  const nextApprovalSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (sessionNeedsInput(session)) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const approvalSessionIdsRef = useRef(nextApprovalSessionIds);
  if (!setsEqual(approvalSessionIdsRef.current, nextApprovalSessionIds)) {
    approvalSessionIdsRef.current = nextApprovalSessionIds;
  }
  const approvalSessionIds = approvalSessionIdsRef.current;

  const nextInterruptedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (sessionInterruption(session)) ids.add(session.id);
    }
    return ids;
  }, [sessions]);
  const interruptedSessionIdsRef = useRef(nextInterruptedSessionIds);
  if (!setsEqual(interruptedSessionIdsRef.current, nextInterruptedSessionIds)) {
    interruptedSessionIdsRef.current = nextInterruptedSessionIds;
  }
  const interruptedSessionIds = interruptedSessionIdsRef.current;

  const activeSessionId = inboxViewOpen
    ? inboxAskPortal?.sessionId
    : chatViewOpen
      ? freeChatId
      : shownIrgatSessionId && irgatShownSessionFocused
        ? shownIrgatSessionId
        : (irgatViewSession?.id ?? active?.id);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Sessions that belong in the UI: a habit's hidden run is not one of them,
  // and asks through its Irgat's chat rather than on its own.
  const promptableSessions = useMemo(
    () => sessions.filter((session) => !session.ephemeral),
    [sessions],
  );
  const habitApprovals = useHabitApprovals();
  const fleetNeedsYouCount = useMemo(
    () => countNeedsYou(promptableSessions) + habitApprovals.length,
    [promptableSessions, habitApprovals],
  );
  useInputNotifications(promptableSessions, activeSessionId);
  useTerminalAgentNotifications();

  // Cache the OS decision so a turn ending later can skip a denied banner;
  // still undecided, ask now so the first banner is not lost to the prompt.
  useEffect(() => {
    if (loadNotificationsEnabled()) void primeNotificationPermission();
  }, []);
  const unseenFinishedIds = useUnseenFinishedSessions(
    sessions,
    busySessionIds,
    activeSessionId,
  );
  const irgatSessionIds = useMemo(
    () =>
      new Set(
        listIrgats().flatMap(allIrgatSessionIds),
      ),
    // The roster is read through its snapshot.
    [irgatsSnap],
  );
  // How many replies each Irgat has that the user has not read, for the rail.
  const irgatReplies = useUnseenReplyCounts(
    irgatSessionIds,
    busySessionIds,
    activeSessionId,
  );

  const liveAgentRows = useMemo(
    () =>
      liveAgentsEnabled
        ? liveAgentsFromSessions(
            promptableSessions,
            unseenFinishedIds,
            new Set(
              listIrgats().flatMap(allIrgatSessionIds),
            ),
          )
        : [],
    [liveAgentsEnabled, promptableSessions, unseenFinishedIds, irgatsSnap],
  );
  // Rebuilt for every streamed batch; identity only moves when a row does.
  const liveAgents = useStableValue(liveAgentRows);

  const hiddenApprovalToasts = useMemo(
    () =>
      hiddenApprovalNotices(
        irgatViewId
          ? promptableSessions.filter((session) => session.id !== irgatViewId)
          : promptableSessions,
        irgatCovers ? "" : activeTabId,
        tabs,
        composerFocused,
      ),
    [
      promptableSessions,
      activeTabId,
      tabs,
      composerFocused,
      irgatViewId,
      irgatCovers,
    ],
  );
  const [reminderNoticesHeight, setReminderNoticesHeight] = useState(0);
  const [inboxResurfaceHeight, setInboxResurfaceHeight] = useState(0);
  const [harnessUpdateHeight, setHarnessUpdateHeight] = useState(0);

  useEffect(() => {
    syncDockBadge(sessions);
  }, [sessions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        setWindowFocused(focused);
        if (focused) {
          flushForegroundHarnessEvents();
          syncDockBadge(sessionsRef.current);
          if (
            document.activeElement === document.body &&
            !projectTerminalFocusedRef.current &&
            !searchViewOpenRef.current &&
            !inboxViewOpenRef.current &&
            !notesViewOpenRef.current &&
            !automationsViewOpenRef.current &&
            !kanbanViewOpenRef.current &&
            !fleetViewOpenRef.current &&
            !mailViewOpenRef.current &&
            !ideasViewOpenRef.current &&
            !feedViewOpenRef.current &&
            !settingsOpenRef.current
          ) {
            setComposerFocused(true);
            setComposerFocusToken((token) => token + 1);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [flushForegroundHarnessEvents]);

  useEffect(() => {
    const onVisible = () => {
      // Flush on hiding too: WebKit can suspend a pending animation frame,
      // leaving the last output stranded until another event or activation.
      flushHarnessEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [flushHarnessEvents]);

  useLayoutEffect(() => {
    // Catch up only the newly visible panes before paint. Other streams keep
    // their background timer instead of adding work to this tab switch.
    flushForegroundHarnessEvents();
  }, [
    activeTabId,
    irgatViewId,
    inboxViewOpen,
    inboxAskPortal?.sessionId,
    shownIrgatSessionId,
    searchViewOpen,
    notesViewOpen,
    automationsViewOpen,
    kanbanViewOpen,
    fleetViewOpen,
    mailViewOpen,
    ideasViewOpen,
    feedViewOpen,
    chatViewOpen,
    freeChatId,
    settingsOpen,
    flushForegroundHarnessEvents,
  ]);

  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    const releaseQuit = setQuitWorkspace(
      () => sessionsRef.current,
      () => tabsRef.current,
      () => activeTabIdRef.current,
      () => projectCwdRef.current,
      () => projectTerminalsRef.current,
      readProjectReturnMemory,
      flushHarnessEvents,
      () => lastDockSideRef.current,
      keepWorkspaceTab,
    );
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        // Listening here makes close our job. Letting the default path run
        // calls JS `window.destroy`, which Tauri denies without a permission.
        event.preventDefault();
        if (
          IS_MAC &&
          (await invoke<boolean>("irgat_chat_keep_alive").catch(() => false))
        ) {
          flushHarnessEvents();
          void persistLiveTranscripts(sessionsRef.current);
          void hideCurrentWindow();
          return;
        }
        const toTray = loadCloseToTray();
        if (hasInFlightSessions(sessionsRef.current)) {
          flushHarnessEvents();
          if (!toTray && !IS_MAC) {
            void closeBusyWindow();
            return;
          }
          // Not `persistQuitState`: that marks the live turns interrupted.
          void persistLiveTranscripts(sessionsRef.current);
          void hideCurrentWindow();
          return;
        }
        void persistQuitState(
          sessionsRef.current,
          tabsRef.current,
          activeTabIdRef.current,
          projectCwdRef.current,
          readProjectReturnMemory(),
          "unload",
          projectTerminalsRef.current,
          lastDockSideRef.current ?? undefined,
          keepWorkspaceTab,
        ).finally(() => {
          void (toTray ? hideCurrentWindow() : closeCurrentWindow());
        });
      })
      .then((fn) => {
        unlistenClose = fn;
      });
    return () => {
      releaseQuit();
      unlistenClose?.();
    };
  }, [flushHarnessEvents, keepWorkspaceTab, readProjectReturnMemory]);

  const refreshHistory = useCallback(async (cwd: string) => {
    if (!cwd || cwd === "~") return;
    // `history` holds every visited project's rows and the sidebar filters it
    // by cwd, so a project loaded once paints from cache on the way back and
    // revalidates quietly underneath the cards already on screen. Whether the
    // first load is still pending is derived from `loadedProjects`, not
    // tracked here — a status set from this effect lands a render too late to
    // suppress the empty state.
    const key = normalizeProjectPath(cwd);
    setHistoryErrorCwd((prev) => (prev === key ? null : prev));
    try {
      const rows = await listSessionsByProject(cwd);
      if (cwd !== sidebarCwdRef.current) return;
      setHistory((current) => replaceProjectHistory(current, cwd, rows));
      setLoadedProjects((prev) =>
        prev.has(key) ? prev : new Set(prev).add(key),
      );
    } catch {
      if (cwd !== sidebarCwdRef.current) return;
      // A failed revalidate keeps the cached cards rather than replacing a
      // good list with an error.
      if (!loadedProjectsRef.current.has(key)) setHistoryErrorCwd(key);
    }
  }, []);

  useEffect(() => {
    void refreshHistory(sidebarCwd);
  }, [sidebarCwd, refreshHistory]);

  useEffect(() => {
    if (!inboxViewOpen) return;
    let cancelled = false;
    void listLinkedSessions()
      .then((rows) => {
        if (!cancelled) setStoredLinkedSessions(rows);
      })
      .catch(() => {
        // Already-loaded and live sessions still provide a useful fallback.
      });
    return () => {
      cancelled = true;
    };
  }, [inboxViewOpen]);

  useEffect(() => {
    prefetchProjectFiles(gitCwd);
  }, [gitCwd]);

  const persistSession = useCallback((session: Session | undefined) => {
    if (
      !session ||
      !shouldPersistSession(session) ||
      removingSessionIds.current.has(session.id) ||
      switchingWorktrees.current.has(session.id)
    )
      return;
    const fingerprint = persistFingerprint(session);
    // Leaving a session flushes it. An unchanged one would still rewrite and
    // re-diff its whole transcript under the store lock, stalling the next load.
    if (lastPersisted.current.get(session.id) === fingerprint) return;
    void upsertSession(session)
      .then((summary) => {
        if (!summary) return;
        lastPersisted.current.set(session.id, fingerprint);
        if (summary.cwd === sidebarCwdRef.current) {
          setHistory((current) => mergeProjectHistorySummary(current, summary));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const liveIds = new Set(sessions.map((session) => session.id));
    const visibleIds = openSessionIds(tabsRef.current);
    const now = Date.now();
    for (const session of sessions) {
      if (
        removingSessionIds.current.has(session.id) ||
        switchingWorktrees.current.has(session.id)
      )
        continue;
      const previouslyObserved = observedSessions.current.get(session.id);
      if (previouslyObserved === session) continue;
      observedSessions.current.set(session.id, session);
      const queueChanged =
        previouslyObserved?.queuedMessages !== session.queuedMessages ||
        previouslyObserved?.queueStatus !== session.queueStatus;
      const parked = !visibleIds.has(session.id);
      const newlyBound =
        !!session.providerSessionId &&
        lastBoundProvider.current.get(session.id) !== session.providerSessionId;
      const lastUserId = lastUserBlockId(session);
      const newUserTurn =
        !!lastUserId &&
        lastPersistedUserBlock.current.get(session.id) !== lastUserId;
      if (newlyBound && session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
      if (newUserTurn && lastUserId) {
        lastPersistedUserBlock.current.set(session.id, lastUserId);
      }
      if (
        (newlyBound || newUserTurn || queueChanged) &&
        shouldPersistSession(session)
      ) {
        persistSession(session);
      }
      if (
        shouldPersistSession(session) &&
        (!session.busy ||
          parked ||
          newlyBound ||
          newUserTurn ||
          !lastPersisted.current.has(session.id))
      ) {
        pendingPersist.current.set(session.id, session);
      } else if (shouldPersistSession(session)) {
        // A running turn is saved every few seconds, so a crash mid-reply
        // keeps what had streamed in.
        const pending = pendingPersist.current.has(session.id);
        const due = activeTurnSnapshotDue(
          activeTurnSnapshots.current.get(session.id),
          now,
        );
        if (due && !pending) activeTurnSnapshots.current.set(session.id, now);
        if (due || pending) pendingPersist.current.set(session.id, session);
      }
      if (!session.busy) activeTurnSnapshots.current.delete(session.id);
    }
    for (const sessionId of observedSessions.current.keys()) {
      if (liveIds.has(sessionId)) continue;
      observedSessions.current.delete(sessionId);
      pendingPersist.current.delete(sessionId);
      activeTurnSnapshots.current.delete(sessionId);
    }
    if (pendingPersist.current.size === 0) {
      pendingPersistSince.current = undefined;
      return;
    }
    pendingPersistSince.current ??= now;

    const timer = window.setTimeout(() => {
      const dirty = [...pendingPersist.current.values()];
      pendingPersist.current.clear();
      pendingPersistSince.current = undefined;
      void Promise.all(
        dirty.map(async (session) => {
          if (
            removingSessionIds.current.has(session.id) ||
            switchingWorktrees.current.has(session.id)
          )
            return;
          const fingerprint = persistFingerprint(session);
          if (lastPersisted.current.get(session.id) === fingerprint) return;
          const summary = await upsertSession(session).catch(() => null);
          if (!summary) return;
          lastPersisted.current.set(session.id, fingerprint);
          if (summary.cwd === sidebarCwdRef.current) {
            setHistory((current) =>
              mergeProjectHistorySummary(current, summary),
            );
          }
        }),
      );
    }, persistDelay(pendingPersistSince.current, now));
    return () => window.clearTimeout(timer);
  }, [persistSession, sessions]);

  useEffect(() => {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) sawInFlight.current = true;
    const key = inFlightSnapshotKey(refs);
    if (
      !shouldWriteInFlightSnapshot(
        key,
        refs,
        inFlightSyncKey.current,
        sawInFlight.current,
      )
    ) {
      return;
    }
    inFlightSyncKey.current = key;
    void replaceInFlightSessions(refs).catch(() => undefined);
  }, [sessions, tabs]);

  useEffect(() => {
    if (windowTransfer) return;
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      reconcileProjectReturn({
        memory: projectReturnRef.current,
        tabs,
        sessions,
        activeTabId,
      }),
      projectTerminals,
      lastDockSide ?? undefined,
      keepWorkspaceTab,
    );
    const key = workspaceSnapshotKey(snapshot);
    if (workspaceSyncKey.current === key) return;
    workspaceSyncKey.current = key;
    const timer = window.setTimeout(() => {
      void saveWorkspaceSnapshot(snapshot).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    tabs,
    sessions,
    activeTabId,
    projectCwd,
    projectTerminals,
    lastDockSide,
    windowTransfer,
    keepWorkspaceTab,
    projectWorktree?.path,
    workspaceNavigation.revision,
  ]);

  useEffect(() => {
    if (lastProjectPath()) return;
    void invoke<string>("default_cwd")
      .then((cwd) => {
        if (!looksLikeProject(cwd)) return;
        setProjectCwd(cwd);
        setRecents((prev) => (prev.length > 0 ? prev : rememberProject(cwd)));
        setSessions((prev) =>
          prev.map((s) => (s.cwd === "~" ? { ...s, cwd } : s)),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        const isolated = isolateTerminalPanes(tab);
        if (isolated !== tab) changed = true;
        return isolated;
      });
      return changed ? next : prev;
    });
  }, [tabs]);

  // Tabs are views. Hidden idle sessions drop their child. A visible session
  // keeps its child for a few minutes after a turn so follow-ups stay instant,
  // then parks it and resumes on the next prompt.
  useIdleSessionDetach({
    sessions,
    sessionsRef,
    tabs,
    tabsRef,
    orchestrationRuns,
    liveAgentsEnabled,
    unseenFinishedIds,
    openingSessionIds,
    loadedSessionCache,
    skipForgetSessionIds,
    persistSession,
    setSessions,
  });

  const activateTab = useCallback(
    (
      id: string,
      paneId?: string,
      reason: "session" | "workspace" = "session",
    ) => {
      closeIrgatView();
      const tab = tabsRef.current.find((entry) => entry.id === id);
      const nextFocusedId =
        tab &&
        paneId &&
        (leafIds(tab.layout).includes(paneId) ||
          tab.editorPanes.some((entry) => entry.id === paneId) ||
          (tab.terminalPanes ?? []).some((entry) => entry.id === paneId))
          ? paneId
          : tab?.focusedId;

      if (reason === "workspace") setActiveTabIdState(id);
      else setActiveTabId(id);
      if (tab && nextFocusedId && nextFocusedId !== tab.focusedId) {
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? { ...entry, focusedId: nextFocusedId, diffFocused: false }
              : entry,
          ),
        );
      }

      if (tab) {
        const focusedTab = nextFocusedId
          ? { ...tab, focusedId: nextFocusedId }
          : tab;
        const cwd = focusedWorkspaceTabCwd(focusedTab, sessionsRef.current);
        if (cwd && looksLikeProject(cwd)) {
          const normalized = normalizeProjectPath(cwd);
          if (!sameProjectPath(normalized, projectCwdRef.current)) {
            setProjectCwd(normalized);
            setRecents(rememberProject(normalized));
          }
        }
      }
      setComposerFocused(
        !!nextFocusedId &&
          sessionsRef.current.some((session) => session.id === nextFocusedId),
      );
    },
    [],
  );

  const commitTabVisit = useCallback((history: TabVisitHistory) => {
    tabVisitRef.current = history;
    const canBack = canTabVisitBack(history);
    const canForward = canTabVisitForward(history);
    setTabVisitNav((prev) =>
      prev.canBack === canBack && prev.canForward === canForward
        ? prev
        : { canBack, canForward },
    );
  }, []);

  useEffect(() => {
    const openIds = new Set(tabs.map((tab) => tab.id));
    let next = pruneTabVisitHistory(tabVisitRef.current, openIds, activeTabId);
    if (tabVisitFromHistoryRef.current) {
      tabVisitFromHistoryRef.current = false;
    } else if (next.current !== activeTabId) {
      next = recordTabVisit(next, activeTabId);
    }
    commitTabVisit(pruneTabVisitHistory(next, openIds, activeTabId));
  }, [activeTabId, commitTabVisit, tabs]);

  /** `cwd` scopes group inheritance: a tab from another project starts alone. */
  const insertBeside = useCallback(
    (
      prev: WorkspaceTab[],
      tab: WorkspaceTab,
      anchorId: string | undefined,
      cwd?: string,
    ) =>
      insertTabBesideActive(prev, tab, anchorId, (id) =>
        id === tab.id ? (cwd ? projectName(cwd) : undefined) : projectOfTab(id),
      ),
    [projectOfTab],
  );

  const insertBesideActive = useCallback(
    (prev: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) =>
      insertBeside(prev, tab, activeTabIdRef.current, cwd),
    [insertBeside],
  );

  const appendTab = useCallback(
    (tab: WorkspaceTab, cwd?: string) => {
      setTabs((prev) => insertBesideActive(prev, tab, cwd));
    },
    [insertBesideActive],
  );

  const onOpenWhatsNew = useCallback((version: string) => {
    const document = releaseNotesForVersion(version);
    if (!document) {
      void message(
        "Release notes for this version are not available in this build.",
        { title: "Irgatos" },
      );
      return;
    }
    setWhatsNewVersion(document.source.version);
  }, []);

  const createWorkspaceTab = useCallback(
    (cwd: string, focus?: WorktreeFocus) => {
      const session = {
        ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
        ...(focus && !sameProjectPath(focus.path, cwd)
          ? { worktreeCwd: focus.path, branch: focus.branch ?? undefined }
          : {}),
      };
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      return tab.id;
    },
    [appendTab, sessionDefaults?.runtimeMode],
  );

  const onNew = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setKanbanViewOpen(false);
    setFleetViewOpen(false);
    const cwd = sidebarCwd;
    const session = newWorkspaceSession(cwd, sessionDefaults?.runtimeMode);
    const tab = newTab(session.id);
    setSessions((prev) => [...prev, session]);
    appendTab(tab, cwd);
    setActiveTabId(tab.id);
    setComposerFocused(true);
    return session.id;
  }, [appendTab, sessionDefaults?.runtimeMode, sidebarCwd]);

  const onSelectRemoteSession = useCallback(
    (project: string, remoteSessionId: string) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      const existing = findRemoteSessionTab(
        tabsRef.current,
        sessionsRef.current,
        project,
        remoteSessionId,
      );
      if (existing) {
        activateTab(existing.tab.id, existing.shellId);
        return;
      }
      // Reserve a dedicated tab immediately. An apparently blank remote tab
      // may hold composer text or a create/upload that the host has not accepted.
      const session = newDefaultSession(project, sessionDefaults?.runtimeMode);
      const tab = newTab(session.id);
      rememberRemoteSession(session.id, remoteSessionId);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, project);
      setActiveTabId(tab.id);
    },
    [activateTab, appendTab, sessionDefaults?.runtimeMode],
  );

  const onStartInboxItem = useCallback(
    async (item: InboxItem, body?: string) => {
      const start = (description?: string) => {
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setAutomationsViewOpen(false);
        setKanbanViewOpen(false);
        setFleetViewOpen(false);
        const cwd =
          item.projectPath || active?.cwd || sessionDefaults?.cwd || projectCwd;
        setSidebarTab("sessions", cwd);
        const ref =
          item.provider === "linear" || item.provider === "jira"
            ? item.identifier?.trim() || `#${item.number}`
            : `#${item.number}`;
        const linkedWorkItem = linkedWorkItemFromInboxItem(item);
        const session = {
          ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
          title: `${ref} ${item.title}`,
          inboxCard: inboxComposerCard(item, description),
          ...(linkedWorkItem ? { linkedWorkItem } : {}),
        };
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, cwd);
        setActiveTabId(tab.id);
        setComposerFocused(true);
      };

      start(await inboxTrackerDescription(item, body));
    },
    [
      active?.cwd,
      appendTab,
      sessionDefaults?.cwd,
      sessionDefaults?.runtimeMode,
      projectCwd,
    ],
  );

  const onAddNoteToChat = useCallback(
    (card: NoteComposerCard) => {
      if (!card.id) return;
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      if (irgatViewIdRef.current) closeIrgatView();
      const cwd =
        (card.sourceCwd && looksLikeProject(card.sourceCwd)
          ? card.sourceCwd
          : undefined) ||
        active?.cwd ||
        sessionDefaults?.cwd ||
        projectCwd;
      setSidebarTab("sessions", cwd);
      const title = card.title.trim();
      const session = {
        ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
        ...(title ? { title } : {}),
        noteCard: card,
      };
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [
      active?.cwd,
      appendTab,
      closeIrgatView,
      sessionDefaults?.cwd,
      sessionDefaults?.runtimeMode,
      projectCwd,
    ],
  );

  const onInboxCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.inboxCard
          ? { ...session, inboxCard: undefined }
          : session,
      ),
    );
  }, []);

  const setLinkedWorkItemUpdateCard = useCallback(
    (
      sessionId: string,
      update: (
        card: LinkedWorkItemUpdateCard | undefined,
      ) => LinkedWorkItemUpdateCard | undefined,
    ) => {
      const previous = sessionsRef.current;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const card = update(session.linkedWorkItemUpdateCard);
        return card === session.linkedWorkItemUpdateCard
          ? session
          : { ...session, linkedWorkItemUpdateCard: card };
      });
      if (!next.some((session, index) => session !== previous[index])) return;
      sessionsRef.current = next;
      setSessions(next);
    },
    [],
  );

  const onLinkedWorkItemUpdateCardDismiss = useCallback(
    (sessionId: string) => {
      setLinkedWorkItemUpdateCard(sessionId, () => undefined);
    },
    [setLinkedWorkItemUpdateCard],
  );

  const onNoteCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.noteCard
          ? { ...session, noteCard: undefined }
          : session,
      ),
    );
  }, []);

  const onHandoffCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.handoffCard
          ? { ...session, handoffCard: undefined }
          : session,
      ),
    );
  }, []);

  const onSplit = useCallback(
    (dir: SplitDir) => {
      // The Irgat and Chat pages split by opening a new chat beside theirs.
      if (sidePaneKeyRef.current) {
        newChatBesideRef.current();
        return;
      }
      closeIrgatView();
      if (!activeTab) return;
      const session = newDefaultSession(
        sessionDefaults?.cwd ?? projectCwd,
        sessionDefaults?.runtimeMode,
      );
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) return t;
          return {
            ...t,
            layout: splitPane(t.layout, t.focusedId, dir, session.id),
            focusedId: session.id,
          };
        }),
      );
      setComposerFocused(true);
    },
    [activeTab, projectCwd, sessionDefaults?.cwd, sessionDefaults?.runtimeMode],
  );

  const focusProjectTerminal = useCallback(() => {
    setProjectTerminalFocused(true);
    setComposerFocused(false);
  }, []);

  const openProjectTerminal = useCallback(
    (cwd: string) => {
      const projectPath = viewDockRef.current.path;
      const workdir = cwd || projectPath;
      if (!canOpenDockTerminal(viewDockRef.current)) return false;
      setProjectTerminals((prev) => {
        const existing = findProjectTerminal(prev, projectPath);
        const file = newTerminalFile(
          workdir,
          existing ? nextDockTerminalTitle(existing, workdir) : undefined,
          projectPath,
        );
        if (!existing) {
          return [
            ...prev,
            createProjectTerminal(
              projectPath,
              file,
              // A chat's dock sits under its conversation and cannot move.
              viewDockRef.current.kind === "chat"
                ? "bottom"
                : (lastDockSideRef.current ?? "bottom"),
            ),
          ];
        }
        return mapProjectTerminal(prev, projectPath, (dock) =>
          addTerminalToDock(dock, file),
        );
      });
      focusProjectTerminal();
      return true;
    },
    [focusProjectTerminal],
  );

  const onOpenTerminal = useCallback(
    (cwd: string, asWorkspaceTab = false, occupySessionId?: string) => {
      const workdir = cwd || terminalCwd;
      // A Irgat or chat on screen takes the terminal into its own dock.
      if (viewDockRef.current.kind !== "project") {
        if (!isRemoteProjectPath(workdir)) {
          openProjectTerminal(cwd || viewDockRef.current.path);
        }
        return;
      }
      if (!isLocalProject(projectCwdRef.current) || !isLocalProject(workdir))
        return;
      if (openProjectTerminal(workdir)) return;

      if (asWorkspaceTab || !activeTab) {
        const file = newTerminalFile(workdir, undefined, sidebarCwd);
        const tab = newTerminalWorkspaceTab(file);
        appendTab(tab, sidebarCwd);
        setActiveTabId(tab.id);
        setComposerFocused(false);
        return;
      }

      const occupying = sessionsRef.current.find(
        (session) => session.id === (occupySessionId ?? activeTab.focusedId),
      );
      const occupyPaneId =
        occupying && isBlankSession(occupying) ? occupying.id : undefined;
      if (occupyPaneId && occupying) {
        lastPersisted.current.delete(occupyPaneId);
        void forgetHarnessSession(occupying.harness, occupyPaneId);
        setSessions((prev) =>
          prev.filter((session) => session.id !== occupyPaneId),
        );
      }

      const file = newTerminalFile(
        workdir,
        nextTerminalTitle(activeTab, workdir),
        sidebarCwd,
      );
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? openTerminalTab(tab, file, occupyPaneId)
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [terminalCwd, activeTab, appendTab, openProjectTerminal, sidebarCwd],
  );

  const onNewTerminal = useCallback(() => {
    // A Irgat or chat opens its shells in its own folder, in its own dock.
    if (viewDockRef.current.kind !== "project") {
      openProjectTerminal(viewDockRef.current.path);
      return;
    }
    onOpenTerminal(terminalCwd);
  }, [terminalCwd, onOpenTerminal, openProjectTerminal]);

  const onShowProjectTerminal = useCallback(() => {
    const path = viewDockRef.current.path;
    const dock = findProjectTerminal(projectTerminalsRef.current, path);
    if (dock && dock.pane.files.length > 0) {
      if (!dock.open) {
        setProjectTerminals((prev) =>
          mapProjectTerminal(prev, path, (entry) => withDockOpen(entry, true)),
        );
      }
      focusProjectTerminal();
      return;
    }
    onNewTerminal();
  }, [focusProjectTerminal, onNewTerminal]);

  const onNewTerminalInSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      if (session?.worktreeRemoved) return;
      onOpenTerminal(
        session ? sessionWorkCwd(session) : projectCwd,
        false,
        sessionId,
      );
    },
    [onOpenTerminal, projectCwd],
  );

  const onToggleProjectTerminal = useCallback(() => {
    const view = viewDockRef.current;
    if (!canOpenDockTerminal(view)) return;
    const dock = findProjectTerminal(projectTerminalsRef.current, view.path);
    if (!dock) {
      openProjectTerminal(view.kind === "project" ? terminalCwd : view.path);
      return;
    }
    const nextOpen = !dock.open;
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, view.path, (entry) =>
        withDockOpen(entry, nextOpen),
      ),
    );
    if (nextOpen) focusProjectTerminal();
    else setProjectTerminalFocused(false);
  }, [terminalCwd, focusProjectTerminal, openProjectTerminal]);

  const onHideProjectTerminal = useCallback(() => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, viewDockRef.current.path, (dock) =>
        withDockOpen(dock, false),
      ),
    );
    setProjectTerminalFocused(false);
  }, []);

  const onProjectTerminalSide = useCallback((side: DockSide) => {
    setLastDockSide(side);
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, viewDockRef.current.path, (dock) =>
        withDockSide(dock, side, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onProjectTerminalSize = useCallback((size: number) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, viewDockRef.current.path, (dock) =>
        withDockSize(dock, size, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onSelectProjectTerminal = useCallback(
    (fileId: string) => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, viewDockRef.current.path, (dock) =>
          selectDockTerminal(dock, fileId),
        ),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onReorderProjectTerminals = useCallback((ids: string[]) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, viewDockRef.current.path, (dock) =>
        reorderDockTerminals(dock, orderByIds(dock.pane.files, ids)),
      ),
    );
  }, []);

  const onCloseProjectTerminal = useCallback((fileId: string) => {
    const dock = findProjectTerminal(
      projectTerminalsRef.current,
      viewDockRef.current.path,
    );
    const file = dock?.pane.files.find((entry) => entry.id === fileId);
    if (!file) return;
    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, viewDockRef.current.path, (entry) =>
          closeTerminalInDock(entry, fileId),
        ),
      );
    };
    void confirmCloseTerminal(file).then((ok) => ok && finishClose());
  }, []);

  const onCloseOtherProjectTerminals = useCallback((fileId: string) => {
    const projectPath = viewDockRef.current.path;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectPath);
    if (!dock?.pane.files.some((file) => file.id === fileId)) return;
    const closingFiles = dock.pane.files.filter((file) => file.id !== fileId);
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));

    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectPath, (entry) => {
          if (!entry.pane.files.some((file) => file.id === fileId)) {
            return entry;
          }
          const files = entry.pane.files.filter(
            (file) => !closingIds.has(file.id),
          );
          return {
            ...entry,
            pane: { ...entry.pane, files, activeFileId: fileId },
          };
        }),
      );
    };

    void confirmCloseTerminals(closingFiles).then((ok) => ok && finishClose());
  }, []);

  const onTerminalMetaChange = useCallback(
    (fileId: string, patch: TerminalMetaPatch) => {
      setProjectTerminals((prev) => patchProjectTerminals(prev, fileId, patch));
      setTabs((prev) =>
        prev.map((tab) => updateTerminalTab(tab, fileId, patch)),
      );
    },
    [],
  );

  /** Bring a running terminal forward; with `toggle`, a showing one hides. */
  const revealTerminal = useCallback(
    (fileId: string, toggle: boolean) => {
      const dock = projectTerminalsRef.current.find((entry) =>
        entry.pane.files.some((file) => file.id === fileId),
      );
      if (dock) {
        if (toggle && dock.open) {
          setProjectTerminals((prev) =>
            mapProjectTerminal(prev, dock.projectPath, (entry) =>
              withDockOpen(entry, false),
            ),
          );
          setProjectTerminalFocused(false);
          return;
        }
        setProjectTerminals((prev) =>
          mapProjectTerminal(prev, dock.projectPath, (entry) =>
            withDockOpen(selectDockTerminal(entry, fileId), true),
          ),
        );
        focusProjectTerminal();
        return;
      }
      for (const tab of tabsRef.current) {
        for (const pane of tab.terminalPanes ?? []) {
          if (!pane.files.some((file) => file.id === fileId)) continue;
          const showing =
            activeTabIdRef.current === tab.id &&
            tab.focusedId === pane.id &&
            pane.activeFileId === fileId;
          if (toggle && showing) {
            setComposerFocused(true);
            setProjectTerminalFocused(false);
            return;
          }
          setActiveTabId(tab.id);
          setTabs((prev) =>
            prev.map((entry) => {
              if (entry.id !== tab.id) return entry;
              return withSurfacePanes(
                { ...entry, focusedId: pane.id },
                "terminal",
                (entry.terminalPanes ?? []).map((item) =>
                  item.id === pane.id
                    ? { ...item, activeFileId: fileId }
                    : item,
                ),
              );
            }),
          );
          setProjectTerminalFocused(false);
          setComposerFocused(false);
          return;
        }
      }
    },
    [focusProjectTerminal],
  );

  const onToggleRunningTerminal = useCallback(
    (fileId: string) => revealTerminal(fileId, true),
    [revealTerminal],
  );

  const onNewTerminalTab = useCallback(() => {
    onOpenTerminal(terminalCwd, true);
  }, [terminalCwd, onOpenTerminal]);

  const onCloseTab = useCallback(
    (id: string, opts?: { confirmedTerminalIds?: string[] }) => {
      const current = tabsRef.current;
      const index = current.findIndex((t) => t.id === id);
      if (index < 0) return;
      const closePlan = planWorkspaceTabClose({
        tabs: current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep") return;
      const closing = current[index];
      const closingFiles = [
        ...closing.editorPanes.flatMap((pane) => pane.files),
        ...(closing.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const confirmed = new Set(opts?.confirmedTerminalIds ?? []);
      const terminals = closingFiles.filter(
        (file) => file.terminal && !confirmed.has(file.id),
      );

      const finishClose = () => {
        const nextActiveTabId = closePlan.nextActiveTabId;
        const next = current.filter((t) => t.id !== id);
        const gone = new Set(
          leafIds(closing.layout).filter((paneId) =>
            sessionsRef.current.some((session) => session.id === paneId),
          ),
        );
        for (const sessionId of gone) {
          persistSession(sessionsRef.current.find((s) => s.id === sessionId));
          rememberRemoteSession(sessionId);
          rememberRemotePendingWorktree(sessionId);
        }
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        setTabs(next);
        if (id === activeTabIdRef.current && nextActiveTabId) {
          activateTab(nextActiveTabId);
        }
        void refreshHistory(sidebarCwd);
      };

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close this tab with unsaved files?",
          );
          if (!ok) return;
        }
        if (terminals.length > 0) {
          const ok = await confirmCloseTerminals(terminals);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd, tabCloseScope],
  );

  const onCloseTabs = useCallback(
    (ids: string[], fallbackId: string, opts?: { confirmed?: boolean }) => {
      const current = tabsRef.current;
      const closingIds = new Set(ids);
      const closing = current.filter((tab) => closingIds.has(tab.id));
      const fallback = current.find(
        (tab) => tab.id === fallbackId && !closingIds.has(tab.id),
      );
      if (!fallback || closing.length === 0) return;

      const closingFiles = closing.flatMap((tab) => [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ]);
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const terminals = closingFiles.filter((file) => file.terminal);

      const finishClose = () => {
        const sessionIds = new Set(
          closing.flatMap((tab) =>
            leafIds(tab.layout).filter((paneId) =>
              sessionsRef.current.some((session) => session.id === paneId),
            ),
          ),
        );
        for (const sessionId of sessionIds) {
          persistSession(
            sessionsRef.current.find((session) => session.id === sessionId),
          );
          rememberRemoteSession(sessionId);
          rememberRemotePendingWorktree(sessionId);
        }
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          for (const file of closingFiles) next.delete(file.id);
          return next;
        });
        setTabs((prev) => prev.filter((tab) => !closingIds.has(tab.id)));
        if (closingIds.has(activeTabIdRef.current)) activateTab(fallback.id);
        void refreshHistory(sidebarCwd);
      };

      // The caller already confirmed unsaved files and terminals.
      if (opts?.confirmed) {
        finishClose();
        return;
      }

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close these tabs with unsaved files?",
          );
          if (!ok) return;
        }
        if (terminals.length > 0) {
          const ok = await confirmCloseTerminals(terminals);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd],
  );

  const onCloseOtherTabs = useCallback(() => {
    const current = tabsRef.current;
    const activeId = activeTabIdRef.current;
    if (!current.some((tab) => tab.id === activeId)) return;
    onCloseTabs(
      current.filter((tab) => tab.id !== activeId).map((tab) => tab.id),
      activeId,
    );
  }, [onCloseTabs]);

  const onCloseFile = useCallback(
    (paneId: string, fileId: string) => {
      const tab = tabsRef.current.find((entry) =>
        findSurfacePane(entry, paneId),
      );
      if (!tab) return;
      const found = findSurfacePane(tab, paneId);
      if (!found) return;
      const { kind, pane } = found;
      const index = pane.files.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const file = pane.files[index];
      const needsUnsavedConfirm =
        isFilesystemTab(file) && dirtyFilesRef.current.has(fileId);

      const finishClose = () => {
        const files = pane.files.filter((entry) => entry.id !== fileId);
        let nextFocus = tab.focusedId;
        let nextLayout = tab.layout;
        let nextPanes = surfacePanes(tab, kind);
        if (files.length > 0) {
          nextFocus = paneId;
          const activeFileId =
            pane.activeFileId === fileId
              ? files[Math.min(index, files.length - 1)].id
              : pane.activeFileId;
          nextPanes = nextPanes.map((entry) =>
            entry.id === paneId ? { ...entry, files, activeFileId } : entry,
          );
        } else {
          const sibling = siblingLeafId(tab.layout, paneId);
          const withoutPane = removePane(tab.layout, paneId);
          if (!withoutPane) {
            setDirtyFiles((prev) => {
              const next = new Set(prev);
              next.delete(fileId);
              return next;
            });
            const closePlan = planWorkspaceTabClose({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              closingTabId: tab.id,
              scope: tabCloseScope,
              worktreeOf: tabWorktreeOf,
            });
            if (closePlan.action === "close") {
              onCloseTab(
                tab.id,
                file.terminal ? { confirmedTerminalIds: [fileId] } : undefined,
              );
              return;
            }
            const seed = sessionsRef.current[0];
            const session = newSession(
              seed?.harness ?? "claude",
              file.cwd || projectCwd,
              seed?.model,
              seed?.runtimeMode,
              seed?.modelSettings,
            );
            setSessions((prev) => [...prev, session]);
            setTabs((prev) =>
              prev.map((entry) =>
                entry.id === tab.id
                  ? {
                      ...entry,
                      layout: leaf(session.id),
                      focusedId: session.id,
                      editorPanes: [],
                      terminalPanes: [],
                      diffOpen: false,
                      diffFocused: false,
                    }
                  : entry,
              ),
            );
            setComposerFocused(true);
            return;
          }
          nextLayout = withoutPane;
          nextFocus =
            tab.focusedId === paneId
              ? (sibling ?? firstLeafId(withoutPane))
              : tab.focusedId;
          nextPanes = nextPanes.filter((entry) => entry.id !== paneId);
        }

        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === tab.id
              ? withSurfacePanes(
                  {
                    ...entry,
                    layout: nextLayout,
                    focusedId: nextFocus,
                  },
                  kind,
                  nextPanes,
                )
              : entry,
          ),
        );
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
        if (tab.id === activeTabId && files.length === 0) {
          setComposerFocused(
            sessionsRef.current.some((session) => session.id === nextFocus),
          );
        }
      };

      void (async () => {
        if (needsUnsavedConfirm) {
          const ok = await confirmDiscardUnsaved(
            `Close ${basename(file.path)} without saving?`,
          );
          if (!ok) return;
        }
        if (file.terminal) {
          const ok = await confirmCloseTerminal(file);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activeTabId, onCloseTab, projectCwd, tabCloseScope],
  );

  const onCloseOtherFiles = useCallback((paneId: string, fileId: string) => {
    const tab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
    if (!tab) return;
    const found = findSurfacePane(tab, paneId);
    if (!found?.pane.files.some((file) => file.id === fileId)) return;
    const closingFiles = found.pane.files.filter((file) => file.id !== fileId);
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));
    const unsaved = closingFiles.filter(
      (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
    );
    const terminals = closingFiles.filter((file) => file.terminal);

    const finishClose = () => {
      setTabs((prev) =>
        prev.map((entry) => {
          if (entry.id !== tab.id) return entry;
          const current = findSurfacePane(entry, paneId);
          if (!current?.pane.files.some((file) => file.id === fileId)) {
            return entry;
          }
          return withSurfacePanes(
            { ...entry, focusedId: paneId },
            current.kind,
            surfacePanes(entry, current.kind).map((pane) =>
              pane.id === paneId
                ? {
                    ...pane,
                    files: pane.files.filter(
                      (file) => !closingIds.has(file.id),
                    ),
                    activeFileId: fileId,
                  }
                : pane,
            ),
          );
        }),
      );
      setDirtyFiles((prev) => {
        const next = new Set(prev);
        for (const id of closingIds) next.delete(id);
        return next;
      });
    };

    void (async () => {
      if (unsaved.length > 0) {
        const ok = await confirmDiscardUnsaved(
          "Close other tabs with unsaved files?",
        );
        if (!ok) return;
      }
      if (terminals.length > 0) {
        const ok = await confirmCloseTerminals(terminals);
        if (!ok) return;
      }
      finishClose();
    })();
  }, []);

  const onClearTabSession = useCallback(
    (id: string) => {
      const tab = tabs.find((entry) => entry.id === id);
      if (!tab || isBlankWorkspaceTab(tab, sessionsRef.current)) return;

      const closingFiles = [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );

      const oldSessionId = leafIds(tab.layout).find((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      const oldSession = sessionsRef.current.find(
        (session) => session.id === oldSessionId,
      );
      if (!oldSession) return;

      const finishClear = () => {
        persistSession(oldSession);
        for (const shellId of leafIds(tab.layout)) {
          rememberRemoteSession(shellId);
          rememberRemotePendingWorktree(shellId);
        }

        // The blank replacement stays in the tab's worktree, so clearing the
        // last tab there does not switch the workspace back to the project.
        const workspace = tabWorkspace(tab, sessionsRef.current);
        const focus = worktreeFocus(oldSession.cwd);
        const session = {
          ...newSession(
            oldSession.harness,
            oldSession.cwd,
            oldSession.model,
            oldSession.runtimeMode,
            oldSession.modelSettings,
          ),
          ...(workspace && !sameProjectPath(workspace, oldSession.cwd)
            ? {
                worktreeCwd: workspace,
                branch:
                  (focus && sameProjectPath(focus.path, workspace)
                    ? focus.branch
                    : undefined) ??
                  (oldSession.worktreeCwd &&
                  sameProjectPath(oldSession.worktreeCwd, workspace)
                    ? oldSession.branch
                    : undefined) ??
                  undefined,
              }
            : {}),
        };

        setSessions((prev) => [...prev, session]);
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  layout: leaf(session.id),
                  focusedId: session.id,
                  editorPanes: [],
                  terminalPanes: [],
                  diffOpen: false,
                  diffFocused: false,
                }
              : entry,
          ),
        );
        setComposerFocused(true);
        void refreshHistory(sidebarCwd);
      };

      if (unsaved.length === 0) {
        finishClear();
        return;
      }
      void confirmDiscardUnsaved(
        "Close this conversation with unsaved files?",
      ).then((ok) => ok && finishClear());
    },
    [tabs, persistSession, refreshHistory, sidebarCwd],
  );

  const onRemoteSessionDeleted = useCallback(
    (remoteSessionId: string) => {
      const tab = tabsRef.current.find((entry) =>
        leafIds(entry.layout).some(
          (shellId) => remoteSessionFor(shellId) === remoteSessionId,
        ),
      );
      if (!tab) return;
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: tab.id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep") onClearTabSession(tab.id);
      else onCloseTab(tab.id);
    },
    [onClearTabSession, onCloseTab, tabCloseScope],
  );

  const onCloseAllTabs = useCallback(() => {
    closeIrgatView();
    const tab = tabsRef.current.find(
      (entry) => entry.id === activeTabIdRef.current,
    );
    if (!tab) return;

    const seedSession = (cwd: string) => {
      const seed = sessionsRef.current[0];
      return newSession(
        seed?.harness ?? "claude",
        cwd,
        seed?.model,
        seed?.runtimeMode,
        seed?.modelSettings,
      );
    };

    // Stage one: files open in the active tab's editor panes close first.
    // Only when none are open does the command close every workspace tab.
    const editorFiles = tab.editorPanes.flatMap((pane) => pane.files);
    if (editorFiles.length > 0) {
      const remaining = closeSurfacePanes(tab, "editor");
      if (!remaining) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: tab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
        });
        if (closePlan.action === "close") {
          onCloseTab(tab.id);
          return;
        }
      }
      const unsaved = editorFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );

      const finishClose = () => {
        let nextTab: WorkspaceTab;
        let focusesSession: boolean;
        if (remaining) {
          nextTab = remaining;
          focusesSession = sessionsRef.current.some(
            (session) => session.id === remaining.focusedId,
          );
        } else {
          // The tab held only editor panes and must stay: seed a session.
          const session = seedSession(editorFiles[0].cwd || projectCwd);
          setSessions((prev) => [...prev, session]);
          nextTab = resetTabToSession(tab, session.id);
          focusesSession = true;
        }
        setTabs((prev) =>
          prev.map((entry) => (entry.id === tab.id ? nextTab : entry)),
        );
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of editorFiles) updated.delete(file.id);
          return updated;
        });
        setComposerFocused(focusesSession);
      };

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close all open files with unsaved changes?",
          );
          if (!ok) return;
        }
        finishClose();
      })();
      return;
    }

    // Stage two: the workspace always keeps one tab, so close every other
    // tab and reset the active one to a blank session. Every confirmation
    // runs before any tab changes, so a cancelled prompt leaves all tabs.
    const otherIds = tabsRef.current
      .filter((entry) => entry.id !== tab.id)
      .map((entry) => entry.id);
    const terminalFiles = (tab.terminalPanes ?? []).flatMap(
      (pane) => pane.files,
    );
    const closingFiles = [
      ...tabsRef.current
        .filter((entry) => otherIds.includes(entry.id))
        .flatMap((entry) => [
          ...entry.editorPanes.flatMap((pane) => pane.files),
          ...(entry.terminalPanes ?? []).flatMap((pane) => pane.files),
        ]),
      ...terminalFiles,
    ];
    const unsaved = closingFiles.filter(
      (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
    );
    const terminals = closingFiles.filter((file) => file.terminal);

    void (async () => {
      if (unsaved.length > 0) {
        const ok = await confirmDiscardUnsaved(
          "Close all tabs with unsaved files?",
        );
        if (!ok) return;
      }
      if (terminals.length > 0) {
        const ok = await confirmCloseTerminals(terminals);
        if (!ok) return;
      }
      if (otherIds.length > 0) {
        onCloseTabs(otherIds, tab.id, { confirmed: true });
      }
      const hasSession = leafIds(tab.layout).some((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (hasSession) {
        // No editor files remain, so this commits without a prompt.
        onClearTabSession(tab.id);
        return;
      }
      // The tab held no session: seed one so the workspace stays usable.
      const session = seedSession(terminalFiles[0]?.cwd || projectCwd);
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((entry) =>
          entry.id === tab.id ? resetTabToSession(entry, session.id) : entry,
        ),
      );
      setComposerFocused(true);
    })();
  }, [onCloseTab, onCloseTabs, onClearTabSession, projectCwd, tabCloseScope]);

  const onClosePane = useCallback(
    (sessionId?: string) => {
      if (irgatViewIdRef.current) {
        closeIrgatView();
        setComposerFocused(true);
        return;
      }
      // The project terminal is shared by every workspace tab in the project,
      // so pane and title-bar close buttons stay scoped to workspace tabs and
      // panes. ⌘W / Ctrl+W goes through onCloseFocused to reach the dock.
      if (!activeTab) return;
      const focusedSurface = findSurfacePane(activeTab, activeTab.focusedId);
      if (sessionId === undefined && focusedSurface) {
        onCloseFile(focusedSurface.pane.id, focusedSurface.pane.activeFileId);
        return;
      }
      const closingId = sessionId ?? activeTab.focusedId;
      const ids = leafIds(activeTab.layout);
      const sessionIds = ids.filter((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (!sessionIds.includes(closingId)) return;
      const nextTab = closeLeaf(activeTab, closingId);
      if (!nextTab) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: activeTab.id,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
        });
        if (closePlan.action === "keep") onClearTabSession(activeTab.id);
        else onCloseTab(activeTab.id);
        return;
      }
      persistSession(sessionsRef.current.find((s) => s.id === closingId));
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, layout: nextTab.layout, focusedId: nextTab.focusedId }
            : t,
        ),
      );
      if (closingId === activeTab.focusedId) {
        setComposerFocused(
          nextTab &&
            sessionsRef.current.some(
              (session) => session.id === nextTab.focusedId,
            ),
        );
      }
      void refreshHistory(sidebarCwd);
    },
    [
      activeTab,
      closeIrgatView,
      onCloseFile,
      onCloseTab,
      onClearTabSession,
      persistSession,
      refreshHistory,
      sidebarCwd,
      tabCloseScope,
    ],
  );

  /** The dock terminal that ⌘T / ⌘W act on while the keyboard is in the dock. */
  const focusedDockTerminal = useCallback(() => {
    // Require DOM focus as well as the dock flag: the flag outlives clicks on
    // chrome that does not clear it, and the shortcuts must follow the keyboard.
    const dockFocused =
      projectTerminalFocusedRef.current &&
      Boolean(document.activeElement?.closest("[data-project-terminal-dock]"));
    return focusedDockTerminalId(
      findProjectTerminal(
        projectTerminalsRef.current,
        viewDockRef.current.path,
      ),
      dockFocused,
    );
  }, []);

  /** ⌘T / Ctrl+T: add a dock terminal while the dock has focus, else a tab. */
  const onNewFocused = useCallback(() => {
    if (focusedDockTerminal()) onNewTerminal();
    else onNew();
  }, [focusedDockTerminal, onNew, onNewTerminal]);

  /** ⌘W / Ctrl+W: close the focused dock terminal, else the focused pane. */
  const onCloseFocused = useCallback(() => {
    const fileId = focusedDockTerminal();
    if (fileId) onCloseProjectTerminal(fileId);
    else onClosePane();
  }, [focusedDockTerminal, onCloseProjectTerminal, onClosePane]);

  const onCloseTitleTab = useCallback(
    (id: string) => {
      closeIrgatView();
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep" && id === activeTabIdRef.current) {
        onClosePane();
        return;
      }
      onCloseTab(id);
    },
    [onClosePane, onCloseTab, tabCloseScope],
  );

  /** Open tabs per workspace in the sidebar's project, keyed by worktree
   * path, so the switcher can show what each worktree still has open. */
  const worktreeTabStats = useMemo(() => {
    const stats = new Map<string, { tabs: number; busy: boolean }>();
    if (!sidebarCwd || sidebarCwd === "~" || isRemoteProjectPath(sidebarCwd))
      return stats;
    for (const tab of filterTabsForProject(tabs, sessions, sidebarCwd)) {
      const workspace = tabWorkspace(tab, sessions) ?? sidebarCwd;
      const key = pathKey(workspace);
      const entry = stats.get(key) ?? { tabs: 0, busy: false };
      entry.tabs += 1;
      entry.busy ||= leafIds(tab.layout).some(
        (id) => sessions.find((session) => session.id === id)?.busy,
      );
      stats.set(key, entry);
    }
    return stats;
  }, [tabs, sessions, sidebarCwd, tabWorkspace, workspaceNavigation.revision]);
  const deckProjectTabs = useMemo(() => {
    // A projectless session belongs to no project, so it stands on its own
    // rather than trailing the last project's tabs.
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (active && !workspaceTabCwd(active, sessions)) return [active];
    // Each worktree keeps its own tabs; the others stay open, just hidden.
    const worktree = projectWorktree?.path ?? projectCwd;
    return filterTabsForProject(tabs, sessions, projectCwd).filter((tab) => {
      if (tab.id === activeTabId) return true;
      const workspace = tabWorkspace(tab, sessions);
      return !workspace || sameProjectPath(workspace, worktree);
    });
  }, [
    activeTabId,
    tabs,
    sessions,
    projectCwd,
    projectWorktree?.path,
    tabWorkspace,
    workspaceNavigation.revision,
  ]);

  const onNext = useCallback(() => {
    if (irgatViewIdRef.current) {
      activateTab(activeTabId);
      return;
    }
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0)
      activateTab(deckProjectTabs[(index + 1) % deckProjectTabs.length].id);
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onPrev = useCallback(() => {
    if (irgatViewIdRef.current) {
      activateTab(activeTabId);
      return;
    }
    const index = deckProjectTabs.findIndex((t) => t.id === activeTabId);
    if (index >= 0) {
      activateTab(
        deckProjectTabs[
          (index - 1 + deckProjectTabs.length) % deckProjectTabs.length
        ].id,
      );
    }
  }, [activateTab, activeTabId, deckProjectTabs]);

  const onVisitBack = useCallback(() => {
    if (irgatViewIdRef.current) {
      activateTab(activeTabIdRef.current);
      return;
    }
    const openIds = new Set(tabsRef.current.map((tab) => tab.id));
    const pruned = pruneTabVisitHistory(
      tabVisitRef.current,
      openIds,
      activeTabIdRef.current,
    );
    const next = tabVisitBack(pruned);
    if (!next || !openIds.has(next.current)) return;
    tabVisitFromHistoryRef.current = true;
    commitTabVisit(next);
    activateTab(next.current);
  }, [activateTab, commitTabVisit]);

  const onVisitForward = useCallback(() => {
    if (irgatViewIdRef.current) {
      activateTab(activeTabIdRef.current);
      return;
    }
    const openIds = new Set(tabsRef.current.map((tab) => tab.id));
    const pruned = pruneTabVisitHistory(
      tabVisitRef.current,
      openIds,
      activeTabIdRef.current,
    );
    const next = tabVisitForward(pruned);
    if (!next || !openIds.has(next.current)) return;
    tabVisitFromHistoryRef.current = true;
    commitTabVisit(next);
    activateTab(next.current);
  }, [activateTab, commitTabVisit]);

  const onActivate = useCallback(
    (slot: number) => {
      const tab =
        slot < 0
          ? deckProjectTabs[deckProjectTabs.length - 1]
          : deckProjectTabs[slot];
      if (tab) activateTab(tab.id);
    },
    [activateTab, deckProjectTabs],
  );

  const onFocusPane = useCallback(
    (paneId: string) => {
      if (paneId === irgatViewIdRef.current) {
        setIrgatShownSessionFocused(false);
        setProjectTerminalFocused(false);
        setComposerFocused(true);
        return;
      }
      if (paneId === shownIrgatSessionIdRef.current) {
        setIrgatShownSessionFocused(true);
        setProjectTerminalFocused(false);
        setComposerFocused(true);
        return;
      }
      // Over the Irgat, only its sidebar holds panes outside the workspace: a
      // launched session sliding away as another opens. Its late focus must
      // not close the Irgat and send that session to its project.
      if (
        irgatViewIdRef.current &&
        !tabsRef.current.some((tab) => leafIds(tab.layout).includes(paneId))
      )
        return;
      closeIrgatView();
      if (
        tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)
          ?.focusedId !== paneId
      )
        workspaceNavigation.cancel();
      setProjectTerminalFocused(false);
      if (inboxAskPortal?.sessionId === paneId) {
        setComposerFocused(true);
        return;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? { ...t, focusedId: paneId, diffFocused: false }
            : t,
        ),
      );
      setComposerFocused(
        sessionsRef.current.some((session) => session.id === paneId),
      );
    },
    [activeTabId, inboxAskPortal, closeIrgatView],
  );

  const onOpenDiff = useCallback(
    (
      path?: string,
      session?: { sessionId: string; cwd: string },
      changeKind?: GitFileDiffKind,
      pin = false,
      options?: { exact?: boolean },
    ) => {
      void (async () => {
        const diffCwd = session?.cwd ?? gitCwdRef.current;
        const diffProjectCwd = session
          ? sessionsRef.current.find((entry) => entry.id === session.sessionId)
              ?.cwd
          : sidebarCwdRef.current;
        const resolved = path
          ? options?.exact
            ? path
            : ((await resolveOpenablePath(diffCwd, path)) ?? path)
          : undefined;
        if (resolved) rememberOpenedFile(diffCwd, resolved);
        setTabs((prev) =>
          prev.map((tab) => {
            if (tab.id !== activeTabId) return tab;
            if (session) {
              return openSessionChangesTab(
                tab,
                session.cwd,
                session.sessionId,
                resolved,
                diffProjectCwd,
                pin,
              );
            }
            if (loadDiffViewer() === "unified") {
              return openChangesTab(
                tab,
                diffCwd,
                resolved,
                changeKind,
                diffProjectCwd,
              );
            }
            if (!resolved) return tab;
            return openEditorTab(
              tab,
              newFileTab(resolved, diffCwd, true, changeKind, diffProjectCwd),
              { pin },
            );
          }),
        );
        setSidebarTab("changes", diffProjectCwd);
        setComposerFocused(false);
      })();
    },
    [activeTabId],
  );

  // A Irgat view covers the workspace, so its session changes open on the
  // overview's Changes tab instead of in a project tab hidden behind it.
  const openIrgatChanges = useCallback((request: IrgatChangesRequest) => {
    setIrgatActivity(null);
    setIrgatShownSession(null);
    setIrgatOverviewDocument(null);
    setIrgatChangesRequest(request);
    setIrgatOverviewTab("changes");
    setIrgatOverviewOpen(true);
  }, []);
  const onOpenIrgatDiff = useCallback(
    (path?: string, session?: { sessionId: string; cwd: string }) => {
      if (!session) {
        onOpenDiff(path);
        return;
      }
      openIrgatChanges({ path });
    },
    [onOpenDiff, openIrgatChanges],
  );
  const onCommitIrgatChanges = useCallback(
    () => openIrgatChanges({}),
    [openIrgatChanges],
  );

  const onOpenWorkingTreeDiff = useCallback(
    (path: string, kind?: GitFileDiffKind, pin?: boolean) =>
      onOpenDiff(path, undefined, kind, pin, { exact: true }),
    [onOpenDiff],
  );

  /** Stack one section's working-tree changes in one review, whatever the diff-view setting. */
  const onOpenAllChanges = useCallback(
    (kind: GitFileDiffKind) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openChangesTab(
                tab,
                gitCwdRef.current,
                undefined,
                kind,
                sidebarCwdRef.current,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onOpenCommit = useCallback(
    (commit: GitHistoryCommit, pin?: boolean) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openCommitTab(
                tab,
                gitCwdRef.current,
                {
                  sha: commit.sha,
                  shortSha: commit.shortSha,
                  subject: commit.subject,
                },
                sidebarCwdRef.current,
                pin,
              )
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onShowSourceControl = useCallback(() => {
    setSidebarTab("changes");
  }, []);

  const onToggleChanges = useCallback(() => {
    onShowSourceControl();
  }, [onShowSourceControl]);

  const onReorderTabs = useCallback(
    (ids: string[], movedId?: string) => {
      setTabs((prev) => {
        const visibleIds = new Set(ids);
        const visibleTabs = prev.filter((tab) => visibleIds.has(tab.id));
        if (movedId) {
          const reordered = applyGroupedReorder(
            visibleTabs,
            ids,
            movedId,
            projectOfTab,
          );
          return reordered ? mergeOrderedSubset(prev, reordered) : prev;
        }
        return mergeOrderedSubset(prev, orderByIds(visibleTabs, ids));
      });
    },
    [projectOfTab],
  );

  const onReorderFiles = useCallback((paneId: string, ids: string[]) => {
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          tab,
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId
              ? { ...pane, files: orderByIds(pane.files, ids) }
              : pane,
          ),
        );
      }),
    );
  }, []);

  const onMovePane = useCallback(
    (fromId: string, toId: string, edge: PaneEdge) => {
      setTabs((prev) =>
        prev.map((tab) => {
          return leafIds(tab.layout).includes(fromId)
            ? {
                ...tab,
                layout: movePane(tab.layout, fromId, toId, edge),
                focusedId: fromId,
              }
            : tab;
        }),
      );
    },
    [],
  );

  const onDetachPane = useCallback(
    (paneId: string, targetTabId: string, position: "before" | "after") => {
      const result = applyDetachPaneToTab({
        tabs: tabsRef.current,
        paneId,
        targetTabId,
        position,
      });
      if (!result) return;

      tabsRef.current = result.tabs;
      setTabs(result.tabs);
      setProjectTerminalFocused(false);
      activateTab(result.activeTabId, result.focusedId);
    },
    [activateTab],
  );

  const focusOpenSession = useCallback((sessionId: string) => {
    const tab = findOpenSessionTab(
      tabsRef.current,
      sessionsRef.current,
      sessionId,
    );
    if (!tab) return false;
    loadedSessionCache.current.delete(sessionId);
    setActiveTabId(tab.id);
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id ? { ...entry, focusedId: sessionId } : entry,
      ),
    );
    setComposerFocused(true);
    return true;
  }, []);

  /**
   * Put a saved note into a chat that is already open, in front of the
   * user, keeping whatever is typed there. False when that chat is gone.
   */
  const addNoteToOpenChat = useCallback(
    (card: NoteComposerCard, sessionId: string) => {
      const target = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!target) return false;
      const irgat = isIrgatSession(sessionId);
      if (
        irgat
          ? irgatViewIdRef.current !== sessionId
          : !findOpenSessionTab(tabsRef.current, sessionsRef.current, sessionId)
      )
        return false;
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      if (!irgat) {
        if (irgatViewIdRef.current) closeIrgatView();
        focusOpenSession(sessionId);
      }
      setProjectTerminalFocused(false);
      setComposerFocused(true);
      if (noteChatPlacement(target, card, irgat) === "card") {
        const next = sessionsRef.current.map((session) =>
          session.id === sessionId ? { ...session, noteCard: card } : session,
        );
        sessionsRef.current = next;
        setSessions(next);
        return true;
      }
      const text = appendNoteReference("", card.title, card.body);
      if (!requestInsertIntoChat(sessionId, text)) {
        setComposerDraft(
          sessionId,
          appendComposerInsert(getComposerDraft(sessionId) ?? "", text),
        );
      }
      return true;
    },
    [closeIrgatView, focusOpenSession],
  );

  useEffect(() => {
    const onAdd = (event: Event) => {
      const request = (event as CustomEvent<AddNoteToChatRequest>).detail;
      if (!request?.card?.id) return;
      if (
        request.targetSessionId &&
        addNoteToOpenChat(request.card, request.targetSessionId)
      )
        return;
      onAddNoteToChat(request.card);
    };
    window.addEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
  }, [addNoteToOpenChat, onAddNoteToChat]);

  const replaceBlankPaneWithSession = useCallback((session: Session) => {
    const tab =
      tabsRef.current.find((entry) => entry.id === activeTabIdRef.current) ??
      tabsRef.current[0];
    if (!tab) return false;

    const paneId = isBlankSession(
      sessionsRef.current.find((entry) => entry.id === tab.focusedId),
    )
      ? tab.focusedId
      : leafIds(tab.layout).find((id) =>
          isBlankSession(sessionsRef.current.find((entry) => entry.id === id)),
        );
    if (!paneId || paneId === session.id) return false;

    lastPersisted.current.delete(paneId);
    {
      const blank = sessionsRef.current.find((entry) => entry.id === paneId);
      if (blank) void forgetHarnessSession(blank.harness, paneId);
    }
    setSessions((prev) => {
      const next = prev.filter((entry) => entry.id !== paneId);
      return next.some((entry) => entry.id === session.id)
        ? next
        : [...next, session];
    });
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id
          ? {
              ...entry,
              layout: replaceLeafId(entry.layout, paneId, session.id),
              focusedId: session.id,
            }
          : entry,
      ),
    );
    setActiveTabId(tab.id);
    setComposerFocused(true);
    return true;
  }, []);

  const invalidateLoadedSession = useCallback((sessionId: string) => {
    openingSessionIds.current.delete(sessionId);
    loadedSessionCache.current.delete(sessionId);
    sessionLoads.current.delete(sessionId);
    sessionLoadEpochs.current.set(
      sessionId,
      (sessionLoadEpochs.current.get(sessionId) ?? 0) + 1,
    );
  }, []);

  const loadStoredSession = useCallback(
    (sessionId: string): Promise<Session | null> => {
      const cached = loadedSessionCache.current.get(sessionId);
      if (cached) {
        // The cache owns closed sessions only. Transfer this reference into
        // live state instead of retaining a stale duplicate while it changes.
        loadedSessionCache.current.delete(sessionId);
        return Promise.resolve(cached);
      }

      const pending = sessionLoads.current.get(sessionId);
      if (pending) return pending;

      const epoch = sessionLoadEpochs.current.get(sessionId) ?? 0;
      const loading = getSession(sessionId)
        .then((loaded) => {
          if (
            !loaded ||
            removingSessionIds.current.has(sessionId) ||
            (sessionLoadEpochs.current.get(sessionId) ?? 0) !== epoch
          ) {
            return null;
          }
          return loaded;
        })
        .catch(() => null);
      sessionLoads.current.set(sessionId, loading);
      void loading.then(() => {
        if (sessionLoads.current.get(sessionId) === loading) {
          sessionLoads.current.delete(sessionId);
        }
      });
      return loading;
    },
    [],
  );

  const ensureOpenSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open) return open;

      openingSessionIds.current.add(sessionId);
      const restored = await loadStoredSession(sessionId);
      if (!restored || removingSessionIds.current.has(sessionId)) {
        openingSessionIds.current.delete(sessionId);
        void refreshHistory(sidebarCwd);
        return null;
      }
      loadedSessionCache.current.delete(sessionId);
      const appeared = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (appeared) return appeared;
      if (
        !restored.worktreeRemoved &&
        restored.providerSessionId &&
        isLiveHarness(restored.harness)
      ) {
        bindHarnessSession(
          restored.harness,
          restored.id,
          restored.providerSessionId,
          sessionWorkCwd(restored),
          restored.providerAccountId,
          restored.blocks,
        );
      }
      lastPersisted.current.set(restored.id, persistFingerprint(restored));
      if (!sessionsRef.current.some((session) => session.id === restored.id)) {
        const next = [...sessionsRef.current, restored];
        sessionsRef.current = next;
        setSessions(next);
      }
      return restored;
    },
    [loadStoredSession, refreshHistory, sidebarCwd],
  );

  const onPrefetchHistorySession = useCallback(
    (sessionId: string) => {
      if (
        removingSessionIds.current.has(sessionId) ||
        sessionsRef.current.some((session) => session.id === sessionId) ||
        loadedSessionCache.current.has(sessionId) ||
        sessionLoads.current.has(sessionId) ||
        activeSessionPrefetch.current
      ) {
        return;
      }
      const loading = loadStoredSession(sessionId);
      activeSessionPrefetch.current = loading;
      void loading.then((loaded) => {
        if (
          loaded &&
          !removingSessionIds.current.has(sessionId) &&
          !sessionsRef.current.some((session) => session.id === sessionId)
        ) {
          rememberLoadedSession(loadedSessionCache.current, loaded);
        }
        if (activeSessionPrefetch.current === loading) {
          activeSessionPrefetch.current = null;
        }
      });
    },
    [loadStoredSession],
  );

  const revealLinkedSessionUpdate = useCallback(
    (sessionId: string, update: LinkedSessionUpdate) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      if (!session?.linkedWorkItem) return;
      if (
        session.linkedWorkItemUpdateCard?.updatedAt === update.updatedAt &&
        session.linkedWorkItemUpdateCard.status !== "error"
      ) {
        return;
      }
      if (
        linkedWorkItemActivityFetches.current.get(sessionId) ===
        update.updatedAt
      ) {
        return;
      }
      const pending = pendingLinkedWorkItemUpdateCard(update);
      linkedWorkItemActivityFetches.current.set(sessionId, update.updatedAt);
      // A stale/error card should not remain visible while fresh details load.
      // The session itself is already open; this request stays fully detached
      // from the navigation path.
      setLinkedWorkItemUpdateCard(sessionId, (current) =>
        current?.updatedAt === update.updatedAt && current.status === "ready"
          ? current
          : undefined,
      );

      void githubWorkItemThread(
        session.cwd,
        session.linkedWorkItem.repo,
        session.linkedWorkItem.kind,
        session.linkedWorkItem.number,
        { force: true },
      ).then(
        (thread) => {
          if (
            linkedWorkItemActivityFetches.current.get(sessionId) !==
            pending.updatedAt
          ) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (
            linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !==
            pending.updatedAt
          ) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () =>
            completeLinkedWorkItemUpdateCard(pending, thread),
          );
        },
        () => {
          if (
            linkedWorkItemActivityFetches.current.get(sessionId) !==
            pending.updatedAt
          ) {
            return;
          }
          linkedWorkItemActivityFetches.current.delete(sessionId);
          if (
            linkedSessionUpdatesRef.current.get(sessionId)?.updatedAt !==
            pending.updatedAt
          ) {
            return;
          }
          setLinkedWorkItemUpdateCard(sessionId, () =>
            failLinkedWorkItemUpdateCard(pending),
          );
        },
      );
    },
    [setLinkedWorkItemUpdateCard],
  );

  const onAskInboxItem = useCallback(
    (item: InboxItem): Promise<string> => {
      const key = inboxAskKey(item);
      const pending = openingInboxSessions.current.get(key);
      if (pending) return pending;
      const opening = (async () => {
        let session = sessionsRef.current.find(
          (entry) => entry.inboxAsk?.key === key,
        );
        if (!session) {
          const candidate = item.projectPath || sidebarCwd;
          const cwd =
            candidate && candidate !== "~"
              ? candidate
              : await invoke<string>("default_cwd");
          const description =
            item.provider === "linear" || item.provider === "jira"
              ? await inboxTrackerDescription(item)
              : item.provider === "gitlab" &&
                  (item.kind === "issue" || item.kind === "pr")
                ? (
                    peekGitlabWorkItemDetails(
                      item.repo,
                      item.kind,
                      item.number,
                    ) ??
                    (await gitlabWorkItemDetails(
                      item.repo,
                      item.kind,
                      item.number,
                    ))
                  ).body
                : item.provider === "azuredevops" &&
                    (item.kind === "issue" || item.kind === "pr")
                  ? (
                      peekAzureDevOpsWorkItemDetails(
                        item.repo,
                        item.kind,
                        item.number,
                      ) ??
                      (await azureDevOpsWorkItemDetails(
                        item.repo,
                        item.kind,
                        item.number,
                      ))
                    ).body
                  : undefined;
          session = {
            ...newDefaultSession(cwd),
            title: `Ask · ${item.title}`,
            inboxAsk: {
              key,
              title: item.title,
              url: item.url,
              provider: item.provider,
              description,
            },
          };
          sessionsRef.current = [...sessionsRef.current, session];
          setSessions(sessionsRef.current);
        }
        return session.id;
      })();
      openingInboxSessions.current.set(key, opening);
      void opening.then(
        () => openingInboxSessions.current.delete(key),
        () => openingInboxSessions.current.delete(key),
      );
      return opening;
    },
    [sidebarCwd],
  );

  const onRestartInboxAsk = useCallback(
    async (item: InboxItem): Promise<string> => {
      const id = await onAskInboxItem(item);
      const current = sessionsRef.current.find((session) => session.id === id)!;
      removingSessionIds.current.add(id);
      try {
        await stopSessionForRemoval(id);
        const stopped =
          sessionsRef.current.find((session) => session.id === id) ?? current;
        await Promise.all(
          sessionChildHarnesses(stopped).map((harness) =>
            forgetHarnessSession(harness, id),
          ),
        );
        const imagePaths = stopped.blocks.flatMap((block) =>
          block.role === "image" && block.image ? [block.image.path] : [],
        );
        await deleteSession(id, imagePaths);
        const fresh = {
          ...newSession(
            stopped.harness,
            stopped.cwd,
            stopped.model,
            stopped.runtimeMode,
            stopped.modelSettings,
          ),
          title: stopped.title,
          inboxAsk: stopped.inboxAsk,
        };
        const next = sessionsRef.current.map((session) =>
          session.id === id ? fresh : session,
        );
        sessionsRef.current = next;
        setSessions(next);
        setInboxAskPortal((portal) =>
          portal?.sessionId === id
            ? { ...portal, sessionId: fresh.id }
            : portal,
        );
        return fresh.id;
      } finally {
        removingSessionIds.current.delete(id);
      }
    },
    [onAskInboxItem, stopSessionForRemoval],
  );

  useEffect(() => {
    if (!inboxAskPortal || !inboxViewOpen) return;
    setComposerFocused(true);
  }, [inboxAskPortal, inboxViewOpen]);

  /** The last Irgat opened, which the shortcut brings back. */
  const lastIrgatIdRef = useRef<string | undefined>(undefined);

  /** A Irgat's conversation is a view over the existing workspace tabs. */
  const onOpenIrgat = useCallback(
    async (irgatId: string, childId?: string) => {
      setIrgatActivity(null);
      workspaceNavigation.cancel();
      const request = ++irgatViewRequest.current;
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      lastIrgatIdRef.current = irgatId;
      const session =
        childId && irgatForSession(childId)?.id === irgatId
          ? await ensureOpenSession(childId)
          : await ensureIrgatSession(irgatId, {
              home: homeDir,
              load: ensureOpenSession,
              create: (path) => newDefaultSession(path),
              add: (created) => {
                sessionsRef.current = [...sessionsRef.current, created];
                setSessions(sessionsRef.current);
              },
            });
      if (!session || request !== irgatViewRequest.current) return;
      // What the last Irgat had open over its overview is its own; another
      // Irgat opens on its list.
      if (irgatViewIdRef.current !== session.id) {
        setIrgatShownSession(null);
        setIrgatShownSessionFocused(false);
        setIrgatOverviewDocument(null);
        setIrgatOverviewArtifact(null);
      }
      irgatViewIdRef.current = session.id;
      saveOpenIrgat(irgatId);
      setIrgatViewId(session.id);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
      setComposerFocusToken((token) => token + 1);
    },
    [ensureOpenSession, workspaceNavigation.cancel],
  );

  const onSelectProviderAccount = useCallback(
    (
      provider: ProviderAccountProvider,
      accountId: string,
      sessionId?: string,
    ) => {
      const current = sessionsRef.current.find(
        (session) => session.id === (sessionId ?? activeSessionIdRef.current),
      );
      if (!current || current.harness !== provider) return;

      if (current.blocks.length === 0 && !current.busy) {
        if (current.providerAccountId === accountId) return;
        updateSessionState(sessionsRef, setSessions, (sessions) =>
          sessions.map((session) =>
            session.id === current.id
              ? { ...session, providerAccountId: accountId }
              : session,
          ),
        );
        return;
      }

      const currentId = current.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
      if (currentId === accountId) return;

      // Provider thread ids are account-owned. Keep the current conversation
      // pinned to its account and open a clean one for the selected profile.
      const owner = irgatForSession(current.id);
      const session = {
        ...(owner
          ? createIrgatChildSession(
              owner.id,
              current,
              (id) => sessionsRef.current.find((entry) => entry.id === id)?.title,
            )
          : newSession(
              current.harness,
              current.cwd,
              current.model,
              current.runtimeMode,
              current.modelSettings,
            )),
        providerAccountId: accountId,
      };
      const tab = newTab(session.id);
      updateSessionState(sessionsRef, setSessions, (sessions) => [
        ...sessions,
        session,
      ]);
      if (owner) {
        // Like New chat: the roster lists this child, so store it before
        // opening, or a restart leaves a row with nothing behind it.
        void upsertSession(session).then(
          () => onOpenIrgat(owner.id, session.id),
          (error) => {
            updateIrgat(owner.id, (irgat) => ({
              ...irgat,
              childSessionIds: irgat.childSessionIds?.filter(
                (id) => id !== session.id,
              ),
            }));
            updateSessionState(sessionsRef, setSessions, (sessions) =>
              sessions.filter((entry) => entry.id !== session.id),
            );
            void message(String(error), {
              title: "Could not open a chat for this account",
              kind: "error",
            });
          },
        );
      } else if (isFreeChatSession(current)) openFreeChat(session.id);
      else {
        appendTab(tab, current.cwd);
        setActiveTabId(tab.id);
      }
      setComposerFocused(true);
    },
    [appendTab, openFreeChat, onOpenIrgat],
  );
  // A Irgat open when the app last closed opens again; a moved window keeps
  // what it carried.
  const reopenedIrgat = useRef(false);
  useEffect(() => {
    if (reopenedIrgat.current) return;
    reopenedIrgat.current = true;
    if (windowTransfer || !irgatsEnabled) return;
    const irgatId = loadOpenIrgat();
    if (irgatId && findIrgat(irgatId)) void onOpenIrgat(irgatId);
    else if (irgatId) saveOpenIrgat(undefined);
  }, [irgatsEnabled, onOpenIrgat, windowTransfer]);

  /** The shortcut opens the last Irgat, or the first on the rail. */
  const onToggleIrgat = useCallback(() => {
    if (irgatViewIdRef.current) {
      closeIrgatView();
      setComposerFocused(true);
      return;
    }
    if (!irgatsEnabled) return;
    const last = lastIrgatIdRef.current;
    const irgatId =
      (last && findIrgat(last) ? last : undefined) ?? listIrgats()[0]?.id;
    if (irgatId) void onOpenIrgat(irgatId);
  }, [closeIrgatView, irgatsEnabled, onOpenIrgat]);

  /**
   * A group room covers the workspace the way an Irgat does, through the same
   * view slot, so leaving it works everywhere leaving an Irgat does.
   */
  const onOpenIrgatGroup = useCallback(
    (groupId: string) => {
      setIrgatActivity(null);
      workspaceNavigation.cancel();
      irgatViewRequest.current += 1;
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      const key = irgatGroupViewKey(groupId);
      irgatViewIdRef.current = key;
      saveOpenIrgat(undefined);
      setIrgatViewId(key);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
      setComposerFocusToken((token) => token + 1);
    },
    [workspaceNavigation.cancel],
  );

  /** A new Irgat opens straight away, ready to be told what it works on. */
  const onCreateIrgat = useCallback(() => {
    const irgatId = createIrgat().id;
    setIrgatActivity(null);
    setIrgatOverviewTab("settings");
    setIrgatOverviewOpen(true);
    void onOpenIrgat(irgatId);
  }, [onOpenIrgat]);

  const onResetIrgat = useCallback(
    async (sessionId: string): Promise<void> => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!current || !isIrgatSession(sessionId))
        throw new Error("This Irgat's conversation is no longer available.");
      if (removingSessionIds.current.has(sessionId))
        throw new Error("This conversation is already being reset.");

      removingSessionIds.current.add(sessionId);
      pendingPersist.current.delete(sessionId);
      invalidateLoadedSession(sessionId);
      try {
        await resetIrgatSession(current, {
          stop: async (id) => {
            const latest = (await stopSessionForRemoval(id)) ?? current;
            const stopped = {
              ...stopStreaming(latest),
              queueStatus: "paused" as const,
            };
            sessionsRef.current = sessionsRef.current.map((session) =>
              session.id === id ? stopped : session,
            );
            setSessions(sessionsRef.current);
            return stopped;
          },
          remove: async (stopped) => {
            await Promise.all(
              sessionChildHarnesses(stopped).map((harness) =>
                forgetHarnessSession(harness, sessionId),
              ),
            );
            await flushSessionCheckpoint(sessionId);
            const imagePaths = stopped.blocks.flatMap((block) =>
              block.role === "image" && block.image ? [block.image.path] : [],
            );
            await orchestrator.deleteSession(sessionId, () =>
              deleteSession(sessionId, imagePaths),
            );
          },
          replace: (fresh) => {
            pendingPersist.current.delete(sessionId);
            lastPersisted.current.delete(sessionId);
            lastPersistedUserBlock.current.delete(sessionId);
            lastBoundProvider.current.delete(sessionId);
            invalidateLoadedSession(sessionId);
            sessionsRef.current = sessionsRef.current.map((session) =>
              session.id === sessionId ? fresh : session,
            );
            setSessions(sessionsRef.current);
            setHistory((history) =>
              history.filter((entry) => entry.id !== sessionId),
            );
            setStoredLinkedSessions((history) =>
              history.filter((entry) => entry.id !== sessionId),
            );
            if (irgatViewIdRef.current === sessionId) {
              irgatViewRequest.current += 1;
              irgatViewIdRef.current = fresh.id;
              setIrgatViewId(fresh.id);
              setComposerFocused(true);
              setComposerFocusToken((token) => token + 1);
            }
          },
        });
      } finally {
        removingSessionIds.current.delete(sessionId);
      }
    },
    [invalidateLoadedSession, stopSessionForRemoval],
  );

  const onSelectHistorySession = useCallback(
    async (sessionId: string) => {
      workspaceNavigation.cancel();
      let session = await ensureOpenSession(sessionId);
      if (!session || session.inboxAsk) return;
      const irgat = irgatForSession(session.id);
      if (irgat) {
        await onOpenIrgat(irgat.id, session.id);
        return;
      }
      if (isFreeChatSession(session)) {
        openFreeChat(session.id);
        return;
      }
      const parentId =
        session.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        session = await ensureOpenSession(parentId);
        if (!session) return;
      }
      if (looksLikeProject(session.cwd))
        setProjectCwd(normalizeProjectPath(session.cwd));
      const linkedUpdate = linkedSessionUpdatesRef.current.get(session.id);
      if (focusOpenSession(session.id)) {
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      if (replaceBlankPaneWithSession(session)) {
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      const tab = newTab(session.id);
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
      if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
    },
    [
      appendTab,
      ensureOpenSession,
      onOpenIrgat,
      openFreeChat,
      focusOpenSession,
      replaceBlankPaneWithSession,
      revealLinkedSessionUpdate,
    ],
  );

  const onOpenIrgatLaunchedSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session) throw new Error("This session is no longer available.");
      closeIrgatView();
      setSidebarTab("sessions", session.cwd);
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, closeIrgatView, setSidebarTab, onSelectHistorySession],
  );

  // A launched session opens over the overview, where it can be followed,
  // answered or stopped without leaving the chat. Back lands on every session
  // the Irgat started; opening the one already shown hides it again.
  const showIrgatLaunchedSession = useCallback(
    async (irgatSessionId: string, launchedId: string) => {
      if (shownIrgatSessionIdRef.current === launchedId) {
        setIrgatShownSession(null);
        return;
      }
      // A session on another machine opens in that project's remote tab.
      // Any of the Irgat's chats may have launched it, not just this one.
      const irgat = sessionsRef.current.find(
        (entry) => entry.id === irgatSessionId,
      );
      const remoteLaunch = [
        ...(irgat ? irgatSpawnedSessions(irgat.blocks) : []),
        ...irgatLaunchesRef.current,
      ].find(
        (entry) =>
          entry.sessionId === launchedId && isRemoteProjectPath(entry.cwd),
      );
      if (remoteLaunch) {
        closeIrgatView();
        setSidebarTab("sessions", remoteLaunch.cwd);
        setProjectCwd(remoteLaunch.cwd);
        setRecents(rememberProject(remoteLaunch.cwd));
        onSelectRemoteSession(remoteLaunch.cwd, launchedId);
        return;
      }
      // Load it first, then switch in one step: the overview goes straight
      // from what it shows to this session, never through the list.
      const session = await ensureOpenSession(launchedId).catch(() => null);
      if (irgatViewIdRef.current !== irgatSessionId) return;
      setIrgatActivity(null);
      setIrgatOverviewTab((tab) => (tab === "all" ? tab : "sessions"));
      setIrgatOverviewDocument(null);
      setIrgatOverviewOpen(true);
      // One that is gone leaves the sessions list open, which says so.
      if (!session) {
        setIrgatShownSession(null);
        return;
      }
      setIrgatShownSession(launchedId);
      setIrgatShownSessionFocused(true);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    },
    [ensureOpenSession, closeIrgatView, onSelectRemoteSession],
  );
  const onOpenIrgatSession = useCallback(
    (
      irgatSessionId: string,
      _turnId: string,
      _blocks: Block[],
      launchedId: string,
    ) => showIrgatLaunchedSession(irgatSessionId, launchedId),
    [showIrgatLaunchedSession],
  );

  const openReminderSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session)
        throw new Error("This conversation is no longer available.");
      if (isFreeChatSession(session)) {
        openFreeChat(session.id);
        return;
      }
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession, openFreeChat],
  );

  const openReferencedSession = useCallback(
    async (sessionId: string, blockId?: string) => {
      if (blockId) requestTranscriptJump(sessionId, blockId);
      await openReminderSession(sessionId);
    },
    [openReminderSession],
  );

  useEffect(() => publishLiveSessions(sessions), [sessions]);

  const ensureReminderSessionsSaved = useCallback(
    async (ids: readonly string[]) => {
      for (const id of ids) {
        const session = sessionsRef.current.find(
          (session) => session.id === id,
        );
        if (session && !(await upsertSession(session))) {
          throw new Error(
            "Send a message in this conversation before setting a reminder.",
          );
        }
      }
    },
    [],
  );

  const sessionReminders = useSessionReminders(
    openReminderSession,
    ensureReminderSessionsSaved,
    sessions
      .filter((session) => !session.inboxAsk)
      .map((session) => session.id),
  );

  const dismissNoticesForContinuedSession = useCallback(
    (sessionId: string) => {
      void sessionReminders.dismissDue(sessionId);
      const updatedAt = sessionsRef.current.find(
        (session) => session.id === sessionId,
      )?.linkedWorkItemUpdateCard?.updatedAt;
      if (updatedAt == null) return;
      markLinkedSessionUpdateSeen(sessionId, updatedAt);
      setLinkedWorkItemUpdateCard(sessionId, (card) =>
        card?.updatedAt === updatedAt ? undefined : card,
      );
    },
    [sessionReminders.dismissDue, setLinkedWorkItemUpdateCard],
  );

  const onPlaceSessionOnPane = useCallback(
    async (sessionId: string, targetId: string, edge: PaneEdge) => {
      if (sessionId === targetId) return;
      const targetTab = tabsRef.current.find((tab) =>
        leafIds(tab.layout).includes(targetId),
      );
      if (!targetTab) return;

      const alreadyHere = leafIds(targetTab.layout).includes(sessionId);
      if (!alreadyHere) {
        const session = await ensureOpenSession(sessionId);
        if (!session) return;
      }

      const tab = tabsRef.current.find((entry) => entry.id === targetTab.id);
      if (!tab || !leafIds(tab.layout).includes(targetId)) return;

      const replaceTarget =
        !leafIds(tab.layout).includes(sessionId) &&
        isBlankSession(
          sessionsRef.current.find((entry) => entry.id === targetId),
        );

      if (replaceTarget) {
        lastPersisted.current.delete(targetId);
        const blank = sessionsRef.current.find(
          (entry) => entry.id === targetId,
        );
        if (blank) void forgetHarnessSession(blank.harness, targetId);
      }

      const result = applyPlaceSessionOnPane({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        sessionId,
        targetId,
        edge,
        replaceTarget,
        scope: tabCloseScope,
        createReplacement: (seed) =>
          newDefaultSession(
            seed?.cwd ?? projectCwdRef.current,
            seed?.runtimeMode,
          ),
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    },
    [ensureOpenSession, tabCloseScope],
  );

  // Chats open beside the Irgat's or the Chat page's own chat.
  const [sidePanes, setSidePanes] = useState<SidePaneMap>(loadSidePanes);
  useEffect(() => saveSidePanes(sidePanes), [sidePanes]);
  const [sidePaneFocusId, setSidePaneFocusId] = useState<string | null>(null);
  const sidePaneIrgat = irgatViewId ? irgatForSession(irgatViewId) : undefined;
  const sidePaneKey: SidePaneKey | null = sidePaneIrgat
    ? irgatSidePaneKey(sidePaneIrgat.id)
    : chatViewOpen && !irgatViewId
      ? "chats"
      : null;
  const sidePaneKeyRef = useRef(sidePaneKey);
  sidePaneKeyRef.current = sidePaneKey;
  // Starts a new chat beside the open one; set once the creators exist below.
  const newChatBesideRef = useRef<() => void>(() => {});
  // Focus goes back to the main chat when the view changes.
  useEffect(() => setSidePaneFocusId(null), [sidePaneKey]);
  // A row saved before a restart loads its chats; ones that are gone leave it.
  useEffect(() => {
    if (!sidePaneKey) return;
    for (const id of sidePanes[sidePaneKey]?.ids ?? []) {
      if (sessionsRef.current.some((session) => session.id === id)) continue;
      void ensureOpenSession(id)
        .catch(() => null)
        .then((session) => {
          if (!session) setSidePanes((map) => forgetSidePane(map, id));
        });
    }
    // Only on entering a view; opening beside loads its chat itself.
  }, [sidePaneKey, ensureOpenSession]);

  /**
   * Shows `sessionId` next to what is open: beside the Irgat's or the Chat
   * page's chat, or as a split right of the focused pane in a project.
   */
  const onOpenBeside = useCallback(
    async (sessionId: string) => {
      const key = sidePaneKeyRef.current;
      if (key) {
        const session = await ensureOpenSession(sessionId).catch(() => null);
        if (!session || sidePaneKeyRef.current !== key) return;
        const mainId =
          key === "chats"
            ? freeChatIdRef.current
            : (irgatViewIdRef.current ?? undefined);
        // With no chat open yet, the chat simply opens.
        if (!mainId) {
          openFreeChat(sessionId);
          return;
        }
        setSidePanes((map) => ({
          ...map,
          [key]: openBeside(map[key], mainId, sessionId),
        }));
        setSidePaneFocusId(sessionId === mainId ? null : sessionId);
        setProjectTerminalFocused(false);
        setComposerFocused(true);
        setComposerFocusToken((token) => token + 1);
        return;
      }
      const tab =
        tabsRef.current.find((entry) => entry.id === activeTabIdRef.current) ??
        tabsRef.current[0];
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      // Irgat chats and free chats have their own pages, not project panes.
      if (
        !tab ||
        isIrgatSession(sessionId) ||
        (session && isFreeChatSession(session))
      ) {
        return;
      }
      const target = tab.focusedId || firstLeafId(tab.layout);
      if (!target || target === sessionId) return;
      await onPlaceSessionOnPane(sessionId, target, "right");
    },
    [ensureOpenSession, onPlaceSessionOnPane, openFreeChat],
  );
  const onCloseSidePane = useCallback((sessionId: string) => {
    const key = sidePaneKeyRef.current;
    if (!key) return;
    setSidePanes((map) => {
      const next = { ...map };
      const after = closeSidePane(map[key], sessionId);
      if (after) next[key] = after;
      else delete next[key];
      return next;
    });
    setSidePaneFocusId((focused) => (focused === sessionId ? null : focused));
  }, []);

  const onPlaceTabOnPane = useCallback(
    (sourceTabId: string, targetId: string, edge: PaneEdge) => {
      const targetTab = tabsRef.current.find((tab) =>
        leafIds(tab.layout).includes(targetId),
      );
      if (!targetTab || targetTab.id === sourceTabId) return;

      const blankTarget = sessionsRef.current.find(
        (session) => session.id === targetId && isBlankSession(session),
      );
      const result = applyPlaceTabOnPane({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        sourceTabId,
        targetId,
        edge,
        replaceTarget: blankTarget != null,
      });
      if (!result) return;

      if (blankTarget) {
        lastPersisted.current.delete(blankTarget.id);
        void forgetHarnessSession(blankTarget.harness, blankTarget.id);
      }
      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(
        result.sessions.some((session) => session.id === result.focusedId),
      );
    },
    [],
  );

  const onRenameHistorySession = useCallback(
    async (sessionId: string, displayTitle: string) => {
      const trimmed = displayTitle.trim();
      if (!trimmed) return;
      invalidateLoadedSession(sessionId);

      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open) {
        const title = formatSessionTitle(open.harness, trimmed);
        const updated = { ...open, title };
        setSessions((prev) =>
          prev.map((session) => (session.id === sessionId ? updated : session)),
        );
        loadedSessionCache.current.delete(sessionId);
        persistSession(updated);
      } else {
        const restored = await getSession(sessionId).catch(() => null);
        if (!restored) {
          void refreshHistory(sidebarCwd);
          return;
        }
        const updated = {
          ...restored,
          title: formatSessionTitle(restored.harness, trimmed),
        };
        const saved = await upsertSession(updated).catch(() => null);
        if (saved) {
          rememberLoadedSession(loadedSessionCache.current, updated);
          lastPersisted.current.set(sessionId, persistFingerprint(updated));
        }
      }
      void refreshHistory(sidebarCwd);
    },
    [invalidateLoadedSession, persistSession, refreshHistory, sidebarCwd],
  );

  const checkOpenWorktreeFiles = useCallback((path: string) => {
    assertWorktreeFilesClosed(path, [
      ...filesInWorkspaceTabs(tabsRef.current),
      ...projectTerminalsRef.current.flatMap((dock) => dock.pane.files),
    ]);
  }, []);

  const onCheckWorktreeRemoval = useCallback(
    async (cwd: string, path: string, force: boolean) => {
      checkOpenWorktreeFiles(path);
      await checkWorktreeRemoval(cwd, path, force);
      // Re-read UI state after the native check, before deleting sessions.
      checkOpenWorktreeFiles(path);
    },
    [checkOpenWorktreeFiles],
  );

  const onRemoveWorktree = useCallback(
    async (cwd: string, path: string, force: boolean, keepSessions = false) => {
      if (removingWorktreePaths.current.has(path)) {
        throw new Error("This worktree is already being deleted.");
      }
      removingWorktreePaths.current.add(path);
      const lockedIds = new Set<string>();
      const forgottenIds = new Set<string>();
      try {
        if (
          [...switchingWorktrees.current.values()].some((target) =>
            isEqualOrInside(target, path),
          )
        ) {
          throw new Error(
            "A session is selecting this worktree. Try deleting it again once selection finishes.",
          );
        }
        await onCheckWorktreeRemoval(cwd, path, force);
        const listed = await listWorktrees(cwd);
        const tree = listed.worktrees.find(
          (entry) => pathKey(entry.path) === pathKey(path),
        );
        if (!tree) throw new Error("This worktree is no longer available.");
        const ids = worktreeSessionIds(tree, sessionsRef.current);
        if (!keepSessions && ids.length) {
          throw new Error(
            "Move or delete the sessions using this worktree first.",
          );
        }
        if (
          ids.some(
            (id) =>
              removingSessionIds.current.has(id) ||
              switchingWorktrees.current.has(id),
          )
        ) {
          throw new Error(
            "Wait for these sessions to finish changing before deleting the worktree.",
          );
        }
        for (const id of ids) {
          removingSessionIds.current.add(id);
          lockedIds.add(id);
          pendingPersist.current.delete(id);
          invalidateLoadedSession(id);
        }
        for (const id of ids) {
          await stopSessionForRemoval(id);
          const session = sessionsRef.current.find((entry) => entry.id === id);
          if (!session) continue;
          await flushSessionCheckpoint(id);
          forgottenIds.add(id);
          for (const harness of sessionChildHarnesses(session)) {
            await forgetHarnessSession(harness, id);
          }
          const latest = sessionsRef.current.find((entry) => entry.id === id);
          if (!latest) continue;
          const stopped = {
            ...stopStreaming(latest),
            busy: false,
            queueStatus: "paused" as const,
            pendingQuestion: undefined,
          };
          sessionsRef.current = sessionsRef.current.map((entry) =>
            entry.id === id ? stopped : entry,
          );
          setSessions(sessionsRef.current);
          if (shouldPersistSession(stopped)) await upsertSession(stopped);
        }
        await flushSessionWrites();
        checkOpenWorktreeFiles(path);
        const removed = await removeWorktree(cwd, path, force, keepSessions);
        const affected = new Set([...ids, ...removed.sessionIds]);
        if (isEqualOrInside(projectCwdRef.current, path)) {
          setProjectCwd(removed.projectCwd);
          setRecents(rememberProject(removed.projectCwd));
        }
        for (const id of affected) {
          invalidateLoadedSession(id);
          pendingPersist.current.delete(id);
          lastPersisted.current.delete(id);
        }
        sessionsRef.current = sessionsRef.current.map((session) =>
          affected.has(session.id)
            ? detachSessionWorktree(session, removed.projectCwd, path)
            : session,
        );
        setSessions(sessionsRef.current);
        const patchSummary = (entry: SessionSummary) =>
          affected.has(entry.id)
            ? detachSessionWorktree(entry, removed.projectCwd, path)
            : entry;
        setHistory((current) => current.map(patchSummary));
        setStoredLinkedSessions((current) => current.map(patchSummary));
        for (const id of affected) notifyReviewChanged(id);
      } catch (error) {
        // Removal may fail after idle agent processes were stopped. Rebind
        // their saved threads so the unchanged working copy can still resume.
        const kept = sessionsRef.current.filter(
          (session) => forgottenIds.has(session.id) && !session.worktreeRemoved,
        );
        bindResumedSessions(kept);
        for (const session of kept) {
          const pending = session.pendingSwitch;
          if (pending?.fromProviderSessionId) {
            bindHarnessSession(
              pending.from,
              session.id,
              pending.fromProviderSessionId,
              sessionWorkCwd(session),
              pending.fromProviderAccountId,
              session.blocks,
            );
          }
        }
        throw error;
      } finally {
        removingWorktreePaths.current.delete(path);
        for (const id of lockedIds) removingSessionIds.current.delete(id);
      }
    },
    [
      checkOpenWorktreeFiles,
      invalidateLoadedSession,
      onCheckWorktreeRemoval,
      stopSessionForRemoval,
    ],
  );

  const onRemoveHistorySession = useCallback(
    async (
      sessionId: string,
      mode: "archive" | "delete",
      skipDeleteConfirm = false,
      origin: "ui" | "cli" = "ui",
    ): Promise<boolean> => {
      if (
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId) ||
        deleteConfirmationPending.current
      )
        return false;
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const summary = history.find((entry) => entry.id === sessionId);
      const seed = open ?? summary;
      const label = seed
        ? sessionDisplayTitle(seed.title, seed.harness)
        : "this session";
      removingSessionIds.current.add(sessionId);
      let deleteWorktreePath: string | undefined;
      if (mode === "delete" && !skipDeleteConfirm) {
        deleteConfirmationPending.current = true;
        let unusedWorktree: string | undefined;
        if (seed?.worktreeCwd) {
          try {
            const { worktrees } = await listWorktrees(seed.cwd);
            const tree = worktrees.find(
              (entry) => pathKey(entry.path) === pathKey(seed.worktreeCwd!),
            );
            if (
              tree &&
              !tree.isMain &&
              !tree.locked &&
              tree.branch &&
              worktreeSessionIds(tree, sessionsRef.current).every(
                (id) => id === sessionId,
              )
            )
              unusedWorktree = tree.path;
          } catch {
            // A failed lookup must never offer filesystem cleanup.
          }
        }
        // Deleting can't be undone, so it always asks, like chats and Irgats.
        const choice = await new Promise<SessionDeleteChoice>((resolve) => {
          setSessionDeleteDialog({ title: label, unusedWorktree, resolve });
        });
        deleteConfirmationPending.current = false;
        if (!choice.confirmed) {
          removingSessionIds.current.delete(sessionId);
          return false;
        }
        if (choice.deleteWorktree) deleteWorktreePath = unusedWorktree;
      }
      invalidateLoadedSession(sessionId);
      pendingPersist.current.delete(sessionId);
      try {
        const remover = createSessionRemover({
          mode,
          preserveOpenFiles: origin === "cli",
          scope: tabCloseScope,
          replacement: {
            harness: seed?.harness ?? "cursor",
            cwd: seed?.cwd ?? sidebarCwd,
            model: seed?.model,
            runtimeMode: seed?.runtimeMode,
            modelSettings: open?.modelSettings,
          },
          workspace: {
            snapshot: () => ({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              activeTabId: activeTabIdRef.current,
              dirtyFiles: dirtyFilesRef.current,
            }),
            apply: (change) => {
              if (change.type === "stopped") {
                const next = sessionsRef.current.map((session) =>
                  session.id === sessionId ? change.session : session,
                );
                sessionsRef.current = next;
                setSessions(next);
                return;
              }

              if (change.type === "orchestrationReleased") {
                const released = sessionsRef.current.map((session) =>
                  releaseOrchestrationWorker(session, change.leadId),
                );
                sessionsRef.current = released;
                setSessions(released);
                for (const [id, cached] of loadedSessionCache.current) {
                  if (
                    releaseOrchestrationWorker(cached, change.leadId) !== cached
                  )
                    invalidateLoadedSession(id);
                }
                // Pending reads may still carry the deleted lead's ownership.
                for (const id of sessionLoads.current.keys()) {
                  invalidateLoadedSession(id);
                }
                for (const [id, pending] of pendingPersist.current) {
                  pendingPersist.current.set(
                    id,
                    releaseOrchestrationWorker(pending, change.leadId),
                  );
                }
                const releaseSummary = (entry: SessionSummary) =>
                  entry.orchestrationLeadId === change.leadId
                    ? { ...entry, orchestrationLeadId: undefined }
                    : entry;
                setHistory((current) => current.map(releaseSummary));
                setStoredLinkedSessions((current) =>
                  current.map(releaseSummary),
                );
                return;
              }

              const { removal } = change;
              lastPersisted.current.delete(sessionId);
              pendingPersist.current.delete(sessionId);
              const closingFiles = filesInWorkspaceTabs(removal.closedTabs);
              setDirtyFiles((current) => {
                const next = new Set(current);
                for (const file of closingFiles) next.delete(file.id);
                return next;
              });
              sessionsRef.current = removal.sessions;
              tabsRef.current = removal.tabs;
              setSessions(removal.sessions);
              setTabs(removal.tabs);
              if (removal.activeTabId !== activeTabIdRef.current) {
                activateTab(removal.activeTabId);
              }
              const activeTab = removal.tabs.find(
                (tab) => tab.id === removal.activeTabId,
              );
              setComposerFocused(
                removal.sessions.some(
                  (session) => session.id === activeTab?.focusedId,
                ),
              );
              if (change.mode === "archive") {
                if (change.session && shouldPersistSession(change.session)) {
                  rememberLoadedSession(
                    loadedSessionCache.current,
                    change.session,
                  );
                }
                const archived =
                  change.savedSummary ??
                  summary ??
                  (change.session && summaryFromSession(change.session));
                if (archived) {
                  setHistory((current) =>
                    mergeHistorySummary(current, {
                      ...archived,
                      archived: true,
                    }),
                  );
                }
              } else {
                setHistory((current) =>
                  current.filter((entry) => entry.id !== sessionId),
                );
                void refreshHistory(sidebarCwd);
              }
            },
          },
          confirm: async (closedTabs, removalMode) => {
            if (origin === "cli") return true;
            const files = filesInWorkspaceTabs(closedTabs);
            const unsaved = files.some(
              (file) =>
                isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
            );
            if (
              unsaved &&
              !(await confirmDiscardUnsaved(
                `${removalMode === "archive" ? "Archive" : "Delete"} this conversation with unsaved files?`,
              ))
            )
              return false;
            const terminals = files.filter((file) => file.terminal);
            return (
              terminals.length === 0 || (await confirmCloseTerminals(terminals))
            );
          },
          stop: stopSessionForRemoval,
        });
        const removed = await remover.remove(sessionId);
        if (removed && deleteWorktreePath && seed) {
          try {
            await onRemoveWorktree(seed.cwd, deleteWorktreePath, false);
          } catch (error) {
            void message(
              `The session was deleted. Its worktree was kept.\n\n${String(error)}\n\nYou can manage it in Settings → Worktrees.`,
              { title: "Irgatos", kind: "warning" },
            );
          }
        }
        return removed;
      } catch (error) {
        if (origin === "cli") throw error;
        const detail = error instanceof Error ? error.message : String(error);
        void message(`Could not ${mode} this conversation.\n\n${detail}`, {
          title: "Irgatos",
          kind: "error",
        });
        return false;
      } finally {
        removingSessionIds.current.delete(sessionId);
      }
    },
    [
      activateTab,
      history,
      invalidateLoadedSession,
      refreshHistory,
      sidebarCwd,
      stopSessionForRemoval,
      tabCloseScope,
      onRemoveWorktree,
    ],
  );

  const onArchiveHistorySession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (archived) return onRemoveHistorySession(sessionId, "archive");
      if (removingSessionIds.current.has(sessionId)) return false;
      try {
        await setSessionArchived(sessionId, false);
        setHistory((current) =>
          current.map((entry) =>
            entry.id === sessionId ? { ...entry, archived: false } : entry,
          ),
        );
        return true;
      } catch (error) {
        void message(
          `Could not unarchive this conversation.\n\n${String(error)}`,
          {
            title: "Irgatos",
            kind: "error",
          },
        );
        return false;
      }
    },
    [onRemoveHistorySession],
  );

  const onArchiveFocusedSession = useCallback(
    (event: KeyboardEvent) => {
      archiveFocusedSession(
        event,
        {
          activeTabId: activeTabIdRef.current,
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          projectTerminalFocused: projectTerminalFocusedRef.current,
          surfaceOpen: Boolean(
            irgatViewIdRef.current ||
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            automationsViewOpenRef.current ||
            kanbanViewOpenRef.current ||
            fleetViewOpenRef.current ||
            mailViewOpenRef.current ||
            ideasViewOpenRef.current ||
            feedViewOpenRef.current ||
            chatViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            whatsNewVersionRef.current,
          ),
        },
        (sessionId) => {
          void onArchiveHistorySession(sessionId, true);
        },
      );
    },
    [onArchiveHistorySession],
  );

  const onPinHistorySession = useCallback(
    async (sessionId: string, pinned: boolean) => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open && shouldPersistSession(open)) {
        await upsertSession(open).catch(() => undefined);
      }
      await setSessionPinned(sessionId, pinned).catch(() => undefined);
      setHistory((current) => {
        const existing = current.find((entry) => entry.id === sessionId);
        if (existing) {
          return mergeProjectHistorySummary(current, { ...existing, pinned });
        }
        if (!open) return current;
        return mergeProjectHistorySummary(current, {
          ...summaryFromSession(open),
          pinned,
        });
      });
    },
    [],
  );

  const onSetHistorySessionLinkedWorkItem = useCallback(
    (sessionId: string, linkedWorkItem: LinkedWorkItem | undefined) => {
      const previousLinkedWorkItem =
        sessionsRef.current.find((session) => session.id === sessionId)
          ?.linkedWorkItem ??
        history.find((session) => session.id === sessionId)?.linkedWorkItem;
      invalidateLoadedSession(sessionId);
      loadedSessionCache.current.delete(sessionId);

      const nextSessions = sessionsRef.current.map((session) =>
        session.id === sessionId ? { ...session, linkedWorkItem } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      setHistory((current) =>
        current.map((session) =>
          session.id === sessionId ? { ...session, linkedWorkItem } : session,
        ),
      );
      setStoredLinkedSessions((current) =>
        linkedWorkItem
          ? current.map((session) =>
              session.id === sessionId
                ? { ...session, linkedWorkItem }
                : session,
            )
          : current.filter((session) => session.id !== sessionId),
      );
      setLinkedWorkItemPanels((current) => {
        if (!current.has(sessionId)) return current;
        const next = new Map(current);
        next.delete(sessionId);
        return next;
      });

      void setSessionLinkedWorkItem(sessionId, linkedWorkItem).catch(
        (error) => {
          const rolledBackSessions = sessionsRef.current.map((session) =>
            session.id === sessionId &&
            session.linkedWorkItem === linkedWorkItem
              ? { ...session, linkedWorkItem: previousLinkedWorkItem }
              : session,
          );
          sessionsRef.current = rolledBackSessions;
          setSessions(rolledBackSessions);
          setHistory((current) =>
            current.map((session) =>
              session.id === sessionId &&
              session.linkedWorkItem === linkedWorkItem
                ? { ...session, linkedWorkItem: previousLinkedWorkItem }
                : session,
            ),
          );
          setStoredLinkedSessions((current) =>
            previousLinkedWorkItem
              ? current.map((session) =>
                  session.id === sessionId
                    ? {
                        ...session,
                        linkedWorkItem: previousLinkedWorkItem,
                      }
                    : session,
                )
              : current.filter((session) => session.id !== sessionId),
          );
          void refreshHistory(sidebarCwd);
          void message(
            `Could not update this conversation's GitHub link.\n\n${String(error)}`,
            { title: "Irgatos", kind: "error" },
          );
        },
      );
    },
    [history, invalidateLoadedSession, refreshHistory, sidebarCwd],
  );

  const onArchiveHistorySessions = useCallback(
    async (sessionIds: readonly string[], archived: boolean) => {
      for (const sessionId of sessionIds) {
        if (!(await onArchiveHistorySession(sessionId, archived))) break;
      }
    },
    [onArchiveHistorySession],
  );

  const onPinHistorySessions = useCallback(
    async (sessionIds: readonly string[], pinned: boolean) => {
      await Promise.all(
        sessionIds.map((sessionId) => onPinHistorySession(sessionId, pinned)),
      );
    },
    [onPinHistorySession],
  );

  const onDeleteWorktreeSessions = useCallback(
    async (sessionIds: readonly string[]): Promise<boolean> => {
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) {
          return false;
        }
      }
      return true;
    },
    [onRemoveHistorySession],
  );

  const onDeleteHistorySession = useCallback(
    (sessionId: string) => onRemoveHistorySession(sessionId, "delete"),
    [onRemoveHistorySession],
  );

  /** Deletes the Irgat's conversation, then the Irgat. Its files stay on disk. */
  const onDeleteIrgat = useCallback(
    async (irgatId: string) => {
      const irgat = findIrgat(irgatId);
      if (!irgat) return;
      const { name } = irgatLook(irgat);
      const confirmed = await ask(
        `Delete ${name}? Its conversation will be deleted and its habits stop. This can’t be undone.`,
        { title: "Irgatos", kind: "warning" },
      );
      if (!confirmed) return;
      for (const irgatSessionId of allIrgatSessionIds(irgat)) {
        if (irgatViewIdRef.current === irgatSessionId) closeIrgatView();
        const removed = await onRemoveHistorySession(
          irgatSessionId,
          "delete",
          true,
        );
        if (!removed) return;
      }
      removeIrgat(irgatId);
      if (lastIrgatIdRef.current === irgatId) lastIrgatIdRef.current = undefined;
    },
    [closeIrgatView, history, onRemoveHistorySession],
  );

  const onDeleteHistorySessions = useCallback(
    async (sessionIds: readonly string[]) => {
      if (sessionIds.length === 0) return;
      if (
        !window.confirm(
          `Delete ${sessionIds.length} selected conversations? This can’t be undone.`,
        )
      )
        return;
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) break;
      }
    },
    [onRemoveHistorySession],
  );

  const sessionIdsInTitleTab = useCallback((tabId: string): string[] => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    if (!tab) return [];
    const openSessionIds = new Set(
      sessionsRef.current.map((session) => session.id),
    );
    return leafIds(tab.layout).filter((id) => openSessionIds.has(id));
  }, []);

  const onArchiveTitleTab = useCallback(
    (tabId: string) => {
      const sessionIds = sessionIdsInTitleTab(tabId);
      void onArchiveHistorySessions(sessionIds, true);
    },
    [onArchiveHistorySessions, sessionIdsInTitleTab],
  );

  const onDeleteTitleTab = useCallback(
    (tabId: string) => {
      const sessionIds = sessionIdsInTitleTab(tabId);
      if (sessionIds.length === 1) {
        void onDeleteHistorySession(sessionIds[0]);
      } else if (sessionIds.length > 1) {
        void onDeleteHistorySessions(sessionIds);
      }
    },
    [onDeleteHistorySession, onDeleteHistorySessions, sessionIdsInTitleTab],
  );

  const onFocusDir = useCallback(
    (dir: FocusDir) => {
      if (!activeTab) return;
      const next = neighborLeafId(activeTab.layout, activeTab.focusedId, dir);
      if (next) onFocusPane(next);
    },
    [activeTab, onFocusPane],
  );

  const onRatio = useCallback(
    (tabId: string, splitId: string, index: number, ratio: number) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, layout: setSplitRatio(t.layout, splitId, index, ratio) }
            : t,
        ),
      );
    },
    [],
  );

  const onCwdChange = useCallback(
    (sessionId: string, cwd: string) => {
      const normalized = normalizeProjectPath(cwd);
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      const previous = current?.cwd;
      // Threads stay bound to their project. Switching from the composer opens a
      // new tab instead of retargeting the conversation.
      if (
        current &&
        previous &&
        looksLikeProject(previous) &&
        !sameProjectPath(previous, normalized) &&
        !isBlankSession(current)
      ) {
        setProjectCwd(normalized);
        setRecents(rememberProject(normalized));
        const session = newSession(
          current.harness,
          normalized,
          current.model,
          current.runtimeMode,
          current.modelSettings,
        );
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, normalized);
        setActiveTabId(tab.id);
        setComposerFocused(true);
        return;
      }
      if (previous && !sameProjectPath(previous, normalized)) {
        // Clear bindings left by older versions before reusing a local shell.
        if (remoteSessionFor(sessionId)) rememberRemoteSession(sessionId);
        if (remotePendingWorktree(sessionId))
          rememberRemotePendingWorktree(sessionId);
      }
      if (
        previous &&
        !sameProjectPath(previous, normalized) &&
        previous !== "~"
      ) {
        void keepSessionChanges(sessionId, previous).catch(() => undefined);
      }
      setProjectCwd(normalized);
      setRecents(rememberProject(normalized));
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          // A blank session moving into a project adopts its provider defaults;
          // a conversation keeps its own provider.
          const base = isBlankSession(s)
            ? retargetSessionToProject(s, normalized)
            : s;
          return {
            ...base,
            cwd: normalized,
            branch: undefined,
            worktreeCwd: undefined,
            worktreeRemoved: undefined,
            workspaceMode: undefined,
            worktreeBase: undefined,
          };
        }),
      );
      // The session's project just moved in place; a group only holds tabs that
      // share one project, so drop this tab out if it no longer matches.
      setTabs((prev) => {
        const tab = prev.find((t) => leafIds(t.layout).includes(sessionId));
        // The tab's visible project follows its focused pane; a background
        // pane changing project doesn't change what the group check should see.
        if (!tab?.groupId || tab.focusedId !== sessionId) return prev;
        const newProject = projectName(normalized);
        const othersProject = tabGroupProject(
          prev.filter((t) => t.id !== tab.id),
          tab.groupId,
          projectOfTab,
        );
        if (othersProject && newProject && othersProject !== newProject) {
          return removeTabFromGroup(prev, tab.id);
        }
        return prev;
      });
      notifyReviewChanged(sessionId);
    },
    [appendTab, projectOfTab],
  );

  const onBranchChange = useCallback(
    (sessionId: string) => {
      notifyGitChanged();
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      void forgetHarnessSession(current.harness, sessionId);
      const next = {
        ...current,
        branch: undefined,
        providerSessionId: undefined,
        context: undefined,
      };
      sessionsRef.current = sessionsRef.current.map((s) =>
        s.id === sessionId ? next : s,
      );
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? next : s)));
      persistSession(next);
      notifyReviewChanged(sessionId);
    },
    [persistSession],
  );

  const onWorkspaceModeChange = useCallback(
    (sessionId: string, mode: WorkspaceMode, base?: string) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (
            session.id !== sessionId ||
            (!isBlankSession(session) &&
              !(session.workspaceMode && !session.worktreeCwd && !session.busy))
          ) {
            return session;
          }
          return mode === "worktree"
            ? base || session.worktreeBase
              ? {
                  ...session,
                  workspaceMode: "worktree",
                  worktreeBase: base || session.worktreeBase,
                }
              : session
            : {
                ...session,
                workspaceMode: undefined,
                worktreeBase: undefined,
              };
        }),
      );
    },
    [],
  );

  const onWorktreeBaseChange = useCallback((sessionId: string, base: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId &&
        (isBlankSession(session) ||
          (!!session.workspaceMode && !session.worktreeCwd && !session.busy)) &&
        session.workspaceMode === "worktree"
          ? { ...session, worktreeBase: base }
          : session,
      ),
    );
  }, []);

  const onWorktreeChange = useCallback(
    async (
      sessionId: string,
      tree: Worktree,
      fromComposer = false,
      isCurrent: () => boolean = () => true,
    ) => {
      if (!isCurrent()) return;
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (
        !current ||
        current.busy ||
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId)
      ) {
        throw new Error(
          "Wait for this session to finish before changing working copies.",
        );
      }
      if (
        !current.worktreeRemoved &&
        pathKey(sessionWorkCwd(current)) === pathKey(tree.path)
      )
        return;
      if (
        [...removingWorktreePaths.current].some((path) =>
          isEqualOrInside(tree.path, path),
        )
      ) {
        throw new Error(
          "This worktree is being deleted. Select another working copy.",
        );
      }
      if (!current.worktreeRemoved && current.queuedMessages?.length) {
        throw new Error("Clear queued messages before changing working copies.");
      }
      const run = orchestrator.forSession(sessionId);
      if (run && ["active", "paused"].includes(run.status)) {
        throw new Error(
          "Stop this orchestration run before changing working copies.",
        );
      }
      switchingWorktrees.current.set(sessionId, tree.path);
      pendingPersist.current.delete(sessionId);
      try {
        const listed = await listWorktrees(current.cwd);
        if (!isCurrent()) return;
        const target = listed.worktrees.find(
          (entry) => pathKey(entry.path) === pathKey(tree.path) && !entry.missing,
        );
        if (!target) {
          throw new Error(
            "This worktree is no longer available. Refresh the picker.",
          );
        }
        const source = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !source ||
          source.busy ||
          source.cwd !== current.cwd ||
          sessionWorkCwd(source) !== sessionWorkCwd(current)
        ) {
          throw new Error(
            "The session changed. Try selecting the working copy again.",
          );
        }
        const selected = sessionInWorktree(source, target);
        if (selected.id !== sessionId) {
          // Leave the original conversation, checkpoints, and live provider
          // context attached to the files they describe.
          const tab = newTab(selected.id);
          if (fromComposer)
            workspacePins.current.set(selected.id, currentWorkspace(source.cwd));
          sessionsRef.current = [...sessionsRef.current, selected];
          setSessions(sessionsRef.current);
          appendTab(tab, selected.cwd);
          setActiveTabId(tab.id);
          setComposerFocused(true);
          return;
        }
        await flushSessionCheckpoint(sessionId);
        if (!isCurrent()) return;
        for (const harness of sessionChildHarnesses(source)) {
          await forgetHarnessSession(harness, sessionId);
          if (!isCurrent()) return;
        }
        const latest = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !latest ||
          (!latest.worktreeRemoved && !isBlankSession(latest)) ||
          latest.cwd !== current.cwd ||
          sessionWorkCwd(latest) !== sessionWorkCwd(current)
        ) {
          throw new Error(
            "The session changed. Try selecting the working copy again.",
          );
        }
        const next = sessionInWorktree(latest, target);
        if (fromComposer)
          workspacePins.current.set(sessionId, currentWorkspace(latest.cwd));
        else workspacePins.current.delete(sessionId);
        if (latest.worktreeRemoved)
          await keepSessionChanges(sessionId, target.path);
        pendingPersist.current.delete(sessionId);
        if (shouldPersistSession(next)) await upsertSession(next);
        if (!isCurrent()) return;
        invalidateLoadedSession(sessionId);
        sessionsRef.current = sessionsRef.current.map((s) =>
          s.id === sessionId ? next : s,
        );
        setSessions(sessionsRef.current);
        notifyGitChanged();
        notifyReviewChanged(sessionId);
        void refreshHistory(next.cwd);
      } finally {
        switchingWorktrees.current.delete(sessionId);
      }
    },
    [appendTab, invalidateLoadedSession, refreshHistory],
  );

  const onComposerWorktreeChange = useCallback(
    (sessionId: string, tree: Worktree) =>
      onWorktreeChange(sessionId, tree, true),
    [onWorktreeChange],
  );

  const onSelectWorkspace = useCallback(
    (focus?: WorktreeFocus) => {
      closeIrgatView();
      setProjectCwd(sidebarCwdRef.current);
      workspaceNavigation.selectWorkspace(sidebarCwdRef.current, focus);
    },
    [workspaceNavigation.selectWorkspace, closeIrgatView],
  );

  /**
   * Open a run of folders from one snapshot, committed in a single transition.
   *
   * Planning per folder from refs would read state React has not rendered yet,
   * so the whole run is planned first and applied here in selection order.
   */
  const openProjects = useCallback(
    (paths: readonly string[]) => {
      const steps = planProjectOpenRun({
        memory: readProjectReturnMemory(),
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        activeTabId: activeTabIdRef.current,
        paths,
      });
      const last = steps[steps.length - 1];
      if (!last) return;

      // After the early return, not before it. `pickFolders` hands back an
      // empty list when the picker is dismissed, and every path failing
      // `looksLikeProject` comes out the same way — so closing these first
      // meant cancelling a folder picker shut whatever the user had open.
      // Nothing below opens a project without also leaving one of these views.
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);

      // At most one folder can take the blank session, and it keeps the
      // retargeting rules `onCwdChange` already owns.
      const blank = steps.find(
        (step): step is Extract<ProjectOpenStep, { action: "reuse-blank" }> =>
          step.action === "reuse-blank",
      );
      if (blank) onCwdChange(blank.sessionId, blank.path);

      const created = steps.filter(
        (step): step is Extract<ProjectOpenStep, { action: "create" }> =>
          step.action === "create",
      );
      if (created.length > 0) {
        setSessions((prev) => [...prev, ...created.map((step) => step.session)]);
        // Each tab sits beside the one before it in the run, so the folders keep
        // their selection order.
        setTabs((prev) =>
          created.reduce(
            (tabs, step) =>
              insertBeside(tabs, step.tab, step.besideTabId, step.path),
            prev,
          ),
        );
      }

      // The folder chosen last ends up focused.
      switch (last.action) {
        case "create":
          setProjectCwd(last.path);
          setActiveTabId(last.tab.id);
          setComposerFocused(true);
          break;
        case "activate":
          setProjectCwd(last.path);
          activateTab(last.tabId, last.paneId);
          break;
        case "keep":
          setProjectCwd(last.path);
          break;
        case "reuse-blank":
          // `onCwdChange` already moved to it.
          break;
      }
      // Every project opened is remembered, the one chosen last most recently.
      for (const step of steps) setRecents(rememberProject(step.path));
    },
    [activateTab, insertBeside, onCwdChange, readProjectReturnMemory],
  );

  const onSelectProject = useCallback(
    (path: string) => {
      closeIrgatView();
      workspaceNavigation.cancel();
      openProjects([path]);
      workspaceNavigation.selectProject(path);
    },
    [
      openProjects,
      closeIrgatView,
      workspaceNavigation.cancel,
      workspaceNavigation.selectProject,
    ],
  );

  const onShowTerminal = useCallback(
    (fileId: string) => {
      const dock = projectTerminalsRef.current.find((entry) =>
        entry.pane.files.some((file) => file.id === fileId),
      );
      const onScreen =
        !!dock && sameProjectPath(dock.projectPath, viewDockRef.current.path);
      if (onScreen) {
        // Already the dock on screen, the Irgat's or chat's included.
      } else if (dock && isFreeChatCwd(dock.projectPath)) {
        closeIrgatView();
        setChatViewOpen(true);
      } else if (dock && !looksLikeProject(dock.projectPath)) {
        // A Irgat's dock in home is no project to switch to; the terminal
        // shows once that Irgat is back on screen.
      } else if (dock && dock.projectPath !== projectCwdRef.current) {
        onSelectProject(dock.projectPath);
      } else {
        closeIrgatView();
      }
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setSettingsOpen(false);
      revealTerminal(fileId, false);
    },
    [onSelectProject, closeIrgatView, revealTerminal],
  );

  const pickProject = useCallback(async () => {
    // Several folders can be taken at once; each opens as its own project, and
    // the last one selected ends up focused.
    openProjects(await pickFolders());
  }, [openProjects]);

  const onPlaceSessionInFolder = useCallback(
    (sessionId: string, target: SessionFolderTarget) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!source || !looksLikeProject(source.cwd)) return;
      const folders = loadSessionFolders(source.cwd);
      if (
        target.kind === "existing" &&
        !folders.some((folder) => folder.id === target.folderId)
      ) {
        return;
      }
      saveSessionFolders(
        source.cwd,
        placeSessionInFolder(
          folders,
          isRemoteProjectPath(source.cwd)
            ? (remoteSessionFor(sessionId) ?? sessionId)
            : sessionId,
          target,
        ),
      );
    },
    [],
  );

  const onRemoveProject = useCallback(
    (path: string, options: { purgeData: boolean }) => {
      const normalized = normalizeProjectPath(path);
      const wasCurrent = sameProjectPath(projectCwdRef.current, normalized);
      const remaining = options.purgeData
        ? forgetProject(normalized)
        : archiveProject(normalized);
      if (options.purgeData) {
        forgetProjectLocation(normalized);
        setSidebarTabSelection((current) =>
          sameProjectPath(current.project, normalized)
            ? { project: "~", tab: loadProjectSidebarTab("~") }
            : current,
        );
      }
      setRecents(remaining);

      const tabs = tabsRef.current;
      const sessions = sessionsRef.current;
      const projectTabs = filterTabsForProject(tabs, sessions, normalized);
      const projectTabIds = new Set(projectTabs.map((tab) => tab.id));
      const projectSessions = sessions.filter((session) =>
        sameProjectPath(session.cwd, normalized),
      );
      const projectSessionIds = new Set(
        projectSessions.map((session) => session.id),
      );

      if (options.purgeData) {
        const cachedOrLoading = new Set([
          ...loadedSessionCache.current.keys(),
          ...sessionLoads.current.keys(),
        ]);
        for (const sessionId of cachedOrLoading) {
          invalidateLoadedSession(sessionId);
        }
        for (const session of projectSessions) {
          pendingPersist.current.delete(session.id);
          if (session.busy) {
            turnGen.current.set(
              session.id,
              (turnGen.current.get(session.id) ?? 0) + 1,
            );
            for (const id of sessionChildHarnesses(session)) {
              void cancelHarnessTurn(id, session.id);
            }
          }
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
          lastPersisted.current.delete(session.id);
        }
        void removeProjectData(normalized);
      } else {
        for (const session of projectSessions) {
          if (session.busy) continue;
          if (shouldPersistSession(session)) {
            rememberLoadedSession(loadedSessionCache.current, session);
          }
          persistSession(session);
          pendingPersist.current.delete(session.id);
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
        }
      }

      let nextTabs = tabs.filter((tab) => !projectTabIds.has(tab.id));
      let nextSessions = sessions.filter((session) => {
        if (!projectSessionIds.has(session.id)) return true;
        return !options.purgeData && session.busy;
      });
      let nextActiveTabId = activeTabIdRef.current;

      if (nextTabs.length === 0) {
        const fallback = nextSessions[0];
        const session = newDefaultSession("~", fallback?.runtimeMode);
        const tab = newTab(session.id);
        nextSessions = [...nextSessions, session];
        nextTabs = [tab];
        nextActiveTabId = tab.id;
      } else if (projectTabIds.has(nextActiveTabId)) {
        nextActiveTabId = nextTabs[0]?.id ?? nextActiveTabId;
      }

      sessionsRef.current = nextSessions;
      tabsRef.current = nextTabs;
      activeTabIdRef.current = nextActiveTabId;
      setSessions(nextSessions);
      setTabs(nextTabs);
      if (nextActiveTabId !== activeTabId) {
        setActiveTabId(nextActiveTabId);
      }
      setDirtyFiles((prev) => {
        const updated = new Set(prev);
        for (const tab of projectTabs) {
          for (const file of [
            ...tab.editorPanes.flatMap((pane) => pane.files),
            ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
          ]) {
            updated.delete(file.id);
          }
        }
        return updated;
      });
      setProjectTerminals((prev) =>
        prev.filter((dock) => !sameProjectPath(dock.projectPath, normalized)),
      );

      if (wasCurrent) {
        const next = remaining.find((item) => looksLikeProject(item.path));
        if (next) {
          onSelectProject(next.path);
          setProjectCwd(next.path);
        } else {
          setProjectCwd("~");
          setComposerFocused(true);
        }
      }
    },
    [activeTabId, invalidateLoadedSession, onSelectProject, persistSession],
  );

  const onRestoreProject = useCallback(
    (path: string) => {
      setRecents(rememberProject(path));
      onSelectProject(path);
    },
    [onSelectProject],
  );

  const onFileMoved = useCallback((from: string, to: string) => {
    invalidateProjectFiles();
    setTabs((prev) =>
      prev.map((tab) => {
        return {
          ...tab,
          editorPanes: tab.editorPanes.map((pane) => ({
            ...pane,
            files: pane.files.map((file) =>
              isFilesystemTab(file)
                ? { ...file, path: rebasePath(file.path, from, to) }
                : file,
            ),
          })),
        };
      }),
    );
  }, []);

  const applyProjectLocationChange = useCallback(
    async (from: string, to: string) => {
      await rebaseProjectSessions(from, to);
      rebaseCiRepairs(from, to);

      const nextSessions = sessionsRef.current.map((session) =>
        sameProjectPath(session.cwd, from) ? { ...session, cwd: to } : session,
      );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);
      for (const [id, session] of loadedSessionCache.current) {
        if (sameProjectPath(session.cwd, from)) {
          loadedSessionCache.current.set(id, { ...session, cwd: to });
        }
      }
      for (const [id, session] of pendingPersist.current) {
        if (sameProjectPath(session.cwd, from)) {
          pendingPersist.current.set(id, { ...session, cwd: to });
        }
      }
      setHistory((current) =>
        current.map((session) =>
          sameProjectPath(session.cwd, from) ? { ...session, cwd: to } : session,
        ),
      );
      setStoredLinkedSessions((current) =>
        current.map((session) =>
          sameProjectPath(session.cwd, from) ? { ...session, cwd: to } : session,
        ),
      );
      setLoadedProjects((current) => {
        const next = new Set(current);
        next.delete(normalizeProjectPath(from));
        next.add(normalizeProjectPath(to));
        return next;
      });

      if (sameProjectPath(projectCwdRef.current, from)) {
        projectCwdRef.current = to;
        setProjectCwd(to);
      }
      const nextDocks = projectTerminalsRef.current.map((dock) =>
        sameProjectPath(dock.projectPath, from)
          ? { ...dock, projectPath: to }
          : dock,
      );
      projectTerminalsRef.current = nextDocks;
      setProjectTerminals(nextDocks);
      rebaseProjectData(from, to);
      setSidebarTabSelection((current) =>
        sameProjectPath(current.project, from)
          ? { ...current, project: pathKey(to) }
          : current,
      );
      setRecents(replaceProjectPath(from, to));
      onFileMoved(from, to);
      notifyDirsChanged();
    },
    [onFileMoved],
  );

  const onFileDeleted = useCallback((path: string) => {
    invalidateProjectFiles();
    const dropped = new Set<string>();
    for (const tab of tabsRef.current) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (isFilesystemTab(file) && isEqualOrInside(file.path, path)) {
            dropped.add(file.id);
          }
        }
      }
    }
    setTabs((prev) =>
      prev.map((tab) =>
        dropOpenFiles(tab, (filePath) => isEqualOrInside(filePath, path)),
      ),
    );
    if (dropped.size === 0) return;
    setDirtyFiles((prev) => {
      const next = new Set(prev);
      for (const id of dropped) next.delete(id);
      return next;
    });
  }, []);

  const onOpenFile = useCallback<OpenFileFn>(
    (path, navigation, options) => {
      closeIrgatView();
      void (async () => {
        const fileCwd = gitCwdRef.current;
        const fileProjectCwd = sidebarCwdRef.current;
        const resolved = await resolveFileOpenRequest(fileCwd, path, options);
        rememberOpenedFile(fileCwd, resolved);
        const tab = tabsRef.current.find(
          (entry) => entry.id === activeTabIdRef.current,
        );
        if (!tab) return;
        const file = newFileTab(
          resolved,
          fileCwd,
          false,
          undefined,
          fileProjectCwd,
        );
        const pin = !!options?.pin;
        if (loadFileTabMode() === "workspace") {
          // Built once: the updater may run twice in StrictMode.
          const created = newEditorWorkspaceTab(
            pin ? file : { ...file, preview: true },
          );
          let target: { tabId: string; paneId?: string } | undefined;
          // Select inside the updater, not from `tabsRef`: two opens resuming
          // before a render would otherwise both miss the preview and append
          // twice. flushSync runs the updater now so `target` is set below.
          flushSync(() => {
            setTabs((prev) => {
              const result = openWorkspaceFile(
                prev,
                file,
                created,
                (tabs, tab) => insertBesideActive(tabs, tab, fileProjectCwd),
                pin,
              );
              target = result;
              return result.tabs;
            });
          });
          if (target?.paneId) activateTab(target.tabId, target.paneId);
          else if (target) setActiveTabId(target.tabId);
          setProjectTerminalFocused(false);
          setComposerFocused(false);
          if (navigation) {
            editorNavigationToken.current += 1;
            setEditorNavigation({
              path: resolved,
              ...navigation,
              token: editorNavigationToken.current,
            });
          }
          return;
        }
        setTabs((prev) =>
          prev.map((entry) => {
            if (entry.id !== tab.id) return entry;
            const focusedSession = sessionsRef.current.find(
              (session) => session.id === entry.focusedId,
            );
            return openEditorTab(entry, file, {
              split: focusedSession?.blocks.length === 0 ? "left" : "right",
              pin,
            });
          }),
        );
        if (navigation) {
          editorNavigationToken.current += 1;
          setEditorNavigation({
            path: resolved,
            ...navigation,
            token: editorNavigationToken.current,
          });
        }
        setComposerFocused(false);
      })();
    },
    [activateTab, insertBesideActive, closeIrgatView],
  );

  const onOpenPlan = useCallback(
    (sessionId: string, blockId: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === activeTabId);
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (!tab || !session || !block) return;
      const file = {
        ...newPlanTab(
          session.id,
          block.id,
          planTitle(block.text),
          sessionWorkCwd(session),
        ),
        ...(session.worktreeCwd ? { projectCwd: session.cwd } : {}),
      };
      setTabs((prev) =>
        prev.map((entry) =>
          entry.id === tab.id ? openEditorTab(entry, file) : entry,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  // The Irgat in front and the sessions whose artifacts belong to it.
  const artifactIrgatRef = useRef<{
    scope: string;
    sessionIds: Set<string>;
  } | null>(null);
  const openArtifact = useCallback(
    (artifact: WorkspaceArtifact, pin = false) => {
      // A block opened from the transcript is already listed under its turn's time.
      if (!getRegisteredArtifact(artifact.id)) registerArtifacts([artifact]);
      const irgat = irgatViewIdRef.current ? artifactIrgatRef.current : null;
      if (
        irgat &&
        (artifact.scope === irgat.scope ||
          (!!artifact.sessionId && irgat.sessionIds.has(artifact.sessionId)))
      ) {
        setIrgatActivity(null);
        setIrgatShownSession(null);
        setIrgatOverviewDocument(null);
        setIrgatOverviewArtifact(artifact.id);
        setIrgatOverviewTab("artifacts");
        setIrgatOverviewOpen(true);
        return;
      }
      closeIrgatView();
      const projectCwd = sidebarCwdRef.current;
      const cwd = artifact.cwd ?? projectCwd;
      const file = {
        ...newArtifactTab(
          {
            id: artifact.id,
            title: artifact.title,
            fileName: artifactFileName(artifact),
          },
          cwd,
        ),
        ...(projectCwd && projectCwd !== cwd ? { projectCwd } : {}),
      };
      setSidebarTab("artifacts", projectCwd);
      setProjectTerminalFocused(false);
      setComposerFocused(false);
      if (loadFileTabMode() === "workspace") {
        const created = newEditorWorkspaceTab(
          pin ? file : { ...file, preview: true },
        );
        let target: { tabId: string; paneId?: string } | undefined;
        flushSync(() => {
          setTabs((prev) => {
            const result = openWorkspaceFile(
              prev,
              file,
              created,
              (tabs, tab) => insertBesideActive(tabs, tab, projectCwd),
              pin,
            );
            target = result;
            return result.tabs;
          });
        });
        if (target?.paneId) activateTab(target.tabId, target.paneId);
        else if (target) setActiveTabId(target.tabId);
        return;
      }
      const tab = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      if (!tab) {
        appendTab(newEditorWorkspaceTab(file), projectCwd);
        return;
      }
      setTabs((prev) =>
        prev.map((entry) =>
          entry.id === tab.id
            ? openEditorTab(entry, file, { split: "right", pin })
            : entry,
        ),
      );
    },
    [activateTab, appendTab, closeIrgatView, insertBesideActive, setSidebarTab],
  );
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenArtifactRequest>).detail;
      if (detail?.artifact) openArtifact(detail.artifact, !!detail.pin);
    };
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen);
  }, [openArtifact]);

  const onPinFile = useCallback((fileId: string) => {
    setTabs((prev) => {
      const next = prev.map((tab) => pinEditorFile(tab, fileId));
      return next.some((tab, index) => tab !== prev[index]) ? next : prev;
    });
  }, []);

  const onFileDirtyChange = useCallback(
    (fileId: string, dirty: boolean) => {
      // An edited preview must not be replaced by the next click.
      if (dirty) onPinFile(fileId);
      setDirtyFiles((prev) => {
        if (prev.has(fileId) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(fileId);
        else next.delete(fileId);
        return next;
      });
    },
    [onPinFile],
  );

  /** The editor reports 0 as it unmounts, so closed tabs drop out on their own. */
  const onFileErrorCountChange = useCallback((fileId: string, count: number) => {
    setFileErrorCounts((prev) => {
      if ((prev.get(fileId) ?? 0) === count) return prev;
      const next = new Map(prev);
      if (count > 0) next.set(fileId, count);
      else next.delete(fileId);
      return next;
    });
  }, []);

  const onSelectFileSurface = useCallback((paneId: string, fileId: string) => {
    closeIrgatView();
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          { ...tab, focusedId: paneId },
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId ? { ...pane, activeFileId: fileId } : pane,
          ),
        );
      }),
    );
    setComposerFocused(false);
  }, []);

  const onModelChange = useCallback(
    (sessionId: string, harness: HarnessId, model: string) => {
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) return;
      const resolved = resolveModel(harness, model);
      saveRecentModelChoice(resolved.harness, resolved.id);
      if (current.modelSettings) {
        saveLastModelSettings(current.modelSettings, "fill");
      }
      const modelSettings = preferredModelSettings(
        resolved,
        current.modelSettings,
      );
      const plan = planComposerSwitch(current, harness);
      const recoverLimit =
        !current.busy &&
        !!current.usageLimit &&
        (current.harness !== harness || current.model !== resolved.id);
      if (plan.kind === "empty") {
        void forgetHarnessSession(plan.forget, sessionId);
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          let next = withHarnessChoice(s, harness, resolved.id, modelSettings);
          if (plan.kind === "arm") {
            next = { ...next, pendingSwitch: plan.pending };
          } else if (plan.kind === "revert") {
            next = {
              ...next,
              pendingSwitch: undefined,
              ...(plan.restoreProviderSessionId
                ? { providerSessionId: plan.restoreProviderSessionId }
                : { providerSessionId: undefined }),
              ...(plan.restoreProviderAccountId
                ? { providerAccountId: plan.restoreProviderAccountId }
                : { providerAccountId: undefined }),
            };
          } else if (plan.kind === "empty") {
            next = { ...next, pendingSwitch: undefined };
          }
          return recoverLimit
            ? isIrgatSession(sessionId)
              ? resumeIrgatUsageLimit(next)
              : resumeUsageLimitedSession(next)
            : next;
        }),
      );
    },
    [],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      saveLastModelSettings(modelSettings);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, modelSettings } : s)),
      );
    },
    [],
  );

  const onRuntimeModeChange = useCallback(
    (sessionId: string, runtimeMode: RuntimeMode) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, runtimeMode } : s)),
      );
    },
    [],
  );

  const onSaveDraft = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      appRequestId?: string,
    ) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (current && remoteProjectFor(current.cwd))
        return !!remoteSessionActions(sessionId)?.saveDraft(text, attachments);
      if (
        !current ||
        current.busy ||
        sessionDraftBlock(current) ||
        current.inboxAsk ||
        current.worktreeRemoved ||
        (!text.trim() && attachments.length === 0)
      ) {
        return false;
      }
      const placeholderTitle = canReplaceSessionTitle(
        current.title,
        current.harness,
        HARNESS_LABEL[current.harness],
      );
      const title = placeholderTitle
        ? titleFromPrompt(text, current.harness, attachments)
        : current.title;
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && !sessionDraftBlock(session)
            ? {
                ...session,
                title,
                blocks: [
                  ...session.blocks,
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    text,
                    ...(attachments.length > 0 ? { attachments } : {}),
                    draft: true,
                    ...(appRequestId ? { appRequestId } : {}),
                  },
                ],
              }
            : session,
        ),
      );
      return true;
    },
    [],
  );

  const onRemoveDraft = useCallback(
    (sessionId: string, draftBlockId: string) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!current) return false;
      const withoutDraft = removeSessionDraft(current, draftBlockId);
      if (!withoutDraft) return false;

      if (!shouldPersistSession(withoutDraft)) {
        pendingPersist.current.delete(sessionId);
        lastPersisted.current.delete(sessionId);
        lastPersistedUserBlock.current.delete(sessionId);
        invalidateLoadedSession(sessionId);
        setHistory((history) =>
          history.filter((session) => session.id !== sessionId),
        );
        setStoredLinkedSessions((history) =>
          history.filter((session) => session.id !== sessionId),
        );
        void discardDraftSessionRecord(sessionId).catch(() => undefined);
      }

      setSessions((sessions) =>
        sessions.map((session) =>
          session.id === sessionId
            ? (removeSessionDraft(session, draftBlockId) ?? session)
            : session,
        ),
      );
      return true;
    },
    [invalidateLoadedSession],
  );

  const submitSession = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      options?: SubmitOptions,
    ): SubmissionAcceptance => {
      const remote = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (remote && remoteProjectFor(remote.cwd))
        return !!remoteSessionActions(sessionId)?.submit(
          text,
          attachments,
          options,
        );
      if (editedResends.isActive(sessionId)) return false;
      // Output already received belongs before the submitted user message.
      // Flush before reading the session too, since pending errors can settle it.
      flushHarnessEvents();
      const adhdCommand =
        !options?.managed &&
        !options?.internal &&
        !options?.irgatSessionCompletion &&
        !options?.queuedMessageId &&
        !options?.resendEdited &&
        (options?.intent ?? "default") === "default" &&
        attachments.length === 0
          ? parseAdhdCommand(text)
          : null;
      const adhdReply = adhdCommand
        ? applyAdhdCommand(sessionId, adhdCommand)
        : null;
      if (adhdReply) {
        enqueueHarnessEvent(sessionId, { type: "status", text: adhdReply });
        flushHarnessEvents();
        return true;
      }
      const controlError = orchestrator.submissionError(
        sessionId,
        options?.managed,
      );
      if (controlError) {
        enqueueHarnessEvent(sessionId, { type: "status", text: controlError });
        flushHarnessEvents();
        return false;
      }
      if (options?.managed) {
        const target = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !target ||
          target.busy ||
          target.pendingSwitch ||
          isPreparingHandoff(target) ||
          removingSessionIds.current.has(sessionId)
        ) {
          options.onSettled?.({
            status: "failed",
            text: "",
            error: "Session is unavailable or already running",
          });
          return false;
        }
      }
      if (
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId) ||
        workspaceNavigation.isSwitching(sessionId)
      )
        return false;
      const storedCurrent = sessionsRef.current.find((s) => s.id === sessionId);
      if (options?.appRequestId && storedCurrent?.busy) return false;
      if (
        options?.ciRepair &&
        storedCurrent &&
        (storedCurrent.busy ||
          storedCurrent.pendingSwitch ||
          isPreparingHandoff(storedCurrent))
      )
        return false;
      if (
        !storedCurrent ||
        storedCurrent.worktreeRemoved ||
        [...removingWorktreePaths.current].some((path) =>
          isEqualOrInside(sessionWorkCwd(storedCurrent), path),
        )
      )
        return false;
      const draftBlock = options?.draftBlockId
        ? storedCurrent.blocks.find(
            (block) =>
              block.id === options.draftBlockId &&
              block.role === "user" &&
              block.draft,
          )
        : undefined;
      if (options?.draftBlockId && !draftBlock) return false;
      const draftCleared = draftBlock
        ? {
            ...storedCurrent,
            blocks: storedCurrent.blocks.filter(
              (block) => block.id !== draftBlock.id,
            ),
          }
        : storedCurrent;
      let current = options?.buildTarget
        ? withPlanBuildTarget(draftCleared, options.buildTarget)
        : draftCleared;
      const editedResend = options?.resendEdited
        ? createEditedResendAttempt(current, options.onResendRejected)
        : undefined;
      if (options?.resendEdited && !editedResend) return false;
      const editedProviderTurnId = editedResend?.providerTurnId;
      if (editedResend) {
        current = { ...current, blocks: editedResend.blocks };
      }
      const intent = options?.intent ?? "default";
      if (intent === "orchestrate") {
        try {
          const run = orchestrator.forSession(sessionId);
          if (run && ["active", "paused"].includes(run.status))
            throw new Error(
              "Stop the current orchestration run before preparing another proposal.",
            );
        } catch (error) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: error instanceof Error ? error.message : String(error),
          });
          flushHarnessEvents();
          return false;
        }
      }
      const approvedPlan = options?.planBlockId
        ? current.blocks.find(
            (block) => block.id === options.planBlockId && block.role === "plan",
          )
        : undefined;
      if (intent === "build" && !approvedPlan?.text.trim()) return false;
      if (options?.queuedMessageId) {
        const mode = options.followUpBehavior === "steer" ? "steer" : "dispatch";
        if (!queuedMessageForSubmit(current, options.queuedMessageId, mode)) {
          return false;
        }
      }
      const noteCard =
        options && "noteCard" in options ? options.noteCard : current.noteCard;
      const handoffCard =
        options && "handoffCard" in options
          ? options.handoffCard
          : current.handoffCard;
      if (!text.trim() && attachments.length === 0 && !noteCard && !handoffCard) {
        return false;
      }
      if (isPreparingHandoff(current)) return false;
      saveRecentModelChoice(current.harness, current.model);
      const initialWorkCwd = sessionWorkCwd(current);
      const createDraftWorktree =
        !current.worktreeCwd && current.workspaceMode === "worktree";
      const accountProvider = supportsProviderAccounts(current.harness)
        ? current.harness
        : undefined;
      const providerAccountId = accountProvider
        ? (current.providerAccountId ??
          selectedProviderAccountId(accountProvider, current.cwd))
        : undefined;
      const turnStartedAt = Date.now();
      if (
        accountProvider &&
        providerAccountId &&
        !providerAccountExists(accountProvider, providerAccountId)
      ) {
        enqueueHarnessEvent(sessionId, {
          type: "session.error",
          message:
            "This conversation uses a removed provider account. Switch accounts from the usage control to start a new conversation.",
        });
        flushHarnessEvents();
        return false;
      }
      const submittedText = intent === "build" ? "Build approved plan" : text;
      const operatorCommand = consumeOperatorCommand(submittedText);
      if (
        operatorCommand.matched &&
        (intent !== "default" ||
          current.orchestrationLeadId ||
          current.inboxAsk ||
          orchestrator.run(sessionId))
      ) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Use /operator from a regular session turn, outside an orchestration run.",
        });
        flushHarnessEvents();
        return false;
      }
      // The Irgat has app access in every turn, without the command.
      const irgat = isIrgatSession(sessionId);
      const queuedIrgatMessage =
        irgat && options?.queuedMessageId
          ? current.queuedMessages?.find(
              (message) => message.id === options.queuedMessageId,
            )
          : undefined;
      const operatorAccess =
        operatorCommand.matched ||
        irgat ||
        operatorEnabledInThread(current.blocks);
      const computerAccess = appWindowTokens(submittedText).length > 0;
      const irgatFirstTurn =
        irgat &&
        !current.blocks.some((block) => block.role === "user" && !block.draft);
      const promptText = operatorCommand.matched
        ? operatorCommand.text.trim() ||
          "Explain what you can do in Irgatos with the app CLI."
        : submittedText;
      const rawCommand =
        !operatorCommand.matched &&
        isNativeCommandPrompt(submittedText, current.harness);
      const ciContext = options?.ciRepair?.prompt ?? options?.ciContext;
      const harnessText =
        options?.ciRepair?.prompt ??
        (rawCommand
          ? submittedText
          : options?.fromIrgat
            ? irgatMessagePrompt(options.fromIrgat, promptText)
            : composeNoteMessage(noteCard, promptText));

      const pendingSwitch = pendingComposerSwitch(current);

      // A Irgat accepts consecutive messages before its provider is connected.
      // The pending head is delivered once ready; later messages cannot overtake it.
      if (
        irgat &&
        !options?.queuedMessageId &&
        (current.busy || current.queuedMessages?.length)
      ) {
        const next = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? enqueueIrgatMessage(
                {
                  ...session,
                  inboxCard: rawCommand ? session.inboxCard : undefined,
                  noteCard: rawCommand ? session.noteCard : undefined,
                  handoffCard: rawCommand ? session.handoffCard : undefined,
                },
                {
                  id: crypto.randomUUID(),
                  text,
                  attachments,
                  noteCard,
                  handoffCard,
                  intent,
                },
                rawCommand ? undefined : userTurnCards(noteCard),
              )
            : session,
        );
        sessionsRef.current = next;
        setSessions(next);
        dismissNoticesForContinuedSession(sessionId);
        return true;
      }

      if (irgat && current.busy && options?.queuedMessageId) {
        const message = current.queuedMessages?.find(
          (entry) => entry.id === options.queuedMessageId,
        );
        if (
          !message ||
          !canSteerQueuedHead(current) ||
          !canSteerHarness(current.harness) ||
          operatorCommand.matched
        )
          return false;
        const gen = turnGen.current.get(sessionId);
        const change = (update: (session: Session) => Session) => {
          const next = sessionsRef.current.map((session) =>
            session.id === sessionId ? update(session) : session,
          );
          sessionsRef.current = next;
          setSessions(next);
        };
        return deliverQueuedFollowUp({
          message,
          current: () =>
            sessionsRef.current.find((session) => session.id === sessionId),
          isCurrentTurn: () => turnGen.current.get(sessionId) === gen,
          prepare: async () => {
            const latest = sessionsRef.current.find(
              (session) => session.id === sessionId,
            );
            if (latest) await upsertSession(latest);
            return {
              attachments: await prepareAttachments(attachments),
              text: await preparePrompt(harnessText, {
                harness: current.harness,
                sessionId,
                cwd: initialWorkCwd,
              }),
            };
          },
          steer: (prepared) =>
            steerHarnessTurn({
              harness: current.harness,
              sessionId,
              cwd: initialWorkCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              text: inboxAskPrompt(
                rawCommand ? undefined : current.inboxAsk,
                prepared.text,
              ),
              attachments: prepared.attachments,
            }),
          delivered: () => {
            change((session) =>
              acknowledgeIrgatMessage(session, message, {
                mode: "follow-up",
                text: submittedText,
                attachments: displayAttachments(attachments),
                cards: userTurnCards(noteCard),
              }),
            );
            flushHarnessEvents();
          },
          deferred: () => change((session) => ({ ...session, turnReady: false })),
          failed: (error) =>
            change((session) => ({
              ...session,
              queueStatus: "paused",
              queuedMessages: session.queuedMessages?.map((entry) =>
                entry.id === message.id ? { ...entry, error } : entry,
              ),
            })),
        });
      }

      if (current.busy && !pendingSwitch) {
        if (
          operatorCommand.matched &&
          options?.queuedMessageId &&
          options.followUpBehavior === "steer"
        ) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "/operator starts a new turn after the current turn finishes.",
          });
          flushHarnessEvents();
          return false;
        }
        const steerable =
          isLiveHarness(current.harness) && canSteerHarness(current.harness);
        const followUpBehavior =
          current.worktreePreparing ||
          intent === "plan" ||
          intent === "orchestrate" ||
          operatorCommand.matched
            ? "queue"
            : // The agent has yielded and only background work is left, which
              // may never end (a dev server). Queuing would park the message
              // behind it, so hand it to the agent now.
              current.backgroundTasks?.length
              ? "steer"
              : // Messaging a Irgat mid-reply is like texting a friend twice:
                // it reads the new message now, or right after if it can't.
                irgat
                ? steerable
                  ? "steer"
                  : "queue"
                : (options?.followUpBehavior ?? loadFollowUpBehavior());
        if (followUpBehavior === "queue") {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    inboxCard: rawCommand ? s.inboxCard : undefined,
                    noteCard: rawCommand ? s.noteCard : undefined,
                    handoffCard: rawCommand ? s.handoffCard : undefined,
                    queuedMessages: [
                      ...(s.queuedMessages ?? []),
                      {
                        id: crypto.randomUUID(),
                        text,
                        attachments,
                        noteCard,
                        handoffCard,
                        intent,
                      },
                    ],
                    queueStatus: s.queueStatus === "paused" ? "paused" : "active",
                  }
                : s,
            ),
          );
          dismissNoticesForContinuedSession(sessionId);
          return true;
        }
        if (!steerable) {
          // Harnesses that cannot steer (fx) used to drop the message on the
          // floor here, so a follow-up sent mid-turn just vanished. Say so.
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: `${current.harness} cannot take a follow-up mid-turn — wait for this turn to finish, or stop it first.`,
          });
          flushHarnessEvents();
          return false;
        }
        dismissNoticesForContinuedSession(sessionId);
        const visible = displayAttachments(attachments);
        const cards = userTurnCards(noteCard);
        const nextSessions = sessionsRef.current.map((s) => {
          if (s.id !== sessionId) return s;
          let next: Session = {
            ...s,
            inboxCard: rawCommand ? s.inboxCard : undefined,
            noteCard: rawCommand ? s.noteCard : undefined,
            handoffCard: rawCommand ? s.handoffCard : undefined,
          };
          if (options?.queuedMessageId) {
            next = dequeueQueuedMessage(next, options.queuedMessageId);
          }
          return appendSteerUser(next, submittedText, visible, cards);
        });
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);
        void (async () => {
          try {
            const prepared = await prepareAttachments(attachments);
            const prompt = await preparePrompt(harnessText, {
              harness: current.harness,
              sessionId,
              cwd: initialWorkCwd,
            });
            await steerHarnessTurn({
              harness: current.harness,
              sessionId,
              cwd: initialWorkCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              text: inboxAskPrompt(
                rawCommand ? undefined : current.inboxAsk,
                prompt,
              ),
              attachments: prepared,
            });
          } catch (error: unknown) {
            const message =
              error instanceof Error
                ? error.message
                : `${current.harness} could not steer the active turn`;
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
            flushHarnessEvents();
          }
        })();
        return true;
      }

      if (
        !options?.projectLocationReady &&
        looksLikeProject(current.cwd) &&
        !current.worktreeCwd
      ) {
        const key = pathKey(current.cwd);
        let sync = projectLocationSyncs.current.get(key);
        if (!sync) {
          sync = synchronizeProjectLocation(current.cwd);
          projectLocationSyncs.current.set(key, sync);
          void sync.then(
            () => projectLocationSyncs.current.delete(key),
            () => projectLocationSyncs.current.delete(key),
          );
        }
        return submitAfterProjectSync({
          cwd: current.cwd,
          sync,
          applyLocationChange: applyProjectLocationChange,
          submit: async () => {
            const accepted = await submitAfterProjectSyncRef.current(
              sessionId,
              text,
              attachments,
              { ...options, projectLocationReady: true },
            );
            if (!accepted) {
              editedResend?.reject();
              options?.onSettled?.({
                status: "failed",
                text: "",
                error:
                  "The chat became unavailable before the request could start. Try again when it is ready.",
              });
            }
            return accepted;
          },
          onError: (error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : "The project folder could not be opened.";
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
            flushHarnessEvents();
            editedResend?.reject();
            options?.onSettled?.({
              status: "failed",
              text: "",
              error: message,
            });
          },
        });
      }

      // A Irgat's chat never ends, but the provider session behind it does:
      // once it fills most of the model's context window, this turn starts
      // a fresh one, briefed on where the conversation was.
      const irgatRotationReason =
        irgat && !pendingSwitch && !editedResend
          ? rotationReason(current)
          : undefined;
      const irgatRotation = irgatRotationReason
        ? planRotation(
            current.blocks,
            loadIrgatRotation(sessionId),
            irgatRotationReason,
            Date.now(),
          )
        : undefined;

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      if (!options?.completionGateBounce) completionGate.noteUserTurn(sessionId);
      const proposalId =
        intent === "orchestrate" ? crypto.randomUUID() : undefined;
      let proposalDraft: OrchestrationProposal | undefined = proposalId
        ? {
            version: 1,
            leadId: sessionId,
            cwd: current.cwd,
            checkoutCwd: initialWorkCwd,
            request: harnessText,
            author: {
              harness: current.harness,
              model: current.model,
              name: resolveModel(current.harness, current.model).name,
            },
            settings: { choices: [], maxWorkers: 2 },
            status: "planning",
            title: "Orchestration plan",
            summary: "",
            tasks: [],
          }
        : undefined;
      const isFirstTurn = current.blocks.length === 0;
      const placeholderTitle =
        canReplaceSessionTitle(
          current.title,
          current.harness,
          HARNESS_LABEL[current.harness],
        ) || !!draftBlock;
      const titleSeed =
        isFirstTurn && !current.inboxCard && !current.noteCard && placeholderTitle
          ? titleFromPrompt(
              operatorCommand.matched ? promptText : submittedText,
              current.harness,
              attachments,
            )
          : current.title;
      const visible = displayAttachments(attachments);
      const card =
        options?.secondOpinion ??
        (handoffCard ? handoffTurnCard(handoffCard) : undefined);
      const visibleText = operatorCommand.matched
        ? promptText
        : card?.kind === "handoff"
          ? submittedText
          : card
            ? SECOND_OPINION_TITLE
            : submittedText;
      const cards = {
        ...(rawCommand ? undefined : userTurnCards(noteCard, card)),
        ...(ciContext ? { ciContext } : {}),
        ...(operatorCommand.matched ? { irgat: true } : {}),
        ...(intent === "plan" || intent === "orchestrate" ? { intent } : {}),
        ...(options?.appRequestId ? { appRequestId: options.appRequestId } : {}),
        // The orchestrator writes these turns, not the user; hide them.
        ...(options?.managed ||
        options?.internal ||
        options?.irgatSessionCompletion
          ? { internal: true }
          : {}),
        ...(options?.irgatSessionCompletion
          ? { irgatSessionCompletion: options.irgatSessionCompletion }
          : {}),
        ...(options?.fromIrgat ? { fromIrgat: options.fromIrgat } : {}),
      };
      const live = isLiveHarness(current.harness);
      const queuedHandoff =
        live && !pendingSwitch ? pendingHandoff(current) : null;

      if (pendingSwitch && current.busy) {
        void cancelHarnessTurn(pendingSwitch.from, sessionId);
      }

      dismissNoticesForContinuedSession(sessionId);
      const commitSubmittedTurn = () => {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            const draftRemoved = draftBlock
              ? {
                  ...s,
                  blocks: s.blocks.filter((block) => block.id !== draftBlock.id),
                }
              : s;
            const selected = options?.buildTarget
              ? withPlanBuildTarget(draftRemoved, options.buildTarget)
              : draftRemoved;
            const titled = isFirstTurn ? titleSeed : selected.title;
            let next: Session = {
              ...selected,
              providerAccountId,
              usageLimit: undefined,
              worktreePreparing: createDraftWorktree
                ? true
                : selected.worktreePreparing,
              inboxCard:
                rawCommand || options?.ciRepair ? s.inboxCard : undefined,
              noteCard: rawCommand || options?.ciRepair ? s.noteCard : undefined,
              handoffCard:
                rawCommand || options?.ciRepair ? s.handoffCard : undefined,
            };
            if (editedResend) {
              next = editedResend.replace(next);
            }
            if (approvedPlan && intent === "build") {
              next = {
                ...next,
                blocks: next.blocks.map((block) =>
                  block.id === approvedPlan.id && block.role === "plan"
                    ? {
                        ...block,
                        plan: {
                          ...(block.plan ?? { status: "ready" as const }),
                          status: "building" as const,
                          approvedText: block.text,
                        },
                      }
                    : block,
                ),
              };
            }
            if (options?.queuedMessageId) {
              next = dequeueQueuedMessage(next, options.queuedMessageId);
            }
            if (!live) {
              return {
                ...next,
                title: titled,
                pendingSwitch: undefined,
                busy: false,
                blocks: [
                  ...next.blocks,
                  ...(queuedIrgatMessage?.blockId
                    ? []
                    : [
                        {
                          id: crypto.randomUUID(),
                          role: "user",
                          text: visibleText,
                          ...(visible.length > 0 ? { attachments: visible } : {}),
                          ...cards,
                        } as Block,
                      ]),
                  {
                    id: crypto.randomUUID(),
                    role: "system",
                    text: `${next.harness} is not connected yet — install and sign in to that provider, then retry.`,
                    notice: "error",
                  },
                ],
              };
            }
            if (pendingSwitch) {
              const sealed = stopStreaming({
                ...next,
                title: titled,
                pendingSwitch: undefined,
              });
              const prepared = appendPreparingHandoff(
                sealed,
                pendingSwitch.from,
                next.harness,
              );
              return queuedIrgatMessage
                ? acknowledgeIrgatMessage(prepared, queuedIrgatMessage, {
                    mode: "new-turn",
                    text: visibleText,
                    attachments: visible,
                    cards,
                  })
                : appendUser(prepared, visibleText, visible, cards);
            }
            return queuedIrgatMessage
              ? acknowledgeIrgatMessage(
                  { ...next, title: titled },
                  queuedIrgatMessage,
                  {
                    mode: "new-turn",
                    text: visibleText,
                    attachments: visible,
                    cards,
                  },
                )
              : appendUser(
                  { ...next, title: titled },
                  visibleText,
                  visible,
                  cards,
                );
          }),
        );
      };
      if (!options?.resendEdited) {
        flushSync(commitSubmittedTurn);
      }

      const launchTitleGeneration = (workCwd: string) => {
        if (
          !live ||
          !shouldGenerateSessionTitle(
            isFirstTurn,
            placeholderTitle,
            options?.refreshTitle,
          )
        ) {
          return;
        }
        const titleMessage =
          harnessText || attachments.map((file) => file.name).join(", ");
        void generateHarnessTitle(current.harness, {
          sessionId,
          cwd: workCwd,
          message: titleMessage,
          providerAccountId,
        })
          .then(async (generated) => {
            if (
              options?.refreshTitle &&
              !isFirstTurn &&
              turnGen.current.get(sessionId) !== gen
            ) {
              return;
            }
            const linkedWorkItem = await resolveLinkedWorkItem(
              titleMessage,
              workCwd,
              generated?.workItem ?? null,
            );
            if (!generated && !linkedWorkItem) return;
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                let next = s;
                if (
                  generated &&
                  (options?.refreshTitle ||
                    canReplaceSessionTitle(s.title, s.harness, titleSeed))
                ) {
                  next = {
                    ...next,
                    title: formatSessionTitle(s.harness, generated.title),
                  };
                }
                if (linkedWorkItem && !next.linkedWorkItem) {
                  next = { ...next, linkedWorkItem };
                }
                return next;
              }),
            );
          })
          .catch(() => undefined);
      };

      if (!live) {
        if (pendingSwitch) {
          void forgetHarnessSession(pendingSwitch.from, sessionId);
        }
        editedResend?.reject();
        options?.onSettled?.({
          status: "failed",
          text: "",
          error: "Harness is not connected",
        });
        return true;
      }
      if (editedResend && canRewindHarnessLastTurn(current.harness)) {
        editedResends.start(sessionId);
        const locked = sessionsRef.current.map((session) =>
          session.id === sessionId ? { ...session, busy: true } : session,
        );
        sessionsRef.current = locked;
        syncDockBadge(locked);
        setSessions(locked);
      }

      if (proposalId && proposalDraft) {
        const draft = proposalDraft;
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  blocks: [...session.blocks, proposalBlock(proposalId, draft)],
                }
              : session,
          ),
        );
      }

      let controlOutcome: ControlOutcome = {
        status: "failed",
        text: "",
        error: "Turn did not complete",
      };
      let controlText = "";
      let proposalText = "";
      let nativeProposalText = "";
      let completedProposal: OrchestrationProposal | undefined;
      void (async () => {
        let workCwd = initialWorkCwd;
        if (createDraftWorktree) {
          const tree = await createWorktree(
            current.cwd,
            temporaryWorktreeBranchName(),
            current.worktreeBase || "HEAD",
            false,
          );
          workCwd = tree.path;
          workspacePins.current.set(sessionId, currentWorkspace(current.cwd));
          if (proposalDraft)
            proposalDraft = { ...proposalDraft, checkoutCwd: tree.path };
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    worktreeCwd: tree.path,
                    branch: tree.branch ?? undefined,
                    workspaceMode: undefined,
                    worktreeBase: undefined,
                    worktreePreparing: undefined,
                  }
                : session,
            ),
          );
          notifyReviewChanged(sessionId);

          const branchMessage =
            harnessText || attachments.map((file) => file.name).join(", ");
          void generateHarnessBranchName(
            pickTextHarness(current.harness),
            workCwd,
            branchMessage,
          )
            .then(async (fragment) => {
              const branch = fragment ? namedWorktreeBranch(fragment) : null;
              if (!branch) return;
              const renamed = await renameWorktreeBranch(
                current.cwd,
                tree.path,
                branch,
              );
              setSessions((prev) =>
                prev.map((session) =>
                  session.id === sessionId &&
                  pathKey(sessionWorkCwd(session)) === pathKey(tree.path)
                    ? { ...session, branch: renamed.branch ?? undefined }
                    : session,
                ),
              );
            })
            .catch(() => undefined);
        }
        launchTitleGeneration(workCwd);
        if (turnGen.current.get(sessionId) !== gen) return;
        if (proposalDraft && proposalId) {
          const settings = await discoverOrchestrationSettings();
          if (turnGen.current.get(sessionId) !== gen) return;
          proposalDraft = { ...proposalDraft, settings };
          const discovering = proposalDraft;
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? withOrchestrationProposal(session, proposalId, discovering)
                : session,
            ),
          );
        }
        let wrap = handoffCard
          ? {
              from: handoffCard.from,
              to: current.harness,
              text: handoffCard.brief,
            }
          : queuedHandoff;
        if (pendingSwitch) {
          let agentText = "";
          if (
            shouldAskOutgoingAgent(current) &&
            isLiveHarness(pendingSwitch.from)
          ) {
            try {
              agentText = await requestOutgoingHandoff({
                harness: pendingSwitch.from,
                sessionId,
                cwd: workCwd,
                model: pendingSwitch.fromModel,
                modelSettings: pendingSwitch.fromSettings,
                providerAccountId: pendingSwitch.fromProviderAccountId,
                userRequest: text,
              });
            } catch {
              agentText = "";
            }
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          const latest = sessionsRef.current.find((s) => s.id === sessionId);
          const brief = chooseHandoffBrief(agentText, latest ?? current, text);
          await forgetHarnessSession(pendingSwitch.from, sessionId);
          if (turnGen.current.get(sessionId) !== gen) return;
          wrap = { from: pendingSwitch.from, to: current.harness, text: brief };
        }

        const revealHandoff = (brief: string) => {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId || !isPreparingHandoff(s)) return s;
              return { ...completeHandoff(s, brief), busy: true };
            }),
          );
        };

        const planEventKey = planTurnKey(gen);
        let nativePlanSeen = false;
        let providerFailureSeen = false;
        const routePlanEvent = (event: HarnessEvent): HarnessEvent | null => {
          if (event.type === "session.error") providerFailureSeen = true;
          if (proposalDraft) {
            if (event.type === "message.delta") {
              proposalText = (proposalText + event.text).slice(-200_000);
              return null;
            }
            if (event.type === "message.completed") {
              proposalText += "\n";
              return null;
            }
            if (event.type === "plan") {
              nativeProposalText = event.append
                ? nativeProposalText + event.text
                : event.text;
              return null;
            }
          }
          if (intent !== "plan") return event;
          if (event.type === "plan") {
            nativePlanSeen = true;
            return {
              ...event,
              key: planEventKey,
            };
          }
          return event;
        };

        const pendingEditedEvents: HarnessEvent[] = [];
        const applyTurnEvent = (event: HarnessEvent) => {
          orchestrator.observe(sessionId, event);
          if (options?.onSettled && event.type === "message.delta")
            controlText = (controlText + event.text).slice(-20_000);
          if (options?.onSettled && event.type === "message.completed")
            controlText += "\n";
          if (event.type === "session.error")
            controlOutcome.error = event.message;
          if (
            wrap &&
            (event.type === "session.started" ||
              event.type === "session.providerBound")
          ) {
            revealHandoff(wrap.text);
          }
          nudgeOpenEditors(event, workCwd);
          if (!orchestrator.forSession(sessionId))
            trackSessionEdits(sessionId, workCwd, event);
          const routed = routePlanEvent(event);
          if (routed) enqueueHarnessEvent(sessionId, routed);
        };
        const routeTurnEvent = (event: HarnessEvent) => {
          if (turnGen.current.get(sessionId) !== gen) return;
          if (editedResend && !editedResend.isAccepted()) {
            pendingEditedEvents.push(event);
            return;
          }
          applyTurnEvent(event);
        };
        const acceptEditedResend = () => {
          if (!editedResend || editedResend.isAccepted()) return;
          flushSync(commitSubmittedTurn);
          editedResend.markAccepted();
          for (const event of pendingEditedEvents) applyTurnEvent(event);
          pendingEditedEvents.length = 0;
        };
        const recoverEditedResend = () => {
          if (!editedResend || editedResend.isAccepted()) return;
          pendingEditedEvents.length = 0;
          const previous = sessionsRef.current.find(
            (session) => session.id === sessionId,
          );
          const recovered = previous
            ? editedResend.recoverAfterFailure(previous)
            : undefined;
          flushSync(() => {
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId && recovered ? recovered : session,
              ),
            );
          });
        };

        const checkpointTurnId =
          !current.inboxAsk && !orchestrator.forSession(sessionId)
            ? await beginSessionTurn(
                sessionId,
                workCwd,
                sessionEditPaths(current.blocks),
              )
            : undefined;
        if (turnGen.current.get(sessionId) !== gen) {
          if (checkpointTurnId) {
            await finishSessionTurn(sessionId, workCwd, {
              turnId: checkpointTurnId,
            });
          }
          return;
        }
        let buildSucceeded = false;
        try {
          const prepared = await prepareAttachments(attachments);
          const prompt =
            intent === "build" && approvedPlan
              ? buildPlanPrompt(approvedPlan.text)
              : await preparePrompt(harnessText, {
                  harness: current.harness,
                  sessionId,
                  cwd: workCwd,
                });
          const turnPrompt = proposalDraft
            ? options?.orchestrationRetry?.response
              ? orchestrationRepairPrompt({
                  ...proposalDraft,
                  error: options.orchestrationRetry.error,
                  response: options.orchestrationRetry.response,
                })
              : orchestrationPlanningPrompt(
                  prompt,
                  proposalDraft.settings,
                  proposalDraft.checkoutCwd ?? proposalDraft.cwd,
                )
            : intent === "plan" && !rawCommand
              ? planTurnPrompt(prompt)
              : prompt;
          const earlier = queuedHandoff ? userMessagesAfterHandoff(current) : [];
          if (editedResend && canRewindHarnessLastTurn(current.harness)) {
            try {
              await rewindHarnessLastTurn({
                harness: current.harness,
                sessionId,
                cwd: workCwd,
                model: current.model,
                modelSettings: current.modelSettings,
                providerAccountId,
                runtimeMode: current.runtimeMode,
                ephemeral: current.ephemeral === true,
                codexStore: irgat ? "irgat" : undefined,
                controlsAgents:
                  operatorAccess ||
                  computerAccess ||
                  orchestrator.run(sessionId)?.status === "active",
                ...(editedProviderTurnId
                  ? { providerTurnId: editedProviderTurnId }
                  : {}),
                onEvent: (event) => {
                  if (turnGen.current.get(sessionId) !== gen) return;
                  enqueueHarnessEvent(sessionId, event);
                },
              });
            } catch (error) {
              flushHarnessEvents();
              editedResend.reject();
              throw error;
            }
            editedResend.markProviderRewound();
            flushHarnessEvents();
            if (turnGen.current.get(sessionId) !== gen) {
              const latest = sessionsRef.current.find(
                (session) => session.id === sessionId,
              );
              if (
                !latest ||
                (!latest.busy &&
                  latest.providerSessionId === current.providerSessionId)
              ) {
                await forgetHarnessSession(current.harness, sessionId);
                if (latest) {
                  setSessions((prev) =>
                    prev.map((session) =>
                      session.id === sessionId &&
                      session.providerSessionId === current.providerSessionId
                        ? { ...session, providerSessionId: undefined }
                        : session,
                    ),
                  );
                }
              }
              recoverEditedResend();
              return;
            }
          }
          const sendTurn = (text: string, turnAttachments = prepared) =>
            sendHarnessTurn({
              harness: current.harness,
              sessionId,
              cwd: workCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              providerAccountId,
              runtimeMode: current.runtimeMode,
              ephemeral: current.ephemeral === true,
              codexStore: irgat ? "irgat" : undefined,
              intent: intent === "orchestrate" ? "plan" : intent,
              // A /operator user turn enables app access for this thread;
              // orchestration leads retain their separate control access.
              controlsAgents:
                operatorAccess ||
                computerAccess ||
                orchestrator.run(sessionId)?.status === "active",
              appAccess: operatorAccess || computerAccess,
              text,
              attachments: turnAttachments,
              ...(editedResend ? { onAccepted: acceptEditedResend } : {}),
              onEvent: routeTurnEvent,
            });
          let sendText = orchestrator.prompt(
            sessionId,
            inboxAskPrompt(
              rawCommand ? undefined : current.inboxAsk,
              wrap && !rawCommand
                ? wrapHandoffPrompt(
                    wrap.text,
                    wrap.from,
                    turnPrompt.trim() || CONTINUE_PROMPT,
                    earlier,
                  )
                : turnPrompt,
            ),
          );
          if (irgatRotation) {
            if (current.harness === "codex" && current.providerSessionId) {
              await migrateIrgatxSession({
                sessionId,
                threadId: current.providerSessionId,
                cwd: workCwd,
                providerAccountId,
              });
            }
            await forgetHarnessSession(current.harness, sessionId);
            const fresh = (session: Session) =>
              session.id === sessionId
                ? {
                    ...session,
                    providerSessionId: undefined,
                    context: undefined,
                  }
                : session;
            current = fresh(current);
            sessionsRef.current = sessionsRef.current.map(fresh);
            setSessions((prev) => prev.map(fresh));
            saveIrgatRotation(sessionId, irgatRotation.rotation);
          }
          // The agent's soul and memory live in its folder. A native session
          // is handed them once, and memory again only when it changes.
          const irgatRecord = irgat ? irgatForSession(sessionId) : undefined;
          const agentLook = irgatRecord ? irgatLook(irgatRecord) : undefined;
          const agentFiles = irgatRecord
            ? await loadIrgatFiles(irgatRecord.id).catch(() => undefined)
            : undefined;
          // Who it is counts as part of its soul: a rename or a change to its
          // projects is handed over too, and so is a change to the fixed rules.
          const otherIrgats = irgatRecord
            ? listIrgats()
                .filter((other) => other.id !== irgatRecord.id)
                .map((other) => irgatLook(other).name)
            : [];
          const handedFiles = agentFiles &&
            agentLook && {
              ...agentFiles,
              soulHash: `${agentFiles.soulHash}:${agentLook.name}:${agentLook.projects
                .map((project) => project.path)
                .join("|")}:${otherIrgats.join("|")}:${IRGAT_PROMPT_VERSION}`,
            };
          const agentPlan = handedFiles
            ? planAgentContext(sessionId, current.providerSessionId, handedFiles)
            : undefined;
          const handAgent = agentPlan ? agentPlan.soul : irgatFirstTurn;
          // What the app adds to the user's message rather than them.
          const appContext: string[] = [];
          if (options?.resumeContext) appContext.push(options.resumeContext);
          if (irgatRotation) {
            appContext.push(irgatRotation.brief(sessionId));
          }
          // Habit posts land in the chat outside any turn, so the Irgat's
          // session has not seen them; the next message carries them once.
          const habitPosts = irgat ? unseenHabitPosts(current.blocks) : [];
          if (habitPosts.length) {
            appContext.push(habitPostsContext(habitPosts));
          }
          // Likewise what was said in a Live voice call since the last turn.
          const liveTurns = unseenLiveTurns(current.blocks);
          if (liveTurns.length) appContext.push(liveTurnsContext(liveTurns));
          if (
            agentFiles &&
            agentLook &&
            agentPlan &&
            (agentPlan.soul || agentPlan.memory)
          ) {
            appContext.push(
              irgatContext(agentLook, agentFiles, agentPlan, otherIrgats),
            );
          }
          // A command owns its arguments, and a plan proposal has a fixed shape.
          const adhdPlan =
            rawCommand || proposalDraft
              ? {}
              : planAdhdContext(
                  sessionId,
                  current.providerSessionId,
                  adhdEnabledFor(sessionId),
                  { force: !!editedResend },
                );
          if (adhdPlan.context) appContext.push(adhdPlan.context);
          if (operatorCommand.matched || handAgent) {
            const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
            appContext.push(
              `<irgat_app>\n${handAgent ? "App access is always enabled in this thread." : "The user's Operator command enables app access in this thread, including later turns without the command."} You can start session tabs or split session panes right or down, list and create project worktrees, choose a new session's checkout, read, continue, stop, archive or delete other project sessions, save unsent drafts, organize session folders, and read or write saved notes through its local CLI. Run \`${cli} --help\` when you need the exact commands and JSON fields. When reading another session, start with its latest two or three user/assistant exchanges. Request older exchanges with nextBefore or a larger excerpt only if needed. The CLI uses a session credential already in your environment; never print it. New sessions inherit this session's permission mode unless runtimeMode is set explicitly. For a new session with a draft, call sessions.start with its prompt and draft:true; do not submit a seed prompt. The returned ID can be used as besideSessionId to split its pane again or moved into a folder immediately. A normal sessions.start submits its prompt but returns after acceptance, so do not wait for that agent to finish before organizing it.\n</irgat_app>`,
            );
          }
          // Orchestration sessions carry no app credential, so only ordinary
          // sessions hear about code search, once each, in indexed projects.
          if (
            !rawCommand &&
            !orchestrator.forSession(sessionId) &&
            (await claimCodeSearchHint(sessionId, workCwd))
          ) {
            const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
            appContext.push(codeSearchContext(cli));
          }
          // Any chat can see and use the Browser; it hears how once, and
          // hears about the page beside it whenever that page changes.
          if (!rawCommand && !orchestrator.forSession(sessionId)) {
            if (claimBrowserToolsHint(sessionId)) {
              const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
              appContext.push(browserToolsContext(cli));
            }
            const browserPage = claimBrowserPage(sessionId);
            if (browserPage) {
              // A slow page only costs the excerpt, never the message.
              const excerpt = await Promise.race([
                browserPageExcerpt(PAGE_EXCERPT_CHARS).catch(() => null),
                new Promise<null>((resolve) => setTimeout(resolve, 1500, null)),
              ]);
              appContext.push(browserPageContext(browserPage, excerpt));
            }
          }
          // A chat started from the Mail page hears about its thread once.
          const mailLink =
            rawCommand || orchestrator.forSession(sessionId)
              ? null
              : await claimMailHint(sessionId);
          if (mailLink) {
            const cli = `${shellPath(await invoke<string>("app_cli_path"))} app`;
            appContext.push(mailContext(cli, mailLink));
          }
          // A Irgat reads who it is ahead of the message, so it never takes it
          // for something the user pasted. A command must stay first.
          if (irgat && !rawCommand) sendText = irgatTurn(sendText, appContext);
          else if (appContext.length)
            sendText += `\n\n${appContext.join("\n\n")}`;
          await sendTurn(sendText);
          if (adhdPlan.state && !providerFailureSeen) {
            recordAdhdContext(
              sessionId,
              sessionsRef.current.find((session) => session.id === sessionId)
                ?.providerSessionId ?? current.providerSessionId,
              adhdPlan.state,
            );
          }
          if (agentFiles) {
            recordAgentContext(
              sessionId,
              sessionsRef.current.find((session) => session.id === sessionId)
                ?.providerSessionId ?? current.providerSessionId,
              handedFiles ?? agentFiles,
            );
          }
          acceptEditedResend();
          if (proposalDraft && !providerFailureSeen) {
            completedProposal = await completeOrRepairOrchestrationProposal(
              proposalDraft,
              nativeProposalText || proposalText,
              async (repairPrompt) => {
                proposalText = "";
                nativeProposalText = "";
                await sendTurn(repairPrompt, []);
                if (providerFailureSeen)
                  throw new Error(
                    controlOutcome.error ??
                      "The lead could not repair the proposal.",
                  );
                return nativeProposalText || proposalText;
              },
              () =>
                turnGen.current.get(sessionId) === gen &&
                !isProviderFailureText(nativeProposalText || proposalText),
            );
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                const ready = isPreparingHandoff(s)
                  ? completeHandoff(s, wrap.text)
                  : s;
                // A command owns its arguments; deliver the recap with the next chat prompt.
                return rawCommand ? ready : consumeHandoff(ready);
              }),
            );
          }
          buildSucceeded = true;
        } catch (error: unknown) {
          recoverEditedResend();
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) revealHandoff(wrap.text);
          const message =
            error instanceof Error
              ? error.message
              : String(error) || `${current.harness} adapter failed`;
          controlOutcome.error = message;
          if (!providerFailureSeen) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message,
            });
          }
          providerFailureSeen = true;
        } finally {
          // A failed provider can leave its process writing after the event
          // stream ends. Stop it before recording the final workspace state.
          if (providerFailureSeen && turnGen.current.get(sessionId) === gen) {
            await stopHarnessSession(current.harness, sessionId).catch(
              () => undefined,
            );
          }
          if (checkpointTurnId) {
            await finishSessionTurn(sessionId, workCwd, {
              turnId: checkpointTurnId,
            });
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          controlOutcome = {
            status:
              providerFailureSeen ||
              isProviderFailureText(controlText) ||
              !buildSucceeded
                ? "failed"
                : "completed",
            text: controlText.trim(),
            ...(providerFailureSeen ? { error: controlOutcome.error } : {}),
          };
          // The provider answered in full, so whatever held it is over.
          if (controlOutcome.status === "completed")
            usageLimitRegistry.noteSuccess(
              current.harness,
              providerAccountId,
              turnStartedAt,
            );
          await flushSessionCheckpoint(sessionId);
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId) return s;
              const stopped = stopStreaming(s);
              const providerFailed =
                providerFailureSeen ||
                isProviderFailureText(lastAssistantTextInTurn(stopped));
              const finalized =
                proposalDraft && proposalId
                  ? withOrchestrationProposal(
                      stopped,
                      proposalId,
                      completedProposal && !providerFailed && buildSucceeded
                        ? completedProposal
                        : completeOrchestrationProposal(
                            proposalDraft,
                            nativeProposalText || proposalText,
                            providerFailed || !buildSucceeded
                              ? (controlOutcome.error ??
                                  "The lead could not finish planning.")
                              : undefined,
                          ),
                    )
                  : intent === "plan" && !nativePlanSeen && !providerFailed
                    ? promoteLastAssistantToPlan(stopped, planEventKey)
                    : stopped;
              return approvedPlan && intent === "build"
                ? withPlanStatus(
                    finalized,
                    approvedPlan.id,
                    buildSucceeded && !providerFailed ? "built" : "ready",
                  )
                : finalized;
            }),
          );
          // Next tick: the flush above has rendered by then, so the banner
          // quotes the reply's final text rather than the previous batch.
          window.setTimeout(() => {
            const finished = sessionsRef.current.find((s) => s.id === sessionId);
            const visible = sessionId === activeSessionIdRef.current;
            // A habit's hidden run speaks through its Irgat's chat instead.
            if (finished && !isHabitRun(sessionId))
              void announceSessionFinished(finished, visible);
          }, 0);
          notifyReviewChanged(sessionId);
          notifyGitChanged();
          nudgeWorkspace(workCwd);
          nudgeWatchedFiles();
          window.setTimeout(() => nudgeWatchedFiles(), 150);
        }
      })()
        .catch((error: unknown) => {
          controlOutcome = {
            status: "failed",
            text: controlText,
            error: error instanceof Error ? error.message : String(error),
          };
          if (turnGen.current.get(sessionId) === gen) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message: controlOutcome.error!,
            });
            flushHarnessEvents();
            setSessions((prev) =>
              prev.map((session) => {
                if (session.id !== sessionId) return session;
                const stopped = {
                  ...stopStreaming(session),
                  worktreePreparing: undefined,
                };
                return proposalId && proposalDraft
                  ? withOrchestrationProposal(
                      stopped,
                      proposalId,
                      completeOrchestrationProposal(
                        proposalDraft,
                        "",
                        controlOutcome.error,
                      ),
                    )
                  : stopped;
              }),
            );
          }
        })
        .finally(() => {
          editedResend?.reject();
          if (editedResend) editedResends.finish(sessionId);
          options?.onSettled?.(
            turnGen.current.get(sessionId) !== gen
              ? { status: "cancelled", text: controlText }
              : controlOutcome,
          );
          if (turnGen.current.get(sessionId) !== gen) return;
          const ended = sessionsRef.current.find((s) => s.id === sessionId);
          const gate = ended
            ? resolveCompletionGate(
                loadProjectGate(ended.cwd),
                loadSessionGate(sessionId),
              )
            : null;
          if (
            ended &&
            gate &&
            gateAppliesToTurn({
              completed: controlOutcome.status === "completed",
              remote: false,
              ephemeral: !!ended.ephemeral,
              inboxAsk: !!ended.inboxAsk,
              habitRun: isHabitRun(sessionId),
              managed: !!options?.managed,
              appRequest: !!options?.appRequestId,
              plan: intent === "plan",
              orchestration: !!proposalId,
            })
          ) {
            void completionGate.afterTurn({
              sessionId,
              turn: gen,
              cwd: sessionWorkCwd(ended),
              gate,
              bounce: !!options?.completionGateBounce,
            });
          } else if (options?.completionGateBounce) {
            completionGate.clear(sessionId);
          }
        });
      return true;
    },
    [
      applyProjectLocationChange,
      dismissNoticesForContinuedSession,
      enqueueHarnessEvent,
      flushHarnessEvents,
    ],
  );
  submitAfterProjectSyncRef.current = submitSession;
  completionGateSubmitRef.current = submitSession;
  // Interactive callers use the immediate result to clear their composer. The
  // queued-launch receiver uses submitSession to await the actual acceptance.
  const onSubmit = useCallback(
    (...args: Parameters<Submit>): boolean => {
      // Reject before async preparation can make the composer clear its draft.
      if (workspaceNavigation.isSwitching(args[0])) return false;
      const result = submitSession(...args);
      if (typeof result === "boolean") return result;
      // Deferred errors have already been displayed by submitAfterProjectSync.
      void result.catch(() => undefined);
      return true;
    },
    [submitSession],
  );
  useEffect(
    () =>
      connectSessionMessageTransport({
        sessions: () => sessionsRef.current,
        submit: (sessionId, text) => onSubmit(sessionId, text, []),
      }),
    [onSubmit],
  );
  useEffect(() => syncSessionMessages(sessions), [sessions]);
  useEffect(() => startSessionMessageGuardTimer(() => sessionsRef.current), []);

  // onApproval is created once; it reaches the current helper through this.
  const decideIrgatBlockRef = useRef<
    (
      irgatId: string,
      blockId: string,
      decided: "allow" | "deny" | "cancelled",
    ) => void
  >(() => {});
  /** Adds a block to a Irgat's chat outside any turn, once no reply is streaming. */
  const appendToIrgat = (
    irgatId: string,
    block: Block,
    then?: (irgat: Session) => void,
    attempt = 0,
  ) => {
    const irgat = sessionsRef.current.find((session) => session.id === irgatId);
    if (!irgat) return;
    if (irgat.busy && attempt < 120) {
      window.setTimeout(
        () => appendToIrgat(irgatId, block, then, attempt + 1),
        5_000,
      );
      return;
    }
    const next: Session = { ...irgat, blocks: [...irgat.blocks, block] };
    sessionsRef.current = sessionsRef.current.map((session) =>
      session.id === irgatId ? next : session,
    );
    setSessions(sessionsRef.current);
    persistSession(next);
    then?.(next);
  };
  const decideIrgatBlock = (
    irgatId: string,
    blockId: string,
    decided: "allow" | "deny" | "cancelled",
  ) => {
    const decide = (session: Session) =>
      session.id === irgatId
        ? {
            ...session,
            blocks: session.blocks.map((block) =>
              block.id === blockId && block.approval
                ? { ...block, approval: { ...block.approval, decided } }
                : block,
            ),
          }
        : session;
    sessionsRef.current = sessionsRef.current.map(decide);
    setSessions(sessionsRef.current);
    persistSession(sessionsRef.current.find((session) => session.id === irgatId));
  };
  decideIrgatBlockRef.current = decideIrgatBlock;
  const appendLiveRef = useRef(appendToIrgat);
  appendLiveRef.current = appendToIrgat;
  useEffect(
    () =>
      setLiveHost({
        session: (sessionId) => {
          const session = sessionsRef.current.find(
            (candidate) => candidate.id === sessionId,
          );
          return session
            ? {
                id: session.id,
                title: irgatForSession(session.id)
                  ? irgatLook(irgatForSession(session.id)!).name
                  : session.title,
                cwd: session.cwd,
                blocks: session.blocks,
              }
            : undefined;
        },
        append: (sessionId, block) => appendLiveRef.current(sessionId, block),
        delegate: async (sessionId, prompt) => {
          let settle!: (text: string | undefined) => void;
          const done = new Promise<string | undefined>((resolve) => {
            settle = resolve;
          });
          const accepted = await submitSessionRef.current(sessionId, prompt, [], {
            onSettled: (outcome) =>
              settle(outcome.status === "completed" ? outcome.text : undefined),
          });
          return accepted
            ? { started: true, done }
            : {
                started: false,
                reason: "The agent could not take the work right now",
              };
        },
      }),
    [],
  );

  useLightpandaAutostart();
  useHabitWebhooks();
  useIrgatHabits({
    sessions: () => sessionsRef.current,
    open: async (id) => (await ensureOpenSession(id)) ?? undefined,
    add: (session) => {
      sessionsRef.current = [...sessionsRef.current, session];
      setSessions(sessionsRef.current);
    },
    run: (id, prompt) =>
      new Promise((resolve) => {
        void submitWithSettlement({
          submit: (onSettled) => submitSession(id, prompt, [], { onSettled }),
          onSettled: resolve,
          rejectionMessage: "The habit's run could not start.",
        });
      }),
    remove: async (id) => {
      const open = await stopSessionForRemoval(id);
      if (open)
        await Promise.all(
          sessionChildHarnesses(open).map((harness) =>
            forgetHarnessSession(harness, id),
          ),
        );
      await deleteSession(id, []);
      sessionsRef.current = sessionsRef.current.filter(
        (session) => session.id !== id,
      );
      setSessions(sessionsRef.current);
    },
    post: (irgatId, habit, text, name, artifacts) =>
      appendToIrgat(
        irgatId,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text,
          irgatHabit: { id: habit.id, name: habit.name, at: Date.now() },
          ...(artifacts?.length ? { artifactCards: artifacts } : {}),
        },
        (posted) => {
          irgatReplies.noteReply(irgatId);
          void announceSessionFinished(
            { ...posted, title: name },
            irgatId === activeSessionIdRef.current,
          );
        },
      ),
    // The chat shows it like any approval, and the usual approval banner
    // fires for the Irgat; the answer is routed back in onApproval.
    askApproval: (irgatId, habit, runId, block) => {
      const blockId = crypto.randomUUID();
      const requestId = relayApproval({
        irgatId,
        runId,
        requestId: block.approval!.requestId,
        blockId,
      });
      appendToIrgat(irgatId, {
        id: blockId,
        role: "approval",
        text: block.text,
        ...(block.tool ? { tool: block.tool } : {}),
        approval: { requestId },
        irgatHabit: { id: habit.id, name: habit.name, at: Date.now() },
      });
    },
    endApprovals: (runId) => {
      for (const relay of dropRelays(runId))
        decideIrgatBlock(relay.irgatId, relay.blockId, "cancelled");
    },
  });

  const automationSessionReservations = useRef(new Set<string>());
  const heldAutomationRuns = useRef(
    new Map<
      string,
      {
        automation: Automation;
        run: AutomationRun;
        prompt: string;
        sourceWorkItem?: LinkedWorkItem;
      }
    >(),
  );
  const automationRecoveryRef = useRef<Promise<void> | null>(null);
  const automationRecoveryCutoffRef = useRef(Date.now());

  const launchAutomation = useCallback(
    async (
      automation: Automation,
      run: AutomationRun,
      reveal = false,
      prompt = run.prompt ?? automation.prompt,
      sourceWorkItem?: LinkedWorkItem,
      /** Run anyway, or the hold this run waited on has ended. */
      force = false,
    ) => {
      // A scheduled run whose provider is out of quota waits, still pending,
      // for the reset instead of failing. A manual run is the user's call.
      if (!force && run.trigger !== "manual") {
        const accountId = holdAccountId(
          automation.harness,
          undefined,
          automation.cwd,
        );
        if (usageLimitRegistry.get(automation.harness, accountId)) {
          const id = automationHoldId(run.id);
          heldAutomationRuns.current.set(id, {
            automation,
            run,
            prompt,
            ...(sourceWorkItem ? { sourceWorkItem } : {}),
          });
          usageLimitRegistry.holdWork({
            id,
            kind: "automation",
            harness: automation.harness,
            accountId,
            label: automation.name,
            ownerId: automation.id,
          });
          return;
        }
      }
      let reservationId: string | undefined;
      let releaseAfterSettle = false;
      const releaseReservation = () => {
        if (!reservationId) return;
        automationSessionReservations.current.delete(reservationId);
        reservationId = undefined;
      };
      try {
        const eventRun = run.trigger === "event";
        const linkedWorkItem =
          sourceWorkItem ?? linkedWorkItemFromAutomationEvent(run);
        let session =
          automation.reuseSession && automation.lastSessionId
            ? sessionsRef.current.find(
                (entry) =>
                  entry.id === automation.lastSessionId &&
                  entry.harness === automation.harness &&
                  !entry.busy &&
                  !entry.worktreeRemoved &&
                  !automationSessionReservations.current.has(entry.id) &&
                  (automation.workspaceMode === "current"
                    ? entry.workspaceMode !== "worktree" &&
                      !entry.worktreeCwd &&
                      pathKey(entry.cwd) === pathKey(automation.cwd)
                    : automation.workspaceMode === "existing"
                      ? pathKey(sessionWorkCwd(entry)) ===
                        pathKey(automation.worktreeCwd ?? "")
                      : false),
              )
            : undefined;

        if (!session) {
          session = {
            ...newSession(
              automation.harness,
              automation.cwd,
              automation.model,
              automation.runtimeMode,
              automation.modelSettings,
            ),
            title: eventRun
              ? HARNESS_LABEL[automation.harness]
              : formatSessionTitle(automation.harness, automation.name),
            automationId: automation.id,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
            ...(automation.workspaceMode === "worktree"
              ? { workspaceMode: "worktree" as const, worktreeBase: "HEAD" }
              : automation.workspaceMode === "existing" && automation.worktreeCwd
                ? { worktreeCwd: automation.worktreeCwd }
                : {}),
          };
          const nextSessions = [...sessionsRef.current, session];
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          const tab = newTab(session.id);
          appendTab(tab, automation.cwd);
          if (reveal) {
            setActiveTabId(tab.id);
            setComposerFocused(false);
          }
        } else {
          const stamped = {
            ...session,
            automationId: automation.id,
            model: automation.model,
            modelSettings: automation.modelSettings ?? {},
            runtimeMode: automation.runtimeMode,
            ...(linkedWorkItem ? { linkedWorkItem } : {}),
          };
          session = stamped;
          const nextSessions = sessionsRef.current.map((entry) =>
            entry.id === stamped.id ? stamped : entry,
          );
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          if (reveal) {
            focusOpenSession(session.id);
          }
        }

        reservationId = session.id;
        automationSessionReservations.current.add(session.id);

        if (automation.sessionFolderId && looksLikeProject(automation.cwd)) {
          saveSessionFolders(
            automation.cwd,
            placeSessionInFolder(loadSessionFolders(automation.cwd), session.id, {
              kind: "existing",
              folderId: automation.sessionFolderId,
            }),
          );
        }

        if (reveal) {
          setSearchViewOpen(false);
          setInboxViewOpen(false);
          setNotesViewOpen(false);
          setAutomationsViewOpen(false);
          setKanbanViewOpen(false);
          setFleetViewOpen(false);
          setSidebarTab("sessions", session.cwd);
        }

        await updateAutomationRun(run.id, "running", {
          sessionId: session.id,
        });
        // From here the settlement callback owns reservation cleanup, including
        // a rejected submission that never starts an agent turn.
        releaseAfterSettle = true;
        await submitWithSettlement({
          submit: (onSettled) =>
            submitSession(session.id, prompt, [], {
              refreshTitle: eventRun,
              onSettled,
            }),
          rejectionMessage:
            "The selected agent session could not start this run.",
          onSettled: (outcome) => {
            const status =
              outcome.status === "completed"
                ? "succeeded"
                : outcome.status === "cancelled"
                  ? "cancelled"
                  : "failed";
            void updateAutomationRun(run.id, status, {
              sessionId: session.id,
              ...(outcome.error ? { error: outcome.error } : {}),
            })
              .catch(() => undefined)
              .finally(releaseReservation);
          },
        });
      } catch (reason: unknown) {
        await updateAutomationRun(run.id, "failed", {
          error: reason instanceof Error ? reason.message : String(reason),
        }).catch(() => undefined);
        throw reason;
      } finally {
        if (!releaseAfterSettle) releaseReservation();
      }
    },
    [appendTab, focusOpenSession, submitSession],
  );

  // Held runs go once their hold ends, or right away on Run anyway.
  useEffect(() => {
    const drain = () => {
      for (const item of usageLimitRegistry.takeReadyWork()) {
        const held = heldAutomationRuns.current.get(item.id);
        heldAutomationRuns.current.delete(item.id);
        if (!held) continue;
        void launchAutomation(
          held.automation,
          held.run,
          false,
          held.prompt,
          held.sourceWorkItem,
          true,
        ).catch(() => undefined);
      }
    };
    drain();
    return usageLimitRegistry.subscribe(drain);
  }, [launchAutomation]);

  const queueIrgatSessionCompletion = useCallback(
    async (
      irgatId: string,
      message: QueuedMessage,
      current: () => QueuedMessage | undefined = () => message,
    ) => {
      if (!isIrgatSession(irgatId) || removingSessionIds.current.has(irgatId))
        return;
      if (
        !(await ensureOpenSession(irgatId)) ||
        removingSessionIds.current.has(irgatId)
      )
        return;
      setSessions((previous) => {
        const latest = current();
        return latest
          ? previous.map((session) =>
              session.id === irgatId
                ? enqueueIrgatSessionCompletion(session, latest)
                : session,
            )
          : previous;
      });
    },
    [ensureOpenSession],
  );
  const queueIrgatSessionCompletionRef = useRef(queueIrgatSessionCompletion);
  queueIrgatSessionCompletionRef.current = queueIrgatSessionCompletion;
  const irgatCompletionBatches = useRef<IrgatSessionCompletionBatches | null>(
    null,
  );
  if (!irgatCompletionBatches.current) {
    irgatCompletionBatches.current = new IrgatSessionCompletionBatches(
      (irgatId, message, current) =>
        queueIrgatSessionCompletionRef.current(irgatId, message, current),
    );
  }
  useEffect(() => {
    irgatCompletionBatches.current!.closeInactive(({ irgatId, turn }) => {
      const irgat = sessionsRef.current.find((session) => session.id === irgatId);
      return !!irgat?.busy && turnGen.current.get(irgatId) === turn;
    });
  }, [sessions]);

  const launchQuickSession = useCallback(
    (
      launch: QuickLaunch,
      deliveryId: string,
      placement?: AppSessionPlacement,
      onSettled?: (outcome: ControlOutcome) => void,
      openTab?: boolean,
    ) =>
      acceptQuickLaunch(
        launch,
        deliveryId,
        {
          getSessions: () => sessionsRef.current,
          updateSessions: (update) => {
            sessionsRef.current = update(sessionsRef.current);
            // Compose with submission's queued transcript updates.
            setSessions(update);
          },
          appendTab,
          placeSession: (sessionId, target, cwd) => {
            const anchor = sessionsRef.current.find(
              (session) => session.id === target.besideSessionId,
            );
            const tab = tabsRef.current.find((entry) =>
              leafIds(entry.layout).includes(target.besideSessionId),
            );
            if (!anchor || !sameProjectPath(anchor.cwd, cwd) || !tab)
              throw new Error("The target session must be open in this project");
            const nextTabs = tabsRef.current.map((entry) =>
              entry.id === tab.id
                ? {
                    ...entry,
                    layout: splitPane(
                      entry.layout,
                      target.besideSessionId,
                      target.direction,
                      sessionId,
                    ),
                    focusedId: launch.reveal ? sessionId : entry.focusedId,
                    diffFocused: launch.reveal ? false : entry.diffFocused,
                  }
                : entry,
            );
            tabsRef.current = nextTabs;
            setTabs(nextTabs);
            return tab.id;
          },
          setProjectCwd,
          setRecents,
          revealTab: (id, cwd) => {
            setActiveTabId(id);
            setComposerFocused(false);
            setSearchViewOpen(false);
            setInboxViewOpen(false);
            setNotesViewOpen(false);
            setAutomationsViewOpen(false);
            setKanbanViewOpen(false);
            setFleetViewOpen(false);
            setSidebarTab("sessions", cwd);
          },
          submit: (id, text, attachments, options) =>
            onSettled
              ? submitWithSettlement({
                  submit: (settle) =>
                    submitSession(id, text, attachments, {
                      ...options,
                      appRequestId: deliveryId,
                      onSettled: settle,
                    }),
                  onSettled,
                  rejectionMessage: "The monitored session could not start.",
                })
              : submitSession(id, text, attachments, options),
          saveDraft: (id, prompt, attachments, requestId) =>
            flushSync(() => onSaveDraft(id, prompt, attachments, requestId)),
        },
        placement,
        openTab,
      ),
    [appendTab, submitSession, onSaveDraft],
  );
  useQuickComposerLaunches(launchQuickSession);
  const launchQuickSessionRef = useRef(launchQuickSession);
  launchQuickSessionRef.current = launchQuickSession;
  const submitSessionRef = useRef(submitSession);
  submitSessionRef.current = submitSession;
  const saveDraftRef = useRef(onSaveDraft);
  saveDraftRef.current = onSaveDraft;
  const ensureOpenSessionRef = useRef(ensureOpenSession);
  ensureOpenSessionRef.current = ensureOpenSession;

  const appReceipts = useRef(
    new Map<string, { signature: string; promise: Promise<unknown> }>(),
  );

  const ensureAutomationRecovery = useCallback(() => {
    if (!automationRecoveryRef.current) {
      const recovery = (async () => {
        const pending = await recoverAutomationRuns(
          automationRecoveryCutoffRef.current,
        );
        for (const item of pending) {
          await launchAutomation(
            item.automation,
            item.run,
            false,
            item.run.prompt ?? item.automation.prompt,
          ).catch(() => undefined);
        }
      })();
      automationRecoveryRef.current = recovery.catch((error: unknown) => {
        automationRecoveryRef.current = null;
        throw error;
      });
    }
    return automationRecoveryRef.current;
  }, [launchAutomation]);

  useEffect(() => {
    let disposed = false;
    let evaluating = false;
    const evaluate = async () => {
      if (disposed || evaluating) return;
      evaluating = true;
      try {
        await ensureAutomationRecovery();
        const due = await claimDueAutomations();
        for (const item of due) {
          if (disposed) break;
          void launchAutomation(item.automation, item.run).catch(() => undefined);
        }
      } catch {
        // Scheduling retries on the next tick; individual claimed runs record
        // launch failures in launchAutomation.
      } finally {
        evaluating = false;
      }
    };
    void evaluate();
    const timer = window.setInterval(() => void evaluate(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void evaluate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ensureAutomationRecovery, launchAutomation]);

  const onInboxAppeared = useCallback(
    (items: Parameters<typeof claimInboxAutomationRuns>[0]) => {
      void ensureAutomationRecovery()
        .then(() => claimInboxAutomationRuns(items))
        .then((due) => {
          for (const item of due) {
            void launchAutomation(
              item.automation,
              item.run,
              false,
              item.prompt,
              item.linkedWorkItem,
            ).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    },
    [ensureAutomationRecovery, launchAutomation],
  );

  const onUpdatePlan = useCallback(
    (sessionId: string, blockId: string, text: string) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (remoteProjectFor(session.cwd)) return session;
          if (session.id !== sessionId || session.busy) return session;
          return {
            ...session,
            blocks: session.blocks.map((block) => {
              if (
                block.id !== blockId ||
                block.role !== "plan" ||
                block.plan?.status === "streaming" ||
                block.plan?.status === "building" ||
                block.plan?.status === "built"
              ) {
                return block;
              }
              const originalText = block.plan?.originalText ?? block.text;
              return {
                ...block,
                text,
                plan: {
                  ...(block.plan ?? { status: "ready" as const }),
                  status: "ready" as const,
                  originalText,
                  edited: text !== originalText,
                },
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const onBuildPlan = useCallback(
    (sessionId: string, blockId: string, target?: PlanBuildTarget) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (session && remoteProjectFor(session.cwd)) {
        buildRemotePlan(sessionId, blockId, target);
        return;
      }
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (
        !session ||
        session.busy ||
        block?.role !== "plan" ||
        !!block.orchestration ||
        !block.text.trim() ||
        block.plan?.status === "streaming" ||
        block.plan?.status === "building" ||
        block.plan?.status === "built"
      ) {
        return;
      }
      if (target && session.modelSettings) {
        saveLastModelSettings(session.modelSettings, "fill");
      }
      onSubmit(sessionId, "Build approved plan", [], {
        intent: "build",
        planBlockId: blockId,
        buildTarget: target,
      });
    },
    [onSubmit],
  );

  useEffect(() => {
    const timers: number[] = [];
    const scheduled = new Set<string>();
    for (const session of sessions) {
      const queued = session.queuedMessages ?? [];
      if (queued.length === 0) continue;

      if (!session.busy && session.queueStatus === "resuming") {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id ? { ...entry, queueStatus: "active" } : entry,
          ),
        );
        continue;
      }
      // Its provider is out of quota: the prompt waits for the reset.
      if (!session.busy && providerOnHold(session)) continue;
      if (
        !(
          canDispatchQueuedHead(session) ||
          (irgatForSession(session.id) &&
            canSteerQueuedHead(session) &&
            canSteerHarness(session.harness) &&
            !consumeOperatorCommand(queued[0].text).matched)
        ) ||
        queueDispatchingRef.current.has(session.id)
      ) {
        continue;
      }

      const next = queued[0];
      if (!next) continue;
      queueDispatchingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(async () => {
          scheduled.delete(session.id);
          const latest = sessionsRef.current.find(
            (entry) => entry.id === session.id,
          );
          const head = latest?.queuedMessages?.[0];
          if (
            !latest ||
            !head ||
            head.id !== next.id ||
            (!latest.busy && providerOnHold(latest)) ||
            !(
              canDispatchQueuedHead(latest) ||
              (irgatForSession(latest.id) &&
                canSteerQueuedHead(latest) &&
                canSteerHarness(latest.harness) &&
                !consumeOperatorCommand(head.text).matched)
            )
          ) {
            queueDispatchingRef.current.delete(session.id);
            return;
          }
          const steering = latest.busy;
          if (steering)
            setSessions((prev) =>
              prev.map((entry) =>
                entry.id === session.id
                  ? { ...entry, sendingQueuedMessageId: head.id }
                  : entry,
              ),
            );
          try {
            const accepted = await submitSession(
              session.id,
              head.text,
              head.attachments,
              {
                queuedMessageId: head.id,
                followUpBehavior: steering ? "steer" : undefined,
                noteCard: head.noteCard,
                handoffCard: head.handoffCard,
                intent: head.intent,
                ...(head.irgatSessionCompletion
                  ? {
                      irgatSessionCompletion: head.irgatSessionCompletion,
                      appRequestId: head.id,
                    }
                  : {}),
              },
            );
            // A preflight rejection must not repeatedly retry or hide the message.
            if (!accepted && irgatForSession(session.id)) {
              const current = sessionsRef.current.find(
                (entry) => entry.id === session.id,
              );
              if (
                current &&
                (steering
                  ? canSteerQueuedHead(current)
                  : canDispatchQueuedHead(current)) &&
                current.queuedMessages?.[0] === head
              ) {
                setSessions((prev) =>
                  prev.map((entry) =>
                    entry.id === session.id
                      ? {
                          ...entry,
                          queueStatus: "paused",
                          queuedMessages: entry.queuedMessages?.map((message) =>
                            message.id === head.id
                              ? {
                                  ...message,
                                  error:
                                    "Delivery is unavailable. Retry when the agent is ready.",
                                }
                              : message,
                          ),
                        }
                      : entry,
                  ),
                );
              }
            }
            if (accepted || steering)
              setQueueDispatchVersion((value) => value + 1);
          } catch (error) {
            setSessions((prev) =>
              prev.map((entry) =>
                entry.id === session.id
                  ? {
                      ...entry,
                      queueStatus: "paused",
                      queuedMessages: entry.queuedMessages?.map((message) =>
                        message.id === head.id
                          ? {
                              ...message,
                              error:
                                error instanceof Error
                                  ? error.message
                                  : String(error),
                            }
                          : message,
                      ),
                    }
                  : entry,
              ),
            );
          } finally {
            queueDispatchingRef.current.delete(session.id);
            if (steering)
              setSessions((prev) =>
                prev.map((entry) =>
                  entry.id === session.id
                    ? { ...entry, sendingQueuedMessageId: undefined }
                    : entry,
                ),
              );
          }
        }, 0),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) queueDispatchingRef.current.delete(id);
    };
  }, [submitSession, sessions, queueDispatchVersion, usageLimitSnapshot]);

  const onDeleteQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? dequeueQueuedMessage(session, messageId)
            : session,
        ),
      );
    },
    [],
  );

  const onQueuedMessageEditingChange = useCallback(
    (sessionId: string, messageId?: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, editingQueuedMessageId: messageId }
            : session,
        ),
      );
    },
    [],
  );

  const onEditQueuedMessage = useCallback(
    (sessionId: string, messageId: string, text: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                queuedMessages: session.queuedMessages?.map((message) =>
                  message.id === messageId
                    ? { ...message, text, error: undefined }
                    : message,
                ),
                editingQueuedMessageId: undefined,
              }
            : session,
        ),
      );
    },
    [],
  );

  const onSteerQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      const message = session
        ? queuedMessageForSubmit(session, messageId, "steer")
        : undefined;
      if (!session || !message) return;
      if (message.intent === "orchestrate" && session.busy) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Orchestration planning will start after the current turn finishes.",
        });
        flushHarnessEvents();
        return;
      }
      onSubmit(sessionId, message.text, message.attachments, {
        followUpBehavior: "steer",
        queuedMessageId: message.id,
        noteCard: message.noteCard,
        handoffCard: message.handoffCard,
        intent: message.intent,
      });
    },
    [onSubmit, enqueueHarnessEvent, flushHarnessEvents],
  );

  const onResumeQueue = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (
        !session ||
        (session.busy && !irgatForSession(sessionId)) ||
        session.queueStatus !== "paused" ||
        !session.queuedMessages?.length
      ) {
        return;
      }
      if (irgatForSession(sessionId)) {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId
              ? entry.usageLimit
                ? resumeIrgatUsageLimit(entry)
                : {
                    ...entry,
                    queueStatus: "active",
                    queuedMessages: entry.queuedMessages?.map((message) => ({
                      ...message,
                      error: undefined,
                    })),
                  }
              : entry,
          ),
        );
        return;
      }
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId ? { ...entry, queueStatus: "resuming" } : entry,
        ),
      );
      onSubmit(sessionId, CONTINUE_PROMPT, [], {
        followUpBehavior: "steer",
      });
    },
    [onSubmit],
  );

  const onUsageLimitDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.usageLimit
          ? { ...session, usageLimit: undefined }
          : session,
      ),
    );
  }, []);

  const onUsageLimitResumeAtReset = useCallback(
    (sessionId: string, enabled: boolean) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId && session.usageLimit
            ? {
                ...session,
                usageLimit: { ...session.usageLimit, resumeAtReset: enabled },
              }
            : session,
        ),
      );
    },
    [],
  );

  const onUsageLimitResume = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session?.usageLimit || session.busy) return;
      usageLimitRegistry.release(
        session.harness,
        holdAccountId(session.harness, session.providerAccountId, session.cwd),
      );
      if (isIrgatSession(sessionId)) {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId ? resumeIrgatUsageLimit(entry) : entry,
          ),
        );
        return;
      }
      // Held prompts are the work to resume: send them rather than Continue.
      if (session.queuedMessages?.length) {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId ? resumeUsageLimitedSession(entry) : entry,
          ),
        );
        return;
      }
      onUsageLimitDismiss(sessionId);
      onSubmit(sessionId, CONTINUE_PROMPT);
    },
    [onSubmit, onUsageLimitDismiss],
  );

  // Every usage limit a session runs into holds its provider for all of them.
  const heldUsageLimits = useRef(new WeakSet<UsageLimit>());
  useEffect(() => {
    const armed = new Set<string>();
    for (const session of sessions) {
      const limit = session.usageLimit;
      if (!limit || heldUsageLimits.current.has(limit)) continue;
      heldUsageLimits.current.add(limit);
      const hold = usageLimitRegistry.hold({
        harness: session.harness,
        accountId: holdAccountId(
          session.harness,
          session.providerAccountId,
          session.cwd,
        ),
        resetAt: limit.resetsAt,
        source: "session",
        sessionId: session.id,
      });
      // Unattended or queued work fires on its own once the window resets.
      if (
        hold &&
        limit.resumeAtReset == null &&
        !session.ephemeral &&
        (session.automationId || session.queuedMessages?.length)
      )
        armed.add(session.id);
    }
    if (!armed.size) return;
    setSessions((prev) =>
      prev.map((entry) => {
        const limit = entry.usageLimit;
        if (!armed.has(entry.id) || !limit || limit.resumeAtReset != null)
          return entry;
        const resetsAt =
          limit.resetsAt ??
          usageLimitRegistry.get(
            entry.harness,
            holdAccountId(entry.harness, entry.providerAccountId, entry.cwd),
          )?.resetAt;
        return {
          ...entry,
          usageLimit: {
            ...limit,
            resumeAtReset: true,
            ...(resetsAt != null ? { resetsAt } : {}),
          },
        };
      }),
    );
  }, [sessions]);

  // An exhausted usage meter holds its provider too, with the exact reset.
  useEffect(() => {
    const sync = () => usageLimitRegistry.syncQuota(getAllRateLimits());
    sync();
    return subscribeRateLimits(sync);
  }, []);

  const onResumeInterrupted = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session || session.busy) return;
      const plan = planSessionResume(session, isLiveHarness(session.harness));
      if (!plan) return;
      if (plan.releaseQueue) {
        // Like Resume queue: the paused follow-ups go once this turn ends.
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === sessionId
              ? {
                  ...entry,
                  queueStatus: "resuming",
                  queuedMessages: entry.queuedMessages?.map((message) => ({
                    ...message,
                    error: undefined,
                  })),
                }
              : entry,
          ),
        );
      }
      onSubmit(
        sessionId,
        plan.prompt,
        plan.attachments,
        plan.context ? { resumeContext: plan.context } : undefined,
      );
    },
    [onSubmit],
  );

  const onDismissInterrupted = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? dismissSessionInterruption(session) : session,
      ),
    );
  }, []);

  const onRunQueueAnyway = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const hold = sessionProviderHold(session);
        return hold ? { ...session, queueHoldOverride: hold.since } : session;
      }),
    );
  }, []);

  const onUsageLimitAccountChange = useCallback(
    (sessionId: string, accountId: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (
        !session ||
        !isIrgatSession(sessionId) ||
        !supportsProviderAccounts(session.harness) ||
        !providerAccountExists(session.harness, accountId)
      )
        return;
      setSessions((prev) =>
        prev.map((entry) =>
          entry.id === sessionId
            ? switchIrgatUsageLimitAccount(entry, accountId)
            : entry,
        ),
      );
    },
    [],
  );

  const [usageLimitTick, setUsageLimitTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const timers: number[] = [];
    const scheduled = new Set<string>();
    let nextCheck = Number.POSITIVE_INFINITY;
    for (const session of sessions) {
      const limit = session.usageLimit;
      if (!limit?.resumeAtReset || limit.resetsAt == null) continue;
      if (!usageLimitResumeDue(session, now)) {
        nextCheck = Math.min(
          nextCheck,
          limit.resetsAt + USAGE_LIMIT_RESUME_GRACE_MS - now,
        );
        continue;
      }
      if (usageResumingRef.current.has(session.id)) continue;
      usageResumingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          usageResumingRef.current.delete(session.id);
          const latest = sessionsRef.current.find(
            (entry) => entry.id === session.id,
          );
          if (latest && usageLimitResumeDue(latest, Date.now())) {
            onUsageLimitResume(session.id);
          }
        }, 0),
      );
    }
    if (Number.isFinite(nextCheck)) {
      // Re-check every minute at most: timers drift while the machine sleeps.
      timers.push(
        window.setTimeout(
          () => setUsageLimitTick((tick) => tick + 1),
          Math.max(1_000, Math.min(nextCheck, 60_000)),
        ),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) usageResumingRef.current.delete(id);
    };
  }, [onUsageLimitResume, sessions, usageLimitTick]);

  // The stream does not always say when the limit resets; ask the provider.
  useEffect(() => {
    for (const session of sessions) {
      const limit = session.usageLimit;
      if (!limit || limit.resetsAt != null) continue;
      if (usageResetLookups.current.has(limit)) continue;
      const fetchLimits =
        session.harness === "claude"
          ? fetchClaudeRateLimits
          : session.harness === "codex"
            ? fetchCodexRateLimits
            : undefined;
      if (!fetchLimits) continue;
      usageResetLookups.current.add(limit);
      void fetchLimits(session.providerAccountId).then((limits) => {
        const resetsAt = exhaustedWindowResetAt(limits);
        if (resetsAt == null) return;
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id && entry.usageLimit === limit
              ? { ...entry, usageLimit: { ...limit, resetsAt } }
              : entry,
          ),
        );
      });
    }
  }, [sessions]);

  const openSessionBeside = useCallback(
    (sourceId: string, session: Session, cwd: string, focusComposer = false) => {
      const nextSessions = [...sessionsRef.current, session];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);

      const tab = tabsRef.current.find((entry) =>
        leafIds(entry.layout).includes(sourceId),
      );
      if (tab) {
        const nextTabs = tabsRef.current.map((entry) =>
          entry.id === tab.id
            ? {
                ...entry,
                layout: splitPane(entry.layout, sourceId, "right", session.id),
                focusedId: session.id,
                diffFocused: false,
              }
            : entry,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        if (tab.id !== activeTabIdRef.current) setActiveTabId(tab.id);
      } else {
        const nextTab = newTab(session.id);
        appendTab(nextTab, cwd);
        setActiveTabId(nextTab.id);
      }

      setProjectTerminalFocused(false);
      setComposerFocused(focusComposer);
    },
    [appendTab],
  );

  /**
   * A pane header's "New chat beside": a new chat on the Irgat or Chat page,
   * or a new session in the pane's project, split right of it.
   */
  const onNewSessionBeside = useCallback(
    (sourceId: string) => {
      if (sidePaneKeyRef.current) {
        newChatBesideRef.current();
        return;
      }
      const source = sessionsRef.current.find(
        (session) => session.id === sourceId,
      );
      if (!source) return;
      const session = newDefaultSession(
        source.cwd,
        sessionDefaults?.runtimeMode,
      );
      openSessionBeside(sourceId, session, source.cwd, true);
    },
    [openSessionBeside, sessionDefaults?.runtimeMode],
  );

  const onSecondOpinion = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sourceId,
      );
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const request = buildSecondOpinionRequest({
        from,
        to: harness,
        turn,
        cwd,
      });
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        worktreeCwd: source.worktreeCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(
          resolveModel(harness, model),
          modelSettings,
        ),
        title: formatSessionTitle(harness, SECOND_OPINION_TITLE),
      };
      openSessionBeside(sourceId, session, source.cwd);
      onSubmit(session.id, request.prompt, [], request.options);
    },
    [onSubmit, openSessionBeside],
  );
  const updateBtwThread = useCallback(
    (
      sessionId: string,
      userBlockId: string,
      threadId: string,
      update: (thread: BtwThread | undefined) => BtwThread | undefined,
    ): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const current = block.btwThreads?.find(
          (thread) => thread.id === threadId,
        );
        const nextThread = update(current);
        if (!nextThread) return session;
        const nextBlock = current
          ? replaceBtwThread(block, nextThread)
          : {
              ...block,
              btwThreads: [...(block.btwThreads ?? []), nextThread],
            };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const removeBtwThread = useCallback(
    (
      sessionId: string,
      userBlockId: string,
      threadId: string,
    ): Session | undefined => {
      const previous = sessionsRef.current;
      let updatedSession: Session | undefined;
      const next = previous.map((session) => {
        if (session.id !== sessionId) return session;
        const blockIndex = session.blocks.findIndex(
          (block) => block.id === userBlockId && block.role === "user",
        );
        if (blockIndex < 0) return session;
        const block = session.blocks[blockIndex];
        const threads = block.btwThreads ?? [];
        if (!threads.some((thread) => thread.id === threadId)) return session;
        const nextThreads = threads.filter((thread) => thread.id !== threadId);
        const nextBlock = {
          ...block,
          btwThreads: nextThreads.length > 0 ? nextThreads : undefined,
        };
        const blocks = session.blocks.slice();
        blocks[blockIndex] = nextBlock;
        updatedSession = { ...session, blocks };
        return updatedSession;
      });
      if (!updatedSession) return undefined;
      sessionsRef.current = next;
      setSessions(next);
      persistSession(updatedSession);
      return updatedSession;
    },
    [persistSession],
  );

  const runBtwRequest = useCallback(
    (input: {
      sessionId: string;
      userBlockId: string;
      source: Session;
      thread: BtwThread;
      harness: HarnessId;
    }) => {
      const harness = input.harness;
      if (!supportsBtwHarness(harness)) return;
      const cwd = sessionWorkCwd(input.source);
      const model = nativeModelId(
        input.thread.model ?? input.source.model,
      ).trim();
      if (!cwd || cwd === "~") {
        updateBtwThread(
          input.sessionId,
          input.userBlockId,
          input.thread.id,
          (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  error:
                    "A project working directory is required for this question.",
                }
              : undefined,
        );
        return;
      }
      if (!model && harness === "codex") {
        updateBtwThread(
          input.sessionId,
          input.userBlockId,
          input.thread.id,
          (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  error: "The selected Codex model is unavailable.",
                }
              : undefined,
        );
        return;
      }

      let prompt: string;
      try {
        prompt = buildBtwPrompt({
          blocks: input.source.blocks,
          thread: input.thread,
          cwd,
        });
      } catch (error) {
        updateBtwThread(
          input.sessionId,
          input.userBlockId,
          input.thread.id,
          (thread) =>
            thread
              ? {
                  ...thread,
                  status: "error",
                  updatedAt: Date.now(),
                  error:
                    error instanceof Error
                      ? error.message
                      : "The completed turn is no longer available.",
                }
              : undefined,
        );
        return;
      }

      const key = `${input.sessionId}:${input.thread.id}`;
      btwRequestsRef.current.get(key)?.controller.abort();
      const controller = new AbortController();
      btwRequestsRef.current.set(key, {
        sessionId: input.sessionId,
        controller,
      });

      const userMessageId =
        input.thread.messages[input.thread.messages.length - 1]?.id ??
        input.thread.id;
      const responseModel = model || input.source.model;

      void runHarnessTextPrompt({
        harness,
        cwd,
        providerAccountId: input.source.providerAccountId,
        model: model || undefined,
        modelSettings: input.thread.modelSettings ?? input.source.modelSettings,
        ephemeral: false,
        codexStore: isIrgatSession(input.source.id) ? "irgat" : undefined,
        threadId: input.thread.providerThreadId,
        onThreadId: (providerThreadId) => {
          if (controller.signal.aborted) return;
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) =>
              thread && thread.providerThreadId !== providerThreadId
                ? {
                    ...thread,
                    providerThreadId,
                    updatedAt: Date.now(),
                  }
                : thread,
          );
        },
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) =>
              thread?.status === "running"
                ? {
                    ...thread,
                    updatedAt: Date.now(),
                    pendingBlocks: applyBtwHarnessEvent(
                      thread.pendingBlocks ?? [],
                      event,
                      harness,
                      responseModel,
                      userMessageId,
                    ),
                  }
                : undefined,
          );
        },
        intent: "plan",
        prompt,
        signal: controller.signal,
      })
        .then((output) => {
          if (controller.signal.aborted) return;
          const text = output.trim();
          if (!text) {
            throw new Error(
              `${HARNESS_TITLE[harness]} returned an empty side answer.`,
            );
          }
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) => {
              if (!thread) return undefined;
              const pendingBlocks = thread.pendingBlocks ?? [];
              const blocks =
                pendingBlocks.length > 0
                  ? sealBtwResponseBlocks(
                      pendingBlocks,
                      harness,
                      responseModel,
                      userMessageId,
                    )
                  : undefined;
              return {
                ...thread,
                status: "ready",
                updatedAt: Date.now(),
                pendingBlocks: undefined,
                messages: [
                  ...thread.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    text,
                    createdAt: Date.now(),
                    ...(blocks?.length ? { blocks } : {}),
                  },
                ],
                error: undefined,
              };
            },
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message =
            error instanceof Error
              ? error.message
              : `${HARNESS_TITLE[harness]} could not answer this side question.`;
          updateBtwThread(
            input.sessionId,
            input.userBlockId,
            input.thread.id,
            (thread) =>
              thread
                ? {
                    ...thread,
                    status: "error",
                    updatedAt: Date.now(),
                    pendingBlocks: undefined,
                    error: message,
                  }
                : undefined,
          );
        })
        .finally(() => {
          if (btwRequestsRef.current.get(key)?.controller === controller) {
            btwRequestsRef.current.delete(key);
          }
        });
    },
    [updateBtwThread],
  );

  const onBtwSubmit = useCallback(
    (
      sessionId: string,
      turn: Block[],
      threadId: string,
      messageId: string,
      text: string,
      model?: string,
      modelSettings?: Record<string, string>,
    ) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const sourceEndBlockId = turn[turn.length - 1]?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const turnModel = turn.find((block) => block.role === "user")?.turnModel
        ?.id;
      const sourceBlockEarly = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const existingEarly = sourceBlockEarly?.btwThreads?.find(
        (thread) => thread.id === threadId,
      );
      const requestHarness = source
        ? supportsBtwHarness(turnHarness)
          ? turnHarness
          : (existingEarly?.harness ??
            btwTurnHarness(source.blocks, turn, source.harness))
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(requestHarness) ||
        source.worktreeRemoved ||
        !sourceUserId ||
        !sourceEndBlockId
      ) {
        return false;
      }
      const sourceBlock = sourceBlockEarly;
      if (!sourceBlock) return false;
      const existing = existingEarly;
      const selectedModel =
        model?.trim() ||
        existing?.model ||
        turnModel ||
        nativeModelId(source.model).trim();
      const selectedModelSettings =
        modelSettings ??
        existing?.modelSettings ??
        preferredModelSettings(
          resolveModel(requestHarness!, selectedModel || source.model),
          source.modelSettings,
        );
      if (existing?.status === "running") return false;
      if (existing && existing.sourceEndBlockId !== sourceEndBlockId) {
        return false;
      }
      const now = Date.now();
      const thread: BtwThread = existing
        ? {
            ...existing,
            harness: existing.harness ?? turnHarness,
            model: selectedModel || undefined,
            modelSettings: selectedModelSettings,
            status: "running",
            updatedAt: now,
            error: undefined,
            pendingBlocks: [],
            messages: [
              ...existing.messages,
              { id: messageId, role: "user", text, createdAt: now },
            ],
          }
        : {
            id: threadId,
            sourceEndBlockId,
            createdAt: now,
            updatedAt: now,
            status: "running",
            pendingBlocks: [],
            harness: requestHarness,
            ...(selectedModel ? { model: selectedModel } : {}),
            modelSettings: selectedModelSettings,
            messages: [{ id: messageId, role: "user", text, createdAt: now }],
          };
      const updated = updateBtwThread(
        sessionId,
        sourceUserId,
        threadId,
        () => thread,
      );
      if (!updated) return false;
      runBtwRequest({
        sessionId,
        userBlockId: sourceUserId,
        source,
        thread,
        harness: thread.harness ?? requestHarness!,
      });
      return true;
    },
    [runBtwRequest, updateBtwThread],
  );

  const onBtwModelChange = useCallback(
    (
      sessionId: string,
      turn: Block[],
      threadId: string,
      model: string,
      modelSettings: Record<string, string>,
    ) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const nextModel = model.trim();
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const threadHarness = source
        ? (sourceBlock?.btwThreads?.find((thread) => thread.id === threadId)
            ?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId ||
        !nextModel
      ) {
        return;
      }
      updateBtwThread(sessionId, sourceUserId, threadId, (thread) =>
        thread
          ? {
              ...thread,
              model: nextModel,
              modelSettings,
              updatedAt: Date.now(),
            }
          : undefined,
      );
    },
    [updateBtwThread],
  );

  const onBtwDelete = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const threadHarness = source
        ? (sourceBlock?.btwThreads?.find((thread) => thread.id === threadId)
            ?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId
      ) {
        return;
      }
      const requestKey = `${sessionId}:${threadId}`;
      btwRequestsRef.current.get(requestKey)?.controller.abort();
      btwRequestsRef.current.delete(requestKey);
      removeBtwThread(sessionId, sourceUserId, threadId);
    },
    [removeBtwThread],
  );

  // Stopping keeps whatever the side answer had streamed, like stopping a
  // main turn, and leaves the thread ready for the next question.
  const onBtwStop = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      if (!sourceUserId) return;
      const key = `${sessionId}:${threadId}`;
      btwRequestsRef.current.get(key)?.controller.abort();
      btwRequestsRef.current.delete(key);
      updateBtwThread(sessionId, sourceUserId, threadId, (thread) => {
        if (!thread || thread.status !== "running") return thread;
        const harness = thread.harness;
        const userMessageId =
          thread.messages[thread.messages.length - 1]?.id ?? thread.id;
        const pending = thread.pendingBlocks ?? [];
        const blocks =
          pending.length > 0 && harness
            ? sealBtwResponseBlocks(
                pending,
                harness,
                thread.model ?? "",
                userMessageId,
              )
            : [];
        const text = blocks
          .filter((block) => block.role === "assistant")
          .map((block) => block.text)
          .join("\n\n")
          .trim();
        const now = Date.now();
        return {
          ...thread,
          status: "ready",
          updatedAt: now,
          pendingBlocks: undefined,
          error: undefined,
          messages: blocks.length
            ? [
                ...thread.messages,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text,
                  createdAt: now,
                  blocks,
                },
              ]
            : thread.messages,
        };
      });
    },
    [updateBtwThread],
  );

  const onBtwRetry = useCallback(
    (sessionId: string, turn: Block[], threadId: string) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const sourceUserId = turn.find((block) => block.role === "user")?.id;
      const turnHarness = source
        ? harnessForTurn(source.blocks, turn, source.harness)
        : undefined;
      const sourceBlock = source?.blocks.find(
        (block) => block.id === sourceUserId && block.role === "user",
      );
      const existing = sourceBlock?.btwThreads?.find(
        (thread) => thread.id === threadId,
      );
      const threadHarness = source
        ? (existing?.harness ??
          btwTurnHarness(source.blocks, turn, source.harness) ??
          turnHarness)
        : undefined;
      if (
        !source ||
        !supportsBtwHarness(threadHarness) ||
        source.worktreeRemoved ||
        !sourceUserId
      ) {
        return;
      }
      if (!sourceBlock || !existing || existing.status !== "error") return;
      const thread: BtwThread = {
        ...existing,
        status: "running",
        updatedAt: Date.now(),
        error: undefined,
        pendingBlocks: [],
      };
      const updated = updateBtwThread(
        sessionId,
        sourceUserId,
        threadId,
        () => thread,
      );
      if (!updated) return;
      runBtwRequest({
        sessionId,
        userBlockId: sourceUserId,
        source: updated,
        thread,
        harness: thread.harness ?? threadHarness!,
      });
    },
    [runBtwRequest, updateBtwThread],
  );

  const onHandoff = useCallback(
    (sourceId: string, target: ModelTarget, turn: Block[]) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sourceId,
      );
      if (!source || source.worktreeRemoved) return;
      const { harness, model, modelSettings } = target;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const sliced = sessionThroughTurn(source, turn);
      const userRequest = turnUserRequest(turn);
      const files = turnEditedFiles(sliced.blocks, cwd);
      const display = sessionDisplayTitle(source.title, source.harness);
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        worktreeCwd: source.worktreeCwd,
        branch: source.branch,
        modelSettings: mergeModelSettings(
          resolveModel(harness, model),
          modelSettings,
        ),
        title: formatSessionTitle(
          harness,
          display === "New session" ? HANDOFF_TITLE : display,
        ),
        handoffCard: buildHandoffComposerCard({
          from,
          to: harness,
          brief: buildDeterministicHandoff(sliced),
          userRequest,
          files,
        }),
      };
      openSessionBeside(sourceId, session, source.cwd, true);
    },
    [openSessionBeside],
  );

  const autoContinueKey = sessions
    .filter(
      (session) => canAutoContinue(session) && isLiveHarness(session.harness),
    )
    .map((session) => session.id)
    .join("\n");

  useEffect(() => {
    if (!autoContinueKey) return;
    const ids = autoContinueKey.split("\n");
    // Delay past React StrictMode's dev remount so Continue is not claimed
    // against a discarded tree (sessionStorage also survives Vite reloads).
    const timer = window.setTimeout(() => {
      for (const id of ids) {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (
          !session ||
          !canAutoContinue(session) ||
          !isLiveHarness(session.harness)
        ) {
          continue;
        }
        onSubmit(id, CONTINUE_PROMPT);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoContinueKey, onSubmit]);

  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (current && remoteProjectFor(current.cwd))
        return remoteSessionActions(sessionId)?.compact() ?? false;
      if (!current || current.busy || current.worktreeRemoved) return false;
      if (!canCompactHarnessContext(current.harness)) {
        const unsupported = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? applyHarnessEvent(session, {
                type: "status",
                text: `${HARNESS_TITLE[current.harness]} does not support manual context compaction.`,
              })
            : session,
        );
        sessionsRef.current = unsupported;
        syncDockBadge(unsupported);
        setSessions(unsupported);
        return true;
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const workCwd = sessionWorkCwd(current);
      const started = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? applyHarnessEvent(
              { ...session, busy: true },
              { type: "status", text: "Compacting context…" },
            )
          : session,
      );
      sessionsRef.current = started;
      syncDockBadge(started);
      setSessions(started);

      void (async () => {
        try {
          await compactHarnessContext({
            harness: current.harness,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            providerAccountId: supportsProviderAccounts(current.harness)
              ? (current.providerAccountId ??
                selectedProviderAccountId(current.harness, current.cwd))
              : undefined,
            runtimeMode: current.runtimeMode,
            ephemeral: current.ephemeral === true,
            codexStore: isIrgatSession(sessionId) ? "irgat" : undefined,
            controlsAgents:
              isIrgatSession(sessionId) ||
              operatorEnabledInThread(current.blocks) ||
              orchestrator.run(sessionId)?.status === "active",
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              enqueueHarnessEvent(sessionId, event);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Compacted context",
          });
        } catch (error: unknown) {
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message:
              error instanceof Error
                ? error.message
                : `${current.harness} could not compact this context`,
          });
        } finally {
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          const finished = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, busy: false } : session,
          );
          sessionsRef.current = finished;
          syncDockBadge(finished);
          setSessions(finished);
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onStop = useCallback(
    (sessionId: string, managed = false) => {
      void invoke("computer_use_revoke", { sessionId }).catch(console.error);
      const remote = sessionsRef.current.find((s) => s.id === sessionId);
      if (remote && remoteProjectFor(remote.cwd)) {
        remoteSessionActions(sessionId)?.stop();
        return;
      }
      if (!managed) {
        const stopping = orchestrator.stopForSession(sessionId);
        if (stopping) {
          void stopping.catch(console.error);
          return stopping;
        }
      }
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      const cancelling = Promise.all(
        (session ? sessionChildHarnesses(session) : []).map(async (id) => {
          try {
            await cancelHarnessTurn(id, sessionId);
          } finally {
            await stopHarnessSession(id, sessionId);
          }
        }),
      );
      const checkpointFinished = session
        ? finishSessionTurn(sessionId, sessionWorkCwd(session), {
            after: cancelling.catch(() => undefined),
          })
        : Promise.resolve();
      void cancelling.catch(console.error);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const stopped = stopStreaming(s);
          const completed = isPreparingHandoff(stopped)
            ? completeHandoff(stopped, buildDeterministicHandoff(stopped))
            : stopped;
          const ready = { ...completed, worktreePreparing: undefined };
          return ready.queuedMessages?.length
            ? { ...ready, queueStatus: "paused" }
            : ready;
        }),
      );
      if (session) {
        notifyReviewChanged(sessionId);
        nudgeWorkspace(sessionWorkCwd(session));
        notifyGitChanged();
        nudgeWatchedFiles();
        window.setTimeout(() => nudgeWatchedFiles(), 150);
      } else {
        notifyReviewChanged(sessionId);
      }
      return Promise.all([cancelling, checkpointFinished]);
    },
    [flushHarnessEvents],
  );

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      const focusedBusySessionId = () => {
        const agentId = irgatViewIdRef.current;
        if (agentId) {
          return sessionsRef.current.find((session) => session.id === agentId)
            ?.busy
            ? agentId
            : undefined;
        }
        return focusedBusyAgentSessionId(
          activeTabIdRef.current,
          tabsRef.current,
          sessionsRef.current,
          projectTerminalFocusedRef.current,
        );
      };
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = Boolean(target?.closest(".irgat-terminal"));
      const activeTabId = activeTabIdRef.current;
      const sessionId = focusedBusySessionId();
      if (
        !sessionId ||
        !shouldStopFocusedTurnOnEscape(event, {
          inTerminal,
          focusedSessionBusy: true,
        })
      ) {
        return;
      }

      // Other surfaces (drag/reorder included) can claim Escape later in the
      // same keydown dispatch. Defer the destructive stop until every handler
      // has had a chance to preventDefault, then verify focus did not move.
      deferUnhandledEscape(event, () => {
        const stillFocusedSessionId = focusedBusySessionId();
        if (
          activeTabIdRef.current !== activeTabId ||
          stillFocusedSessionId !== sessionId
        ) {
          return;
        }
        onStop(sessionId);
      });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onStop]);

  const onApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      const projectRequest = session.blocks.find(
        (block) =>
          block.irgatProjectAccess && block.approval?.requestId === requestId,
      );
      if (projectRequest) {
        if (projectRequest.approval?.decided) return;
        const granted =
          decision === "allow" && approveProjectAccess(session, projectRequest);
        decideIrgatBlockRef.current(
          sessionId,
          projectRequest.id,
          granted ? "allow" : decision === "deny" ? "deny" : "cancelled",
        );
        if (granted) {
          const project = projectRequest.irgatProjectAccess!.project;
          appendLiveRef.current(
            sessionId,
            {
              id: crypto.randomUUID(),
              role: "system",
              text: `${projectName(project)} projesine erişim onaylandı.`,
            },
            (latest) => {
              // A newer user request supersedes the work this approval was for.
              if (
                latest.blocks
                  .slice()
                  .reverse()
                  .find((block) => block.role === "user")?.id !==
                projectRequest.irgatProjectAccess?.userTurnId
              )
                return;
              void submitSessionRef.current(
                sessionId,
                `Irgatos: The user approved your access to ${JSON.stringify(project)}. It is now assigned to you. Continue the user's pending request using app sessions.start for requested project agents; do not substitute provider-native subagents.`,
                [],
                { internal: true },
              );
            },
          );
        }
        return;
      }
      // An approval a habit's hidden run asked for, put to the user in the
      // Irgat's chat: answer the run, and settle the question in the chat.
      if (isIrgatSession(sessionId)) {
        const asked = session.blocks.find(
          (block) => block.irgatHabit && block.approval?.requestId === requestId,
        );
        if (asked) {
          const relay = takeRelayedApproval(sessionId, requestId);
          const run = relay
            ? sessionsRef.current.find((s) => s.id === relay.runId)
            : undefined;
          if (relay && run)
            respondHarnessApproval(
              run.harness,
              run.id,
              relay.requestId,
              decision,
            );
          decideIrgatBlockRef.current(
            sessionId,
            asked.id,
            relay && run ? (decision === "deny" ? "deny" : "allow") : "cancelled",
          );
          return;
        }
      }
      if (remoteProjectFor(session.cwd)) {
        remoteSessionActions(sessionId)?.approve(requestId, decision);
        return;
      }
      respondHarnessApproval(session.harness, sessionId, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session || session.worktreeRemoved) return;
      if (remoteProjectFor(session.cwd)) {
        remoteSessionActions(sessionId)?.answer(requestId, reply);
        return;
      }
      respondHarnessQuestion(session.harness, sessionId, requestId, reply);
    },
    [],
  );

  const onQuestionInteraction = useCallback(
    (sessionId: string, requestId: number) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (session && remoteProjectFor(session.cwd)) return;
      if (session && !session.worktreeRemoved)
        keepHarnessQuestionOpen(session.harness, sessionId, requestId);
    },
    [],
  );

  const onOpenApprovalSession = useCallback(
    (sessionId: string) => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open && isFreeChatSession(open)) {
        openFreeChat(sessionId);
        return;
      }
      const parentId =
        open?.orchestrationLeadId ?? orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        if (!focusOpenSession(parentId)) void onSelectHistorySession(parentId);
      } else if (!focusOpenSession(sessionId)) {
        void onSelectHistorySession(sessionId);
      }
    },
    [focusOpenSession, onSelectHistorySession, openFreeChat],
  );

  useEffect(() => {
    setSessions((prev) => attachOrchestrationWorkers(prev, orchestrationRuns));
  }, [orchestrationRuns]);

  useEffect(() => {
    const next = consolidateOrchestrationTabs(
      tabs,
      activeTabId,
      orchestrationRuns,
    );
    if (next.tabs !== tabs) setTabs(next.tabs);
    if (next.activeTabId !== activeTabId) setActiveTabId(next.activeTabId);
  }, [tabs, activeTabId, orchestrationRuns]);

  useLayoutEffect(() => {
    orchestrator.bind({
      session: (id) => sessionsRef.current.find((session) => session.id === id),
      sessions: () => sessionsRef.current,
      choices: () =>
        HARNESSES.filter(isHarnessAvailable).map((harness) => ({
          harness,
          models: modelsFor(harness).map(({ id, name }) => ({ id, name })),
        })),
      createWorker: async (run, task) => {
        const projectCwd = orchestrationProjectCwd(run);
        const leadCheckoutCwd = orchestrationCheckoutCwd(run);
        const lead = sessionsRef.current.find(
          (session) => session.id === run.leadId,
        );
        if (!lead) throw new Error("Lead session is unavailable");
        const workspace =
          task.workspacePolicy === "shared"
            ? workspaceIdentity(projectCwd, leadCheckoutCwd)
            : task.workspace
              ? await listWorktrees(leadCheckoutCwd).then((listed) => {
                  const tree = listed.worktrees.find(
                    (entry) =>
                      pathKey(entry.path) ===
                      pathKey(task.workspace!.checkoutCwd),
                  );
                  if (!tree)
                    throw new Error(
                      "This worker's retained worktree is missing. Its saved changes cannot be retried automatically.",
                    );
                  return workspaceIdentity(
                    projectCwd,
                    tree.path,
                    tree.branch ?? task.workspace!.branch,
                  );
                })
              : await createOrchestrationWorktree(
                  leadCheckoutCwd,
                  orchestrationWorktreeBranchName(task.id),
                ).then((tree) =>
                  workspaceIdentity(
                    projectCwd,
                    tree.path,
                    tree.branch ?? undefined,
                  ),
                );
        const checkoutCwd = workspace.checkoutCwd;
        const scratchDir = await invoke<string>("control_attach_worker", {
          leadId: run.leadId,
          sessionId: task.sessionId,
        });
        const existing = sessionsRef.current.find(
          (session) => session.id === task.sessionId,
        );
        if (existing) {
          if (
            existing.harness !== task.harness ||
            existing.model !== task.model ||
            !sameProjectPath(existing.cwd, projectCwd) ||
            (!existing.worktreeRemoved &&
              !sameProjectPath(sessionWorkCwd(existing), checkoutCwd))
          )
            throw new Error(
              "This worker's configuration changed. Restore its approved harness, model and project before retrying.",
            );
          // The lead's runtime mode governs its agents, including across a
          // change mid-run: auto stays auto, supervised asks the lead.
          const synced = {
            ...existing,
            cwd: projectCwd,
            worktreeCwd: sameProjectPath(projectCwd, checkoutCwd)
              ? undefined
              : checkoutCwd,
            branch: workspace.branch,
            worktreeRemoved: false,
            runtimeMode: lead.runtimeMode,
            orchestrationLeadId: run.leadId,
          };
          await upsertSession(synced);
          const next = sessionsRef.current.map((session) =>
            session.id === synced.id ? synced : session,
          );
          sessionsRef.current = next;
          setSessions(next);
          return { scratchDir, workspace };
        }
        const restored = await getSession(task.sessionId);
        if (
          restored &&
          (restored.harness !== task.harness || restored.model !== task.model)
        )
          throw new Error(
            "The saved worker no longer matches its approved model. Create a new assignment.",
          );
        const fresh = {
          ...newSession(task.harness, projectCwd, task.model, lead.runtimeMode),
          ...(sameProjectPath(projectCwd, checkoutCwd)
            ? {}
            : { worktreeCwd: checkoutCwd, branch: workspace.branch }),
          ...(task.modelSettings
            ? {
                modelSettings: mergeModelSettings(
                  resolveModel(task.harness, task.model),
                  task.modelSettings,
                ),
              }
            : {}),
        };
        const base = restored
          ? {
              ...restored,
              busy: false,
              cwd: projectCwd,
              worktreeCwd: sameProjectPath(projectCwd, checkoutCwd)
                ? undefined
                : checkoutCwd,
              branch: sameProjectPath(projectCwd, checkoutCwd)
                ? undefined
                : workspace.branch,
              worktreeRemoved: false,
              runtimeMode: lead.runtimeMode,
            }
          : {
              ...fresh,
              id: task.sessionId,
              title: task.title,
            };
        const worker = { ...base, orchestrationLeadId: run.leadId };
        if (worker.providerSessionId)
          bindHarnessSession(
            worker.harness,
            worker.id,
            worker.providerSessionId,
            sessionWorkCwd(worker),
            worker.providerAccountId,
            worker.blocks,
          );
        await upsertSession(worker);
        const next = [...sessionsRef.current, worker];
        sessionsRef.current = next;
        setSessions(next);
        // Workers belong to the lead's agent panel; no workspace tab is created.
        return { scratchDir, workspace };
      },
      integrateWorker: async (run, task) => {
        const fromCwd = task.workspace?.checkoutCwd;
        if (!fromCwd)
          throw new Error("This worker's isolated checkout is unavailable");
        const session = sessionsRef.current.find(
          (entry) => entry.id === task.sessionId,
        );
        if (session)
          await Promise.all(
            sessionChildHarnesses(session).map((harness) =>
              stopHarnessSession(harness, task.sessionId),
            ),
          );
        await invoke("harness_kill", { sessionId: task.sessionId });
        await invoke("control_turn_finished", { sessionId: task.sessionId });
        await flushSessionCheckpoint(task.sessionId);
        const listed = await listWorktrees(orchestrationCheckoutCwd(run));
        const workerTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, fromCwd),
        );
        const leadTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, orchestrationCheckoutCwd(run)),
        );
        if (!workerTree || !leadTree)
          throw new Error(
            "The worker or lead checkout is no longer registered. The worker worktree was kept.",
          );
        if (workerTree.head !== leadTree.head)
          throw new Error(
            "The worker or lead branch moved while this task was running. The worker worktree was kept for manual review.",
          );
        return applySessionCheckpoint(
          task.sessionId,
          fromCwd,
          orchestrationCheckoutCwd(run),
        );
      },
      cleanupWorker: async (run, task, onlyIfUnchanged) => {
        const workspace = task.workspace;
        if (!workspace || workspace.kind !== "worktree") return true;
        const path = workspace.checkoutCwd;
        await flushSessionCheckpoint(task.sessionId);
        const listed = await listWorktrees(orchestrationCheckoutCwd(run));
        const exists = listed.worktrees.some(
          (tree) => pathKey(tree.path) === pathKey(path),
        );
        if (!exists && onlyIfUnchanged) return false;
        const workerTree = listed.worktrees.find(
          (tree) => pathKey(tree.path) === pathKey(path),
        );
        const leadTree = listed.worktrees.find((tree) =>
          sameProjectPath(tree.path, orchestrationCheckoutCwd(run)),
        );
        if (
          exists &&
          (!workerTree || !leadTree || workerTree.head !== leadTree.head)
        ) {
          if (onlyIfUnchanged) return false;
          throw new Error(
            "The worker or lead branch moved before cleanup. The worker worktree was kept for manual review.",
          );
        }
        if (onlyIfUnchanged) {
          const safe = await sessionCheckpointCleanupSafe(task.sessionId, path);
          if (!safe) return false;
        } else if (exists) {
          // Re-verify immediately before destructive cleanup. The operation is
          // idempotent, so this also finishes a partially applied integration.
          await applySessionCheckpoint(
            task.sessionId,
            path,
            orchestrationCheckoutCwd(run),
          );
        }

        if (exists) {
          onStop(task.sessionId, true);
          const session = sessionsRef.current.find(
            (entry) => entry.id === task.sessionId,
          );
          if (session) {
            await Promise.all(
              sessionChildHarnesses(session).map((harness) =>
                stopHarnessSession(harness, task.sessionId),
              ),
            );
          }
          await invoke("harness_kill", { sessionId: task.sessionId });
          await invoke("control_turn_finished", {
            sessionId: task.sessionId,
          });
          await flushSessionWrites();
          checkOpenWorktreeFiles(path);
          const removed = await removeOrchestrationWorktree(
            orchestrationCheckoutCwd(run),
            path,
          );
          const affected = new Set([task.sessionId, ...removed.sessionIds]);
          sessionsRef.current = sessionsRef.current.map((session) =>
            affected.has(session.id)
              ? detachSessionWorktree(session, removed.projectCwd, path)
              : session,
          );
          setSessions(sessionsRef.current);
          const detachSummary = (entry: SessionSummary) =>
            affected.has(entry.id)
              ? detachSessionWorktree(entry, removed.projectCwd, path)
              : entry;
          setHistory((current) => current.map(detachSummary));
          setStoredLinkedSessions((current) => current.map(detachSummary));
          if (session)
            await Promise.allSettled(
              sessionChildHarnesses(session).map((harness) =>
                forgetHarnessSession(harness, task.sessionId),
              ),
            );
        } else {
          const detached = sessionsRef.current.find(
            (entry) => entry.id === task.sessionId,
          );
          if (detached && !detached.worktreeRemoved) {
            const next = detachSessionWorktree(
              detached,
              orchestrationProjectCwd(run),
              path,
            );
            sessionsRef.current = sessionsRef.current.map((entry) =>
              entry.id === task.sessionId ? next : entry,
            );
            setSessions(sessionsRef.current);
            if (shouldPersistSession(next)) await upsertSession(next);
          }
        }
        if (workspace.branch)
          await removeOrchestrationBranch(
            orchestrationCheckoutCwd(run),
            workspace.branch,
          );
        await forgetSessionCheckpoint(task.sessionId);
        notifyReviewChanged(task.sessionId);
        return true;
      },
      submit: (id, text, done) => {
        void submitWithSettlement({
          submit: (onSettled) => {
            let acceptance: SubmissionAcceptance = false;
            // Commit an immediate turn before another scheduler update. A
            // deferred submission flushes its own turn after synchronization.
            flushSync(() => {
              acceptance = submitSession(id, text, [], {
                managed: true,
                onSettled,
              });
            });
            return acceptance;
          },
          onSettled: done,
          rejectionMessage:
            "The selected agent session could not accept this turn.",
        }).catch(console.error);
      },
      steer: async (id, text) => {
        flushHarnessEvents();
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (!session) throw new Error("This agent is no longer available");
        if (!session.busy)
          throw new Error(
            "This agent is not running a turn; send it a fresh one with message.",
          );
        if (!isLiveHarness(session.harness) || !canSteerHarness(session.harness))
          throw new Error(
            `${session.harness} cannot take guidance mid-turn. Wait for the turn to finish, then use message.`,
          );
        // Record it on the worker before dispatch, so its own transcript shows
        // why it changed course even if the harness call then fails.
        const next = sessionsRef.current.map((entry) =>
          entry.id === id ? appendSteerUser(entry, text) : entry,
        );
        sessionsRef.current = next;
        setSessions(next);
        await steerHarnessTurn({
          harness: session.harness,
          sessionId: id,
          cwd: sessionWorkCwd(session),
          model: session.model,
          modelSettings: session.modelSettings,
          text,
        });
      },
      respondApproval: (id, requestId, decision) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session)
          respondHarnessApproval(session.harness, id, requestId, decision);
      },
      answerQuestion: (id, requestId, reply) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session)
          respondHarnessQuestion(session.harness, id, requestId, reply);
      },
      stop: async (id) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        onStop(id, true);
        try {
          if (session)
            await Promise.all(
              sessionChildHarnesses(session).map((harness) =>
                stopHarnessSession(harness, id),
              ),
            );
        } finally {
          // Also reap processes left behind by a renderer reload, before the
          // corresponding session has been restored in this window.
          await invoke("harness_kill", { sessionId: id });
          await invoke("control_turn_finished", { sessionId: id });
        }
      },
    });
  }, [checkOpenWorktreeFiles, submitSession, onStop, flushHarnessEvents]);

  useEffect(() => {
    orchestrator.sync();
  }, [sessions]);

  const stopSessionRef = useRef(onStop);
  stopSessionRef.current = onStop;

  const irgatGroups = useIrgatGroupChat({
    sessions: () => sessionsRef.current,
    memberSession: (irgatId) =>
      ensureIrgatSession(irgatId, {
        home: homeDir,
        load: ensureOpenSession,
        create: (path) => newDefaultSession(path),
        add: (created) => {
          sessionsRef.current = [...sessionsRef.current, created];
          setSessions(sessionsRef.current);
        },
      }),
    add: (session) => {
      sessionsRef.current = [...sessionsRef.current, session];
      setSessions(sessionsRef.current);
    },
    run: (id, prompt, attachments) =>
      new Promise((resolve) => {
        void submitWithSettlement({
          submit: (onSettled) =>
            submitSession(id, prompt, attachments, { onSettled }),
          onSettled: resolve,
          rejectionMessage: "The group reply could not start.",
        });
      }),
    stop: async (id) => {
      await stopSessionRef.current(id);
    },
    remove: async (id) => {
      const open = await stopSessionForRemoval(id);
      if (open)
        await Promise.all(
          sessionChildHarnesses(open).map((harness) =>
            forgetHarnessSession(harness, id),
          ),
        );
      await deleteSession(id, []);
      sessionsRef.current = sessionsRef.current.filter(
        (session) => session.id !== id,
      );
      setSessions(sessionsRef.current);
    },
  });
  useIrgatGroupWatch(irgatGroups, sessions, () => sessionsRef.current);
  const activeIrgatGroups = useActiveIrgatGroups(irgatGroups);
  const openIrgatGroupId = irgatGroupOfView(irgatViewId);
  const openIrgatGroupRun = useIrgatGroupRun(irgatGroups, openIrgatGroupId ?? "");
  const openIrgatGroupSeatId = openIrgatGroupRun.speaking?.seatId;
  const openIrgatGroupSeat = openIrgatGroupSeatId
    ? sessions.find((session) => session.id === openIrgatGroupSeatId)
    : undefined;
  /** Deletes the room and what was said in it; its members stay. */
  const onDeleteIrgatGroup = useCallback(
    async (groupId: string) => {
      const group = findIrgatGroup(groupId);
      if (!group) return;
      const confirmed = await ask(
        `Delete the group chat “${irgatGroupName(group)}”? What was said in it will be deleted. Its Irgats stay. This can’t be undone.`,
        { title: "Irgatos", kind: "warning" },
      );
      if (!confirmed) return;
      await irgatGroups.stop(groupId);
      if (irgatViewIdRef.current === irgatGroupViewKey(groupId))
        closeIrgatView();
      removeIrgatGroup(groupId);
    },
    [irgatGroups, closeIrgatView],
  );
  const removeSessionRef = useRef(onRemoveHistorySession);
  removeSessionRef.current = onRemoveHistorySession;

  // Browser access: answers the page served to the user's other devices.
  const webAccessDeps = useRef<WebAccessDeps | null>(null);
  webAccessDeps.current = {
    ...webAccessDefaults,
    sessions: () => sessionsRef.current,
    submit: (sessionId, text) => onSubmit(sessionId, text, []),
    approve: onApproval,
    answer: onQuestionReply,
    stop: onStop,
    launch: (launch, sessionId) =>
      launchQuickSessionRef.current(launch, sessionId),
    irgatHost: {
      home: homeDir,
      load: ensureOpenSession,
      create: (path) => newDefaultSession(path),
      add: (created) => {
        sessionsRef.current = [...sessionsRef.current, created];
        setSessions(sessionsRef.current);
      },
    },
    rename: onRenameHistorySession,
    remove: (sessionId) => onRemoveHistorySession(sessionId, "delete", true),
  };
  useEffect(() => connectWebAccess(() => webAccessDeps.current!), []);

  useEffect(() => {
    const listening = listen<{
      id: string;
      namespace: string;
      sessionId: string;
      requestId: string;
      action: string;
      input: Record<string, unknown>;
    }>("irgat-control-request", ({ payload }) => {
      const handle = async () => {
        if (payload.namespace === "control") {
          return orchestrator.handle(
            payload.sessionId,
            payload.requestId,
            payload.action,
            payload.input,
          );
        }
        if (payload.namespace !== "app")
          throw new Error("Unknown CLI namespace");
        const source = sessionsRef.current.find(
          (session) => session.id === payload.sessionId,
        );
        if (
          !source ||
          source.inboxAsk ||
          source.orchestrationLeadId ||
          orchestrator.run(source.id)
        )
          throw new Error("This session cannot use the Irgatos app CLI");
        if (!isIrgatSession(source.id) && !operatorEnabledInThread(source.blocks) && hasAppWindowUserTurn(source.blocks)
          && !["computer.read", "computer.act"].includes(payload.action))
          throw new Error("Sharing an application only enables computer.read and computer.act. Use /operator for other app commands.");
        const key = `${source.id}:${payload.requestId}`;
        const signature = JSON.stringify([payload.action, payload.input]);
        const previous = appReceipts.current.get(key);
        if (previous) {
          if (previous.signature !== signature)
            throw new Error("Request ID was already used with different input");
          return previous.promise;
        }
        const sourceIrgat =
          irgatForSession(source.id) ?? findIrgat(habitRunIrgat(source.id) ?? "");
        const canAccessProject = (cwd: string) =>
          canAccessAgentAppProject(source, cwd, sourceIrgat?.projects);
        const sourceTurn = turnGen.current.get(source.id) ?? 0;
        const sourceTurns = isIrgatSession(source.id)
          ? groupIrgatTurns(source.blocks)
          : [];
        const sourceTurnId = sourceTurns[sourceTurns.length - 1]?.[0]?.id;
        const rememberSession = (entry: IrgatSpawnedSession) => {
          if (!sourceTurnId) return;
          const next = sessionsRef.current.map((session) =>
            session.id === source.id
              ? recordIrgatSpawnedSession(session, sourceTurnId, entry)
              : session,
          );
          if (
            next.every(
              (session, index) => session === sessionsRef.current[index],
            )
          )
            return;
          sessionsRef.current = next;
          setSessions(next);
        };
        const monitorCompletion = (
          irgatId: string,
          sessionId: string,
          requestId: string,
          project: string,
          prompt: string,
          irgat?: string,
        ) => {
          const settle = irgatCompletionBatches.current!.watch(
            { irgatId, turn: sourceTurn },
            requestId,
            sessionId,
            { awaitAcceptance: true },
          );
          return Object.assign(
            (outcome: ControlOutcome) =>
              settle(
                irgatSessionCompletionResult({
                  requestId,
                  sessionId,
                  project,
                  prompt,
                  outcome,
                  session: sessionsRef.current.find(
                    (session) => session.id === sessionId,
                  ),
                  ...(irgat ? { irgat } : {}),
                }),
              ),
            { accept: settle.accept, discard: settle.discard },
          );
        };
        const dismissCompletion = (sessionId: string) => {
          if (!isIrgatSession(source.id)) return;
          irgatCompletionBatches.current!.dismissSession(source.id, sessionId);
          flushSync(() =>
            setSessions((previous) =>
              previous.map((session) =>
                session.id === source.id
                  ? dismissQueuedIrgatSessionCompletion(session, sessionId)
                  : session,
              ),
            ),
          );
        };
        const promise = handleAgentApp(
          source,
          payload.requestId,
          payload.action,
          payload.input,
          {
            computer: (sessionId, tool, args) => invoke("computer_use_call", { sessionId, tool, args }),
            start: async (launch, id, placement, notifyIrgatId) => {
              // The machine that holds the project runs the session; it is
              // listed in that project's Sessions sidebar.
              if (isRemoteProjectPath(launch.cwd)) {
                const remote = await launchRemoteSession(launch, id);
                rememberSession({
                  sessionId: remote.sessionId,
                  cwd: launch.cwd,
                  title: launch.prompt.trim().slice(0, 300),
                  harness: launch.harness,
                  model: resolveModel(launch.harness, launch.model).id,
                });
                // The host runs it, so its finish is read from the host and
                // reported to the Irgat as a session here would be.
                if (notifyIrgatId) {
                  const settle = monitorCompletion(
                    notifyIrgatId,
                    remote.sessionId,
                    id,
                    launch.cwd,
                    launch.prompt,
                  );
                  settle.accept();
                  void waitForRemoteTurn((known) =>
                    loadRemoteSession(remote.machineId, remote.sessionId, known),
                  ).then(settle);
                }
                return;
              }
              const rememberLaunch = () => {
                const created =
                  sessionsRef.current.find((session) => session.id === id) ??
                  existing;
                rememberSession({
                  sessionId: id,
                  cwd: created?.cwd ?? launch.cwd,
                  title: created?.title ?? launch.prompt.trim().slice(0, 300),
                  harness: created?.harness ?? launch.harness,
                  model:
                    created?.model ??
                    resolveModel(launch.harness, launch.model).id,
                });
              };
              const open = sessionsRef.current.find(
                (session) => session.id === id,
              );
              const stored = open ? null : await getSession(id);
              const existing = open ?? stored;
              const previous = existing?.blocks.find(
                (block) => block.appRequestId === id,
              );
              if (previous) {
                if (
                  previous.text !== launch.prompt ||
                  (!launch.draft && !!previous.draft)
                )
                  throw new Error(
                    "Request ID was already used for another session launch",
                  );
                rememberLaunch();
                return;
              }
              if (
                existing?.blocks.some(
                  (block) => block.role === "user" && !block.draft,
                )
              ) {
                rememberLaunch();
                return;
              }
              if (existing && sessionDraftBlock(existing))
                throw new Error("Session ID already has a different draft");
              const onSettled = notifyIrgatId
                ? monitorCompletion(
                    notifyIrgatId,
                    id,
                    id,
                    launch.cwd,
                    launch.prompt,
                  )
                : undefined;
              try {
                // A Irgat's sessions open from its chat, not as workspace
                // tabs, unless it places one beside an open pane.
                await launchQuickSessionRef.current(
                  launch,
                  id,
                  placement,
                  onSettled,
                  !isIrgatSession(source.id) || !!placement,
                );
                rememberLaunch();
                onSettled?.accept();
              } catch (error) {
                onSettled?.discard();
                throw error;
              }
            },
            sessions: async (cwd): Promise<AppSessionListing[]> => {
              const stored = await listSessionsByProject(cwd);
              const byId = new Map<string, AppSessionListing>();
              for (const session of stored) {
                if (session.orchestrationLeadId) continue;
                byId.set(session.id, {
                  id: session.id,
                  title: session.title,
                  harness: session.harness,
                  model: session.model,
                  busy: false,
                  hasDraft: !!session.draft,
                  archived: !!session.archived,
                });
              }
              for (const session of sessionsRef.current) {
                if (
                  session.orchestrationLeadId ||
                  isHabitRun(session.id) ||
                  !sameProjectPath(session.cwd, cwd)
                )
                  continue;
                byId.set(session.id, {
                  id: session.id,
                  title: session.title,
                  harness: session.harness,
                  model: session.model,
                  busy: !!session.busy,
                  hasDraft: !!sessionDraftBlock(session),
                  archived: byId.get(session.id)?.archived ?? false,
                });
              }
              return [...byId.values()];
            },
            session: async (id) => {
              const target =
                sessionsRef.current.find((session) => session.id === id) ??
                (await getSession(id));
              return target &&
                !target.orchestrationLeadId &&
                canReadAgentAppSession(
                  source,
                  target,
                  sourceIrgat?.projects,
                  sourceIrgat ? allIrgatSessionIds(sourceIrgat) : undefined,
                )
                ? target
                : null;
            },
            readConversation: async (target, options) =>
              isIrgatSession(target.id)
                ? readIrgatConversation(target, options)
                : sessionConversationPage(target, options),
            send: async (id, prompt, requestId, notifyIrgatId) => {
              const target = await ensureOpenSessionRef.current(id);
              if (
                !target ||
                target.orchestrationLeadId ||
                !canAccessProject(target.cwd) ||
                orchestrator.run(id)
              )
                throw new Error("Session is unavailable in this project");
              const rememberFollowUp = () => {
                const current =
                  sessionsRef.current.find((session) => session.id === id) ??
                  target;
                rememberSession({
                  sessionId: id,
                  cwd: current.cwd,
                  title: current.title,
                  harness: current.harness,
                  model: current.model,
                });
              };
              const previous = target.blocks.find(
                (block) => block.appRequestId === requestId,
              );
              if (previous) {
                if (previous.text !== prompt)
                  throw new Error(
                    "Request ID was already used with another prompt",
                  );
                if (previous.draft)
                  throw new Error("Request ID belongs to an unsent draft");
                rememberFollowUp();
                return { alreadySubmitted: true };
              }
              if (target.busy)
                throw new Error("Session is busy; try again when it finishes");
              if (sessionDraftBlock(target))
                throw new Error(
                  "Session already has a draft; send or remove it first",
                );
              const onSettled = notifyIrgatId
                ? monitorCompletion(
                    notifyIrgatId,
                    id,
                    requestId,
                    target.cwd,
                    prompt,
                  )
                : undefined;
              const accepted = onSettled
                ? await submitWithSettlement({
                    submit: (onSettled) =>
                      submitSessionRef.current(id, prompt, [], {
                        appRequestId: requestId,
                        onSettled,
                      }),
                    onSettled,
                    rejectionMessage:
                      "The monitored follow-up could not start.",
                  })
                : await submitSessionRef.current(id, prompt, [], {
                    appRequestId: requestId,
                  });
              if (!accepted) {
                onSettled?.discard();
                throw new Error("Session could not accept the follow-up");
              }
              rememberFollowUp();
              onSettled?.accept();
              return { alreadySubmitted: false };
            },
            draft: async (id, prompt, requestId) => {
              const target = await ensureOpenSessionRef.current(id);
              if (
                !target ||
                target.orchestrationLeadId ||
                !canAccessProject(target.cwd) ||
                orchestrator.run(id)
              )
                throw new Error("Session is unavailable in this project");
              const previous = target.blocks.find(
                (block) => block.appRequestId === requestId,
              );
              if (previous) {
                if (previous.text !== prompt)
                  throw new Error(
                    "Request ID was already used with another prompt",
                  );
                return { alreadySaved: true, draft: !!previous.draft };
              }
              if (target.busy)
                throw new Error("Session is busy; try again when it finishes");
              if (sessionDraftBlock(target))
                throw new Error(
                  "Session already has a draft; send or remove it first",
                );
              const saved = flushSync(() =>
                saveDraftRef.current(id, prompt, [], requestId),
              );
              if (!saved) throw new Error("Session could not accept a draft");
              return { alreadySaved: false, draft: true };
            },
            stop: async (id) => {
              if (
                removingSessionIds.current.has(id) ||
                switchingWorktrees.current.has(id)
              )
                throw new Error(
                  "Session is being removed or changing worktrees",
                );
              const target = sessionsRef.current.find(
                (session) => session.id === id,
              );
              if (!target) {
                dismissCompletion(id);
                return;
              }
              if (
                target.orchestrationLeadId ||
                !canAccessProject(target.cwd) ||
                isIrgatSession(id) ||
                isHabitRun(id)
              )
                throw new Error("Session is unavailable in this project");
              await flushSync(() => stopSessionRef.current(id));
              flushHarnessEvents();
              dismissCompletion(id);
            },
            remove: async (id, mode) => {
              const target = await ensureOpenSessionRef.current(id);
              if (
                !target ||
                target.orchestrationLeadId ||
                !canAccessProject(target.cwd) ||
                isIrgatSession(id) ||
                isHabitRun(id)
              )
                throw new Error("Session is unavailable in this project");
              const removed = await removeSessionRef.current(
                id,
                mode,
                true,
                "cli",
              );
              if (!removed)
                throw new Error(
                  `Session could not be ${mode === "archive" ? "archived" : "deleted"}; another session operation is in progress`,
                );
              dismissCompletion(id);
            },
            worktrees: (cwd) => listWorktrees(cwd),
            createWorktree: (cwd, branch, base, existing) =>
              createWorktree(cwd, branch, base, existing),
            notes: () => invoke("notes_list"),
            note: (id) => invoke("notes_get", { id }),
            saveNote: async (note) => {
              const saved = await upsertNote(note);
              window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
              return saved;
            },
            artifacts: () => invoke("artifacts_list"),
            artifact: getArtifact,
            saveArtifact,
            postArtifact: async (sessionId, card) => {
              const latest = sessionsRef.current.find(
                (session) => session.id === sessionId,
              );
              const anchor =
                sourceTurnId ??
                latest?.blocks
                  .slice()
                  .reverse()
                  .find((block) => block.role === "user")?.id;
              if (
                !latest ||
                !anchor ||
                !latest.blocks.some((block) => block.id === anchor)
              )
                throw new Error(
                  "The artifact's conversation turn is no longer available",
                );
              const updated = recordArtifactCard(latest, anchor, card);
              sessionsRef.current = sessionsRef.current.map((session) =>
                session.id === sessionId ? updated : session,
              );
              setSessions(sessionsRef.current);
              if (!isHabitRun(sessionId)) await upsertSession(updated);
            },
            isIrgat: (id) => isIrgatSession(id),
            irgats: () =>
              listIrgats().map((irgat) => ({
                id: irgat.id,
                name: irgatLook(irgat).name,
                busy: !!sessionsRef.current.find(
                  (session) => session.id === irgat.sessionId,
                )?.busy,
              })),
            messageIrgat: async (irgatId, message, requestId, notifyIrgatId) => {
              const irgat = findIrgat(irgatId);
              if (!irgat || !sourceIrgat)
                throw new Error("That Irgat is no longer available");
              const name = irgatLook(irgat).name;
              // Its main chat, created the way opening the Irgat would.
              const target = await ensureIrgatSession(irgatId, {
                home: homeDir,
                load: (id) => ensureOpenSessionRef.current(id),
                create: (path) => newDefaultSession(path),
                add: (created) => {
                  sessionsRef.current = [...sessionsRef.current, created];
                  setSessions(sessionsRef.current);
                },
              });
              if (!target) throw new Error("That Irgat is no longer available");
              const current =
                sessionsRef.current.find((session) => session.id === target.id) ??
                target;
              const previous = current.blocks.find(
                (block) => block.appRequestId === requestId,
              );
              if (previous) {
                if (previous.text !== message)
                  throw new Error(
                    "Request ID was already used with another message",
                  );
                return { alreadySubmitted: true };
              }
              if (current.busy || current.queuedMessages?.length)
                throw new Error(
                  `${name} is busy; try again when it finishes`,
                );
              const onSettled = monitorCompletion(
                notifyIrgatId,
                current.id,
                requestId,
                "",
                message,
                name,
              );
              const accepted = await submitWithSettlement({
                submit: (onSettled) =>
                  submitSessionRef.current(current.id, message, [], {
                    appRequestId: requestId,
                    onSettled,
                    fromIrgat: {
                      id: sourceIrgat.id,
                      name: irgatLook(sourceIrgat).name,
                      color: sourceIrgat.color,
                    },
                  }),
                onSettled,
                rejectionMessage: `${name} could not take the message.`,
              });
              if (!accepted) {
                onSettled.discard();
                throw new Error(`${name} could not take the message`);
              }
              onSettled.accept();
              return { alreadySubmitted: false };
            },
            projects: () => {
              const irgat = irgatForSession(source.id);
              return irgat ? irgatLook({
                ...irgat,
                projects: irgatKnownProjects(irgat, sidebarCwdRef.current),
              }).projects : [];
            },
            requestProjectAccess: (sessionId, irgatId, project) => {
              const session = sessionsRef.current.find((item) => item.id === sessionId);
              if (!session || irgatForSession(sessionId)?.id !== irgatId)
                throw new Error("The Irgat chat is no longer available");
              const block = projectAccessBlock(session, irgatId, project);
              if (session.blocks.some((item) => item.id === block.id)) return;
              const updated = { ...session, blocks: [...session.blocks, block] };
              sessionsRef.current = sessionsRef.current.map((item) => item.id === sessionId ? updated : item);
              setSessions(sessionsRef.current);
              persistSession(updated);
            },
            isHabitRun: (id) => isHabitRun(id),
            irgatOf: (id) => {
              const irgat =
                irgatForSession(id) ?? findIrgat(habitRunIrgat(id) ?? "");
              return (
                irgat && {
                  id: irgat.id,
                  projects: irgat.projects,
                  sessionIds: allIrgatSessionIds(irgat),
                  showStartedSessionsInSidebar:
                    irgat.showStartedSessionsInSidebar,
                  ...(irgat.useSidebarFolders
                    ? {
                        folder: {
                          name: irgatLook(irgat).name,
                          color: irgat.color,
                        },
                      }
                    : {}),
                }
              );
            },
            habits: { load: loadHabits, update: updateHabits },
            agentFiles: (irgatId) => loadIrgatFiles(irgatId),
            readAgentFile: (irgatId, path) => readAgentFile(irgatId, path),
            writeAgentFile: (irgatId, path, text, hash) =>
              writeAgentFile(irgatId, path, text, hash),
          },
        );
        appReceipts.current.set(key, { signature, promise });
        void promise.catch(() => {
          if (appReceipts.current.get(key)?.promise === promise)
            appReceipts.current.delete(key);
        });
        if (appReceipts.current.size > 256) {
          const first = appReceipts.current.keys().next().value;
          if (first) appReceipts.current.delete(first);
        }
        return promise;
      };
      void handle()
        .then(
          (result) =>
            invoke("control_reply", {
              id: payload.id,
              response: { ok: true, result },
            }),
          (error: unknown) =>
            invoke("control_reply", {
              id: payload.id,
              response: {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }),
        )
        .catch(console.error);
    });
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);

  const confirmingOrchestration = useRef(new Set<string>());
  const queueWorkerPanes = useCallback(
    (workers: OrchestrationWorkerDetail[]) => {
      // Finished workers are not open; load stored transcripts before the
      // tabs appear so the pane does not flash the empty state.
      void prepareOrchestrationWorkerDetails(workers, {
        openLead: async (leadId) => {
          if (!focusOpenSession(leadId)) await onSelectHistorySession(leadId);
        },
        openWorker: ensureOpenSession,
        hasSession: (id) =>
          sessionsRef.current.some((session) => session.id === id),
      })
        .then((request) => {
          if (request?.workers.length) setWorkerDetailRequest(request);
        })
        .catch(console.error);
    },
    [ensureOpenSession, focusOpenSession, onSelectHistorySession],
  );
  const onOpenWorkerDetails = useCallback(
    (worker: OrchestrationWorkerDetail) => {
      setInspectedWorkerId(worker.sessionId);
      queueWorkerPanes([worker]);
    },
    [queueWorkerPanes],
  );
  useEffect(() => {
    if (!workerDetailRequest) return;
    const { leadId, workers } = workerDetailRequest;
    const tab = tabs.find((entry) => leafIds(entry.layout).includes(leadId));
    if (!tab) {
      // Still opening: this runs again on the commit that lands the lead. If
      // the lead never arrived at all, drop the request rather than let it
      // fire against some later tab change.
      if (!sessionsRef.current.some((entry) => entry.id === leadId)) {
        setWorkerDetailRequest(null);
      }
      return;
    }
    setWorkerDetailRequest(null);
    // Every agent of a run shares one pane, the way files do: `openEditorTab`
    // focuses an open tab, adds to the pane already beside the lead, or splits
    // one off when there is none.
    const cwd =
      sessionsRef.current.find((entry) => entry.id === leadId)?.cwd ??
      projectCwdRef.current;
    const files = workers.map((worker) =>
      newAgentTab(worker.title, cwd, {
        sessionId: worker.sessionId,
        leadId,
        harness: worker.harness,
      }),
    );
    setTabs((prev) =>
      prev.map((entry) => {
        if (entry.id !== tab.id) return entry;
        const opened = files.reduce(
          (next, file) => openEditorTab(next, file),
          entry,
        );
        // Leave the first worker focused so View agents lands on the start
        // of the run rather than the last tab added.
        return files[0] ? openEditorTab(opened, files[0]) : opened;
      }),
    );
    setActiveTabId(tab.id);
    setComposerFocused(false);
  }, [tabs, workerDetailRequest]);
  const orchestrationWorkers = useMemo(
    () => ({
      selectedId: inspectedWorkerId,
      inspect: setInspectedWorkerId,
      openDetails: onOpenWorkerDetails,
    }),
    [inspectedWorkerId, onOpenWorkerDetails],
  );
  const updateOrchestrationCard = useCallback(
    (leadId: string, blockId: string, proposal: OrchestrationProposal) => {
      const next = sessionsRef.current.map((session) =>
        session.id === leadId
          ? withOrchestrationProposal(session, blockId, proposal)
          : session,
      );
      sessionsRef.current = next;
      setSessions(next);
      return next.find((session) => session.id === leadId);
    },
    [],
  );
  const orchestrationActions = useMemo(
    () => ({
      open: onOpenApprovalSession,
      openAgents: queueWorkerPanes,
      update: (
        leadId: string,
        blockId: string,
        edited: OrchestrationProposal,
      ) => {
        const session = sessionsRef.current.find(
          (entry) => entry.id === leadId,
        );
        const proposal = session?.blocks.find(
          (block) => block.id === blockId,
        )?.orchestration;
        if (
          !session ||
          session.busy ||
          proposal?.status !== "ready" ||
          confirmingOrchestration.current.has(leadId)
        )
          return;
        // Keep the discovered catalog authoritative while allowing task and parallelism edits.
        const settings = validateOrchestrationSettings({
          ...proposal.settings,
          maxWorkers: edited.settings.maxWorkers,
        });
        updateOrchestrationCard(leadId, blockId, {
          ...proposal,
          settings,
          tasks: edited.tasks,
        });
      },
      confirm: async (leadId: string, blockId: string) => {
        if (confirmingOrchestration.current.has(leadId)) return;
        confirmingOrchestration.current.add(leadId);
        let proposal: OrchestrationProposal | undefined;
        try {
          await orchestrator.hydrate(leadId);
          const session = sessionsRef.current.find(
            (entry) => entry.id === leadId,
          );
          proposal = session?.blocks.find(
            (block) => block.id === blockId,
          )?.orchestration;
          if (!session || session.busy || proposal?.status !== "ready")
            throw new Error(
              "Wait for the proposal to finish before confirming.",
            );
          if (
            session.harness !== proposal.author.harness ||
            session.model !== proposal.author.model
          )
            throw new Error(
              "The lead model has changed. Switch back to the model shown on this card, or generate a new proposal.",
            );
          const starting = updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "starting",
          })!;
          // Save the edited card before anything can execute.
          await upsertSession(starting);
          await orchestrator.startApproved(leadId, blockId, proposal);
          updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "approved",
          });
        } catch (error) {
          if (proposal)
            updateOrchestrationCard(leadId, blockId, {
              ...proposal,
              status: "ready",
            });
          throw error;
        } finally {
          confirmingOrchestration.current.delete(leadId);
        }
      },
      retry: (leadId: string, blockId: string) => {
        const session = sessionsRef.current.find(
          (entry) => entry.id === leadId,
        );
        const proposal = session?.blocks.find(
          (block) => block.id === blockId,
        )?.orchestration;
        if (!session || session.busy || !proposal) return;
        onSubmit(leadId, proposal.request, [], {
          intent: "orchestrate",
          orchestrationRetry: proposal,
        });
      },
    }),
    [
      onOpenApprovalSession,
      queueWorkerPanes,
      onSubmit,
      updateOrchestrationCard,
    ],
  );

  const onOpenFleetSession = useCallback(
    (sessionId: string) => {
      setFleetViewOpen(false);
      const irgat = irgatForSession(sessionId);
      if (irgat) {
        void onOpenIrgat(irgat.id, sessionId);
        return;
      }
      onOpenApprovalSession(sessionId);
    },
    [onOpenApprovalSession, onOpenIrgat],
  );

  const onSelectLiveAgent = useCallback(
    (sessionId: string) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      onOpenApprovalSession(sessionId);
    },
    [onOpenApprovalSession],
  );

  const nextTitleTabs: TitleTab[] = deckProjectTabs.map((tab) =>
    toTitleTab(tab, sessions, dirtyFiles, unseenFinishedIds),
  );
  tabProjectsRef.current = new Map(
    nextTitleTabs.map((tab) => [tab.id, tab.project]),
  );
  const titleTabsRef = useRef(nextTitleTabs);
  if (!titleTabsEqual(titleTabsRef.current, nextTitleTabs)) {
    titleTabsRef.current = nextTitleTabs;
  }
  const titleTabs = titleTabsRef.current;

  // `history` now spans every visited project; consumers that expect the
  // current project only get this slice.
  const projectHistory = useMemo(
    () => history.filter((entry) => sameProjectPath(entry.cwd, sidebarCwd)),
    [history, sidebarCwd],
  );

  const sidebarHistoryRows = useMemo(
    () =>
      historyWithLiveSessions(
        history,
        // A habit's hidden run is never one of the project's chats.
        promptableSessions,
        sidebarCwd,
        {
          ...(projectBranches?.current
            ? { branch: projectBranches.current }
            : {}),
          ...(sidebarCwd && sidebarCwd !== "~"
            ? { repo: projectName(sidebarCwd) }
            : {}),
        },
        orchestrationRuns,
      ),
    [
      history,
      projectBranches,
      promptableSessions,
      sidebarCwd,
      orchestrationRuns,
    ],
  );
  const sidebarHistory = useStableValue(
    sidebarHistoryRows,
    sameSessionSummaries,
  );
  const {
    unseen: inboxUnseen,
    linkedSessionUpdateIds,
    linkedSessionUpdates,
  } = useInboxActivity(recents, sidebarCwd, sidebarHistory, {
    onAppeared: onInboxAppeared,
  });
  linkedSessionUpdatesRef.current = linkedSessionUpdates;
  const inboxRelatedSessions = useMemo(() => {
    const byId = new Map<string, SessionSummary>();
    for (const session of storedLinkedSessions) byId.set(session.id, session);
    for (const session of history) {
      if (session.linkedWorkItem) byId.set(session.id, session);
    }
    for (const session of sessions) {
      if (session.inboxAsk || !session.linkedWorkItem) continue;
      const current = byId.get(session.id);
      const summary = summaryFromSession(session);
      byId.set(
        session.id,
        current
          ? {
              ...current,
              harness: summary.harness,
              model: summary.model,
              runtimeMode: summary.runtimeMode,
              title: summary.title,
              cwd: summary.cwd,
              linkedWorkItem: summary.linkedWorkItem,
            }
          : summary,
      );
    }
    return [...byId.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }, [history, sessions, storedLinkedSessions]);
  const repairSessions = useMemo(
    () => ciRepairSessions(history, sessions),
    [history, sessions],
  );
  const openProjectSessionRows = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            !session.inboxAsk &&
            !session.ephemeral &&
            !session.orchestrationLeadId &&
            sameProjectPath(session.cwd, sidebarCwd),
        )
        .map((session) =>
          summaryFromSession(session, {
            ...(projectBranches?.current
              ? { branch: projectBranches.current }
              : {}),
            ...(sidebarCwd && sidebarCwd !== "~"
              ? { repo: projectName(sidebarCwd) }
              : {}),
          }),
        ),
    [projectBranches, sessions, sidebarCwd],
  );
  const openProjectSessions = useStableValue(
    openProjectSessionRows,
    sameSessionSummaries,
  );

  const onToggleSidebar = useCallback(() => {
    setProjectRailOpen((open) => {
      const next = !open;
      saveProjectRailOpen(next);
      return next;
    });
  }, []);

  const onToggleSessionSidebar = useCallback(() => {
    setSessionSidebarOpen((open) => {
      const next = !open;
      saveSessionSidebarOpen(next);
      return next;
    });
  }, []);

  const onToggleProjectRail = useCallback(() => {
    setProjectRailOpen((open) => {
      const next = !open;
      saveProjectRailOpen(next);
      return next;
    });
  }, []);

  const onGoToFile = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setKanbanViewOpen(false);
    setFleetViewOpen(false);
    setFilePickerInitialQuery("");
    setFilePickerResetToken((token) => token + 1);
    setFilePickerOpen(true);
  }, []);
  const onOpenCommandPalette = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setKanbanViewOpen(false);
    setFleetViewOpen(false);
    setFilePickerInitialQuery(">");
    setFilePickerResetToken((token) => token + 1);
    setFilePickerOpen(true);
  }, []);
  const onReload = useCallback(() => {
    void (async () => {
      if (!(await confirmReload(dirtyFilesRef.current.size > 0))) return;
      window.location.reload();
    })();
  }, []);

  const onFindInProject = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setKanbanViewOpen(false);
    setFleetViewOpen(false);
    setSidebarTab("files");
    setFilesSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  const onOpenSearch = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setSearchViewOpen(true);
      setSearchViewFocusToken((token) => token + 1);
    });
  }, []);

  const onLeaveSearch = useCallback(() => {
    setSearchViewOpen(false);
  }, []);

  const onOpenInbox = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setInboxViewOpen(true);
    });
  }, []);

  const onOpenLinkedWorkItem = useCallback(
    (item: LinkedWorkItem, sessionId: string) => {
      const request = linkedWorkItemPanelRequest.current + 1;
      linkedWorkItemPanelRequest.current = request;
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setInboxViewOpen(false);
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd ??
        sidebarCwd;
      void onSelectHistorySession(sessionId).then(() => {
        if (linkedWorkItemPanelRequest.current !== request) return;
        if (!sessionsRef.current.some((session) => session.id === sessionId)) {
          return;
        }
        setLinkedWorkItemPanels((current) => {
          const next = new Map(current);
          // Reinsert the panel so it wins if this workspace tab contains
          // multiple sessions with remembered panels.
          next.delete(sessionId);
          next.set(sessionId, { item, sessionId, cwd });
          return next;
        });
      });
    },
    [history, onSelectHistorySession, sidebarCwd],
  );

  const onLeaveInbox = useCallback(() => {
    setInboxViewOpen(false);
  }, []);

  const onOpenInboxSession = useCallback(
    (sessionId: string) => {
      setInboxViewOpen(false);
      const cwd =
        sessionsRef.current.find((session) => session.id === sessionId)?.cwd ??
        history.find((session) => session.id === sessionId)?.cwd;
      setSidebarTab("sessions", cwd);
      void onSelectHistorySession(sessionId);
    },
    [history, onSelectHistorySession],
  );

  const onRepairChecks = useCallback(
    async (item: InboxItem, request: CiRepairRequest, sessionId?: string) => {
      const cwd = item.projectPath;
      if (!cwd) throw new Error("Choose a local project for this PR first.");
      let session = sessionId ? await ensureOpenSession(sessionId) : undefined;
      if (
        sessionId &&
        (!session ||
          session.inboxAsk ||
          session.orchestrationLeadId ||
          !sameProjectPath(session.cwd, cwd))
      ) {
        throw new Error("Choose a chat from this project.");
      }
      if (
        session &&
        (session.busy || session.pendingSwitch || isPreparingHandoff(session))
      ) {
        throw new Error(
          "This chat is busy. Choose another chat or start a new one.",
        );
      }
      if (!session) {
        session = {
          ...newDefaultSession(cwd, sessionDefaults?.runtimeMode),
          title: `Fix CI #${item.number}: ${item.title}`,
          linkedWorkItem: linkedWorkItemFromInboxItem(item) ?? undefined,
        };
        const next = [...sessionsRef.current, session];
        sessionsRef.current = next;
        setSessions(next);
      }
      const repairSessionId = session.id;
      trackCiRepair(cwd, request, repairSessionId, (settle) =>
        onSubmit(repairSessionId, request.text, [], {
          ciRepair: request,
          noteCard: undefined,
          handoffCard: undefined,
          onSettled: (outcome) => settle(outcome.status),
        }),
      );
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSearchViewOpen(false);
      setSidebarTab("sessions", cwd);
      await onSelectHistorySession(session.id);
    },
    [
      ensureOpenSession,
      onSubmit,
      onSelectHistorySession,
      sessionDefaults?.runtimeMode,
    ],
  );

  const onOpenNotes = useCallback(() => {
    workspaceNavigation.cancel();
    if (!loadNotesEnabled()) return;
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setNotesViewOpen(true);
    });
  }, []);

  const onLeaveNotes = useCallback(() => {
    setNotesViewOpen(false);
  }, []);

  const [artifactScope, setArtifactScopeState] =
    useState<ArtifactScope>(loadArtifactScope);
  const setArtifactScope = useCallback((scope: ArtifactScope) => {
    saveArtifactScope(scope);
    setArtifactScopeState(scope);
  }, []);
  // "This session" stays on the last chat while an artifact tab is in front.
  const lastChatSessionRef = useRef<string | undefined>(undefined);
  if (active?.id && !active.ephemeral) lastChatSessionRef.current = active.id;
  const projectArtifacts = useProjectArtifacts({
    cwd: sidebarCwd,
    sessions: promptableSessions,
    history: projectHistory,
    activeSessionId: active?.id ?? lastChatSessionRef.current,
    scope: artifactScope,
    enabled: sidebarTab === "artifacts" && !irgatCovers,
  });
  const selectedArtifactId = activeFile?.artifact?.id;
  const artifactsPanel = useMemo(
    () =>
      sidebarCwd && sidebarCwd !== "~" ? (
        <ArtifactsList
          artifacts={projectArtifacts.artifacts}
          selectedId={selectedArtifactId}
          onOpen={openArtifact}
          scope={artifactScope}
          onScopeChange={setArtifactScope}
          hasActiveSession={projectArtifacts.hasActiveSession}
          loading={projectArtifacts.loading}
          error={projectArtifacts.error}
          onRetry={projectArtifacts.retry}
          createScope={projectArtifactScope(sidebarCwd)}
        />
      ) : undefined,
    [
      sidebarCwd,
      projectArtifacts,
      selectedArtifactId,
      openArtifact,
      artifactScope,
      setArtifactScope,
    ],
  );
  const artifactChatTargets = useCallback(() => {
    const open = new Set(tabsRef.current.flatMap((tab) => leafIds(tab.layout)));
    const current = activeSessionIdRef.current ?? lastChatSessionRef.current;
    return sessionsRef.current
      .filter(
        (session) =>
          open.has(session.id) && !session.ephemeral && !session.inboxAsk,
      )
      .map((session) => ({
        sessionId: session.id,
        title: sessionDisplayTitle(session.title, session.harness),
        active: session.id === current,
      }));
  }, []);
  const addArtifactToChat = useCallback(
    (text: string, sessionId?: string) => {
      const activeEntry = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      const chatInFront =
        !!activeEntry &&
        leafIds(activeEntry.layout).some((id) =>
          sessionsRef.current.some((session) => session.id === id),
        );
      const targetId =
        sessionId ??
        (irgatViewIdRef.current || chatInFront
          ? undefined
          : lastChatSessionRef.current);
      const owner = targetId
        ? tabsRef.current.find((entry) =>
            leafIds(entry.layout).includes(targetId),
          )
        : undefined;
      if (!owner || !targetId) {
        requestAddToChat(text, "plain");
        return;
      }
      // The pane only listens once it is the target, after this render.
      flushSync(() => activateTab(owner.id, targetId));
      setComposerFocused(true);
      window.setTimeout(() => requestAddToChat(text, "plain"), 0);
    },
    [activateTab],
  );
  const artifactHost = useMemo<ArtifactHost>(
    () => ({
      chatTargets: artifactChatTargets,
      addToChat: addArtifactToChat,
      openFile: (path) => onOpenFile(path, undefined, { pin: true }),
      revealInExplorer: (path) => {
        setSidebarTab("files");
        onOpenFile(path);
      },
      openNotes: notesEnabled ? onOpenNotes : undefined,
      defaultScope:
        sidebarCwd && sidebarCwd !== "~"
          ? projectArtifactScope(sidebarCwd)
          : undefined,
    }),
    [
      artifactChatTargets,
      addArtifactToChat,
      onOpenFile,
      setSidebarTab,
      notesEnabled,
      onOpenNotes,
      sidebarCwd,
    ],
  );

  const onOpenAutomations = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setAutomationsViewOpen(true);
    });
  }, []);

  const onLeaveAutomations = useCallback(() => {
    setAutomationsViewOpen(false);
  }, []);

  const onOpenKanban = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setFleetViewOpen(false);
      setKanbanFocus(null);
      setKanbanViewOpen(true);
    });
  }, []);

  const onLeaveKanban = useCallback(() => {
    setKanbanViewOpen(false);
  }, []);

  const onOpenFleet = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(true);
    });
  }, []);

  const onLeaveFleet = useCallback(() => {
    setFleetViewOpen(false);
  }, []);

  const onOpenMail = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setMailViewOpen(true);
    });
  }, []);

  const onLeaveMail = useCallback(() => {
    setMailViewOpen(false);
  }, []);

  const onOpenIdeas = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setIdeasViewOpen(true);
    });
  }, []);

  const onLeaveIdeas = useCallback(() => {
    setIdeasViewOpen(false);
  }, []);

  const onOpenFeed = useCallback(() => {
    workspaceNavigation.cancel();
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setFeedViewOpen(true);
    });
  }, []);

  const onLeaveFeed = useCallback(() => {
    setFeedViewOpen(false);
  }, []);

  const describeMailChat = useCallback(
    (sessionId: string): MailChat | undefined => {
      const open = sessions.find((session) => session.id === sessionId);
      if (open) return { title: open.title, busy: !!open.busy };
      const saved = history.find((session) => session.id === sessionId);
      return saved ? { title: saved.title, busy: false } : undefined;
    },
    [sessions, history],
  );

  /** Starts a chat about a mail thread; its agent may read the thread and
   *  save a reply draft, never send. The chat gets its own tab: reusing a
   *  blank pane would land it in whatever tab was active (often a free chat
   *  or another project), where it stayed out of sight and was lost. */
  const onAskMail = useCallback(
    async ({ account, threadId, subject, project, text }: MailAskRequest) => {
      const freeChat = isFreeChatCwd(project);
      const session = {
        ...(freeChat
          ? newFreeChatSession(project, sessionDefaults?.runtimeMode)
          : newDefaultSession(project, sessionDefaults?.runtimeMode)),
        title: `Mail: ${subject}`,
      };
      await linkMailSession(session.id, account, threadId, subject);
      const before = sessionsRef.current;
      sessionsRef.current = [...before, session];
      setSessions(sessionsRef.current);
      if (!onSubmit(session.id, text, [])) {
        sessionsRef.current = sessionsRef.current.filter(
          (entry) => entry.id !== session.id,
        );
        setSessions(sessionsRef.current);
        throw new Error("The chat could not start. Try again.");
      }
      if (freeChat) {
        openFreeChat(session.id);
        return;
      }
      workspaceNavigation.cancel();
      if (irgatViewIdRef.current) closeIrgatView();
      setMailViewOpen(false);
      setSidebarTab("sessions", project);
      setProjectCwd(project);
      setRecents(rememberProject(project));
      const tab = newTab(session.id);
      appendTab(tab, project);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [
      appendTab,
      closeIrgatView,
      onSubmit,
      openFreeChat,
      sessionDefaults?.runtimeMode,
      workspaceNavigation.cancel,
    ],
  );

  // Not a transition: the compact drawer opens in the same batch and closes
  // itself if it renders while a full-page view still covers the sidebar.
  const onOpenArtifacts = useCallback(
    (reveal: boolean) => {
      workspaceNavigation.cancel();
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      if (irgatViewIdRef.current) closeIrgatView();
      setSidebarTab("artifacts");
      if (reveal) {
        setSessionSidebarOpen((open) => {
          if (!open) saveSessionSidebarOpen(true);
          return true;
        });
      }
    },
    [closeIrgatView, setSidebarTab],
  );

  const onStartCardSession = useCallback(
    (card: KanbanCard, project: string) => {
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      const notes = card.notes.trim();
      const composerSeed = notes ? `${card.title}\n\n${notes}` : card.title;
      if (isFreeChatCwd(project)) {
        const chat = {
          ...newFreeChatSession(project, sessionDefaults?.runtimeMode),
          title: card.title,
          composerSeed,
        };
        const next = [...sessionsRef.current, chat];
        sessionsRef.current = next;
        setSessions(next);
        openFreeChat(chat.id);
        linkKanbanSession(card.id, chat.id).catch(console.error);
        return;
      }
      const session = {
        ...newDefaultSession(project, sessionDefaults?.runtimeMode),
        title: card.title,
        composerSeed,
      };
      const tab = newTab(session.id);
      setSidebarTab("sessions", project);
      setProjectCwd(project);
      setRecents(rememberProject(project));
      setSessions((prev) => [...prev, session]);
      appendTab(tab, project);
      setActiveTabId(tab.id);
      setComposerFocused(true);
      linkKanbanSession(card.id, session.id).catch(console.error);
    },
    [appendTab, openFreeChat, sessionDefaults?.runtimeMode],
  );

  const onSessionBoard = useCallback(
    async (sessionId: string) => {
      const showCard = (project: string, cardId: string) => {
        workspaceNavigation.cancel();
        startTransition(() => {
          setFilePickerOpen(false);
          setSettingsOpen(false);
          setSearchViewOpen(false);
          setInboxViewOpen(false);
          setNotesViewOpen(false);
          setAutomationsViewOpen(false);
          setFleetViewOpen(false);
          setKanbanFocus({ project, cardId, token: Date.now() });
          setKanbanViewOpen(true);
        });
      };
      const link = kanbanLinksRef.current.get(sessionId);
      if (link) {
        showCard(link.project, link.cardId);
        return;
      }
      const session =
        sessionsRef.current.find((item) => item.id === sessionId) ??
        sidebarHistory.find((item) => item.id === sessionId);
      if (!session) return;
      const project = kanbanProject(session.cwd);
      const title =
        cardTitleFromText(sessionDisplayTitle(session.title, session.harness)) ||
        "Untitled session";
      const loaded = sessionsRef.current.find((item) => item.id === sessionId);
      try {
        await syncKanbanSessions(project, [
          {
            sessionId,
            title,
            status: loaded ? liveSessionStatus(loaded) : null,
            force: true,
          },
        ]);
        const board = await loadKanbanBoard(project);
        const filed = board.columns
          .flatMap((column) => column.cards)
          .find((card) => card.session?.id === sessionId);
        if (filed) {
          showCard(project, filed.id);
          return;
        }
        // Never saved, so there was no transcript to file it from.
        const column =
          board.columns[0] ??
          (await createKanbanColumn(
            board.id,
            crypto.randomUUID(),
            DEFAULT_KANBAN_COLUMNS[0],
          ));
        const card = await createKanbanCard(column.id, {
          id: crypto.randomUUID(),
          title,
          notes: "",
          labels: [],
        });
        await linkKanbanSession(card.id, sessionId);
        // The board view opens from the cached copy, which must hold the new card.
        await loadKanbanBoard(project);
        showCard(project, card.id);
      } catch (error) {
        console.error(error);
        showCard(project, "");
      }
    },
    [sidebarHistory],
  );

  const [freeChatDir, setFreeChatDir] = useState<string | null>(null);
  const [freeChatHistory, setFreeChatHistory] = useState<SessionSummary[]>([]);
  const [freeChatLoad, setFreeChatLoad] = useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: true, error: null });
  const refreshFreeChats = useCallback(async () => {
    setFreeChatLoad((current) => ({ ...current, loading: true }));
    try {
      const dir = await resolveFreeChatDir();
      setFreeChatDir(dir);
      setFreeChatHistory(await listSessionsByProject(dir));
      setFreeChatLoad({ loading: false, error: null });
    } catch (error) {
      console.warn("Could not load chats", error);
      setFreeChatLoad({ loading: false, error: "Couldn’t load your chats." });
    }
  }, []);
  useEffect(() => {
    void refreshFreeChats();
  }, [chatViewOpen, refreshFreeChats]);
  useEffect(() => {
    saveFreeChatView({
      open: chatViewOpen,
      ...(freeChatId ? { activeId: freeChatId } : {}),
    });
  }, [chatViewOpen, freeChatId]);
  // Reopen the chat that was in front before a restart; a blank one was
  // never saved, so it is simply forgotten.
  useEffect(() => {
    if (!chatViewOpen || !freeChatId) return;
    if (sessionsRef.current.some((session) => session.id === freeChatId))
      return;
    const id = freeChatId;
    void ensureOpenSession(id).then((session) => {
      if (!session && freeChatIdRef.current === id) setFreeChatId(undefined);
    });
  }, [chatViewOpen, freeChatId, ensureOpenSession]);
  const freeChatUsage = useMemo(() => {
    if (!freeChat) return undefined;
    return {
      id: freeChat.id,
      harness: freeChat.harness,
      model: freeChat.model,
      authRequired: latestTurnNeedsHarnessLogin(freeChat.blocks),
      providerAccountId:
        freeChat.providerAccountId ??
        (freeChat.blocks.some((block) => block.role === "user")
          ? DEFAULT_PROVIDER_ACCOUNT_ID
          : undefined),
    };
  }, [
    freeChat?.id,
    freeChat?.harness,
    freeChat?.model,
    freeChat?.blocks,
    freeChat?.providerAccountId,
  ]);
  const freeChatList = useMemo(
    () =>
      freeChatRows({
        stored: freeChatHistory,
        live: promptableSessions,
        unseen: unseenFinishedIds,
      }),
    [freeChatHistory, promptableSessions, unseenFinishedIds],
  );
  const freeChatIndicator = useMemo(
    () => freeChatBadge(freeChatList),
    [freeChatList],
  );

  const onOpenChat = useCallback(() => {
    if (chatViewOpenRef.current) return;
    openFreeChat();
  }, [openFreeChat]);

  /** Opens a fresh chat on the Chat page, or `beside` the one open there. */
  const onNewChat = useCallback(async (beside = false) => {
    const show = (id: string) =>
      beside ? void onOpenBeside(id) : openFreeChat(id);
    // A blank chat is reused rather than piling up empty ones. One holding
    // a typed draft or a board card's prompt is not blank. Beside, the blank
    // chat already open on the left does not count.
    const blank = sessionsRef.current.find(
      (session) =>
        isFreeChatSession(session) &&
        !session.ephemeral &&
        !session.busy &&
        session.blocks.length === 0 &&
        !session.composerSeed &&
        !getComposerDraft(session.id)?.trim() &&
        !(beside && session.id === freeChatIdRef.current),
    );
    if (blank) {
      show(blank.id);
      return;
    }
    const dir = await resolveFreeChatDir().catch((error) => {
      console.warn("Could not create the chat folder", error);
      return null;
    });
    if (!dir) {
      setFreeChatLoad({
        loading: false,
        error: "Couldn’t create the private folder chats run in.",
      });
      openFreeChat();
      return;
    }
    setFreeChatDir(dir);
    const session = newFreeChatSession(dir, sessionDefaults?.runtimeMode);
    const next = [...sessionsRef.current, session];
    sessionsRef.current = next;
    setSessions(next);
    show(session.id);
  }, [onOpenBeside, openFreeChat, sessionDefaults?.runtimeMode]);

  const onRenameFreeChat = useCallback(
    async (id: string, title: string) => {
      await onRenameHistorySession(id, title);
      void refreshFreeChats();
    },
    [onRenameHistorySession, refreshFreeChats],
  );
  const onPinFreeChat = useCallback(
    async (id: string, pinned: boolean) => {
      await onPinHistorySession(id, pinned);
      void refreshFreeChats();
    },
    [onPinHistorySession, refreshFreeChats],
  );
  const onDeleteFreeChat = useCallback(
    async (id: string) => {
      const confirmed = await ask(
        "Delete this chat? This can’t be undone.",
        { title: "Irgatos", kind: "warning" },
      );
      if (!confirmed) return;
      const removed = await onRemoveHistorySession(id, "delete", true);
      if (!removed) return;
      if (freeChatIdRef.current === id) setFreeChatId(undefined);
      void refreshFreeChats();
    },
    [onRemoveHistorySession, refreshFreeChats],
  );
  const onFreeChatBoard = useCallback(
    async (id: string) => {
      if (!(await ensureOpenSession(id))) return;
      await onSessionBoard(id);
    },
    [ensureOpenSession, onSessionBoard],
  );

  const onOpenAutomationSession = useCallback(
    async (sessionId: string) => {
      const session = await ensureOpenSession(sessionId);
      if (!session)
        throw new Error("This conversation is no longer available.");
      if (isFreeChatSession(session)) {
        openFreeChat(session.id);
        return;
      }
      setAutomationsViewOpen(false);
      setKanbanViewOpen(false);
      setFleetViewOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSettingsOpen(false);
      setFilePickerOpen(false);
      setSidebarTab("sessions", session.cwd);
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      await onSelectHistorySession(sessionId);
    },
    [ensureOpenSession, onSelectHistorySession, openFreeChat],
  );

  const openSettings = useCallback(
    (section?: SettingsSectionId, anchor?: SettingsAnchor) => {
      workspaceNavigation.cancel();
      if (!settingsOpenRef.current) {
        settingsReturnViewRef.current = {
          search: searchViewOpenRef.current,
          inbox: inboxViewOpenRef.current,
          notes: notesViewOpenRef.current,
          automations: automationsViewOpenRef.current,
          kanban: kanbanViewOpenRef.current,
          fleet: fleetViewOpenRef.current,
          chat: chatViewOpenRef.current,
          mail: mailViewOpenRef.current,
          ideas: ideasViewOpenRef.current,
          feed: feedViewOpenRef.current,
        };
      }
      startTransition(() => {
        setFilePickerOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setAutomationsViewOpen(false);
        setKanbanViewOpen(false);
        setFleetViewOpen(false);
        if (section) {
          setSettingsSection(section);
          saveSettingsSection(section);
        }
        setSettingsAnchor(anchor ?? null);
        setNotificationProjectPath(null);
        setSettingsOpen(true);
      });
    },
    [],
  );

  const onOpenSettings = useCallback(() => openSettings(), [openSettings]);
  useEffect(() => {
    const openConnections = () => openSettings("connections");
    window.addEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
    return () =>
      window.removeEventListener(OPEN_CONNECTIONS_EVENT, openConnections);
  }, [openSettings]);
  const [remoteProjectDialogOpen, setRemoteProjectDialogOpen] = useState(false);
  useEffect(() => {
    const open = () => setRemoteProjectDialogOpen(true);
    window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
    return () => window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
  }, []);

  useEffect(() => {
    const onOpenMcp = () => openSettings("mcp");
    window.addEventListener("irgat:open-mcp-settings", onOpenMcp);
    return () =>
      window.removeEventListener("irgat:open-mcp-settings", onOpenMcp);
  }, [openSettings]);

  const onOpenNotificationSettings = useCallback(
    (path?: string) => {
      openSettings("inbox", "project-notifications");
      setNotificationProjectPath(path ?? null);
      setNotificationSettingsRequest((request) => request + 1);
    },
    [openSettings],
  );

  const onOpenInboxIntegrations = useCallback(
    (source: ConnectableInboxSource) => openSettings("inbox", source),
    [openSettings],
  );

  const onCloseSettings = useCallback(() => {
    const returnView = settingsReturnViewRef.current;
    setSearchViewOpen(returnView.search);
    setInboxViewOpen(returnView.inbox);
    setNotesViewOpen(returnView.notes && loadNotesEnabled());
    setAutomationsViewOpen(returnView.automations);
    setKanbanViewOpen(returnView.kanban);
    setFleetViewOpen(returnView.fleet);
    setChatViewOpen(!!returnView.chat);
    setMailViewOpen(!!returnView.mail);
    setIdeasViewOpen(!!returnView.ideas);
    setFeedViewOpen(!!returnView.feed);
    setSettingsOpen(false);
  }, []);

  const onSelectSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    saveSettingsSection(section);
  }, []);

  const onOpenArchivedSession = useCallback(
    (sessionId: string) => {
      setSettingsOpen(false);
      void onSelectHistorySession(sessionId);
    },
    [onSelectHistorySession],
  );

  const onRailBack = useCallback(() => {
    if (settingsOpen) {
      onCloseSettings();
      return;
    }
    if (searchViewOpen) {
      setSearchViewOpen(false);
      return;
    }
    if (inboxViewOpen) {
      setInboxViewOpen(false);
      return;
    }
    if (notesViewOpen) {
      setNotesViewOpen(false);
      return;
    }
    if (automationsViewOpen) {
      setAutomationsViewOpen(false);
      return;
    }
    if (kanbanViewOpen) {
      setKanbanViewOpen(false);
      return;
    }
    if (fleetViewOpen) {
      setFleetViewOpen(false);
      return;
    }
    if (chatViewOpen) {
      setChatViewOpen(false);
      return;
    }
    if (mailViewOpen) {
      setMailViewOpen(false);
      return;
    }
    if (ideasViewOpen) {
      setIdeasViewOpen(false);
      return;
    }
    if (feedViewOpen) {
      setFeedViewOpen(false);
      return;
    }
    if (irgatViewIdRef.current) {
      closeIrgatView();
      setComposerFocused(true);
      return;
    }
    onVisitBack();
  }, [
    onCloseSettings,
    onVisitBack,
    closeIrgatView,
    searchViewOpen,
    settingsOpen,
    inboxViewOpen,
    notesViewOpen,
    automationsViewOpen,
    kanbanViewOpen,
    fleetViewOpen,
    mailViewOpen,
    ideasViewOpen,
    feedViewOpen,
    chatViewOpen,
  ]);

  const onRailForward = useCallback(() => {
    setSearchViewOpen(false);
    setSettingsOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setKanbanViewOpen(false);
    setFleetViewOpen(false);
    onVisitForward();
  }, [onVisitForward]);

  useEffect(() => {
    if (sidebarTab === "inbox") setSidebarTab("sessions");
  }, [sidebarTab]);

  useEffect(() => {
    if (!dockVisible) setProjectTerminalFocused(false);
  }, [dockVisible]);

  const openFilePaths = useMemo(() => {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const tab of tabs) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (!isFilesystemTab(file) || seen.has(file.path)) continue;
          seen.add(file.path);
          paths.push(file.path);
        }
      }
    }
    return paths;
  }, [tabs]);

  useEffect(() => {
    void invoke("set_traffic_lights_visible", { visible: true }).catch(
      () => {},
    );
  }, []);

  const onSessionNavigationOrder = useCallback((ids: readonly string[]) => {
    sessionNavigationIdsRef.current = ids;
  }, []);

  const onNavigateSessionList = useCallback(
    (delta: number, inCurrentTab = false) => {
      const activeWorkspace = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      if (!activeWorkspace || activeWorkspace.diffFocused) return;
      const current = sessionsRef.current.find(
        (session) => session.id === activeWorkspace.focusedId,
      );
      if (!current) return;
      const remoteProject = isRemoteProjectPath(current.cwd);
      const navigationId = remoteProject
        ? remoteSessionFor(current.id)
        : current.id;
      if (!navigationId) return;

      const next = adjacentItemId(
        sessionNavigationIdsRef.current,
        navigationId,
        delta,
      );
      if (!next || next === navigationId) return;
      if (remoteProject) {
        if (inCurrentTab) {
          rememberRemoteSession(current.id, next);
          setComposerFocused(true);
        } else {
          onSelectRemoteSession(current.cwd, next);
        }
        return;
      }
      // Stepping gives no hover to warm the transcript, so load the one a
      // further step away once this switch has its own session.
      const prefetchAhead = () => {
        const ahead = adjacentItemId(
          sessionNavigationIdsRef.current,
          next,
          delta,
        );
        if (ahead && ahead !== current.id) onPrefetchHistorySession(ahead);
      };
      if (!inCurrentTab) {
        void onSelectHistorySession(next).then(prefetchAhead);
        return;
      }
      const activeTabId = activeWorkspace.id;
      const focusedId = current.id;
      void ensureOpenSession(next).then((session) => {
        prefetchAhead();
        if (!session || session.inboxAsk) return;
        if (activeTabIdRef.current !== activeTabId) return;
        const currentTab = tabsRef.current.find(
          (tab) => tab.id === activeTabId,
        );
        if (currentTab?.focusedId !== focusedId) return;
        setTabs(
          (prev) =>
            switchSessionInTab(prev, activeTabId, focusedId, next) ?? prev,
        );
        setComposerFocused(true);
        const linkedUpdate = linkedSessionUpdatesRef.current.get(next);
        if (linkedUpdate) revealLinkedSessionUpdate(next, linkedUpdate);
      });
    },
    [
      ensureOpenSession,
      onPrefetchHistorySession,
      onSelectHistorySession,
      onSelectRemoteSession,
      revealLinkedSessionUpdate,
    ],
  );

  const onNavigateProjectList = useCallback(
    (delta: number) => {
      const current = normalizeProjectPath(projectCwdRef.current);
      const ids = projectRailItems(loadRecents(), current).map(
        (project) => project.path,
      );
      const next = adjacentItemId(ids, current, delta);
      if (!next || sameProjectPath(next, current)) return;
      onSelectProject(next);
    },
    [onSelectProject],
  );

  const actions = useRef({
    onNewFocused,
    onArchiveFocusedSession,
    onCloseOtherTabs,
    onCloseAllTabs,
    onCloseFocused,
    onNext,
    onPrev,
    onVisitBack,
    onVisitForward,
    onActivate,
    onSplit,
    onFocusDir,
    onToggleSidebar,
    onToggleSessionSidebar,
    onToggleIrgat,
    onGoToFile,
    onOpenCommandPalette,
    onReload,
    onFindInProject,
    onOpenSearch,
    onOpenInbox,
    onOpenNotes,
    pickProject,
    onNewTerminal,
    onNewTerminalTab,
    onToggleProjectTerminal,
    onNavigateSessionList,
    onNavigateProjectList,
    openSettings,
    onOpenApprovalSession,
    onOpenIrgat,
    onShowTerminal,
    onNewChat,
  });
  actions.current = {
    onNewFocused,
    onArchiveFocusedSession,
    onCloseOtherTabs,
    onCloseAllTabs,
    onCloseFocused,
    onNext,
    onPrev,
    onVisitBack,
    onVisitForward,
    onActivate,
    onSplit,
    onFocusDir,
    onToggleSidebar,
    onToggleSessionSidebar,
    onToggleIrgat,
    onGoToFile,
    onOpenCommandPalette,
    onReload,
    onFindInProject,
    onOpenSearch,
    onOpenInbox,
    onOpenNotes,
    pickProject,
    onNewTerminal,
    onNewTerminalTab,
    onToggleProjectTerminal,
    onNavigateSessionList,
    onNavigateProjectList,
    openSettings,
    onOpenApprovalSession,
    onOpenIrgat,
    onShowTerminal,
    onNewChat,
  };

  const debounce = useRef({ name: "", at: 0 });
  const run = useCallback((name: string, fn: () => void) => {
    const now = performance.now();
    if (name === debounce.current.name && now - debounce.current.at < 80)
      return;
    debounce.current = { name, at: now };
    // Tab shortcuts act on Browser tabs while Browser has focus.
    if (runBrowserTabCommand(name)) return;
    fn();
  }, []);

  useEffect(() => {
    if (!IS_MAC) return;
    void invoke("autosave_set_enabled", { enabled: loadAutosave() }).catch(
      console.error,
    );
    void invoke("keybindings_set_overrides", {
      overrides: loadKeybindingOverrides(),
    }).catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The Quick Composer recorder owns the next key combination, including
      // bindings that the workspace would normally handle in capture phase.
      if (document.querySelector('[data-shortcut-recorder-active="true"]'))
        return;
      // Never act on a chord while an IME is composing: tabCommand and the
      // editor guards already do, and the app shortcut resolver does too, so
      // this keeps the whole handler consistent for whatever is added next.
      if (e.isComposing) return;
      const customCommand = matchCustomKeybinding(e);
      const pressed = (command: string, defaultMatch: boolean) =>
        keybindingPressed(command, e, defaultMatch);
      // A rebound zoom chord may be Option-only, so it is resolved outside the
      // Cmd/Ctrl guard that only the browser-standard defaults need.
      const zoom = resolveZoomKeybinding(e);
      // An image preview under the pointer zooms the image instead; its own
      // listener runs next.
      if (zoom && document.querySelector("[data-image-zoom]")) return;
      if (zoom) {
        e.preventDefault();
        e.stopPropagation();
        if (zoom === "zoom-in") {
          const next = saveUiScale(zoomInUiScale(loadUiScale()));
          void applyUiScale(next);
        } else if (zoom === "zoom-out") {
          const next = saveUiScale(zoomOutUiScale(loadUiScale()));
          void applyUiScale(next);
        } else {
          saveUiScale(UI_SCALE_DEFAULT);
          void applyUiScale(UI_SCALE_DEFAULT);
        }
        return;
      }
      const cmd = customCommand
        ? tabCommandForKeybinding(customCommand, e)
        : tabCommand(e);
      if (cmd && pressed(tabCommandKeybinding(cmd), !customCommand)) {
        if (cmd === "archive-session") {
          if (e.repeat) return;
          actions.current.onArchiveFocusedSession(e);
          return;
        }
        const target = e.target instanceof Element ? e.target : null;
        const listNavigation =
          cmd === "prev-session" ||
          cmd === "next-session" ||
          cmd === "prev-session-in-tab" ||
          cmd === "next-session-in-tab" ||
          cmd === "prev-project" ||
          cmd === "next-project";
        if (listNavigation) {
          const blockedTarget = Boolean(
            target?.closest(
              'input, textarea, select, [contenteditable="true"], .cm-editor, .irgat-terminal, [role="dialog"], [data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]',
            ),
          );
          const emptyComposerTarget = Boolean(
            target?.matches('textarea[data-composer-empty="true"]'),
          );
          const surfaceOpen =
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            automationsViewOpenRef.current ||
            kanbanViewOpenRef.current ||
            fleetViewOpenRef.current ||
            mailViewOpenRef.current ||
            ideasViewOpenRef.current ||
            feedViewOpenRef.current ||
            chatViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            Boolean(whatsNewVersionRef.current);
          if (
            !shouldHandleListNavigation({
              blockedTarget,
              emptyComposerTarget,
              surfaceOpen,
            })
          ) {
            return;
          }
        }
        if (
          target?.closest(".irgat-terminal") &&
          e.ctrlKey &&
          !e.metaKey &&
          (cmd === "back" ||
            cmd === "forward" ||
            /Mac|iPhone|iPad/.test(navigator.platform))
        ) {
          return;
        }
        if (
          (cmd === "split-right" || cmd === "split-down") &&
          target?.closest(".cm-editor")
        ) {
          return;
        }
        const inPicker =
          target &&
          target.closest(
            "[data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]",
          );
        if (inPicker && typeof cmd === "object" && "activate" in cmd) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (cmd === "new") run("new", a.onNewFocused);
        else if (cmd === "close-others")
          run("close-others", a.onCloseOtherTabs);
        else if (cmd === "close-all") run("close-all", a.onCloseAllTabs);
        else if (cmd === "close") run("close", a.onCloseFocused);
        else if (cmd === "next") run("next", a.onNext);
        else if (cmd === "prev") run("prev", a.onPrev);
        else if (cmd === "cycle-next") run("next", a.onNext);
        else if (cmd === "cycle-prev") run("prev", a.onPrev);
        else if (cmd === "back") run("back", a.onVisitBack);
        else if (cmd === "forward") run("forward", a.onVisitForward);
        else if (cmd === "split-right")
          run("split-right", () => a.onSplit("right"));
        else if (cmd === "split-down")
          run("split-down", () => a.onSplit("down"));
        else if (cmd === "new-terminal") run("new-terminal", a.onNewTerminal);
        else if (cmd === "new-terminal-tab")
          run("new-terminal-tab", a.onNewTerminalTab);
        else if (cmd === "toggle-terminal")
          run("toggle-terminal", a.onToggleProjectTerminal);
        else if (cmd === "prev-session")
          run("prev-session", () => a.onNavigateSessionList(-1));
        else if (cmd === "next-session")
          run("next-session", () => a.onNavigateSessionList(1));
        else if (cmd === "prev-session-in-tab")
          run("prev-session-in-tab", () => a.onNavigateSessionList(-1, true));
        else if (cmd === "next-session-in-tab")
          run("next-session-in-tab", () => a.onNavigateSessionList(1, true));
        else if (cmd === "prev-project")
          run("prev-project", () => a.onNavigateProjectList(-1));
        else if (cmd === "next-project")
          run("next-project", () => a.onNavigateProjectList(1));
        else if (typeof cmd === "object" && "focus" in cmd)
          run(`focus-${cmd.focus}`, () => a.onFocusDir(cmd.focus));
        else if (typeof cmd === "object" && "activate" in cmd)
          run(`activate-${cmd.activate}`, () => a.onActivate(cmd.activate));
        return;
      }
      if (
        !searchViewOpenRef.current &&
        !inboxViewOpenRef.current &&
        !notesViewOpenRef.current &&
        !automationsViewOpenRef.current &&
        !kanbanViewOpenRef.current &&
        !fleetViewOpenRef.current &&
        !mailViewOpenRef.current &&
        !ideasViewOpenRef.current &&
        !feedViewOpenRef.current &&
        !chatViewOpenRef.current &&
        !(
          e.target instanceof Element &&
          e.target.closest("[data-session-drop], [data-agent-tab]")
        ) &&
        handleEditorFindKey(e)
      ) {
        e.stopPropagation();
        return;
      }
      const shortcut = resolveAppShortcut(e);
      if (shortcut) {
        if (
          shortcut === "App: Search" &&
          e.target instanceof Element &&
          e.target.closest(".irgat-terminal") &&
          e.ctrlKey &&
          !e.metaKey
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (shortcut === "App: New Window")
          run("new_window", () => void invoke("open_new_window"));
        else if (shortcut === "App: Open Project")
          run("open_project", () => void a.pickProject());
        else if (shortcut === "App: Toggle Sidebar")
          run("toggle_sidebar", a.onToggleSidebar);
        else if (shortcut === "App: Toggle Session Sidebar")
          run("toggle_session_sidebar", a.onToggleSessionSidebar);
        else if (shortcut === "App: Toggle Irgat")
          run("toggle_irgat", a.onToggleIrgat);
        else if (shortcut === "App: Go to File")
          run("go_to_file", a.onGoToFile);
        else if (shortcut === "App: Command Palette")
          run("open_command_palette", a.onOpenCommandPalette);
        else if (shortcut === "View: Reload") run("reload", a.onReload);
        else if (shortcut === "App: Search") run("open_search", a.onOpenSearch);
        else if (shortcut === "App: Settings")
          run("open_settings", () => a.openSettings());
        else if (shortcut === "App: Find in Files")
          run("find_in_project", a.onFindInProject);
        else if (shortcut === "App: New Chat")
          run("new_chat", () => void a.onNewChat());
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run]);

  useEffect(() => {
    const unlisten: Array<Promise<() => void>> = [
      listen("new_tab", () => run("new", actions.current.onNewFocused)),
      listen("close_other_tabs", () =>
        run("close-others", actions.current.onCloseOtherTabs),
      ),
      listen("close_all_tabs", () =>
        run("close-all", actions.current.onCloseAllTabs),
      ),
      listen("close_tab", () => run("close", actions.current.onCloseFocused)),
      listen<boolean>("toggle_autosave", ({ payload }) => {
        const saved = saveAutosave(payload);
        if (saved !== payload && IS_MAC) {
          void invoke("autosave_set_enabled", { enabled: saved });
        }
      }),
      listen("next_tab", () => run("next", actions.current.onNext)),
      listen("prev_tab", () => run("prev", actions.current.onPrev)),
      listen("back_tab", () => run("back", actions.current.onVisitBack)),
      listen("forward_tab", () =>
        run("forward", actions.current.onVisitForward),
      ),
      listen("split_right", () =>
        run("split-right", () => actions.current.onSplit("right")),
      ),
      listen("split_down", () =>
        run("split-down", () => actions.current.onSplit("down")),
      ),
      listen("new_terminal", () =>
        run("new-terminal", actions.current.onNewTerminal),
      ),
      listen("new_terminal_tab", () =>
        run("new-terminal-tab", actions.current.onNewTerminalTab),
      ),
      listen("toggle_terminal", () =>
        run("toggle-terminal", actions.current.onToggleProjectTerminal),
      ),
      listen("focus_left", () =>
        run("focus-left", () => actions.current.onFocusDir("left")),
      ),
      listen("focus_right", () =>
        run("focus-right", () => actions.current.onFocusDir("right")),
      ),
      listen("focus_up", () =>
        run("focus-up", () => actions.current.onFocusDir("up")),
      ),
      listen("focus_down", () =>
        run("focus-down", () => actions.current.onFocusDir("down")),
      ),
      listen("toggle_sidebar", () =>
        run("toggle_sidebar", actions.current.onToggleSidebar),
      ),
      listen("toggle_session_sidebar", () =>
        run("toggle_session_sidebar", actions.current.onToggleSessionSidebar),
      ),
      listen("open_project", () => {
        void actions.current.pickProject();
      }),
      listen("go_to_file", () => run("go_to_file", actions.current.onGoToFile)),
      listen("open_command_palette", () =>
        run("open_command_palette", actions.current.onOpenCommandPalette),
      ),
      listen("reload", () => run("reload", actions.current.onReload)),
      listen("open_search", () => actions.current.onOpenSearch()),
      listen("open_inbox", () => actions.current.onOpenInbox()),
      listen("open_notes", () => actions.current.onOpenNotes()),
      listen("open_settings", () => actions.current.openSettings()),
      listen("check_for_updates", () => {
        void runUpdateFlow(true);
      }),
      listen("sidebar_opacity", () => {
        actions.current.openSettings("appearance");
      }),
      listen("find_in_project", () => actions.current.onFindInProject()),
      listen("find", () => {
        openFindInActiveEditor();
      }),
      listen("open_model_picker", () => {
        window.dispatchEvent(new Event("open_model_picker"));
      }),
      // Every window hears the click; only the one holding the session acts.
      listen<string>(NOTIFICATION_CLICK_EVENT, ({ payload: target }) => {
        const terminalId = terminalIdFromTarget(target);
        const holds = terminalId
          ? projectTerminalsRef.current.some((entry) =>
              entry.pane.files.some((file) => file.id === terminalId),
            ) ||
            tabsRef.current.some((tab) =>
              (tab.terminalPanes ?? []).some((pane) =>
                pane.files.some((file) => file.id === terminalId),
              ),
            )
          : sessionsRef.current.some((s) => s.id === target);
        if (!holds) return;
        const win = getCurrentWindow();
        // Windows leaves a minimized window minimized when it is only focused.
        void win
          .unminimize()
          .then(() => win.setFocus())
          .catch(() => {});
        const irgat = terminalId ? undefined : irgatForSession(target);
        if (terminalId) actions.current.onShowTerminal(terminalId);
        else if (irgat) void actions.current.onOpenIrgat(irgat.id, target);
        else actions.current.onOpenApprovalSession(target);
      }),
      listen("zoom_in", () => {
        const next = zoomInUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_out", () => {
        const next = zoomOutUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_reset", () => {
        saveUiScale(UI_SCALE_DEFAULT);
        void applyUiScale(UI_SCALE_DEFAULT);
      }),
    ];
    return () => {
      void Promise.all(unlisten).then((fns) => fns.forEach((fn) => fn()));
    };
  }, [run]);

  const dockGridRef = useRef<HTMLDivElement>(null);
  const dockDragSize = useRef<number | null>(null);
  const paintDockSize = useCallback((size: number) => {
    const dock = findProjectTerminal(
      projectTerminalsRef.current,
      viewDockRef.current.path,
    );
    const el = dockGridRef.current;
    if (!dock || !el || viewDockRef.current.kind === "chat") return;
    dockDragSize.current = size;
    applyDockGridStyle(el, dock.side, size);
  }, []);
  const commitDockSize = useCallback(
    (size: number) => {
      dockDragSize.current = null;
      onProjectTerminalSize(size);
    },
    [onProjectTerminalSize],
  );
  // The chat's dock lives in the chat view, so the workspace grid leaves it.
  const workspaceDocks = useMemo(
    () => projectTerminals.filter((dock) => !isFreeChatCwd(dock.projectPath)),
    [projectTerminals],
  );
  const chatDocks = useMemo(
    () => projectTerminals.filter((dock) => isFreeChatCwd(dock.projectPath)),
    [projectTerminals],
  );
  // Each chat dock renders once, into a host node the chat view adopts while
  // it is open, so leaving the chat keeps its shells alive.
  const chatDockHosts = useRef(new Map<string, HTMLDivElement>());
  const chatDockHost = useCallback((projectPath: string) => {
    const key = pathKey(projectPath);
    let host = chatDockHosts.current.get(key);
    if (!host) {
      host = document.createElement("div");
      host.className = "h-full min-h-0 min-w-0";
      chatDockHosts.current.set(key, host);
    }
    return host;
  }, []);
  const paintChatDockSize = useCallback(
    (size: number) => {
      const slot = chatDockHost(viewDockRef.current.path).parentElement;
      if (slot) slot.style.height = `${size}px`;
    },
    [chatDockHost],
  );
  // The status bar's Terminal button in an Irgat or chat, acting on its dock.
  const viewTerminalFooterProps = dockTerminalAllowed
    ? {
        onNewTerminal,
        onShowTerminal: onShowProjectTerminal,
        projectTerminalActive:
          !!currentProjectDock && currentProjectDock.pane.files.length > 0,
      }
    : {};
  const workspaceDockShown =
    dockVisible && currentViewDock.kind !== "chat" && !!currentProjectDock;
  useLayoutEffect(() => {
    if (dockDragSize.current != null) return;
    const el = dockGridRef.current;
    if (!el) return;
    applyDockGridStyle(
      el,
      workspaceDockShown && currentProjectDock ? currentProjectDock.side : null,
      currentProjectDock?.size ?? 0,
    );
  }, [currentProjectDock, workspaceDockShown]);

  const lastRemoteSnapshot = useRef(new Map<string, HostSession>());
  const onRemoteSnapshot = useCallback(
    (shellId: string, snapshot?: HostSession) => {
      if (!snapshot) {
        lastRemoteSnapshot.current.delete(shellId);
        setSessions((current) =>
          current.map((entry) =>
            entry.id === shellId
              ? {
                  ...entry,
                  title: "New remote session",
                  blocks: [],
                  busy: false,
                }
              : entry,
          ),
        );
        return;
      }
      if (lastRemoteSnapshot.current.get(shellId) === snapshot) return;
      lastRemoteSnapshot.current.set(shellId, snapshot);
      setSessions((current) => {
        const shell = current.find((entry) => entry.id === shellId);
        if (!shell) return current;
        const project = remoteProjectFor(shell.cwd);
        if (!project) return current;
        return current.map((entry) =>
          entry.id === shellId
            ? remoteSessionState(entry, snapshot, project)
            : entry,
        );
      });
    },
    [],
  );

  const onManageWorktrees = useCallback(
    () => openSettings("worktrees"),
    [openSettings],
  );

  useFloatingIrgat(sessions, irgatsSnap, irgatsEnabled, {
    open: (irgatId) =>
      ensureIrgatSession(irgatId, {
        home: homeDir,
        load: ensureOpenSession,
        create: newDefaultSession,
        add: (created) => {
          sessionsRef.current = [...sessionsRef.current, created];
          setSessions(sessionsRef.current);
        },
      }),
    submit: onSubmit,
    stop: onStop,
    approval: onApproval,
    question: onQuestionReply,
    questionInteraction: onQuestionInteraction,
    reveal: onOpenIrgat,
    openArtifact: async (irgatId, id) => {
      await onOpenIrgat(irgatId);
      const sessionId = findIrgat(irgatId)?.sessionId;
      if (sessionId) onOpenIrgatArtifact(sessionId, id);
    },
    openFile: onOpenFile,
    resume: onUsageLimitResume,
    create: () => createIrgat().id,
  });

  const sessionPaneProps = {
    onSelectProviderAccount,
    onManageProviderAccounts: () =>
      openSettings("providers", "provider-accounts"),
    workspaceSwitchingSessionId: workspaceNavigation.pending
      ? active?.id
      : undefined,
    recents,
    hideProjectPicker: true,
    onFocus: onFocusPane,
    onClose: onClosePane,
    onNewBeside: onNewSessionBeside,
    onCwdChange,
    onBranchChange,
    onWorktreeChange: onComposerWorktreeChange,
    onRemoteSnapshot,
    onWorkspaceModeChange,
    onWorktreeBaseChange,
    onManageWorktrees,
    onModelChange,
    onModelSettingsChange,
    onRuntimeModeChange,
    onSaveDraft,
    onRemoveDraft,
    onSubmit,
    onStop,
    onCompactContext,
    onPlaceSessionInFolder,
    onDeleteQueuedMessage,
    onEditQueuedMessage,
    onQueuedMessageEditingChange,
    onSteerQueuedMessage,
    onResumeQueue,
    onUsageLimitResume,
    onUsageLimitResumeAtReset,
    onUsageLimitDismiss,
    onUsageLimitAccountChange,
    onResumeInterrupted,
    onDismissInterrupted,
    onRunQueueAnyway,
    onInboxCardDismiss,
    onLinkedWorkItemUpdateCardDismiss,
    onNoteCardDismiss,
    onHandoffCardDismiss,
    onOpenLinkedWorkItem,
    onArchiveSession: onArchiveHistorySession,
    onDeleteSession: onDeleteHistorySession,
    onApproval,
    onQuestionReply,
    onQuestionInteraction,
    onOpenFile,
    onOpenDiff,
    onOpenPlan,
    onBuildPlan,
    onSecondOpinion,
    onHandoff,
    onBtwSubmit,
    onBtwRetry,
    onBtwDelete,
    onBtwStop,
    onBtwModelChange,
    onNewTerminal: onNewTerminalInSession,
  };

  // Renames, mascot picks and new projects show up on the rail.
  const irgatViewIrgat = irgatViewId ? irgatForSession(irgatViewId) : undefined;
  const reviewIrgat =
    irgatViewIrgat ??
    (active && !activeFile ? irgatForSession(active.id) : undefined);
  const activeReviewScope = reviewIrgat
    ? irgatReviewScope(reviewIrgat.id)
    : sidebarCwd && sidebarCwd !== "~"
      ? projectReviewScope(sidebarCwd)
      : null;
  useEffect(() => {
    setActiveReviewScope(activeReviewScope);
  }, [activeReviewScope]);
  const selectedIrgatActivity = resolveIrgatActivity(
    irgatActivity,
    irgatViewSession,
  );
  const irgatSidebarOpen = irgatOverviewOpen || !!selectedIrgatActivity;
  const irgatViewBlocks = irgatViewSession?.blocks;
  const irgatViewBusy = !!irgatViewSession?.busy;
  const irgatEditedPaths = useMemo(
    () =>
      irgatViewBlocks && !irgatViewBusy
        ? sessionEditPaths(irgatViewBlocks)
        : undefined,
    [irgatViewBlocks, irgatViewBusy],
  );
  // The session's changes, on the overview's tab instead of under a message.
  const irgatChangeTotals = useSessionChangeTotals(
    irgatViewSession?.id ?? "",
    irgatViewCwd,
    {
      enabled: !irgatViewSession?.worktreeRemoved,
      busy: irgatViewBusy,
      editedPaths: irgatEditedPaths,
    },
  );
  // The Irgat's other chats launch sessions too; its list shows them all.
  // A chat that is not open is read once from the store.
  const irgatChatIds = irgatViewIrgat ? allIrgatSessionIds(irgatViewIrgat) : [];
  const [savedIrgatChats, setSavedIrgatChats] = useState<
    ReadonlyMap<string, readonly Block[]>
  >(() => new Map());
  const unloadedIrgatChatsKey = JSON.stringify(
    irgatChatIds.filter(
      (id) =>
        !savedIrgatChats.has(id) &&
        !sessions.some((session) => session.id === id),
    ),
  );
  useEffect(() => {
    const ids: string[] = JSON.parse(unloadedIrgatChatsKey);
    if (ids.length === 0) return;
    let current = true;
    void Promise.all(ids.map((id) => getSession(id).catch(() => null))).then(
      (stored) => {
        if (!current) return;
        setSavedIrgatChats((previous) => {
          const next = new Map(previous);
          stored.forEach((session, index) =>
            next.set(ids[index], session?.blocks ?? []),
          );
          return next;
        });
      },
    );
    return () => {
      current = false;
    };
  }, [unloadedIrgatChatsKey]);
  // Receipts are parsed once per block, so this is cheap to redo; the list
  // keeps its identity until a launch is added.
  const nextIrgatLaunches = irgatViewSession
    ? irgatLaunchesAcrossChats(irgatChatIds, irgatViewSession.id, (id) =>
        id === irgatViewSession.id
          ? irgatViewSession.blocks
          : (sessions.find((session) => session.id === id)?.blocks ??
            savedIrgatChats.get(id)),
      )
    : [];
  const irgatLaunchesRef = useRef(nextIrgatLaunches);
  if (
    JSON.stringify(irgatLaunchesRef.current) !==
    JSON.stringify(nextIrgatLaunches)
  )
    irgatLaunchesRef.current = nextIrgatLaunches;
  const irgatLaunches = irgatLaunchesRef.current;
  const irgatDocuments = useMemo(
    () => (irgatViewBlocks ? artifactCards(irgatViewBlocks) : []),
    [irgatViewBlocks],
  );
  // Another sidebar opened over it hides the overview until that one closes.
  const irgatOverviewShown = irgatOverviewOpen && !selectedIrgatActivity;
  const irgatActivityPanel =
    irgatViewIrgat && irgatViewSession && selectedIrgatActivity ? (
      <IrgatActivityPanel
        key={`${irgatViewIrgat.id}:${selectedIrgatActivity.turnId}`}
        agent={irgatLook(irgatViewIrgat)}
        blocks={selectedIrgatActivity.blocks}
        live={selectedIrgatActivity.live}
        cwd={sessionWorkCwd(irgatViewSession)}
        onClose={() => setIrgatActivity(null)}
        onApproval={
          irgatViewSession.worktreeRemoved
            ? undefined
            : (requestId, decision) =>
                onApproval(irgatViewSession.id, requestId, decision)
        }
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
        windowControls={irgatCovers && !IS_MAC ? <WindowControls /> : undefined}
      />
    ) : null;
  // Status for the cards of the sessions the open Irgat launched, rebuilt only
  // when one changes state or title rather than on every streamed token. One
  // that is no longer open cannot be running, so it reads as done.
  // A card names its session as the sidebar does. One that is not open has
  // its saved title fetched, rather than the prompt it was launched with, so
  // opening it does not rename the card.
  const [storedLaunchTitles, setStoredLaunchTitles] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const unopenedLaunchesKey = JSON.stringify(
    irgatLaunches.flatMap((launch) =>
      storedLaunchTitles.has(launch.sessionId) ||
      sessions.some((entry) => entry.id === launch.sessionId)
        ? []
        : [launch.sessionId],
    ),
  );
  useEffect(() => {
    const ids: string[] = JSON.parse(unopenedLaunchesKey);
    if (ids.length === 0) return;
    let current = true;
    void Promise.all(ids.map((id) => getSession(id).catch(() => null))).then(
      (stored) => {
        if (!current) return;
        setStoredLaunchTitles((previous) => {
          const next = new Map(previous);
          stored.forEach((session, index) =>
            next.set(ids[index], session?.title ?? ""),
          );
          return next;
        });
      },
    );
    return () => {
      current = false;
    };
  }, [unopenedLaunchesKey]);
  const irgatLaunchesKey = JSON.stringify(
    irgatLaunches.map((launch) => {
      const live = sessions.find((entry) => entry.id === launch.sessionId);
      return live
        ? [launch.sessionId, launchedSessionState(live), live.title]
        : [
            launch.sessionId,
            "done",
            storedLaunchTitles.get(launch.sessionId) || launch.title,
          ];
    }),
  );
  const irgatLaunchedSessions = useMemo(
    () =>
      new Map<string, LaunchedSessionView>(
        (
          JSON.parse(irgatLaunchesKey) as [
            string,
            LaunchedSessionState,
            string,
          ][]
        ).map(([id, state, title]) => [id, { state, title }]),
      ),
    [irgatLaunchesKey],
  );
  // The view's chat with the chats opened beside it. Every Irgat chat and the
  // Chat page's chat render through this, with or without side panes, so
  // opening the first one does not remount the chat already shown.
  const withSidePanes = (
    main: ReactNode,
    mainId: string | undefined,
    showSides: boolean,
  ) => {
    const shown =
      showSides && sidePaneKey
        ? shownSidePanes(sidePanes[sidePaneKey], mainId, (id) =>
            sessions.some((session) => session.id === id),
          )
        : undefined;
    const key = sidePaneKey;
    return (
      <SidePaneRow
        main={main}
        layout={shown ?? NO_SIDE_PANES}
        panes={(shown?.ids ?? []).flatMap((id) => {
          const session = sessions.find((entry) => entry.id === id);
          if (!session) return [];
          const focused = sidePaneFocusId === id && !projectTerminalFocused;
          return [
            {
              id,
              node: (
                <SessionPane
                  {...sessionPaneProps}
                  key={id}
                  session={session}
                  visible
                  focused={focused}
                  inSplit
                  addToChatTarget={false}
                  composerFocused={focused && composerFocused}
                  composerFocusToken={composerFocusToken}
                  onFocus={() => setSidePaneFocusId(id)}
                  onClose={onCloseSidePane}
                  // Handing off or a second opinion belongs in its own tab.
                  onSecondOpinion={undefined}
                  onHandoff={undefined}
                />
              ),
            },
          ];
        })}
        onResize={(layout) =>
          key && setSidePanes((map) => ({ ...map, [key]: layout }))
        }
        onFocusMain={() => setSidePaneFocusId(null)}
        onFocusPane={(id) => {
          setSidePaneFocusId(id);
          setProjectTerminalFocused(false);
        }}
      />
    );
  };
  const irgatShownSessionPane = shownIrgatSessionId
    ? sessions.find((session) => session.id === shownIrgatSessionId)
    : undefined;
  const irgatShownSessionActive =
    !!irgatShownSessionPane && irgatShownSessionFocused;
  const irgatShownSessionView = irgatShownSessionPane
    ? {
        sessionId: irgatShownSessionPane.id,
        title: sessionDisplayTitle(
          irgatShownSessionPane.title,
          irgatShownSessionPane.harness,
        ),
        pane: (
          <SessionPane
            {...sessionPaneProps}
            session={irgatShownSessionPane}
            // The Irgat view covers the workspace, so a review opens
            // beside the chat rather than in a hidden tab.
            onOpenDiff={onOpenIrgatDiff}
            // The Irgat runs this session; handing it off or asking for a
            // second opinion belongs in its own tab.
            onSecondOpinion={undefined}
            onHandoff={undefined}
            visible={irgatCovers}
            focused={irgatShownSessionActive && !projectTerminalFocused}
            inSplit={false}
            addToChatTarget={false}
            composerFocused={
              irgatShownSessionActive &&
              composerFocused &&
              !projectTerminalFocused
            }
            composerFocusToken={composerFocusToken}
          />
        ),
      }
    : undefined;
  artifactIrgatRef.current =
    irgatViewIrgat && irgatViewSession
      ? {
          scope: irgatArtifactScope(irgatViewIrgat.id),
          sessionIds: new Set([
            irgatViewSession.id,
            ...irgatLaunches.map((launch) => launch.sessionId),
          ]),
        }
      : null;
  const irgatOverviewPanel =
    irgatViewIrgat && irgatViewSession ? (
      <IrgatOverview
        key={irgatViewIrgat.id}
        open={irgatOverviewShown}
        irgatId={irgatViewIrgat.id}
        cwd={irgatViewSession.cwd}
        agent={irgatLook(irgatViewIrgat)}
        state={irgatState(irgatViewSession)}
        launches={irgatLaunches}
        sessions={sessions}
        history={history}
        documents={irgatDocuments}
        changes={{
          sessionId: irgatViewSession.id,
          cwd: irgatViewCwd,
          totals: irgatChangeTotals,
          request: irgatChangesRequest,
          textHarness: irgatViewSession.harness,
          projects: irgatViewIrgat.projects,
        }}
        settings={{
          cwd: irgatViewSession.cwd,
          harness: irgatViewSession.harness,
          model: irgatViewSession.model,
          modelSettings: irgatViewSession.modelSettings,
          runtimeMode: irgatViewSession.runtimeMode,
          busy: !!irgatViewSession.busy,
          onModelChange: (harness, model) =>
            onModelChange(irgatViewSession.id, harness, model),
          onModelSettingsChange: (settings) =>
            onModelSettingsChange(irgatViewSession.id, settings),
          onRuntimeModeChange: (mode) =>
            onRuntimeModeChange(irgatViewSession.id, mode),
          onReset: () => onResetIrgat(irgatViewSession.id),
        }}
        tab={irgatOverviewTab}
        onTabChange={setIrgatOverviewTab}
        onOpenSession={(sessionId) =>
          showIrgatLaunchedSession(irgatViewSession.id, sessionId)
        }
        sessionActions={{
          unseenIds: unseenFinishedIds,
          interruptedIds: interruptedSessionIds,
          onRename: (sessionId, title) =>
            void onRenameHistorySession(sessionId, title),
          onArchive: (sessionId, archived) =>
            void onArchiveHistorySession(sessionId, archived),
          onDelete: (sessionId) => void onDeleteHistorySession(sessionId),
        }}
        shownSession={irgatShownSessionView}
        // Back lands on every session it started.
        onBackFromSession={() => {
          setIrgatShownSession(null);
          setIrgatShownSessionFocused(false);
        }}
        onOpenSessionInWorkspace={onOpenIrgatLaunchedSession}
        onOpenDocument={(id) => {
          setIrgatShownSession(null);
          setIrgatOverviewDocument(id);
        }}
        shownDocumentId={irgatOverviewDocument ?? undefined}
        onBackFromDocument={() => setIrgatOverviewDocument(null)}
        irgatSessionId={irgatViewSession.id}
        shownArtifactId={
          irgatOverviewTab === "artifacts"
            ? (irgatOverviewArtifact ?? undefined)
            : undefined
        }
        onOpenArtifact={(id) => {
          setIrgatShownSession(null);
          setIrgatOverviewDocument(null);
          setIrgatOverviewArtifact(id);
        }}
        onBackFromArtifact={() => setIrgatOverviewArtifact(null)}
        onOpenFile={onOpenFile}
        onClose={() => setIrgatOverviewOpen(false)}
        windowControls={irgatCovers && !IS_MAC ? <WindowControls /> : undefined}
      />
    ) : null;
  const irgatRailState = useMemo(() => {
    const states = new Map<string, IrgatState>();
    const alerts = new Map<string, RailAlertCounts>();
    for (const irgat of listIrgats()) {
      const chats = sessions.filter((entry) =>
        allIrgatSessionIds(irgat).includes(entry.id),
      );
      const session =
        chats.find((entry) => irgatState(entry).status === "needs-you") ??
        chats.find((entry) => entry.busy) ??
        chats[0];
      if (session) states.set(irgat.id, irgatState(session));
      // Chats, not replies: one busy chat must not read as thousands.
      // Only the chat on screen is read; its siblings still count.
      let needsYou = 0;
      let unread = 0;
      for (const chat of chats) {
        if (sessionNeedsInput(chat)) needsYou += 1;
        else if (
          chat.id !== irgatViewId &&
          ((irgatReplies.counts.get(chat.id) ?? 0) > 0 ||
            unseenFinishedIds.has(chat.id))
        )
          unread += 1;
      }
      if (needsYou || unread) alerts.set(irgat.id, { needsYou, unread });
    }
    return { states, alerts };
    // The roster is read through its snapshot.
  }, [
    irgatsSnap,
    sessions,
    irgatReplies.counts,
    unseenFinishedIds,
    irgatViewId,
  ]);
  const irgatRail = useStableValue(irgatRailState);
  const busyProjectPaths = useStableValue(
    promptableSessions.flatMap((session) =>
      session.busy && session.cwd ? [session.cwd] : [],
    ),
  );
  const projectAlerts = useStableValue(
    projectAlertsFromSessions(
      // Rows the project's list leaves out cannot be opened from it.
      promptableSessions.filter(
        (session) => !session.sidebarHidden && !isHabitRun(session.id),
      ),
      {
        needsYou: sessionNeedsInput,
        unread: unseenFinishedIds,
        activeSessionId,
        excluded: irgatSessionIds,
      },
    ),
  );
  const onOpenRailIrgat = useCallback(
    (irgatId: string) => void onOpenIrgat(irgatId),
    [onOpenIrgat],
  );
  const onCreateIrgatChat = useCallback(
    async (irgatId: string, beside = false) => {
      if (!findIrgat(irgatId)?.sessionId) await onOpenIrgat(irgatId);
      const irgat = findIrgat(irgatId);
      if (!irgat?.sessionId) return;
      const parent = await ensureOpenSession(irgat.sessionId);
      if (!parent) return;
      const child = createIrgatChildSession(
        irgatId,
        parent,
        (id) => sessionsRef.current.find((entry) => entry.id === id)?.title,
      );
      sessionsRef.current = [...sessionsRef.current, child];
      setSessions(sessionsRef.current);
      try {
        await upsertSession(child);
      } catch (error) {
        updateIrgat(irgatId, (current) => ({
          ...current,
          childSessionIds: current.childSessionIds?.filter(
            (id) => id !== child.id,
          ),
        }));
        sessionsRef.current = sessionsRef.current.filter(
          (session) => session.id !== child.id,
        );
        setSessions(sessionsRef.current);
        throw error;
      }
      if (beside) await onOpenBeside(child.id);
      else await onOpenIrgat(irgatId, child.id);
    },
    [ensureOpenSession, onOpenBeside, onOpenIrgat],
  );
  /**
   * Starts a new chat beside the one open: under the same Irgat on its page,
   * on the Chat page, or as a new session split right in a project.
   */
  const onNewChatBeside = useCallback(() => {
    const key = sidePaneKeyRef.current;
    if (key === "chats") {
      void onNewChat(true);
      return;
    }
    if (key) {
      void onCreateIrgatChat(key.slice("irgat:".length), true).catch(
        (error) =>
          message(String(error), {
            title: "Could not create chat",
            kind: "error",
          }),
      );
      return;
    }
    onSplit("right");
  }, [onCreateIrgatChat, onNewChat, onSplit]);
  newChatBesideRef.current = onNewChatBeside;
  const onDeleteRailIrgat = useCallback(
    (irgatId: string) => void onDeleteIrgat(irgatId),
    [onDeleteIrgat],
  );
  const onDeleteIrgatChat = useCallback(
    async (irgatId: string, sessionId: string) => {
      const irgat = findIrgat(irgatId);
      if (!irgat?.childSessionIds?.includes(sessionId)) return;
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      const confirmed = await ask(
        `Delete ${session?.title || "this chat"}? Only this conversation will be deleted. The Irgat, its memory and other chats stay. This can’t be undone.`,
        { title: "Delete chat", kind: "warning" },
      );
      if (!confirmed) return;
      const removed = await deleteIrgatChildSession(irgatId, sessionId, () =>
        onRemoveHistorySession(sessionId, "delete", true),
      );
      if (removed && irgatViewIdRef.current === sessionId)
        await onOpenIrgat(irgatId);
    },
    [onRemoveHistorySession, onOpenIrgat],
  );
  // What a Fleet row offers on right-click, as the sidebar's card does.
  // An Irgat's chats are deleted through the Irgat, so it drops them too.
  const onDeleteFleetSession = useCallback(
    (sessionId: string) => {
      const irgat = irgatForSession(sessionId);
      if (!irgat) return void onDeleteHistorySession(sessionId);
      if (irgat.sessionId === sessionId) return void onDeleteIrgat(irgat.id);
      void onDeleteIrgatChat(irgat.id, sessionId).catch((error) =>
        message(String(error), {
          title: "Could not delete chat",
          kind: "error",
        }),
      );
    },
    [onDeleteHistorySession, onDeleteIrgat, onDeleteIrgatChat],
  );
  const fleetActions = useMemo(
    () => ({
      onStop: (sessionId: string) => onStop(sessionId),
      onArchive: (sessionId: string) =>
        void onArchiveHistorySession(sessionId, true),
      canArchive: (sessionId: string) => !irgatForSession(sessionId),
      onDelete: onDeleteFleetSession,
      onBoard: (sessionId: string) => void onSessionBoard(sessionId),
      boardIds: kanbanSessions.linkedIds,
    }),
    [
      onStop,
      onArchiveHistorySession,
      onDeleteFleetSession,
      onSessionBoard,
      kanbanSessions.linkedIds,
    ],
  );
  const onDeleteRailIrgatGroup = useCallback(
    (groupId: string) => void onDeleteIrgatGroup(groupId),
    [onDeleteIrgatGroup],
  );
  const sidebarIrgatGroups = useMemo(
    () => ({
      activeId: openIrgatGroupId,
      busy: activeIrgatGroups,
      onOpen: onOpenIrgatGroup,
      onDelete: onDeleteRailIrgatGroup,
    }),
    [
      openIrgatGroupId,
      activeIrgatGroups,
      onOpenIrgatGroup,
      onDeleteRailIrgatGroup,
    ],
  );
  // The memoized sidebar only skips a streamed batch if this keeps identity.
  const sidebarIrgats = useMemo(
    () =>
      irgatsEnabled
        ? {
            activeId: irgatViewIrgat?.id,
            states: irgatRail.states,
            alerts: irgatRail.alerts,
            onOpen: onOpenRailIrgat,
            activeSessionId: irgatViewId ?? undefined,
            onOpenChat: (irgatId: string, sessionId: string) =>
              void onOpenIrgat(irgatId, sessionId),
            onOpenChatBeside: sidePaneKey
              ? (sessionId: string) => void onOpenBeside(sessionId)
              : undefined,
            onCreateChatBeside: sidePaneKey
              ? (irgatId: string) =>
                  void onCreateIrgatChat(irgatId, true).catch((error) =>
                    message(String(error), {
                      title: "Could not create chat",
                      kind: "error",
                    }),
                  )
              : undefined,
            onCreateChat: (irgatId: string) =>
              void onCreateIrgatChat(irgatId).catch((error) =>
                message(String(error), {
                  title: "Could not create chat",
                  kind: "error",
                }),
              ),
            onDeleteChat: (irgatId: string, sessionId: string) =>
              void onDeleteIrgatChat(irgatId, sessionId).catch((error) =>
                message(String(error), {
                  title: "Could not delete chat",
                  kind: "error",
                }),
              ),
            chatTitles: new Map(
              sessions.map((session) => [
                session.id,
                sessionDisplayTitle(session.title, session.harness),
              ]),
            ),
            chatStates: new Map(
              sessions.map((session) => [
                session.id,
                sessionNeedsInput(session)
                  ? ("needs-input" as const)
                  : session.busy
                    ? ("running" as const)
                    : unseenFinishedIds.has(session.id) ||
                        (session.id !== irgatViewId &&
                          (irgatReplies.counts.get(session.id) ?? 0) > 0)
                      ? ("unread" as const)
                      : ("idle" as const),
              ]),
            ),
            onRenameChat: (sessionId: string, title: string) =>
              void onRenameHistorySession(sessionId, title),
            onCreate: onCreateIrgat,
            onDelete: onDeleteRailIrgat,
            // Release notes come first; the intro waits its turn.
            introAvailable: !whatsNewVersion,
            groups: sidebarIrgatGroups,
          }
        : undefined,
    [
      irgatsEnabled,
      irgatViewIrgat?.id,
      irgatRail,
      onOpenRailIrgat,
      onOpenIrgat,
      sidePaneKey,
      onOpenBeside,
      onCreateIrgatChat,
      onDeleteIrgatChat,
      onRenameHistorySession,
      unseenFinishedIds,
      irgatReplies.counts,
      irgatViewId,
      sessions,
      onCreateIrgat,
      onDeleteRailIrgat,
      whatsNewVersion,
      sidebarIrgatGroups,
    ],
  );
  const onDismissUpdate = useCallback(() => setUpdateNotice(null), []);

  const chromeSurfaceOpen =
    searchViewOpen ||
    settingsOpen ||
    inboxViewOpen ||
    notesViewOpen ||
    automationsViewOpen ||
    kanbanViewOpen ||
    fleetViewOpen ||
    mailViewOpen ||
    ideasViewOpen ||
    feedViewOpen ||
    chatViewOpen;
  const compactProjectRail = collapsedProjectRailMode === "compact";
  const compactRailActive = compactProjectRail && !projectRailOpen;
  const compactTitleNavigation =
    IS_MAC && compactRailActive && !chromeSurfaceOpen;
  const compactTitleBar = compactTitleNavigation && !irgatCovers;
  const workspaceTitleBar = (
    <TitleBar
      // A Irgat in full view stands apart from the project's tabs.
      tabs={irgatCovers ? NO_TITLE_TABS : titleTabs}
      irgat={
        irgatCovers && irgatViewIrgat && irgatViewSession
          ? { look: irgatLook(irgatViewIrgat), state: irgatState(irgatViewSession) }
          : undefined
      }
      onToggleIrgatOverview={
        irgatCovers && irgatViewIrgat
          ? () => {
              setIrgatActivity(null);
                      setIrgatOverviewOpen(!irgatOverviewShown);
            }
          : undefined
      }
      irgatOverviewOpen={irgatOverviewShown}
      onNewIrgatChatBeside={
        irgatCovers && irgatViewIrgat ? onNewChatBeside : undefined
      }
      hideWindowControls={irgatCovers && irgatSidebarOpen && !!irgatOverviewPanel}
      activeId={irgatViewSession ? "" : activeTabId}
      cwd={sidebarCwd}
      projectRailOpen={projectRailOpen}
      sessionSidebarOpen={sessionSidebarOpen}
      compactRail={compactTitleNavigation}
      canGoBack={!!irgatViewId || tabVisitNav.canBack}
      canGoForward={tabVisitNav.canForward}
      onGoBack={onRailBack}
      onGoForward={onRailForward}
      onToggleSidebar={onToggleSidebar}
      onToggleSessionSidebar={onToggleSessionSidebar}
      onSelect={activateTab}
      onNewTerminal={onNewTerminal}
      onOpenSettings={onOpenSettings}
      onOpenInbox={onOpenInbox}
      onOpenNotes={notesEnabled ? onOpenNotes : undefined}
      onClose={onCloseTitleTab}
      onCloseMany={onCloseTabs}
      onArchiveTab={onArchiveTitleTab}
      onDeleteTab={onDeleteTitleTab}
      onReorder={onReorderTabs}
      onPlaceOnPane={onPlaceTabOnPane}
      onPinFile={onPinFile}
      recents={recents}
      onSelectProject={onSelectProject}
      reviewBadge={
        activeReviewScope ? (
          <RedlineReviewBadge scope={activeReviewScope} />
        ) : undefined
      }
    />
  );

  return (
    <ArtifactHostContext.Provider value={artifactHost}>
    <OrchestrationActions.Provider value={orchestrationActions}>
      <OrchestrationWorkers.Provider value={orchestrationWorkers}>
        <div
          className={`workspace-background flex h-full flex-col text-content ${
            HAS_NATIVE_GLASS
              ? "bg-background-base/[var(--window-background-opacity)]"
              : "bg-background-base"
          }`}
        >
          {compactTitleBar ? workspaceTitleBar : null}
          <div className="flex min-h-0 min-w-0 flex-1">
            <Sidebar
              cwd={sidebarCwd}
              gitCwd={gitCwd}
              worktreeTabStats={worktreeTabStats}
              onSelectWorkspace={onSelectWorkspace}
              workspaceSwitchPending={
                workspaceNavigation.pending?.project === sidebarCwd
              }
              workspaceSwitchError={
                workspaceNavigation.error?.project === sidebarCwd
                  ? workspaceNavigation.error.message
                  : undefined
              }
              explorerRootLabel={explorerRootLabel}
              open={sessionSidebarOpen}
              tab={sidebarTab}
              onTabChange={setSidebarTab}
              filesSearchOpen={filesSearchOpen}
              onFilesSearchOpenChange={setFilesSearchOpen}
              onOpenFilesSearch={onFindInProject}
              searchFocusToken={searchFocusToken}
              sessions={sidebarHistory}
              busySessionIds={busySessionIds}
              approvalSessionIds={approvalSessionIds}
              interruptedSessionIds={interruptedSessionIds}
              activeSessionId={activeSessionId}
              status={historyFailed ? "error" : "idle"}
              pending={historyPending}
              onSelectSession={onSelectHistorySession}
              onSelectRemoteSession={onSelectRemoteSession}
              onRemoteSessionDeleted={onRemoteSessionDeleted}
              onPrefetchSession={onPrefetchHistorySession}
              onSessionNavigationOrder={onSessionNavigationOrder}
              onPlaceSessionOnPane={onPlaceSessionOnPane}
              onRenameSession={onRenameHistorySession}
              onArchiveSession={onArchiveHistorySession}
              onArchiveSessions={onArchiveHistorySessions}
              onPinSession={onPinHistorySession}
              onPinSessions={onPinHistorySessions}
              onSetSessionLinkedWorkItem={onSetHistorySessionLinkedWorkItem}
              reminders={sessionReminders.reminders}
              onSetReminders={sessionReminders.schedule}
              onCancelReminders={sessionReminders.cancel}
              onDeleteSession={onDeleteHistorySession}
              onDeleteSessions={onDeleteHistorySessions}
              onOpenFile={onOpenFile}
              onOpenTerminal={onOpenTerminal}
              onFileMoved={onFileMoved}
              onFileDeleted={onFileDeleted}
              canGoBack={
                !!irgatViewId ||
                tabVisitNav.canBack ||
                searchViewOpen ||
                settingsOpen ||
                inboxViewOpen ||
                notesViewOpen ||
                automationsViewOpen ||
                kanbanViewOpen ||
                fleetViewOpen ||
                mailViewOpen ||
                ideasViewOpen ||
                feedViewOpen ||
                chatViewOpen
              }
              canGoForward={tabVisitNav.canForward}
              onGoBack={onRailBack}
              onGoForward={onRailForward}
              onOpenDiff={onOpenWorkingTreeDiff}
              onOpenAllChanges={onOpenAllChanges}
              onOpenCommit={onOpenCommit}
              selectedDiffPath={
                activeTab ? selectedChangePath(activeTab, gitCwd) : undefined
              }
              selectedDiffKind={
                activeTab ? selectedChangeKind(activeTab) : undefined
              }
              selectedCommitSha={
                activeTab ? selectedCommitSha(activeTab) : undefined
              }
              textHarness={pickTextHarness(active?.harness)}
              recents={recents}
              busyProjectPaths={busyProjectPaths}
              projectAlerts={projectAlerts}
              liveAgents={liveAgents}
              onSelectAgent={onSelectLiveAgent}
              onSelectProject={onSelectProject}
              onOpenProject={pickProject}
              onRemoveProject={onRemoveProject}
              irgats={sidebarIrgats}
              irgatViewActive={irgatCovers}
              artifactsPanel={artifactsPanel}
              artifactCount={projectArtifacts.artifacts.length}
              onOpenArtifacts={onOpenArtifacts}
              onNew={onNew}
              openSessions={openProjectSessions}
              onNewTerminal={onNewTerminal}
              onSearch={onOpenSearch}
              onOpenInbox={onOpenInbox}
              onOpenInboxItem={onOpenLinkedWorkItem}
              onOpenNotes={notesEnabled ? onOpenNotes : undefined}
              onOpenAutomations={onOpenAutomations}
              onOpenKanban={onOpenKanban}
              fleetPanel={
                <FleetView
                  sidebar
                  sessions={promptableSessions}
                  unseenFinishedIds={unseenFinishedIds}
                  interruptedSessionIds={interruptedSessionIds}
                  actions={fleetActions}
                  onClose={onLeaveFleet}
                  onOpenSession={onOpenFleetSession}
                  onApproval={onApproval}
                  onQuestionReply={onQuestionReply}
                  onQuestionInteraction={onQuestionInteraction}
                  habitApprovals={habitApprovals}
                  onHabitApproval={(entry, decision) =>
                    void decideHabitApproval(entry.irgatId, entry.habit.id, decision)
                      .catch((error) => console.warn("Could not answer the habit", error))
                  }
                />
              }
              onOpenFleet={onOpenFleet}
              onOpenMail={onOpenMail}
              mailActive={mailViewOpen}
              onOpenIdeas={onOpenIdeas}
              ideasActive={ideasViewOpen}
              onOpenFeed={onOpenFeed}
              feedActive={feedViewOpen}
              onOpenChat={onOpenChat}
              chatActive={chatViewOpen}
              chatIndicator={freeChatIndicator}
              chatShortcut={NEW_CHAT_SHORTCUT}
                chats={{
                  rows: freeChatList,
                  activeId: chatViewOpen ? freeChatId : undefined,
                  boardIds: kanbanSessions.linkedIds,
                  onSelect: openFreeChat,
                  onNew: () => void onNewChat(),
                  onRename: (id, title) => void onRenameFreeChat(id, title),
                  onPin: (id, pinned) => void onPinFreeChat(id, pinned),
                  onDelete: (id) => void onDeleteFreeChat(id),
                  onBoard: (id) => void onFreeChatBoard(id),
                  onOpenBeside: sidePaneKey
                    ? (id) => void onOpenBeside(id)
                    : undefined,
                }}
              fleetNeedsYou={fleetNeedsYouCount}
              onSessionBoard={onSessionBoard}
              onOpenSessionBeside={onOpenBeside}
              boardSessionIds={kanbanSessions.linkedIds}
              onGoToFile={onGoToFile}
              searchActive={searchViewOpen}
              inboxActive={inboxViewOpen}
              notesActive={notesViewOpen}
              automationsActive={automationsViewOpen}
              kanbanActive={kanbanViewOpen}
              fleetActive={fleetViewOpen}
              notesEnabled={notesEnabled}
              projectRailOpen={projectRailOpen}
              compactProjectRail={compactProjectRail}
              titleBarAbove={compactTitleBar}
              onToggleProjectRail={onToggleProjectRail}
              unseenFinishedIds={unseenFinishedIds}
              inboxUnseen={inboxUnseen}
              linkedSessionUpdateIds={linkedSessionUpdateIds}
              settingsOpen={settingsOpen}
              settingsSection={settingsSection}
              onOpenSettings={onOpenSettings}
              onOpenNotificationSettings={onOpenNotificationSettings}
              onSelectSettingsSection={onSelectSettingsSection}
              onCloseSettings={onCloseSettings}
              updateNotice={updateNotice}
              onOpenWhatsNew={onOpenWhatsNew}
              onDismissUpdate={onDismissUpdate}
            />

            <div className="body-glass flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className={
                  searchViewOpen ||
                  settingsOpen ||
                  inboxViewOpen ||
                  notesViewOpen ||
                  automationsViewOpen ||
                  kanbanViewOpen ||
                  fleetViewOpen ||
                  mailViewOpen ||
                  ideasViewOpen ||
                  feedViewOpen ||
                  chatViewOpen
                    ? "hidden"
                    : "flex min-h-0 min-w-0 flex-1 flex-col"
                }
                aria-hidden={
                  searchViewOpen ||
                  settingsOpen ||
                  inboxViewOpen ||
                  notesViewOpen ||
                  automationsViewOpen ||
                  kanbanViewOpen ||
                  fleetViewOpen ||
                  mailViewOpen ||
                  ideasViewOpen ||
                  feedViewOpen ||
                  chatViewOpen
                }
                inert={
                  searchViewOpen ||
                  settingsOpen ||
                  inboxViewOpen ||
                  notesViewOpen ||
                  automationsViewOpen ||
                  kanbanViewOpen ||
                  fleetViewOpen ||
                  mailViewOpen ||
                  ideasViewOpen ||
                  feedViewOpen ||
                  chatViewOpen ||
                  undefined
                }
              >
                {!IS_MAC ? (
                  <MenuBar
                    onNew={onNew}
                    onNewTerminal={onNewTerminal}
                    onToggleTerminal={onToggleProjectTerminal}
                    onGoToFile={onGoToFile}
                    onToggleSidebar={onToggleSidebar}
                    onToggleSessionSidebar={onToggleSessionSidebar}
                    onShowSourceControl={onToggleChanges}
                    onCloseCurrentTab={
                      activeTabId ? () => onCloseTab(activeTabId) : undefined
                    }
                    onCloseOtherTabs={onCloseOtherTabs}
                    onCloseAllTabs={onCloseAllTabs}
                    onPickProject={pickProject}
                    onFindInProject={onFindInProject}
                    onSearch={onOpenSearch}
                    onOpenInbox={onOpenInbox}
                    onOpenNotes={notesEnabled ? onOpenNotes : undefined}
                    onZoomIn={() => {
                      const next = saveUiScale(zoomInUiScale(loadUiScale()));
                      void applyUiScale(next);
                    }}
                    onZoomOut={() => {
                      const next = saveUiScale(zoomOutUiScale(loadUiScale()));
                      void applyUiScale(next);
                    }}
                    onZoomReset={() => {
                      saveUiScale(UI_SCALE_DEFAULT);
                      void applyUiScale(UI_SCALE_DEFAULT);
                    }}
                  />
                ) : null}
                <div className="flex min-h-0 min-w-0 flex-1">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {compactTitleBar ? null : workspaceTitleBar}

                    <main className="relative flex min-h-0 min-w-0 flex-1">
                      <div
                        ref={dockGridRef}
                        className="grid h-full min-h-0 min-w-0 flex-1"
                      >
                        {workspaceDocks.map((dock) => {
                          const show =
                            dock.open &&
                            sameProjectPath(dock.projectPath, dockPath);
                          return (
                            <div
                              key={dock.projectPath}
                              className={
                                show
                                  ? "h-full min-h-0 min-w-0 w-full overflow-hidden"
                                  : "hidden"
                              }
                              style={show ? { gridArea: "dock" } : undefined}
                              aria-hidden={!show}
                            >
                              <ProjectTerminalDock
                                dock={dock}
                                focused={show && projectTerminalFocused}
                                onFocus={focusProjectTerminal}
                                onHide={onHideProjectTerminal}
                                onSideChange={onProjectTerminalSide}
                                onSizePaint={paintDockSize}
                                onSizeCommit={commitDockSize}
                                onAddTerminal={onNewTerminal}
                                onSelectTerminal={onSelectProjectTerminal}
                                onCloseTerminal={onCloseProjectTerminal}
                                onCloseOtherTerminals={
                                  onCloseOtherProjectTerminals
                                }
                                onReorderTerminals={onReorderProjectTerminals}
                                onTerminalMetaChange={onTerminalMetaChange}
                              />
                            </div>
                          );
                        })}
                        <div
                          className="relative flex min-h-0 min-w-0 flex-row"
                          style={{ gridArea: "main" }}
                        >
                          <div className="relative min-h-0 min-w-0 flex-1">
                            {tabs.map((tab) => (
                              <div
                                key={tab.id}
                                aria-hidden={
                                  tab.id !== activeTabId || irgatCovers
                                }
                                className={
                                  tab.id === activeTabId && !irgatCovers
                                    ? "absolute inset-0 flex h-full min-h-0 flex-col"
                                    : "hidden"
                                }
                              >
                                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                                  <PaneTree
                                    {...sessionPaneProps}
                                    visible={
                                      tab.id === activeTabId &&
                                      !inboxViewOpen &&
                                      !irgatCovers
                                    }
                                    layout={tab.layout}
                                    sessions={sessions}
                                    editorPanes={[
                                      ...tab.editorPanes,
                                      ...(tab.terminalPanes ?? []),
                                    ]}
                                    dirtyFileIds={dirtyFiles}
                                    fileErrorCounts={fileErrorCounts}
                                    focusedId={
                                      tab.id === activeTabId &&
                                      !irgatViewId &&
                                      !inboxViewOpen &&
                                      !tab.diffFocused &&
                                      !projectTerminalFocused
                                        ? tab.focusedId
                                        : ""
                                    }
                                    addToChatSessionId={workspaceChatTarget({
                                      tabId: tab.id,
                                      activeTabId,
                                      activeSessionId: active?.id,
                                      irgatViewId,
                                    })}
                                    composerFocused={
                                      composerFocused &&
                                      !projectTerminalFocused &&
                                      !irgatViewId
                                    }
                                    composerFocusToken={composerFocusToken}
                                    onSelectFile={onSelectFileSurface}
                                    onCloseFile={onCloseFile}
                                    onCloseOtherFiles={onCloseOtherFiles}
                                    onPinFile={onPinFile}
                                    onReorderFiles={onReorderFiles}
                                    onFileDirtyChange={onFileDirtyChange}
                                    onFileErrorCountChange={
                                      onFileErrorCountChange
                                    }
                                    transcriptPool={transcriptPool}
                                    onRatio={(splitId, index, ratio) =>
                                      onRatio(tab.id, splitId, index, ratio)
                                    }
                                    editorNavigation={editorNavigation}
                                    onUpdatePlan={onUpdatePlan}
                                    onMovePane={onMovePane}
                                    onDetachPane={onDetachPane}
                                    onTerminalMetaChange={onTerminalMetaChange}
                                  />
                                </div>
                              </div>
                            ))}
                            {sessions
                              .filter((session) => isIrgatSession(session.id))
                              .map((session) => {
                                const visible = irgatViewId === session.id;
                                return (
                                  <div
                                    key={session.id}
                                    data-irgat-view={session.id}
                                    aria-hidden={!visible}
                                    inert={!visible || undefined}
                                    className={
                                      visible
                                        ? "absolute inset-0 flex h-full min-h-0 flex-col"
                                        : "hidden"
                                    }
                                  >
                                    {withSidePanes(
                                    <SessionPane
                                      {...sessionPaneProps}
                                      session={session}
                                      visible={visible}
                                      focused={
                                        visible &&
                                        !projectTerminalFocused &&
                                        !irgatShownSessionActive &&
                                        !sidePaneFocusId
                                      }
                                      inSplit={false}
                                      addToChatTarget={visible}
                                      composerFocused={
                                        visible &&
                                        composerFocused &&
                                        !projectTerminalFocused &&
                                        !irgatShownSessionActive &&
                                        !sidePaneFocusId
                                      }
                                      composerFocusToken={composerFocusToken}
                                      onShowIrgatActivity={onShowIrgatActivity}
                                      onOpenArtifact={onOpenIrgatArtifact}
                                      onOpenDiff={onOpenIrgatDiff}
                                      onCommitChanges={onCommitIrgatChanges}
                                      irgatActivityTurnId={
                                        selectedIrgatActivity?.turnId
                                      }
                                      onOpenIrgatSession={onOpenIrgatSession}
                                      irgatLaunchedSessions={
                                        visible
                                          ? irgatLaunchedSessions
                                          : undefined
                                      }
                                      openIrgatSessionId={shownIrgatSessionId}
                                    />,
                                    session.id,
                                    visible,
                                    )}
                                  </div>
                                );
                              })}
                            {openIrgatGroupId ? (
                              <div
                                data-irgat-group-pane={openIrgatGroupId}
                                className="absolute inset-0 flex h-full min-h-0 flex-col"
                              >
                                <IrgatGroupView
                                  key={openIrgatGroupId}
                                  groupId={openIrgatGroupId}
                                  runner={irgatGroups}
                                  liveSeat={openIrgatGroupSeat}
                                  visible={
                                    !projectTerminalFocused && composerFocused
                                  }
                                  focusToken={composerFocusToken}
                                  onApproval={onApproval}
                                  onQuestionReply={onQuestionReply}
                                  onQuestionInteraction={onQuestionInteraction}
                                  onOpenFile={onOpenFile}
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      {[...linkedWorkItemPanels.values()].map((panel) => (
                        <LinkedWorkItemPanel
                          repairSessions={repairSessions}
                          onRepairChecks={onRepairChecks}
                          onOpenSession={(sessionId) => {
                            closeLinkedWorkItemPanel(panel.sessionId);
                            onOpenInboxSession(sessionId);
                          }}
                          key={panel.sessionId}
                          target={panel.item}
                          cwd={panel.cwd}
                          recents={recents}
                          visible={
                            !searchViewOpen &&
                            !settingsOpen &&
                            !inboxViewOpen &&
                            !notesViewOpen &&
                            !automationsViewOpen &&
                            !kanbanViewOpen &&
                            !fleetViewOpen &&
                            !mailViewOpen &&
                            !ideasViewOpen &&
                            !feedViewOpen &&
                            !chatViewOpen &&
                            !irgatViewId &&
                            activeLinkedWorkItemPanel?.sessionId ===
                              panel.sessionId
                          }
                          onClose={() =>
                            closeLinkedWorkItemPanel(panel.sessionId)
                          }
                        />
                      ))}
                      {browserMounted && !chatViewOpen ? (
                        <DockHostSlot host={browserHost} className="contents" />
                      ) : null}
                      {browserMounted
                        ? // One browser for the whole window: it sits beside
                          // the session, or beside the open chat, and keeps
                          // its pages while it moves between them.
                          createPortal(
                        <BrowserPanel
                          visible={browserShown}
                          onClose={() => setBrowserOpen(false)}
                          openRequest={browserRequest}
                        />,
                            browserHost,
                          )
                        : null}
                    </main>
                  </div>
                  {irgatCovers ? irgatOverviewPanel : null}
                  {irgatCovers ? irgatActivityPanel : null}
                </div>
              </div>
              {searchViewOpen ? (
                <SearchView
                  open
                  cwd={gitCwd}
                  recents={recents}
                  history={projectHistory}
                  sessions={sessions.filter((session) => !session.inboxAsk)}
                  focusToken={searchViewFocusToken}
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  onClose={onLeaveSearch}
                  onToggleSidebar={onToggleSidebar}
                  onOpenFile={onOpenFile}
                  onOpenSession={(sessionId, blockId, query) => {
                    if (blockId)
                      requestTranscriptJump(sessionId, blockId, query);
                    void onSelectHistorySession(sessionId);
                  }}
                  onOpenProject={onSelectProject}
                />
              ) : null}
              <SessionReferenceHost onOpenSession={openReferencedSession} />
              <div className="hidden" aria-hidden>
                {sessions
                  .filter((session) => session.inboxAsk)
                  .map((session) => {
                    const visible =
                      inboxViewOpen && inboxAskPortal?.sessionId === session.id;
                    return (
                      <SessionSurface
                        key={session.id}
                        host={visible ? inboxAskPortal.host : undefined}
                      >
                        <SessionPane
                          {...sessionPaneProps}
                          session={session}
                          visible={visible}
                          focused={visible}
                          inSplit={false}
                          composerFocused={composerFocused}
                          composerFocusToken={composerFocusToken}
                        />
                      </SessionSurface>
                    );
                  })}
              </div>
              {inboxViewOpen ? (
                <InboxView
                  cwd={sidebarCwd}
                  recents={recents}
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  onClose={onLeaveInbox}
                  onToggleSidebar={onToggleSidebar}
                  onStart={onStartInboxItem}
                  onAsk={onAskInboxItem}
                  onAskRestart={onRestartInboxAsk}
                  onAskMount={setInboxAskPortal}
                  sessions={inboxRelatedSessions}
                  repairSessions={repairSessions}
                  onRepairChecks={onRepairChecks}
                  onOpenSession={onOpenInboxSession}
                  onOpenIntegrations={onOpenInboxIntegrations}
                />
              ) : null}
              {notesViewOpen ? (
                <NotesView
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  cwd={projectCwd}
                  chatTargets={noteChatTargets}
                  recents={recents}
                  onClose={onLeaveNotes}
                  onToggleSidebar={onToggleSidebar}
                />
              ) : null}
              {automationsViewOpen ? (
                <AutomationsView
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  cwd={projectCwd}
                  recents={recents}
                  onClose={onLeaveAutomations}
                  onToggleSidebar={onToggleSidebar}
                  onLaunch={(automation, run) =>
                    launchAutomation(automation, run, true)
                  }
                  onOpenSession={onOpenAutomationSession}
                />
              ) : null}
              {kanbanViewOpen ? (
                <KanbanView
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  cwd={boardCwd}
                  recents={recents}
                  focusRequest={kanbanFocus}
                  chatBoard={freeChatDir}
                  liveSessions={kanbanSessions.live}
                  onApproval={onApproval}
                  onOpenTerminal={onShowTerminal}
                  onStartSession={onStartCardSession}
                  onOpenSession={onOpenAutomationSession}
                  onClose={onLeaveKanban}
                  onToggleSidebar={onToggleSidebar}
                />
              ) : null}
              {fleetViewOpen ? (
                <FleetView
                  sessions={promptableSessions}
                  unseenFinishedIds={unseenFinishedIds}
                  interruptedSessionIds={interruptedSessionIds}
                  actions={fleetActions}
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  onClose={onLeaveFleet}
                  onToggleSidebar={onToggleSidebar}
                  onOpenSession={onOpenFleetSession}
                  onApproval={onApproval}
                  onQuestionReply={onQuestionReply}
                  onQuestionInteraction={onQuestionInteraction}
                  habitApprovals={habitApprovals}
                  onHabitApproval={(entry, decision) =>
                    void decideHabitApproval(
                      entry.irgatId,
                      entry.habit.id,
                      decision,
                    ).catch((error) =>
                      console.warn("Could not answer the habit", error),
                    )
                  }
                />
              ) : null}
              {feedViewOpen ? (
                <FeedView
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  onClose={onLeaveFeed}
                  onToggleSidebar={onToggleSidebar}
                />
              ) : null}
              {mailViewOpen ? (
                <MailView
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  cwd={projectCwd}
                  recents={recents}
                  describeChat={describeMailChat}
                  onAsk={onAskMail}
                  onOpenSession={onOpenFleetSession}
                  onClose={onLeaveMail}
                  onToggleSidebar={onToggleSidebar}
                />
              ) : null}
              {ideasViewOpen ? (
                <IdeasView
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  recents={recents}
                  onOpenSettings={() =>
                    openSettings("providers", "semantic-search-service")
                  }
                  onClose={onLeaveIdeas}
                  onToggleSidebar={onToggleSidebar}
                />
              ) : null}
              {chatViewOpen && !settingsOpen ? (
                <FreeChatView
                  rows={freeChatList}
                  activeId={freeChatId}
                  pane={
                    freeChat
                      ? withSidePanes(
                          <SessionPane
                            {...sessionPaneProps}
                            key={freeChat.id}
                            session={freeChat}
                            visible
                            focused={!projectTerminalFocused && !sidePaneFocusId}
                            inSplit={false}
                            composerFocused={
                              composerFocused &&
                              !projectTerminalFocused &&
                              !sidePaneFocusId
                            }
                            composerFocusToken={composerFocusToken}
                            onSecondOpinion={undefined}
                            onHandoff={undefined}
                          />,
                          freeChat.id,
                          true,
                        )
                      : undefined
                  }
                  footer={
                    freeChat ? (
                      <UsageFooter
                          hideUsage
                          providers={usageProviders}
                        session={freeChatUsage}
                        adhd={{ session: freeChat }}
                        project={freeChat.cwd}
                        onSelectAccount={onSelectProviderAccount}
                        onManageAccounts={() =>
                          openSettings("providers", "provider-accounts")
                        }
                        {...viewTerminalFooterProps}
                        browserOpen={browserOpen}
                        onToggleBrowser={onToggleBrowser}
                      />
                    ) : undefined
                  }
                  aside={
                    freeChat && browserMounted ? (
                      <DockHostSlot host={browserHost} className="contents" />
                    ) : undefined
                  }
                  dock={
                    freeChat &&
                    currentViewDock.kind === "chat" &&
                    currentProjectDock?.open ? (
                      <DockHostSlot
                        host={chatDockHost(currentProjectDock.projectPath)}
                        height={currentProjectDock.size}
                      />
                    ) : undefined
                  }
                  loading={freeChatLoad.loading}
                  error={freeChatLoad.error}
                  onRetry={() => void refreshFreeChats()}
                  boardIds={kanbanSessions.linkedIds}
                  shortcut={NEW_CHAT_SHORTCUT}
                  besideRail={projectRailOpen || compactProjectRail}
                  compactRail={compactRailActive}
                  onClose={() => setChatViewOpen(false)}
                  onToggleSidebar={onToggleSidebar}
                  onNewChat={() => void onNewChat()}
                  onSelect={openFreeChat}
                  onShowList={() => setFreeChatId(undefined)}
                  onRename={(id, title) => void onRenameFreeChat(id, title)}
                  onPin={(id, pinned) => void onPinFreeChat(id, pinned)}
                  onDelete={(id) => void onDeleteFreeChat(id)}
                  onBoard={(id) => void onFreeChatBoard(id)}
                  onOpenBeside={(id) => void onOpenBeside(id)}
                  onNewChatBeside={onNewChatBeside}
                />
              ) : null}
              {chatDocks.map((dock) =>
                createPortal(
                  <ProjectTerminalDock
                    dock={dock}
                    focused={
                      chatViewOpen &&
                      currentViewDock.kind === "chat" &&
                      dock.open &&
                      sameProjectPath(dock.projectPath, dockPath) &&
                      projectTerminalFocused
                    }
                    onFocus={focusProjectTerminal}
                    onHide={onHideProjectTerminal}
                    onSizePaint={paintChatDockSize}
                    onSizeCommit={commitDockSize}
                    onAddTerminal={onNewTerminal}
                    onSelectTerminal={onSelectProjectTerminal}
                    onCloseTerminal={onCloseProjectTerminal}
                    onCloseOtherTerminals={onCloseOtherProjectTerminals}
                    onReorderTerminals={onReorderProjectTerminals}
                    onTerminalMetaChange={onTerminalMetaChange}
                  />,
                  chatDockHost(dock.projectPath),
                  dock.projectPath,
                ),
              )}
              {settingsOpen ? (
                <SettingsView
                  section={settingsSection}
                  anchor={settingsAnchor}
                  notificationProjectPath={notificationProjectPath}
                  notificationSettingsRequest={notificationSettingsRequest}
                  recents={recents}
                  cwd={sidebarCwd}
                  sessions={sidebarHistory}
                  liveSessions={sessions}
                  onRemoveWorktree={onRemoveWorktree}
                  onCheckWorktreeRemoval={onCheckWorktreeRemoval}
                  onDeleteWorktreeSessions={onDeleteWorktreeSessions}
                  besideRail
                  onClose={onCloseSettings}
                  onSelectSection={onSelectSettingsSection}
                  onOpenSession={onOpenArchivedSession}
                  onArchiveSession={onArchiveHistorySession}
                  onDeleteSession={onDeleteHistorySession}
                  onRestoreProject={onRestoreProject}
                  onDeleteProject={(path) =>
                    onRemoveProject(path, { purgeData: true })
                  }
                  onOpenWhatsNew={onOpenWhatsNew}
                  collapsedProjectRailMode={collapsedProjectRailMode}
                  onCollapsedProjectRailModeChange={setCollapsedProjectRailMode}
                />
              ) : null}
              {searchViewOpen ||
              inboxViewOpen ||
              notesViewOpen ||
              automationsViewOpen ||
              kanbanViewOpen ||
              fleetViewOpen ||
              mailViewOpen ||
              ideasViewOpen ||
              feedViewOpen ||
              chatViewOpen ||
              settingsOpen ? null : irgatCovers ? (
                // The Irgat's composer already shows its usage; its terminal
                // opens in the Irgat's own folder, beside the Irgat.
                <UsageFooter
                    hideUsage
                    providers={NO_USAGE_PROVIDERS}
                  adhd={{ session: irgatViewSession }}
                  {...viewTerminalFooterProps}
                  browserOpen={browserOpen}
                  onToggleBrowser={onToggleBrowser}
                />
              ) : (
                <UsageFooter
                    hideUsage
                    providers={usageProviders}
                  session={usageSession}
                  adhd={{ session: active }}
                  project={active?.cwd ?? projectCwd}
                  onSelectAccount={onSelectProviderAccount}
                  onManageAccounts={() =>
                    openSettings("providers", "provider-accounts")
                  }
                  terminals={runningTerminals}
                  terminalOpen={runningTerminalOpen}
                  onToggleTerminal={onToggleRunningTerminal}
                  onNewTerminal={
                    isLocalProject(projectCwd) ? onNewTerminal : undefined
                  }
                  onShowTerminal={
                    isLocalProject(projectCwd)
                      ? onShowProjectTerminal
                      : undefined
                  }
                  projectTerminalActive={
                    !!currentProjectDock &&
                    currentProjectDock.pane.files.length > 0
                  }
                  browserOpen={browserOpen}
                  onToggleBrowser={onToggleBrowser}
                />
              )}
            </div>
          </div>

          {filePickerOpen ? (
            <FilePicker
              key={filePickerResetToken}
              open
              cwd={filesCwd}
              openPaths={openFilePaths}
              initialQuery={filePickerInitialQuery}
              onOpenFile={onOpenFile}
              onRunAction={(id) => {
                if (id === "reload") actions.current.onReload();
              }}
              onClose={() => setFilePickerOpen(false)}
            />
          ) : null}

          {sessionDeleteDialog && (
            <DeleteSessionDialog
              title={sessionDeleteDialog.title}
              unusedWorktree={sessionDeleteDialog.unusedWorktree}
              onClose={(choice) => {
                sessionDeleteDialog.resolve(choice);
                setSessionDeleteDialog(undefined);
              }}
            />
          )}
          <InboxResurfaceNotices
            topOffset={
              12 + (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0)
            }
            onOpenInbox={onOpenInbox}
            onHeightChange={setInboxResurfaceHeight}
          />
          <HarnessUpdateNotice
            topOffset={
              12 +
              (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0) +
              (inboxResurfaceHeight ? inboxResurfaceHeight + 8 : 0)
            }
            onHeightChange={setHarnessUpdateHeight}
          />
          <ApprovalToasts
            notices={hiddenApprovalToasts}
            topOffset={
              12 +
              (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0) +
              (inboxResurfaceHeight ? inboxResurfaceHeight + 8 : 0) +
              (harnessUpdateHeight ? harnessUpdateHeight + 8 : 0)
            }
            onFocusSession={onOpenApprovalSession}
            onApproval={onApproval}
          />
          <ReminderNotices
            reminders={sessionReminders.due}
            error={sessionReminders.error}
            onOpen={sessionReminders.open}
            onSnooze={sessionReminders.schedule}
            onDismiss={sessionReminders.cancel}
            onRetry={sessionReminders.refresh}
            onOpenSettings={() => openSettings("general", "notifications")}
            onHeightChange={setReminderNoticesHeight}
          />
          {whatsNewVersion ? (
            <WhatsNewDialog
              version={whatsNewVersion}
              onClose={() => setWhatsNewVersion(null)}
            />
          ) : null}
          <UpdateDialog onOpenWhatsNew={onOpenWhatsNew} />
          {remoteProjectDialogOpen ? (
            <AddRemoteProjectDialog
              onCancel={() => setRemoteProjectDialogOpen(false)}
              onOpen={(key) => {
                setRemoteProjectDialogOpen(false);
                onSelectProject(key);
              }}
            />
          ) : null}
          {providerSignInRequest ? (
            <ProviderSignInDialog
              key={providerSignInRequest.key}
              harness={providerSignInRequest.harness}
              onClose={() => setProviderSignInRequest(null)}
            />
          ) : null}
        </div>
        <TranscriptPoolOutlet pool={transcriptPool} />
      </OrchestrationWorkers.Provider>
    </OrchestrationActions.Provider>
    </ArtifactHostContext.Provider>
  );
}
function conversationTitle(session: Session): string {
  const hostId = isRemoteProjectPath(session.cwd)
    ? remoteSessionFor(session.id)
    : undefined;
  const remote = hostId
    ? cachedRemoteSessionSummary(session.cwd, hostId)
    : undefined;
  const title = sessionDisplayTitle(
    remote?.title ?? session.title,
    remote?.harness ?? session.harness,
  );
  return title === "New session" ? "" : title;
}

function lastUserBlockId(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i]?.role === "user") return session.blocks[i]?.id;
  }
  return undefined;
}

function providerSignInRequestKey(session: Session): string {
  const lastBlockId = session.blocks[session.blocks.length - 1]?.id;
  return `${session.id}:${lastUserBlockId(session) ?? lastBlockId ?? "auth"}`;
}

function selectedChangePath(
  tab: WorkspaceTab,
  gitCwd?: string,
): string | undefined {
  const file = focusedFileTab(tab);
  if (!file || !isFilesystemTab(file) || !file.review) return undefined;
  return displayPath(file.path, gitCwd || file.cwd);
}

function selectedChangeKind(tab: WorkspaceTab): GitFileDiffKind | undefined {
  const file = focusedFileTab(tab);
  return file?.review ? file.changeKind : undefined;
}

function selectedCommitSha(tab: WorkspaceTab): string | undefined {
  const focused = focusedFileTab(tab);
  if (focused && isCommitTab(focused)) return focused.commit.sha;
  for (const pane of tab.editorPanes) {
    const file = pane.files.find((entry) => entry.id === pane.activeFileId);
    if (file && isCommitTab(file)) return file.commit.sha;
  }
}

function isBlankWorkspaceTab(tab: WorkspaceTab, sessions: Session[]): boolean {
  if (tab.editorPanes.some((pane) => pane.files.length > 0)) return false;
  if ((tab.terminalPanes ?? []).some((pane) => pane.files.length > 0))
    return false;
  const ids = leafIds(tab.layout);
  if (ids.length !== 1) return false;
  if (remoteSessionFor(ids[0]) || remotePendingWorktree(ids[0])) return false;
  return isBlankSession(sessions.find((entry) => entry.id === ids[0]));
}

function toTitleTab(
  tab: WorkspaceTab,
  sessions: Session[],
  dirtyFiles: Set<string>,
  unseenFinishedIds: ReadonlySet<string>,
): TitleTab {
  const paneIds = leafIds(tab.layout);
  const multiPane = paneIds.length > 1;
  const tabSessions = paneIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => session != null);
  const sessionFocused = tabSessions.some(
    (session) => session.id === tab.focusedId,
  );
  const fileFocused =
    !sessionFocused &&
    (tab.editorPanes.some((pane) => pane.id === tab.focusedId) ||
      (tab.terminalPanes ?? []).some((pane) => pane.id === tab.focusedId));
  const focused =
    sessions.find((session) => session.id === tab.focusedId) ?? tabSessions[0];

  const seen = new Set<HarnessId>();
  const harnesses: HarnessId[] = [];
  const busySeen = new Set<HarnessId>();
  const busyHarnesses: HarnessId[] = [];
  const doneSeen = new Set<HarnessId>();
  const doneHarnesses: HarnessId[] = [];
  const ordered = focused
    ? [focused, ...tabSessions.filter((session) => session.id !== focused.id)]
    : tabSessions;
  for (const session of ordered) {
    if (
      session.busy &&
      !sessionNeedsInput(session) &&
      !busySeen.has(session.harness)
    ) {
      busySeen.add(session.harness);
      busyHarnesses.push(session.harness);
    }
    if (unseenFinishedIds.has(session.id) && !doneSeen.has(session.harness)) {
      doneSeen.add(session.harness);
      doneHarnesses.push(session.harness);
    }
    if (seen.has(session.harness)) continue;
    seen.add(session.harness);
    harnesses.push(session.harness);
  }

  const files: string[] = [];
  const seenKeys = new Set<string>();
  const pushFile = (file: FilePaneTab) => {
    const key = file.terminal
      ? `terminal:${file.id}`
      : file.plan
        ? `plan:${file.plan.blockId}`
        : file.releaseNotes
          ? `release-notes:${file.releaseNotes.version}`
          : file.path;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    files.push(
      file.plan?.title?.trim() ||
        file.artifact?.title.trim() ||
        (file.releaseNotes
          ? releaseNotesTitle(file.releaseNotes.version)
          : file.terminal
            ? terminalTabLabel(file)
            : basename(file.path)),
    );
  };
  const focusedPane =
    tab.editorPanes.find((pane) => pane.id === tab.focusedId) ??
    (tab.terminalPanes ?? []).find((pane) => pane.id === tab.focusedId);
  const otherPanes = [
    ...tab.editorPanes.filter((pane) => pane.id !== focusedPane?.id),
    ...(tab.terminalPanes ?? []).filter((pane) => pane.id !== focusedPane?.id),
  ];
  const panes = focusedPane ? [focusedPane, ...otherPanes] : otherPanes;
  for (const pane of panes) {
    const active = pane.files.find((file) => file.id === pane.activeFileId);
    if (active) pushFile(active);
  }
  for (const pane of panes) {
    for (const file of pane.files) pushFile(file);
  }

  const more = tabSessions
    .filter((session) => session.id !== focused?.id)
    .map(conversationTitle)
    .filter(Boolean);

  const hasTerminal = (tab.terminalPanes ?? []).some((pane) =>
    pane.files.some(isTerminalTab),
  );
  const focusedFile = focusedFileTab(tab);

  return {
    id: tab.id,
    project: focused
      ? projectName(focused.cwd)
      : focusedFile
        ? projectName(focusedFile.projectCwd ?? focusedFile.cwd)
        : "~",
    title: focused ? conversationTitle(focused) : "",
    more,
    sessionCount: tabSessions.length,
    harnesses,
    busyHarnesses,
    doneHarnesses,
    files,
    multiPane,
    fileFocused,
    blank: isBlankWorkspaceTab(tab, sessions),
    dirty: tab.editorPanes.some((pane) =>
      pane.files.some(
        (file) => isFilesystemTab(file) && dirtyFiles.has(file.id),
      ),
    ),
    terminal: hasTerminal && harnesses.length === 0,
    previewFileId: previewWorkspaceFile(tab)?.id,
    groupId: tab.groupId,
  };
}

function dropOpenFiles(
  tab: WorkspaceTab,
  shouldDrop: (path: string) => boolean,
): WorkspaceTab {
  let layout = tab.layout;
  let focusedId = tab.focusedId;
  const editorPanes: EditorPane[] = [];
  for (const pane of tab.editorPanes) {
    const files = pane.files.filter(
      (file) => !isFilesystemTab(file) || !shouldDrop(file.path),
    );
    if (files.length === 0) {
      const sibling = siblingLeafId(layout, pane.id);
      const withoutPane = removePane(layout, pane.id);
      if (withoutPane) {
        layout = withoutPane;
        if (focusedId === pane.id)
          focusedId = sibling ?? firstLeafId(withoutPane);
      }
      continue;
    }
    editorPanes.push({
      ...pane,
      files,
      activeFileId: files.some((file) => file.id === pane.activeFileId)
        ? pane.activeFileId
        : files[0].id,
    });
  }
  return { ...tab, layout, focusedId, editorPanes };
}

function trackSessionEdits(
  sessionId: string,
  cwd: string,
  event: HarnessEvent,
) {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const paths = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ].filter((path, index, all) => all.indexOf(path) === index);
  if (paths.length === 0 || cwd === "~") return;
  const completed =
    event.type === "tool.updated" &&
    (event.status === "completed" || event.status === "success");
  if (!completed) {
    void prepareSessionCheckpoint(sessionId, cwd, paths).catch(() => undefined);
    return;
  }
  void captureSessionCheckpoint(sessionId, cwd, paths)
    .catch(() => undefined)
    .then(() => notifyReviewChanged(sessionId));
}

function nudgeWorkspace(cwd?: string) {
  invalidateProjectFiles(cwd);
  notifyDirsChanged();
}

function nudgeOpenEditors(event: HarnessEvent, cwd: string) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";

  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    if (!completed) return;
    nudgeWatchedFiles();
    window.setTimeout(() => nudgeWatchedFiles(), 150);
    notifyGitChanged();
    nudgeWorkspace(cwd);
    window.setTimeout(() => nudgeWorkspace(cwd), 150);
    return;
  }

  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const resolved = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ]
    .map((path) => resolveWorkspacePath(path, cwd) ?? path)
    .filter((path, index, paths) => paths.indexOf(path) === index);
  if (completed) {
    // A successful edit is authoritative. Reload it even if a startup race or
    // coarse filesystem timestamp makes the mtime appear unchanged.
    invalidateWatchedFiles(resolved.length > 0 ? resolved : undefined);
  } else if (resolved.length > 0) {
    nudgeWatchedFiles(resolved);
  }
  if (completed) {
    window.setTimeout(
      () => nudgeWatchedFiles(resolved.length > 0 ? resolved : undefined),
      150,
    );
    notifyGitChanged();
    nudgeWorkspace(cwd);
  }
}

function sameSettings(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}
