// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelectionMenu } from "../../files/ui/EditorSelectionMenu";
import { ADD_TO_CHAT_EVENT } from "../../sessions/model/quoteDraft";
import { TranscriptSelectionMenu } from "../../sessions/ui/TranscriptSelectionMenu";
import { DiffCommentComposer } from "../../source-control/ui/DiffCommentComposer";
import {
  addReviewNote,
  irgatReviewScope,
  listReviewNotes,
  MAX_REVIEW_NOTES_PER_SCOPE,
  projectReviewScope,
  resetReviewStoreCache,
  setActiveReviewScope,
} from "../model/reviewStore";
import {
  readContainedSelection,
  ReviewableSelection,
  selectionChatText,
  TextSelectionReviewMenu,
} from "./TextSelectionReviewMenu";

const scope = projectReviewScope("/work/app");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  resetReviewStoreCache();
  setActiveReviewScope(scope);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.getSelection()?.removeAllRanges();
  localStorage.clear();
  resetReviewStoreCache();
  setActiveReviewScope(null);
  vi.unstubAllGlobals();
});

function setTextarea(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function kindButton(kind: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    `[role="group"] [data-review-kind="${kind}"]`,
  )!;
}

function submitNoteForm(text: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "[data-review-note-form] textarea",
  )!;
  act(() => setTextarea(textarea, text));
  act(() =>
    document
      .querySelector<HTMLButtonElement>('[data-review-note-form] button[type="submit"]')!
      .click(),
  );
}

describe("EditorSelectionMenu", () => {
  const selection = {
    path: "src\\server.ts",
    startLine: 10,
    endLine: 12,
    text: "app.listen(4000);",
    anchor: new DOMRect(10, 10, 50, 16),
  };

  it("keeps Add to chat and adds the three review kinds", () => {
    act(() =>
      root.render(
        createElement(EditorSelectionMenu, { selection, onDismiss: vi.fn() }),
      ),
    );
    const toolbar = document.querySelector('[role="toolbar"]')!;
    expect(toolbar.textContent).toContain("Add to chat");
    expect(toolbar.textContent).toContain("Add to Review");
    expect(
      [...toolbar.querySelectorAll("[data-review-kind]")].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Add to Review: Change",
      "Add to Review: Question",
      "Add to Review: Comment",
    ]);
  });

  it("collects a note with the file, lines, and selected code", () => {
    const onDismiss = vi.fn();
    act(() =>
      root.render(createElement(EditorSelectionMenu, { selection, onDismiss })),
    );
    act(() => kindButton("question").click());
    const form = document.querySelector("[data-review-note-form]")!;
    expect(form.textContent).toContain("src/server.ts · L10-12");
    expect(
      form
        .querySelector('[role="radio"][aria-checked="true"]')
        ?.getAttribute("data-review-kind"),
    ).toBe("question");

    submitNoteForm("Should the port come from config?");
    expect(onDismiss).toHaveBeenCalled();
    expect(listReviewNotes(scope)).toMatchObject([
      {
        kind: "question",
        source: "file",
        targetPath: "src/server.ts",
        lineRange: { start: 10, end: 12 },
        selection: "app.listen(4000);",
        note: "Should the port come from config?",
        status: "open",
      },
    ]);
  });

  it("keeps the form open even after the editor drops the selection", () => {
    const onDismiss = vi.fn();
    act(() =>
      root.render(createElement(EditorSelectionMenu, { selection, onDismiss })),
    );
    act(() => kindButton("change").click());
    act(() =>
      root.render(
        createElement(EditorSelectionMenu, { selection: null, onDismiss }),
      ),
    );
    submitNoteForm("Read the port from env.");
    expect(listReviewNotes(scope)[0].lineRange).toEqual({ start: 10, end: 12 });
  });

  it("shows why a note could not be added", () => {
    for (let i = 0; i < MAX_REVIEW_NOTES_PER_SCOPE; i += 1)
      addReviewNote(scope, {
        kind: "comment",
        source: "file",
        targetPath: "a",
        selection: "",
        note: `n${i}`,
      });
    const onDismiss = vi.fn();
    act(() =>
      root.render(createElement(EditorSelectionMenu, { selection, onDismiss })),
    );
    act(() => kindButton("change").click());
    submitNoteForm("One too many");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "already holds",
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("DiffCommentComposer", () => {
  const target = {
    line: {
      kind: "del" as const,
      text: "retry(5);",
      oldNumber: 41,
      newNumber: null,
    },
    anchor: new DOMRect(0, 0, 10, 10),
  };

  it("adds a diff comment to the review instead of the chat", () => {
    const onDismiss = vi.fn();
    const chat = vi.fn();
    window.addEventListener(ADD_TO_CHAT_EVENT, chat);
    act(() =>
      root.render(
        createElement(DiffCommentComposer, {
          path: "src/net.ts",
          target,
          onDismiss,
        }),
      ),
    );
    expect(kindButton("change").disabled).toBe(true);
    act(() =>
      setTextarea(document.querySelector("textarea")!, "Why drop the retries?"),
    );
    act(() => kindButton("question").click());
    window.removeEventListener(ADD_TO_CHAT_EVENT, chat);

    expect(chat).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
    expect(listReviewNotes(scope)).toMatchObject([
      {
        kind: "question",
        source: "diff",
        targetPath: "src/net.ts",
        lineRange: { start: 41, end: 41 },
        selection: "-retry(5);  (deleted line)",
        note: "Why drop the retries?",
      },
    ]);
  });

  it("still adds straight to chat", () => {
    const chat = vi.fn();
    window.addEventListener(ADD_TO_CHAT_EVENT, chat);
    act(() =>
      root.render(
        createElement(DiffCommentComposer, {
          path: "src/net.ts",
          target,
          onDismiss: vi.fn(),
        }),
      ),
    );
    act(() => setTextarea(document.querySelector("textarea")!, "Keep one retry."));
    act(() =>
      document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
    );
    window.removeEventListener(ADD_TO_CHAT_EVENT, chat);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(listReviewNotes(scope)).toEqual([]);
  });
});

describe("TranscriptSelectionMenu", () => {
  const selection = {
    text: "We can cache the token for an hour.",
    rect: new DOMRect(10, 20, 100, 20),
    blockId: "b1",
  };

  it("offers Add to Review only when it can name the message", () => {
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          selection,
          onAddToChat: vi.fn(),
          onDismiss: vi.fn(),
        }),
      ),
    );
    expect(document.querySelector("[data-review-kinds]")).toBeNull();
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, {
          selection,
          onAddToChat: vi.fn(),
          reviewTarget: "Reply in “Auth”",
          onDismiss: vi.fn(),
        }),
      ),
    );
    expect(document.querySelector("[data-review-kinds]")).not.toBeNull();
  });

  it("keeps the note form after focus clears the page selection", () => {
    setActiveReviewScope(irgatReviewScope("astra"));
    const onDismiss = vi.fn();
    const props = { reviewTarget: "Reply in “Auth”", onDismiss };
    act(() =>
      root.render(createElement(TranscriptSelectionMenu, { ...props, selection })),
    );
    act(() => kindButton("change").click());
    act(() =>
      root.render(
        createElement(TranscriptSelectionMenu, { ...props, selection: null }),
      ),
    );
    submitNoteForm("Cache it for five minutes.");
    expect(onDismiss).toHaveBeenCalled();
    expect(listReviewNotes(irgatReviewScope("astra"))).toMatchObject([
      {
        kind: "change",
        source: "message",
        targetPath: "Reply in “Auth”",
        selection: "We can cache the token for an hour.",
        note: "Cache it for five minutes.",
      },
    ]);
    expect(listReviewNotes(irgatReviewScope("astra"))[0].lineRange).toBeUndefined();
  });
});

describe("TextSelectionReviewMenu", () => {
  const source = "# Plan\n\n1. Ship the **migration** first.\n2. Flip the flag.";

  function selectText(node: Node, start: number, end: number) {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  it("reads only selections inside its container", () => {
    const inside = document.createElement("p");
    inside.textContent = "inside text";
    const outside = document.createElement("p");
    outside.textContent = "outside text";
    container.append(inside);
    document.body.append(outside);

    selectText(inside.firstChild!, 0, 6);
    expect(readContainedSelection(container, window.getSelection())?.text).toBe(
      "inside",
    );
    selectText(outside.firstChild!, 0, 7);
    expect(readContainedSelection(container, window.getSelection())).toBeNull();
    window.getSelection()!.removeAllRanges();
    expect(readContainedSelection(container, window.getSelection())).toBeNull();
    outside.remove();
  });

  it("turns a rendered Markdown selection into a located review note", async () => {
    const onAddToChat = vi.fn();
    act(() =>
      root.render(
        createElement(
          ReviewableSelection,
          {
            source,
            reviewSource: "document",
            targetPath: "Plan “Rollout”",
            onAddToChat,
          },
          createElement("p", { id: "rendered" }, "Ship the migration first."),
        ),
      ),
    );
    const paragraph = document.getElementById("rendered")!;
    selectText(paragraph.firstChild!, 0, paragraph.textContent!.length);
    await act(async () => {
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const toolbar = document.querySelector('[role="toolbar"]')!;
    expect(toolbar.textContent).toContain("Add to chat");
    act(() => kindButton("comment").click());
    expect(document.querySelector("[data-review-note-form]")?.textContent).toContain(
      "Plan “Rollout” · L3",
    );
    submitNoteForm("This order matters; keep it.");
    expect(listReviewNotes(scope)).toMatchObject([
      {
        kind: "comment",
        source: "document",
        targetPath: "Plan “Rollout”",
        lineRange: { start: 3, end: 3 },
        selection: "Ship the migration first.",
      },
    ]);
    expect(onAddToChat).not.toHaveBeenCalled();
  });

  it("quotes the selection into chat with its source", async () => {
    const onAddToChat = vi.fn();
    const ref = createRef<HTMLDivElement>();
    act(() =>
      root.render(
        createElement(
          "div",
          { ref },
          createElement("p", { id: "rendered" }, "Flip the flag."),
          createElement(TextSelectionReviewMenu, {
            containerRef: ref,
            source,
            reviewSource: "artifact",
            targetPath: "notes.md",
            onAddToChat,
          }),
        ),
      ),
    );
    const paragraph = document.getElementById("rendered")!;
    selectText(paragraph.firstChild!, 0, 4);
    await act(async () => {
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const chat = [...document.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find(
      (item) => item.textContent?.includes("Add to chat"),
    )!;
    act(() => chat.click());
    expect(onAddToChat).toHaveBeenCalledWith("Flip");
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });
});

describe("selectionChatText", () => {
  it("quotes every line under the source name", () => {
    expect(selectionChatText("notes.md", "first\r\n\r\nsecond ")).toBe(
      "From notes.md:\n\n> first\n>\n> second",
    );
  });
});
