// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, open } = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));

import {
  attachmentPathText,
  attachmentsFromPaths,
  MAX_FOLDER_NAMES,
  persistableAttachment,
  pickFolderAttachments,
  promptBlocks,
} from "./attachments";

type Entry = { name: string; isDir: boolean; ignored?: boolean };

function folderAt(path: string, entries: Entry[]) {
  invoke.mockImplementation(
    async (command: string, args: { paths?: string[]; path?: string }) => {
      if (command === "inspect_paths")
        return (args.paths ?? []).map((item) => ({
          path: item,
          name: item.split("/").pop(),
          size: 0,
          isDir: true,
        }));
      if (command === "list_dir" && args.path === path)
        return entries.map((entry) => ({
          ignored: false,
          ...entry,
          path: `${path}/${entry.name}`,
        }));
      throw new Error(`unexpected ${command}`);
    },
  );
}

beforeEach(() => {
  invoke.mockReset();
  open.mockReset();
});

describe("folder attachments", () => {
  it("summarizes the top level, leaving out version control, dependencies and build output", async () => {
    folderAt("/work/app", [
      { name: ".git", isDir: true, ignored: true },
      { name: "node_modules", isDir: true },
      { name: "target", isDir: true },
      { name: "dist", isDir: true },
      { name: "secrets.env", isDir: false, ignored: true },
      { name: "README.md", isDir: false },
      { name: "src", isDir: true },
      { name: "docs", isDir: true },
      { name: "Thumbs.db", isDir: false },
    ]);
    const [file] = await attachmentsFromPaths(["/work/app"]);
    expect(file).toMatchObject({
      name: "app",
      mimeType: "inode/directory",
      path: "/work/app",
      folder: { names: ["docs/", "src/", "README.md"], total: 3, skipped: 5 },
    });
    expect(attachmentPathText(file)).toBe(
      [
        'Attached folder (list or read the files inside from this path): "/work/app"',
        "Top level (3 items): docs/, src/, README.md",
        "Left out: 5 version control, dependency, build or gitignored entries. Skip those unless the task needs them.",
      ].join("\n"),
    );
  });

  it("lists only the first names of a huge folder and counts the rest", async () => {
    const entries = Array.from({ length: 5000 }, (_, i) => ({
      name: `file-${i}.txt`,
      isDir: false,
    }));
    folderAt("/work/huge", entries);
    const [file] = await attachmentsFromPaths(["/work/huge"]);
    expect(file.folder?.names).toHaveLength(MAX_FOLDER_NAMES);
    expect(file.folder?.total).toBe(5000);
    const text = attachmentPathText(file);
    expect(text).toContain("Top level (5000 items): file-0.txt, file-1.txt");
    expect(text).toContain(`, and ${5000 - MAX_FOLDER_NAMES} more`);
    expect(text.length).toBeLessThan(2000);
    // One directory read: nothing inside the folder's subfolders is walked.
    expect(
      invoke.mock.calls.filter(([command]) => command === "list_dir"),
    ).toHaveLength(1);
  });

  it("says when a folder holds nothing worth reading", async () => {
    folderAt("/work/empty", [{ name: "node_modules", isDir: true }]);
    const [file] = await attachmentsFromPaths(["/work/empty"]);
    expect(attachmentPathText(file)).toBe(
      [
        'Attached folder (list or read the files inside from this path): "/work/empty"',
        "Its top level holds nothing worth reading.",
        "Left out: 1 version control, dependency, build or gitignored entry. Skip those unless the task needs them.",
      ].join("\n"),
    );
  });

  it("still attaches the folder by path when it cannot be listed", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "inspect_paths")
        return [{ path: "/locked", name: "locked", size: 0, isDir: true }];
      throw new Error("permission denied");
    });
    const [file] = await attachmentsFromPaths(["/locked"]);
    expect(file.folder).toBeUndefined();
    expect(promptBlocks("Read it", [file])).toEqual([
      { type: "text", text: "Read it" },
      {
        type: "text",
        text: 'Attached folder (list or read the files inside from this path): "/locked"',
      },
    ]);
  });

  it("keeps the summary when the message is saved", async () => {
    folderAt("/work/app", [{ name: "src", isDir: true }]);
    const [file] = await attachmentsFromPaths(["/work/app"]);
    expect(persistableAttachment(file).folder).toEqual({
      names: ["src/"],
      total: 1,
      skipped: 0,
    });
  });

  it("picks folders from the system dialog", async () => {
    open.mockResolvedValue(["/work/app"]);
    folderAt("/work/app", [{ name: "src", isDir: true }]);
    const files = await pickFolderAttachments();
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: true,
      title: "Attach folders",
    });
    expect(files.map((file) => file.path)).toEqual(["/work/app"]);
  });

  it("attaches nothing when the dialog is cancelled", async () => {
    open.mockResolvedValue(null);
    expect(await pickFolderAttachments()).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
