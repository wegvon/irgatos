import { describe, expect, it, vi } from "vitest";
import {
  DELEGATE_TOOL,
  delegationResultText,
  liveToolDeclarations,
  MEMORY_TOOL,
  runLiveTool,
  SAVE_NOTE_TOOL,
  type LiveToolDeps,
} from "./liveTools";

function deps(overrides: Partial<LiveToolDeps> = {}): LiveToolDeps {
  return {
    delegate: vi.fn(async () => ({ started: true })),
    saveNote: vi.fn(async () => ({ created: true })),
    remember: vi.fn(async () => ({ added: true })),
    ...overrides,
  };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: "c1", name, args });

describe("liveToolDeclarations", () => {
  it("offers memory only to Irgats", () => {
    expect(liveToolDeclarations({ memory: true }).map((tool) => tool.name)).toEqual([
      DELEGATE_TOOL,
      SAVE_NOTE_TOOL,
      MEMORY_TOOL,
    ]);
    expect(liveToolDeclarations({ memory: false }).map((tool) => tool.name)).toEqual([
      DELEGATE_TOOL,
      SAVE_NOTE_TOOL,
    ]);
  });

  it("declares the arguments each tool needs", () => {
    const [delegate, note, memory] = liveToolDeclarations({ memory: true });
    expect(delegate.parameters?.required).toEqual(["prompt"]);
    expect(note.parameters?.required).toEqual(["title", "content"]);
    expect(memory.parameters?.required).toEqual(["entry"]);
    expect(delegate.name).toBe("delegate_to_irgat_session");
    expect(note.name).toBe("save_irgat_note");
    expect(memory.name).toBe("update_irgat_memory");
  });
});

describe("runLiveTool", () => {
  it("delegates the trimmed prompt and answers once the work has started", async () => {
    const tools = deps();
    const response = await runLiveTool(call(DELEGATE_TOOL, { prompt: "  fix CI  " }), tools);
    expect(tools.delegate).toHaveBeenCalledWith("fix CI");
    expect(response.id).toBe("c1");
    expect(response.name).toBe(DELEGATE_TOOL);
    expect(String(response.response.result)).toMatch(/^Started/);
  });

  it("reports a refused delegation", async () => {
    const tools = deps({ delegate: async () => ({ started: false, reason: "busy" }) });
    expect((await runLiveTool(call(DELEGATE_TOOL, { prompt: "x" }), tools)).response).toEqual({
      error: "busy",
    });
  });

  it("saves notes once", async () => {
    const tools = deps({ saveNote: vi.fn(async () => ({ created: false })) });
    const response = await runLiveTool(
      call(SAVE_NOTE_TOOL, { title: "Plan", content: "- a\n- b" }),
      tools,
    );
    expect(tools.saveNote).toHaveBeenCalledWith("Plan", "- a\n- b");
    expect(response.response).toEqual({ result: "That note was already saved." });
  });

  it("remembers an entry", async () => {
    const tools = deps();
    const response = await runLiveTool(call(MEMORY_TOOL, { entry: "Prefers pnpm" }), tools);
    expect(tools.remember).toHaveBeenCalledWith("Prefers pnpm");
    expect(response.response).toEqual({ result: "Remembered." });
  });

  it("answers with an error rather than throwing", async () => {
    const tools = deps({
      saveNote: async () => {
        throw new Error("disk full");
      },
      remember: undefined,
    });
    expect((await runLiveTool(call(SAVE_NOTE_TOOL, { content: "x" }), tools)).response).toEqual({
      error: "disk full",
    });
    expect((await runLiveTool(call(MEMORY_TOOL, { entry: "x" }), tools)).response).toEqual({
      error: "This chat has no memory",
    });
    expect((await runLiveTool(call(DELEGATE_TOOL, { prompt: 3 }), tools)).response).toEqual({
      error: "prompt is empty",
    });
    expect((await runLiveTool(call("rm_rf"), tools)).response).toEqual({
      error: "Unknown tool rm_rf",
    });
  });
});

describe("delegationResultText", () => {
  it("hands the model the agent's reply to speak", () => {
    const text = delegationResultText("fix   CI", "All green.");
    expect(text).toContain('"fix CI"');
    expect(text).toContain("All green.");
    expect(text).toMatch(/^<delegation_result>/);
  });

  it("says so when there was no reply, and caps long ones", () => {
    expect(delegationResultText("x", undefined)).toContain("without a written reply");
    expect(delegationResultText("x", "y".repeat(10_000)).length).toBeLessThan(4500);
  });
});
