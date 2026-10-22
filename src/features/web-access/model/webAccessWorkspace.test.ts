import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedItem, FeedOverview } from "../../feed/model/feed";
import type { KanbanBoard } from "../../kanban/model/kanban";
import type { Note } from "../../notes/notes";
import { newSession, type Session } from "../../sessions/model/session";
import type {
  WebArtifact,
  WebArtifacts,
  WebBoard,
  WebFeed,
  WebNote,
  WebNotes,
} from "./protocol";
import { handleWebAccess, type WebAccessDeps } from "./webAccess";
import {
  phoneNoteBody,
  resetWorkspaceCacheForTest,
  restoreNotePictures,
  type WorkspaceDeps,
} from "./webAccessWorkspace";

const SHOP = "/Users/me/code/shop";

const post: FeedItem = {
  id: "p1",
  source: "x",
  externalId: "1",
  url: "https://x.com/a/status/1",
  author: "ada",
  authorName: "Ada",
  text: "Local-first sync is here",
  summary: "A new sync engine",
  publishedAt: 5_000,
  collectedAt: 6_000,
  metrics: { likes: 1200, reposts: 30 },
  media: ["https://pbs.example/1.jpg"],
  agentInterest: "sync",
  interestId: "i1",
  score: 0.512,
  read: false,
  saved: false,
  similar: 2,
};

const overview: FeedOverview = {
  interests: [
    {
      id: "i1",
      title: "Local-first",
      description: "CRDTs",
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      embedded: true,
    },
  ],
  threshold: 0.4,
  scoring: true,
  counts: { unread: 3, filtered: 1, saved: 0, unscored: 0 },
  lastCollected: { x: 7_000 },
  collector: null,
};

function note(patch: Partial<Note> = {}): Note {
  return {
    id: "n1",
    slug: "plan",
    title: "Plan",
    body: "# Plan\n\nShip it.\n\n![chart](/note-assets/a.png)",
    tags: ["work"],
    sourceCwd: SHOP,
    slugPending: false,
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

function kanban(linked?: string): KanbanBoard {
  return {
    id: "b1",
    project: SHOP,
    createdAt: 1,
    columns: [
      {
        id: "backlog",
        title: "Backlog",
        createdAt: 1,
        updatedAt: 1,
        cards: [
          {
            id: "k1",
            columnId: "backlog",
            title: "Fix login",
            notes: "",
            labels: ["bug"],
            createdAt: 1,
            updatedAt: 1,
            session: linked
              ? { id: linked, status: "running", title: "Login", saved: true }
              : null,
          },
        ],
      },
      { id: "done", title: "Done", createdAt: 1, updatedAt: 1, cards: [] },
    ],
  };
}

function setup(sessions: Session[] = [], linked?: string) {
  const notes = new Map([["n1", note()]]);
  const workspace: WorkspaceDeps = {
    feed: {
      overview: vi.fn(async () => overview),
      items: vi.fn(async () => ({ items: [post], total: 1 })),
      mark: vi.fn(async () => {}),
      markAll: vi.fn(async () => {}),
      saveInterest: vi.fn(async () => {}),
      removeInterest: vi.fn(async () => {}),
      collect: vi.fn(async () => {}),
      trending: vi.fn(async () => ({ repos: [], fetchedAt: 1 })),
    },
    notes: {
      list: vi.fn(async () => [...notes.values()]),
      get: vi.fn(async (id: string) => notes.get(id) ?? null),
      save: vi.fn(async (input) => {
        const saved = note({ ...input, updatedAt: 3 });
        notes.set(saved.id, saved);
        return saved;
      }),
      remove: vi.fn(async () => {}),
      changed: vi.fn(),
    },
    board: {
      load: vi.fn(async () => kanban(linked)),
      create: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
    artifacts: {
      pinned: () => [],
      saved: vi.fn(async () => []),
      session: vi.fn(async () => null),
      document: vi.fn(async () => null),
      readText: vi.fn(async () => "<p>from disk</p>"),
      readBytes: vi.fn(async () => new Uint8Array()),
    },
  };
  let id = 0;
  const deps = {
    sessions: () => sessions,
    projects: () => [SHOP],
    freeChatDir: async () => "/Users/me/.irgatos/scratch",
    newId: () => `id${++id}`,
    launch: vi.fn(async () => {}),
    choice: () => ({ harness: "claude", model: "opus" }),
    harnesses: () => ["claude"],
    models: () => [],
    irgatHost: {
      home: async () => "/Users/me",
      load: vi.fn(async (sessionId: string) =>
        sessionId === "s-saved"
          ? { ...newSession("claude", SHOP), id: sessionId }
          : null,
      ),
      create: (cwd: string) => newSession("claude", cwd),
      add: vi.fn(),
    },
    workspace,
  } as unknown as WebAccessDeps;
  return { deps, workspace };
}

beforeEach(() => resetWorkspaceCacheForTest());

describe("Feed on the phone", () => {
  it("lists posts with their interest, match and counts", async () => {
    const { deps, workspace } = setup();
    const feed = (await handleWebAccess(deps, "feed", {
      view: "saved",
      interestId: "i1",
      unread: "1",
    })) as WebFeed;
    expect(workspace.feed.items).toHaveBeenCalledWith(
      "saved",
      "i1",
      true,
      0,
      30,
    );
    expect(feed.counts).toEqual({ unread: 3, filtered: 1, saved: 0 });
    expect(feed.lastCollected).toBe(7_000);
    expect(feed.items[0]).toMatchObject({
      interest: "Local-first",
      score: 51,
      metrics: "1.2K likes · 30 reposts",
      media: 1,
      at: 5_000,
    });
    // Pictures are counted, never handed to the page to load.
    expect(JSON.stringify(feed)).not.toContain("pbs.example");
  });

  it("marks, and needs a collector before Collect now", async () => {
    const { deps, workspace } = setup();
    await handleWebAccess(deps, "feedMark", {
      ids: ["p1"],
      saved: true,
      junk: 1,
    });
    expect(workspace.feed.mark).toHaveBeenCalledWith(["p1"], { saved: true });
    await expect(
      handleWebAccess(deps, "feedMark", { ids: [] }),
    ).rejects.toThrow();
    await expect(handleWebAccess(deps, "feedCollect", {})).rejects.toThrow(
      /Pick an Irgat/,
    );
  });
});

describe("Notes on the phone", () => {
  it("shows pictures as placeholders and keeps them on save", async () => {
    const { deps, workspace } = setup();
    const shown = (await handleWebAccess(deps, "note", {
      id: "n1",
    })) as WebNote;
    expect(shown.body).toContain("*(📷 Picture 1, on your Mac)*");
    expect(shown.project).toBe("shop");
    await handleWebAccess(deps, "noteSave", {
      id: "n1",
      body: `${shown.body}\n\nOne more line`,
    });
    expect(workspace.notes.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "n1",
        body: "# Plan\n\nShip it.\n\n![chart](/note-assets/a.png)\n\nOne more line",
        tags: ["work"],
      }),
    );
    expect(workspace.notes.changed).toHaveBeenCalled();
  });

  it("files a new note titled from its text", async () => {
    const { deps, workspace } = setup();
    await handleWebAccess(deps, "noteSave", {
      title: "",
      body: "Buy milk\nand bread",
      tags: ["#Home", "home"],
    });
    expect(workspace.notes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "id1", title: "Buy milk", tags: ["home"] }),
    );
    await expect(
      handleWebAccess(deps, "noteSave", { title: " ", body: " " }),
    ).rejects.toThrow(/Write the note/);
    const list = (await handleWebAccess(deps, "notes", {})) as WebNotes;
    expect(list.notes.map((row) => row.id)).toEqual(["id1", "n1"]);
  });

  it("starts a chat with the note attached", async () => {
    const { deps } = setup();
    const result = await handleWebAccess(deps, "noteChat", {
      id: "n1",
      text: "Sum it up",
    });
    expect(result).toEqual({ sessionId: "id1" });
    const launch = (deps.launch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(launch.prompt).toContain("Sum it up");
    expect(launch.prompt).toContain('Referenced note "Plan"');
  });

  it("round-trips placeholders without touching other text", () => {
    const body = "a ![x](/note-assets/1.png) b ![](/note-assets/2.png)";
    expect(restoreNotePictures(phoneNoteBody(body), body)).toBe(body);
    expect(phoneNoteBody("![web](https://a.b/c.png)")).toBe(
      "![web](https://a.b/c.png)",
    );
  });
});

describe("Board on the phone", () => {
  it("shows each card's chat as the Mac does", async () => {
    const running = { ...newSession("claude", SHOP), id: "s1", busy: true };
    const { deps } = setup([running], "s1");
    const result = (await handleWebAccess(deps, "board", {})) as WebBoard;
    expect(result.project).toBe(SHOP);
    expect(result.projects.map((entry) => entry.label)).toEqual([
      "shop",
      "Chats",
    ]);
    expect(result.columns[0]!.cards[0]!.session).toMatchObject({
      sessionId: "s1",
      label: "Running",
      live: true,
    });
  });

  it("adds, moves and checks every id against the board", async () => {
    const { deps, workspace } = setup();
    await handleWebAccess(deps, "boardAdd", {
      project: SHOP,
      columnId: "backlog",
      text: "Dark mode #ui",
    });
    expect(workspace.board.create).toHaveBeenCalledWith(
      "backlog",
      { id: "id1", title: "Dark mode", notes: "", labels: ["ui"] },
      0,
    );
    await handleWebAccess(deps, "boardMove", {
      project: SHOP,
      id: "k1",
      columnId: "done",
      index: 0,
    });
    expect(workspace.board.move).toHaveBeenCalledWith("k1", "done", 0);
    await expect(
      handleWebAccess(deps, "boardMove", {
        project: SHOP,
        id: "k1",
        columnId: "elsewhere",
      }),
    ).rejects.toThrow(/column/);
    await expect(
      handleWebAccess(deps, "board", { project: "/etc" }),
    ).rejects.toThrow(/Pick one of your projects/);
  });

  it("opens a saved chat of a card on the Mac", async () => {
    const { deps } = setup([], "s-saved");
    expect(
      await handleWebAccess(deps, "boardOpenChat", { project: SHOP, id: "k1" }),
    ).toEqual({ sessionId: "s-saved" });
  });
});

describe("Artifacts on the phone", () => {
  function withArtifacts() {
    const session: Session = {
      ...newSession("claude", SHOP),
      id: "s1",
      title: "Landing page",
      blocks: [
        { id: "u1", role: "user", text: "Make a page", startedAt: 1 },
        {
          id: "a1",
          role: "assistant",
          text: `Here:\n\n\`\`\`html\n<!doctype html>\n${"<p>line</p>\n".repeat(12)}\`\`\``,
          startedAt: 2,
        },
      ],
    };
    return setup([session]);
  }

  it("lists the project's artifacts and opens only those", async () => {
    const { deps } = withArtifacts();
    const list = (await handleWebAccess(deps, "artifacts", {})) as WebArtifacts;
    expect(list.artifacts).toHaveLength(1);
    const row = list.artifacts[0]!;
    expect(row).toMatchObject({
      format: "html",
      kind: "HTML",
      sessionId: "s1",
    });
    expect(row.filters).toContain("previews");
    const opened = (await handleWebAccess(deps, "artifact", {
      project: SHOP,
      id: row.id,
    })) as WebArtifact;
    expect(opened.markdown.startsWith("```html")).toBe(true);
    const frame = (await handleWebAccess(deps, "artifactFrame", {
      project: SHOP,
      id: row.id,
    })) as string;
    expect(frame).toContain("<p>line</p>");
    await expect(
      handleWebAccess(deps, "artifact", { project: SHOP, id: "/etc/passwd" }),
    ).rejects.toThrow(/no longer in the project/);
  });

  it("leaves other actions to the page's own handler", async () => {
    const { deps } = setup();
    await expect(handleWebAccess(deps, "nothing", {})).rejects.toThrow(
      "Unknown action",
    );
  });
});
