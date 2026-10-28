// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";
import { fleetTeam } from "../model/fleet";
import { resetReviewMarksForTest } from "../model/reviewMarks";
import { FleetTeamPanel } from "./FleetTeam";
import { FleetView } from "./FleetView";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => false,
    onResized: async () => () => {},
  }),
}));

let root: Root;
let container: HTMLDivElement;
let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map<string, string>();
  storage.set("irgatos.fleet.mode.v1", "sessions");
  storage.set(
    "irgatos.fleet.review.v1",
    JSON.stringify({ since: 0, marks: {} }),
  );
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  resetReviewMarksForTest();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  resetReviewMarksForTest();
});

// Finished long ago: the old rule would have let it go idle by now.
const AT = Date.now() - 24 * 60 * 60 * 1000;
const changed: Block[] = [
  { id: "u", role: "user", text: "Go", startedAt: AT, durationMs: 500 },
  {
    id: "e",
    role: "tool",
    text: "Edit",
    tool: { kind: "edit", status: "completed", preview: { kind: "write", path: "/repo/a.ts" } },
  },
];

function renderFleet(sessions: Session[]) {
  act(() =>
    root.render(
      createElement(FleetView, {
        sessions,
        unseenFinishedIds: new Set<string>(),
        besideRail: true,
        onClose: vi.fn(),
        onOpenSession: vi.fn(),
        onApproval: vi.fn(),
        onQuestionReply: vi.fn(),
      }),
    ),
  );
}

const reviewIds = () =>
  [
    ...container.querySelectorAll<HTMLElement>(
      '[data-fleet-bucket="review"] [data-fleet-session]',
    ),
  ].map((row) => row.dataset.fleetSession);

const button = (label: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === label,
  )!;

it("keeps a result until it is marked reviewed, with undo", () => {
  const session = { ...newSession("claude", "/repo"), id: "a", title: "Login fix", blocks: changed };
  renderFleet([session]);
  expect(reviewIds()).toEqual(["a"]);
  act(() => button("Mark reviewed").click());
  expect(reviewIds()).toEqual([]);
  expect(JSON.parse(storage.get("irgatos.fleet.review.v1")!).marks.a.state).toBe(
    "reviewed",
  );
  expect(container.textContent).toContain("Marked “Login fix” reviewed.");
  act(() => button("Undo").click());
  expect(reviewIds()).toEqual(["a"]);
});

it("puts a result aside with Review later and keeps it listed", () => {
  const a = { ...newSession("claude", "/repo"), id: "a", title: "A", blocks: changed };
  const b = { ...newSession("claude", "/repo"), id: "b", title: "B", blocks: changed };
  renderFleet([a, b]);
  const first = container.querySelector('[data-fleet-session="a"]')!;
  act(() => button("Review later", first).click());
  // Still in Ready to review, now at the bottom with a "later" chip.
  expect(reviewIds()).toEqual(["b", "a"]);
  const later = container.querySelector('[data-fleet-session="a"]')!;
  expect(later.textContent).toContain("later");
  act(() => button("Back to the top", later).click());
  expect(container.querySelector('[data-fleet-session="a"]')!.textContent).not.toContain(
    "Put aside",
  );
});

function task(id: string, patch: Partial<OrchestrationTask> = {}): OrchestrationTask {
  return {
    id,
    sessionId: `w-${id}`,
    title: id.toUpperCase(),
    harness: "codex",
    model: "codex:test",
    prompt: "",
    files: [id],
    scopes: [`/repo/${id}`],
    dependsOn: [],
    status: "queued",
    accepted: false,
    result: "",
    delivered: false,
    ...patch,
  };
}

it("shows a collapsed team as counts and explains each waiting worker", () => {
  const run = {
    version: 2,
    leadId: "lead",
    cwd: "/repo",
    status: "active",
    allowedHarnesses: ["codex"],
    maxWorkers: 2,
    cli: "irgat",
    tasks: [
      task("api", { status: "running" }),
      task("ui", { dependsOn: ["api"] }),
      task("e2e", { dependsOn: ["ui"] }),
    ],
    continuations: 0,
    requests: {},
  } as OrchestrationRun;
  const team = fleetTeam(run, () => undefined);
  const onOpenSession = vi.fn();
  act(() =>
    root.render(
      createElement(FleetTeamPanel, { leadId: "lead", team, run, onOpenSession }),
    ),
  );
  expect(container.querySelector("[data-fleet-team-counts]")!.textContent).toBe(
    "1 working · 2 waiting",
  );
  expect(container.querySelector("[data-fleet-worker]")).toBeNull();
  act(() => container.querySelector<HTMLButtonElement>("[aria-expanded]")!.click());
  const ui = container.querySelector('[data-fleet-worker="w-ui"]')!;
  expect(ui.textContent).toContain("Waiting on task");
  act(() => ui.querySelector("button")!.click());
  expect(ui.querySelector('[data-worker-wait="dependency"]')!.textContent).toContain(
    "Starts after API finishes",
  );
  // Cancel names what else will not start.
  const api = container.querySelector('[data-fleet-worker="w-api"]')!;
  act(() => api.querySelector("button")!.click());
  act(() => button("Cancel task", api).click());
  const impact = api.querySelector("[data-cancel-impact]")!;
  expect(impact.getAttribute("data-cancel-impact")).toBe("2");
  expect(impact.textContent).toContain("UI, E2E");
  act(() => button("Keep", api).click());
  expect(api.querySelector("[data-cancel-impact]")).toBeNull();
  // Guidance opens for the row it came from, with that agent as the target.
  act(() => button("Send guidance", api).click());
  expect(
    api.querySelector("textarea")!.getAttribute("aria-label"),
  ).toBe("Guidance for API");
  act(() => button("Open", api).click());
  expect(onOpenSession).toHaveBeenCalledWith("w-api");
});
