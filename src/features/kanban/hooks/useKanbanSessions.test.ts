// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { useKanbanSessions, type KanbanSessions } from "./useKanbanSessions";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

let root: Root;
let container: HTMLDivElement;
let latest: KanbanSessions;
let syncs: { project: string; sessions: unknown[] }[];
let failNextSync: boolean;

function Probe({ sessions }: { sessions: Session[] }) {
  latest = useKanbanSessions(sessions);
  return null;
}

async function render(sessions: Session[]) {
  await act(async () => root.render(createElement(Probe, { sessions })));
  await act(async () => {});
}

const sent: Block[] = [{ id: "u", role: "user", text: "Go" }];

function session(id: string, extra: Partial<Session> = {}): Session {
  return { ...newSession("codex", "/work/app"), id, title: id, blocks: sent, ...extra };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  syncs = [];
  failNextSync = false;
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "kanban_session_links") {
      return [{ sessionId: "linked", cardId: "c1", project: "/work/app", status: "draft" }];
    }
    if (command === "kanban_sync_sessions") {
      if (failNextSync) {
        failNextSync = false;
        throw new Error("locked");
      }
      syncs.push(args as (typeof syncs)[number]);
      return [args.project];
    }
    if (command.startsWith("plugin:event|")) return 1;
    throw new Error(`Unexpected command: ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("files every project session and reports each change once", async () => {
  await render([
    session("linked", { busy: true }),
    session("other", { busy: true, title: "codex · Fix login" }),
    session("blank", { blocks: [] }),
    session("home", { cwd: "/Users/me" }),
    session("habit", { ephemeral: true }),
  ]);
  expect([...latest.live.keys()]).toEqual(["linked", "other", "blank"]);
  expect(latest.live.get("other")).toMatchObject({
    status: "running",
    title: "Fix login",
    project: "/work/app",
  });
  expect(syncs).toEqual([
    {
      project: "/work/app",
      sessions: [
        { sessionId: "linked", title: "linked", status: "running" },
        { sessionId: "other", title: "Fix login", status: "running" },
      ],
    },
  ]);

  const live = latest.live;
  await render([
    session("linked", { busy: true }),
    session("other", { busy: true, title: "codex · Fix login" }),
    session("blank", { blocks: [] }),
  ]);
  expect(latest.live).toBe(live);
  expect(syncs).toHaveLength(1);

  await render([
    session("linked", { busy: true }),
    session("other", { blocks: [...sent, { id: "e", role: "system", text: "Boom", notice: "error" }] }),
  ]);
  expect(syncs[1]).toEqual({
    project: "/work/app",
    sessions: [{ sessionId: "other", title: "other", status: "failed" }],
  });
});

it("treats approvals and AskUserQuestion alike as waiting on the user", async () => {
  await render([
    session("approve", {
      busy: true,
      blocks: [...sent, { id: "t", role: "tool", text: "rm -rf", approval: { requestId: 1 } }],
    }),
    session("ask", {
      busy: true,
      pendingQuestion: {
        requestId: 2,
        questions: [
          { id: "q", prompt: "Which?", multiSelect: false, allowCustom: true, options: [] },
        ],
      },
    }),
  ]);
  expect(latest.live.get("approve")).toMatchObject({ status: "needs-input", attention: "approval" });
  expect(latest.live.get("ask")).toMatchObject({ status: "needs-input", attention: "question" });
  expect(syncs[0]!.sessions).toEqual([
    { sessionId: "approve", title: "approve", status: "needs-input" },
    { sessionId: "ask", title: "ask", status: "needs-input" },
  ]);
});

it("files handoffs and saved drafts, and lets orchestration workers speak through their lead", async () => {
  await render([
    session("handoff", {
      blocks: [],
      handoffCard: { from: "cursor", to: "claude", brief: "Carry on" },
    }),
    session("draft", { blocks: [{ id: "d", role: "user", text: "Later", draft: true }] }),
    session("lead"),
    session("worker", {
      busy: true,
      orchestrationLeadId: "lead",
      pendingQuestion: { requestId: 3, questions: [] },
    }),
    session("other-project", { cwd: "/work/api", busy: true }),
  ]);
  expect(latest.live.has("worker")).toBe(false);
  expect(latest.live.get("lead")).toMatchObject({ status: "needs-input" });
  expect(latest.live.get("lead")?.attention).toBeUndefined();
  expect(syncs).toEqual([
    {
      project: "/work/app",
      sessions: [
        { sessionId: "handoff", title: "handoff", status: "draft" },
        { sessionId: "draft", title: "draft", status: "draft" },
        { sessionId: "lead", title: "lead", status: "needs-input" },
      ],
    },
    {
      project: "/work/api",
      sessions: [{ sessionId: "other-project", title: "other-project", status: "running" }],
    },
  ]);
});

it("sends a change again after a failed write", async () => {
  failNextSync = true;
  await render([session("s1", { busy: true })]);
  await render([session("s1", { busy: true, title: "codex · Renamed" })]);
  expect(syncs.map((sync) => sync.sessions)).toEqual([
    [{ sessionId: "s1", title: "s1", status: "running" }],
    [{ sessionId: "s1", title: "Renamed", status: "running" }],
  ]);
});
