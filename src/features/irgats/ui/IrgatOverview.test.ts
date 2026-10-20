// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IrgatOverview, type IrgatOverviewTab } from "./IrgatOverview";
import { newSession } from "../../sessions/model/session";

vi.mock("../model/irgatHabits", async (original) => ({
  ...(await original<object>()),
  loadHabits: async () => [],
}));

vi.mock("../model/irgatFiles", async (original) => ({
  ...(await original<object>()),
  loadIrgatFiles: async () => ({
    id: "irgat-1",
    dir: "/data/irgat-1",
    soul: "# Soul",
    soulHash: "soul",
    memory: "",
    memoryHash: "memory",
    memoryPath: "/data/irgat-1/MEMORY.md",
    topics: [],
  }),
}));

vi.mock("../../sessions/ui/ModelPicker", () => ({
  ModelPicker: () => null,
  ModelSettingRows: () => null,
}));

vi.mock("./IrgatChangesView", () => ({
  IrgatChangesView: () => createElement("p", { "data-changes-view": "" }),
}));

vi.mock("../../sessions/data/sessionStore", async (original) => ({
  ...(await original<object>()),
  // Both launches are still saved; deleted ones are hidden by default.
  listSessionsByProject: async (cwd: string) =>
    ["a", "b"].map((id) => ({
      id,
      cwd,
      harness: "codex",
      model: "codex:gpt-5.4",
      runtimeMode: "auto",
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
  getSession: async () => null,
}));

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
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  tab: IrgatOverviewTab,
  onTabChange = vi.fn(),
  extra: Record<string, unknown> = {},
) {
  await act(async () =>
    root.render(
      createElement(IrgatOverview, {
        open: true,
        irgatId: "irgat-1",
        cwd: "/home",
        agent: { name: "Broski", mascot: "cat", color: "#9c9", projects: [] },
        state: { status: "idle" },
        launches: [
          {
            sessionId: "a",
            cwd: "/p",
            title: "First",
            harness: "codex",
            model: "codex:gpt-5.4",
          },
          {
            sessionId: "b",
            cwd: "/p",
            title: "Second",
            harness: "codex",
            model: "codex:gpt-5.4",
          },
        ],
        sessions: [],
        documents: [{ id: "d1", kind: "document", title: "Plan" }],
        tab,
        onTabChange,
        onOpenSession: vi.fn(),
        onOpenDocument: vi.fn(),
        onClose: vi.fn(),
        ...extra,
      }),
    ),
  );
  return onTabChange;
}

function tabs() {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

it("names only the open tab, with its count, and switches tabs", async () => {
  const onTabChange = await render("sessions");
  const labels = tabs().map((tab) =>
    tab.querySelector("[data-tab-label]")!.getAttribute("data-tab-label"),
  );
  expect(labels).toEqual([
    "closed",
    "open",
    "closed",
    "closed",
    "closed",
    "closed",
    "closed",
    "closed",
  ]);
  expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual([
    "All",
    "Sessions",
    "Documents",
    "Habits",
    "Changes",
    "Artifacts",
    "Agents",
    "Settings",
  ]);
  expect(tabs()[1].textContent).toBe("Sessions2");
  expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  act(() => tabs()[2].click());
  expect(onTabChange).toHaveBeenCalledWith("documents");
});

const changes = (totals: unknown) => ({
  changes: {
    sessionId: "irgat",
    cwd: "/home",
    totals,
    request: {},
    projects: [],
  },
});

it("always offers a Changes tab and keeps its view mounted once opened", async () => {
  await render("sessions", vi.fn(), changes(null));
  expect(tabs()[4].getAttribute("aria-label")).toBe("Changes");
  expect(container.querySelector("[data-changes-view]")).toBeNull();
  const onTabChange = vi.fn();
  await render(
    "changes",
    onTabChange,
    changes({ files: 3, additions: 12, deletions: 4 }),
  );
  expect(tabs()[4].textContent).toBe("Changes3");
  expect(container.querySelector("[data-changes-view]")).not.toBeNull();
  // Another tab keeps the view mounted, hidden, so a commit draft survives.
  await render("sessions", onTabChange, changes(null));
  expect(tabs()[4].getAttribute("aria-label")).toBe("Changes");
  expect(
    container.querySelector("[data-changes-view]")!.closest("[hidden]"),
  ).not.toBeNull();
});

it("dots the folded Changes icon while there are changes", async () => {
  await render("sessions", vi.fn(), changes(null));
  expect(tabs()[4].querySelector("[data-changes-dot]")).toBeNull();
  await render(
    "sessions",
    vi.fn(),
    changes({ files: 2, additions: 3, deletions: 1 }),
  );
  expect(tabs()[4].querySelector("[data-changes-dot]")).not.toBeNull();
  // Open, the tab names its count instead.
  await render(
    "changes",
    vi.fn(),
    changes({ files: 2, additions: 3, deletions: 1 }),
  );
  expect(tabs()[4].querySelector("[data-changes-dot]")).toBeNull();
});

it("lists every session it started, newest first", async () => {
  await render("sessions");
  const rows = [...container.querySelectorAll("[data-irgat-session]")];
  expect(rows.map((row) => row.getAttribute("data-irgat-session"))).toEqual([
    "b",
    "a",
  ]);
});

it("shows documents in their own tab, and a new-habit button only on Habits", async () => {
  await render("documents");
  expect(container.querySelector('[data-irgat-document="d1"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="New habit"]')).toBeNull();
  await render("habits");
  expect(container.querySelector('[aria-label="New habit"]')).not.toBeNull();
});

it("opens a session over the list, at the same width, with back, workspace and hide", async () => {
  const onBackFromSession = vi.fn();
  const onOpenSessionInWorkspace = vi.fn();
  const onClose = vi.fn();
  await render("sessions", vi.fn(), {
    shownSession: {
      sessionId: "a",
      title: "First",
      pane: createElement("p", { "data-pane": "" }, "Session pane"),
    },
    onBackFromSession,
    onOpenSessionInWorkspace,
    onClose,
  });
  // The same panel, not another sidebar beside or instead of it.
  expect(container.querySelectorAll("aside")).toHaveLength(1);
  const page = container.querySelector("[data-irgat-launched-session]")!;
  expect(page.querySelector("[data-pane]")).not.toBeNull();
  // The list stays beneath, out of reach while the session covers it.
  expect(
    container.querySelector("[data-irgat-session]")!.closest("[inert]"),
  ).not.toBeNull();
  const button = (label: string) =>
    page.parentElement!.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    )!;
  act(() => button("Back").click());
  expect(onBackFromSession).toHaveBeenCalledOnce();
  await act(async () => button("Open in workspace").click());
  expect(onOpenSessionInWorkspace).toHaveBeenCalledWith("a");
  act(() => button("Hide overview").click());
  expect(onClose).toHaveBeenCalledOnce();
});

it("opens a document over its tab with a way back", async () => {
  const onBackFromDocument = vi.fn();
  await render("documents", vi.fn(), {
    shownDocumentId: "d1",
    onBackFromDocument,
  });
  const page = container.querySelector("[data-irgat-document-page]")!;
  expect(page).not.toBeNull();
  act(() =>
    page.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!.click(),
  );
  expect(onBackFromDocument).toHaveBeenCalledOnce();
});

it("opens one New habit page however fast + is clicked", async () => {
  await render("habits");
  const add = container.querySelector<HTMLButtonElement>(
    '[aria-label="New habit"]',
  )!;
  act(() => {
    add.click();
    add.click();
  });
  await act(async () => add.click());
  expect(container.querySelectorAll("[data-new-habit]")).toHaveLength(1);
});

it("keeps its settings on their own tab, with soul and memory opening over it", async () => {
  await render("settings", vi.fn(), {
    settings: {
      cwd: "/home",
      harness: "codex",
      model: "codex:gpt-5.4",
      modelSettings: {},
      runtimeMode: "auto",
      onModelChange: vi.fn(),
      onModelSettingsChange: vi.fn(),
      onRuntimeModeChange: vi.fn(),
    },
  });
  const panel = container.querySelector('[data-irgat-overview="settings"]')!;
  expect(panel.querySelector('input[aria-label="Name"]')).not.toBeNull();
  expect(panel.textContent).toContain("Permissions");
  const link = (label: string) =>
    [...panel.querySelectorAll<HTMLButtonElement>("button")].find((entry) =>
      entry.textContent?.startsWith(label),
    )!;
  await act(async () => link("Memory").click());
  expect(container.querySelector("[data-irgat-memory]")).not.toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click(),
  );
  await act(async () => link("Soul").click());
  expect(container.querySelector("[data-irgat-soul]")).not.toBeNull();
});

it("shows what the Irgat orchestrated as a tree on the Agents tab", async () => {
  const chat = {
    ...newSession("claude", "/home"),
    id: "irgat-chat",
    title: "Broski",
    blocks: [
      { id: "u", role: "user" as const, text: "Plan", startedAt: Date.now() - 1_000, durationMs: 500 },
    ],
  };
  await render("agents", vi.fn(), { irgatSessionId: "irgat-chat", sessions: [chat] });
  const panel = container.querySelector('[data-irgat-overview="agents"]')!;
  const cards = [...panel.querySelectorAll<HTMLElement>("[data-agent-id]")];
  expect(cards[0].dataset.agentId).toBe("irgat-chat");
  expect(cards[0].textContent).toContain("Broski");
  expect(cards.map((card) => card.dataset.agentId).sort()).toEqual(["a", "b", "irgat-chat"]);
});
