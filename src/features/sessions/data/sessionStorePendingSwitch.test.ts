import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Session } from "../model/session";
import {
  pendingComposerSwitch,
  planComposerSwitch,
  shouldAskOutgoingAgent,
} from "../model/handoff";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const { getSession, persistFingerprint, sanitizeSessionForPersist } =
  await import("./sessionStore");

/** A Claude chat with an edit, switched to Codex but not yet sent. */
function switchedSession(): Session {
  const session: Session = {
    ...newSession("claude", "/repo"),
    model: "opus",
    modelSettings: { effort: "high" },
    providerSessionId: "claude-thread-1",
    providerAccountId: "account-work",
    blocks: [
      { id: "u1", role: "user", text: "Fix the login bug" },
      {
        id: "t1",
        role: "tool",
        text: "Edit src/login.ts",
        tool: {
          callId: "c1",
          title: "Edit src/login.ts",
          kind: "edit",
          status: "completed",
        },
      },
      { id: "a1", role: "assistant", text: "Fixed the null check." },
    ],
  };
  const plan = planComposerSwitch(session, "codex");
  if (plan.kind !== "arm") throw new Error(`expected arm, got ${plan.kind}`);
  // Mirrors App.tsx: the new provider is selected and its thread starts fresh.
  return {
    ...session,
    harness: "codex",
    model: "gpt-5",
    modelSettings: {},
    providerSessionId: undefined,
    providerAccountId: undefined,
    pendingSwitch: plan.pending,
  };
}

async function reopen(saved: Session): Promise<Session | null> {
  invoke.mockImplementation(async (command: string) =>
    command === "session_get"
      ? { ...sanitizeSessionForPersist(saved), createdAt: 1, updatedAt: 2 }
      : null,
  );
  return getSession(saved.id);
}

describe("pending provider handoff across a restart", () => {
  beforeEach(() => invoke.mockReset());

  it("saves the outgoing provider with the new selection", () => {
    const saved = sanitizeSessionForPersist(switchedSession());
    expect(saved.harness).toBe("codex");
    expect(saved.pendingSwitch).toEqual({
      from: "claude",
      fromModel: "opus",
      fromSettings: { effort: "high" },
      fromProviderSessionId: "claude-thread-1",
      fromProviderAccountId: "account-work",
    });
  });

  it("restores it, so the next message is handed off first", async () => {
    const restored = await reopen(switchedSession());
    expect(restored?.harness).toBe("codex");
    expect(restored?.blocks.map((block) => block.id)).toEqual([
      "u1",
      "t1",
      "a1",
    ]);
    const pending = restored && pendingComposerSwitch(restored);
    expect(pending).toMatchObject({
      from: "claude",
      fromModel: "opus",
      fromProviderSessionId: "claude-thread-1",
      fromProviderAccountId: "account-work",
    });
    // The outgoing thread is still known, so it writes the recap.
    expect(restored && shouldAskOutgoingAgent(restored)).toBe(true);
  });

  it("still reverts to the old thread after a restart", async () => {
    const restored = await reopen(switchedSession());
    expect(restored && planComposerSwitch(restored, "claude")).toEqual({
      kind: "revert",
      restoreProviderSessionId: "claude-thread-1",
      restoreProviderAccountId: "account-work",
    });
  });

  it("keeps a usage-limit switch from asking the exhausted provider", async () => {
    const session = switchedSession();
    session.pendingSwitch = { ...session.pendingSwitch!, skipOutgoingRecap: true };
    const restored = await reopen(session);
    expect(restored?.pendingSwitch?.skipOutgoingRecap).toBe(true);
    expect(restored && shouldAskOutgoingAgent(restored)).toBe(false);
  });

  it("drops a malformed saved switch instead of failing the load", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "session_get"
        ? {
            ...sanitizeSessionForPersist(switchedSession()),
            pendingSwitch: { from: "nope", fromModel: 3 },
            createdAt: 1,
            updatedAt: 2,
          }
        : null,
    );
    const restored = await getSession("x");
    expect(restored?.pendingSwitch).toBeUndefined();
  });

  it("re-saves when only the pending switch changes", () => {
    const session = switchedSession();
    expect(persistFingerprint(session)).not.toBe(
      persistFingerprint({ ...session, pendingSwitch: undefined }),
    );
  });
});
