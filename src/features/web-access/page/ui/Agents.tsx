import { useState, type ReactNode } from "react";
import type { AgentStatus } from "../../../agent-tree/model/agentTree";
import type { AgentTreeWindow } from "../../../agent-tree/model/agentTreeStore";
import type {
  WebAgent,
  WebAgents,
  WebOutsideSession,
} from "../../model/protocol";
import { read, usePoll } from "../client";
import { ago, basename, duration } from "../format";
import { navigate } from "../route";
import {
  Empty,
  Group,
  Harness,
  Pill,
  SectionTitle,
  Spinner,
  TONE,
  type Tone,
} from "./parts";
import {
  Check,
  ChevronRight,
  CircleX,
  FolderTree,
  LoaderCircle,
  Terminal,
} from "../../../../shared/ui/icons";

const STATUS_LABEL: Record<AgentStatus, string> = {
  running: "Running",
  done: "Done",
  needs_you: "Needs you",
  failed: "Failed",
  stopped: "Stopped",
};

const STATUS_TONE: Record<AgentStatus, Tone> = {
  running: "muted",
  done: "emerald",
  needs_you: "amber",
  failed: "rose",
  stopped: "muted",
};

const WINDOWS: { id: AgentTreeWindow; label: string }[] = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "all", label: "All" },
];

function cost(usd: number): string {
  return usd > 0 && usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

function tokens(count: number): string {
  if (count < 1000) return `${count} tok`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k tok`;
  return `${(count / 1_000_000).toFixed(1)}M tok`;
}

function StatusIcon({ status }: { status: AgentStatus }) {
  if (status === "running")
    return (
      <LoaderCircle
        aria-hidden
        className="size-4 shrink-0 animate-spin text-(--ink-3)"
      />
    );
  if (status === "done")
    return <Check aria-hidden className="size-4 shrink-0 text-(--ok)" />;
  if (status === "failed")
    return <CircleX aria-hidden className="size-4 shrink-0 text-(--bad)" />;
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <span
        aria-hidden
        className={`${TONE[STATUS_TONE[status]]} tone-dot size-2 rounded-full ${status === "stopped" ? "opacity-50" : ""}`}
      />
    </span>
  );
}

/**
 * Who started whom, as the desktop's Agent Tree draws it: each card under
 * the one that started it. A tap opens its chat.
 */
export function AgentList({
  agents,
  onOpen = (id) => navigate({ name: "chat", id }),
}: {
  agents: WebAgent[];
  onOpen?: (sessionId: string) => void;
}) {
  return (
    <Group>
      {agents.map((agent) => {
        const note =
          agent.status === "failed"
            ? agent.error
            : agent.status === "running"
              ? agent.activity
              : undefined;
        const spend =
          agent.costUsd != null
            ? cost(agent.costUsd)
            : agent.tokens
              ? tokens(agent.tokens)
              : "";
        const meta = [
          agent.durationMs ? duration(agent.durationMs) : "",
          spend,
        ].filter(Boolean);
        return (
          <button
            key={agent.id}
            disabled={!agent.sessionId}
            onClick={() => agent.sessionId && onOpen(agent.sessionId)}
            className="web-press flex w-full items-start gap-3 py-3 pr-3 text-left disabled:cursor-default"
            style={{ paddingLeft: 14 + Math.min(agent.depth, 6) * 16 }}
          >
            <span className="relative mt-0.5 flex">
              {agent.depth > 0 ? (
                <span
                  aria-hidden
                  className="absolute -left-[11px] top-[7px] h-px w-2 bg-(--ink-3)/60"
                />
              ) : null}
              <StatusIcon status={agent.status} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                {agent.harness ? (
                  <Harness harness={agent.harness} className="size-3.5" />
                ) : null}
                <span className="min-w-0 truncate text-[15px] font-semibold text-(--ink)">
                  {agent.name}
                </span>
                {agent.role === "subagent" ? (
                  <span className="shrink-0 rounded-full bg-content/6 px-1.5 text-[11px] font-medium text-(--ink-2)">
                    subagent
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-(--ink-2)">
                {[agent.model, agent.task].filter(Boolean).join(" · ")}
              </span>
              {note ? (
                <span
                  className={`mt-0.5 block truncate text-[13px] ${
                    agent.status === "failed"
                      ? "text-(--bad)"
                      : "web-shimmer font-medium"
                  }`}
                >
                  {note}
                </span>
              ) : agent.status === "needs_you" ? (
                <span className="mt-0.5 block text-[13px] font-medium text-(--tone-amber)">
                  {STATUS_LABEL.needs_you}
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 text-[12px] tabular-nums text-(--ink-3)">
              {meta.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </span>
            {agent.sessionId ? (
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-(--ink-3)" />
            ) : null}
          </button>
        );
      })}
    </Group>
  );
}

function outsideTone(status: string): { tone: Tone; label: string } {
  if (status === "busy") return { tone: "muted", label: "Working" };
  if (status === "waiting") return { tone: "amber", label: "Waiting" };
  return { tone: "muted", label: "Idle" };
}

function OutsideList({
  sessions,
  now,
}: {
  sessions: WebOutsideSession[];
  now: number;
}) {
  return (
    <Group>
      {sessions.map((session) => {
        const { tone, label } = outsideTone(session.status);
        return (
          <div key={session.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-content/6 text-(--ink-2)">
              <Harness harness="claude" className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-(--ink)">
                {session.name}
              </span>
              <span className="block truncate text-[13px] text-(--ink-2)">
                {basename(session.folder) || session.folder}
                {session.startedAt
                  ? ` · started ${ago(session.startedAt, now)} ago`
                  : ""}
              </span>
            </span>
            <Pill tone={tone} live={session.status === "busy"}>
              {label}
            </Pill>
          </div>
        );
      })}
    </Group>
  );
}

/**
 * Fleet's Agents view on the phone: the Agent Tree of everything Irgatos
 * started, and the Claude Code sessions running on the Mac outside it.
 */
export function Agents({
  header,
  wide,
  now,
}: {
  header: ReactNode;
  wide: boolean;
  now: number;
}) {
  const [range, setRange] = useState<AgentTreeWindow | null>(null);
  const { data } = usePoll(
    `agents:${range ?? ""}`,
    () => read<WebAgents>("agents", range ? { window: range } : {}),
    (current) => (current?.summary.running ? 3000 : 8000),
  );
  const shown = range ?? data?.window ?? "24h";
  // The app's own card is the screen; what it started is listed.
  const agents = data?.agents.slice(1).map((agent) => ({
    ...agent,
    depth: agent.depth - 1,
  }));
  const summary = data?.summary;

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 ${wide ? "max-w-[820px] px-8 pb-12 pt-[calc(var(--safe-top)+22px)]" : "px-4 pb-8 pt-[calc(var(--safe-top)+10px)]"}`}
    >
      <header className="flex flex-col gap-4">
        <div className="flex h-10 items-center justify-between gap-3">
          {header}
        </div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-(--ink)">
          Agents
        </h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {WINDOWS.map((option) => (
            <button
              key={option.id}
              aria-pressed={shown === option.id}
              onClick={() => setRange(option.id)}
              className={`web-press h-8 rounded-full px-3 text-[14px] font-medium ${
                shown === option.id
                  ? "bg-(--ink) text-(--color-background-base)"
                  : "bg-content/6 text-(--ink-2)"
              }`}
            >
              {option.label}
            </button>
          ))}
          {summary?.total ? (
            <span className="ml-auto text-[13px] tabular-nums text-(--ink-2)">
              {[
                summary.running ? `${summary.running} running` : "",
                summary.needsYou ? `${summary.needsYou} need you` : "",
                summary.failed ? `${summary.failed} failed` : "",
                summary.costUsd != null ? cost(summary.costUsd) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </div>
      </header>

      {!data ? (
        <div className="flex justify-center py-20 text-(--ink-3)">
          <Spinner className="size-6" />
        </div>
      ) : (
        <>
          <section>
            {agents?.length ? (
              <AgentList agents={agents} />
            ) : (
              <div className="glass rounded-[28px]">
                <Empty
                  icon={
                    <span className="flex size-16 items-center justify-center rounded-2xl bg-content/6 text-(--ink-3)">
                      <FolderTree className="size-8" />
                    </span>
                  }
                  title="No agents in this window"
                >
                  Sessions and the agents they start show up here, each under
                  the one that started it.
                </Empty>
              </div>
            )}
          </section>
          {data.outside.length ? (
            <section>
              <SectionTitle count={data.outside.length}>
                <Terminal className="size-[18px] text-(--ink-3)" />
                Outside Irgatos
              </SectionTitle>
              <OutsideList sessions={data.outside} now={now} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
