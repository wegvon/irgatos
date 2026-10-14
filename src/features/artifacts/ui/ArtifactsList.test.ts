// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPinnedArtifacts, resetPinnedArtifactsCache } from "../model/pinnedArtifacts";
import type { ArtifactScope, WorkspaceArtifact } from "../model/workspaceArtifacts";
import { ArtifactsList } from "./ArtifactsList";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../sessions/ui/AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) => createElement("div", null, text),
  MarkdownPreview: ({ text }: { text: string }) => createElement("div", null, text),
}));
vi.mock("../../sessions/ui/HighlightedCodeBlock", () => ({
  HighlightedCodeBlock: ({ code }: { code: string }) => createElement("pre", null, code),
}));

const NOW = Date.now();

const written: WorkspaceArtifact = {
  id: "file:/work/app/src/server.ts",
  origin: "file",
  format: "code",
  language: "ts",
  title: "server.ts",
  path: "/work/app/src/server.ts",
  cwd: "/work/app",
  change: "created",
  sessionId: "s1",
  sessionTitle: "Build the API",
  createdAt: NOW - 60_000,
};
const page: WorkspaceArtifact = {
  id: "snippet:s1:b2:0",
  origin: "snippet",
  format: "html",
  language: "html",
  title: "Landing page",
  content: "<h1>Hi</h1>",
  sessionId: "s1",
  sessionTitle: "Build the API",
  createdAt: NOW - 30_000,
};
const plan: WorkspaceArtifact = {
  id: "document:s2:b1",
  origin: "document",
  format: "markdown",
  language: "markdown",
  title: "Rollout plan",
  content: "# Rollout",
  sessionId: "s2",
  sessionTitle: "Plan the rollout",
  createdAt: NOW - 10_000,
  pinned: true,
};
const mine: WorkspaceArtifact = {
  id: "manual:1",
  origin: "manual",
  format: "code",
  language: "sql",
  title: "cleanup.sql",
  content: "delete from jobs;",
  createdAt: NOW - 5_000,
  pinned: true,
};
const all = [plan, page, written, mine];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type ListProps = Parameters<typeof ArtifactsList>[0];

function render(props: Partial<ListProps> = {}) {
  const onOpen = props.onOpen ?? vi.fn();
  const full: ListProps = { artifacts: all, onOpen, ...props };
  act(() => root.render(createElement(ArtifactsList, full)));
  return { onOpen: onOpen as ReturnType<typeof vi.fn>, rerender: (next: Partial<ListProps>) =>
    act(() => root.render(createElement(ArtifactsList, { ...full, ...next }))) };
}

const options = () =>
  [...container.querySelectorAll<HTMLElement>('[role="option"]')];
const titles = () =>
  options().map((option) => option.querySelector("span span span")?.textContent);
const chip = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Artifact kind"] button')].find(
    (button) => button.textContent?.startsWith(label),
  )!;
const search = () => container.querySelector<HTMLInputElement>("input[type=search]")!;
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent === label || entry.getAttribute("aria-label") === label,
  );

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(target: Element, keyName: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, ...init }));
  });
}

describe("ArtifactsList", () => {
  it("lists each artifact with its kind, session and age", () => {
    render();
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Artifacts");
    expect(titles()).toEqual(["Rollout plan", "Landing page", "server.ts", "cleanup.sql"]);
    const [first, second, third, fourth] = options();
    expect(first.querySelector("[data-artifact-kind]")?.textContent).toBe("Doc");
    expect(first.querySelector('[aria-label="Pinned"]')).not.toBeNull();
    expect(first.textContent).toContain("Plan the rollout");
    expect(second.querySelector("[data-artifact-kind]")?.textContent).toBe("HTML");
    expect(third.textContent).toContain("Created · Build the API");
    expect(third.getAttribute("title")).toBe("src/server.ts");
    expect(fourth.textContent).toContain("Added by you");
    expect(third.textContent).toMatch(/1m|1 min/);
  });

  it("hides the session line when asked", () => {
    render({ showSession: false });
    expect(options()[0].textContent).not.toContain("Plan the rollout");
  });

  it("filters by kind with counts and disables empty kinds", () => {
    render();
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    expect(chip("All").textContent).toBe("All4");
    expect(chip("Files").textContent).toBe("Files1");
    expect(chip("Previews").textContent).toBe("Previews1");
    expect(chip("Media").disabled).toBe(true);

    act(() => chip("Previews").click());
    expect(chip("Previews").getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual(["Landing page"]);

    act(() => chip("Docs").click());
    expect(titles()).toEqual(["Rollout plan"]);
  });

  it("searches titles and clears with Escape", () => {
    render();
    type(search(), "cleanup");
    expect(titles()).toEqual(["cleanup.sql"]);
    expect(chip("All").textContent).toBe("All1");

    type(search(), "nothing like this");
    expect(container.textContent).toContain("No artifacts match “nothing like this”.");
    act(() => button("Clear filters")!.click());
    expect(search().value).toBe("");
    expect(titles()).toHaveLength(4);

    type(search(), "plan");
    key(search(), "Escape");
    expect(search().value).toBe("");
  });

  it("previews on click and keeps the tab on double click", () => {
    const { onOpen } = render();
    act(() => options()[1].click());
    expect(onOpen).toHaveBeenLastCalledWith(page, false);
    act(() => {
      options()[2].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(onOpen).toHaveBeenLastCalledWith(written, true);
  });

  it("marks the shown artifact and gives it the tab stop", () => {
    render({ selectedId: page.id });
    const [first, second] = options();
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("aria-selected")).toBe("false");
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
  });

  it("moves with the arrow keys, previewing as it goes", () => {
    const { onOpen } = render();
    key(search(), "ArrowDown");
    expect(document.activeElement).toBe(options()[0]);
    expect(onOpen).not.toHaveBeenCalled();

    key(options()[0], "ArrowDown");
    expect(document.activeElement).toBe(options()[1]);
    expect(onOpen).toHaveBeenLastCalledWith(page, false);

    key(options()[1], "End");
    expect(document.activeElement).toBe(options()[3]);
    expect(onOpen).toHaveBeenLastCalledWith(mine, false);

    key(options()[3], "Home");
    expect(onOpen).toHaveBeenLastCalledWith(plan, false);

    key(options()[0], "Enter");
    expect(onOpen).toHaveBeenLastCalledWith(plan, true);
    key(options()[0], " ");
    expect(onOpen).toHaveBeenLastCalledWith(plan, false);

    key(options()[0], "ArrowUp");
    expect(document.activeElement).toBe(search());
  });

  it("leaves modified keys to the app", () => {
    const { onOpen } = render();
    key(options()[0], "ArrowDown", { metaKey: true });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("switches scope from the radio group and the arrow keys", () => {
    const onScopeChange = vi.fn<(scope: ArtifactScope) => void>();
    render({ scope: "session", onScopeChange });
    const group = container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Artifact scope");
    const [session, project] = [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(session.textContent).toBe("This session");
    expect(session.getAttribute("aria-checked")).toBe("true");
    expect(project.textContent).toBe("All sessions");
    act(() => project.click());
    expect(onScopeChange).toHaveBeenLastCalledWith("project");
    key(session, "ArrowRight");
    expect(onScopeChange).toHaveBeenLastCalledWith("project");
  });

  it("hides the scope switch for a single-scope list", () => {
    render();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("explains an empty session and offers every session", () => {
    const onScopeChange = vi.fn();
    render({ artifacts: [], scope: "session", onScopeChange, hasActiveSession: false });
    expect(container.textContent).toContain("Open a chat to see what it made");
    act(() => button("Show all sessions")!.click());
    expect(onScopeChange).toHaveBeenCalledWith("project");
  });

  it("explains an empty project", () => {
    render({ artifacts: [], scope: "project", onScopeChange: vi.fn() });
    expect(container.textContent).toContain("Nothing yet in this project.");
    expect(button("Show all sessions")).toBeUndefined();
  });

  it("shows loading before the first artifact and while older sessions load", () => {
    const view = render({ artifacts: [], loading: true });
    expect(container.querySelector('[role="listbox"]')?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Reading this project's sessions…",
    );
    view.rerender({ artifacts: all, loading: true });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Reading older sessions…");
  });

  it("shows a load error with Retry", () => {
    const onRetry = vi.fn();
    render({ error: "Could not read the saved sessions.", onRetry });
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Could not read the saved sessions.");
    act(() => button("Retry", alert)!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("creates an artifact from the dialog, pins it and opens it", () => {
    const scope = "project:/work/app";
    const { onOpen } = render({ scope: "session", onScopeChange: vi.fn(), createScope: scope });
    act(() => button("New artifact")!.click());
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("New artifact");
    const create = button("Create artifact", dialog)!;
    expect(create.disabled).toBe(true);

    type(dialog.querySelector<HTMLInputElement>('[aria-label="Artifact title"]')!, "checklist.md");
    type(dialog.querySelector<HTMLTextAreaElement>('[aria-label="Artifact content"]')!, "- ship it");
    expect(create.disabled).toBe(false);
    act(() => create.click());

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
    const [created, pin] = onOpen.mock.calls[0] as [WorkspaceArtifact, boolean];
    expect(pin).toBe(true);
    expect(created).toMatchObject({ title: "checklist.md", format: "markdown", pinned: true });
    expect(listPinnedArtifacts(scope).map((item) => item.id)).toEqual([created.id]);
  });

  it("reports an artifact too large to keep", () => {
    render({ createScope: "irgat:i1" });
    act(() => button("New artifact")!.click());
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    type(
      dialog.querySelector<HTMLTextAreaElement>('[aria-label="Artifact content"]')!,
      "x".repeat(512 * 1024 + 1),
    );
    act(() => button("Create artifact", dialog)!.click());
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain("too large to pin");
    act(() => button("Cancel", dialog)!.click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
