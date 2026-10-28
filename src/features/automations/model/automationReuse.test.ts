import { describe, expect, it } from "vitest";
import { newSession } from "../../sessions/model/session";
import type { Automation } from "./automations";
import {
  PREVIOUS_BUSY,
  PREVIOUS_GONE,
  PREVIOUS_MISMATCH,
  previousConversation,
} from "./automationReuse";

const automation = {
  id: "audit",
  harness: "codex",
  cwd: "/repo",
  workspaceMode: "current",
  reuseSession: true,
  lastSessionId: "last",
} as Automation;

const previous = () => ({ ...newSession("codex", "/repo"), id: "last" });

describe("continuing the last automation run", () => {
  it("continues the previous conversation, even one loaded back from history", () => {
    const loaded = previous();
    expect(previousConversation(automation, loaded, new Set())).toEqual({
      kind: "reuse",
      session: loaded,
    });
  });

  it("skips the run instead of forking while the previous one works", () => {
    expect(
      previousConversation(automation, { ...previous(), busy: true }, new Set()),
    ).toEqual({ kind: "busy", reason: PREVIOUS_BUSY });
    expect(
      previousConversation(automation, previous(), new Set(["last"])),
    ).toEqual({ kind: "busy", reason: PREVIOUS_BUSY });
  });

  it("says why it starts a new conversation", () => {
    expect(previousConversation(automation, null, new Set())).toEqual({
      kind: "new",
      note: PREVIOUS_GONE,
    });
    expect(
      previousConversation(
        automation,
        { ...previous(), harness: "claude" },
        new Set(),
      ),
    ).toEqual({ kind: "new", note: PREVIOUS_MISMATCH });
  });

  it("starts fresh without a note when continuing is off", () => {
    expect(
      previousConversation({ ...automation, reuseSession: false }, previous(), new Set()),
    ).toEqual({ kind: "new" });
    expect(
      previousConversation(
        { ...automation, workspaceMode: "worktree" },
        previous(),
        new Set(),
      ),
    ).toEqual({ kind: "new" });
  });
});
