// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { loadGoals, resetGoalCache, saveGoals } from "../model/goalStore";
import { syncGoals } from "../model/goals";
import { GoalsView } from "./GoalsView";
import { GoalLine, OPEN_GOAL_EVENT } from "./GoalLine";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

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
  resetGoalCache();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const NOW = Date.now();

function chat(id: string, patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/work/app"), id, title: "claude", ...patch };
}

const sent = (text: string): Block => ({
  id: `u-${text}`,
  role: "user",
  text,
  startedAt: NOW - 2_000,
  durationMs: 500,
});

function seed(sessions: Session[]): void {
  saveGoals(syncGoals([], sessions, { now: NOW }));
}

function render(sessions: Session[], patch: Partial<Parameters<typeof GoalsView>[0]> = {}) {
  const props = {
    sessions,
    unseenFinishedIds: new Set<string>(),
    query: "",
    now: NOW,
    onOpenSession: vi.fn(),
    onNewGoalChat: vi.fn(),
    onApproval: vi.fn(),
    onQuestionReply: vi.fn(),
    ...patch,
  };
  act(() => root.render(createElement(GoalsView, props)));
  return props;
}

it("lists a goal with its worker's approval and answers it in place", () => {
  const sessions = [
    chat("lead", { busy: true, blocks: [sent("Ship the new onboarding")] }),
    chat("w", {
      orchestrationLeadId: "lead",
      blocks: [
        sent("Run the e2e suite"),
        {
          id: "ask",
          role: "tool",
          text: "Run",
          tool: { kind: "execute", status: "pending", preview: { kind: "shell", query: "npm run e2e" } },
          approval: { requestId: 7 },
        },
      ],
    }),
  ];
  seed(sessions);
  const props = render(sessions);
  const attention = container.querySelector<HTMLElement>('[data-goal-section="attention"]')!;
  expect(attention.textContent).toContain("Ship the new onboarding");
  expect(attention.textContent).toContain("Run the tests");
  expect(attention.textContent).toContain("1 chat · 1 agent");
  const allow = [...attention.querySelectorAll("button")].find((b) => b.textContent === "Allow")!;
  act(() => allow.click());
  expect(props.onApproval).toHaveBeenCalledWith("w", 7, "allow");
});

it("expands into chats and agents, opens one, and starts a follow-up chat", () => {
  const sessions = [chat("a", { blocks: [sent("Fix Safari export")] })];
  seed(sessions);
  const props = render(sessions, { focusGoalId: loadGoals()[0].id });
  const detail = container.querySelector<HTMLElement>("[data-goal-detail]")!;
  expect(detail.textContent).toContain("Chats and agents");
  const row = [...detail.querySelectorAll("button")].find((b) => b.textContent?.includes("Done"))!;
  act(() => row.click());
  expect(props.onOpenSession).toHaveBeenCalledWith("a");
  const follow = [...detail.querySelectorAll("button")].find((b) => b.textContent?.includes("New chat for this goal"))!;
  act(() => follow.click());
  expect(props.onNewGoalChat).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix Safari export" }));
});

it("keeps a closed chat's goal and explains the empty view", () => {
  render([]);
  expect(container.textContent).toContain("No goals yet");
  seed([chat("gone", { blocks: [sent("Write release notes")] })]);
  render([]);
  const idle = container.querySelector<HTMLElement>('[data-goal-section="idle"]')!;
  act(() => idle.querySelector("button")!.click());
  expect(idle.textContent).toContain("Write release notes");
  expect(idle.textContent).toContain("1 chat");
});

it("shows the goal line once a goal spans several chats and asks Fleet to open it", () => {
  const sessions = [
    chat("a", { blocks: [sent("Ship onboarding")] }),
    chat("w", { orchestrationLeadId: "a", blocks: [sent("Build step 1")] }),
  ];
  seed(sessions);
  const opened = vi.fn();
  window.addEventListener(OPEN_GOAL_EVENT, opened);
  act(() => root.render(createElement(GoalLine, { sessionId: "w" })));
  const line = container.querySelector<HTMLButtonElement>("[data-goal-line]")!;
  expect(line.textContent).toContain("Ship onboarding");
  act(() => line.click());
  expect(opened).toHaveBeenCalled();
  window.removeEventListener(OPEN_GOAL_EVENT, opened);
});
