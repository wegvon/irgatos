// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createManualArtifact,
  guessFormat,
  irgatArtifactScope,
  isArtifactPinned,
  listPinnedArtifacts,
  MAX_PINNED_CONTENT,
  MAX_PINNED_PER_SCOPE,
  PinnedArtifactTooLargeError,
  pinArtifact,
  projectArtifactScope,
  resetPinnedArtifactsCache,
  subscribePinnedArtifacts,
  unpinArtifact,
} from "./pinnedArtifacts";
import type { WorkspaceArtifact } from "./workspaceArtifacts";

const KEY = "irgat.pinnedArtifacts.v1";
const scope = projectArtifactScope("/work/app");

const snippet: WorkspaceArtifact = {
  id: "snippet:s1:b1:0",
  origin: "snippet",
  format: "code",
  language: "ts",
  title: "server.ts",
  content: "export const port = 4000;",
  sessionId: "s1",
  sessionTitle: "Build the dashboard",
  createdAt: 100,
};

const file: WorkspaceArtifact = {
  id: "file:/work/app/src/index.ts",
  origin: "file",
  format: "code",
  language: "ts",
  title: "index.ts",
  path: "/work/app/src/index.ts",
  cwd: "/work/app",
  change: "modified",
  createdAt: 200,
};

beforeEach(() => {
  localStorage.clear();
  resetPinnedArtifactsCache();
});
afterEach(() => {
  localStorage.clear();
  resetPinnedArtifactsCache();
});

describe("scopes", () => {
  it("keys project and Irgat scopes apart", () => {
    expect(projectArtifactScope("/work/app")).toMatch(/^project:/);
    expect(projectArtifactScope("/work/app/")).toBe(projectArtifactScope("/work/app"));
    expect(irgatArtifactScope("i-1")).toBe("irgat:i-1");
  });
});

describe("pinArtifact", () => {
  it("snapshots text, marks the copy pinned and persists it", () => {
    const pinned = pinArtifact(scope, snippet);
    expect(pinned).toMatchObject({ pinned: true, scope, content: snippet.content });
    expect(listPinnedArtifacts(scope).map((item) => item.id)).toEqual([snippet.id]);
    expect(isArtifactPinned(scope, snippet.id)).toBe(true);
    expect(isArtifactPinned(irgatArtifactScope("other"), snippet.id)).toBe(false);

    resetPinnedArtifactsCache();
    expect(listPinnedArtifacts(scope)[0]).toMatchObject({
      id: snippet.id,
      title: "server.ts",
      pinned: true,
      sessionTitle: "Build the dashboard",
    });
  });

  it("uses the shown content over the derived one", () => {
    expect(pinArtifact(scope, snippet, "edited text").content).toBe("edited text");
  });

  it("keeps a file's path and reads it live instead of snapshotting", () => {
    const pinned = pinArtifact(scope, file, "contents on disk");
    expect(pinned.path).toBe(file.path);
    expect(pinned.content).toBeUndefined();
  });

  it("stamps a missing creation time", () => {
    expect(pinArtifact(scope, { ...snippet, createdAt: 0 }, undefined, 999).createdAt).toBe(999);
  });

  it("moves a re-pinned artifact to the top without duplicating it", () => {
    pinArtifact(scope, snippet);
    pinArtifact(scope, file);
    pinArtifact(scope, { ...snippet, title: "renamed.ts" });
    const list = listPinnedArtifacts(scope);
    expect(list.map((item) => item.id)).toEqual([snippet.id, file.id]);
    expect(list[0].title).toBe("renamed.ts");
  });

  it("refuses content that would crowd localStorage", () => {
    const huge = "x".repeat(MAX_PINNED_CONTENT + 1);
    expect(() => pinArtifact(scope, snippet, huge)).toThrow(PinnedArtifactTooLargeError);
    expect(() =>
      pinArtifact(scope, { ...snippet, origin: "image", format: "image", imageData: huge }),
    ).toThrow(PinnedArtifactTooLargeError);
    expect(listPinnedArtifacts(scope)).toEqual([]);
  });

  it("caps each scope", () => {
    for (let index = 0; index < MAX_PINNED_PER_SCOPE + 5; index += 1)
      pinArtifact(scope, { ...snippet, id: `snippet:${index}` });
    const list = listPinnedArtifacts(scope);
    expect(list).toHaveLength(MAX_PINNED_PER_SCOPE);
    expect(list[0].id).toBe(`snippet:${MAX_PINNED_PER_SCOPE + 4}`);
  });

  it("still holds the pin for this run when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    pinArtifact(scope, snippet);
    expect(isArtifactPinned(scope, snippet.id)).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("unpinArtifact", () => {
  it("removes the item and drops an emptied scope", () => {
    pinArtifact(scope, snippet);
    pinArtifact(scope, file);
    unpinArtifact(scope, snippet.id);
    expect(listPinnedArtifacts(scope).map((item) => item.id)).toEqual([file.id]);
    unpinArtifact(scope, file.id);
    expect(listPinnedArtifacts(scope)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({});
  });

  it("ignores ids that are not pinned", () => {
    const listener = vi.fn();
    const stop = subscribePinnedArtifacts(listener);
    unpinArtifact(scope, "missing");
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

describe("stored data", () => {
  it("drops malformed entries and unknown fields", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        [scope]: [
          null,
          { id: "", title: "no id", format: "code" },
          { id: "a", title: "bad format", format: "video" },
          {
            id: "b",
            title: "kept.md",
            format: "markdown",
            origin: "weird",
            content: "# Hi",
            change: "renamed",
            excerpt: ["one", 2, "three"],
            createdAt: "yesterday",
            extra: true,
          },
        ],
        broken: "not a list",
      }),
    );
    const list = listPinnedArtifacts(scope);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: "b",
      origin: "manual",
      format: "markdown",
      title: "kept.md",
      content: "# Hi",
      createdAt: 0,
      pinned: true,
      scope,
      excerpt: ["one", "three"],
    });
    expect(listPinnedArtifacts("broken")).toEqual([]);
  });

  it("survives unreadable JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(listPinnedArtifacts(scope)).toEqual([]);
  });

  it("notifies subscribers on change and on another window's write", () => {
    const listener = vi.fn();
    const stop = subscribePinnedArtifacts(listener);
    pinArtifact(scope, snippet);
    expect(listener).toHaveBeenCalledTimes(1);

    localStorage.setItem(KEY, JSON.stringify({ [scope]: [] }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listPinnedArtifacts(scope)).toEqual([]);

    stop();
    pinArtifact(scope, file);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("createManualArtifact", () => {
  it("pins a typed artifact with a guessed format and language", () => {
    const created = createManualArtifact(
      scope,
      { title: "  release-checklist.md ", content: "- ship\r\n- tag" },
      1234,
    );
    expect(created).toMatchObject({
      origin: "manual",
      format: "markdown",
      language: "markdown",
      title: "release-checklist.md",
      content: "- ship\n- tag",
      createdAt: 1234,
      pinned: true,
      scope,
    });
    expect(created.id).toMatch(/^manual:/);
    expect(listPinnedArtifacts(scope)[0].id).toBe(created.id);
  });

  it("names untitled artifacts and picks a code language from the title", () => {
    expect(createManualArtifact(scope, { title: " ", content: "x = 1" }).title).toBe(
      "Untitled artifact",
    );
    expect(createManualArtifact(scope, { title: "query.sql", content: "select 1" })).toMatchObject({
      format: "code",
      language: "sql",
    });
    expect(
      createManualArtifact(scope, { title: "logo", content: '<svg viewBox="0 0 1 1"></svg>' }),
    ).toMatchObject({ format: "svg", language: "xml" });
  });

  it("respects an explicit format and language", () => {
    expect(
      createManualArtifact(scope, {
        title: "notes",
        content: "plain",
        format: "code",
        language: "python",
      }),
    ).toMatchObject({ format: "code", language: "python" });
  });
});

describe("guessFormat", () => {
  it.each([
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', "", "svg"],
    ["<!DOCTYPE html><html><body>Hi</body></html>", "", "html"],
    ["<html lang=\"en\"></html>", "", "html"],
    ["flowchart TD\n  A --> B", "", "mermaid"],
    ["sequenceDiagram\n  A->>B: hi", "", "mermaid"],
    ["# Title\n\nBody", "", "markdown"],
    ["- one\n- two", "", "markdown"],
    ["const a = 1;", "", "code"],
    ["anything", "page.html", "html"],
    ["anything", "diagram.mmd", "mermaid"],
    ["# looks like markdown", "script.py", "markdown"],
  ] as const)("%j titled %j is %s", (content, title, expected) => {
    expect(guessFormat(content, title)).toBe(expected);
  });
});
