// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIrgat,
  findIrgat,
  updateIrgat,
  type Irgat,
} from "../../irgats/model/irgat";
import { shouldPersistSession } from "../../sessions/data/sessionStore";
import { newSession, type Session } from "../../sessions/model/session";
import type { WebIrgats, WebSession } from "./protocol";
import {
  handleWebAccess,
  webAccessDefaults,
  type WebAccessDeps,
} from "./webAccess";

function stored(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/Users/me"), id, title: "", ...patch };
}

/** A Mac with these chats open and these saved but not loaded yet. */
function mac(open: Session[], saved: Session[] = []) {
  const sessions = [...open];
  const deps: WebAccessDeps = {
    ...webAccessDefaults,
    sessions: () => sessions,
    submit: vi.fn(() => true),
    approve: vi.fn(),
    answer: vi.fn(),
    stop: vi.fn(),
    launch: vi.fn(async () => {}),
    irgatHost: {
      home: async () => "/Users/me",
      load: vi.fn(async (id: string) => {
        const found =
          sessions.find((entry) => entry.id === id) ??
          saved.find((entry) => entry.id === id);
        if (found && !sessions.includes(found)) sessions.push(found);
        return found ?? null;
      }),
      create: (cwd) => newSession("claude", cwd),
      add: vi.fn((session: Session) => void sessions.push(session)),
    },
    irgatsEnabled: () => true,
    saveSession: vi.fn(async (session: Session) => ({ id: session.id })),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async (id: string) => {
      const index = sessions.findIndex((entry) => entry.id === id);
      if (index >= 0) sessions.splice(index, 1);
      return true;
    }),
  };
  return { deps, sessions };
}

function irgat(patch: Partial<Irgat> = {}): Irgat {
  const created = createIrgat(["/Users/me/code/shop"]);
  updateIrgat(created.id, (current) => ({ ...current, ...patch }));
  return findIrgat(created.id)!;
}

beforeEach(() => localStorage.clear());

describe("Irgats on the web page", () => {
  it("lists each Irgat with its look, projects and most pressing chat", async () => {
    const crab = irgat({
      name: "Crab",
      sessionId: "main",
      childSessionIds: ["c1", "c2"],
    });
    const working = stored("main", { busy: true });
    const waiting = stored("c1", {
      title: "Release notes",
      pendingQuestion: {
        requestId: 1,
        questions: [
          {
            id: "q",
            prompt: "Ship today?",
            multiSelect: false,
            allowCustom: true,
            options: [],
          },
        ],
      },
    });
    const { deps } = mac([working, waiting]);

    const result = (await handleWebAccess(deps, "irgats", {})) as WebIrgats;

    expect(result.enabled).toBe(true);
    expect(result.irgats).toEqual([
      {
        id: crab.id,
        name: "Crab",
        mascot: { name: crab.mascot, color: crab.color },
        projects: ["shop"],
        status: "needs-you",
        activity: "Ship today?",
        chats: [
          { sessionId: "c1", title: "Release notes", status: "needs-you" },
          // Not loaded on the Mac yet: named as the desktop rail names it.
          { sessionId: "c2", title: "Chat 2", status: "idle" },
        ],
      },
    ]);
  });

  it("shows nothing while Irgats are turned off on the Mac", async () => {
    irgat();
    const { deps } = mac([]);
    deps.irgatsEnabled = () => false;

    expect(await handleWebAccess(deps, "irgats", {})).toEqual({
      enabled: false,
      irgats: [],
    });
    await expect(
      handleWebAccess(deps, "irgatOpen", { irgatId: "x" }),
    ).rejects.toThrow("Irgats are turned off on your Mac.");
  });

  it("opens an Irgat's main chat, starting it the first time", async () => {
    const fresh = irgat();
    const { deps, sessions } = mac([]);

    const { sessionId } = (await handleWebAccess(deps, "irgatOpen", {
      irgatId: fresh.id,
    })) as { sessionId: string };

    expect(findIrgat(fresh.id)?.sessionId).toBe(sessionId);
    expect(sessions.map((entry) => entry.id)).toEqual([sessionId]);
    expect(sessions[0]).toMatchObject({
      cwd: "/Users/me",
      runtimeMode: "auto",
    });
  });

  it("loads a saved Irgat chat on demand and shows it with the mascot", async () => {
    const crab = irgat({
      name: "Crab",
      sessionId: "main",
      childSessionIds: ["c1"],
    });
    const { deps } = mac(
      [],
      [stored("main"), stored("c1", { title: "Notes" })],
    );

    expect(
      await handleWebAccess(deps, "irgatOpen", {
        irgatId: crab.id,
        sessionId: "c1",
      }),
    ).toEqual({ sessionId: "c1" });
    // After a restart the page still has the chat open: it loads again.
    const view = (await handleWebAccess(deps, "session", {
      id: "main",
    })) as WebSession;
    expect(view).toMatchObject({
      irgat: "Crab",
      mascot: { name: crab.mascot, color: crab.color },
    });
    await expect(
      handleWebAccess(deps, "irgatOpen", {
        irgatId: crab.id,
        sessionId: "someone-else",
      }),
    ).rejects.toThrow("That chat no longer belongs to this Irgat.");
  });

  it("starts a new chat with an Irgat and keeps it only once it is saved", async () => {
    const crab = irgat({ sessionId: "main" });
    const { deps, sessions } = mac([stored("main")]);

    const { sessionId } = (await handleWebAccess(deps, "irgatNewChat", {
      irgatId: crab.id,
    })) as { sessionId: string };

    expect(findIrgat(crab.id)?.childSessionIds).toEqual([sessionId]);
    expect(deps.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: sessionId, title: "Chat 1" }),
    );
    expect(sessions.map((entry) => entry.id)).toEqual(["main", sessionId]);
    // Still blank, yet the Mac stores it, so the row opens after a restart.
    expect(shouldPersistSession(sessions[1])).toBe(true);

    deps.saveSession = vi.fn(async () => {
      throw new Error("Disk full");
    });
    await expect(
      handleWebAccess(deps, "irgatNewChat", { irgatId: crab.id }),
    ).rejects.toThrow("Disk full");
    deps.saveSession = vi.fn(async () => null);
    await expect(
      handleWebAccess(deps, "irgatNewChat", { irgatId: crab.id }),
    ).rejects.toThrow("Irgatos could not save the new chat.");
    expect(findIrgat(crab.id)?.childSessionIds).toEqual([sessionId]);
    expect(sessions).toHaveLength(2);
  });
  it("deletes an Irgat's other chats but leaves its own to the Mac", async () => {
    const crab = irgat({
      sessionId: "main",
      childSessionIds: ["plan", "notes"],
    });
    const { deps, sessions } = mac([
      stored("main"),
      stored("plan", { title: "claude · Plan the launch" }),
      stored("notes"),
    ]);

    const listed = (await handleWebAccess(deps, "irgats", {})) as WebIrgats;
    expect(listed.irgats[0]?.chats[0]?.title).toBe("Plan the launch");

    const main = (await handleWebAccess(deps, "session", {
      id: "main",
    })) as WebSession;
    expect(main.deletable).toBe(false);
    await expect(
      handleWebAccess(deps, "deleteChat", { sessionId: "main" }),
    ).rejects.toThrow("Delete the Irgat on your Mac.");

    expect(
      await handleWebAccess(deps, "deleteChat", { sessionId: "plan" }),
    ).toEqual({ deleted: true });
    expect(deps.remove).toHaveBeenCalledWith("plan");
    expect(deps.remove).toHaveBeenCalledTimes(1);
    expect(findIrgat(crab.id)?.childSessionIds).toEqual(["notes"]);
    expect(sessions.map((entry) => entry.id)).toEqual(["main", "notes"]);

    // Storage refused: the chat stays listed under its Irgat.
    deps.remove = vi.fn(async () => false);
    await expect(
      handleWebAccess(deps, "deleteChat", { sessionId: "notes" }),
    ).rejects.toThrow("could not delete");
    expect(findIrgat(crab.id)?.childSessionIds).toEqual(["notes"]);
  });
});
