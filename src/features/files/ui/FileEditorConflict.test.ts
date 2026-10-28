// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { Storage } from "happy-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILE_EDITOR_AUTOSAVE_DELAY_MS, FileEditor, saveConflicts } from "./FileEditor";
import { saveAutosave } from "../../settings/model/settings";

const disk = vi.hoisted(() => ({ content: "", writes: [] as string[] }));
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === "read_text_file") return disk.content;
    if (command === "write_text_file") {
      disk.content = args?.content as string;
      disk.writes.push(disk.content);
      return null;
    }
    if (command === "stat_files") return [];
    if (command === "git_diff_files") return { files: [] };
    throw new Error(`Unexpected command: ${command}`);
  }),
);
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("../../../shared/lib/format", () => ({ formatText: async () => null }));

describe("saving over a file an agent changed", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", new Storage());
    saveAutosave(true);
    disk.content = "alpha\n";
    disk.writes = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function openAndEdit() {
    await act(async () =>
      root.render(
        createElement(FileEditor, {
          path: "/repo/notes.txt",
          cwd: "/repo",
          active: true,
          onDirtyChange: () => {},
        }),
      ),
    );
    await act(async () =>
      vi.waitFor(() =>
        expect(container.querySelector(".cm-editor")).not.toBeNull(),
      ),
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    await act(async () => {
      view.dispatch({ changes: { from: 0, insert: "mine " } });
    });
    // The agent writes while the user's edit is unsaved.
    disk.content = "agent\n";
    return view;
  }

  const save = (view: EditorView) =>
    act(async () => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });

  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (entry) => entry.textContent === label,
    )!;

  it("a manual save does not silently replace the agent's change", async () => {
    const view = await openAndEdit();
    await save(view);
    expect(disk.content).toBe("agent\n");
    expect(disk.writes).toEqual([]);
    expect(container.textContent).toContain("changed on disk");
  });

  it("autosave waits too", async () => {
    await openAndEdit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FILE_EDITOR_AUTOSAVE_DELAY_MS * 3);
    });
    expect(disk.writes).toEqual([]);
  });

  it("compares, then overwrites only when asked", async () => {
    const view = await openAndEdit();
    await save(view);
    await act(async () => button("Compare").click());
    expect(container.textContent).toContain("On disk → your edits");
    await act(async () => {
      button("Overwrite").click();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () =>
      vi.waitFor(() => expect(disk.content).toBe("mine alpha\n")),
    );
    expect(container.textContent).not.toContain("changed on disk");
  });

  it("reloads the agent's version and drops the edit", async () => {
    const view = await openAndEdit();
    await save(view);
    await act(async () => {
      button("Reload from disk").click();
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () =>
      vi.waitFor(() => {
        const reloaded = EditorView.findFromDOM(
          container.querySelector<HTMLElement>(".cm-editor")!,
        )!;
        expect(reloaded.state.doc.toString()).toBe("agent\n");
      }),
    );
    expect(disk.writes).toEqual([]);
  });
});

it("only content that differs from both versions is a conflict", () => {
  expect(saveConflicts("agent", "loaded", "mine")).toBe(true);
  expect(saveConflicts("loaded", "loaded", "mine")).toBe(false);
  expect(saveConflicts("mine", "loaded", "mine")).toBe(false);
  expect(saveConflicts(null, "loaded", "mine")).toBe(false);
});
