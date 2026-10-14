import { describe, expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  artifactChatText,
  artifactFileName,
  artifactKindLabel,
  artifactMarkdown,
  artifactNoteBody,
  classifySnippet,
  extractSessionArtifacts,
  fenceFor,
  filterArtifacts,
  formatArtifactTime,
  mergeArtifacts,
  parseFenceInfo,
  resolveArtifactPath,
  scanFences,
  snippetArtifact,
  snippetArtifactId,
  sortArtifacts,
  type WorkspaceArtifact,
} from "./workspaceArtifacts";

const lines = (count: number, prefix = "line") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");

const fence = (info: string, code: string) => "```" + info + "\n" + code + "\n```";

function session(blocks: Block[], extra: Partial<{ worktreeCwd: string }> = {}) {
  return { id: "s1", title: "Build the dashboard", cwd: "/work/app", blocks, ...extra };
}

function user(id: string, startedAt: number, text = "go"): Block {
  return { id, role: "user", text, startedAt };
}

function assistant(id: string, text: string, extra: Partial<Block> = {}): Block {
  return { id, role: "assistant", text, ...extra };
}

function tool(id: string, extra: Partial<NonNullable<Block["tool"]>>, text = ""): Block {
  return { id, role: "tool", text, tool: { status: "completed", ...extra } };
}

describe("parseFenceInfo", () => {
  it("reads a bare language", () => {
    expect(parseFenceInfo("TypeScript")).toEqual({ language: "typescript" });
  });

  it("treats line-range references as citations of existing code", () => {
    expect(parseFenceInfo("12:40:src/app/App.tsx")).toMatchObject({
      citation: true,
      fileName: "App.tsx",
      filePath: "src/app/App.tsx",
      language: "tsx",
    });
  });

  it("reads lang:path, bare paths and title= metadata", () => {
    expect(parseFenceInfo("ts:src/lib/math.ts")).toMatchObject({
      language: "ts",
      fileName: "math.ts",
      filePath: "src/lib/math.ts",
    });
    expect(parseFenceInfo("scripts/deploy.sh")).toMatchObject({
      language: "bash",
      fileName: "deploy.sh",
    });
    expect(parseFenceInfo('python title="Data cleanup"')).toEqual({
      language: "python",
      title: "Data cleanup",
    });
    expect(parseFenceInfo("json filename=config.json")).toEqual({
      language: "json",
      fileName: "config.json",
      title: "config.json",
    });
  });
});

describe("scanFences", () => {
  it("finds backtick and tilde fences with their info strings", () => {
    const text = [
      "Intro",
      "```ts",
      "const a = 1;",
      "```",
      "~~~~ sql",
      "select 1;",
      "```",
      "still sql",
      "~~~~",
    ].join("\n");
    expect(scanFences(text)).toEqual([
      { info: "ts", code: "const a = 1;", complete: true },
      { info: " sql", code: "select 1;\n```\nstill sql", complete: true },
    ]);
  });

  it("marks a fence still streaming as incomplete", () => {
    expect(scanFences("```html\n<div>")).toEqual([
      { info: "html", code: "<div>", complete: false },
    ]);
  });
});

describe("classifySnippet", () => {
  it("always keeps diagrams and graphics", () => {
    expect(classifySnippet({ language: "mermaid", code: "graph TD; A-->B" })).toEqual({
      format: "mermaid",
      language: "mermaid",
    });
    expect(
      classifySnippet({ language: "svg", code: '<svg viewBox="0 0 1 1"></svg>' }),
    ).toEqual({ format: "svg", language: "xml" });
    expect(classifySnippet({ language: "xml", code: "<svg><circle/></svg>" })?.format).toBe(
      "svg",
    );
  });

  it("keeps HTML pages but not one-line fragments", () => {
    expect(classifySnippet({ language: "html", code: "<b>hi</b>" })).toBeNull();
    expect(
      classifySnippet({ language: "html", code: "<!doctype html><title>x</title>" })?.format,
    ).toBe("html");
    expect(
      classifySnippet({ language: "html", code: "<div>\n  <p>a</p>\n</div>" })?.format,
    ).toBe("html");
  });

  it("keeps code and Markdown from ten lines, or when named", () => {
    expect(classifySnippet({ language: "ts", code: lines(9) })).toBeNull();
    expect(classifySnippet({ language: "ts", code: lines(10) })).toEqual({
      format: "code",
      language: "ts",
    });
    expect(
      classifySnippet({ language: "sql", code: "select *\nfrom users", fileName: "users.sql" }),
    ).toEqual({ format: "code", language: "sql" });
    expect(classifySnippet({ language: "json", code: "{}", title: "Config" })).toBeNull();
    expect(classifySnippet({ language: "md", code: lines(3), title: "Notes" })?.format).toBe(
      "markdown",
    );
  });

  it("colors untagged named code by its file name", () => {
    expect(
      classifySnippet({ language: "", code: "a\nb", fileName: "main.py" }),
    ).toEqual({ format: "code", language: "python" });
    expect(classifySnippet({ language: "text", code: lines(12) })?.language).toBe("text");
  });

  it("ignores empty blocks", () => {
    expect(classifySnippet({ language: "mermaid", code: "   \n" })).toBeNull();
  });
});

describe("snippetArtifact", () => {
  const source = { sessionId: "s1", sessionTitle: "Chat", cwd: "/work", createdAt: 5 };

  it("titles blocks from their name, heading or kind", () => {
    expect(snippetArtifact(source, { info: "ts:src/a.ts", code: "a\nb" })?.title).toBe("a.ts");
    expect(
      snippetArtifact(source, {
        info: "html",
        code: "<html>\n<title>Pricing page</title>\n</html>",
      })?.title,
    ).toBe("Pricing page");
    expect(
      snippetArtifact(source, { info: "mermaid", code: "sequenceDiagram\nA->>B: hi" })?.title,
    ).toBe("Sequence diagram");
    expect(snippetArtifact(source, { info: "md", code: `# Rollout plan\n${lines(10)}` })?.title).toBe(
      "Rollout plan",
    );
    expect(snippetArtifact(source, { info: "go", code: lines(10) })?.title).toBe("Go snippet");
  });

  it("gives the same block the same id wherever it is seen", () => {
    const a = snippetArtifact(source, { info: "ts", code: `${lines(10)}\n` });
    const b = snippetArtifact(source, { info: "ts", code: lines(10) });
    expect(a?.id).toBe(b?.id);
    expect(a?.id).toBe(snippetArtifactId("s1", lines(10)));
  });

  it("skips citations of code that already exists", () => {
    expect(snippetArtifact(source, { info: "1:20:src/a.ts", code: lines(20) })).toBeNull();
  });
});

describe("extractSessionArtifacts", () => {
  it("collects files the tools wrote, resolved against the working copy", () => {
    const artifacts = extractSessionArtifacts(
      session([
        user("u1", 1000),
        tool(
          "t1",
          {
            kind: "edit",
            title: "Write src/index.html",
            preview: {
              kind: "write",
              path: "src/index.html",
              contentOnly: true,
              lines: [{ kind: "add", text: "<html>" }],
            },
          },
        ),
        tool("t2", { kind: "edit", title: "Edit README.md", paths: ["/work/app/README.md"] }),
        tool("t3", { kind: "edit", title: "Edit failed.ts", status: "failed", paths: ["failed.ts"] }),
        tool("t4", { kind: "delete", title: "Delete old.ts", paths: ["old.ts"] }),
        tool("t5", { kind: "read", title: "Read a.ts", paths: ["a.ts"] }),
      ]),
    );
    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "/work/app/README.md",
      "/work/app/src/index.html",
    ]);
    const page = artifacts[1];
    expect(page).toMatchObject({
      origin: "file",
      format: "html",
      change: "created",
      excerpt: ["<html>"],
      sessionId: "s1",
      sessionTitle: "Build the dashboard",
      createdAt: 1000,
    });
    expect(artifacts[0].change).toBe("modified");
  });

  it("uses the worktree a session works in", () => {
    const [artifact] = extractSessionArtifacts(
      session([tool("t1", { kind: "edit", paths: ["a.ts"] })], {
        worktreeCwd: "/work/app-feature",
      }),
    );
    expect(artifact.path).toBe("/work/app-feature/a.ts");
  });

  it("keeps substantial blocks and documents from finished replies only", () => {
    const report = `# Audit\n\n${lines(10)}\n\n## Findings\n\n${lines(10)}`;
    const artifacts = extractSessionArtifacts(
      session([
        user("u1", 10),
        assistant(
          "a1",
          [
            "Here is the diagram:",
            fence("mermaid", "graph TD\nA-->B"),
            fence("ts", "short()"),
            fence("12:40:src/app.ts", lines(30)),
            fence("sql", lines(12, "select")),
          ].join("\n\n"),
        ),
        user("u2", 20),
        assistant("a2", report),
        assistant("a3", fence("html", "<div>\n<p>x</p>\n</div>"), { streaming: true }),
      ]),
    );
    expect(artifacts.map((artifact) => [artifact.format, artifact.title])).toEqual([
      ["markdown", "Audit"],
      ["code", "SQL snippet"],
      ["mermaid", "Flowchart"],
    ]);
    expect(artifacts[0]).toMatchObject({ origin: "document", createdAt: 20 });
    expect(artifacts[2].createdAt).toBe(10);
  });

  it("files plans as documents", () => {
    const [plan] = extractSessionArtifacts(
      session([{ id: "p1", role: "plan", text: "# Migrate auth\n\n1. Do it" }]),
    );
    expect(plan).toMatchObject({ origin: "document", title: "Plan: Migrate auth" });
  });

  it("collects generated images, attachments and Irgat documents", () => {
    const artifacts = extractSessionArtifacts(
      session([
        {
          ...user("u1", 1),
          attachments: [
            {
              id: "shot",
              name: "button.png",
              mimeType: "image/png",
              kind: "image",
              size: 3,
              data: "AAA",
            },
            { id: "doc", name: "notes.txt", mimeType: "text/plain", kind: "text", size: 1 } as never,
          ],
        },
        {
          id: "img",
          role: "image",
          text: "",
          image: { path: "/tmp/cat.png", name: "cat.png", mimeType: "image/png", size: 9 },
        },
        assistant("a1", "Saved.", {
          artifactCards: [{ id: "doc-1", kind: "html", title: "Weekly report" }],
        }),
      ]),
    );
    expect(artifacts.map((artifact) => artifact.id)).toEqual([
      "irgat-document:doc-1",
      "file:/tmp/cat.png",
      "image:s1:shot",
    ]);
    expect(artifacts[2]).toMatchObject({
      format: "image",
      imageData: "data:image/png;base64,AAA",
    });
    expect(artifacts[0]).toMatchObject({ format: "html", documentId: "doc-1" });
  });

  it("skips hidden and draft turns", () => {
    expect(
      extractSessionArtifacts(
        session([
          assistant("a1", fence("ts", lines(20)), { internal: true }),
          { ...user("u1", 1), draft: true, attachments: [] },
        ]),
      ),
    ).toEqual([]);
  });

  it("keeps one entry for a file written twice, at its latest turn", () => {
    const artifacts = extractSessionArtifacts(
      session([
        user("u1", 1),
        tool("t1", { kind: "edit", paths: ["a.ts"] }),
        user("u2", 2),
        tool("t2", { kind: "edit", paths: ["a.ts"] }),
      ]),
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ createdAt: 2, blockId: "t2" });
  });
});

describe("merging, sorting and filtering", () => {
  const item = (over: Partial<WorkspaceArtifact>): WorkspaceArtifact => ({
    id: "x",
    origin: "snippet",
    format: "code",
    title: "x",
    createdAt: 0,
    ...over,
  });

  it("dedupes one file across sessions, newest first, pins on top", () => {
    const merged = mergeArtifacts(
      [item({ id: "pin", title: "Pinned note", pinned: true, createdAt: 1 })],
      [item({ id: "file:/a.ts", path: "/a.ts", origin: "file", createdAt: 5, sessionTitle: "Old" })],
      [item({ id: "file:/a.ts", path: "/a.ts", origin: "file", createdAt: 9, sessionTitle: "New" })],
      [item({ id: "snip", createdAt: 7 })],
    );
    expect(merged.map((artifact) => artifact.id)).toEqual(["pin", "file:/a.ts", "snip"]);
    expect(merged[1].sessionTitle).toBe("New");
  });

  it("keeps a pinned copy's pin and title over a derived one", () => {
    const [merged] = mergeArtifacts(
      [item({ id: "s", title: "My title", pinned: true, scope: "project:/w", createdAt: 1, content: "old" })],
      [item({ id: "s", title: "Derived", createdAt: 4, content: "new" })],
    );
    expect(merged).toMatchObject({ pinned: true, title: "My title", createdAt: 4, content: "old" });
  });

  it("sorts stably by time", () => {
    expect(
      sortArtifacts([item({ id: "a", createdAt: 1 }), item({ id: "b", createdAt: 1 })]).map(
        (artifact) => artifact.id,
      ),
    ).toEqual(["a", "b"]);
  });

  it("filters by kind and searches title, path, session and kind", () => {
    const list = [
      item({ id: "f", origin: "file", path: "/w/src/app.ts", cwd: "/w", title: "app.ts", change: "modified" }),
      item({ id: "h", format: "html", title: "Landing" }),
      item({ id: "m", format: "markdown", title: "Plan", sessionTitle: "Roadmap chat" }),
      item({ id: "i", format: "image", title: "shot.png" }),
      item({ id: "c", format: "code", language: "sql", title: "Query" }),
    ];
    const ids = (filter: Parameters<typeof filterArtifacts>[1]) =>
      filterArtifacts(list, filter).map((artifact) => artifact.id);
    expect(ids({ filter: "files" })).toEqual(["f"]);
    expect(ids({ filter: "previews" })).toEqual(["h"]);
    expect(ids({ filter: "docs" })).toEqual(["m"]);
    expect(ids({ filter: "code" })).toEqual(["f", "c"]);
    expect(ids({ filter: "media" })).toEqual(["i"]);
    expect(ids({ query: "src/app" })).toEqual(["f"]);
    expect(ids({ query: "roadmap" })).toEqual(["m"]);
    expect(ids({ query: "SQL" })).toEqual(["c"]);
    expect(ids({ filter: "docs", query: "landing" })).toEqual([]);
  });
});

describe("text for other places", () => {
  const snippet: WorkspaceArtifact = {
    id: "s",
    origin: "snippet",
    format: "code",
    language: "ts",
    title: "TypeScript snippet",
    content: "const a = 1;",
    sessionTitle: "Chat",
    createdAt: 0,
  };

  it("names exports after the artifact", () => {
    expect(artifactFileName(snippet)).toBe("typescript-snippet.ts");
    expect(artifactFileName({ ...snippet, title: "report.md" })).toBe("report.md");
    expect(artifactFileName({ ...snippet, format: "html", title: "Pricing!" })).toBe("pricing.html");
    expect(artifactFileName({ ...snippet, path: "/w/a/b.svg" })).toBe("b.svg");
    expect(artifactFileName({ ...snippet, title: "???", language: "weird lang" })).toBe(
      "artifact.txt",
    );
  });

  it("labels kinds", () => {
    expect(artifactKindLabel(snippet)).toBe("TypeScript");
    expect(artifactKindLabel({ ...snippet, language: "zig" })).toBe("ZIG");
    expect(artifactKindLabel({ ...snippet, format: "markdown", origin: "document" })).toBe("Doc");
  });

  it("fences content so inner backticks cannot close it", () => {
    expect(fenceFor("a ``` b")).toBe("````");
    expect(artifactMarkdown(snippet, "x")).toBe("```ts\nx\n```");
    expect(artifactMarkdown({ ...snippet, format: "markdown" }, "# Hi")).toBe("# Hi");
  });

  it("adds files to chat by path and snippets by content", () => {
    expect(
      artifactChatText({ ...snippet, path: "/w/src/a.ts", cwd: "/w" }, "ignored"),
    ).toBe("`src/a.ts`");
    expect(artifactChatText(snippet, undefined)).toBe(
      "TypeScript snippet\n\n```ts\nconst a = 1;\n```",
    );
  });

  it("notes where a note came from", () => {
    expect(artifactNoteBody(snippet, "x")).toBe("From “Chat”\n\n```ts\nx\n```");
    expect(artifactNoteBody({ ...snippet, path: "/w/a.ts", cwd: "/w" }, "x")).toContain(
      "Source: `a.ts`",
    );
  });

  it("formats times relative to now", () => {
    const now = new Date(2026, 9, 14, 12).getTime();
    expect(formatArtifactTime(0, now)).toBe("");
    expect(formatArtifactTime(now - 10_000, now)).toBe("now");
    expect(formatArtifactTime(now - 5 * 60_000, now)).toBe("5m");
    expect(formatArtifactTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatArtifactTime(now - 26 * 3_600_000, now)).toBe("Yesterday");
  });

  it("resolves relative tool paths", () => {
    expect(resolveArtifactPath("a/b.ts", "/w")).toBe("/w/a/b.ts");
    expect(resolveArtifactPath("/abs.ts", "/w")).toBe("/abs.ts");
    expect(resolveArtifactPath("C:\\x.ts", "/w")).toBe("C:\\x.ts");
  });
});
