import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Globe,
  Key,
  LoaderCircle,
  MessageSquare,
  Sparkles,
  Square,
  Star,
  Terminal,
  File,
  X,
} from "../../../shared/ui/icons";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import type { Session } from "../../sessions/model/session";
import {
  AGENT_STATUS_LABEL,
  AGENT_TREE_ROOT_ID,
  agentDurationMs,
  agentSummary,
  buildAgentTree,
  buildAgents,
  buildIrgatTree,
  flattenTree,
  type LaunchRecord,
  formatAgentDuration,
  formatCost,
  formatTokens,
  type Agent,
  type AgentStatus,
  type AgentToolIcon,
  type AgentTreeNode,
} from "../model/agentTree";
import {
  AGENT_TREE_WINDOWS,
  AGENT_TREE_WINDOW_LABEL,
  loadAgentTreeState,
  saveAgentTreeState,
  windowSince,
  type AgentTreeState,
} from "../model/agentTreeStore";
import "./agentTree.css";

export type AgentRetryRequest = {
  /** Session whose project, harness and model the new run uses. */
  sourceSessionId: string;
  prompt: string;
  /** Id the new session must take, so the tree can place it at once. */
  newSessionId: string;
};

type Props = {
  sessions: readonly Session[];
  interruptedSessionIds?: ReadonlySet<string>;
  irgatName?: (sessionId: string) => string | undefined;
  onOpenSession: (sessionId: string) => void;
  /** Starts a real session; absent hides Retry. */
  onRetry?: (request: AgentRetryRequest) => Promise<void>;
  /** Only what one Irgat orchestrated, its chat at the top. */
  irgat?: { sessionId: string; name: string; launches: readonly LaunchRecord[] };
  /** Narrow stacks every row as a list, for a side panel. */
  layout?: "wide" | "narrow";
};

/** Ticks every second while something runs, so durations count up live. */
function useClock(live: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), live ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

export function AgentTreeView({
  sessions,
  interruptedSessionIds,
  irgatName,
  onOpenSession,
  onRetry,
  irgat,
  layout = irgat ? "narrow" : "wide",
}: Props) {
  const wide = layout === "wide";
  const [store, setStore] = useState<AgentTreeState>(loadAgentTreeState);
  const update = useCallback((next: (state: AgentTreeState) => AgentTreeState) => {
    setStore((current) => {
      const value = next(current);
      saveAgentTreeState(value);
      return value;
    });
  }, []);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const anyBusy = sessions.some((session) => session.busy);
  const now = useClock(anyBusy);
  // The window moves with the minute, not the second.
  const minute = Math.floor(now / 60_000);
  const tree = useMemo((): AgentTreeNode => {
    const options = {
      since: windowSince(store.window, minute * 60_000),
      interruptedIds: interruptedSessionIds,
      irgatName: irgat
        ? (id: string) => (id === irgat.sessionId ? irgat.name : irgatName?.(id))
        : irgatName,
      retries: store.retries,
    };
    if (!irgat) return buildAgentTree(buildAgents(sessions, options));
    return (
      buildIrgatTree(
        {
          irgatSessionId: irgat.sessionId,
          launches: irgat.launches,
          sessions,
        },
        options,
      ) ?? {
        id: irgat.sessionId,
        name: irgat.name,
        role: "irgat",
        model: "",
        task: "No sessions yet",
        toolIcon: "chat",
        status: "done",
        sessionId: irgat.sessionId,
        children: [],
      }
    );
  }, [interruptedSessionIds, irgat, irgatName, minute, sessions, store.retries, store.window]);
  // The top card is the app or the Irgat itself; the count is what it started.
  const summary = useMemo(() => agentSummary(flattenTree(tree).slice(1)), [tree]);
  const dismissed = useMemo(() => new Set(store.dismissed), [store.dismissed]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const retry = async (agent: Agent) => {
    if (!onRetry || !agent.sessionId || !agent.retryPrompt) return;
    const newSessionId = crypto.randomUUID();
    // A subagent's retry runs as a session of its own beside it.
    const parentId =
      agent.role === "subagent"
        ? agent.parentId
        : agent.parentId === AGENT_TREE_ROOT_ID
          ? undefined
          : agent.parentId;
    setRetrying((current) => new Set(current).add(agent.id));
    setRetryErrors(({ [agent.id]: _old, ...rest }) => rest);
    update((state) => ({
      ...state,
      retries: {
        ...state.retries,
        [newSessionId]: { from: agent.id, ...(parentId ? { parentId } : {}) },
      },
    }));
    try {
      await onRetry({
        sourceSessionId: agent.sessionId,
        prompt: agent.retryPrompt,
        newSessionId,
      });
    } catch (error) {
      update((state) => {
        const { [newSessionId]: _dropped, ...retries } = state.retries;
        return { ...state, retries };
      });
      setRetryErrors((current) => ({
        ...current,
        [agent.id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setRetrying((current) => {
        const next = new Set(current);
        next.delete(agent.id);
        return next;
      });
    }
  };

  const dismiss = (id: string) =>
    update((state) => ({
      ...state,
      dismissed: state.dismissed.includes(id)
        ? state.dismissed
        : [...state.dismissed, id],
    }));
  const reopen = (id: string) =>
    update((state) => ({
      ...state,
      dismissed: state.dismissed.filter((entry) => entry !== id),
    }));

  const canvas = useRef<HTMLDivElement>(null);
  const heads = useRef(new Map<string, HTMLElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<LinePath[]>([]);
  const drawn = useRef("");
  const measure = useCallback(() => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    const next = treeLines(tree, collapsed, box, cards.current, heads.current, wide);
    // Measured after every render; only a moved line re-renders.
    const key = next.map((line) => `${line.key}|${line.status}|${line.d}`).join("\n");
    if (key === drawn.current) return;
    drawn.current = key;
    setLines(next);
  }, [collapsed, tree, wide]);
  useLayoutEffect(measure);
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const register =
    (map: MutableRefObject<Map<string, HTMLElement>>, id: string) =>
    (element: HTMLElement | null) => {
      if (element) map.current.set(id, element);
      else map.current.delete(id);
    };

  const renderHead = (node: AgentTreeNode): ReactNode => {
    const failed = node.status === "failed" && node.role !== "root";
    const failedOpen = failed && !dismissed.has(node.id);
    return (
      <div ref={register(heads, node.id)} className="flex flex-col items-start">
        <AgentCard
          agent={node}
          now={now}
          childCount={node.children.length}
          collapsed={collapsed.has(node.id)}
          cardRef={register(cards, node.id)}
          onToggle={() => toggle(node.id)}
          onOpen={
            node.sessionId ? () => onOpenSession(node.sessionId!) : undefined
          }
          onShowError={
            failed && !failedOpen
              ? () => reopen(node.id)
              : undefined
          }
        />
        {failedOpen ? (
          <ErrorPopover
            agent={node}
            retrying={retrying.has(node.id)}
            retryError={retryErrors[node.id]}
            onDismiss={() => dismiss(node.id)}
            onRetry={
              onRetry && node.sessionId && node.retryPrompt
                ? () => void retry(node)
                : undefined
            }
          />
        ) : null}
      </div>
    );
  };

  const renderBranch = (node: AgentTreeNode): ReactNode => (
    <li key={node.id} className="flex flex-col items-start">
      {renderHead(node)}
      {node.children.length && !collapsed.has(node.id) ? (
        <ul className="flex flex-col gap-3 pl-8 pt-3">
          {node.children.map(renderBranch)}
        </ul>
      ) : null}
    </li>
  );

  return (
    <div
      className="agent-tree flex min-h-0 min-w-0 flex-1 flex-col"
      data-agent-tree
    >
      <div
        className={`flex shrink-0 flex-wrap items-center border-b border-[color:var(--at-line)] text-[13px] ${
          wide ? "min-h-11 gap-3 px-4 py-1.5" : "gap-2 px-3 py-2"
        }`}
      >
        {wide ? (
          <>
            <Star className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="font-semibold">Agents</span>
          </>
        ) : null}
        <select
          value={store.window}
          onChange={(event) =>
            update((state) => ({
              ...state,
              window: event.target.value as AgentTreeState["window"],
            }))
          }
          aria-label="Show agents from"
          className="h-7 rounded-md border border-[color:var(--at-line)] bg-transparent px-2 text-[12px] text-[color:var(--at-muted)] outline-none"
        >
          {AGENT_TREE_WINDOWS.map((window) => (
            <option key={window} value={window}>
              {AGENT_TREE_WINDOW_LABEL[window]}
            </option>
          ))}
        </select>
        <div
          className="ml-auto flex min-w-0 flex-wrap items-center gap-2 text-[12px] tabular-nums"
          data-agent-tree-summary
        >
          <span className="text-[color:var(--at-muted)]">
            {summary.total} {summary.total === 1 ? "agent" : "agents"}
          </span>
          {summary.running ? (
            <span className="text-[color:var(--at-running)]">
              {summary.running} running
            </span>
          ) : null}
          {summary.failed ? (
            <span className="rounded-full bg-[color:var(--at-failed)] px-2 py-0.5 font-medium text-white">
              {summary.failed} failed
            </span>
          ) : null}
          {summary.needsYou ? (
            <span className="rounded-full bg-[color:var(--at-needs)] px-2 py-0.5 font-medium text-white">
              {summary.needsYou} needs you
            </span>
          ) : null}
          <span
            className="font-semibold"
            title="Spend the providers reported; Claude reports it, others may not"
          >
            {summary.costUsd != null ? formatCost(summary.costUsd) : "$—"}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          ref={canvas}
          className={`relative flex w-max min-w-full flex-col ${
            wide ? "mx-auto items-center px-8 pb-16 pt-8" : "items-start px-3 pb-10 pt-3"
          }`}
        >
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          >
            {lines.map((line) => (
              <path
                key={line.key}
                d={line.d}
                className="agent-tree-line"
                data-status={line.status}
              />
            ))}
          </svg>
          {renderHead(tree)}
          {tree.children.length && !collapsed.has(tree.id) ? (
            <ul
              className={
                wide
                  ? "flex items-start gap-6 pt-10"
                  : "flex flex-col gap-3 pl-8 pt-3"
              }
            >
              {tree.children.map(renderBranch)}
            </ul>
          ) : null}
          {tree.children.length === 0 ? (
            <p
              className={`max-w-sm text-[13px] text-[color:var(--at-muted)] ${
                wide ? "mt-10 text-center" : "mt-4"
              }`}
            >
              {irgat
                ? `No sessions in this window. Sessions ${irgat.name} starts, and what they start in turn, appear here as a live tree.`
                : "No agents in this window. Sessions, the sessions they start and their subagents appear here as a live tree."}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const STATUS_ICON: Record<AgentStatus, (props: { className: string }) => ReactNode> = {
  running: ({ className }) => (
    <LoaderCircle className={`${className} animate-spin`} strokeWidth={2} />
  ),
  done: ({ className }) => <Check className={className} strokeWidth={2.25} />,
  needs_you: ({ className }) => (
    <CircleAlert className={className} strokeWidth={2} />
  ),
  failed: ({ className }) => <X className={className} strokeWidth={2.25} />,
  stopped: ({ className }) => <Square className={className} strokeWidth={2} />,
};

const TOOL_ICON: Record<AgentToolIcon, (props: { className: string }) => ReactNode> = {
  terminal: ({ className }) => <Terminal className={className} />,
  doc: ({ className }) => <File className={className} />,
  web: ({ className }) => <Globe className={className} />,
  key: ({ className }) => <Key className={className} />,
  chat: ({ className }) => <MessageSquare className={className} />,
};

function RoleIcon({ agent }: { agent: Agent }) {
  const box =
    "flex size-6 shrink-0 items-center justify-center rounded-md bg-[color:color-mix(in_srgb,var(--at-text)_8%,transparent)]";
  if (agent.role === "root")
    return (
      <span className={box}>
        <Sparkles className="size-4" />
      </span>
    );
  if (agent.role === "irgat")
    return (
      <span className={box}>
        <Bot className="size-4" />
      </span>
    );
  return (
    <span className={box}>
      {agent.harness ? (
        <HarnessIcon harness={agent.harness} className="size-4" />
      ) : (
        <Bot className="size-4" />
      )}
    </span>
  );
}

export function AgentCard({
  agent,
  now,
  childCount,
  collapsed,
  cardRef,
  onToggle,
  onOpen,
  onShowError,
}: {
  agent: Agent;
  now: number;
  childCount: number;
  collapsed: boolean;
  cardRef?: (element: HTMLElement | null) => void;
  onToggle: () => void;
  onOpen?: () => void;
  onShowError?: () => void;
}) {
  const duration = agentDurationMs(agent, now);
  const StatusIcon = STATUS_ICON[agent.status];
  const ToolIcon = TOOL_ICON[agent.toolIcon];
  const spend =
    agent.costUsd != null
      ? formatCost(agent.costUsd)
      : agent.tokens
        ? formatTokens(agent.tokens)
        : agent.role === "root"
          ? "$—"
          : null;
  return (
    <article
      ref={cardRef}
      data-status={agent.status}
      data-agent-id={agent.id}
      data-agent-role={agent.role}
      className={`agent-tree-card flex flex-col gap-2 text-left ${onOpen ? "cursor-pointer" : ""}`}
      onClick={onOpen}
      title={onOpen ? "Open session" : undefined}
    >
      <div className="flex items-start gap-2">
        <RoleIcon agent={agent} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold leading-5">
            {agent.name}
          </div>
          <div className="truncate text-[12px] leading-4 text-[color:var(--at-muted)]">
            {agent.model}
          </div>
        </div>
        <button
          type="button"
          className="agent-tree-badge flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          data-agent-status-badge
          onClick={(event) => {
            if (!onShowError) return;
            event.stopPropagation();
            onShowError();
          }}
          title={onShowError ? "Show error" : undefined}
          tabIndex={onShowError ? 0 : -1}
        >
          <StatusIcon className="size-3" />
          {AGENT_STATUS_LABEL[agent.status]}
        </button>
      </div>
      <div className="flex items-start gap-2 text-[13px] leading-[18px]">
        <ToolIcon className="mt-px size-3.5 shrink-0 text-[color:var(--at-muted)]" />
        <span
          className="line-clamp-2 min-w-0 break-words"
          title={agent.activity ? `Now: ${agent.activity}` : agent.task}
        >
          {agent.task}
        </span>
      </div>
      <div className="flex items-center text-[12px] tabular-nums">
        <span className="min-w-0 truncate">
          {spend ? <span className="font-semibold">{spend}</span> : null}
          {spend && duration !== undefined ? (
            <span className="text-[color:var(--at-faint)]"> · </span>
          ) : null}
          {duration !== undefined ? (
            <span className="text-[color:var(--at-muted)]" data-agent-duration>
              {formatAgentDuration(duration)}
            </span>
          ) : null}
        </span>
        {childCount > 0 ? (
          <button
            type="button"
            className="ml-auto flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12px] text-[color:var(--at-muted)] hover:bg-[color:color-mix(in_srgb,var(--at-text)_8%,transparent)] hover:text-[color:var(--at-text)]"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show sub-agents" : "Hide sub-agents"}
            data-agent-toggle
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {childCount}
            {collapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ErrorPopover({
  agent,
  retrying,
  retryError,
  onDismiss,
  onRetry,
}: {
  agent: Agent;
  retrying: boolean;
  retryError?: string;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={`${agent.name} failed`} className="agent-tree-popover" data-agent-error>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <X className="size-3.5 text-[color:var(--at-failed)]" strokeWidth={2.25} />
        <span className="truncate">{agent.name}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[12px] text-[color:var(--at-muted)]">
        {agent.task}
      </p>
      <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[color:color-mix(in_srgb,var(--at-failed)_10%,transparent)] px-2 py-1.5 font-mono text-[11.5px] leading-4 text-[color:var(--at-failed)]">
        {agent.error ?? "The agent failed."}
      </p>
      {retryError ? (
        <p className="mt-2 text-[12px] text-[color:var(--at-failed)]">
          Retry did not start: {retryError}
        </p>
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-[12px] text-[color:var(--at-muted)] hover:text-[color:var(--at-text)]"
        >
          Dismiss
        </button>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="agent-tree-solid rounded-md px-3 py-1 text-[12px] font-medium disabled:opacity-60"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export type LinePath = { key: string; d: string; status: AgentStatus | "root" };

const RADIUS = 8;
/** Where the trunk under a card runs, from its left edge. */
const TRUNK_INSET = 16;
/** Where an arm meets a card, from its top: the name row. */
const ARM_DROP = 22;

type Rect = { left: number; top: number; right: number; bottom: number; cx: number };

function rectOf(element: HTMLElement | undefined, box: DOMRect): Rect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const left = rect.left - box.left;
  const top = rect.top - box.top;
  return {
    left,
    top,
    right: left + rect.width,
    bottom: top + rect.height,
    cx: left + rect.width / 2,
  };
}

/**
 * Connectors as SVG paths. The first row hangs off a trunk under the root;
 * deeper rows branch from a trunk down the parent's left side. Each path takes
 * its child's colour; farther children are drawn first so a shared stretch
 * shows the colour of the nearest child it leads to.
 */
export function treeLines(
  root: AgentTreeNode,
  collapsed: ReadonlySet<string>,
  box: DOMRect,
  cards: ReadonlyMap<string, HTMLElement>,
  heads: ReadonlyMap<string, HTMLElement>,
  /** The first row fans out sideways; otherwise every row is a list. */
  wide = true,
): LinePath[] {
  const paths: LinePath[] = [];
  const rootHead = rectOf(heads.get(root.id), box);
  const rootCard = rectOf(cards.get(root.id), box);
  if (wide && rootHead && rootCard && root.children.length && !collapsed.has(root.id)) {
    const tops = root.children
      .map((child) => ({ child, rect: rectOf(cards.get(child.id), box) }))
      .filter((entry): entry is { child: AgentTreeNode; rect: Rect } => !!entry.rect);
    if (tops.length) {
      const x0 = rootCard.cx;
      const y0 = rootHead.bottom;
      const firstTop = Math.min(...tops.map((entry) => entry.rect.top));
      const ym = y0 + (firstTop - y0) / 2;
      paths.push({ key: "root-stem", d: `M ${x0} ${y0} V ${ym}`, status: "root" });
      const ordered = [...tops].sort(
        (a, b) => Math.abs(b.rect.cx - x0) - Math.abs(a.rect.cx - x0),
      );
      for (const { child, rect } of ordered) {
        const x1 = rect.cx;
        const dx = x1 - x0;
        let d: string;
        if (Math.abs(dx) < 1) d = `M ${x0} ${ym} V ${rect.top}`;
        else {
          const r = Math.min(RADIUS, Math.abs(dx), (rect.top - ym) / 2);
          const dir = Math.sign(dx);
          d = `M ${x0} ${ym} H ${x1 - dir * r} Q ${x1} ${ym} ${x1} ${ym + r} V ${rect.top}`;
        }
        paths.push({ key: `${root.id}>${child.id}`, d, status: child.status });
      }
    }
  }
  const walk = (node: AgentTreeNode) => {
    if (!node.children.length || collapsed.has(node.id)) return;
    if (node !== root || !wide) {
      const card = rectOf(cards.get(node.id), box);
      const head = rectOf(heads.get(node.id), box);
      if (card && head) {
        const x = card.left + TRUNK_INSET;
        const y0 = head.bottom;
        const children = node.children
          .map((child) => ({ child, rect: rectOf(cards.get(child.id), box) }))
          .filter((entry): entry is { child: AgentTreeNode; rect: Rect } => !!entry.rect)
          .reverse();
        for (const { child, rect } of children) {
          const ya = rect.top + ARM_DROP;
          const r = Math.min(RADIUS, (rect.left - x) / 2, (ya - y0) / 2);
          const d = `M ${x} ${y0} V ${ya - r} Q ${x} ${ya} ${x + r} ${ya} H ${rect.left}`;
          paths.push({ key: `${node.id}>${child.id}`, d, status: child.status });
        }
      }
    }
    node.children.forEach(walk);
  };
  walk(root);
  return paths;
}
