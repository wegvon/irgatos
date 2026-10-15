// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { leafIds, newTab, splitPane } from "../../workspace/model/layout";
import { planWorkspaceTabClose } from "../../workspace/model/workspaceTabGroups";
import {
  createIrgat,
  findIrgat,
  saveIrgatName,
  saveIrgatSessionId,
} from "./irgat";
import { planAgentContext, recordAgentContext } from "./irgatFiles";
import { loadIrgatRotation, saveIrgatRotation } from "./irgatRotation";
import {
  detachIrgatTabs,
  ensureIrgatSession,
  createIrgatChildSession,
  deleteIrgatChildSession,
  resetIrgatSession,
} from "./irgatWorkspace";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

const chat = (id: string, cwd = "/project") => ({
  ...newSession("codex", cwd),
  id,
});
const createSession = (cwd: string) => newSession("codex", cwd);

/** A Irgat that works on `cwd`, with `sessionId` as its chat. */
function irgatFor(cwd: string, sessionId: string): string {
  const irgat = createIrgat([cwd]);
  saveIrgatSessionId(irgat.id, sessionId);
  return irgat.id;
}
const sessionOf = (irgatId: string) => findIrgat(irgatId)?.sessionId;

it("deletes a child only after storage succeeds and preserves its Irgat and siblings", async () => {
  const parent = chat("parent");
  const irgatId = irgatFor(parent.cwd, parent.id);
  const child = createIrgatChildSession(irgatId, parent);
  const sibling = createIrgatChildSession(irgatId, parent);
  const before = findIrgat(irgatId)!;
  const remove = vi.fn(async () => {
    expect(findIrgat(irgatId)?.childSessionIds).toContain(child.id);
    return false;
  });
  expect(await deleteIrgatChildSession(irgatId, child.id, remove)).toBe(false);
  expect(findIrgat(irgatId)).toEqual(before);
  remove.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(
    deleteIrgatChildSession(irgatId, child.id, remove),
  ).rejects.toThrow("Storage unavailable");
  expect(findIrgat(irgatId)).toEqual(before);
  remove.mockResolvedValueOnce(true);
  expect(await deleteIrgatChildSession(irgatId, child.id, remove)).toBe(true);
  expect(findIrgat(irgatId)).toEqual({
    ...before,
    childSessionIds: [sibling.id],
  });
  remove.mockClear();
  for (const id of [parent.id, "unrelated", child.id])
    expect(await deleteIrgatChildSession(irgatId, id, remove)).toBe(false);
  expect(remove).not.toHaveBeenCalled();
});

it("names a new child after the numbers its siblings still use", async () => {
  const parent = chat("parent");
  const irgatId = irgatFor(parent.cwd, parent.id);
  const first = createIrgatChildSession(irgatId, parent);
  const second = createIrgatChildSession(irgatId, parent);
  expect([first.title, second.title]).toEqual(["Chat 1", "Chat 2"]);
  await deleteIrgatChildSession(irgatId, first.id, async () => true);
  const titles = new Map([[second.id, second.title]]);
  const third = createIrgatChildSession(irgatId, parent, (id) =>
    titles.get(id),
  );
  expect(third.title).toBe("Chat 3");
});

it("loads an existing resident conversation without creating a session", async () => {
  const agent = { ...chat("resident"), runtimeMode: "full-access" as const };
  const irgatId = irgatFor(agent.cwd, agent.id);
  const host = {
    home: vi.fn().mockResolvedValue("/home"),
    load: vi.fn().mockResolvedValue(agent),
    create: vi.fn(createSession),
    add: vi.fn(),
  };
  expect(await ensureIrgatSession(irgatId, host)).toBe(agent);
  expect(host.load).toHaveBeenCalledExactlyOnceWith(agent.id);
  expect(host.create).not.toHaveBeenCalled();
  expect(host.add).not.toHaveBeenCalled();
});

it("starts a new Irgat's conversation with Auto permissions in the home folder, once", async () => {
  const irgatId = createIrgat(["/project"]).id;
  const host = {
    home: vi.fn().mockResolvedValue("/home"),
    load: vi.fn(),
    create: vi.fn(createSession),
    add: vi.fn(),
  };
  const agent = (await ensureIrgatSession(irgatId, host))!;
  expect(agent.cwd).toBe("/home");
  expect(agent.runtimeMode).toBe("auto");
  expect(sessionOf(irgatId)).toBe(agent.id);
  expect(host.add).toHaveBeenCalledExactlyOnceWith(agent);
  host.load.mockResolvedValue(agent);
  expect(await ensureIrgatSession(irgatId, host)).toBe(agent);
  expect(host.create).toHaveBeenCalledOnce();
  expect(host.add).toHaveBeenCalledOnce();
});

it("opens nothing for a Irgat that no longer exists", async () => {
  const host = {
    home: vi.fn().mockResolvedValue("/home"),
    load: vi.fn(),
    create: vi.fn(createSession),
    add: vi.fn(),
  };
  expect(await ensureIrgatSession("gone", host)).toBeUndefined();
  expect(host.create).not.toHaveBeenCalled();
});

it("shares concurrent first opens of the same Irgat", async () => {
  const irgatId = createIrgat().id;
  let resolveHome!: (path: string) => void;
  const home = new Promise<string>((resolve) => {
    resolveHome = resolve;
  });
  const host = {
    home: vi.fn(() => home),
    load: vi.fn(),
    create: vi.fn(createSession),
    add: vi.fn(),
  };
  const first = ensureIrgatSession(irgatId, host);
  const second = ensureIrgatSession(irgatId, host);
  resolveHome("/home");
  const [one, two] = await Promise.all([first, second]);
  expect(one).toBe(two);
  expect(sessionOf(irgatId)).toBe(one!.id);
  expect(host.home).toHaveBeenCalledOnce();
  expect(host.create).toHaveBeenCalledOnce();
  expect(host.add).toHaveBeenCalledOnce();
});

it("allows retrying an open after the home lookup fails", async () => {
  const irgatId = createIrgat().id;
  const host = {
    home: vi
      .fn()
      .mockRejectedValueOnce(new Error("Not ready"))
      .mockResolvedValue("/home"),
    load: vi.fn(),
    create: vi.fn(createSession),
    add: vi.fn(),
  };
  await expect(ensureIrgatSession(irgatId, host)).rejects.toThrow("Not ready");
  expect((await ensureIrgatSession(irgatId, host))!.cwd).toBe("/home");
  expect(host.add).toHaveBeenCalledOnce();
});

it("deletes the Irgat's chat before replacing it with an empty provider session", async () => {
  const current = {
    ...chat("resident"),
    runtimeMode: "auto-accept-edits" as const,
    busy: true,
    providerSessionId: "old-provider",
    providerAccountId: "old-account",
    blocks: [
      { id: "message", role: "user" as const, text: "Old conversation" },
    ],
    queuedMessages: [
      { id: "queued", text: "Old queued message", attachments: [] },
    ],
    context: { used: 90_000 },
  };
  const irgatId = irgatFor(current.cwd, current.id);
  const otherId = irgatFor("/other", "other-irgat");
  saveIrgatName(irgatId, "Broski");
  const files = { soulHash: "soul", memoryHash: "memory" };
  recordAgentContext(current.id, current.providerSessionId, files);
  recordAgentContext("other-irgat", "other-provider", files);
  const rotation = {
    at: 1,
    reason: "context" as const,
    earlier: ["Old conversation"],
  };
  saveIrgatRotation(current.id, rotation);
  saveIrgatRotation("other-irgat", rotation);

  const stopped = { ...current, busy: false };
  const stop = vi.fn(async () => stopped);
  const remove = vi.fn(async () => {
    expect(stop).toHaveBeenCalledExactlyOnceWith(current.id);
    expect(sessionOf(irgatId)).toBe(current.id);
  });
  const replace = vi.fn();
  const fresh = await resetIrgatSession(current, { stop, remove, replace });

  expect(remove).toHaveBeenCalledExactlyOnceWith(stopped);
  expect(replace).toHaveBeenCalledExactlyOnceWith(fresh);
  expect(fresh.id).not.toBe(current.id);
  expect(fresh.blocks).toEqual([]);
  expect(fresh.providerSessionId).toBeUndefined();
  expect(fresh.providerAccountId).toBeUndefined();
  expect(fresh.queuedMessages).toBeUndefined();
  expect(fresh.context).toBeUndefined();
  expect(fresh).toMatchObject({
    cwd: current.cwd,
    harness: current.harness,
    model: current.model,
    modelSettings: current.modelSettings,
    runtimeMode: current.runtimeMode,
  });
  expect(sessionOf(irgatId)).toBe(fresh.id);
  expect(findIrgat(irgatId)?.name).toBe("Broski");
  expect(loadIrgatRotation(current.id)).toBeUndefined();
  expect(
    planAgentContext(current.id, current.providerSessionId, files),
  ).toEqual({ soul: true, memory: true });
  expect(sessionOf(otherId)).toBe("other-irgat");
  expect(loadIrgatRotation("other-irgat")).toEqual(rotation);
  expect(planAgentContext("other-irgat", "other-provider", files)).toEqual({
    soul: false,
    memory: false,
  });
});

it("keeps the original chat and context if deletion fails", async () => {
  const current = chat("resident");
  const irgatId = irgatFor(current.cwd, current.id);
  const rotation = {
    at: 1,
    reason: "idle" as const,
    earlier: ["Keep this conversation"],
  };
  saveIrgatRotation(current.id, rotation);
  const stop = vi.fn(async () => current);
  const remove = vi.fn().mockRejectedValue(new Error("Storage unavailable"));
  const replace = vi.fn();
  await expect(
    resetIrgatSession(current, { stop, remove, replace }),
  ).rejects.toThrow("Storage unavailable");
  expect(sessionOf(irgatId)).toBe(current.id);
  expect(loadIrgatRotation(current.id)).toEqual(rotation);
  expect(replace).not.toHaveBeenCalled();
});

it("does not delete a conversation when stopping it fails", async () => {
  const current = chat("resident");
  const irgatId = irgatFor(current.cwd, current.id);
  const stop = vi.fn().mockRejectedValue(new Error("Could not stop the reply"));
  const remove = vi.fn();
  const replace = vi.fn();
  await expect(
    resetIrgatSession(current, { stop, remove, replace }),
  ).rejects.toThrow("Could not stop the reply");
  expect(remove).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(sessionOf(irgatId)).toBe(current.id);
});

it("leaves ordinary tabs, their selection, and their sessions untouched", () => {
  const session = chat("blank");
  const tab = newTab(session.id);
  const tabs = [tab];
  const sessions = [session];
  const create = vi.fn(createSession);
  expect(
    detachIrgatTabs(tabs, sessions, tab.id, session.cwd, create),
  ).toBeUndefined();
  expect(tabs).toEqual([tab]);
  expect(sessions).toEqual([session]);
  expect(create).not.toHaveBeenCalled();
});

it("restores New session when the earlier agent tab was the project's only tab", () => {
  const agent = chat("resident");
  irgatFor(agent.cwd, agent.id);
  const oldTab = newTab(agent.id);
  const migration = detachIrgatTabs(
    [oldTab],
    [agent],
    oldTab.id,
    agent.cwd,
    createSession,
  )!;
  expect(migration.agentViewId).toBe(agent.id);
  expect(migration.tabs).toHaveLength(1);
  const blank = migration.addedSessions[0];
  expect(blank.blocks).toEqual([]);
  expect(blank.cwd).toBe(agent.cwd);
  expect(leafIds(migration.tabs[0].layout)).toEqual([blank.id]);
  expect(migration.activeTabId).toBe(migration.tabs[0].id);
  expect(
    planWorkspaceTabClose({
      tabs: migration.tabs,
      sessions: [agent, blank],
      closingTabId: migration.activeTabId,
      scope: "project",
    }),
  ).toEqual({ action: "keep" });
});

it("keeps existing session tabs and restores their original close rules", () => {
  const agent = chat("resident");
  const first = chat("first");
  const second = chat("second");
  irgatFor(agent.cwd, agent.id);
  const firstTab = newTab(first.id);
  const secondTab = newTab(second.id);
  const oldAgentTab = newTab(agent.id);
  const sessions = [first, second, agent];
  const migration = detachIrgatTabs(
    [firstTab, secondTab, oldAgentTab],
    sessions,
    oldAgentTab.id,
    agent.cwd,
    createSession,
  )!;
  expect(migration.tabs).toEqual([firstTab, secondTab]);
  expect(migration.tabs[0]).toBe(firstTab);
  expect(migration.addedSessions).toEqual([]);
  expect(migration.activeTabId).toBe(firstTab.id);
  expect(
    planWorkspaceTabClose({
      tabs: migration.tabs,
      sessions,
      closingTabId: secondTab.id,
      scope: "project",
    }),
  ).toEqual({ action: "close", nextActiveTabId: firstTab.id });
  expect(
    planWorkspaceTabClose({
      tabs: [firstTab],
      sessions,
      closingTabId: firstTab.id,
      scope: "project",
    }),
  ).toEqual({ action: "keep" });
});

it("preserves files and ordinary panes from a split agent tab", () => {
  const agent = chat("resident");
  irgatFor(agent.cwd, agent.id);
  const oldTab = newTab(agent.id);
  oldTab.layout = splitPane(oldTab.layout, agent.id, "right", "file-pane");
  oldTab.editorPanes = [
    {
      id: "file-pane",
      activeFileId: "file",
      files: [{ id: "file", path: "/project/file.ts", cwd: agent.cwd }],
    },
  ];
  const migration = detachIrgatTabs(
    [oldTab],
    [agent],
    oldTab.id,
    agent.cwd,
    createSession,
  )!;
  expect(migration.tabs[0].id).toBe(oldTab.id);
  expect(leafIds(migration.tabs[0].layout)).toEqual(["file-pane"]);
  expect(migration.tabs[0].focusedId).toBe("file-pane");
  expect(migration.tabs[0].editorPanes).toBe(oldTab.editorPanes);
  expect(migration.addedSessions).toEqual([]);
});

it("restores a blank tab for a background project without switching the active tab", () => {
  const agent = chat("resident", "/background");
  const current = chat("current", "/foreground");
  irgatFor(agent.cwd, agent.id);
  const active = newTab(current.id);
  const migration = detachIrgatTabs(
    [active, newTab(agent.id)],
    [current, agent],
    active.id,
    current.cwd,
    createSession,
  )!;
  expect(migration.activeTabId).toBe(active.id);
  expect(migration.agentViewId).toBeUndefined();
  expect(migration.tabs[0]).toBe(active);
  expect(migration.addedSessions[0].cwd).toBe(agent.cwd);
});

it("creates independent child chats sharing the parent Irgat and persistent settings", async () => {
  const { createIrgatChildSession } = await import("./irgatWorkspace");
  const { irgatForSession, listIrgats } = await import("./irgat");
  const parent = {
    ...chat("parent"),
    model: "gpt-test",
    providerAccountId: "parent-account",
    modelSettings: { effort: "high" },
    blocks: [{ id: "old", role: "user" as const, text: "Parent history" }],
  };
  const irgatId = irgatFor(parent.cwd, parent.id);
  const child = createIrgatChildSession(irgatId, parent);
  const sibling = createIrgatChildSession(irgatId, parent);
  expect(child.id).not.toBe(parent.id);
  expect(child.blocks).toEqual([]);
  expect(child.model).toBe(parent.model);
  expect(child.providerAccountId).toBe("parent-account");
  expect(child.modelSettings).toEqual(parent.modelSettings);
  expect(irgatForSession(child.id)?.id).toBe(irgatId);
  expect(irgatForSession(sibling.id)?.id).toBe(irgatId);
  expect(listIrgats()[0].childSessionIds).toEqual([child.id, sibling.id]);
  expect(findIrgat(irgatId)?.sessionId).toBe(parent.id);
  const fresh = await resetIrgatSession(child, {
    stop: async () => child,
    remove: async () => {},
    replace: () => {},
  });
  expect(irgatForSession(fresh.id)?.id).toBe(irgatId);
  expect(irgatForSession(child.id)).toBeUndefined();
  expect(findIrgat(irgatId)?.childSessionIds).toEqual([fresh.id, sibling.id]);
  expect(findIrgat(irgatId)?.sessionId).toBe(parent.id);
});
