import type { ReviewMarks } from "../../fleet/model/reviewMarks";
import { sessionParents, sessionAgent } from "../../agent-tree/model/agentTree";
import type { AgentStatus } from "../../agent-tree/model/agentTree";
import {
  fleetActivity,
  fleetEntry,
  fleetRequests,
  type FleetRequest,
} from "../../fleet/model/fleet";
import { isFreeChatCwd } from "../../freechat/model/freeChatPath";
import { sessionEditPaths } from "../../sessions/model/checkpointEdits";
import {
  sessionDisplayTitle,
  sessionWorkCwd,
  type HarnessId,
  type LinkedWorkItem,
  type Session,
  type TaskListItem,
} from "../../sessions/model/session";
import { pathKey } from "../../../shared/lib/paths";
import {
  applyCriteriaCheck,
  criteriaInBlocks,
  type GoalCriterion,
} from "./criteria";

/**
 * A goal is the user's outcome, kept apart from the conversations that work on
 * it. Chats, orchestration workers, forks and retries hang beneath one goal;
 * switching providers keeps the session id, and closing a chat keeps the goal,
 * so the goal's identity never moves.
 */

/** How a conversation came to work on its goal. */
export type GoalLinkRole = "main" | "worker" | "fork" | "launched" | "chat";

export type GoalLink = {
  sessionId: string;
  role: GoalLinkRole;
  addedAt: number;
  /** Last seen while open, so a closed chat still reads well. */
  title: string;
  harness: HarnessId;
  workCwd: string;
  branch?: string;
  /** Last state seen while the conversation was loaded. */
  lastStatus?: AgentStatus;
};

export type Goal = {
  id: string;
  /** What the user wants, in a line. Editable. */
  title: string;
  /** Not renamed by the user: follows the main chat's generated title. */
  autoTitle?: boolean;
  /** The request that started it, kept whole as the goal's scope. */
  request: string;
  /** What is in and out, when the user narrowed it. */
  scope?: string;
  /** Project the work belongs to. */
  cwd: string;
  createdAt: number;
  updatedAt: number;
  /** The user called it done. */
  doneAt?: number;
  /** When the goal is done, in plain sentences, with the latest verdicts. */
  criteria?: GoalCriterion[];
  /** When the current criteria were set; older checks do not apply. */
  criteriaAt?: number;
  /** The chat whose reply set them, absent when the user wrote them. */
  criteriaFrom?: string;
  /** The user wrote or changed them; agents' later lists do not replace them. */
  criteriaEdited?: boolean;
  /** When the agent last checked delivery against them. */
  checkedAt?: number;
  links: GoalLink[];
};

export const GOAL_TITLE_MAX = 120;
const REQUEST_MAX = 4_000;

function firstLine(text: string, max = GOAL_TITLE_MAX): string {
  const line =
    text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** First request the user typed in this conversation, not an app prompt. */
function firstRequest(session: Session): { text: string; at?: number } | null {
  for (const block of session.blocks) {
    if (block.role !== "user" || block.draft || block.internal) continue;
    if (block.irgatSessionCompletion || block.fromIrgat) continue;
    const text = block.text.trim();
    if (!text && !block.attachments?.length) continue;
    return {
      text: text || block.attachments!.map((file) => file.name).join(", "),
      at: block.startedAt ?? block.sentAt,
    };
  }
  return null;
}

export type GoalSyncOptions = {
  /** Sessions that never become goals: Irgat chats and the like. */
  excluded?: ReadonlySet<string>;
  /** Known launches (child -> starter) the sessions' own records may lack. */
  launchedBy?: Readonly<Record<string, string>>;
  interruptedIds?: ReadonlySet<string>;
  now?: number;
  newId?: () => string;
};

/** Conversations that can carry a goal: real work, not a side surface. */
export function goalCandidate(
  session: Session,
  excluded?: ReadonlySet<string>,
): boolean {
  if (
    session.ephemeral ||
    session.inboxAsk ||
    session.sidebarHidden ||
    session.irgatTranscript
  )
    return false;
  if (excluded?.has(session.id)) return false;
  if (isFreeChatCwd(session.cwd)) return false;
  return firstRequest(session) != null;
}

/** The chat's own name once it has one, not the provider placeholder. */
function chatTitle(session: Session): string | undefined {
  const title = sessionDisplayTitle(session.title, session.harness).trim();
  return title && title !== "New session" ? firstLine(title) : undefined;
}

function forkSource(session: Session): string | undefined {
  return session.blocks.find((block) => block.forkPoint)?.forkPoint
    ?.fromSessionId;
}

function linkSnapshot(
  session: Session,
  role: GoalLinkRole,
  addedAt: number,
  interruptedIds?: ReadonlySet<string>,
): GoalLink {
  return {
    sessionId: session.id,
    role,
    addedAt,
    title: sessionDisplayTitle(session.title, session.harness),
    harness: session.harness,
    workCwd: sessionWorkCwd(session),
    ...(session.branch ? { branch: session.branch } : {}),
    lastStatus: sessionAgent(session, { interruptedIds }).status,
  };
}

function sameLink(a: GoalLink, b: GoalLink): boolean {
  return (
    a.title === b.title &&
    a.harness === b.harness &&
    a.workCwd === b.workCwd &&
    a.branch === b.branch &&
    a.lastStatus === b.lastStatus &&
    a.role === b.role
  );
}

/**
 * Give every working conversation a goal. A conversation started by another
 * (an orchestration worker, a fork, a retry, a launched session) joins its
 * starter's goal; anything else starts a goal of its own from its first
 * request. Snapshots of loaded conversations are refreshed; conversations
 * that are not loaded keep their last snapshot. Returns `goals` itself when
 * nothing changed.
 */
export function syncGoals(
  goals: readonly Goal[],
  sessions: readonly Session[],
  options: GoalSyncOptions = {},
): readonly Goal[] {
  const now = options.now ?? Date.now();
  const newId = options.newId ?? (() => crypto.randomUUID());
  const candidates = sessions.filter((session) =>
    goalCandidate(session, options.excluded),
  );
  if (candidates.length === 0) return goals;
  const parents = sessionParents(sessions, {}, options.launchedBy);
  for (const session of candidates) {
    const source = forkSource(session);
    if (source && source !== session.id && !parents.has(session.id))
      parents.set(session.id, source);
  }
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const next = goals.map((goal) => ({ ...goal, links: [...goal.links] }));
  const owner = new Map<string, number>();
  next.forEach((goal, index) => {
    for (const link of goal.links) owner.set(link.sessionId, index);
  });
  let changed = false;

  const roleFor = (session: Session, parentId: string): GoalLinkRole => {
    if (session.orchestrationLeadId === parentId) return "worker";
    if (forkSource(session) === parentId) return "fork";
    return "launched";
  };

  // Children whose starter has a goal join it; walk until nothing moves so a
  // worker of a fork of a chat still lands on the chat's goal.
  const pending = candidates.filter((session) => !owner.has(session.id));
  let moved = true;
  while (moved && pending.length) {
    moved = false;
    for (let index = pending.length - 1; index >= 0; index--) {
      const session = pending[index];
      const parentId = parents.get(session.id);
      const goalIndex = parentId != null ? owner.get(parentId) : undefined;
      if (goalIndex == null) continue;
      next[goalIndex].links.push(
        linkSnapshot(
          session,
          roleFor(session, parentId!),
          now,
          options.interruptedIds,
        ),
      );
      next[goalIndex].updatedAt = now;
      owner.set(session.id, goalIndex);
      pending.splice(index, 1);
      moved = true;
      changed = true;
    }
    if (moved) continue;
    // A root (or a child whose starter can never carry a goal) starts one.
    const rootIndex = pending.findIndex((session) => {
      const parentId = parents.get(session.id);
      const parent = parentId ? byId.get(parentId) : undefined;
      return (
        !parent ||
        !goalCandidate(parent, options.excluded) ||
        !pending.includes(parent)
      );
    });
    if (rootIndex < 0) break;
    const root = pending.splice(rootIndex, 1)[0];
    const request = firstRequest(root)!;
    const createdAt = request.at ?? now;
    next.push({
      id: newId(),
      title: chatTitle(root) ?? firstLine(request.text),
      autoTitle: true,
      request: request.text.slice(0, REQUEST_MAX),
      cwd: root.cwd,
      createdAt,
      updatedAt: now,
      links: [linkSnapshot(root, "main", createdAt, options.interruptedIds)],
    });
    owner.set(root.id, next.length - 1);
    moved = true;
    changed = true;
  }

  // Refresh what loaded conversations look like now.
  for (const session of candidates) {
    const goalIndex = owner.get(session.id);
    if (goalIndex == null) continue;
    const goal = next[goalIndex];
    const at = goal.links.findIndex((link) => link.sessionId === session.id);
    if (at < 0) continue;
    const current = goal.links[at];
    const named = chatTitle(session);
    if (goal.autoTitle && current.role === "main" && named && named !== goal.title) {
      goal.title = named;
      changed = true;
    }
    const fresh = linkSnapshot(
      session,
      current.role,
      current.addedAt,
      options.interruptedIds,
    );
    if (sameLink(current, fresh)) continue;
    goal.links[at] = fresh;
    changed = true;
  }
  for (let index = 0; index < next.length; index++) {
    const updated = syncCriteria(next[index], byId);
    if (updated !== next[index]) {
      next[index] = updated;
      changed = true;
    }
  }
  return changed ? next : goals;
}

function sameCriteria(
  a: readonly GoalCriterion[] | undefined,
  b: readonly GoalCriterion[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (item, index) =>
      item.text === b[index].text &&
      item.verdict === b[index].verdict &&
      item.evidence === b[index].evidence,
  );
}

/** Take the newest criteria and check the goal's loaded chats wrote. */
function syncCriteria(
  goal: Goal,
  sessionsById: ReadonlyMap<string, Session>,
): Goal {
  let criteria: { items: string[]; at: number; from: string } | undefined;
  let check: { items: NonNullable<ReturnType<typeof criteriaInBlocks>["check"]>; at: number } | undefined;
  for (const link of goal.links) {
    // Workers and launched chats judge their own slice, not the goal.
    if (link.role !== "main" && link.role !== "chat") continue;
    const session = sessionsById.get(link.sessionId);
    if (!session) continue;
    const found = criteriaInBlocks(session.blocks);
    if (found.criteria && (!criteria || found.at >= criteria.at))
      criteria = { items: found.criteria, at: found.at, from: session.id };
    if (found.check && (!check || found.at >= check.at))
      check = { items: found.check, at: found.at };
  }
  let next = goal;
  if (
    criteria &&
    !goal.criteriaEdited &&
    criteria.at >= (goal.criteriaAt ?? 0) &&
    !sameCriteria(
      goal.criteria?.map(({ text }) => ({ text })),
      criteria.items.map((text) => ({ text })),
    )
  ) {
    next = {
      ...next,
      criteria: criteria.items.map((text) => ({ text })),
      criteriaAt: criteria.at,
      criteriaFrom: criteria.from,
      checkedAt: undefined,
    };
  }
  if (check && next.criteria?.length && check.at >= (next.criteriaAt ?? 0)) {
    const checked = applyCriteriaCheck(next.criteria, check.items);
    if (!sameCriteria(checked, next.criteria) || next.checkedAt !== check.at)
      next = { ...next, criteria: checked, checkedAt: check.at };
  }
  return next;
}

/** The goal a conversation works on, if any. */
export function goalForSession(
  goals: readonly Goal[],
  sessionId: string,
): Goal | undefined {
  return goals.find((goal) =>
    goal.links.some((link) => link.sessionId === sessionId),
  );
}

export type GoalState =
  | "needsYou"
  | "interrupted"
  | "failed"
  | "working"
  | "review"
  | "idle"
  | "done";

export const GOAL_STATES: readonly GoalState[] = [
  "needsYou",
  "interrupted",
  "failed",
  "working",
  "review",
  "idle",
  "done",
];

export const GOAL_STATE_LABEL: Record<GoalState, string> = {
  needsYou: "Needs you",
  interrupted: "Interrupted",
  failed: "Failed",
  working: "Working",
  review: "Ready to review",
  idle: "Idle",
  done: "Done",
};

export type GoalMemberView = {
  link: GoalLink;
  /** Loaded right now; closed conversations show their last snapshot. */
  open: boolean;
  status: AgentStatus | "closed";
  activity?: string;
};

export type GoalRequest = {
  sessionId: string;
  sessionTitle: string;
  request: FleetRequest;
};

export type GoalProgress = {
  done: number;
  total: number;
  /** Where the count comes from: the agent's own steps or its workers. */
  source: "steps" | "workers";
};

export type GoalView = {
  goal: Goal;
  state: GoalState;
  members: GoalMemberView[];
  requests: GoalRequest[];
  /** What a running conversation is doing now. */
  activity?: string;
  progress?: GoalProgress;
  editedPaths: string[];
  artifacts: number;
  pullRequests: LinkedWorkItem[];
  branches: string[];
  worktrees: string[];
  unseen: boolean;
  lastActivityAt: number;
  /** Chats whose finished result keeps this goal in Ready to review. */
  toReview: { sessionId: string; turnAt: number }[];
};

export type GoalViewOptions = {
  now?: number;
  /** Explicit review marks, so a goal leaves review only when marked. */
  reviews?: ReviewMarks;
  unseenFinishedIds?: ReadonlySet<string>;
  interruptedIds?: ReadonlySet<string>;
};

function latestTaskList(session: Session): TaskListItem[] | undefined {
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.taskList?.items.length) return block.taskList.items;
    if (block.role === "user" && !block.draft && !block.internal) break;
  }
  return undefined;
}

function lastActivity(session: Session): number {
  let at = 0;
  for (const block of session.blocks) {
    const begun = block.startedAt ?? block.sentAt ?? 0;
    at = Math.max(at, begun + (block.durationMs ?? 0));
  }
  return at;
}

/** Everything the Goals view shows for one goal, from its live conversations. */
export function goalView(
  goal: Goal,
  sessionsById: ReadonlyMap<string, Session>,
  options: GoalViewOptions = {},
): GoalView {
  const members: GoalMemberView[] = [];
  const requests: GoalRequest[] = [];
  const edited = new Set<string>();
  const pullRequests = new Map<string, LinkedWorkItem>();
  const branches = new Set<string>();
  const worktrees = new Set<string>();
  let artifacts = 0;
  let activity: string | undefined;
  let progress: GoalProgress | undefined;
  let unseen = false;
  let review = false;
  const toReview: GoalView["toReview"] = [];
  let lastActivityAt = goal.createdAt;
  for (const link of goal.links) {
    const session = sessionsById.get(link.sessionId);
    if (link.branch) branches.add(link.branch);
    if (pathKey(link.workCwd) !== pathKey(goal.cwd)) worktrees.add(link.workCwd);
    if (!session) {
      members.push({ link, open: false, status: "closed" });
      continue;
    }
    const agent = sessionAgent(session, { interruptedIds: options.interruptedIds });
    // A usage limit stopped it short, like an interruption.
    if (session.usageLimit && !session.busy && agent.status !== "needs_you")
      agent.status = "stopped";
    const running = agent.status === "running";
    const memberActivity = running ? fleetActivity(session) : undefined;
    members.push({
      link,
      open: true,
      status: agent.status,
      ...(memberActivity ? { activity: memberActivity } : {}),
    });
    if (memberActivity && !activity) activity = memberActivity;
    for (const request of fleetRequests(session)) {
      requests.push({
        sessionId: session.id,
        sessionTitle: link.title,
        request,
      });
    }
    if (!session.busy) {
      for (const path of sessionEditPaths(session.blocks)) edited.add(path);
    }
    for (const block of session.blocks)
      artifacts += block.artifactCards?.length ?? 0;
    if (session.linkedWorkItem)
      pullRequests.set(session.linkedWorkItem.url, session.linkedWorkItem);
    if (options.unseenFinishedIds?.has(session.id)) unseen = true;
    const entry = fleetEntry(session, {
      now: options.now,
      unseenFinishedIds: options.unseenFinishedIds,
      interruptedIds: options.interruptedIds,
      reviews: options.reviews,
    });
    if (entry?.bucket === "review") {
      review = true;
      toReview.push({ sessionId: session.id, turnAt: entry.turnAt });
    }
    lastActivityAt = Math.max(lastActivityAt, lastActivity(session));
    if (link.role === "main" || !progress) {
      const items = latestTaskList(session);
      if (items?.length) {
        const actionable = items.filter((item) => item.status !== "cancelled");
        progress = {
          done: actionable.filter((item) => item.status === "completed").length,
          total: actionable.length,
          source: "steps",
        };
      }
    }
  }
  const workers = members.filter((member) => member.link.role === "worker");
  if (!progress && workers.length > 0) {
    progress = {
      done: workers.filter((member) =>
        member.status === "done" ||
        (member.status === "closed" && member.link.lastStatus === "done"),
      ).length,
      total: workers.length,
      source: "workers",
    };
  }
  const statuses = new Set(members.map((member) => member.status));
  const state: GoalState = goal.doneAt
    ? "done"
    : requests.length
      ? "needsYou"
      : statuses.has("running")
        ? "working"
        : statuses.has("stopped")
          ? "interrupted"
          : statuses.has("failed")
            ? "failed"
            : review
              ? "review"
              : "idle";
  return {
    goal,
    state,
    members,
    requests,
    ...(activity ? { activity } : {}),
    ...(progress && progress.total > 0 ? { progress } : {}),
    editedPaths: [...edited],
    artifacts,
    pullRequests: [...pullRequests.values()],
    branches: [...branches],
    worktrees: [...worktrees],
    unseen,
    lastActivityAt,
    toReview,
  };
}

/** Attention order: what blocks on the user first, newest first within. */
export function sortGoalViews(views: GoalView[]): GoalView[] {
  return [...views].sort(
    (a, b) =>
      GOAL_STATES.indexOf(a.state) - GOAL_STATES.indexOf(b.state) ||
      Number(b.unseen) - Number(a.unseen) ||
      b.lastActivityAt - a.lastActivityAt,
  );
}

export function filterGoalViews(views: GoalView[], query: string): GoalView[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return views;
  return views.filter((view) =>
    [
      view.goal.title,
      view.goal.request,
      view.goal.scope ?? "",
      ...view.branches,
      ...view.members.map((member) => member.link.title),
    ]
      .join("\n")
      .toLocaleLowerCase()
      .includes(needle),
  );
}
