// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation } from "../../automations/model/automations";
import {
  createIrgat,
  findIrgat,
  updateIrgat,
  type Irgat,
} from "../../irgats/model/irgat";
import type { IrgatFiles } from "../../irgats/model/irgatFiles";
import { newSession, type Session } from "../../sessions/model/session";
import { VOICE_SETTINGS_DEFAULTS } from "../../voice/model/voiceSettings";
import type {
  WebAgents,
  WebAutomations,
  WebIrgatDetail,
  WebSpokenReply,
} from "./protocol";
import {
  handleWebAccess,
  webAccessDefaults,
  type WebAccessDeps,
} from "./webAccess";
import {
  WEB_AGENTS_READS,
  WEB_AGENTS_WRITES,
  type WebAgentsDeps,
} from "./webAccessAgents";

function stored(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/Users/me/code/shop"), id, ...patch };
}

function automation(patch: Partial<Automation> = {}): Automation {
  return {
    id: "a1",
    name: "Morning triage",
    prompt: "Look at new issues",
    harness: "claude",
    model: "opus",
    cwd: "/Users/me/code/shop",
    workspaceMode: "current",
    reuseSession: false,
    runtimeMode: "supervised",
    triggerKind: "time",
    triggerEvent: "",
    scheduleKind: "daily",
    minute: 0,
    time: "09:00",
    dayOfWeek: 1,
    missedRunGraceMinutes: 30,
    enabled: true,
    nextRunAt: 5_000,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function files(memory = ""): IrgatFiles {
  return {
    id: "x",
    dir: "/data",
    soul: "# Soul\n",
    soulHash: "h1",
    memory,
    memoryHash: "m1",
    memoryPath: "/data/MEMORY.md",
    topics: [],
  };
}

/** A Mac with these chats open and one automation. */
function mac(open: Session[], automations: Automation[] = [automation()]) {
  const sessions = [...open];
  let memory = "# Memory\n- 2026-10-01 · Turel likes short replies\n";
  const agents: WebAgentsDeps = {
    outside: vi.fn(async () => [
      {
        sessionId: "ext-1",
        pid: 4,
        cwd: "/Users/me/code/site",
        status: "waiting",
        canMessage: true,
      },
    ]),
    interruptedIds: () => new Set<string>(),
    automations: {
      list: vi.fn(async () => automations),
      runs: vi.fn(async () => []),
      setEnabled: vi.fn(async () => {}),
      run: vi.fn(async () => {}),
    },
    irgats: {
      create: () => createIrgat(),
      files: vi.fn(async () => files(memory)),
      saveSoul: vi.fn(async () => "h2"),
      forget: vi.fn(async (_id, edit: (text: string) => string) => {
        memory = edit(memory);
      }),
      setModel: vi.fn(),
      setMode: vi.fn(),
    },
    voice: {
      settings: () => ({ ...VOICE_SETTINGS_DEFAULTS }),
      summarize: vi.fn(async () => "Kısa özet."),
      parts: vi.fn(async (text: string) => [text]),
      synthesize: vi.fn(async () => "UklGRg=="),
      dictateStart: vi.fn(async () => "s1"),
      dictateChunk: vi.fn(async () => "Merhaba"),
      dictateFinish: vi.fn(async () => "Merhaba."),
    },
  };
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
      load: vi.fn(
        async (id: string) => sessions.find((entry) => entry.id === id) ?? null,
      ),
      create: (cwd) => newSession("claude", cwd),
      add: vi.fn((session: Session) => void sessions.push(session)),
    },
    irgatsEnabled: () => true,
    saveSession: vi.fn(async (session: Session) => ({ id: session.id })),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => true),
    projects: () => ["/Users/me/code/shop", "/Users/me/code/site"],
    harnesses: () => ["claude", "codex"],
    agents,
  };
  return { deps, agents, sessions, memory: () => memory };
}

function irgat(patch: Partial<Irgat> = {}): Irgat {
  const created = createIrgat(["/Users/me/code/shop"]);
  updateIrgat(created.id, (current) => ({ ...current, ...patch }));
  return findIrgat(created.id)!;
}

beforeEach(() => localStorage.clear());

describe("Fleet agents on the web page", () => {
  it("draws the Agent Tree and lists Claude Code outside Irgatos", async () => {
    const now = Date.now();
    const { deps } = mac([
      stored("s1", {
        title: "Fix the login form",
        busy: true,
        blocks: [{ id: "u", role: "user", text: "Fix it", sentAt: now }],
      }),
    ]);

    const result = (await handleWebAccess(deps, "agents", {
      window: "24h",
    })) as WebAgents;

    expect(result.window).toBe("24h");
    expect(result.agents[0]).toMatchObject({ id: "irgatos", depth: 0 });
    expect(result.agents[1]).toMatchObject({
      id: "s1",
      depth: 1,
      status: "running",
      sessionId: "s1",
    });
    expect(result.summary).toMatchObject({ total: 1, running: 1 });
    expect(result.outside).toEqual([
      {
        id: "ext-1",
        name: "site",
        folder: "/Users/me/code/site",
        status: "waiting",
      },
    ]);
  });

  it("asks the Mac to update when it has no agents support", async () => {
    const { deps } = mac([]);
    delete deps.agents;
    await expect(handleWebAccess(deps, "agents", {})).rejects.toThrow(
      "Update Irgatos on your Mac first.",
    );
  });
});

describe("automations on the web page", () => {
  it("lists them with their trigger and place, enabled first", async () => {
    const { deps } = mac(
      [],
      [
        automation({ id: "off", name: "Archive", enabled: false }),
        automation(),
      ],
    );
    const result = (await handleWebAccess(
      deps,
      "automations",
      {},
    )) as WebAutomations;
    expect(result.automations.map((entry) => entry.id)).toEqual(["a1", "off"]);
    expect(result.automations[0]).toMatchObject({
      place: "shop",
      trigger: "Daily at 9:00 AM",
      nextRunAt: 5_000,
    });
    // A paused one has no next run.
    expect(result.automations[1]!.nextRunAt).toBe(0);
  });

  it("runs one now and turns it off and on", async () => {
    const { deps, agents } = mac([]);
    await handleWebAccess(deps, "automationRun", { id: "a1" });
    expect(agents.automations.run).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1" }),
    );
    await handleWebAccess(deps, "automationEnabled", {
      id: "a1",
      enabled: false,
    });
    expect(agents.automations.setEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1" }),
      false,
    );
    await expect(
      handleWebAccess(deps, "automationRun", { id: "gone" }),
    ).rejects.toThrow("That automation no longer exists.");
  });
});

describe("Irgat settings on the web page", () => {
  it("shows its look, model, projects, soul and memory", async () => {
    const crab = irgat({ name: "Crab", sessionId: "main" });
    const { deps } = mac([stored("main", { runtimeMode: "auto" })]);

    const detail = (await handleWebAccess(deps, "irgat", {
      irgatId: crab.id,
    })) as WebIrgatDetail;

    expect(detail).toMatchObject({
      id: crab.id,
      name: "Crab",
      sessionId: "main",
      harness: "claude",
      runtimeMode: "auto",
      projects: [{ path: "/Users/me/code/shop", label: "shop" }],
      showSessions: true,
      groupInFolder: false,
      soul: "# Soul\n",
      agents: [],
    });
    expect(detail.memory).toEqual([
      {
        index: 1,
        text: "Turel likes short replies",
        date: "2026-10-01",
        struck: false,
      },
    ]);
  });

  it("creates an Irgat with its chat ready", async () => {
    const { deps, sessions } = mac([]);
    const { irgatId, sessionId } = (await handleWebAccess(
      deps,
      "irgatCreate",
      {},
    )) as { irgatId: string; sessionId: string };
    expect(findIrgat(irgatId)?.sessionId).toBe(sessionId);
    expect(sessions.map((entry) => entry.id)).toEqual([sessionId]);
  });

  it("changes its name, look, projects, switches, model and permissions", async () => {
    const crab = irgat({ sessionId: "main" });
    const { deps, agents } = mac([stored("main")]);

    await handleWebAccess(deps, "irgatUpdate", {
      irgatId: crab.id,
      name: "Yengeç",
      addProject: "/Users/me/code/site",
      removeProject: "/Users/me/code/shop",
      showSessions: false,
      groupInFolder: true,
      harness: "codex",
      mode: "full-access",
    });

    expect(findIrgat(crab.id)).toMatchObject({
      name: "Yengeç",
      projects: ["/Users/me/code/site"],
      showStartedSessionsInSidebar: false,
      useSidebarFolders: true,
    });
    expect(agents.irgats.setModel).toHaveBeenCalledWith(
      "main",
      "codex",
      expect.any(String),
    );
    expect(agents.irgats.setMode).toHaveBeenCalledWith("main", "full-access");
    await expect(
      handleWebAccess(deps, "irgatUpdate", {
        irgatId: crab.id,
        addProject: "/etc",
      }),
    ).rejects.toThrow("Pick one of your projects.");
    await expect(
      handleWebAccess(deps, "irgatUpdate", { irgatId: crab.id, mode: "god" }),
    ).rejects.toThrow("Pick one of the permission modes.");
  });

  it("saves the soul unless it changed on the Mac meanwhile", async () => {
    const crab = irgat();
    const { deps, agents } = mac([]);
    await handleWebAccess(deps, "irgatSoul", {
      irgatId: crab.id,
      soul: "# Soul\nBe brief.\n",
      was: "# Soul\n",
    });
    expect(agents.irgats.saveSoul).toHaveBeenCalledWith(
      crab.id,
      "# Soul\nBe brief.\n",
      "h1",
    );
    await expect(
      handleWebAccess(deps, "irgatSoul", {
        irgatId: crab.id,
        soul: "x",
        was: "older",
      }),
    ).rejects.toThrow("changed on your Mac");
  });

  it("forgets only the fact the phone showed", async () => {
    const crab = irgat();
    const { deps, memory } = mac([]);
    await expect(
      handleWebAccess(deps, "irgatForget", {
        irgatId: crab.id,
        index: 1,
        text: "Something else",
      }),
    ).rejects.toThrow("Its memory changed");
    expect(memory()).toContain("short replies");
    await handleWebAccess(deps, "irgatForget", {
      irgatId: crab.id,
      index: 1,
      text: "Turel likes short replies",
    });
    expect(memory()).toBe("# Memory\n");
  });
});

describe("voice on the web page", () => {
  const replied = (text: string) =>
    stored("s1", {
      blocks: [
        { id: "u", role: "user", text: "Ne yaptın?" },
        { id: "a", role: "assistant", text },
      ],
    });

  it("reads the Gemini summary of the last reply when the Mac does", async () => {
    const { deps, agents } = mac([replied("Uzun bir yanıt.")]);
    const result = (await handleWebAccess(deps, "voiceReply", {
      sessionId: "s1",
    })) as WebSpokenReply;
    expect(result).toEqual({ parts: ["Kısa özet."], summarized: true });
    expect(agents.voice.summarize).toHaveBeenCalledWith(
      "Uzun bir yanıt.",
      "tr-TR",
    );
  });

  it("falls back to the reply itself without a summary", async () => {
    const { deps, agents } = mac([replied("**Bitti.** Testler geçti.")]);
    agents.voice.summarize = vi.fn(async () => null);
    const result = (await handleWebAccess(deps, "voiceReply", {
      sessionId: "s1",
    })) as WebSpokenReply;
    expect(result).toEqual({
      parts: ["Bitti. Testler geçti."],
      summarized: false,
    });
  });

  it("passes dictation through to the Mac's speech service", async () => {
    const { deps, agents } = mac([]);
    expect(await handleWebAccess(deps, "dictateStart", {})).toEqual({
      session: "s1",
    });
    expect(
      await handleWebAccess(deps, "dictateChunk", { session: "s1", pcm: "AA==" }),
    ).toEqual({ text: "Merhaba" });
    expect(agents.voice.dictateChunk).toHaveBeenCalledWith("s1", "AA==");
    expect(
      await handleWebAccess(deps, "dictateFinish", { session: "s1" }),
    ).toEqual({ text: "Merhaba." });
  });
});

describe("the Mac's server", () => {
  it("lets every one of these calls through, reads as GET and writes as POST", () => {
    const rust = readFileSync("src-tauri/src/web_access.rs", "utf8");
    const list = (name: string) =>
      [
        ...(rust.match(new RegExp(`const ${name}[^=]*= \\[([^\\]]*)\\]`))?.[1] ??
          "").matchAll(/"(\w+)"/g),
      ].map((match) => match[1]);
    expect(list("READ_ACTIONS")).toEqual(
      expect.arrayContaining([...WEB_AGENTS_READS]),
    );
    expect(list("WRITE_ACTIONS")).toEqual(
      expect.arrayContaining([...WEB_AGENTS_WRITES]),
    );
  });
});
