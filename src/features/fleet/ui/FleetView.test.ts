// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { FleetView } from "./FleetView";

const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  // These tests cover the Sessions list; Goals has its own.
  storage.set("irgatos.fleet.mode.v1", "sessions");
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function chat(id: string, cwd: string, title: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", cwd), id, title, ...patch };
}

const sent = (at = Date.now() - 1_000): Block => ({
  id: `u-${at}`,
  role: "user",
  text: "Go",
  startedAt: at,
  durationMs: 500,
});

function render(sessions: Session[], handlers: Partial<Parameters<typeof FleetView>[0]> = {}) {
  const props = {
    sessions,
    unseenFinishedIds: new Set<string>(),
    besideRail: true,
    onClose: vi.fn(),
    onOpenSession: vi.fn(),
    onApproval: vi.fn(),
    onQuestionReply: vi.fn(),
    ...handlers,
  };
  act(() => root.render(createElement(FleetView, props)));
  return props;
}

const bucket = (name: string) =>
  container.querySelector<HTMLElement>(`[data-fleet-bucket="${name}"]`)!;

it("shows the exact command waiting for approval and answers it inline", () => {
  const props = render([
    chat("ask", "/work/api", "Publish the SDK", {
      busy: true,
      branch: "release",
      worktreeCwd: "/work/api-worktrees/release",
      blocks: [
        sent(),
        {
          id: "t",
          role: "tool",
          text: "Run a command",
          tool: { kind: "execute", status: "pending", preview: { kind: "shell", query: "npm publish --tag next" } },
          approval: { requestId: 4 },
        },
      ],
    }),
    chat("busy", "/work/web", "Restyle header", { busy: true, blocks: [sent()] }),
  ]);
  const needs = bucket("needsYou");
  expect(needs.textContent).toContain("Publish the SDK");
  expect(needs.textContent).toContain("npm publish --tag next");
  expect(needs.textContent).toContain("release");
  expect(needs.textContent).toContain("worktree");
  expect(bucket("running").textContent).toContain("Restyle header");

  const allow = [...needs.querySelectorAll("button")].find((b) => b.textContent === "Allow")!;
  act(() => allow.click());
  expect(props.onApproval).toHaveBeenCalledWith("ask", 4, "allow");

  const open = needs.querySelector<HTMLButtonElement>('button[aria-label="Open Publish the SDK"]')!;
  act(() => open.click());
  expect(props.onOpenSession).toHaveBeenCalledWith("ask");
});

it("answers an AskUserQuestion prompt from the fleet", () => {
  const props = render([
    chat("q", "/work/api", "Pick a cache", {
      blocks: [sent()],
      pendingQuestion: {
        requestId: 11,
        questions: [
          {
            id: "db",
            prompt: "Which store should the cache use?",
            multiSelect: false,
            allowCustom: false,
            options: [
              { id: "redis", label: "Redis" },
              { id: "sqlite", label: "SQLite" },
            ],
          },
        ],
      },
    }),
  ]);
  const needs = bucket("needsYou");
  expect(needs.textContent).toContain("Which store should the cache use?");
  const option = [...needs.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("SQLite"),
  )!;
  act(() => option.click());
  const submit = [...needs.querySelectorAll("button")].find(
    (b) => b.textContent === "Continue",
  )!;
  act(() => submit.click());
  expect(props.onQuestionReply).toHaveBeenCalledWith(
    "q",
    11,
    expect.objectContaining({ kind: "answered", answers: { db: ["sqlite"] } }),
  );
});

it("lists finished work to review and filters across buckets", () => {
  render(
    [
      chat("done", "/work/api", "Fix rate limiter", {
        blocks: [
          sent(),
          {
            id: "e",
            role: "tool",
            text: "Edit limiter.ts",
            tool: { kind: "edit", status: "completed", preview: { kind: "write", path: "/work/api/src/limiter.ts" } },
          },
        ],
      }),
      chat("busy", "/work/web", "Restyle header", { busy: true, blocks: [sent()] }),
    ],
    { unseenFinishedIds: new Set(["done"]) },
  );
  const review = bucket("review");
  expect(review.textContent).toContain("Fix rate limiter");
  expect(review.textContent).toContain("1 file changed");
  expect(review.textContent).toContain("limiter.ts");

  const input = container.querySelector<HTMLInputElement>('input[aria-label="Filter sessions"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, "header");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector('[data-fleet-bucket="review"]')).toBeNull();
  expect(bucket("running").textContent).toContain("Restyle header");
});

it("explains the empty fleet", () => {
  render([chat("blank", "/work/api", "claude")]);
  expect(container.textContent).toContain("No agents yet");
  expect(container.querySelector("[data-fleet-bucket]")).toBeNull();
});

it("lists habit runs waiting for approval in Needs you and answers them", () => {
  const requestedAt = Date.now() - 5 * 60_000;
  const approval = {
    irgatId: "irgat-1",
    irgatSessionId: "irgat-chat",
    irgatName: "Skull",
    color: "#f80",
    requestedAt,
    habit: {
      id: "h1",
      name: "Deploy watch",
      instructions: "Check the production deploy.",
      schedule: { scheduleKind: "daily" as const, minute: 0, time: "09:00", dayOfWeek: 1 },
      enabled: true,
      createdAt: 0,
      nextRunAt: 0,
      requestApproval: true,
      runRequested: true,
      approval: { state: "pending" as const, requestedAt },
      trigger: { source: "webhook" as const, at: requestedAt },
    },
  };
  const onHabitApproval = vi.fn();
  const props = render([], { habitApprovals: [approval], onHabitApproval });
  // A waiting habit alone is not an empty fleet.
  expect(container.textContent).not.toContain("No agents yet");
  const needs = bucket("needsYou");
  expect(needs.textContent).toContain("Deploy watch");
  expect(needs.textContent).toContain("Skull · habit · Started by its trigger");
  expect(needs.querySelector("button span.tabular-nums")?.textContent).toBe("1");

  const approve = [...needs.querySelectorAll("button")].find(
    (b) => b.textContent === "Approve",
  )!;
  act(() => approve.click());
  expect(onHabitApproval).toHaveBeenCalledWith(approval, "approve");
  const skip = [...needs.querySelectorAll("button")].find(
    (b) => b.textContent === "Skip",
  )!;
  act(() => skip.click());
  expect(onHabitApproval).toHaveBeenLastCalledWith(approval, "skip");

  act(() =>
    needs.querySelector<HTMLButtonElement>('button[aria-label="Open Skull"]')!.click(),
  );
  expect(props.onOpenSession).toHaveBeenCalledWith("irgat-chat");

  const filter = container.querySelector<HTMLInputElement>(
    'input[aria-label="Filter sessions"]',
  )!;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setValue.call(filter, "nothing like it");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("No sessions match");
});


it("shows collapsible Fleet sessions inline without a page toolbar", () => {
  const props = render([chat("inline", "/repo", "Sidebar session", { blocks: [sent()] })], { sidebar: true });
  expect(container.querySelector('input[aria-label="Filter sessions"]')).toBeNull();
  expect(container.querySelector('[data-app-fleet]')?.className).toContain("max-h-[40vh]");
  for (const name of ["needsYou", "review", "running", "idle"]) {
    expect(bucket(name)).not.toBeNull();
  }
  const idle = bucket("idle").querySelector<HTMLButtonElement>("button")!;
  expect(idle.getAttribute("aria-expanded")).toBe("false");
  act(() => idle.click());
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Open Sidebar session"]')!.click());
  expect(props.onOpenSession).toHaveBeenCalledWith("inline");
});

it("shows interrupted sessions apart and offers row actions on right-click", () => {
  const onArchive = vi.fn();
  const onDelete = vi.fn();
  const onStop = vi.fn();
  const props = render(
    [
      chat("cut", "/work/api", "Migrate schema", { blocks: [sent()] }),
      chat("busy", "/work/web", "Restyle header", { busy: true, blocks: [sent()] }),
    ],
    {
      interruptedSessionIds: new Set(["cut"]),
      actions: {
        onArchive,
        onDelete,
        onStop,
        canArchive: (id: string) => id !== "busy",
      },
    },
  );
  expect(bucket("interrupted").textContent).toContain("Migrate schema");
  expect(bucket("interrupted").textContent).toContain("Open it to resume");
  expect(bucket("idle").textContent).not.toContain("Migrate schema");

  const menuFor = (id: string) => {
    act(() =>
      container
        .querySelector(`[data-fleet-session="${id}"]`)!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 })),
    );
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  };
  const pick = (items: HTMLElement[], label: string) =>
    act(() => items.find((item) => item.textContent?.includes(label))!.click());

  const busyItems = menuFor("busy");
  expect(busyItems.map((item) => item.textContent)).toContain("Stop");
  expect(busyItems.map((item) => item.textContent)).not.toContain("Archive");
  pick(busyItems, "Stop");
  expect(onStop).toHaveBeenCalledWith("busy");

  const cutItems = menuFor("cut");
  expect(cutItems.map((item) => item.textContent)).not.toContain("Stop");
  pick(cutItems, "Archive");
  expect(onArchive).toHaveBeenCalledWith("cut");
  pick(menuFor("cut"), "Delete");
  expect(onDelete).toHaveBeenCalledWith("cut");
  pick(menuFor("cut"), "Open");
  expect(props.onOpenSession).toHaveBeenCalledWith("cut");
});
