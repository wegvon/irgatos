import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSession, type Block, type Session } from "../../sessions/model/session";
import {
  applyCriteriaCheck,
  criteriaInBlocks,
  goalCriteriaBlocks,
  parseCriteria,
  parseCriteriaCheck,
  renderCriteriaMarkdown,
} from "./criteria";
import { syncGoals } from "./goals";
import { loadGoals, resetGoalCache, saveGoals, setGoalCriteria } from "./goalStore";
import { planGoalContext, recordGoalContext } from "./goalContext";

const REPLY = `<completion_criteria>
- The Export button downloads a CSV in Safari
- The file opens in Numbers with the right columns
</completion_criteria>

Starting with the click handler.`;

const DELIVERY = `Done.

<criteria_check>
- [met] The Export button downloads a CSV in Safari — tested in Safari 18
- [unverified] The file opens in Numbers with the right columns — Numbers is not installed here
</criteria_check>`;

describe("criteria text", () => {
  it("reads the criteria and the check from a reply", () => {
    expect(parseCriteria(REPLY)).toEqual([
      "The Export button downloads a CSV in Safari",
      "The file opens in Numbers with the right columns",
    ]);
    expect(parseCriteriaCheck(DELIVERY)).toEqual([
      {
        text: "The Export button downloads a CSV in Safari",
        verdict: "met",
        evidence: "tested in Safari 18",
      },
      {
        text: "The file opens in Numbers with the right columns",
        verdict: "unverified",
        evidence: "Numbers is not installed here",
      },
    ]);
    expect(parseCriteria("<completion_criteria>\n- half")).toBeUndefined();
  });

  it("matches verdicts by position, or by shared words when the list changed", () => {
    const criteria = [{ text: "Export works in Safari" }, { text: "Tests pass" }];
    expect(
      applyCriteriaCheck(criteria, [
        { text: "x", verdict: "met" },
        { text: "y", verdict: "unmet" },
      ]).map((c) => c.verdict),
    ).toEqual(["met", "unmet"]);
    expect(
      applyCriteriaCheck(criteria, [{ text: "Safari export works now", verdict: "met" }]),
    ).toEqual([{ text: "Export works in Safari", verdict: "met" }, { text: "Tests pass" }]);
  });

  it("shows the tags as readable lists, also mid-stream", () => {
    const shown = renderCriteriaMarkdown(`${REPLY}\n\n${DELIVERY}`);
    expect(shown).toContain("**Done when**");
    expect(shown).toContain("**Checked against the goal**");
    expect(shown).toContain("- ✓ The Export button downloads a CSV in Safari");
    expect(shown).toContain("- ? The file opens");
    expect(shown).not.toContain("<");
    expect(renderCriteriaMarkdown("<completion_criteria>\n- one\n</complet")).not.toContain("</complet");
    const blocks: Block[] = [{ id: "a", role: "assistant", text: "plain" }];
    expect(goalCriteriaBlocks(blocks)).toBe(blocks);
  });

  it("takes the newest finished criteria and a later check", () => {
    const blocks: Block[] = [
      { id: "u1", role: "user", text: "Fix export", startedAt: 10 },
      { id: "a1", role: "assistant", text: REPLY },
      { id: "u2", role: "user", text: "go on", startedAt: 20 },
      { id: "a2", role: "assistant", text: DELIVERY },
      { id: "a3", role: "assistant", text: "<criteria_check>\n- [met] x", streaming: true },
    ];
    const found = criteriaInBlocks(blocks);
    expect(found.criteria).toHaveLength(2);
    expect(found.check?.[0].verdict).toBe("met");
    expect(found.at).toBe(20);
  });
});

describe("criteria on goals", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    resetGoalCache();
  });

  const chat = (id: string, blocks: Block[], patch: Partial<Session> = {}): Session => ({
    ...newSession("claude", "/repo"),
    id,
    title: "claude",
    blocks,
    ...patch,
  });

  it("keeps the main chat's criteria and verdicts on its goal", () => {
    const session = chat("a", [
      { id: "u1", role: "user", text: "Fix export", startedAt: 10 },
      { id: "a1", role: "assistant", text: `${REPLY}\n\n${DELIVERY}` },
    ]);
    const [goal] = syncGoals([], [session], { now: 100 });
    expect(goal.criteria).toEqual([
      { text: "The Export button downloads a CSV in Safari", verdict: "met", evidence: "tested in Safari 18" },
      { text: "The file opens in Numbers with the right columns", verdict: "unverified", evidence: "Numbers is not installed here" },
    ]);
    expect(goal.criteriaFrom).toBe("a");
    expect(goal.checkedAt).toBe(10);
  });

  it("ignores a worker's own criteria", () => {
    const lead = chat("lead", [{ id: "u", role: "user", text: "Ship", startedAt: 1 }]);
    const worker = chat("w", [
      { id: "u", role: "user", text: "Part", startedAt: 2 },
      { id: "a", role: "assistant", text: REPLY },
    ], { orchestrationLeadId: "lead" });
    const [goal] = syncGoals([], [lead, worker], { now: 100 });
    expect(goal.criteria).toBeUndefined();
  });

  it("hands criteria out once: drafting first, then to chats that join or after edits", () => {
    expect(planGoalContext("new", true).context).toContain("<completion_criteria>");
    expect(planGoalContext("new", false)).toEqual({});

    const author = chat("a", [
      { id: "u1", role: "user", text: "Fix export", startedAt: 10 },
      { id: "a1", role: "assistant", text: REPLY },
    ]);
    saveGoals(syncGoals([], [author], { now: 100 }));
    // The author already knows its own criteria.
    expect(planGoalContext("a", false)).toEqual({});

    const goal = loadGoals()[0];
    saveGoals([
      { ...goal, links: [...goal.links, { sessionId: "b", role: "chat", addedAt: 0, title: "", harness: "claude", workCwd: "/repo" }] },
    ]);
    const joined = planGoalContext("b", true);
    expect(joined.context).toContain("The Export button downloads a CSV in Safari");
    recordGoalContext("b", joined.version!);
    expect(planGoalContext("b", false)).toEqual({});

    setGoalCriteria(goal.id, ["- Works in Safari and Chrome"]);
    expect(loadGoals()[0]).toMatchObject({ criteriaEdited: true, criteria: [{ text: "Works in Safari and Chrome" }] });
    expect(planGoalContext("a", false).context).toContain("Works in Safari and Chrome");
    expect(planGoalContext("b", false).context).toContain("Works in Safari and Chrome");
  });

  it("does not let an agent's list replace the user's own criteria", () => {
    const session = chat("a", [
      { id: "u1", role: "user", text: "Fix export", startedAt: 10 },
      { id: "a1", role: "assistant", text: REPLY },
    ]);
    saveGoals(syncGoals([], [session], { now: 100 }));
    setGoalCriteria(loadGoals()[0].id, ["Mine"]);
    const next = syncGoals(loadGoals(), [session], { now: 200 });
    expect(next[0].criteria).toEqual([{ text: "Mine" }]);
  });
});
