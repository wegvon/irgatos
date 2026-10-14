import { describe, expect, it } from "vitest";
import type { Block, Session } from "./session";
import { createProgressTracker } from "./deliveryGuards";
import {
  formatSessionMessagePrompt,
  guardSessionMessages,
  messageForTurn,
  sessionMessagesNeedGuard,
  messagesAtBlocks,
  pendingIncomingMessages,
  reconcileSessionMessages,
  sessionActivity,
  sessionMessageHeader,
  sessionMessageJump,
  sessionMessageTargets,
  type InterSessionMessage,
} from "./sessionMessaging";

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "claude:opus",
    modelSettings: {},
    runtimeMode: "default" as Session["runtimeMode"],
    title: `Session ${id}`,
    cwd: "/repo/app",
    blocks: [],
    ...patch,
  };
}

function message(patch: Partial<InterSessionMessage> = {}): InterSessionMessage {
  return {
    id: "m1",
    fromSessionId: "a",
    fromTitle: "API work",
    toSessionId: "b",
    toTitle: "Frontend",
    text: "Run the e2e suite\nand report failures.",
    mode: "run",
    origin: "user",
    status: "queued",
    createdAt: 1_000,
    hop: 0,
    ...patch,
  };
}

const user = (id: string, text: string, startedAt = 2_000): Block => ({
  id,
  role: "user",
  text,
  startedAt,
});
const reply = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id,
  role: "assistant",
  text,
  ...extra,
});

describe("formatSessionMessagePrompt", () => {
  it("labels the message with the sender", () => {
    expect(
      formatSessionMessagePrompt({ fromTitle: "API work", text: " Hi there " }),
    ).toBe('[Message from session "API work"]\n\nHi there');
  });

  it("keeps quotes and newlines out of the header", () => {
    expect(sessionMessageHeader('Fix "login"\nflow')).toBe(
      '[Message from session "Fix login flow"]',
    );
  });

  it("asks for an answer and marks replies", () => {
    expect(
      formatSessionMessagePrompt({
        fromTitle: "API",
        text: "Which port?",
        expectReply: true,
      }),
    ).toContain('your reply is sent back to "API"');
    expect(
      formatSessionMessagePrompt({
        fromTitle: "Frontend",
        text: "Port 4100.",
        inReplyTo: "m1",
      }),
    ).toBe('[Reply from session "Frontend"]\n\nPort 4100.');
  });
});

describe("reconcileSessionMessages", () => {
  it("delivers a queued message once a user turn carries it", () => {
    const sent = message();
    const target = session("b", {
      busy: true,
      blocks: [user("u1", formatSessionMessagePrompt(sent), 2_500)],
    });
    expect(reconcileSessionMessages([sent], [target], 3_000)).toEqual([
      {
        id: "m1",
        patch: { deliveredBlockId: "u1", status: "delivered", deliveredAt: 2_500 },
      },
    ]);
  });

  it("waits for the turn to finish before calling it replied", () => {
    const sent = message({ status: "delivered", deliveredBlockId: "u1" });
    const blocks = [
      user("u1", formatSessionMessagePrompt(sent)),
      reply("r1", "Running the suite now"),
    ];
    expect(
      reconcileSessionMessages([sent], [session("b", { busy: true, blocks })]),
    ).toEqual([]);
    expect(
      reconcileSessionMessages([sent], [session("b", { blocks })], 9_000),
    ).toEqual([
      {
        id: "m1",
        patch: {
          status: "replied",
          repliedAt: 9_000,
          replyBlockId: "r1",
          replyText: "Running the suite now",
        },
      },
    ]);
  });

  it("counts a reply that a later turn followed even while the session runs", () => {
    const sent = message({ status: "delivered", deliveredBlockId: "u1" });
    const target = session("b", {
      busy: true,
      blocks: [
        user("u1", formatSessionMessagePrompt(sent)),
        reply("r1", "All green.", { streaming: false }),
        user("u2", "next thing"),
      ],
    });
    expect(reconcileSessionMessages([sent], [target], 5)).toEqual([
      expect.objectContaining({ patch: expect.objectContaining({ status: "replied" }) }),
    ]);
  });

  it("ignores turns older than the message and blocks another message claimed", () => {
    const first = message({ id: "m1", createdAt: 10_000 });
    const second = message({ id: "m2", createdAt: 11_000 });
    const prompt = formatSessionMessagePrompt(first);
    const target = session("b", {
      busy: true,
      blocks: [user("old", prompt, 1_000), user("u1", prompt, 12_000)],
    });
    const patches = reconcileSessionMessages([second, first], [target], 13_000);
    expect(patches).toEqual([
      expect.objectContaining({
        id: "m1",
        patch: expect.objectContaining({ deliveredBlockId: "u1" }),
      }),
    ]);
  });

  it("matches a composer message by its header even after edits", () => {
    const sent = message({ mode: "composer", status: "delivered", deliveredAt: 1_500 });
    const target = session("b", {
      busy: true,
      blocks: [user("u1", `${sessionMessageHeader("API work")}\n\nEdited text`)],
    });
    expect(reconcileSessionMessages([sent], [target])).toEqual([
      { id: "m1", patch: { deliveredBlockId: "u1" } },
    ]);
  });

  it("leaves finished and failed messages alone", () => {
    const target = session("b", { blocks: [user("u1", "anything")] });
    expect(
      reconcileSessionMessages(
        [message({ status: "failed" }), message({ id: "m2", status: "replied" })],
        [target],
      ),
    ).toEqual([]);
  });
});

describe("sessionMessageTargets", () => {
  it("lists siblings first, then running, then recent, without the sender", () => {
    const sessions = [
      session("a"),
      session("other", { cwd: "/repo/other", busy: true }),
      session("idle", { blocks: [user("u", "x", 100)] }),
      session("busy", { busy: true }),
      session("hidden", { ephemeral: true }),
    ];
    const rows = sessionMessageTargets(sessions, "a", (s) => !s.ephemeral);
    expect(rows.map((row) => [row.session.id, row.sibling, row.activity])).toEqual([
      ["busy", true, "running"],
      ["idle", true, "idle"],
      ["other", false, "running"],
    ]);
  });
});

describe("sessionActivity", () => {
  it("prefers input requests over running and queued work", () => {
    expect(
      sessionActivity(
        session("x", {
          busy: true,
          blocks: [{ id: "p", role: "approval", text: "", approval: { requestId: 1 } }],
        }),
      ),
    ).toBe("needs-input");
    expect(
      sessionActivity(
        session("x", {
          queuedMessages: [{ id: "q", text: "later", attachments: [] }],
        }),
      ),
    ).toBe("queued");
    expect(sessionActivity(session("x"))).toBe("idle");
  });
});

describe("message anchors", () => {
  const delivered = message({
    status: "delivered",
    sourceBlockId: "src",
    deliveredBlockId: "u1",
    replyBlockId: "r1",
  });

  it("shows outgoing pills on the sender and incoming ones on the target", () => {
    expect(messagesAtBlocks([delivered], "a", ["src"])).toEqual([
      { message: delivered, direction: "outgoing" },
    ]);
    expect(messagesAtBlocks([delivered], "b", ["u1"])).toEqual([
      { message: delivered, direction: "incoming" },
    ]);
    expect(messagesAtBlocks([delivered], "b", ["src"])).toEqual([]);
  });

  it("jumps to the other end of the message", () => {
    expect(
      sessionMessageJump({ message: delivered, direction: "outgoing" }),
    ).toEqual({ sessionId: "b", blockId: "r1" });
    expect(
      sessionMessageJump({ message: delivered, direction: "incoming" }),
    ).toEqual({ sessionId: "a", blockId: "src" });
  });

  it("lists incoming messages no turn carries yet", () => {
    const waiting = message({ id: "w", mode: "composer", status: "delivered" });
    expect(
      pendingIncomingMessages([delivered, waiting, message({ id: "f", status: "failed" })], "b"),
    ).toEqual([waiting]);
  });

  it("finds the message that started the turn a block belongs to", () => {
    const target = session("b", {
      blocks: [user("u1", "msg"), reply("r1", "a"), reply("r2", "b")],
    });
    expect(messageForTurn([delivered], target, "r2")).toBe(delivered);
    expect(messageForTurn([delivered], target, "missing")).toBeUndefined();
  });
});

describe("guardSessionMessages", () => {
  const waiting = (id: string) =>
    session(id, {
      busy: true,
      blocks: [{ id: `${id}-t`, role: "tool", text: "", approval: { requestId: 1 } }],
    });

  it("releases held messages oldest first once the target is free", () => {
    const progress = createProgressTracker();
    const messages = [
      message({ id: "late", status: "blocked", blockedBy: "approval", createdAt: 2_000 }),
      message({ id: "early", status: "blocked", blockedBy: "approval", createdAt: 1_000 }),
    ];
    const held = guardSessionMessages(messages, [waiting("b")], progress, 3_000);
    expect(held).toEqual({ patches: [], release: [] });
    const free = guardSessionMessages(messages, [session("b")], progress, 3_000);
    expect(free.release.map((entry) => entry.id)).toEqual(["early", "late"]);
  });

  it("ignores composer, delivered and finished messages and missing targets", () => {
    const progress = createProgressTracker();
    const result = guardSessionMessages(
      [
        message({ id: "c", mode: "composer", dispatchedAt: 0 }),
        message({ id: "d", status: "delivered", deliveredBlockId: "x", dispatchedAt: 0 }),
        message({ id: "f", status: "failed", dispatchedAt: 0 }),
        message({ id: "gone", toSessionId: "zz", dispatchedAt: 0 }),
      ],
      [waiting("b")],
      progress,
      999_999,
    );
    expect(result).toEqual({ patches: [], release: [] });
  });

  it("flags a stalled message blocked if the target starts asking", () => {
    const result = guardSessionMessages(
      [message({ status: "stalled", stalledAt: 5, dispatchedAt: 1 })],
      [waiting("b")],
      createProgressTracker(),
      10,
    );
    expect(result.patches).toEqual([
      { id: "m1", patch: { status: "blocked", blockedBy: "approval", stalledAt: undefined } },
    ]);
  });
});

describe("sessionMessagesNeedGuard", () => {
  it("is true only for held or dispatched run messages without a carrier", () => {
    expect(sessionMessagesNeedGuard([message()])).toBe(false);
    expect(sessionMessagesNeedGuard([message({ dispatchedAt: 1 })])).toBe(true);
    expect(sessionMessagesNeedGuard([message({ status: "blocked" })])).toBe(true);
    expect(sessionMessagesNeedGuard([message({ status: "stalled", dispatchedAt: 1 })])).toBe(false);
    expect(
      sessionMessagesNeedGuard([message({ dispatchedAt: 1, deliveredBlockId: "u" })]),
    ).toBe(false);
  });
});

describe("pendingIncomingMessages with guards", () => {
  it("includes held and stalled messages", () => {
    const pending = pendingIncomingMessages(
      [
        message({ id: "h", status: "blocked" }),
        message({ id: "s", status: "stalled", createdAt: 2 }),
        message({ id: "f", status: "failed" }),
      ],
      "b",
    );
    expect(pending.map((entry) => entry.id).sort()).toEqual(["h", "s"]);
  });
});
