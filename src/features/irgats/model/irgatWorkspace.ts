import { newSession, type Session } from "../../sessions/model/session";
import {
  closeLeaf,
  leafIds,
  newTab,
  type WorkspaceTab,
} from "../../workspace/model/layout";
import { workspaceTabCwd } from "../../workspace/model/workspaceTabGroups";
import { sameProjectPath } from "../../projects/model/recents";
import {
  findIrgat,
  isIrgatSession,
  irgatForSession,
  saveIrgatSessionId,
} from "./irgat";
import { forgetAgentContext } from "./irgatFiles";
import { forgetIrgatRotation } from "./irgatRotation";

const openingIrgats = new Map<string, Promise<Session | undefined>>();

/**
 * Load the Irgat's conversation without opening or replacing a workspace tab.
 * A new one starts with Auto permissions in the home folder: no single
 * project is its own.
 */
export function ensureIrgatSession(
  irgatId: string,
  host: {
    home(): Promise<string>;
    load(id: string): Promise<Session | null | undefined>;
    create(cwd: string): Session;
    add(session: Session): void;
  },
): Promise<Session | undefined> {
  const pending = openingIrgats.get(irgatId);
  if (pending) return pending;
  const opening = loadIrgatSession(irgatId, host).finally(() => {
    if (openingIrgats.get(irgatId) === opening) openingIrgats.delete(irgatId);
  });
  openingIrgats.set(irgatId, opening);
  return opening;
}

async function loadIrgatSession(
  irgatId: string,
  host: Parameters<typeof ensureIrgatSession>[1],
): Promise<Session | undefined> {
  const irgat = findIrgat(irgatId);
  if (!irgat) return undefined;
  if (irgat.sessionId) {
    const existing = await host.load(irgat.sessionId);
    if (existing) return existing;
  }
  const home = await host.home();
  // Removed while the home folder was looked up.
  if (!findIrgat(irgatId)) return undefined;
  const session: Session = { ...host.create(home), runtimeMode: "auto" };
  saveIrgatSessionId(irgatId, session.id);
  host.add(session);
  return session;
}

/** Reset only the Irgat's chat, keeping its identity, habits and memory. */
export async function resetIrgatSession(
  current: Session,
  host: {
    stop(id: string): Promise<Session | undefined>;
    remove(session: Session): Promise<void>;
    replace(session: Session): void;
  },
): Promise<Session> {
  const irgatId = irgatForSession(current.id)?.id;
  const stopped = (await host.stop(current.id)) ?? current;
  const fresh = newSession(
    stopped.harness,
    stopped.cwd,
    stopped.model,
    stopped.runtimeMode,
    stopped.modelSettings,
  );
  // A failed deletion must leave the original conversation selected.
  await host.remove(stopped);
  forgetAgentContext(current.id);
  forgetIrgatRotation(current.id);
  if (irgatId) saveIrgatSessionId(irgatId, fresh.id);
  host.replace(fresh);
  return fresh;
}

/** Migrate the earlier agent tabs into a separate view, keeping ordinary panes. */
export function detachIrgatTabs(
  tabs: WorkspaceTab[],
  sessions: Session[],
  activeTabId: string,
  fallbackCwd: string,
  createSession: (cwd: string) => Session,
) {
  let changed = false;
  const removedProjects = new Set<string>();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const agentViewId =
    activeTab && isIrgatSession(activeTab.focusedId)
      ? activeTab.focusedId
      : undefined;
  const regularTabs: WorkspaceTab[] = [];
  for (const tab of tabs) {
    const agentIds = leafIds(tab.layout).filter(isIrgatSession);
    if (agentIds.length === 0) {
      regularTabs.push(tab);
      continue;
    }
    changed = true;
    const cwd = workspaceTabCwd(tab, sessions) ?? fallbackCwd;
    let remaining: WorkspaceTab | null = tab;
    for (const id of agentIds) {
      if (remaining) remaining = closeLeaf(remaining, id);
    }
    if (remaining) regularTabs.push(remaining);
    else removedProjects.add(cwd);
  }
  if (!changed) return undefined;

  const addedSessions: Session[] = [];
  for (const cwd of removedProjects) {
    if (
      regularTabs.some((tab) => {
        const project = workspaceTabCwd(tab, sessions);
        return project && sameProjectPath(project, cwd);
      })
    )
      continue;
    const session = createSession(cwd);
    addedSessions.push(session);
    regularTabs.push(newTab(session.id));
  }
  const activeCwd = activeTab
    ? (workspaceTabCwd(activeTab, sessions) ?? fallbackCwd)
    : fallbackCwd;
  const allSessions = [...sessions, ...addedSessions];
  const nextActive =
    regularTabs.find((tab) => tab.id === activeTabId) ??
    regularTabs.find((tab) => {
      const cwd = workspaceTabCwd(tab, allSessions);
      return cwd && sameProjectPath(cwd, activeCwd);
    }) ??
    regularTabs[0];
  return {
    tabs: regularTabs,
    addedSessions,
    activeTabId: nextActive.id,
    agentViewId,
  };
}
