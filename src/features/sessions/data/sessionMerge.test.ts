import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "../model/session";
import { headerSnapshot, rebaseSession, storedWindow } from "./sessionMerge";

const block = (id: string, text = id): Block => ({ id, role: "user", text });

function base(session: Session) {
  return {
    revision: 1,
    lineage: undefined,
    blocks: session.blocks,
    header: headerSnapshot(session),
  };
}

describe("rebaseSession", () => {
  it("keeps older Irgat pages that the stored page does not cover", () => {
    const local: Session = {
      ...newSession("codex", "/tmp"),
      blocks: [block("old1"), block("old2"), block("u1"), block("a1")],
    };
    const remote: Session = {
      ...local,
      blocks: [block("u1"), block("a1"), block("u2")],
      irgatTranscript: { before: 3, firstBlockId: "u1" },
    };
    const merged = rebaseSession(local, base(local), remote);
    expect(merged.session.blocks.map((entry) => entry.id)).toEqual([
      "old1",
      "old2",
      "u1",
      "a1",
      "u2",
    ]);
    expect(merged.dirty).toBe(false);
    expect(storedWindow(local, remote).map((entry) => entry.id)).toEqual([
      "old1",
      "old2",
      "u1",
      "a1",
      "u2",
    ]);
  });

  it("keeps each side's header change", () => {
    const local: Session = { ...newSession("codex", "/tmp"), title: "Old" };
    const synced = base(local);
    const remote: Session = { ...local, providerSessionId: "thread-1" };
    const merged = rebaseSession({ ...local, title: "Mine" }, synced, remote);
    expect(merged.session.title).toBe("Mine");
    expect(merged.session.providerSessionId).toBe("thread-1");
    expect(merged.dirty).toBe(true);
  });

  it("prefers this window's edit of a block and drops blocks removed elsewhere", () => {
    const shared = block("a", "draft");
    const gone = block("b");
    const local: Session = { ...newSession("codex", "/tmp"), blocks: [shared, gone] };
    const synced = base(local);
    const edited = { ...local, blocks: [block("a", "final"), gone] };
    const remote: Session = { ...local, blocks: [block("a", "remote")] };
    const merged = rebaseSession(edited, synced, remote);
    expect(merged.session.blocks.map((entry) => entry.text)).toEqual(["final"]);
  });
});
