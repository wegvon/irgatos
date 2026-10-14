import { listIrgats } from "../../irgats/model/irgat";
import { listSessionsByProject, type SessionSummary } from "../../sessions/data/sessionStore";
import { sessionDisplayTitle } from "../../sessions/model/session";
import { KANBAN_BACKFILL_LIMIT, syncKanbanSessions, type KanbanSessionSync } from "./kanban";

/**
 * Saved sessions a board files when it opens, oldest first so the newest end
 * up on top. Sessions in `skip` are loaded and report their own live state.
 */
export function backfillEntries(
  rows: readonly SessionSummary[],
  skip: ReadonlySet<string>,
  limit = KANBAN_BACKFILL_LIMIT,
): KanbanSessionSync[] {
  return rows
    .filter(
      (row) => !row.archived && !row.sidebarHidden && !row.orchestrationLeadId && !skip.has(row.id),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .slice(0, limit)
    .reverse()
    .map((row) => ({
      sessionId: row.id,
      title: sessionDisplayTitle(row.title, row.harness),
      backfill: true,
    }));
}

/** Gives every recent saved session of `project` a card unless it was dismissed. */
export async function backfillKanbanBoard(
  project: string,
  skip: ReadonlySet<string>,
): Promise<string[]> {
  const rows = await listSessionsByProject(project);
  const irgats = listIrgats().flatMap((irgat) => (irgat.sessionId ? [irgat.sessionId] : []));
  const entries = backfillEntries(rows, new Set([...skip, ...irgats]));
  return entries.length ? syncKanbanSessions(project, entries) : [];
}
