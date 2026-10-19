import { fleetActivity, fleetRequests } from "../../fleet/model/fleet";
import { resolveModel } from "../../sessions/model/models";
import {
  sessionDisplayTitle,
  type Block,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";

/** Who-started-whom view of the agents Irgatos runs. */

export type AgentStatus = "running" | "done" | "needs_you" | "failed" | "stopped";

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  running: "Running",
  done: "Done",
  needs_you: "Needs you",
  failed: "Failed",
  stopped: "Stopped",
};

/** root: the app itself; irgat: an Irgat's chat; worker: an orchestration worker. */
export type AgentRole = "root" | "irgat" | "session" | "worker" | "subagent";

export type AgentToolIcon = "terminal" | "doc" | "web" | "key" | "chat";

export type Agent = {
  id: string;
  parentId?: string;
  name: string;
  role: AgentRole;
  harness?: HarnessId;
  model: string;
  task: string;
  toolIcon: AgentToolIcon;
  status: AgentStatus;
  /** Spend the provider reported; absent when it reports none. */
  costUsd?: number;
  /** Tokens used, shown when no cost is reported. */
  tokens?: number;
  startedAt?: number;
  endedAt?: number;
  /** Finished work time; a running agent adds the time since `activeSince`. */
  workedMs?: number;
  activeSince?: number;
  error?: string;
  /** Session the card opens; a subagent opens its parent's. */
  sessionId?: string;
  /** What Retry runs again, in `sessionId`'s project and model. */
  retryPrompt?: string;
  /** The agent this one is a retry of; it sits right after that one. */
  retryOf?: string;
  /** What a running agent is doing this moment. */
  activity?: string;
};

export type AgentTreeNode = Agent & { children: AgentTreeNode[] };

/** A retry started from the tree: the new session stands in for `from`. */
export type AgentRetryLink = { from: string; parentId?: string };
export type AgentRetryLinks = Readonly<Record<string, AgentRetryLink>>;

export type AgentTreeOptions = {
  now?: number;
  /** Sessions active before this are left out unless something below them is not. */
  since?: number;
  interruptedIds?: ReadonlySet<string>;
  irgatName?: (sessionId: string) => string | undefined;
  retries?: AgentRetryLinks;
};

export const AGENT_TREE_ROOT_ID = "irgatos";

const TASK_MAX = 160;

function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return line.length > TASK_MAX ? `${line.slice(0, TASK_MAX - 1)}…` : line;
}

function lastUserIndex(blocks: readonly Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index].role === "user" && !blocks[index].draft) return index;
  }
  return -1;
}

/** Icon for a tool call: ACP kinds first, then the label. */
export function toolIconFor(kind?: string, label = ""): AgentToolIcon {
  const k = (kind ?? "").toLowerCase();
  if (k === "execute" || k === "shell" || k === "bash") return "terminal";
  if (k === "fetch" || /\b(web|browser|url|http|fetch)/i.test(label))
    return "web";
  if (/\b(secret|key|token|credential|login)/i.test(label)) return "key";
  if (["read", "edit", "delete", "move", "search", "write"].includes(k))
    return "doc";
  if (/^(run|bash|shell)\b/i.test(label)) return "terminal";
  return "doc";
}

function sessionToolIcon(session: Session, from: number): AgentToolIcon {
  if (session.blocks.some((block) => block.approval && !block.approval.decided))
    return "key";
  for (let index = session.blocks.length - 1; index > from; index--) {
    const tool = session.blocks[index].tool;
    if (tool && !session.blocks[index].agentRun)
      return toolIconFor(tool.kind, tool.title ?? "");
  }
  return "chat";
}

/** Error shown after the last turn, when that turn ended in one. */
function lastTurnError(blocks: readonly Block[], from: number): string | undefined {
  for (let index = blocks.length - 1; index > from; index--) {
    const block = blocks[index];
    if (block.role === "system" && block.notice === "error")
      return block.text.trim() || "The agent stopped with an error.";
  }
  return undefined;
}

function modelName(harness: HarnessId, model: string, turn?: Block): string {
  if (turn?.turnModel?.name) return turn.turnModel.name;
  try {
    return resolveModel(harness, model).name || model;
  } catch {
    return model;
  }
}

/** Sessions the tree lists: no habit runs, Inbox asks or blank tabs. */
function listed(session: Session): boolean {
  if (session.ephemeral || session.inboxAsk) return false;
  return (
    !!session.busy ||
    session.blocks.some((block) => block.role === "user" && !block.draft)
  );
}

export function sessionAgent(
  session: Session,
  options: AgentTreeOptions = {},
): Agent {
  const blocks = session.blocks;
  const last = lastUserIndex(blocks);
  const turn = last >= 0 ? blocks[last] : undefined;
  const requests = fleetRequests(session);
  const retired = Object.values(options.retries ?? {}).some(
    (link) => link.from === session.id,
  );
  const error = last >= 0 ? lastTurnError(blocks, last) : undefined;
  const status: AgentStatus = requests.length
    ? "needs_you"
    : session.busy
      ? "running"
      : retired || options.interruptedIds?.has(session.id)
        ? "stopped"
        : error
          ? "failed"
          : "done";
  let workedMs = 0;
  let costUsd: number | undefined;
  let tokens = 0;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.role !== "user" || block.draft) continue;
    const begun = block.startedAt ?? block.sentAt;
    if (begun && startedAt === undefined) startedAt = begun;
    const active = session.busy && index === last;
    if (!active && block.durationMs) {
      workedMs += block.durationMs;
      if (begun) endedAt = begun + block.durationMs;
    }
    const metrics = block.turnMetrics;
    if (metrics?.costUsd != null) costUsd = (costUsd ?? 0) + metrics.costUsd;
    tokens +=
      (metrics?.inputTokens ?? 0) +
      (metrics?.outputTokens ?? 0) +
      (metrics?.cacheReadTokens ?? 0) +
      (metrics?.cacheWriteTokens ?? 0);
  }
  const irgat = options.irgatName?.(session.id);
  const prompt = turn ? firstLine(turn.text) : "";
  const task =
    status === "running"
      ? prompt || fleetActivity(session)
      : status === "needs_you"
        ? requests[0].kind === "approval"
          ? `Waiting for approval: ${requests[0].label}`
          : "Waiting for your answer"
        : prompt || "No task yet";
  const activeSince =
    session.busy && turn ? (turn.startedAt ?? turn.sentAt) : undefined;
  return {
    id: session.id,
    name: irgat ?? sessionDisplayTitle(session.title, session.harness),
    role: irgat ? "irgat" : session.orchestrationLeadId ? "worker" : "session",
    harness: session.harness,
    model: modelName(session.harness, session.model, turn),
    task,
    toolIcon:
      status === "needs_you" && requests[0].kind === "approval"
        ? "key"
        : sessionToolIcon(session, last),
    status,
    ...(costUsd != null ? { costUsd } : {}),
    ...(tokens ? { tokens } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(status !== "running" && endedAt ? { endedAt } : {}),
    workedMs,
    ...(activeSince ? { activeSince } : {}),
    ...(status === "failed" && error ? { error } : {}),
    sessionId: session.id,
    ...(prompt && turn ? { retryPrompt: turn.text.trim() } : {}),
    ...(options.retries?.[session.id]
      ? { retryOf: options.retries[session.id].from }
      : {}),
    ...(status === "running" ? { activity: fleetActivity(session) } : {}),
  };
}

const FAILED_TOOL = new Set(["failed", "error"]);
const STOPPED_TOOL = new Set(["cancelled", "canceled", "interrupted"]);
const DONE_TOOL = new Set(["completed", "success", "done"]);

/** Subagents (Agent/Task tool runs) the session's latest turn started. */
export function subagentsOf(
  session: Session,
  options: AgentTreeOptions = {},
): Agent[] {
  const blocks = session.blocks;
  const last = lastUserIndex(blocks);
  if (last < 0) return [];
  const turn = blocks[last];
  const turnStart = turn.startedAt ?? turn.sentAt;
  const agents: Agent[] = [];
  for (let index = last + 1; index < blocks.length; index++) {
    const block = blocks[index];
    const run = block.agentRun;
    if (!run || !block.tool) continue;
    const id = `${session.id}:agent:${block.tool.callId ?? block.id}`;
    const toolStatus = (block.tool.status ?? "").toLowerCase();
    const retired = Object.values(options.retries ?? {}).some(
      (link) => link.from === id,
    );
    const status: AgentStatus = retired
      ? "stopped"
      : FAILED_TOOL.has(toolStatus)
        ? "failed"
        : STOPPED_TOOL.has(toolStatus)
          ? "stopped"
          : DONE_TOOL.has(toolStatus)
            ? "done"
            : session.busy
              ? "running"
              : "stopped";
    const step = [...run.steps].reverse().find((entry) => entry.kind === "tool");
    // The tool's own output carries the failure; a step is only a fallback.
    const report = [...run.steps].reverse().find((entry) => entry.kind === "message");
    const failure =
      block.tool.preview?.output?.trim() || block.text.trim() || report?.text || "";
    const task = firstLine(
      (status === "running" && step?.text) ||
        block.tool.detail ||
        block.tool.title ||
        run.name,
    );
    agents.push({
      id,
      parentId: session.id,
      name: run.name || run.agentType || "Subagent",
      role: "subagent",
      harness: session.harness,
      model: run.model ?? modelName(session.harness, session.model, turn),
      task: task || run.name,
      toolIcon: step ? toolIconFor(step.toolKind, step.text) : "chat",
      status,
      ...(turnStart ? { startedAt: turnStart } : {}),
      ...(status === "running" && turnStart ? { activeSince: turnStart } : {}),
      ...(status === "failed"
        ? { error: failure.slice(0, 2000) || "The subagent failed." }
        : {}),
      sessionId: session.id,
      retryPrompt: (block.tool.detail || task || run.name).trim(),
    });
  }
  return agents;
}

/**
 * Who started each session: an orchestration lead, the session whose turn
 * launched it (`irgatSpawnedSessions`, or the `app-<caller>-<request>` id that
 * `sessions.start` gives it), or what a Retry stood in for.
 */
export function sessionParents(
  sessions: readonly Session[],
  retries: AgentRetryLinks = {},
): Map<string, string> {
  const ids = new Set(sessions.map((session) => session.id));
  const parents = new Map<string, string>();
  for (const session of sessions) {
    for (const block of session.blocks) {
      for (const spawned of block.irgatSpawnedSessions ?? []) {
        if (spawned.sessionId !== session.id)
          parents.set(spawned.sessionId, session.id);
      }
    }
  }
  for (const session of sessions) {
    if (session.orchestrationLeadId && ids.has(session.orchestrationLeadId)) {
      parents.set(session.id, session.orchestrationLeadId);
      continue;
    }
    if (parents.has(session.id) || !session.id.startsWith("app-")) continue;
    // The caller id may itself contain dashes: take the longest known one.
    const rest = session.id.slice(4);
    for (let cut = rest.lastIndexOf("-"); cut > 0; cut = rest.lastIndexOf("-", cut - 1)) {
      const caller = rest.slice(0, cut);
      if (ids.has(caller) && caller !== session.id) {
        parents.set(session.id, caller);
        break;
      }
    }
  }
  for (const [id, link] of Object.entries(retries)) {
    if (!ids.has(id)) continue;
    const parent = link.parentId ?? parents.get(link.from);
    if (parent && parent !== id) parents.set(id, parent);
  }
  // A cycle would hide its members; cut it where it closes.
  for (const id of [...parents.keys()]) {
    const seen = new Set([id]);
    let at = parents.get(id);
    while (at) {
      if (seen.has(at)) {
        parents.delete(id);
        break;
      }
      seen.add(at);
      at = parents.get(at);
    }
  }
  return parents;
}

function lastActivity(session: Session): number {
  let at = 0;
  for (const block of session.blocks) {
    const begun = block.startedAt ?? block.sentAt ?? block.irgatHabit?.at ?? 0;
    at = Math.max(at, begun + (block.durationMs ?? 0));
  }
  return at;
}

/** Every agent to draw, parents before children, under the app's root. */
export function buildAgents(
  sessions: readonly Session[],
  options: AgentTreeOptions = {},
): Agent[] {
  const unique = new Map<string, Session>();
  for (const session of sessions) {
    if (!unique.has(session.id) && listed(session))
      unique.set(session.id, session);
  }
  const all = [...unique.values()];
  const parents = sessionParents(all, options.retries);
  const agents = new Map<string, Agent>();
  for (const session of all) agents.set(session.id, sessionAgent(session, options));
  const keep = new Set<string>();
  const since = options.since ?? 0;
  for (const session of all) {
    const agent = agents.get(session.id)!;
    const live =
      agent.status === "running" ||
      agent.status === "needs_you" ||
      lastActivity(session) >= since;
    if (!live) continue;
    // Keep the chain that started it, so the card hangs where it belongs.
    for (let at: string | undefined = session.id; at && !keep.has(at); at = parents.get(at))
      keep.add(at);
  }
  const result: Agent[] = [];
  for (const session of all) {
    if (!keep.has(session.id)) continue;
    const agent = agents.get(session.id)!;
    const parentId = parents.get(session.id);
    result.push({
      ...agent,
      parentId: parentId && keep.has(parentId) ? parentId : AGENT_TREE_ROOT_ID,
    });
    for (const sub of subagentsOf(session, options)) result.push(sub);
  }
  return result;
}

/** Worst state below wins: a card that needs you outranks one that failed. */
const STATUS_RANK: AgentStatus[] = [
  "needs_you",
  "failed",
  "running",
  "done",
  "stopped",
];

export function rootAgent(agents: readonly Agent[]): Agent {
  const top = agents.filter((agent) => agent.parentId === AGENT_TREE_ROOT_ID);
  const status =
    STATUS_RANK.find((rank) => agents.some((agent) => agent.status === rank)) ??
    "done";
  const summary = agentSummary(agents);
  return {
    id: AGENT_TREE_ROOT_ID,
    name: "Irgatos",
    role: "root",
    model: "Orchestrator",
    task:
      top.length === 0
        ? "No agents yet"
        : `${top.length} ${top.length === 1 ? "agent" : "agents"} started from here`,
    toolIcon: "chat",
    status: status === "stopped" ? "done" : status,
    ...(summary.costUsd != null ? { costUsd: summary.costUsd } : {}),
  };
}

/** Nest agents under their parents; unknown parents fall back to the root. */
export function buildAgentTree(agents: readonly Agent[]): AgentTreeNode {
  const root: AgentTreeNode = { ...rootAgent(agents), children: [] };
  const nodes = new Map<string, AgentTreeNode>([[root.id, root]]);
  for (const agent of agents) nodes.set(agent.id, { ...agent, children: [] });
  for (const agent of agents) {
    const node = nodes.get(agent.id)!;
    (nodes.get(agent.parentId ?? root.id) ?? root).children.push(node);
  }
  // What needs a look leads the top row; below a card, launch order.
  root.children.sort(
    (a, b) =>
      STATUS_RANK.indexOf(a.status) - STATUS_RANK.indexOf(b.status) ||
      (b.startedAt ?? 0) - (a.startedAt ?? 0),
  );
  const chronological = (node: AgentTreeNode) => {
    if (node !== root)
      node.children.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    node.children = besideOriginals(node.children);
    node.children.forEach(chronological);
  };
  chronological(root);
  return root;
}

/** Each retry follows the run it replaced, however later it started. */
function besideOriginals(nodes: AgentTreeNode[]): AgentTreeNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const retries = new Map<string, AgentTreeNode[]>();
  for (const node of nodes) {
    if (!node.retryOf || !ids.has(node.retryOf)) continue;
    const list = retries.get(node.retryOf) ?? [];
    list.push(node);
    retries.set(node.retryOf, list);
  }
  if (!retries.size) return nodes;
  const placed = new Set<string>();
  const out: AgentTreeNode[] = [];
  const place = (node: AgentTreeNode) => {
    if (placed.has(node.id)) return;
    placed.add(node.id);
    out.push(node);
    for (const retry of retries.get(node.id) ?? []) place(retry);
  };
  for (const node of nodes) {
    if (node.retryOf && ids.has(node.retryOf)) continue;
    place(node);
  }
  for (const node of nodes) place(node);
  return out;
}

export type AgentSummary = {
  total: number;
  running: number;
  failed: number;
  needsYou: number;
  costUsd?: number;
};

export function agentSummary(agents: readonly Agent[]): AgentSummary {
  const summary: AgentSummary = { total: 0, running: 0, failed: 0, needsYou: 0 };
  for (const agent of agents) {
    if (agent.role === "root") continue;
    summary.total += 1;
    if (agent.status === "running") summary.running += 1;
    if (agent.status === "failed") summary.failed += 1;
    if (agent.status === "needs_you") summary.needsYou += 1;
    if (agent.costUsd != null)
      summary.costUsd = (summary.costUsd ?? 0) + agent.costUsd;
  }
  return summary;
}

/** Work time so far, or undefined when nothing was timed. */
export function agentDurationMs(agent: Agent, now: number): number | undefined {
  const live = agent.activeSince ? Math.max(0, now - agent.activeSince) : 0;
  if (agent.workedMs === undefined && !agent.activeSince) return undefined;
  const total = (agent.workedMs ?? 0) + live;
  return total > 0 ? total : undefined;
}

export function formatAgentDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minRest = minutes % 60;
  return minRest ? `${hours}h ${minRest}m` : `${hours}h`;
}

export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tok`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k tok`;
  return `${(tokens / 1_000_000).toFixed(1)}M tok`;
}
