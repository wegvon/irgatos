// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewNoteInput } from "./reviewNotes";
import {
  addReviewNote,
  addReviewNoteToActiveScope,
  clearResolvedReviewNotes,
  getActiveReviewScope,
  GLOBAL_REVIEW_SCOPE,
  irgatReviewScope,
  listReviewNotes,
  markReviewNotesSent,
  MAX_REVIEW_NOTES_PER_SCOPE,
  OPEN_REVIEW_DRAWER_EVENT,
  projectReviewScope,
  removeReviewNote,
  requestOpenReviewDrawer,
  resetReviewStoreCache,
  ReviewFullError,
  setActiveReviewScope,
  subscribeActiveReviewScope,
  subscribeReviewNotes,
  updateReviewNote,
} from "./reviewStore";

const KEY = "irgat.redlineReview.v1";
const project = projectReviewScope("/work/app");
const irgat = irgatReviewScope("astra");

const input: ReviewNoteInput = {
  kind: "change",
  source: "file",
  targetPath: "src/app.ts",
  lineRange: { start: 3, end: 3 },
  selection: "let a = 1;",
  note: "Use const.",
};

beforeEach(() => {
  localStorage.clear();
  resetReviewStoreCache();
  setActiveReviewScope(null);
});

afterEach(() => {
  localStorage.clear();
  resetReviewStoreCache();
});

describe("scopes", () => {
  it("keys projects by path and Irgats by id", () => {
    expect(project).toBe("project:/work/app");
    expect(projectReviewScope("/work/app/")).toBe(project);
    expect(projectReviewScope("C:\\Work\\App")).toBe(
      projectReviewScope("c:\\work\\app"),
    );
    expect(irgat).toBe("irgat:astra");
  });
});

describe("review store", () => {
  it("adds open notes per scope and keeps scopes apart", () => {
    const first = addReviewNote(project, input, 10)!;
    addReviewNote(irgat, { ...input, note: "Elsewhere" }, 11);
    expect(first).toMatchObject({ status: "open", createdAt: 10, note: "Use const." });
    expect(listReviewNotes(project).map((note) => note.note)).toEqual([
      "Use const.",
    ]);
    expect(listReviewNotes(irgat).map((note) => note.note)).toEqual([
      "Elsewhere",
    ]);
    expect(listReviewNotes("project:/other")).toEqual([]);
  });

  it("gives every note its own id", () => {
    const a = addReviewNote(project, input, 10)!;
    const b = addReviewNote(project, input, 10)!;
    expect(a.id).not.toBe(b.id);
  });

  it("returns null and stores nothing for an empty note", () => {
    expect(addReviewNote(project, { ...input, note: " " })).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("persists to localStorage, never to the working tree, and reloads", () => {
    addReviewNote(project, input, 10);
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(stored)).toEqual([project]);
    resetReviewStoreCache();
    expect(listReviewNotes(project)).toHaveLength(1);
    expect(listReviewNotes(project)[0].selection).toBe("let a = 1;");
  });

  it("survives a corrupt or hand-edited store", () => {
    localStorage.setItem(KEY, "{not json");
    resetReviewStoreCache();
    expect(listReviewNotes(project)).toEqual([]);

    localStorage.setItem(
      KEY,
      JSON.stringify({
        [project]: [
          { id: "ok", kind: "comment", source: "file", targetPath: "a", note: "Keep", status: "open", createdAt: 1 },
          { id: "bad", kind: "nit", source: "file", targetPath: "a", note: "Drop", status: "open" },
          "junk",
        ],
        [irgat]: "not a list",
      }),
    );
    resetReviewStoreCache();
    expect(listReviewNotes(project).map((note) => note.id)).toEqual(["ok"]);
    expect(listReviewNotes(irgat)).toEqual([]);
  });

  it("edits a note's kind and text, ignoring blank text", () => {
    const added = addReviewNote(project, input)!;
    updateReviewNote(project, added.id, { kind: "question", note: " Why let?\r\n" });
    expect(listReviewNotes(project)[0]).toMatchObject({
      kind: "question",
      note: "Why let?",
    });
    updateReviewNote(project, added.id, { note: "   " });
    expect(listReviewNotes(project)[0].note).toBe("Why let?");
    updateReviewNote(project, "missing", { note: "nothing" });
    expect(listReviewNotes(project)).toHaveLength(1);
  });

  it("tracks when notes are sent, resolved, and reopened", () => {
    const a = addReviewNote(project, input, 1)!;
    const b = addReviewNote(project, { ...input, note: "Second" }, 1)!;
    updateReviewNote(project, b.id, { status: "resolved" }, 2);
    markReviewNotesSent(project, [a.id, b.id], 3);
    let [first, second] = listReviewNotes(project);
    expect(first).toMatchObject({ status: "sent", sentAt: 3 });
    // A resolved note stays resolved when a batch is sent.
    expect(second).toMatchObject({ status: "resolved", resolvedAt: 2 });
    expect(second.sentAt).toBeUndefined();

    updateReviewNote(project, a.id, { status: "resolved" }, 4);
    [first] = listReviewNotes(project);
    expect(first).toMatchObject({ status: "resolved", resolvedAt: 4, sentAt: 3 });

    updateReviewNote(project, a.id, { status: "open" }, 5);
    [first] = listReviewNotes(project);
    expect(first.status).toBe("open");
    expect(first.resolvedAt).toBeUndefined();
    expect(first.sentAt).toBeUndefined();
  });

  it("removes notes and clears resolved ones", () => {
    const a = addReviewNote(project, input)!;
    const b = addReviewNote(project, { ...input, note: "B" })!;
    const c = addReviewNote(project, { ...input, note: "C" })!;
    removeReviewNote(project, a.id);
    updateReviewNote(project, b.id, { status: "resolved" });
    clearResolvedReviewNotes(project);
    expect(listReviewNotes(project).map((note) => note.id)).toEqual([c.id]);
    removeReviewNote(project, c.id);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({});
  });

  it("makes room by dropping the oldest resolved note, then refuses", () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_REVIEW_NOTES_PER_SCOPE; i += 1)
      ids.push(addReviewNote(project, { ...input, note: `n${i}` }, i)!.id);
    updateReviewNote(project, ids[5], { status: "resolved" });
    updateReviewNote(project, ids[9], { status: "resolved" });

    addReviewNote(project, { ...input, note: "fits" });
    const notes = listReviewNotes(project);
    expect(notes).toHaveLength(MAX_REVIEW_NOTES_PER_SCOPE);
    expect(notes.some((note) => note.id === ids[5])).toBe(false);
    expect(notes.some((note) => note.id === ids[9])).toBe(true);

    addReviewNote(project, { ...input, note: "fits too" });
    expect(() => addReviewNote(project, { ...input, note: "no room" })).toThrow(
      ReviewFullError,
    );
    expect(listReviewNotes(project).at(-1)?.note).toBe("fits too");
  });

  it("notifies subscribers, including for other windows' writes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReviewNotes(listener);
    addReviewNote(project, input);
    expect(listener).toHaveBeenCalledTimes(1);

    localStorage.setItem(
      KEY,
      JSON.stringify({
        [project]: [
          { id: "remote", kind: "comment", source: "file", targetPath: "a", note: "From the floating chat", status: "open", createdAt: 1 },
        ],
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listReviewNotes(project).map((note) => note.id)).toEqual(["remote"]);

    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    addReviewNote(project, input);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("active scope", () => {
  it("falls back to the global review and follows the front scope", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveReviewScope(listener);
    expect(getActiveReviewScope()).toBe(GLOBAL_REVIEW_SCOPE);

    setActiveReviewScope(irgat);
    setActiveReviewScope(irgat);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getActiveReviewScope()).toBe(irgat);

    const saved = addReviewNoteToActiveScope(input, 7);
    expect(saved?.scope).toBe(irgat);
    expect(listReviewNotes(irgat)).toHaveLength(1);
    expect(addReviewNoteToActiveScope({ ...input, note: "" })).toBeNull();
    unsubscribe();
  });

  it("asks the matching drawer to open", () => {
    const seen = vi.fn();
    const onOpen = (event: Event) =>
      seen((event as CustomEvent<{ scope: string }>).detail.scope);
    window.addEventListener(OPEN_REVIEW_DRAWER_EVENT, onOpen);
    requestOpenReviewDrawer(project);
    window.removeEventListener(OPEN_REVIEW_DRAWER_EVENT, onOpen);
    expect(seen).toHaveBeenCalledWith(project);
  });
});
