import { beforeEach, expect, it, vi } from "vitest";
import {
  invalidateNotes,
  saveNoteOnce,
  type Note,
  type NoteUpsert,
} from "./notes";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

let store: Map<string, Note>;
let listed: () => Note[];

function upserts() {
  return invoke.mock.calls.filter(([command]) => command === "notes_upsert");
}

beforeEach(() => {
  invalidateNotes();
  store = new Map();
  listed = () => [...store.values()];
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { note?: NoteUpsert; id?: string }) => {
      if (command === "notes_list") return listed();
      if (command === "notes_get") return store.get(args!.id!) ?? null;
      if (command === "notes_upsert") {
        // A real IPC round trip, so overlapping clicks overlap here too.
        await new Promise((resolve) => setTimeout(resolve, 5));
        const note: Note = {
          ...args!.note!,
          title: args!.note!.title || "Untitled",
          slug: args!.note!.id,
          tags: args!.note!.tags ?? [],
          slugPending: false,
          createdAt: 1,
          updatedAt: 1,
        };
        store.set(note.id, note);
        return note;
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
});

it("files one note however many times the same save is clicked at once", async () => {
  const input = { body: "Ship the dedup fix.", sourceSessionId: "irgat-a" };
  const results = await Promise.all([
    saveNoteOnce(input),
    saveNoteOnce(input),
    saveNoteOnce(input),
  ]);

  expect(upserts()).toHaveLength(1);
  expect(store.size).toBe(1);
  expect(results[1]).toBe(results[0]);
  expect(results[2]).toBe(results[0]);
});

it("hands back the saved note when the same message is saved again later", async () => {
  const input = { body: "Keep the cookie global.", sourceSessionId: "irgat-b" };
  const first = await saveNoteOnce(input);
  const again = await saveNoteOnce(input);

  expect(first.created).toBe(true);
  expect(again).toEqual({ note: first.note, created: false });
  expect(upserts()).toHaveLength(1);
});

it("finds a note it just saved even when the list has not caught up", async () => {
  const input = { body: "Stale list body.", sourceSessionId: "irgat-c" };
  const first = await saveNoteOnce(input);
  listed = () => [];

  const again = await saveNoteOnce(input);

  expect(again).toEqual({ note: first.note, created: false });
  expect(upserts()).toHaveLength(1);
});

it("saves again once the earlier note is gone", async () => {
  const input = { body: "Deleted then saved.", sourceSessionId: "irgat-d" };
  const first = await saveNoteOnce(input);
  store.delete(first.note.id);

  const again = await saveNoteOnce(input);

  expect(again.created).toBe(true);
  expect(again.note.id).not.toBe(first.note.id);
  expect(upserts()).toHaveLength(2);
});

it("keeps different text and different chats as separate notes", async () => {
  await saveNoteOnce({ body: "Shared text.", sourceSessionId: "irgat-e" });
  await saveNoteOnce({ body: "Shared text.", sourceSessionId: "irgat-f" });
  await saveNoteOnce({ body: "Other text.", sourceSessionId: "irgat-e" });

  expect(upserts()).toHaveLength(3);
  expect(store.size).toBe(3);
});
