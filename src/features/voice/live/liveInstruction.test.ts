import { describe, expect, it } from "vitest";
import { ADHD_RULES } from "../../adhd/model/adhdRules";
import type { Block } from "../../sessions/model/session";
import { liveSystemInstruction, recentTurns } from "./liveInstruction";

const block = (role: Block["role"], text: string, extra: Partial<Block> = {}): Block => ({
  id: crypto.randomUUID(),
  role,
  text,
  ...extra,
});

describe("recentTurns", () => {
  it("keeps the user's and the agent's words, newest last", () => {
    expect(
      recentTurns([
        block("user", "hello"),
        block("tool", "ls"),
        block("assistant", "hi\n\nthere"),
        block("user", "internal", { internal: true }),
        block("user", "draft", { draft: true }),
        block("assistant", "  "),
      ]),
    ).toEqual([
      { speaker: "user", text: "hello" },
      { speaker: "assistant", text: "hi there" },
    ]);
  });

  it("stops at the limit and shortens long turns", () => {
    const blocks = Array.from({ length: 30 }, (_, i) => block("user", `m${i} ${"x".repeat(900)}`));
    const turns = recentTurns(blocks, 5);
    expect(turns).toHaveLength(5);
    expect(turns[4].text.startsWith("m29")).toBe(true);
    expect(turns[0].text.length).toBe(600);
  });
});

describe("liveSystemInstruction", () => {
  it("carries the soul, memory, projects and recent conversation", () => {
    const text = liveSystemInstruction({
      name: "IrgatGhost",
      soul: "# Soul\nBe kind.",
      memory: "- 2026-10-01 · Uses pnpm",
      projects: "You work on irgatos.",
      recent: [
        { speaker: "user", text: "deploy?" },
        { speaker: "assistant", text: "Not yet." },
      ],
      memoryTool: true,
    });
    expect(text).toContain("You are IrgatGhost");
    expect(text).toContain("<soul>");
    expect(text).toContain("Be kind.");
    expect(text).toContain("<memory>\n- 2026-10-01 · Uses pnpm\n</memory>");
    expect(text).toContain("<projects>\nYou work on irgatos.\n</projects>");
    expect(text).toContain("User: deploy?\nYou: Not yet.");
    expect(text).toContain("delegate_to_irgat_session");
    expect(text).toContain("update_irgat_memory");
    expect(text).not.toContain("<adhd_mode>");
  });

  it("adds the ADHD rules when ADHD mode is on", () => {
    const text = liveSystemInstruction({ name: "A", adhd: true });
    expect(text).toContain("<adhd_mode>");
    expect(text).toContain(ADHD_RULES.slice(0, 80));
  });

  it("says an empty memory is empty, and leaves out what it was not given", () => {
    expect(liveSystemInstruction({ name: "A", memory: "" })).toContain(
      "(Empty. Nothing has been remembered yet.)",
    );
    const bare = liveSystemInstruction({ name: "Session" });
    expect(bare).not.toContain("<soul>");
    expect(bare).not.toContain("<memory>");
    expect(bare).not.toContain("<recent_conversation>");
    expect(bare).not.toContain("update_irgat_memory");
  });
});
