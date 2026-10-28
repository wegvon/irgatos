import { describe, expect, it } from "vitest";
import { CONTINUE_PROMPT } from "../../sessions/model/inFlight";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { recoveryBrief } from "./recovery";

const user = (text: string, extra: Partial<Block> = {}): Block => ({
  id: `u-${text}`,
  role: "user",
  text,
  startedAt: 10,
  ...extra,
});

function chat(blocks: Block[], patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/repo"), id: "s", title: "claude", blocks, ...patch };
}

const steps: Block = {
  id: "t",
  role: "tasks",
  text: "",
  taskList: {
    items: [
      { text: "Find the bug", status: "completed" },
      { text: "Fix the handler", status: "in_progress" },
      { text: "Add a test", status: "pending" },
    ],
  },
};
const edit: Block = {
  id: "e",
  role: "tool",
  text: "Edit",
  tool: { kind: "edit", status: "completed", preview: { kind: "write", path: "/repo/src/export.ts" } },
};
const test: Block = {
  id: "x",
  role: "tool",
  text: "npm test",
  tool: { kind: "execute", status: "completed", preview: { kind: "shell", query: "npm test" } },
};

describe("recovery brief", () => {
  it("says what got done, what is kept and what is left after an interruption", () => {
    const brief = recoveryBrief(
      chat(
        [
          user("Fix the Safari export"),
          steps,
          edit,
          test,
          { id: "a", role: "assistant", text: "Working" },
          user(CONTINUE_PROMPT),
          { id: "n", role: "system", text: "Claude crashed", notice: "error" },
        ],
        {
          branch: "fix/export",
          providerSessionId: "p",
          queuedMessages: [{ id: "q", text: "also docs", attachments: [] }],
        },
      ),
      "interrupted",
      { nativeResume: true },
    )!;
    expect(brief.done).toEqual([
      "1 of 3 steps: Find the bug",
      "1 file changed (export.ts)",
      "Passed: npm test",
    ]);
    expect(brief.kept).toEqual([
      "This conversation",
      "The file changes, on fix/export",
      "1 message you queued",
    ]);
    expect(brief.left).toEqual(["Fix the handler", "Add a test"]);
    expect(brief.next).toBe("Resume picks up where it stopped. Finished work is not redone.");
  });

  it("explains a resend when the agent never answered, and a recap without a thread", () => {
    const unanswered = recoveryBrief(chat([user("Fix the Safari export")]), "interrupted")!;
    expect(unanswered.done).toEqual(["Nothing yet: it stopped before starting"]);
    expect(unanswered.left).toEqual(["Finish: Fix the Safari export"]);
    expect(unanswered.next).toMatch(/sends your request again/);
    const recap = recoveryBrief(
      chat([user("Fix it"), { id: "a", role: "assistant", text: "Looking" }]),
      "interrupted",
    )!;
    expect(recap.next).toMatch(/summary of this chat/);
  });

  it("recommends waiting for the reset or another model after a usage limit", () => {
    const brief = recoveryBrief(
      chat([user("Fix it"), steps], { usageLimit: { resetsAt: 2 * 60 * 60_000 } }),
      "limit",
      {
        now: 0,
        goal: {
          id: "g",
          title: "Fix it",
          request: "Fix it",
          cwd: "/repo",
          createdAt: 0,
          updatedAt: 0,
          links: [],
          criteria: [{ text: "Exports work", verdict: "met" }, { text: "Docs updated" }],
        },
      },
    )!;
    expect(brief.kept).toContain("The goal and its criteria");
    expect(brief.left).toContain("Check 1 of the goal's criteria");
    expect(brief.next).toMatch(/^Resume when the limit resets \(.+\), or pick another model now/);
  });
});
