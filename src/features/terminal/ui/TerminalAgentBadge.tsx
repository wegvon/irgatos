import { useTerminalAgent } from "../hooks/useTerminalAgents";
import {
  TERMINAL_AGENT_STATE_LABEL,
  type TerminalAgentState,
} from "../model/agentDetection/tracker";
import type { TerminalAgentEntry } from "../model/agentDetection/terminalAgentStore";

export const TERMINAL_AGENT_TONE: Record<TerminalAgentState, string> = {
  working: "bg-accent/15 text-accent",
  blocked: "bg-amber-500/15 text-amber-500",
  done: "bg-emerald-500/15 text-emerald-400",
  idle: "bg-content/8 text-content/55",
};

const DOT_TONE: Record<TerminalAgentState, string> = {
  working: "bg-accent animate-pulse",
  blocked: "bg-amber-500",
  done: "bg-emerald-400",
  idle: "bg-content/35",
};

export function terminalAgentTitle(entry: Pick<TerminalAgentEntry, "agentLabel" | "state">): string {
  return `${entry.agentLabel} — ${TERMINAL_AGENT_STATE_LABEL[entry.state]}`;
}

/** State pill for an agent seen in a terminal; idle agents show only a dot. */
export function TerminalAgentPill({
  entry,
  compact = false,
}: {
  entry: Pick<TerminalAgentEntry, "agentLabel" | "state">;
  compact?: boolean;
}) {
  const title = terminalAgentTitle(entry);
  if (compact || entry.state === "idle") {
    return (
      <span
        data-terminal-agent-state={entry.state}
        role="status"
        aria-label={title}
        title={title}
        className={`size-1.5 shrink-0 rounded-full ${DOT_TONE[entry.state]}`}
      />
    );
  }
  return (
    <span
      data-terminal-agent-state={entry.state}
      role="status"
      aria-label={title}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] leading-4 font-medium ${TERMINAL_AGENT_TONE[entry.state]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT_TONE[entry.state]}`} aria-hidden />
      {TERMINAL_AGENT_STATE_LABEL[entry.state]}
    </span>
  );
}

/** The live agent badge for a terminal tab. */
export function TerminalAgentBadge({ terminalId }: { terminalId: string }) {
  const entry = useTerminalAgent(terminalId);
  if (!entry) return null;
  return <TerminalAgentPill entry={entry} />;
}
