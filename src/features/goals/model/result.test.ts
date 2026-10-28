import { describe, expect, it } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import { parseLimitations, renderCriteriaMarkdown } from "./criteria";
import { goalView, syncGoals } from "./goals";
import { deliveryChecks, deliverySummary, goalResult } from "./result";

const shell = (id: string, query: string, status: string): Block => ({
  id,
  role: "tool",
  text: query,
  tool: { kind: "execute", status, preview: { kind: "shell", query } },
});

const REPLY = `Export now works in Safari. Run it at http://localhost:5173/export.

<criteria_check>
- [met] Export downloads a CSV in Safari — clicked it in Safari 18
- [unverified] Opens in Numbers — Numbers is not installed
</criteria_check>

<known_limitations>
- Very large exports (over 50k rows) are still slow
</known_limitations>`;

function setup(patch: Partial<Session> = {}, extra: Session[] = []) {
  const session: Session = {
    ...newSession("claude", "/repo"),
    id: "a",
    title: "claude · Fix Safari export",
    blocks: [
      { id: "u1", role: "user", text: "Fix Safari export", startedAt: 10, durationMs: 5 },
      {
        id: "a0",
        role: "assistant",
        text: "<completion_criteria>\n- Export downloads a CSV in Safari\n- Opens in Numbers\n</completion_criteria>\nOn it.",
      },
      shell("t1", "npm test", "failed"),
      shell("t2", "npm test", "completed"),
      shell("t3", "ls -la", "completed"),
      shell("t4", "npx tsc --noEmit", "completed"),
      {
        id: "w",
        role: "tool",
        text: "Write",
        tool: { kind: "edit", status: "completed", preview: { kind: "write", path: "/repo/preview.html" } },
      },
      { id: "a1", role: "assistant", text: REPLY },
    ],
    ...patch,
  };
  const sessions = [session, ...extra];
  const [goal] = syncGoals([], sessions, { now: 100 });
  const byId = new Map(sessions.map((entry) => [entry.id, entry]));
  return { view: goalView(goal, byId, { now: 100 }), byId };
}

describe("goal result", () => {
  it("reads limitations and shows them in the chat", () => {
    expect(parseLimitations(REPLY)).toEqual(["Very large exports (over 50k rows) are still slow"]);
    expect(parseLimitations("<known_limitations>\n- None\n</known_limitations>")).toBeUndefined();
    expect(renderCriteriaMarkdown(REPLY)).toContain("**Known limitations**");
    expect(renderCriteriaMarkdown("Working on it <crit")).toBe("Working on it ");
  });

  it("summarises the delivery without its tagged lists", () => {
    expect(deliverySummary(REPLY)).toBe(
      "Export now works in Safari. Run it at http://localhost:5173/export.",
    );
    expect(deliverySummary(`${"word ".repeat(100)}\n\n${"more ".repeat(200)}`)).toMatch(/…$/);
  });

  it("keeps the newest run of each check and ignores other commands", () => {
    const { byId } = setup();
    expect(deliveryChecks(byId.get("a")!.blocks, 0)).toEqual([
      { label: "npm test", state: "passed" },
      { label: "npx tsc --noEmit", state: "passed" },
    ]);
  });

  it("puts verification, previews and limitations together", () => {
    const { view, byId } = setup();
    const result = goalResult(view, byId, {
      gateStatus: () => ({
        state: "verified",
        command: "npm run check",
        timedOut: false,
        durationMs: 1,
        at: 1,
        attempts: 1,
      }),
    })!;
    expect(result.sessionId).toBe("a");
    expect(result.checks[0]).toEqual({
      label: "Completion Gate",
      command: "npm run check",
      state: "passed",
      gate: true,
    });
    expect(result.previews.map((preview) => preview.kind)).toEqual(["url", "artifact"]);
    expect(result.previews[0].url).toBe("http://localhost:5173/export");
    expect(result.previews[1].artifact?.path).toBe("/repo/preview.html");
    expect(result.limitations).toEqual([
      "Very large exports (over 50k rows) are still slow",
      "Not verified: Opens in Numbers (Numbers is not installed)",
    ]);
  });

  it("waits until a chat has finished delivering", () => {
    const { view, byId } = setup({ busy: true });
    expect(goalResult(view, byId)).toBeUndefined();
  });
});
