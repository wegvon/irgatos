// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { AgentTreeView, type AgentRetryRequest } from "./AgentTreeView";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
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

const now = Date.now();

function session(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id, title: id, ...patch };
}

const turn = (text: string, patch: Partial<Block> = {}): Block => ({
  id: `u-${text}`,
  role: "user",
  text,
  startedAt: now - 20_000,
  durationMs: 10_000,
  ...patch,
});

const lead = session("lead", { blocks: [turn("Coordinate")] });
const worker = session("app-lead-1", {
  busy: true,
  blocks: [
    turn("Build it", { durationMs: undefined, startedAt: now - 3_000 }),
    {
      id: "t1",
      role: "tool",
      text: "",
      tool: { callId: "c1", title: "Agent", status: "in_progress" },
      agentRun: { name: "Tests", steps: [] },
    },
  ],
});
const broken = session("app-lead-2", {
  blocks: [
    turn("Ship it", { turnMetrics: { costUsd: 0.5 } }),
    { id: "e", role: "system", text: "Boom", notice: "error" },
  ],
});

function render(sessions: Session[], onRetry = vi.fn(async () => {})) {
  act(() =>
    root.render(
      createElement(AgentTreeView, {
        sessions,
        onOpenSession: vi.fn(),
        onRetry,
      }),
    ),
  );
  return onRetry;
}

const card = (id: string) =>
  container.querySelector<HTMLElement>(`[data-agent-id="${id}"]`);

it("renders the tree, the live summary and status colours", () => {
  render([lead, worker, broken]);
  expect(card("irgatos")).not.toBeNull();
  expect(card("lead")?.dataset.status).toBe("done");
  expect(card("app-lead-1")?.dataset.status).toBe("running");
  expect(card("app-lead-1:agent:c1")?.dataset.status).toBe("running");
  expect(card("app-lead-2")?.dataset.status).toBe("failed");
  const summary = container.querySelector("[data-agent-tree-summary]")!.textContent;
  expect(summary).toContain("4 agents");
  expect(summary).toContain("2 running");
  expect(summary).toContain("1 failed");
  expect(summary).toContain("$0.50");
});

it("collapses and expands a card's sub-agents", () => {
  render([lead, worker, broken]);
  const toggle = card("lead")!.querySelector<HTMLButtonElement>("[data-agent-toggle]")!;
  expect(toggle.textContent).toContain("2");
  act(() => toggle.click());
  expect(card("app-lead-1")).toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  act(() => toggle.click());
  expect(card("app-lead-1")).not.toBeNull();
});

it("retries a failed agent as a new running sibling and stops the old one", async () => {
  const onRetry = render([lead, worker, broken]);
  const popover = container.querySelector<HTMLElement>("[data-agent-error]")!;
  expect(popover.textContent).toContain("Boom");
  expect(popover.textContent).toContain("Ship it");
  const retry = [...popover.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  await act(async () => retry.click());
  expect(onRetry).toHaveBeenCalledTimes(1);
  const request = (onRetry.mock.calls[0] as unknown as [AgentRetryRequest])[0];
  expect(request).toMatchObject({ sourceSessionId: "app-lead-2", prompt: "Ship it" });
  // The app starts the session under the id the tree chose.
  const fresh = session(request.newSessionId, {
    busy: true,
    blocks: [turn("Ship it", { durationMs: undefined, startedAt: now })],
  });
  render([lead, worker, broken, fresh], onRetry);
  expect(card("app-lead-2")?.dataset.status).toBe("stopped");
  const sibling = card(request.newSessionId)!;
  expect(sibling.dataset.status).toBe("running");
  expect(sibling.closest("ul")).toBe(card("app-lead-2")!.closest("ul"));
  expect(container.querySelector("[data-agent-error]")).toBeNull();
});

it("dismisses the error box and brings it back from the badge", () => {
  render([lead, broken]);
  const dismiss = [...container.querySelectorAll("[data-agent-error] button")].find(
    (button) => button.textContent === "Dismiss",
  ) as HTMLButtonElement;
  act(() => dismiss.click());
  expect(container.querySelector("[data-agent-error]")).toBeNull();
  const badge = card("app-lead-2")!.querySelector<HTMLButtonElement>("[data-agent-status-badge]")!;
  act(() => badge.click());
  expect(container.querySelector("[data-agent-error]")).not.toBeNull();
});
