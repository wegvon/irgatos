// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import {
  createIrgat,
  findIrgat,
  irgatWorksOn,
  saveIrgatSessionId,
} from "./irgat";
import { approveProjectAccess, projectAccessBlock } from "./irgatProjectAccess";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
});

it("keeps the request tied to its user turn and reuses pending approvals", () => {
  const irgat = createIrgat();
  const session = newSession("codex", "/home/user");
  session.blocks = [
    { id: "user-turn", role: "user", text: "Start four agents" },
  ];
  const block = projectAccessBlock(session, irgat.id, "/code/repguard");
  session.blocks.push(block);
  expect(block.irgatProjectAccess?.userTurnId).toBe("user-turn");
  expect(projectAccessBlock(session, irgat.id, "/code/repguard/")).toBe(block);
  expect(findIrgat(irgat.id)?.projects).toEqual([]);
  const other = projectAccessBlock(session, irgat.id, "/code/other");
  expect(other.approval?.requestId).not.toBe(block.approval?.requestId);
});

it("does not grant denied, stale, or another Irgat's requests", () => {
  const irgat = createIrgat();
  const session = newSession("codex", "/home/user");
  saveIrgatSessionId(irgat.id, session.id);
  const block = projectAccessBlock(session, irgat.id, "/code/repguard");
  const denied = {
    ...block,
    approval: { ...block.approval!, decided: "deny" as const },
  };
  expect(approveProjectAccess(session, denied)).toBe(false);
  expect(findIrgat(irgat.id)?.projects).toEqual([]);
  const other = createIrgat();
  expect(
    approveProjectAccess(
      session,
      projectAccessBlock(session, other.id, "/code/repguard"),
    ),
  ).toBe(false);
  saveIrgatSessionId(irgat.id, "replacement-session");
  expect(approveProjectAccess(session, block)).toBe(false);
  expect(findIrgat(irgat.id)?.projects).toEqual([]);
});

it("stores approval only for this Irgat and project, including after reloading the roster", () => {
  const irgat = createIrgat();
  const other = createIrgat();
  const session = newSession("codex", "/home/user");
  saveIrgatSessionId(irgat.id, session.id);
  expect(
    approveProjectAccess(
      session,
      projectAccessBlock(session, irgat.id, "/code/repguard"),
    ),
  ).toBe(true);
  expect(irgatWorksOn(findIrgat(irgat.id)!, "/code/repguard/")).toBe(true);
  expect(irgatWorksOn(findIrgat(other.id)!, "/code/repguard")).toBe(false);
  expect(irgatWorksOn(findIrgat(irgat.id)!, "/code/other")).toBe(false);
});
