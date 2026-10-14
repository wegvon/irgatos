// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import { OPEN_ARTIFACT_EVENT, type OpenArtifactRequest } from "../model/openArtifact";
import { ArtifactSourceContext, type ArtifactSource } from "./artifactContext";
import { CodeBlockArtifactButton, ToolArtifactButton } from "./OpenInArtifactsButton";

const source: ArtifactSource = {
  sessionId: "s1",
  sessionTitle: "Build the site",
  cwd: "/work/app",
};
const longCode = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");

let root: Root;
let container: HTMLDivElement;
let opened: OpenArtifactRequest[];
const onOpen = (event: Event) =>
  opened.push((event as CustomEvent<OpenArtifactRequest>).detail);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  opened = [];
  window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen);
  vi.unstubAllGlobals();
});

function render(element: ReactElement, value: ArtifactSource | null = source) {
  act(() =>
    root.render(createElement(ArtifactSourceContext.Provider, { value }, element)),
  );
  return container.querySelector<HTMLButtonElement>("[data-open-artifact]");
}

describe("CodeBlockArtifactButton", () => {
  it("opens a block worth keeping in Artifacts, pinned", () => {
    const outer = vi.fn();
    const button = render(
      createElement(
        "div",
        { onClick: outer },
        createElement(CodeBlockArtifactButton, {
          info: "ts title=server.ts",
          code: "const a = 1;\nexport default a;",
        }),
      ),
    )!;
    expect(button.title).toBe("Open in Artifacts");
    expect(button.getAttribute("aria-label")).toBe("Open server.ts in Artifacts");
    expect(button.className).toBe("markdown-code-artifact");
    act(() => button.click());
    expect(outer).not.toHaveBeenCalled();
    expect(opened).toHaveLength(1);
    expect(opened[0].pin).toBe(true);
    expect(opened[0].artifact).toMatchObject({
      title: "server.ts",
      format: "code",
      content: "const a = 1;\nexport default a;",
      sessionId: "s1",
      sessionTitle: "Build the site",
      cwd: "/work/app",
    });
  });

  it("offers pages, graphics and diagrams below the snippet length", () => {
    expect(
      render(createElement(CodeBlockArtifactButton, { info: "html", code: "<!doctype html><p>Hi</p>" })),
    ).not.toBeNull();
    expect(
      render(createElement(CodeBlockArtifactButton, { info: "svg", code: '<svg viewBox="0 0 1 1"></svg>' })),
    ).not.toBeNull();
    expect(render(createElement(CodeBlockArtifactButton, { info: "html", code: "<p>Hi</p>" }))).toBeNull();
    expect(
      render(createElement(CodeBlockArtifactButton, { info: "mermaid", code: "graph TD; A-->B" })),
    ).not.toBeNull();
  });

  it("skips short untitled snippets, streaming blocks and blocks outside a chat", () => {
    expect(render(createElement(CodeBlockArtifactButton, { info: "ts", code: "const a = 1;" }))).toBeNull();
    expect(render(createElement(CodeBlockArtifactButton, { info: "ts", code: longCode }))).not.toBeNull();
    expect(
      render(createElement(CodeBlockArtifactButton, { info: "ts", code: longCode, incomplete: true })),
    ).toBeNull();
    expect(render(createElement(CodeBlockArtifactButton, { info: "ts", code: longCode }), null)).toBeNull();
  });
});

describe("ToolArtifactButton", () => {
  const write: Block = {
    id: "t1",
    role: "tool",
    text: "",
    startedAt: 1234,
    tool: {
      status: "completed",
      kind: "edit",
      title: "Write index.html",
      preview: { kind: "write", path: "public/index.html", contentOnly: true, lines: [] },
    },
  } as Block;

  it("opens the written file in Artifacts", () => {
    const button = render(createElement(ToolArtifactButton, { block: write, className: "x" }))!;
    expect(button.getAttribute("aria-label")).toBe("Open index.html in Artifacts");
    act(() => button.click());
    expect(opened[0].artifact).toMatchObject({
      origin: "file",
      path: "/work/app/public/index.html",
      change: "created",
      createdAt: 1234,
    });
  });

  it("skips failed and read-only tool calls", () => {
    const failed = { ...write, tool: { ...write.tool!, status: "failed" } } as Block;
    const read = {
      ...write,
      tool: { status: "completed", kind: "read", title: "Read a.ts", paths: ["a.ts"] },
    } as Block;
    expect(render(createElement(ToolArtifactButton, { block: failed, className: "x" }))).toBeNull();
    expect(render(createElement(ToolArtifactButton, { block: read, className: "x" }))).toBeNull();
  });
});
