import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, Copy } from "../../../shared/ui/icons";
import {
  externalClaudeName,
  type ExternalClaudeSession,
} from "../../irgats/model/externalClaude";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import {
  FLEET_CARD,
  FLEET_CARD_CALM,
  FLEET_CARD_HEAD,
  FLEET_CARD_WAITING,
  FLEET_ICON_TILE,
} from "./cardStyles";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";

const REFRESH_MS = 10_000;

/** Claude Code sessions running outside Irgatos, refreshed while shown. */
export function useOutsideClaudeSessions(): ExternalClaudeSession[] {
  const [sessions, setSessions] = useState<ExternalClaudeSession[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      invoke<ExternalClaudeSession[]>("external_claude_sessions")
        .then((next) => {
          if (alive) setSessions(Array.isArray(next) ? next : []);
        })
        .catch(() => {
          if (alive) setSessions([]);
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return sessions;
}

export function filterOutsideClaudeSessions(
  sessions: readonly ExternalClaudeSession[],
  query: string,
): ExternalClaudeSession[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...sessions];
  return sessions.filter((session) =>
    `${externalClaudeName(session)} ${session.cwd}`.toLowerCase().includes(wanted),
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Reopens the conversation in a terminal: `cd <folder> && claude --resume <id>`. */
export function resumeCommand(session: ExternalClaudeSession): string {
  return `cd ${shellQuote(session.cwd)} && claude --resume ${session.sessionId}`;
}

export function OutsideClaudeSessions({
  sessions,
  now,
  forceOpen = false,
  defaultCollapsed = false,
}: {
  sessions: readonly ExternalClaudeSession[];
  now: number;
  forceOpen?: boolean;
  /** Folded like Idle in the narrow sidebar Fleet. */
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [copied, setCopied] = useState<string | null>(null);
  if (!sessions.length) return null;
  const open = forceOpen || !collapsed;
  return (
    <section
      aria-label="Outside Irgatos"
      data-fleet-bucket="outside"
      className="flex flex-col gap-2"
    >
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={open}
        title="Claude Code sessions open in a terminal or editor on this Mac. Your Irgats can message them."
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-[12px] font-medium text-content/70 hover:text-content"
      >
        {open ? (
          <ChevronDown className="size-3 opacity-60" />
        ) : (
          <ChevronRight className="size-3 opacity-60" />
        )}
        <span>Outside Irgatos</span>
        <span className="tabular-nums text-content/40">{sessions.length}</span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-1.5">
          {sessions.map((session) => {
            const name = externalClaudeName(session);
            const busy = session.status === "busy";
            const waiting = session.status === "waiting";
            const since = session.statusUpdatedAt ?? session.startedAt;
            return (
              <li key={session.sessionId}>
                <article
                  data-fleet-outside={session.sessionId}
                  className={`${FLEET_CARD} ${waiting ? FLEET_CARD_WAITING : FLEET_CARD_CALM} ${FLEET_CARD_HEAD}`}
                >
                  <span className={FLEET_ICON_TILE}>
                    <HarnessIcon harness="claude" className="size-4 shrink-0" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="min-w-0 truncate text-[13px] font-medium leading-5 tracking-[-0.005em] text-content">
                      {name}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-[11px] leading-4 text-content/45">
                      <span className="truncate" title={session.cwd}>
                        {session.cwd}
                      </span>
                      {session.canMessage ? null : (
                        <span className="shrink-0 rounded bg-content/8 px-1 py-px text-[10px] text-content/55">
                          no messages
                        </span>
                      )}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-[11px] tabular-nums ${waiting ? "text-amber-400" : busy ? "text-accent" : "text-content/35"}`}
                  >
                    {waiting ? "Waiting for you" : busy ? "Working" : "Idle"}
                    {since ? ` · ${formatLiveElapsed(since, now)}` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label={`Copy the command that reopens ${name}`}
                    title={copied === session.sessionId ? "Copied" : "Copy resume command"}
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(resumeCommand(session))
                        .then(() => setCopied(session.sessionId))
                        .catch(() => undefined);
                    }}
                    className="grid size-6 shrink-0 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
