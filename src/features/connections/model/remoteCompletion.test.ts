import { expect, it, vi } from "vitest";
import { newSession, type Block } from "../../sessions/model/session";
import type { HostSession } from "./protocol";
import { remoteTurnOutcome, waitForRemoteTurn } from "./remoteCompletion";

function snapshot(status: HostSession["status"], blocks: Block[]): HostSession {
  return {
    session: { ...newSession("codex", "/repo"), blocks },
    projectId: "p",
    revision: 1,
    status,
    updatedAt: 1,
  };
}

const asked: Block = { id: "u", role: "user", text: "pwd" };
const answered: Block[] = [
  asked,
  { id: "t", role: "assistant", text: "", tool: { status: "completed" } },
  { id: "a", role: "assistant", text: "/root" },
];

it("waits while the session runs and returns its last reply", async () => {
  const states = [
    snapshot("idle", [asked]),
    snapshot("running", [asked]),
    snapshot("idle", answered),
  ];
  const load = vi.fn(async () => states.shift()!);
  const sleep = vi.fn(async () => {});
  await expect(waitForRemoteTurn(load, { sleep })).resolves.toEqual({
    status: "completed",
    text: "/root",
  });
  expect(load).toHaveBeenCalledTimes(3);
});

it("reports a stopped turn, and gives up on a host that stays unreachable", async () => {
  expect(remoteTurnOutcome(snapshot("interrupted", [asked])).status).toBe(
    "cancelled",
  );
  const load = vi.fn(async () => {
    throw new Error("offline");
  });
  const outcome = await waitForRemoteTurn(load, {
    sleep: async () => {},
    maxErrors: 3,
  });
  expect(outcome.status).toBe("failed");
  expect(outcome.error).toContain("offline");
  expect(load).toHaveBeenCalledTimes(3);
});
