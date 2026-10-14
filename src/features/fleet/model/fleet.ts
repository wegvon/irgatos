import { sessionEditPaths } from "../../sessions/model/checkpointEdits";
import {
  sessionDisplayTitle,
  sessionWorkCwd,
  type Block,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import { toolCallLabel } from "../../sessions/model/transcriptActivity";
import type { UserQuestionPrompt } from "../../sessions/model/userQuestion";
import { pathKey, projectName } from "../../../shared/lib/paths";

/** Attention list order: what blocks on the user first. */
export const FLEET_BUCKETS = ["needsYou", "review", "running", "idle"] as const;
export type FleetBucket = (typeof FLEET_BUCKETS)[number];

export const FLEET_BUCKET_LABEL: Record<FleetBucket, string> = {
  needsYou: "Needs you",
  review: "Ready to review",
  running: "Running",
  idle: "Idle",
};

/** A finished turn with changes stays reviewable this long after it is seen. */
export const REVIEW_WINDOW_MS = 2 * 60 * 60 * 1000;

export type FleetRequest =
  | {
      kind: "approval";
      requestId: number;
      /** What the agent wants to do, e.g. "Run npm test". */
      label: string;
      /** The exact command or path, when it adds to the label. */
      detail?: string;
    }
  | { kind: "question"; requestId: number; prompt: UserQuestionPrompt };

export type FleetEntry = {
  sessionId: string;
  bucket: FleetBucket;
  title: string;
  harness: HarnessId;
  /** Project the session belongs to, for grouping and the row's subtitle. */
  project: string;
  projectLabel: string;
  /** The session runs in a linked worktree rather than the project folder. */
  worktree: boolean;
  workCwd: string;
  branch?: string;
  /** Name of the Irgat this chat belongs to. */
  irgat?: string;
  /** Orchestration lead an internal worker reports to. */
  leadId?: string;
  requests: FleetRequest[];
  /** Running: what the agent is doing now. */
  activity?: string;
  /** Review: files the last turn edited and artifacts it saved. */
  editedPaths: string[];
  artifacts: number;
  /** The user has not looked at this session since its turn finished. */
  unseen: boolean;
  /** Last activity, for ordering within a bucket. */
  at: number;
};

export type Fleet = Record<FleetBucket, FleetEntry[]> & {
  /** Sessions in Needs you; the rail badge shows this. */
  needsYouCount: number;
  total: number;
};

export type FleetOptions = {
  unseenFinishedIds?: ReadonlySet<string>;
  /** Irgat name for a session that is a Irgat's chat. */
  irgatName?: (sessionId: string) => string | undefined;
  /** Display label for a project path, e.g. a renamed tab group. */
  projectLabel?: (cwd: string) => string;
  now?: number;
};

const DETAIL_MAX = 400;

function approvalRequest(block: Block, cwd: string): FleetRequest | null {
  if (!block.approval || block.approval.decided) return null;
  const label = toolCallLabel(block, cwd);
  const preview = block.tool?.preview;
  const raw =
    (preview?.kind === "shell" ? preview.query || preview.title : undefined) ||
    block.tool?.detail ||
    preview?.path ||
    "";
  const detail = raw.trim();
  return {
    kind: "approval",
    requestId: block.approval.requestId,
    label,
    ...(detail && detail !== label
      ? {
          detail:
            detail.length > DETAIL_MAX
              ? `${detail.slice(0, DETAIL_MAX - 1)}…`
              : detail,
        }
      : {}),
  };
}

/** Undecided approvals, oldest first, then the open question. */
export function fleetRequests(session: Session): FleetRequest[] {
  if (session.worktreeRemoved) return [];
  const requests: FleetRequest[] = [];
  for (const block of session.blocks) {
    const request = approvalRequest(block, sessionWorkCwd(session));
    if (request) requests.push(request);
  }
  if (session.pendingQuestion) {
    requests.push({
      kind: "question",
      requestId: session.pendingQuestion.requestId,
      prompt: session.pendingQuestion,
    });
  }
  return requests;
}

const DONE_STATUSES = new Set([
  "completed",
  "success",
  "failed",
  "error",
  "cancelled",
  "canceled",
]);

/** What a busy session is doing, from its newest unfinished tool or reply. */
export function fleetActivity(session: Session): string {
  const cwd = sessionWorkCwd(session);
  for (let index = session.blocks.length - 1; index >= 0; index--) {
    const block = session.blocks[index];
    if (block.role === "user" && !block.draft) break;
    if (block.role === "tool" && block.tool) {
      const status = block.tool.status?.toLowerCase() ?? "";
      if (!DONE_STATUSES.has(status) || block.tool.background) {
        return toolCallLabel(block, cwd);
      }
    }
    if (block.role === "assistant" && block.streaming) return "Writing a reply";
  }
  if (session.backgroundTasks?.length) {
    return `Waiting on ${session.backgroundTasks[0]}`;
  }
  return "Working";
}

function lastTurn(blocks: readonly Block[]): {
  start: number;
  finishedAt: number;
} {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role !== "user" || block.draft) continue;
    const startedAt = block.startedAt ?? block.sentAt ?? 0;
    return {
      start: index,
      finishedAt: startedAt + (block.durationMs ?? 0),
    };
  }
  return { start: 0, finishedAt: 0 };
}

function lastTurnArtifacts(blocks: readonly Block[], start: number): number {
  let count = 0;
  for (let index = start; index < blocks.length; index++) {
    count += blocks[index].artifactCards?.length ?? 0;
  }
  return count;
}

/** Sessions worth listing: not a habit's hidden run, an Inbox ask, or a blank tab. */
function listed(session: Session): boolean {
  if (session.ephemeral || session.inboxAsk) return false;
  return (
    !!session.busy ||
    session.blocks.some((block) => block.role === "user" && !block.draft)
  );
}

export function fleetEntry(
  session: Session,
  options: FleetOptions = {},
): FleetEntry | null {
  const requests = fleetRequests(session);
  // A worker answers to its lead; list it only while it waits on the user.
  if (session.orchestrationLeadId && requests.length === 0) return null;
  if (!requests.length && !listed(session)) return null;
  const now = options.now ?? Date.now();
  const turn = lastTurn(session.blocks);
  const unseen = !!options.unseenFinishedIds?.has(session.id);
  const editedPaths = session.busy ? [] : sessionEditPaths(session.blocks);
  const artifacts = session.busy
    ? 0
    : lastTurnArtifacts(session.blocks, turn.start);
  const recent =
    unseen || (turn.finishedAt > 0 && now - turn.finishedAt <= REVIEW_WINDOW_MS);
  const bucket: FleetBucket = requests.length
    ? "needsYou"
    : session.busy
      ? "running"
      : recent && (editedPaths.length > 0 || artifacts > 0)
        ? "review"
        : "idle";
  const workCwd = sessionWorkCwd(session);
  const irgat = options.irgatName?.(session.id);
  return {
    sessionId: session.id,
    bucket,
    title: sessionDisplayTitle(session.title, session.harness),
    harness: session.harness,
    project: session.cwd,
    projectLabel:
      irgat ?? options.projectLabel?.(session.cwd) ?? projectName(session.cwd),
    worktree: pathKey(workCwd) !== pathKey(session.cwd),
    workCwd,
    ...(session.branch ? { branch: session.branch } : {}),
    ...(irgat ? { irgat } : {}),
    ...(session.orchestrationLeadId
      ? { leadId: session.orchestrationLeadId }
      : {}),
    requests,
    ...(bucket === "running" ? { activity: fleetActivity(session) } : {}),
    editedPaths,
    artifacts,
    unseen,
    at: Math.max(turn.finishedAt, lastBlockTime(session.blocks)),
  };
}

function lastBlockTime(blocks: readonly Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    const at = block.sentAt ?? block.startedAt ?? block.irgatHabit?.at;
    if (at) return at;
  }
  return 0;
}

/** Every open session across all projects, grouped into the four buckets. */
export function buildFleet(
  sessions: readonly Session[],
  options: FleetOptions = {},
): Fleet {
  const fleet: Fleet = {
    needsYou: [],
    review: [],
    running: [],
    idle: [],
    needsYouCount: 0,
    total: 0,
  };
  const seen = new Set<string>();
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    const entry = fleetEntry(session, options);
    if (!entry) continue;
    fleet[entry.bucket].push(entry);
    fleet.total += 1;
  }
  // Waiting longest first: the oldest request has blocked its agent the longest.
  fleet.needsYou.sort((a, b) => a.at - b.at);
  for (const bucket of ["review", "running", "idle"] as const) {
    fleet[bucket].sort(
      (a, b) => Number(b.unseen) - Number(a.unseen) || b.at - a.at,
    );
  }
  fleet.needsYouCount = fleet.needsYou.length;
  return fleet;
}

/** Sessions waiting on the user, for the Fleet badge without building rows. */
export function countNeedsYou(sessions: readonly Session[]): number {
  let count = 0;
  for (const session of sessions) {
    if (session.ephemeral || session.inboxAsk) continue;
    if (fleetRequests(session).length) count += 1;
  }
  return count;
}

export function filterFleet(fleet: Fleet, query: string): Fleet {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return fleet;
  const matches = (entry: FleetEntry) =>
    [
      entry.title,
      entry.projectLabel,
      entry.branch ?? "",
      entry.activity ?? "",
      ...entry.requests.map((request) =>
        request.kind === "approval"
          ? `${request.label}\n${request.detail ?? ""}`
          : [
              request.prompt.title ?? "",
              ...request.prompt.questions.map((question) => question.prompt),
            ].join("\n"),
      ),
    ]
      .join("\n")
      .toLocaleLowerCase()
      .includes(needle);
  const next = {
    needsYou: fleet.needsYou.filter(matches),
    review: fleet.review.filter(matches),
    running: fleet.running.filter(matches),
    idle: fleet.idle.filter(matches),
  };
  return {
    ...next,
    needsYouCount: fleet.needsYouCount,
    total:
      next.needsYou.length +
      next.review.length +
      next.running.length +
      next.idle.length,
  };
}
