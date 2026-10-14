// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createIrgat } from "../../features/irgats/model/irgat";
import { habitRunIrgat, isHabitRun } from "../../features/irgats/model/irgatHabits";
import { newSession, type Session } from "../../features/sessions/model/session";
import { groupRunnerHost, type IrgatGroupChatHost } from "./useIrgatGroupChat";

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map([["irgat:irgat-roster", "[]"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

function appHost(own: Session | undefined) {
  const sessions: Session[] = [];
  const host: IrgatGroupChatHost = {
    sessions: () => sessions,
    memberSession: async () => own,
    add: (session) => void sessions.push(session),
    run: vi.fn(async () => ({ status: "completed" as const, text: "ok" })),
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async (id: string) => {
      sessions.splice(sessions.findIndex((s) => s.id === id), 1);
    }),
  };
  return { host, sessions };
}

it("runs a member's turn in a hidden seat with the member's provider, model and folder", async () => {
  const irgat = createIrgat();
  const own = { ...newSession("codex", "/work/app", undefined, "full-access"), providerAccountId: "acct" };
  const { host, sessions } = appHost(own);
  const runner = groupRunnerHost(host);

  const seat = await runner.openSeat(irgat.id, "Room · Architect");
  expect(seat).toEqual({ seatId: sessions[0].id, harness: "codex", model: own.model });
  expect(sessions[0]).toMatchObject({
    harness: "codex",
    cwd: "/work/app",
    runtimeMode: "full-access",
    providerAccountId: "acct",
    title: "Room · Architect",
    ephemeral: true,
  });
  expect(sessions[0].id).not.toBe(own.id);
  expect(isHabitRun(seat!.seatId)).toBe(true);
  expect(habitRunIrgat(seat!.seatId)).toBe(irgat.id);

  sessions[0].blocks.push(
    { id: "u", role: "user", text: "prompt" },
    { id: "a", role: "assistant", text: "Seat says hi" },
  );
  expect(runner.reply(seat!.seatId)).toBe("Seat says hi");

  await runner.close(seat!.seatId);
  expect(host.remove).toHaveBeenCalledWith(seat!.seatId);
  expect(isHabitRun(seat!.seatId)).toBe(false);
  expect(sessions).toEqual([]);
});

it("has no seat for an Irgat that is gone or has no conversation", async () => {
  const irgat = createIrgat();
  expect(await groupRunnerHost(appHost(undefined).host).openSeat(irgat.id, "x")).toBeUndefined();
  expect(
    await groupRunnerHost(appHost(newSession()).host).openSeat("missing", "x"),
  ).toBeUndefined();
});
