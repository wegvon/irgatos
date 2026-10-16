import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdeaBoard, IdeasState } from "../../ideas/model/ideas";
import {
  newSession,
  type Block,
  type Session,
} from "../../sessions/model/session";
import type { UserQuestionPrompt } from "../../sessions/model/userQuestion";
import type { WebOverview, WebProjects, WebSession } from "./protocol";
import {
  WEB_TRANSCRIPT_LIMIT,
  handleWebAccess,
  ownerName,
  resetWebAccessCacheForTest,
  type WebAccessDeps,
} from "./webAccess";

function chat(id: string, patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/Users/me/code/shop"),
    id,
    title: "Fix the login form",
    ...patch,
  };
}

const sent: Block = {
  id: "u1",
  role: "user",
  text: "Run the tests",
  startedAt: 1_000,
};

const approval: Block = {
  id: "ask-7",
  role: "tool",
  text: "Run a command",
  tool: {
    kind: "execute",
    status: "pending",
    preview: { kind: "shell", query: "npm test" },
  },
  approval: { requestId: 7 },
};

const question: UserQuestionPrompt = {
  requestId: 9,
  questions: [
    {
      id: "db",
      prompt: "Which database?",
      multiSelect: false,
      allowCustom: true,
      options: [
        { id: "redis", label: "Redis" },
        { id: "sqlite", label: "SQLite" },
      ],
    },
  ],
};

function board(): IdeaBoard {
  return {
    id: "b1",
    title: "Ideas",
    createdAt: 1,
    labels: [{ id: "l1", name: "mobile", color: "blue" }],
    lists: [
      {
        id: "inbox",
        title: "Inbox",
        cards: [
          {
            id: "c1",
            listId: "inbox",
            title: "Dark mode",
            description: "",
            labelIds: [],
            project: null,
            tasks: [],
            dueAt: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      { id: "next", title: "Next up", cards: [] },
    ],
  };
}

function deps(sessions: Session[], ideas: IdeasState = { boards: [board()] }) {
  let id = 0;
  const value: WebAccessDeps = {
    sessions: () => sessions,
    submit: vi.fn(() => true),
    approve: vi.fn(),
    answer: vi.fn(),
    stop: vi.fn(),
    launch: vi.fn(async () => {}),
    projects: () => ["/Users/me/code/shop", "/Users/me/code/irgatos"],
    freeChatDir: async () => "/Users/me/.irgatos/scratch",
    choice: (cwd) =>
      cwd === "/Users/me/code/irgatos"
        ? { harness: "codex", model: "gpt-5" }
        : { harness: "claude", model: "opus" },
    harnesses: () => ["claude", "codex"],
    modelName: (_harness, model) => model.toUpperCase(),
    owner: async () => "Turel",
    ideas: {
      load: vi.fn(async () => ideas),
      create: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
    services: vi.fn(async () => [
      {
        id: "embed",
        host: "embed.example",
        state: "online" as const,
        latencyMs: 120,
        detail: null,
      },
    ]),
    newId: () => `id-${++id}`,
  };
  return value;
}

beforeEach(() => resetWebAccessCacheForTest());

describe("handleWebAccess", () => {
  it("lists open chats the way Fleet groups them, with the Mac's theme", async () => {
    const waiting = chat("a", { blocks: [sent, approval], busy: true });
    const running = chat("b", { blocks: [sent], busy: true });
    const blank = chat("c");
    const overview = (await handleWebAccess(
      deps([waiting, running, blank]),
      "overview",
      {},
    )) as WebOverview;
    expect(overview.needsYou.map((entry) => entry.sessionId)).toEqual(["a"]);
    expect(overview.running.map((entry) => entry.sessionId)).toEqual(["b"]);
    expect(overview.idle).toEqual([]);
    expect(overview.owner).toBe("Turel");
  });

  it("returns the newest messages without internal turns or reasoning", async () => {
    const blocks: Block[] = Array.from(
      { length: WEB_TRANSCRIPT_LIMIT + 5 },
      (_, index) => ({
        id: `m${index}`,
        role: "assistant",
        text: `reply ${index}`,
      }),
    );
    blocks.push({ id: "hidden", role: "user", text: "nudge", internal: true });
    blocks.push({ id: "think", role: "reasoning", text: "hmm" });
    const result = (await handleWebAccess(
      deps([chat("a", { blocks, branch: "main" })]),
      "session",
      { id: "a" },
    )) as WebSession;
    expect(result.blocks).toHaveLength(WEB_TRANSCRIPT_LIMIT);
    expect(result.omitted).toBe(5);
    expect(result.blocks.at(-1)?.id).toBe(`m${WEB_TRANSCRIPT_LIMIT + 4}`);
    expect(result.projectLabel).toBe("shop");
    expect(result.branch).toBe("main");
  });

  it("shows a shell approval's command", async () => {
    const result = (await handleWebAccess(
      deps([chat("a", { blocks: [sent, approval] })]),
      "session",
      { id: "a" },
    )) as WebSession;
    expect(result.blocks[1]?.tool?.detail).toBe("npm test");
    expect(result.requests[0]).toMatchObject({
      kind: "approval",
      requestId: 7,
    });
  });

  it("sends a message into the chat", async () => {
    const d = deps([chat("a")]);
    expect(
      await handleWebAccess(d, "send", { sessionId: "a", text: "  hello  " }),
    ).toEqual({ sent: true });
    expect(d.submit).toHaveBeenCalledWith("a", "hello");
    await expect(
      handleWebAccess(d, "send", { sessionId: "a", text: "   " }),
    ).rejects.toThrow("Write a message first.");
    await expect(
      handleWebAccess(d, "send", { sessionId: "zzz", text: "hi" }),
    ).rejects.toThrow("not open");
  });

  it("decides only approvals that are still open", async () => {
    const d = deps([chat("a", { blocks: [sent, approval] })]);
    await handleWebAccess(d, "approval", {
      sessionId: "a",
      requestId: 7,
      decision: "allow",
    });
    expect(d.approve).toHaveBeenCalledWith("a", 7, "allow");
    await expect(
      handleWebAccess(d, "approval", {
        sessionId: "a",
        requestId: 8,
        decision: "allow",
      }),
    ).rejects.toThrow("already answered");
    await expect(
      handleWebAccess(d, "approval", {
        sessionId: "a",
        requestId: 7,
        decision: "maybe",
      }),
    ).rejects.toThrow("allow or deny");
  });

  it("answers the open question", async () => {
    const d = deps([chat("a", { blocks: [sent], pendingQuestion: question })]);
    await handleWebAccess(d, "answer", {
      sessionId: "a",
      requestId: 9,
      answers: { db: ["sqlite"] },
    });
    expect(d.answer).toHaveBeenCalledWith("a", 9, {
      kind: "answered",
      answers: { db: ["sqlite"] },
    });
    await handleWebAccess(d, "answer", {
      sessionId: "a",
      requestId: 9,
      skip: true,
    });
    expect(d.answer).toHaveBeenLastCalledWith("a", 9, { kind: "skipped" });
    await expect(
      handleWebAccess(d, "answer", { sessionId: "a", requestId: 3 }),
    ).rejects.toThrow("already answered");
  });

  it("stops only a running chat", async () => {
    const d = deps([chat("a", { busy: true }), chat("b")]);
    expect(await handleWebAccess(d, "stop", { sessionId: "a" })).toEqual({
      stopped: true,
    });
    expect(await handleWebAccess(d, "stop", { sessionId: "b" })).toEqual({
      stopped: false,
    });
    expect(d.stop).toHaveBeenCalledTimes(1);
  });

  it("lists free chat first, then recent projects with their defaults", async () => {
    const result = (await handleWebAccess(
      deps([]),
      "projects",
      {},
    )) as WebProjects;
    expect(result.projects.map((project) => project.label)).toEqual([
      "Chat",
      "shop",
      "irgatos",
    ]);
    expect(result.projects[2]?.choice).toMatchObject({
      harness: "codex",
      title: "Codex",
      modelName: "GPT-5",
    });
    expect(result.harnesses.map((choice) => choice.harness)).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("starts a new chat in a project or as a free chat", async () => {
    const d = deps([]);
    expect(
      await handleWebAccess(d, "newChat", {
        cwd: "/Users/me/code/irgatos",
        text: "Add a dark mode",
      }),
    ).toEqual({ sessionId: "id-1" });
    expect(d.launch).toHaveBeenCalledWith(
      {
        prompt: "Add a dark mode",
        cwd: "/Users/me/code/irgatos",
        harness: "codex",
        model: "gpt-5",
        reveal: false,
      },
      "id-1",
    );
    await handleWebAccess(d, "newChat", { cwd: "", text: "Plan my week" });
    expect(d.launch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cwd: "/Users/me/.irgatos/scratch",
        workspaceMode: "current",
      }),
      "id-2",
    );
    await expect(
      handleWebAccess(d, "newChat", { cwd: "/etc", text: "hi" }),
    ).rejects.toThrow("Pick one of your projects.");
  });

  it("captures an idea with its #labels at the top of a list", async () => {
    const d = deps([]);
    await handleWebAccess(d, "ideaAdd", {
      listId: "inbox",
      text: "Swipe to archive #mobile",
    });
    expect(d.ideas.create).toHaveBeenCalledWith(
      "inbox",
      expect.objectContaining({
        id: "id-1",
        title: "Swipe to archive",
        labelIds: ["l1"],
      }),
      0,
    );
    await expect(
      handleWebAccess(d, "ideaAdd", { listId: "gone", text: "x" }),
    ).rejects.toThrow("no longer exists");
  });

  it("edits, moves and deletes an idea", async () => {
    const d = deps([]);
    await handleWebAccess(d, "ideaUpdate", {
      id: "c1",
      description: "Follow the Mac",
      tasks: [{ id: "t1", text: "Ship", done: true }],
    });
    expect(d.ideas.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "c1",
        title: "Dark mode",
        description: "Follow the Mac",
        tasks: [{ id: "t1", text: "Ship", done: true }],
      }),
    );
    await handleWebAccess(d, "ideaMove", { id: "c1", listId: "next" });
    expect(d.ideas.move).toHaveBeenCalledWith("c1", "next", 0);
    await handleWebAccess(d, "ideaDelete", { id: "c1" });
    expect(d.ideas.remove).toHaveBeenCalledWith("c1");
    await expect(
      handleWebAccess(d, "ideaDelete", { id: "nope" }),
    ).rejects.toThrow("no longer exists");
  });

  it("checks services at most once a minute unless asked fresh", async () => {
    const d = deps([]);
    const first = (await handleWebAccess(d, "services", {})) as {
      services: { label: string }[];
    };
    expect(first.services[0]?.label).toBe("Semantic search");
    await handleWebAccess(d, "services", {});
    expect(d.services).toHaveBeenCalledTimes(1);
    await handleWebAccess(d, "services", { fresh: "1" });
    expect(d.services).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown actions", async () => {
    await expect(handleWebAccess(deps([]), "delete", {})).rejects.toThrow(
      "Unknown action",
    );
  });
});

describe("ownerName", () => {
  it("greets the account the home folder is named after", () => {
    expect(ownerName("/Users/turel")).toBe("Turel");
    expect(ownerName("/Users/turel/")).toBe("Turel");
    expect(ownerName("C:\\Users\\ada")).toBe("Ada");
    expect(ownerName("")).toBe("");
  });
});
