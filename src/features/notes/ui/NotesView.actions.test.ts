// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invalidateNotes, type Note, type NoteUpsert } from "../notes";
import { NotesView } from "./NotesView";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));

let root: Root;
let container: HTMLDivElement;
let store: Map<string, Note>;
let onClose: ReturnType<typeof vi.fn>;

const saved: Note = {
  id: "note-saved",
  slug: "auth-plan",
  title: "Auth plan",
  body: "Keep the session cookie global.",
  tags: [],
  sourceCwd: "/work/Edefyn",
  slugPending: false,
  createdAt: 1,
  updatedAt: 1,
};

let created: string[];
const creates = () => created;

beforeEach(() => {
  invalidateNotes();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  store = new Map([[saved.id, { ...saved }]]);
  created = [];
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { note: NoteUpsert }) => {
      if (command === "notes_list") return [...store.values()];
      if (command === "notes_upsert") {
        const previous = store.get(args!.note.id);
        if (!previous) created.push(args!.note.id);
        const note: Note = {
          ...previous,
          ...args!.note,
          title: args!.note.title.trim() || "Untitled",
          slug: previous?.slug ?? args!.note.id,
          tags: args!.note.tags ?? [],
          slugPending: false,
          createdAt: previous?.createdAt ?? 2,
          updatedAt: (previous?.updatedAt ?? 1) + 1,
        };
        store.set(note.id, note);
        return { ...note };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  );
  onClose = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(NotesView, {
        cwd: "/work/Edefyn",
        recents: [{ path: "/work/Edefyn", openedAt: 1 }],
        onClose,
      }),
    ),
  );
}

function newNoteButton() {
  return container.querySelector<HTMLButtonElement>('[aria-label="New note"]')!;
}

function titleField() {
  return container.querySelector<HTMLInputElement>(
    '[aria-label="Note title"]',
  )!;
}

it("creates one blank note when New note is double-clicked", async () => {
  await render();
  await act(async () => {
    newNoteButton().click();
    newNoteButton().click();
  });

  expect(creates()).toHaveLength(1);
  expect(store.size).toBe(2);
});

it("focuses the untouched blank note instead of making a second one", async () => {
  await render();
  await act(async () => newNoteButton().click());
  // Passing through the title fills in its placeholder; that is not writing.
  await act(async () => titleField().focus());
  await act(async () => titleField().blur());
  const card = (title: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button[title]")].find(
      (button) => button.title.startsWith(title),
    )!;
  await act(async () => card("Auth plan").click());
  expect(titleField().value).toBe("Auth plan");

  await act(async () => newNoteButton().click());

  expect(creates()).toHaveLength(1);
  expect(store.size).toBe(2);
  expect(card("Untitled").getAttribute("aria-current")).toBe("true");
  expect(titleField().value).toBe("Untitled");
  expect(document.activeElement).toBe(container.querySelector("textarea"));

  await act(async () => newNoteButton().click());
  expect(creates()).toHaveLength(1);
  expect(document.activeElement).toBe(container.querySelector("textarea"));
});

it("makes a new note once the blank one has been written in", async () => {
  vi.useFakeTimers();
  await render();
  await act(async () => newNoteButton().click());
  const title = titleField();
  act(() => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    set.call(title, "Release checklist");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(800));

  await act(async () => newNoteButton().click());

  expect(store.size).toBe(3);
});
