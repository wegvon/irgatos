import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { basename } from "../../../platform/tauri/fs";
import { projectName } from "../../../shared/lib/paths";
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Eye,
  FileDiff,
  Globe,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MoreHorizontal,
  RotateCcw,
} from "../../../shared/ui/icons";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import {
  FLEET_CARD,
  FLEET_CARD_CALM,
  FLEET_CARD_HEAD,
  FLEET_CARD_WAITING,
  FLEET_ICON_TILE,
} from "../../fleet/ui/cardStyles";
import { RequestCard } from "../../fleet/ui/RequestCard";
import { AGENT_STATUS_LABEL } from "../../agent-tree/model/agentTree";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import type { Session } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import {
  completionGateStatus,
  subscribeCompletionGateStatus,
} from "../../sessions/model/completionGate";
import { requestOpenArtifact } from "../../artifacts/model/openArtifact";
import { OPEN_BROWSER_URL_EVENT } from "../../source-control/model/worktreeEnv";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import {
  goalProgressSummary,
  progressHeadline,
  type GoalProgressSummary,
  type ProgressItem,
} from "../model/progress";
import {
  goalResult,
  type GoalCheckRun,
  type GoalPreview,
  type GoalResult,
} from "../model/result";
import {
  removeGoal,
  renameGoal,
  setGoalCriteria,
  setGoalDone,
  setGoalScope,
  useGoals,
} from "../model/goalStore";
import {
  criteriaSummary,
  type CriterionVerdict,
  type GoalCriterion,
} from "../model/criteria";
import {
  GOAL_STATE_LABEL,
  filterGoalViews,
  goalView,
  sortGoalViews,
  type Goal,
  type GoalLinkRole,
  type GoalMemberView,
  type GoalState,
  type GoalView,
} from "../model/goals";

type Props = {
  sessions: readonly Session[];
  unseenFinishedIds: ReadonlySet<string>;
  interruptedSessionIds?: ReadonlySet<string>;
  query: string;
  now: number;
  /** Waiting on the user outside any goal, e.g. habit runs; listed first. */
  attention?: ReactNode;
  /** Opens this goal's card, e.g. from a chat's goal line. */
  focusGoalId?: string;
  sidebar?: boolean;
  onOpenSession: (sessionId: string) => void;
  /** A fresh conversation that joins the goal instead of starting its own. */
  onNewGoalChat?: (goal: Goal) => void;
  /** The delivering chat's changes, as supporting detail. */
  onOpenChanges?: (sessionId: string, workCwd: string) => void;
  /** Orchestration runs, whose task lists are a goal's progress. */
  orchestrationRuns?: readonly OrchestrationRun[];
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
};

const STATE_TONE: Record<GoalState, string> = {
  needsYou: "text-amber-400",
  interrupted: "text-rose-400/90",
  failed: "text-rose-400/90",
  working: "text-sky-400/90",
  review: "text-accent",
  idle: "text-content/50",
  done: "text-emerald-400/90",
};

const ROLE_LABEL: Record<GoalLinkRole, string> = {
  main: "main",
  worker: "worker",
  fork: "fork",
  launched: "started by agent",
  chat: "follow-up",
};

/** Sections in attention order; finished goals fold away. */
const SECTIONS: { id: string; label: string; states: GoalState[] }[] = [
  { id: "attention", label: "Needs you", states: ["needsYou", "interrupted", "failed"] },
  { id: "working", label: "Working", states: ["working"] },
  { id: "review", label: "Ready to review", states: ["review"] },
  { id: "idle", label: "Idle", states: ["idle"] },
  { id: "done", label: "Done", states: ["done"] },
];

export function GoalsView({
  sessions,
  unseenFinishedIds,
  interruptedSessionIds,
  query,
  now,
  focusGoalId,
  attention,
  sidebar = false,
  onOpenSession,
  onNewGoalChat,
  onOpenChanges,
  orchestrationRuns,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
}: Props) {
  const goals = useGoals();
  // Completion Gate results live outside the sessions; redraw when they move.
  const [gateVersion, gateChanged] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeCompletionGateStatus(gateChanged), []);
  const byId = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const views = useMemo(() => {
    return sortGoalViews(
      goals.map((goal) =>
        goalView(goal, byId, {
          now,
          unseenFinishedIds,
          interruptedIds: interruptedSessionIds,
        }),
      ),
    );
  }, [byId, goals, interruptedSessionIds, now, unseenFinishedIds]);
  const shown = useMemo(() => filterGoalViews(views, query), [views, query]);
  const filtering = query.trim().length > 0;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(["idle", "done"]),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(focusGoalId ? [focusGoalId] : []),
  );
  const focusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!focusGoalId) return;
    setExpanded((current) => new Set(current).add(focusGoalId));
    const state = views.find((view) => view.goal.id === focusGoalId)?.state;
    const section = SECTIONS.find((entry) => state && entry.states.includes(state));
    if (section)
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(section.id);
        return next;
      });
    requestAnimationFrame(() =>
      focusRef.current?.scrollIntoView({ block: "nearest" }),
    );
    // Only when asked to focus, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGoalId]);

  if (views.length === 0 && !attention) {
    return (
      <GoalsMessage
        title="No goals yet"
        body="Every request you start becomes a goal here. Its chats, the agents working on it and their results stay together, even after you close a chat or switch providers."
      />
    );
  }
  if (filtering && shown.length === 0 && !attention) {
    return <GoalsMessage title="No goals match" body={`Nothing matches “${query.trim()}”.`} />;
  }
  const toggle = (set: typeof setCollapsed, id: string) =>
    set((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-goals-view>
      <div
        className={
          sidebar
            ? "flex flex-col gap-2 px-2 py-2"
            : "mx-auto flex w-full max-w-4xl flex-col gap-5 px-3 py-4 sm:px-6 sm:py-6"
        }
      >
        {attention ? (
          <section aria-label="Waiting on you" className="flex flex-col gap-2">
            <span className="px-1 text-[12px] font-medium text-amber-400">Waiting on you</span>
            {attention}
          </section>
        ) : null}
        {SECTIONS.map((section) => {
          const entries = shown.filter((view) => section.states.includes(view.state));
          if (entries.length === 0) return null;
          const open = filtering || !collapsed.has(section.id);
          return (
            <section
              key={section.id}
              aria-label={section.label}
              data-goal-section={section.id}
              className="flex flex-col gap-2"
            >
              <button
                type="button"
                onClick={() => toggle(setCollapsed, section.id)}
                aria-expanded={open}
                className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-[12px] font-medium text-content/70 hover:text-content"
              >
                {open ? (
                  <ChevronDown className="size-3 opacity-60" />
                ) : (
                  <ChevronRight className="size-3 opacity-60" />
                )}
                <span className={STATE_TONE[section.states[0]]}>{section.label}</span>
                <span className="tabular-nums text-content/40">{entries.length}</span>
              </button>
              {open ? (
                <ul className="flex flex-col gap-1.5">
                  {entries.map((view) => (
                    <li
                      key={view.goal.id}
                      ref={view.goal.id === focusGoalId ? (node) => void (focusRef.current = node) : undefined}
                    >
                      <GoalCard
                        view={view}
                        sessionsById={byId}
                        orchestrationRuns={orchestrationRuns}
                        gateVersion={gateVersion}
                        now={now}
                        onOpenChanges={onOpenChanges}
                        expanded={expanded.has(view.goal.id)}
                        onToggle={() => toggle(setExpanded, view.goal.id)}
                        onOpenSession={onOpenSession}
                        onNewChat={onNewGoalChat ? () => onNewGoalChat(view.goal) : undefined}
                        onApproval={onApproval}
                        onQuestionReply={onQuestionReply}
                        onQuestionInteraction={onQuestionInteraction}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function progressText(view: GoalView): string | undefined {
  const progress = view.progress;
  if (!progress) return undefined;
  if (progress.done === progress.total)
    return progress.source === "workers" ? "All agents finished" : "All steps done";
  return progress.source === "workers"
    ? `${progress.done} of ${progress.total} agents finished`
    : `${progress.done} of ${progress.total} steps`;
}

function primarySession(view: GoalView): GoalMemberView | undefined {
  return (
    view.members.find((member) => member.open && member.link.role === "main") ??
    view.members.find((member) => member.open && member.link.role !== "worker") ??
    view.members.find((member) => member.link.role === "main") ??
    view.members[0]
  );
}

function GoalCard({
  view,
  sessionsById,
  orchestrationRuns,
  gateVersion,
  onOpenChanges,
  now,
  expanded,
  onToggle,
  onOpenSession,
  onNewChat,
  onApproval,
  onQuestionReply,
  onQuestionInteraction,
}: {
  view: GoalView;
  sessionsById: ReadonlyMap<string, Session>;
  orchestrationRuns?: readonly OrchestrationRun[];
  gateVersion: number;
  onOpenChanges?: Props["onOpenChanges"];
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenSession: (sessionId: string) => void;
  onNewChat?: () => void;
  onApproval: Props["onApproval"];
  onQuestionReply: Props["onQuestionReply"];
  onQuestionInteraction?: Props["onQuestionInteraction"];
}) {
  const { goal } = view;
  const waiting = view.state === "needsYou";
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const chats = view.members.filter((member) => member.link.role !== "worker").length;
  const workers = view.members.length - chats;
  const summary = useMemo(
    () => goalProgressSummary(view, sessionsById, orchestrationRuns, now),
    [now, orchestrationRuns, sessionsById, view],
  );
  // The state label already says when it needs the user.
  const headline = goal.doneAt
    ? undefined
    : progressHeadline({ ...summary, decisions: 0 });
  const progress = headline ?? progressText(view);
  const criteria = criteriaSummary(goal.criteria);
  const result = useMemo(
    () =>
      view.state === "working" || view.state === "needsYou"
        ? undefined
        : goalResult(view, sessionsById, { gateStatus: completionGateStatus }),
    // The gate's results are read through its version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, sessionsById, gateVersion],
  );
  const primary = primarySession(view);
  const files = view.editedPaths.length;
  return (
    <article
      data-goal={goal.id}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`${FLEET_CARD} ${waiting ? FLEET_CARD_WAITING : FLEET_CARD_CALM}`}
    >
      <div className={`${FLEET_CARD_HEAD} ${result && !expanded && view.state === "review" ? "!pr-44" : "!pr-32"}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${goal.title}`}
          className={`${FLEET_ICON_TILE} hover:bg-content/[0.09]`}
        >
          <CircleDot className={`size-4 shrink-0 ${STATE_TONE[view.state]}`} strokeWidth={1.75} />
        </button>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex min-w-0 items-center gap-1.5">
            {renaming ? (
              <InlineEdit
                value={goal.title}
                label="Goal name"
                onDone={(value) => {
                  setRenaming(false);
                  if (value != null) renameGoal(goal.id, value);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={onToggle}
                onDoubleClick={() => setRenaming(true)}
                title={goal.title}
                className="min-w-0 truncate text-left text-[13px] font-medium leading-5 tracking-[-0.005em] text-content"
              >
                {goal.title}
              </button>
            )}
            {view.unseen ? (
              <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-accent" />
            ) : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-content/45">
            <span className={`shrink-0 ${STATE_TONE[view.state]}`}>
              {GOAL_STATE_LABEL[view.state]}
            </span>
            {view.state === "working" && view.activity ? (
              <span className="flex min-w-0 max-w-[45%] shrink items-center gap-1 text-content/65" title={view.activity}>
                <LoaderCircle className="size-3 shrink-0 animate-spin opacity-70" />
                <span className="truncate">{view.activity}</span>
              </span>
            ) : null}
            {progress ? <Dot>{progress}</Dot> : null}
            {criteria?.checked ? (
              <Dot>
                <span className={criteria.met === criteria.total ? "text-emerald-400/90" : "text-amber-400/90"}>
                  {criteria.met} of {criteria.total} criteria met
                </span>
              </Dot>
            ) : null}
            <Dot>{projectName(goal.cwd)}</Dot>
            {view.branches[0] ? (
              <span className="flex min-w-0 shrink items-center gap-1">
                <GitBranch className="size-3 shrink-0 opacity-70" />
                <span className="truncate">{view.branches[0]}</span>
                {view.branches.length > 1 ? <span>+{view.branches.length - 1}</span> : null}
              </span>
            ) : null}
            <Dot>
              {chats} {chats === 1 ? "chat" : "chats"}
              {workers ? ` · ${workers} ${workers === 1 ? "agent" : "agents"}` : ""}
            </Dot>
          </span>
          {view.state === "interrupted" || view.state === "failed" ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-rose-400/90">
              <RotateCcw className="size-3 shrink-0" />
              <span className="truncate">
                {view.state === "failed"
                  ? "An agent stopped with an error. Open it to see what happened."
                  : "Work stopped before it finished. Open it to resume."}
              </span>
            </span>
          ) : null}
          {view.state === "review" || (view.state === "done" && files) ? (
            <ResultLine view={view} />
          ) : null}
        </span>
      </div>
      <span className="absolute right-2 top-1.5 flex items-center gap-0.5">
        <span className="pr-1 text-[11px] tabular-nums text-content/35">
          {formatLiveElapsed(view.lastActivityAt, now)} ago
        </span>
        {result && !expanded && view.state === "review" ? (
          <button
            type="button"
            onClick={onToggle}
            className="h-6 rounded px-1.5 text-[11px] font-medium text-accent hover:bg-content/10"
          >
            Review
          </button>
        ) : null}
        {primary ? (
          <button
            type="button"
            onClick={() => onOpenSession(primary.link.sessionId)}
            className="h-6 rounded px-1.5 text-[11px] text-content/55 hover:bg-content/10 hover:text-content"
          >
            Open
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`More actions for ${goal.title}`}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom });
          }}
          className="grid size-6 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </span>
      {view.requests.map(({ sessionId, sessionTitle, request }) => (
        <div key={`${sessionId}:${request.kind}:${request.requestId}`}>
          {sessionId !== primary?.link.sessionId ? (
            <div className="border-t border-stroke px-3 pt-1.5 text-[10.5px] text-content/40">
              From {sessionTitle}
            </div>
          ) : null}
          <RequestCard
            request={request}
            onApproval={(requestId, decision) => onApproval(sessionId, requestId, decision)}
            onQuestionReply={(requestId, reply) => onQuestionReply(sessionId, requestId, reply)}
            onQuestionInteraction={
              onQuestionInteraction
                ? (requestId) => onQuestionInteraction(sessionId, requestId)
                : undefined
            }
          />
        </div>
      ))}
      {expanded ? (
        <GoalDetail
          view={view}
          result={result}
          progress={summary}
          onOpenSession={onOpenSession}
          onNewChat={onNewChat}
          onOpenChanges={onOpenChanges}
        />
      ) : null}
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Goal actions"
          items={[
            ...(primary ? [{ kind: "item" as const, id: "open", label: "Open chat" }] : []),
            ...(onNewChat ? [{ kind: "item" as const, id: "new", label: "New chat for this goal" }] : []),
            { kind: "item", id: "rename", label: "Rename" },
            goal.doneAt
              ? { kind: "item", id: "reopen", label: "Reopen" }
              : { kind: "item", id: "done", label: "Mark done" },
            { kind: "sep" },
            {
              kind: "item",
              id: "remove",
              label: "Remove goal",
              description: "Chats stay where they are",
              danger: true,
            },
          ]}
          onPick={(id) => {
            setMenu(null);
            if (id === "open" && primary) onOpenSession(primary.link.sessionId);
            else if (id === "new") onNewChat?.();
            else if (id === "rename") setRenaming(true);
            else if (id === "done") setGoalDone(goal.id, true);
            else if (id === "reopen") setGoalDone(goal.id, false);
            else if (id === "remove") removeGoal(goal.id);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </article>
  );
}

function Dot({ children }: { children: ReactNode }) {
  return (
    <>
      <span aria-hidden className="shrink-0 text-content/25">·</span>
      <span className="min-w-0 shrink truncate">{children}</span>
    </>
  );
}

function ResultLine({ view }: { view: GoalView }) {
  const files = view.editedPaths.length;
  const parts = [
    files ? `${files} ${files === 1 ? "file" : "files"} changed` : "",
    view.artifacts ? `${view.artifacts} ${view.artifacts === 1 ? "artifact" : "artifacts"}` : "",
    view.pullRequests.length
      ? view.pullRequests.map((pr) => `#${pr.number}`).join(", ")
      : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-content/60">
      <FileDiff className="size-3 shrink-0 text-accent" />
      <span className="truncate">{parts.join(" · ")}</span>
    </span>
  );
}

function memberStatus(member: GoalMemberView): string {
  if (member.status === "closed") return "Closed";
  return member.activity ?? AGENT_STATUS_LABEL[member.status];
}

function GoalDetail({
  view,
  result,
  progress,
  onOpenSession,
  onNewChat,
  onOpenChanges,
}: {
  view: GoalView;
  result?: GoalResult;
  progress?: GoalProgressSummary;
  onOpenSession: (sessionId: string) => void;
  onNewChat?: () => void;
  onOpenChanges?: (sessionId: string, workCwd: string) => void;
}) {
  const { goal } = view;
  const [editingScope, setEditingScope] = useState(false);
  const scope = goal.scope ?? "";
  const request = goal.request.trim();
  const showRequest = request && request !== goal.title;
  return (
    <div data-goal-detail className="flex flex-col gap-3 border-t border-stroke px-3 py-2.5 text-[12px]">
      {progress &&
      !goal.doneAt &&
      (progress.remaining.length || progress.blocked.length || (!result && progress.done.length)) ? (
        <ProgressSection progress={progress} onOpenSession={onOpenSession} />
      ) : null}
      {result?.summary ? (
        <DetailSection title="Delivered">
          <div className="max-h-48 overflow-y-auto pr-1 text-content/80">
            <AgentMarkdown text={result.summary} className="text-[12px] leading-relaxed" cwd={result.workCwd} />
          </div>
        </DetailSection>
      ) : null}
      <CriteriaSection goalId={goal.id} criteria={goal.criteria} />
      {result?.checks.length ? <ChecksSection checks={result.checks} /> : null}
      {result?.previews.length ? <PreviewsSection previews={result.previews} /> : null}
      {result?.limitations.length ? (
        <DetailSection title="Known limitations">
          <ul className="flex flex-col gap-0.5" data-goal-limitations>
            {result.limitations.map((item, index) => (
              <li key={index} className="flex min-w-0 items-start gap-2 text-content/70">
                <span className="mt-px w-3 shrink-0 text-center text-amber-400">!</span>
                <span className="min-w-0 leading-5">{item}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}
      <DetailSection title="Scope">
        {editingScope ? (
          <InlineEdit
            multiline
            value={scope}
            label="Scope"
            placeholder="What is in and out of this goal"
            onDone={(value) => {
              setEditingScope(false);
              if (value != null) setGoalScope(goal.id, value);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingScope(true)}
            className="w-full rounded-md text-left text-content/70 hover:bg-content/[0.04]"
          >
            {scope ? (
              <span className="whitespace-pre-wrap">{scope}</span>
            ) : showRequest ? (
              <span className="line-clamp-4 whitespace-pre-wrap text-content/60">{request}</span>
            ) : (
              <span className="text-content/35">Add what is in and out of scope</span>
            )}
          </button>
        )}
      </DetailSection>
      <DetailSection title="Chats and agents">
        <ul className="flex flex-col">
          {view.members.map((member) => (
            <li key={member.link.sessionId}>
              <button
                type="button"
                onClick={() => onOpenSession(member.link.sessionId)}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-content/[0.05]"
              >
                <HarnessIcon harness={member.link.harness} className="size-3.5 shrink-0" />
                <span className={`min-w-0 truncate ${member.open ? "text-content/80" : "text-content/45"}`}>
                  {member.link.title || "Chat"}
                </span>
                {member.link.role !== "main" ? (
                  <span className="shrink-0 rounded bg-content/[0.07] px-1 py-px text-[10px] leading-3 text-content/55">
                    {ROLE_LABEL[member.link.role]}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 truncate pl-2 text-[11px] text-content/40">
                  {memberStatus(member)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {onNewChat ? (
          <button
            type="button"
            onClick={onNewChat}
            className="mt-1 self-start rounded-md px-1 py-0.5 text-[11.5px] text-content/55 hover:bg-content/[0.05] hover:text-content"
          >
            + New chat for this goal
          </button>
        ) : null}
      </DetailSection>
      {view.editedPaths.length || view.pullRequests.length || view.worktrees.length ? (
        <DetailSection title="Changes">
          {view.pullRequests.map((pr) => (
            <button
              key={pr.url}
              type="button"
              onClick={() => void openUrl(pr.url).catch(() => undefined)}
              className="flex min-w-0 items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-content/75 hover:bg-content/[0.05]"
            >
              <GitPullRequest className="size-3 shrink-0 opacity-70" />
              <span className="truncate">
                {pr.kind === "pr" ? "Pull request" : "Issue"} #{pr.number} · {pr.repo}
              </span>
            </button>
          ))}
          {view.editedPaths.length ? (
            <span className="flex min-w-0 items-start gap-1.5 px-1 text-content/60">
              <FileDiff className="mt-0.5 size-3 shrink-0 text-accent" />
              <span className="min-w-0 break-words">
                <span className="text-content/70">
                  {view.editedPaths.length} {view.editedPaths.length === 1 ? "file" : "files"} changed
                </span>{" "}
                <span className="font-mono text-[11px] text-content/45">
                  {view.editedPaths.slice(0, 6).map((path) => basename(path)).join(", ")}
                  {view.editedPaths.length > 6 ? `, +${view.editedPaths.length - 6}` : ""}
                </span>
              </span>
              {result && onOpenChanges ? (
                <button
                  type="button"
                  onClick={() => onOpenChanges(result.sessionId, result.workCwd)}
                  className="ml-auto shrink-0 rounded px-1.5 text-[11px] text-content/50 hover:bg-content/[0.06] hover:text-content"
                >
                  View changes
                </button>
              ) : null}
            </span>
          ) : null}
          {view.worktrees.length ? (
            <span className="truncate px-1 text-content/45" title={view.worktrees.join("\n")}>
              Worktree: {view.worktrees.map((path) => basename(path)).join(", ")}
            </span>
          ) : null}
        </DetailSection>
      ) : null}
    </div>
  );
}

/** Done, left and stuck, as one list across every chat and worker. */
function ProgressSection({
  progress,
  onOpenSession,
}: {
  progress: GoalProgressSummary;
  onOpenSession: (sessionId: string) => void;
}) {
  const [allDone, setAllDone] = useState(false);
  const DONE_SHOWN = 4;
  const done = allDone ? progress.done : progress.done.slice(-DONE_SHOWN);
  const hidden = progress.done.length - done.length;
  const row = (item: ProgressItem, mark: ReactNode, tone: string) => (
    <li key={`${item.sessionId ?? ""}:${item.text}`}>
      <button
        type="button"
        disabled={!item.sessionId}
        onClick={() => item.sessionId && onOpenSession(item.sessionId)}
        className="flex w-full min-w-0 items-start gap-2 rounded-md px-0.5 text-left enabled:hover:bg-content/[0.04]"
      >
        <span className={`mt-px grid h-5 w-3 shrink-0 place-items-center ${tone}`}>{mark}</span>
        <span className="flex min-w-0 flex-col">
          <span className="leading-5 text-content/80">{item.text}</span>
          {item.detail ? (
            <span className="truncate text-[11px] leading-4 text-content/45">{item.detail}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
  return (
    <DetailSection
      title={progress.source === "workers" ? "Progress across agents" : "Progress"}
      action={
        progress.decisions ? (
          <span className="text-[11px] text-amber-400">
            {progress.decisions} {progress.decisions === 1 ? "decision" : "decisions"} waiting on you
          </span>
        ) : null
      }
    >
      <ul className="flex flex-col gap-0.5" data-goal-progress>
        {hidden > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setAllDone(true)}
              className="px-5 text-[11px] text-content/40 hover:text-content/70"
            >
              {hidden} more done
            </button>
          </li>
        ) : null}
        {done.map((item) => row(item, "✓", "text-emerald-400"))}
        {progress.blocked.map((item) => row(item, "!", "text-rose-400"))}
        {progress.remaining.map((item) =>
          row(
            item,
            item.active ? <LoaderCircle className="size-3 animate-spin" /> : "○",
            item.active ? "text-sky-400/90" : "text-content/30",
          ),
        )}
      </ul>
    </DetailSection>
  );
}

const CHECK_MARK: Record<GoalCheckRun["state"], { mark: string; tone: string; label: string }> = {
  passed: { mark: "✓", tone: "text-emerald-400", label: "Passed" },
  failed: { mark: "✗", tone: "text-rose-400", label: "Failed" },
  running: { mark: "…", tone: "text-content/40", label: "Running" },
};

/** Tests, builds and the Completion Gate that ran on the delivery. */
function ChecksSection({ checks }: { checks: readonly GoalCheckRun[] }) {
  return (
    <DetailSection title="Checks">
      <ul className="flex flex-col gap-0.5" data-goal-checks>
        {checks.map((check) => {
          const mark = CHECK_MARK[check.state];
          return (
            <li key={`${check.gate ? "gate" : "run"}:${check.label}`} className="flex min-w-0 items-center gap-2">
              <span aria-label={mark.label} className={`w-3 shrink-0 text-center ${mark.tone}`}>
                {mark.mark}
              </span>
              {check.gate ? (
                <span className="shrink-0 text-content/75">{check.label}</span>
              ) : null}
              <span className="min-w-0 truncate font-mono text-[11px] text-content/55" title={check.command ?? check.label}>
                {check.gate ? check.command : check.label}
              </span>
            </li>
          );
        })}
      </ul>
    </DetailSection>
  );
}

/** What the user can look at instead of the code. */
function PreviewsSection({ previews }: { previews: readonly GoalPreview[] }) {
  return (
    <DetailSection title="Look at it">
      <div className="flex flex-wrap gap-1.5" data-goal-previews>
        {previews.map((preview) => (
          <button
            key={preview.key}
            type="button"
            title={preview.url ?? preview.artifact?.path ?? preview.title}
            onClick={() => {
              if (preview.artifact) requestOpenArtifact(preview.artifact, true);
              else if (preview.url)
                window.dispatchEvent(new CustomEvent<string>(OPEN_BROWSER_URL_EVENT, { detail: preview.url }));
            }}
            className="flex min-w-0 max-w-[16rem] items-center gap-1.5 rounded-md border border-content/10 bg-content/[0.03] px-2 py-1 text-[11.5px] text-content/75 hover:border-content/20 hover:text-content"
          >
            {preview.kind === "url" ? (
              <Globe className="size-3 shrink-0 opacity-70" />
            ) : (
              <Eye className="size-3 shrink-0 opacity-70" />
            )}
            <span className="truncate">{preview.title}</span>
          </button>
        ))}
      </div>
    </DetailSection>
  );
}

function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.04em] text-content/35">
          {title}
        </span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </span>
      {children}
    </div>
  );
}

const VERDICT_MARK: Record<CriterionVerdict, { mark: string; tone: string; label: string }> = {
  met: { mark: "✓", tone: "text-emerald-400", label: "Met" },
  unmet: { mark: "✗", tone: "text-rose-400", label: "Not met" },
  unverified: { mark: "?", tone: "text-amber-400", label: "Not verified" },
};

/** When the goal counts as done, and how the last delivery measured up. */
function CriteriaSection({
  goalId,
  criteria,
}: {
  goalId: string;
  criteria?: readonly GoalCriterion[];
}) {
  const [editing, setEditing] = useState(false);
  const text = (criteria ?? []).map((criterion) => criterion.text).join("\n");
  return (
    <DetailSection
      title="Done when"
      action={
        !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded px-1 text-[11px] text-content/40 hover:bg-content/[0.06] hover:text-content/75"
          >
            Edit
          </button>
        ) : null
      }
    >
      {editing ? (
        <InlineEdit
          multiline
          value={text}
          label="Completion criteria, one per line"
          placeholder="One criterion per line"
          onDone={(value) => {
            setEditing(false);
            if (value != null && value.trim() !== text.trim())
              setGoalCriteria(goalId, value.split("\n"));
          }}
        />
      ) : criteria?.length ? (
        <ul className="flex flex-col gap-1" data-goal-criteria>
          {criteria.map((criterion, index) => {
            const verdict = criterion.verdict ? VERDICT_MARK[criterion.verdict] : undefined;
            return (
              <li key={index} className="flex min-w-0 items-start gap-2">
                <span
                  aria-label={verdict?.label ?? "Not checked yet"}
                  className={`mt-px w-3 shrink-0 text-center text-[12px] leading-5 ${verdict?.tone ?? "text-content/30"}`}
                >
                  {verdict?.mark ?? "·"}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="leading-5 text-content/80">{criterion.text}</span>
                  {criterion.evidence ? (
                    <span className="text-[11px] leading-4 text-content/45">{criterion.evidence}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="self-start rounded-md text-left text-content/35 hover:text-content/60"
        >
          The agent sets these out when it starts. Add your own
        </button>
      )}
    </DetailSection>
  );
}

function InlineEdit({
  value,
  label,
  placeholder,
  multiline = false,
  onDone,
}: {
  value: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  /** `null` when the edit was cancelled. */
  onDone: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  const common = {
    autoFocus: true,
    value: draft,
    "aria-label": label,
    placeholder,
    spellCheck: false,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => finish(draft),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      } else if (event.key === "Enter" && (!multiline || event.metaKey)) {
        event.preventDefault();
        finish(draft);
      }
    },
    className:
      "w-full min-w-0 rounded-md border border-content/15 bg-transparent px-1.5 py-0.5 text-content outline-none select-text focus:border-content/30",
  };
  return multiline ? (
    <textarea {...common} rows={3} className={`${common.className} resize-y text-[12px] leading-relaxed`} />
  ) : (
    <input {...common} className={`${common.className} text-[13px] font-medium`} />
  );
}

function GoalsMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 pb-12 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-content/5">
        <CircleDot className="size-5 text-content/35" strokeWidth={1.5} />
      </span>
      <p className="mt-1 text-[13px] font-medium text-content/85">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-content/50">{body}</p>
    </div>
  );
}
