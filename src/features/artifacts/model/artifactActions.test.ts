// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTES_CHANGED_EVENT, type Note } from "../../notes";
import {
  OPEN_ARTIFACT_EVENT,
  requestOpenArtifact,
  resetArtifactNoteState,
  saveArtifactAsNote,
  savedArtifactNoteId,
  type OpenArtifactRequest,
} from "./artifactActions";
import type { WorkspaceArtifact } from "./workspaceArtifacts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const artifact: WorkspaceArtifact = {
  id: "snippet:s1:b1:0",
  origin: "snippet",
  format: "code",
  language: "sql",
  title: "migrate.sql",
  content: "select 1;",
  sessionId: "s1",
  sessionTitle: "Migrate the schema",
  cwd: "/work/app",
  createdAt: 1,
};

function note(id: string, body = ""): Note {
  return {
    id,
    slug: id,
    title: "migrate.sql",
    body,
    tags: [],
    slugPending: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetArtifactNoteState();
});
afterEach(() => {
  resetArtifactNoteState();
  vi.restoreAllMocks();
});

describe("saveArtifactAsNote", () => {
  it("creates a note with the artifact's title, body and source", async () => {
    const create = vi.fn(async () => note("n1"));
    const changed = vi.fn();
    window.addEventListener(NOTES_CHANGED_EVENT, changed);
    const result = await saveArtifactAsNote(artifact, "select 1;", { create, get: vi.fn() });
    window.removeEventListener(NOTES_CHANGED_EVENT, changed);

    expect(result).toEqual({ note: note("n1"), created: true });
    expect(create).toHaveBeenCalledTimes(1);
    const [input] = create.mock.calls[0] as unknown as [
      { title: string; body: string; sourceSessionId?: string; sourceCwd?: string },
    ];
    expect(input.title).toBe("migrate.sql");
    expect(input.body).toContain("```sql\nselect 1;\n```");
    expect(input).toMatchObject({ sourceSessionId: "s1", sourceCwd: "/work/app" });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(savedArtifactNoteId(artifact, "select 1;")).toBe("n1");
  });

  it("joins a save already in flight instead of filing a duplicate", async () => {
    let finish!: (value: Note) => void;
    const create = vi.fn(
      () => new Promise<Note>((resolve) => (finish = resolve)),
    );
    const first = saveArtifactAsNote(artifact, "select 1;", { create, get: vi.fn() });
    const second = saveArtifactAsNote(artifact, "select 1;", { create, get: vi.fn() });
    expect(second).toBe(first);
    await Promise.resolve();
    finish(note("n1"));
    await expect(first).resolves.toMatchObject({ created: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("reuses the note it already made on a later click", async () => {
    const create = vi.fn(async () => note("n1"));
    const get = vi.fn(async (id: string) => note(id));
    await saveArtifactAsNote(artifact, "select 1;", { create, get });
    const again = await saveArtifactAsNote(artifact, "select 1;", { create, get });
    expect(again).toEqual({ note: note("n1"), created: false });
    expect(get).toHaveBeenCalledWith("n1");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("files a new note when the remembered one was deleted", async () => {
    let next = 0;
    const create = vi.fn(async () => note(`n${++next}`));
    await saveArtifactAsNote(artifact, "select 1;", { create, get: vi.fn() });
    const get = vi.fn(async () => {
      throw new Error("not found");
    });
    const again = await saveArtifactAsNote(artifact, "select 1;", { create, get });
    expect(again).toEqual({ note: note("n2"), created: true });
    expect(savedArtifactNoteId(artifact, "select 1;")).toBe("n2");
  });

  it("treats edited text as a new version", async () => {
    let next = 0;
    const create = vi.fn(async () => note(`n${++next}`));
    const get = vi.fn(async (id: string) => note(id));
    await saveArtifactAsNote(artifact, "select 1;", { create, get });
    const edited = await saveArtifactAsNote(artifact, "select 2;", { create, get });
    expect(edited.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("lets the user retry after a failed save", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(note("n1"));
    await expect(
      saveArtifactAsNote(artifact, "select 1;", { create, get: vi.fn() }),
    ).rejects.toThrow("disk full");
    await Promise.resolve();
    await expect(
      saveArtifactAsNote(artifact, "select 1;", { create, get: vi.fn() }),
    ).resolves.toMatchObject({ created: true });
  });

  it("dedupes a written file by path across sessions", async () => {
    const create = vi.fn(async () => note("n1"));
    const get = vi.fn(async (id: string) => note(id));
    const written: WorkspaceArtifact = {
      id: "file:/work/app/a.ts",
      origin: "file",
      format: "code",
      title: "a.ts",
      path: "/work/app/a.ts",
      sessionId: "s1",
      createdAt: 1,
    };
    await saveArtifactAsNote(written, "x", { create, get });
    const fromOtherSession = await saveArtifactAsNote(
      { ...written, sessionId: "s2" },
      "x",
      { create, get },
    );
    expect(fromOtherSession.created).toBe(false);
  });
});

describe("requestOpenArtifact", () => {
  it("dispatches the artifact and whether to pin its tab", () => {
    const seen: OpenArtifactRequest[] = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent<OpenArtifactRequest>).detail);
    window.addEventListener(OPEN_ARTIFACT_EVENT, listener);
    requestOpenArtifact(artifact);
    requestOpenArtifact(artifact, true);
    window.removeEventListener(OPEN_ARTIFACT_EVENT, listener);
    expect(seen).toEqual([
      { artifact, pin: false },
      { artifact, pin: true },
    ]);
  });
});
