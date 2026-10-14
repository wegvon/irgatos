import { describe, expect, it } from "vitest";
import type { Block, TaskListItem } from "../../sessions/model/session";
import { adhdFocus, adhdFocusLabel, nextStepLine } from "./adhdFocus";

let ids = 0;
const block = (role: Block["role"], text = "", extra: Partial<Block> = {}) =>
  ({ id: `b${(ids += 1)}`, role, text, ...extra }) as Block;
const tasks = (items: TaskListItem[]) =>
  block("tasks", "", { taskList: { items } });

describe("nextStepLine", () => {
  it("finds the reply's Next: line in its common markdown shapes", () => {
    expect(nextStepLine("Done.\n\nNext: run `npm test`")).toBe("run `npm test`");
    expect(nextStepLine("**Next:** open `/login`")).toBe("open `/login`");
    expect(nextStepLine("- Next step: paste the failing line")).toBe(
      "paste the failing line",
    );
    expect(nextStepLine("Sonraki adım: [README](README.md) dosyasını aç")).toBe(
      "README dosyasını aç",
    );
  });

  it("keeps the last one and skips code blocks", () => {
    expect(nextStepLine("Next: first\n\nNext: second")).toBe("second");
    expect(nextStepLine("Next: real\n```\nNext: inside code\n```")).toBe(
      "real",
    );
  });

  it("ignores lines that only mention next", () => {
    expect(nextStepLine("The next release ships Monday.")).toBeUndefined();
    expect(nextStepLine("Next:")).toBeUndefined();
    expect(nextStepLine("")).toBeUndefined();
  });
});

describe("adhdFocus", () => {
  it("shows where a running agent is in its task list", () => {
    const blocks = [
      block("user", "ship it"),
      tasks([
        { text: "Update schema", status: "completed" },
        { text: "**Backfill** column", status: "in_progress" },
        { text: "Run tests", status: "pending" },
        { text: "Dropped", status: "cancelled" },
      ]),
    ];
    const focus = adhdFocus(blocks, true);
    expect(focus).toEqual({
      kind: "progress",
      done: 1,
      total: 3,
      current: "Backfill column",
    });
    expect(adhdFocusLabel(focus!, true)).toBe("Step 2 of 3: Backfill column");
  });

  it("uses the latest snapshot of the list in the current turn only", () => {
    const blocks = [
      block("user", "first"),
      tasks([{ text: "Old", status: "in_progress" }]),
      block("assistant", "Next: stale"),
      block("user", "second"),
      tasks([{ text: "A", status: "pending" }]),
      tasks([{ text: "A", status: "completed" }, { text: "B", status: "pending" }]),
    ];
    expect(adhdFocus(blocks, true)).toEqual({
      kind: "progress",
      done: 1,
      total: 2,
      current: "B",
    });
  });

  it("prefers the finished reply's next step over the task list", () => {
    const blocks = [
      block("user", "fix"),
      tasks([{ text: "Fix", status: "completed" }]),
      block("assistant", "Login works.\n\nNext: try `npm run dev`"),
    ];
    expect(adhdFocus(blocks, false)).toEqual({
      kind: "next",
      text: "try `npm run dev`",
    });
    expect(adhdFocusLabel(adhdFocus(blocks, false)!, false)).toBe(
      "Next: try `npm run dev`",
    );
  });

  it("makes a finished list visible when the reply has no next step", () => {
    const blocks = [
      block("user", "fix"),
      tasks([
        { text: "One", status: "completed" },
        { text: "Two", status: "completed" },
      ]),
      block("assistant", "All done."),
    ];
    const focus = adhdFocus(blocks, false)!;
    expect(adhdFocusLabel(focus, false)).toBe("2 of 2 done");
  });

  it("names what is left when a turn stopped partway", () => {
    const focus = adhdFocus(
      [
        block("user", "go"),
        tasks([
          { text: "One", status: "completed" },
          { text: "Two", status: "pending" },
        ]),
      ],
      false,
    )!;
    expect(adhdFocusLabel(focus, false)).toBe("1 of 2 done · next: Two");
  });

  it("ignores a reply that is still streaming, drafts and hidden turns", () => {
    expect(
      adhdFocus(
        [block("user", "go"), block("assistant", "Next: soon", { streaming: true })],
        false,
      ),
    ).toBeNull();
    expect(
      adhdFocus(
        [
          block("user", "go"),
          block("assistant", "Next: keep this"),
          block("user", "later", { draft: true }),
          block("user", "app", { internal: true }),
        ],
        false,
      ),
    ).toEqual({ kind: "next", text: "keep this" });
  });

  it("has nothing to show for an empty chat or a plain reply", () => {
    expect(adhdFocus([], false)).toBeNull();
    expect(adhdFocus([block("user", "hi"), block("assistant", "Hello")], false))
      .toBeNull();
    expect(adhdFocus([block("user", "hi")], true)).toBeNull();
  });
});
