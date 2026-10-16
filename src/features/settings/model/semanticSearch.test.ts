import { describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  claimCodeSearchHint,
  codeSearchContext,
  indexableProjects,
  semanticIndexSummary,
  type SemanticIndexStatus,
} from "./semanticSearch";

const status = (patch: Partial<SemanticIndexStatus>): SemanticIndexStatus => ({
  root: "/repo",
  state: "none",
  files: 0,
  chunks: 0,
  progress: null,
  updatedAt: null,
  lastError: null,
  ...patch,
});

describe("semantic index summary", () => {
  it("describes each state", () => {
    expect(semanticIndexSummary(status({}))).toBe("Not indexed");
    expect(
      semanticIndexSummary(
        status({ state: "complete", files: 1607, chunks: 9714 }),
      ),
    ).toBe("Indexed · 1,607 files, 9,714 chunks");
    expect(semanticIndexSummary(status({ state: "partial", files: 1 }))).toBe(
      "Partial · 1 file",
    );
    expect(
      semanticIndexSummary(
        status({ state: "partial", files: 3, lastError: "offline" }),
      ),
    ).toBe("Partial · 3 files · stopped: offline");
  });

  it("shows indexing progress by chunks and files", () => {
    expect(
      semanticIndexSummary(
        status({
          state: "indexing",
          files: 10,
          progress: {
            totalFiles: 40,
            doneFiles: 12,
            totalChunks: 200,
            doneChunks: 51,
            removedFiles: 0,
          },
        }),
      ),
    ).toBe("Indexing 25% · 12 of 40 changed files");
    expect(
      semanticIndexSummary(
        status({
          state: "indexing",
          files: 10,
          progress: {
            totalFiles: 0,
            doneFiles: 0,
            totalChunks: 0,
            doneChunks: 0,
            removedFiles: 0,
          },
        }),
      ),
    ).toBe("Checking for changes · 10 files indexed");
  });
});

describe("indexable projects", () => {
  it("lists the open project first and each project once", () => {
    expect(
      indexableProjects("/Users/me/code/a", [
        { path: "/Users/me/code/b" },
        { path: "/Users/me/code/a" },
      ]),
    ).toEqual(["/Users/me/code/a", "/Users/me/code/b"]);
    expect(indexableProjects(undefined, undefined)).toEqual([]);
  });
});

describe("code search hint", () => {
  it("names the command and the JSON it takes", () => {
    const hint = codeSearchContext("/Apps/irgat app");
    expect(hint).toContain("/Apps/irgat app code.search --json");
    expect(hint).toContain('"query"');
    expect(hint.startsWith("<code_search>")).toBe(true);
  });
});

describe("code search hint once per session", () => {
  it("is claimed once, and only where an index exists", async () => {
    invoke.mockResolvedValue(false);
    expect(await claimCodeSearchHint("s1", "/repo")).toBe(false);
    invoke.mockResolvedValue(true);
    expect(await claimCodeSearchHint("s1", "/repo")).toBe(true);
    expect(await claimCodeSearchHint("s1", "/repo")).toBe(false);
    expect(await claimCodeSearchHint("s2", "/repo")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("semantic_index_available", {
      cwd: "/repo",
    });
    invoke.mockRejectedValue(new Error("no app"));
    expect(await claimCodeSearchHint("s3", "/repo")).toBe(false);
  });
});
