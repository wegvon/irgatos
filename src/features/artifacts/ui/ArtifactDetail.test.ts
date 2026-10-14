// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { save } from "@tauri-apps/plugin-dialog";
import { copyText } from "../../../platform/tauri/clipboard";
import { readTextFile, writeTextFile } from "../../../platform/tauri/fs";
import type { Note } from "../../notes";
import { saveArtifactAsNote, type SavedArtifactNote } from "../model/artifactActions";
import { getRegisteredArtifact } from "../model/artifactRegistry";
import { listPinnedArtifacts, resetPinnedArtifactsCache } from "../model/pinnedArtifacts";
import type { WorkspaceArtifact } from "../model/workspaceArtifacts";
import { ArtifactHostContext, type ArtifactHost } from "./artifactContext";
import { ArtifactDetail } from "./ArtifactDetail";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../../platform/tauri/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  readTextFile: vi.fn(),
  readBinaryFile: vi.fn(),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  copyPath: vi.fn(),
  renamePath: vi.fn(),
  copyFileToClipboard: vi.fn(),
}));
vi.mock("../model/artifactActions", () => ({ saveArtifactAsNote: vi.fn() }));
vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", { "data-agent-markdown": "" }, text),
  MarkdownPreview: ({ text }: { text: string }) =>
    createElement("div", { "data-markdown-preview": "" }, text),
}));
vi.mock("../../sessions/ui/HighlightedCodeBlock", () => ({
  HighlightedCodeBlock: ({ code, language }: { code: string; language: string }) =>
    createElement("pre", { "data-language": language }, code),
}));

const page: WorkspaceArtifact = {
  id: "snippet:s1:b2:0",
  origin: "snippet",
  format: "html",
  language: "html",
  title: "Landing page",
  content: "<h1>Launch</h1><script>document.title = 'x'</script>",
  sessionId: "s1",
  sessionTitle: "Build the site",
  createdAt: Date.now() - 60_000,
};
const graphic: WorkspaceArtifact = {
  ...page,
  id: "snippet:s1:b3:0",
  format: "svg",
  language: "xml",
  title: "logo.svg",
  content: '<svg viewBox="0 0 10 10"><circle r="4"/></svg>',
};
const doc: WorkspaceArtifact = {
  ...page,
  id: "document:s1:b4",
  origin: "document",
  format: "markdown",
  language: "markdown",
  title: "Rollout plan",
  content: "# Rollout\n\n- Ship",
};
const snippet: WorkspaceArtifact = {
  ...page,
  id: "snippet:s1:b5:0",
  format: "code",
  language: "sql",
  title: "migrate.sql",
  content: "select 1;",
};
const written: WorkspaceArtifact = {
  id: "file:/work/app/src/server.ts",
  origin: "file",
  format: "code",
  language: "ts",
  title: "server.ts",
  path: "/work/app/src/server.ts",
  cwd: "/work/app",
  change: "modified",
  sessionId: "s1",
  sessionTitle: "Build the API",
  excerpt: ["export const port = 3000;"],
  createdAt: Date.now() - 60_000,
};

let root: Root;
let container: HTMLDivElement;

function host(overrides: Partial<ArtifactHost> = {}): ArtifactHost {
  return {
    chatTargets: () => [
      { sessionId: "s1", title: "Build the site", active: true },
      { sessionId: "s9", title: "Fix the tests" },
    ],
    addToChat: vi.fn(),
    openFile: vi.fn(),
    revealInExplorer: vi.fn(),
    openNotes: vi.fn(),
    defaultScope: "project:/work/app",
    ...overrides,
  };
}

async function render(artifact: WorkspaceArtifact, value: ArtifactHost = host()) {
  await act(async () =>
    root.render(
      createElement(
        ArtifactHostContext.Provider,
        { value },
        createElement(ArtifactDetail, { artifact }),
      ),
    ),
  );
  return value;
}

const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) =>
      entry.textContent?.trim() === label || entry.getAttribute("aria-label") === label,
  );
const tab = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (entry) => entry.textContent === label,
  )!;
const status = () => container.querySelector('[role="toolbar"] [aria-live]')!;

function note(id: string): Note {
  return { id, slug: id, title: "t", body: "", tags: [], slugPending: false, createdAt: 1, updatedAt: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  resetPinnedArtifactsCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ArtifactDetail preview", () => {
  it("shows an HTML page in a frame that may only run scripts", async () => {
    await render(page);
    expect(container.querySelector("h2")?.textContent).toBe("Landing page");
    expect(container.querySelector("[data-artifact-kind]")?.textContent).toBe("HTML");
    expect(tab("Preview").getAttribute("aria-selected")).toBe("true");
    const frame = container.querySelector<HTMLIFrameElement>("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Launch</h1>");
    expect(frame.getAttribute("title")).toBe("Landing page preview");
  });

  it("switches to the source and back, also with the arrow keys", async () => {
    await render(page);
    act(() => tab("Source").click());
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[data-artifact-source] pre")?.textContent).toBe(page.content);
    expect(container.querySelector("[data-artifact-body]")?.getAttribute("data-artifact-body")).toBe(
      "source",
    );
    act(() => {
      tab("Source").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("centers an SVG in the same sandbox", async () => {
    await render(graphic);
    const frame = container.querySelector<HTMLIFrameElement>("iframe")!;
    expect(frame.getAttribute("data-artifact-preview-frame")).toBe("svg");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("<circle");
  });

  it("renders Markdown and keeps the raw text a tab away", async () => {
    await render(doc);
    expect(container.querySelector("[data-markdown-preview]")?.textContent).toBe(doc.content);
    act(() => tab("Source").click());
    expect(container.querySelector("[data-artifact-source] pre")?.getAttribute("data-language")).toBe(
      "markdown",
    );
  });

  it("shows code highlighted with no preview tabs", async () => {
    await render(snippet);
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector("[data-artifact-source] pre")?.getAttribute("data-language")).toBe(
      "sql",
    );
  });
});

describe("ArtifactDetail files", () => {
  it("reads a written file live and offers the editor and Explorer", async () => {
    vi.mocked(readTextFile).mockResolvedValue("export const port = 4000;");
    const value = await render(written);
    expect(readTextFile).toHaveBeenCalledWith(written.path);
    expect(container.querySelector("[data-artifact-source] pre")?.textContent).toBe(
      "export const port = 4000;",
    );
    expect(container.textContent).toContain("src/server.ts");
    expect(container.textContent).toContain("Modified · in “Build the API”");
    act(() => button("Open")!.click());
    expect(value.openFile).toHaveBeenCalledWith(written.path);
    act(() => button("Explorer")!.click());
    expect(value.revealInExplorer).toHaveBeenCalledWith(written.path);
  });

  it("falls back to what the tool call captured and retries", async () => {
    vi.mocked(readTextFile).mockRejectedValueOnce(new Error("No such file"));
    await render(written);
    expect(container.textContent).toContain("Could not read the file (No such file)");
    expect(container.querySelector("[data-artifact-source] pre")?.textContent).toBe(
      "export const port = 3000;",
    );
    vi.mocked(readTextFile).mockResolvedValueOnce("export const port = 5000;");
    await act(async () => button("Retry")!.click());
    expect(container.querySelector("[data-artifact-source] pre")?.textContent).toBe(
      "export const port = 5000;",
    );
  });

  it("explains a file that cannot be read and has nothing to fall back to", async () => {
    vi.mocked(readTextFile).mockRejectedValue(new Error("Permission denied"));
    await render({ ...written, excerpt: undefined });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This file could not be read: Permission denied",
    );
    expect(button("Try again")).toBeDefined();
    expect(button("Copy")!.disabled).toBe(true);
  });
});

describe("ArtifactDetail actions", () => {
  it("copies the text and says so", async () => {
    await render(snippet);
    await act(async () => button("Copy")!.click());
    expect(copyText).toHaveBeenCalledWith("select 1;");
    expect(status().textContent).toBe("Copied to clipboard");
  });

  it("reports a failed copy", async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error("denied"));
    await render(snippet);
    await act(async () => button("Copy")!.click());
    const alert = container.querySelector('[role="toolbar"] [role="alert"]')!;
    expect(alert.textContent).toBe("Could not copy: denied");
  });

  it("clears the copy confirmation after a moment", async () => {
    vi.useFakeTimers();
    await render(snippet);
    await act(async () => button("Copy")!.click());
    expect(status().textContent).toBe("Copied to clipboard");
    act(() => vi.advanceTimersByTime(2500));
    expect(status().textContent).toBe("");
  });

  it("adds the artifact to the active chat", async () => {
    const value = await render(snippet);
    act(() => button("Add to Chat")!.click());
    expect(value.addToChat).toHaveBeenCalledTimes(1);
    const [text, sessionId] = vi.mocked(value.addToChat).mock.calls[0];
    expect(text).toContain("migrate.sql");
    expect(text).toContain("```sql\nselect 1;\n```");
    expect(sessionId).toBeUndefined();
    expect(status().textContent).toBe("Added to chat");
  });

  it("picks another chat from the menu", async () => {
    const value = await render(snippet);
    const picker = button("Pick a chat")!;
    expect(picker.getAttribute("aria-haspopup")).toBe("menu");
    act(() => picker.click());
    expect(picker.getAttribute("aria-expanded")).toBe("true");
    const menu = document.body.querySelector<HTMLElement>('[role="menu"][aria-label="Add to chat"]')!;
    const items = [...menu.querySelectorAll<HTMLButtonElement>("button")];
    expect(items.map((item) => item.textContent)).toEqual(["Build the site", "Fix the tests"]);
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    act(() => items[1].click());
    expect(vi.mocked(value.addToChat).mock.calls[0][1]).toBe("s9");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it("says when there is no chat to pick", async () => {
    await render(snippet, host({ chatTargets: () => [] }));
    act(() => button("Pick a chat")!.click());
    const item = document.body.querySelector<HTMLButtonElement>('[role="menu"] button')!;
    expect(item.textContent).toBe("No open chats");
    expect(item.disabled).toBe(true);
  });

  it("saves a note once however often it is clicked, then opens Notes", async () => {
    let finish!: (value: SavedArtifactNote) => void;
    vi.mocked(saveArtifactAsNote).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const value = await render(snippet);
    const save = button("Save as Note")!;
    act(() => {
      save.click();
      save.click();
    });
    act(() => save.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(saveArtifactAsNote).toHaveBeenCalledTimes(1);
    expect(saveArtifactAsNote).toHaveBeenCalledWith(snippet, "select 1;");
    expect(save.textContent).toBe("Saving…");
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-busy")).toBe("true");

    await act(async () => finish({ note: note("n1"), created: true }));
    expect(save.textContent).toBe("Saved to Notes");
    expect(status().textContent).toBe("Saved to Notes");

    act(() => save.click());
    expect(value.openNotes).toHaveBeenCalledTimes(1);
    expect(saveArtifactAsNote).toHaveBeenCalledTimes(1);
  });

  it("says when the note already exists", async () => {
    vi.mocked(saveArtifactAsNote).mockResolvedValue({ note: note("n1"), created: false });
    await render(snippet);
    await act(async () => button("Save as Note")!.click());
    expect(status().textContent).toBe("Already in Notes");
  });

  it("lets a failed note save be retried", async () => {
    vi.mocked(saveArtifactAsNote)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ note: note("n1"), created: true });
    await render(snippet);
    await act(async () => button("Save as Note")!.click());
    expect(container.querySelector('[role="toolbar"] [role="alert"]')?.textContent).toBe(
      "Could not save the note: offline",
    );
    await act(async () => button("Save as Note")!.click());
    expect(saveArtifactAsNote).toHaveBeenCalledTimes(2);
    expect(button("Saved to Notes")).toBeDefined();
  });

  it("saves a copy to a chosen file", async () => {
    vi.mocked(save).mockResolvedValue("/Users/me/Desktop/migrate.sql");
    await render(snippet);
    await act(async () => button("Save to File…")!.click());
    expect(save).toHaveBeenCalledWith({ defaultPath: "migrate.sql", title: "Save artifact" });
    expect(writeTextFile).toHaveBeenCalledWith("/Users/me/Desktop/migrate.sql", "select 1;");
    expect(status().textContent).toBe("Saved migrate.sql");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(save).mockResolvedValue(null);
    await render(snippet);
    await act(async () => button("Save to File…")!.click());
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(status().textContent).toBe("");
  });

  it("pins to the project and unpins again", async () => {
    await render(snippet);
    const pin = button("Pin")!;
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    act(() => pin.click());
    expect(status().textContent).toBe("Pinned to this project's artifacts");
    const [kept] = listPinnedArtifacts("project:/work/app");
    expect(kept).toMatchObject({ id: snippet.id, content: "select 1;", pinned: true });
    expect(getRegisteredArtifact(snippet.id)?.pinned).toBe(true);

    await render(kept);
    act(() => button("Unpin")!.click());
    expect(listPinnedArtifacts("project:/work/app")).toEqual([]);
    expect(getRegisteredArtifact(snippet.id)?.pinned).toBeUndefined();
    expect(status().textContent).toBe("Unpinned");
  });

  it("pins to an Irgat's list when that is the scope", async () => {
    await render({ ...snippet, scope: "irgat:i1" });
    act(() => button("Pin")!.click());
    expect(status().textContent).toBe("Pinned to this Irgat's artifacts");
    expect(listPinnedArtifacts("irgat:i1")).toHaveLength(1);
  });

  it("hides Pin where there is no list to keep it in", async () => {
    await render(snippet, host({ defaultScope: undefined }));
    expect(button("Pin")).toBeUndefined();
  });
});
