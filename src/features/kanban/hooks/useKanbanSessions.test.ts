// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { useKanbanSessions, type KanbanSessions } from "./useKanbanSessions";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

let root: Root;
let container: HTMLDivElement;
let latest: KanbanSessions;
let statusWrites: unknown[];

function Probe({ sessions }: { sessions: Session[] }) {
  latest = useKanbanSessions(sessions);
  return null;
}

async function render(sessions: Session[]) {
  await act(async () => root.render(createElement(Probe, { sessions })));
  await act(async () => {});
}

function session(id: string, extra: Partial<Session> = {}): Session {
  return { ...newSession("codex", "/work/app"), id, title: id, ...extra };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  statusWrites = [];
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "kanban_session_links") {
      return [{ sessionId: "linked", cardId: "c1", project: "/work/app", status: "draft" }];
    }
    if (command === "kanban_session_status") {
      statusWrites.push(args);
      return null;
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

it("tracks only linked sessions and reports each status change once", async () => {
  const running = [session("linked", { busy: true }), session("other", { busy: true })];
  await render(running);
  expect([...latest.linkedIds]).toEqual(["linked"]);
  expect([...latest.live.keys()]).toEqual(["linked"]);
  expect(latest.live.get("linked")?.status).toBe("running");
  expect(statusWrites).toEqual([{ sessionId: "linked", status: "running" }]);

  const live = latest.live;
  await render([session("linked", { busy: true }), session("other")]);
  expect(latest.live).toBe(live);
  expect(statusWrites).toHaveLength(1);

  await render([
    session("linked", {
      blocks: [
        { id: "u", role: "user", text: "Go" },
        { id: "e", role: "system", text: "Boom", notice: "error" },
      ],
    }),
  ]);
  expect(latest.live.get("linked")?.status).toBe("failed");
  expect(statusWrites).toEqual([
    { sessionId: "linked", status: "running" },
    { sessionId: "linked", status: "failed" },
  ]);
});
