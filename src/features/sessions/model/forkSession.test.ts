import { describe, expect, it } from "vitest";
import { canEditLastTurn } from "./editLastTurn";
import {
  canForkSession,
  forkedSession,
  forkTitle,
  isForkedCopy,
  planFork,
} from "./forkSession";
import { newSession, type Block, type Session } from "./session";
import { groupTurns } from "./transcriptActivity";

const blocks: Block[] = [
  { id: "u1", role: "user", text: "Plan the login page", providerTurnId: "t1" },
  { id: "r1", role: "reasoning", text: "thinking" },
  { id: "a1", role: "assistant", text: "Here is a plan" },
  { id: "u2", role: "user", text: "Build it", providerTurnId: "t2" },
  { id: "a2", role: "assistant", text: "Built" },
  { id: "d1", role: "user", text: "draft", draft: true },
];

function source(extra: Partial<Session> = {}): Session {
  return {
    ...newSession("codex", "/tmp/shop"),
    id: "src",
    title: "codex · Login page",
    providerSessionId: "thread-1",
    blocks,
    ...extra,
  };
}

describe("planFork", () => {
  it("keeps the chat through the chosen turn and names the cut", () => {
    const turn = groupTurns(blocks)[0]!;
    const plan = planFork(source(), turn)!;
    expect(plan.blocks.map((block) => block.id)).toEqual(["u1", "r1", "a1"]);
    expect(plan.keepTurns).toBe(1);
    expect(plan.nextPrompt).toBe("Build it");
    expect(plan.throughProviderTurnId).toBe("t1");
    // Provider turn ids belong to the source conversation.
    expect(plan.blocks[0]!.providerTurnId).toBeUndefined();
  });

  it("keeps everything but drafts when no turn is chosen", () => {
    const plan = planFork(source())!;
    expect(plan.blocks.map((block) => block.id)).toEqual([
      "u1",
      "r1",
      "a1",
      "u2",
      "a2",
    ]);
    expect(plan.keepTurns).toBe(2);
    expect(plan.nextPrompt).toBeUndefined();
    expect(plan.throughProviderTurnId).toBe("t2");
  });

  it("has nothing to fork before the first message", () => {
    expect(planFork(source({ blocks: [] }))).toBeNull();
    expect(canForkSession(source({ blocks: [] }))).toBe(false);
    expect(canForkSession(source({ ephemeral: true }))).toBe(false);
    expect(canForkSession(source())).toBe(true);
  });
});

describe("forkedSession", () => {
  const fresh = { ...newSession("codex", "/tmp/shop"), id: "fork" };

  it("resumes the provider copy and marks where it was cut", () => {
    const plan = planFork(source({ branch: "login" }))!;
    const fork = forkedSession({
      source: source({ branch: "login" }),
      plan,
      fresh,
      dividerId: "div",
      providerSessionId: "thread-2",
    });
    expect(fork.id).toBe("fork");
    expect(fork.providerSessionId).toBe("thread-2");
    expect(fork.handoffCard).toBeUndefined();
    expect(fork.branch).toBe("login");
    expect(fork.title).toBe("codex · Login page (fork)");
    expect(fork.blocks.at(-1)).toMatchObject({
      id: "div",
      role: "system",
      forkPoint: { fromSessionId: "src", fromTitle: "Login page" },
    });
    // The divider sits on its own row, not inside the last copied turn.
    expect(groupTurns(fork.blocks).at(-1)).toHaveLength(1);
  });

  it("carries a recap when the provider could not copy the conversation", () => {
    const plan = planFork(source())!;
    const fork = forkedSession({
      source: source(),
      plan,
      fresh,
      dividerId: "div",
      providerSessionId: null,
    });
    expect(fork.providerSessionId).toBeUndefined();
    expect(fork.handoffCard?.brief).toContain("Build it");
  });

  it("does not offer to edit a copied turn, only the fork's own", () => {
    const plan = planFork(source())!;
    const fork = forkedSession({
      source: source(),
      plan,
      fresh,
      dividerId: "div",
      providerSessionId: "thread-2",
    });
    expect(isForkedCopy(fork.blocks, "u2")).toBe(true);
    expect(canEditLastTurn(fork)).toBe(false);
    const next: Session = {
      ...fork,
      blocks: [
        ...fork.blocks,
        { id: "u3", role: "user", text: "More", providerTurnId: "t3" },
        { id: "a3", role: "assistant", text: "Done" },
      ],
    };
    expect(isForkedCopy(next.blocks, "u3")).toBe(false);
    expect(canEditLastTurn(next)).toBe(true);
  });

  it("titles an untitled chat", () => {
    expect(forkTitle(source({ title: "codex" }))).toBe("codex · Chat (fork)");
  });
});
