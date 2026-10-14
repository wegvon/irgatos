import { describe, expect, it } from "vitest";
import {
  DELIVERY_ACK_TIMEOUT_MS,
  DELIVERY_PROGRESS_TIMEOUT_MS,
  DELIVERY_TOOL_TIMEOUT_MS,
  createProgressTracker,
  deliveryBlock,
  isDeliveryStalled,
  progressSignature,
  toolInFlight,
} from "./deliveryGuards";
import type { Block, Session } from "./session";

const block = (patch: Partial<Block> = {}): Block => ({
  id: `b${Math.random()}`,
  role: "assistant",
  text: "",
  ...patch,
});

const target = (patch: Partial<Session> = {}) =>
  ({ id: "s1", blocks: [], busy: false, ...patch }) as Pick<
    Session,
    "id" | "blocks" | "busy" | "pendingQuestion"
  >;

describe("deliveryBlock", () => {
  it("is null for a session free to take a prompt", () => {
    expect(deliveryBlock(target())).toBeNull();
    expect(
      deliveryBlock(target({ blocks: [block({ approval: { requestId: 1, decided: "allow" } })] })),
    ).toBeNull();
  });

  it("reports an undecided approval", () => {
    expect(
      deliveryBlock(target({ blocks: [block({ role: "tool", approval: { requestId: 1 } })] })),
    ).toBe("approval");
  });

  it("puts a pending question first", () => {
    expect(
      deliveryBlock(
        target({
          pendingQuestion: { requestId: 3, questions: [] } as unknown as Session["pendingQuestion"],
          blocks: [block({ approval: { requestId: 1 } })],
        }),
      ),
    ).toBe("question");
  });
});

describe("progressSignature", () => {
  it("changes with new blocks, streamed text, tool status and busy", () => {
    const a = block({ id: "a", text: "he", streaming: true });
    const base = progressSignature({ blocks: [a], busy: true });
    expect(progressSignature({ blocks: [a], busy: true })).toBe(base);
    expect(progressSignature({ blocks: [{ ...a, text: "hello" }], busy: true })).not.toBe(base);
    expect(progressSignature({ blocks: [a, block({ id: "b" })], busy: true })).not.toBe(base);
    expect(progressSignature({ blocks: [a], busy: false })).not.toBe(base);
    const tool = block({ id: "t", role: "tool", tool: { status: "pending" } });
    expect(progressSignature({ blocks: [tool], busy: true })).not.toBe(
      progressSignature({ blocks: [{ ...tool, tool: { status: "completed" } }], busy: true }),
    );
  });
});

describe("createProgressTracker", () => {
  it("records when each session last changed and forgets closed ones", () => {
    const tracker = createProgressTracker();
    const s = target({ blocks: [block({ id: "x" })] });
    tracker.observe([s], 100);
    tracker.observe([s], 200);
    expect(tracker.lastProgressAt("s1")).toBe(100);
    tracker.observe([{ ...s, busy: true }], 300);
    expect(tracker.lastProgressAt("s1")).toBe(300);
    tracker.observe([], 400);
    expect(tracker.lastProgressAt("s1")).toBeUndefined();
  });
});

describe("toolInFlight", () => {
  it("is true while the last block is an unfinished tool call", () => {
    expect(toolInFlight(target({ blocks: [block({ role: "tool", tool: { status: "in_progress" } })] }))).toBe(true);
    expect(toolInFlight(target({ blocks: [block({ role: "tool", tool: {} })] }))).toBe(true);
    expect(toolInFlight(target({ blocks: [block({ role: "tool", tool: { status: "completed" } })] }))).toBe(false);
    expect(toolInFlight(target({ blocks: [block()] }))).toBe(false);
  });
});

describe("isDeliveryStalled", () => {
  it("gives an idle target the short ack window", () => {
    const base = { dispatchedAt: 0, busy: false };
    expect(isDeliveryStalled({ ...base, now: DELIVERY_ACK_TIMEOUT_MS - 1 })).toBe(false);
    expect(isDeliveryStalled({ ...base, now: DELIVERY_ACK_TIMEOUT_MS })).toBe(true);
  });

  it("counts a running target from its last progress", () => {
    const base = { dispatchedAt: 0, busy: true, lastProgressAt: 50_000 };
    expect(isDeliveryStalled({ ...base, now: 50_000 + DELIVERY_PROGRESS_TIMEOUT_MS - 1 })).toBe(
      false,
    );
    expect(isDeliveryStalled({ ...base, now: 50_000 + DELIVERY_PROGRESS_TIMEOUT_MS })).toBe(true);
  });

  it("waits much longer while a tool call runs", () => {
    const base = { dispatchedAt: 0, busy: true, toolRunning: true };
    expect(isDeliveryStalled({ ...base, now: DELIVERY_PROGRESS_TIMEOUT_MS })).toBe(false);
    expect(isDeliveryStalled({ ...base, now: DELIVERY_TOOL_TIMEOUT_MS })).toBe(true);
  });
});
