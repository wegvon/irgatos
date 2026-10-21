import { createContext, useContext } from "react";
import { formatInteger } from "../../shared/lib/numbers";
import { pathKey } from "../../shared/lib/paths";

/**
 * How many sessions under a sidebar row wait on the user (an approval or a
 * question) and how many finished with a reply the user has not opened yet.
 * Always session counts, never messages or lines.
 */
export type RailAlertCounts = { needsYou: number; unread: number };

export const NO_RAIL_ALERT: RailAlertCounts = { needsYou: 0, unread: 0 };

export function hasRailAlert(counts: RailAlertCounts | undefined): boolean {
  return !!counts && (counts.needsYou > 0 || counts.unread > 0);
}

export function addRailAlerts(
  a: RailAlertCounts,
  b: RailAlertCounts | undefined,
): RailAlertCounts {
  if (!b) return a;
  return { needsYou: a.needsYou + b.needsYou, unread: a.unread + b.unread };
}

/** "2 need you, 1 unread", for titles and screen readers; empty when calm. */
export function railAlertLabel(counts: RailAlertCounts | undefined): string {
  if (!counts) return "";
  const parts: string[] = [];
  if (counts.needsYou > 0)
    parts.push(
      `${formatInteger(counts.needsYou)} ${counts.needsYou === 1 ? "needs" : "need"} you`,
    );
  if (counts.unread > 0) parts.push(`${formatInteger(counts.unread)} unread`);
  return parts.join(", ");
}

function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/**
 * Amber pill for sessions waiting on the user, accent pill for unread ones.
 * The same look on Projects, Irgats and Chats rows and their headers.
 */
export function RailAlertBadge({
  counts,
  className = "",
}: {
  counts: RailAlertCounts | undefined;
  className?: string;
}) {
  if (!counts || !hasRailAlert(counts)) return null;
  return (
    <span
      aria-hidden
      data-rail-alert
      className={`flex shrink-0 items-center gap-1 ${className}`}
    >
      {counts.needsYou > 0 ? (
        <span
          data-rail-needs-you={counts.needsYou}
          className="grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-black tabular-nums"
        >
          {badgeText(counts.needsYou)}
        </span>
      ) : null}
      {counts.unread > 0 ? (
        <span
          data-rail-unread={counts.unread}
          className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-on-accent tabular-nums"
        >
          {badgeText(counts.unread)}
        </span>
      ) : null}
    </span>
  );
}

/** A thin bar on a row's left edge, so an alerted row stands out in a list. */
export function RailAlertEdge({
  counts,
}: {
  counts: RailAlertCounts | undefined;
}) {
  if (!counts || !hasRailAlert(counts)) return null;
  return (
    <span
      aria-hidden
      data-rail-alert-edge
      className={`pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full ${
        counts.needsYou > 0 ? "bg-amber-500" : "bg-accent"
      }`}
    />
  );
}

/** Session alerts for each project, keyed by `pathKey` of its path. */
export const ProjectAlertsContext = createContext<
  ReadonlyMap<string, RailAlertCounts>
>(new Map());

export function projectAlertFor(
  alerts: ReadonlyMap<string, RailAlertCounts>,
  path: string,
): RailAlertCounts | undefined {
  return alerts.get(pathKey(path));
}

export function useProjectAlert(path: string): RailAlertCounts | undefined {
  return projectAlertFor(useContext(ProjectAlertsContext), path);
}

/** Sums the alerts of several projects, e.g. a collapsed group or a section. */
export function useProjectsAlert(paths: readonly string[]): RailAlertCounts {
  const alerts = useContext(ProjectAlertsContext);
  return paths.reduce(
    (total, path) => addRailAlerts(total, projectAlertFor(alerts, path)),
    NO_RAIL_ALERT,
  );
}

/**
 * Counts sessions per project from the sessions in memory: waiting on the
 * user, or finished with a reply nobody opened. The open session is read.
 */
export function projectAlertsFromSessions<
  S extends { id: string; cwd?: string },
>(
  sessions: readonly S[],
  {
    needsYou,
    unread,
    activeSessionId,
    excluded,
  }: {
    needsYou: (session: S) => boolean;
    unread: ReadonlySet<string>;
    activeSessionId?: string;
    excluded?: ReadonlySet<string>;
  },
): Map<string, RailAlertCounts> {
  const out = new Map<string, RailAlertCounts>();
  for (const session of sessions) {
    if (!session.cwd || excluded?.has(session.id)) continue;
    const waiting = needsYou(session);
    const fresh =
      !waiting && session.id !== activeSessionId && unread.has(session.id);
    if (!waiting && !fresh) continue;
    const key = pathKey(session.cwd);
    const current = out.get(key) ?? NO_RAIL_ALERT;
    out.set(key, {
      needsYou: current.needsYou + (waiting ? 1 : 0),
      unread: current.unread + (fresh ? 1 : 0),
    });
  }
  return out;
}
