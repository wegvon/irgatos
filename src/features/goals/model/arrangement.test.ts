import { describe, expect, it } from "vitest";
import { differsFromCurrent, recommendArrangement, workParts } from "./arrangement";

const all = { canPlan: true, canOrchestrate: true, canWorktree: true };

describe("recommended arrangement", () => {
  it("stays quiet for short drafts, commands and questions", () => {
    expect(recommendArrangement("fix it", all)).toBeUndefined();
    expect(recommendArrangement("/plan the export rewrite now", all)).toBeUndefined();
    expect(recommendArrangement("How does the export pipeline handle retries?", all)).toBeUndefined();
    expect(recommendArrangement("Explain the deploy script to me please", all)).toBeUndefined();
  });

  it("keeps a small fix in one agent, in the folder", () => {
    expect(recommendArrangement("Fix the typo in the settings header", all)).toMatchObject({
      mode: "direct",
      worktree: false,
      title: "One agent",
    });
  });

  it("plans a bigger change first in its own worktree", () => {
    const result = recommendArrangement("Refactor the mail sync so accounts load in parallel", all)!;
    expect(result).toMatchObject({ mode: "plan", worktree: true, title: "Plan first · own worktree" });
    expect(result.benefit).toMatch(/agree on the approach/);
    expect(
      recommendArrangement("Refactor the mail sync so accounts load in parallel", { canPlan: true }),
    ).toMatchObject({ mode: "plan", worktree: false, title: "Plan first" });
  });

  it("suggests a team when the work has separate parts", () => {
    const text = "Ship the onboarding:\n- new welcome screen\n- import from Gmail\n- docs page";
    expect(workParts(text)).toBe(3);
    expect(recommendArrangement(text, all)).toMatchObject({
      mode: "orchestrate",
      title: "Team of agents · own worktree",
    });
    expect(recommendArrangement(text, { canPlan: true })?.mode).toBe("plan");
  });

  it("only shows when it would change the setup", () => {
    const plan = recommendArrangement("Migrate the settings store to SQLite", all)!;
    expect(differsFromCurrent(plan, { mode: "plan", worktree: true })).toBe(false);
    expect(differsFromCurrent(plan, { mode: "direct", worktree: true })).toBe(true);
    expect(differsFromCurrent(plan, { mode: "plan", worktree: false })).toBe(true);
  });
});
