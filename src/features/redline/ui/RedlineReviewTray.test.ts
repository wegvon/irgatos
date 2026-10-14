// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewNoteInput } from "../model/reviewNotes";
import {
  addReviewNote,
  listReviewNotes,
  OPEN_REVIEW_DRAWER_EVENT,
  projectReviewScope,
  requestOpenReviewDrawer,
  resetReviewStoreCache,
  updateReviewNote,
} from "../model/reviewStore";
import { RedlineReviewBadge } from "./RedlineReviewBadge";
import { RedlineReviewTray, submitReviewLabel } from "./RedlineReviewTray";

const scope = projectReviewScope("/work/app");

const change: ReviewNoteInput = {
  kind: "change",
  source: "file",
  targetPath: "src/app.ts",
  lineRange: { start: 4, end: 4 },
  selection: "let total = 0;",
  note: "Make this const.",
};
const question: ReviewNoteInput = {
  kind: "question",
  source: "document",
  targetPath: "Plan “Rollout”",
  selection: "Flip the flag",
  note: "For everyone at once?",
};

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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  resetReviewStoreCache();
  vi.unstubAllGlobals();
});

function renderTray(
  props: Partial<Parameters<typeof RedlineReviewTray>[0]> = {},
) {
  const onSend = props.onSend ?? vi.fn(() => true);
  const onInsert = props.onInsert ?? vi.fn();
  act(() =>
    root.render(
      createElement(RedlineReviewTray, { scope, onSend, onInsert, ...props }),
    ),
  );
  return { onSend, onInsert };
}

function button(name: string | RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((item) =>
    typeof name === "string"
      ? item.textContent?.trim() === name || item.getAttribute("aria-label") === name
      : name.test(item.textContent ?? "") || name.test(item.getAttribute("aria-label") ?? ""),
  );
  if (!found) throw new Error(`No button ${name}`);
  return found as HTMLButtonElement;
}

function expand() {
  act(() => container.querySelector<HTMLButtonElement>("[aria-expanded]")!.click());
}

function setTextarea(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("submitReviewLabel", () => {
  it("counts notes in the button label", () => {
    expect(submitReviewLabel(1)).toBe("Submit Review (1 note)");
    expect(submitReviewLabel(3)).toBe("Submit Review (3 notes)");
  });
});

describe("RedlineReviewTray", () => {
  it("stays out of the way until the review has notes", () => {
    renderTray();
    expect(container.querySelector("[data-redline-review]")).toBeNull();
    act(() => {
      addReviewNote(scope, change);
    });
    expect(container.querySelector("[data-redline-review]")).not.toBeNull();
    expect(container.textContent).toContain("1 open");
    expect(button(/Submit Review/).textContent).toContain("Submit Review (1 note)");
  });

  it("only shows notes for its own scope", () => {
    addReviewNote(projectReviewScope("/work/other"), change);
    renderTray();
    expect(container.querySelector("[data-redline-review]")).toBeNull();
  });

  it("sends open notes as one batch and marks them sent", async () => {
    addReviewNote(scope, change, 1);
    addReviewNote(scope, question, 2);
    const resolved = addReviewNote(scope, { ...change, note: "Old note" }, 3)!;
    updateReviewNote(scope, resolved.id, { status: "resolved" });
    const { onSend } = renderTray();

    expect(container.textContent).toContain("2 open · 1 resolved");
    await act(async () => button(/Submit Review/).click());

    expect(onSend).toHaveBeenCalledTimes(1);
    const text = (onSend as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text.split("\n")[0]).toBe(
      "⁂ redline — review of src/app.ts, Plan “Rollout” (2 notes)",
    );
    expect(text).toContain("1. [change] `src/app.ts` L4");
    expect(text).toContain("→ For everyone at once?");
    expect(text).not.toContain("Old note");
    expect(listReviewNotes(scope).map((note) => note.status)).toEqual([
      "sent",
      "sent",
      "resolved",
    ]);
    expect(container.textContent).toContain("2 sent · 1 resolved");
    expect(button(/Submit Review/).disabled).toBe(true);
  });

  it("keeps notes open when the chat does not take the batch", async () => {
    addReviewNote(scope, change);
    renderTray({ onSend: vi.fn(() => false) });
    await act(async () => button(/Submit Review/).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "still open",
    );
    expect(listReviewNotes(scope)[0].status).toBe("open");
  });

  it("keeps notes open and shows why when sending throws", async () => {
    addReviewNote(scope, change);
    renderTray({
      onSend: vi.fn(async () => {
        throw new Error("Session is gone");
      }),
    });
    await act(async () => button(/Submit Review/).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Session is gone",
    );
    expect(listReviewNotes(scope)[0].status).toBe("open");
  });

  it("does not send while disabled", async () => {
    addReviewNote(scope, change);
    const { onSend } = renderTray({ disabled: true });
    expect(button(/Submit Review/).disabled).toBe(true);
    await act(async () => button(/Submit Review/).click());
    expect(onSend).not.toHaveBeenCalled();
  });

  it("inserts the batch into the draft instead of sending", () => {
    addReviewNote(scope, change);
    const { onInsert, onSend } = renderTray();
    expand();
    act(() => button("Insert into chat").click());
    expect(onSend).not.toHaveBeenCalled();
    expect(onInsert).toHaveBeenCalledWith(
      expect.stringContaining("⁂ redline — review of src/app.ts (1 note)"),
    );
    expect(listReviewNotes(scope)[0].status).toBe("sent");
  });

  it("lists notes with their kind, location, quote, and status", () => {
    addReviewNote(scope, change);
    const sent = addReviewNote(scope, question)!;
    act(() => {
      updateReviewNote(scope, sent.id, { status: "sent" });
    });
    renderTray();
    expand();
    const rows = container.querySelectorAll("[data-review-note]");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("✎");
    expect(rows[0].textContent).toContain("src/app.ts · L4");
    expect(rows[0].textContent).toContain("let total = 0;");
    expect(rows[0].textContent).toContain("Make this const.");
    expect(rows[1].getAttribute("data-status")).toBe("sent");
    expect(rows[1].textContent).toContain("Sent");
  });

  it("edits a note in place", () => {
    addReviewNote(scope, change);
    renderTray();
    expand();
    act(() => button("Edit note").click());
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("Make this const.");
    act(() => {
      setTextarea(textarea, "Inline it instead.");
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[role="radio"][data-review-kind="comment"]')!
        .click(),
    );
    act(() => button(/Save$/).click());
    expect(listReviewNotes(scope)[0]).toMatchObject({
      kind: "comment",
      note: "Inline it instead.",
    });
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("resolves, reopens, and deletes notes, and clears resolved ones", () => {
    const first = addReviewNote(scope, change)!;
    addReviewNote(scope, question);
    renderTray();
    expand();

    act(() => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Mark resolved"]')][0].click());
    expect(listReviewNotes(scope)[0].status).toBe("resolved");
    act(() => button("Mark unresolved").click());
    expect(listReviewNotes(scope)[0].status).toBe("open");

    act(() => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Mark resolved"]')][0].click());
    act(() => button("Clear resolved").click());
    expect(listReviewNotes(scope).some((note) => note.id === first.id)).toBe(false);

    act(() => button("Delete note").click());
    expect(listReviewNotes(scope)).toEqual([]);
    expect(container.querySelector("[data-redline-review]")).toBeNull();
  });

  it("reopens a sent note so it goes out with the next batch", () => {
    const sent = addReviewNote(scope, change)!;
    updateReviewNote(scope, sent.id, { status: "sent" });
    renderTray();
    expand();
    act(() => button("Reopen").click());
    expect(listReviewNotes(scope)[0].status).toBe("open");
    expect(button(/Submit Review/).disabled).toBe(false);
  });

  it("opens its drawer when the header badge asks for its scope", () => {
    addReviewNote(scope, change);
    renderTray();
    expect(container.querySelector("[data-review-note]")).toBeNull();
    act(() => requestOpenReviewDrawer(projectReviewScope("/work/other")));
    expect(container.querySelector("[data-review-note]")).toBeNull();
    act(() => requestOpenReviewDrawer(scope));
    expect(container.querySelector("[data-review-note]")).not.toBeNull();
  });
});

describe("RedlineReviewBadge", () => {
  it("shows the open count and opens the drawer", () => {
    act(() => root.render(createElement(RedlineReviewBadge, { scope })));
    expect(container.querySelector("[data-redline-badge]")).toBeNull();

    act(() => {
      addReviewNote(scope, change);
      addReviewNote(scope, question);
    });
    const badge = container.querySelector<HTMLButtonElement>("[data-redline-badge]")!;
    expect(badge.textContent).toContain("2");
    expect(badge.getAttribute("aria-label")).toBe("2 open review notes");

    const opened = vi.fn();
    const onOpen = (event: Event) =>
      opened((event as CustomEvent<{ scope: string }>).detail.scope);
    window.addEventListener(OPEN_REVIEW_DRAWER_EVENT, onOpen);
    act(() => badge.click());
    window.removeEventListener(OPEN_REVIEW_DRAWER_EVENT, onOpen);
    expect(opened).toHaveBeenCalledWith(scope);

    act(() => {
      for (const note of listReviewNotes(scope))
        updateReviewNote(scope, note.id, { status: "sent" });
    });
    expect(container.querySelector("[data-redline-badge]")).toBeNull();
  });
});
