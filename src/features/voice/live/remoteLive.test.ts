import { describe, expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import type { LiveHost } from "./liveHost";
import { LIVE_SETTINGS_DEFAULTS } from "./liveSettings";
import { handleRemoteLive, type RemoteLiveDeps } from "./remoteLive";

function setup(delegation: Awaited<ReturnType<LiveHost["delegate"]>> = { started: true }) {
  const appended: Block[] = [];
  const host: LiveHost = {
    session: (id) =>
      id === "chat" ? { id, title: "Ada", cwd: "/code", blocks: [] } : undefined,
    append: (_id, block) => appended.push(block),
    delegate: vi.fn(async () => delegation),
  };
  const saveNote = vi.fn(async () => ({ created: true }));
  const deps: RemoteLiveDeps = {
    host: () => host,
    token: vi.fn(async () => "auth_tokens/one-use"),
    settings: () => ({ ...LIVE_SETTINGS_DEFAULTS, voice: "Kore" }),
    instruction: async () => ({ text: "You are Ada.", memoryTool: false }),
    tools: () => ({ saveNote }),
  };
  return { deps, host, appended, saveNote };
}

describe("a Live call the phone runs", () => {
  it("starts with a one-use token and the Mac's instruction, never the key", async () => {
    const { deps } = setup();
    const call = await handleRemoteLive({ op: "start" }, "chat", deps);
    expect(call).toEqual({
      token: "auth_tokens/one-use",
      model: LIVE_SETTINGS_DEFAULTS.model,
      voice: "Kore",
      localBargeIn: LIVE_SETTINGS_DEFAULTS.localBargeIn,
      saveTranscript: LIVE_SETTINGS_DEFAULTS.saveTranscript,
      instruction: "You are Ada.",
      memoryTool: false,
    });
    await expect(handleRemoteLive({ op: "start" }, "other", deps)).rejects.toThrow(
      "cannot take a live call",
    );
  });

  it("writes what was said into the chat as live turns, built on the Mac", async () => {
    const { deps, appended } = setup();
    await handleRemoteLive(
      { op: "append", role: "assistant", text: " Done. ", interrupted: true },
      "chat",
      deps,
      1000,
    );
    await handleRemoteLive({ op: "append", role: "user", text: "  " }, "chat", deps);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      role: "assistant",
      text: "Done.",
      liveVoice: { at: 1000, interrupted: true },
    });
    await expect(
      handleRemoteLive({ op: "append", role: "system", text: "x" }, "chat", deps),
    ).rejects.toThrow("Missing role");
  });

  it("hands work to the agent and gives its result once, when it is done", async () => {
    let finish!: (text: string) => void;
    const done = new Promise<string | undefined>((resolve) => (finish = resolve));
    const { deps, host } = setup({ started: true, done });
    const started = (await handleRemoteLive(
      { op: "delegate", prompt: "Run the tests" },
      "chat",
      deps,
    )) as { started: boolean; id: string };
    expect(host.delegate).toHaveBeenCalledWith("chat", "Run the tests");
    expect(started.started).toBe(true);
    const ask = () =>
      handleRemoteLive({ op: "delegation", delegation: started.id }, "chat", deps);
    expect(await ask()).toEqual({ done: false });
    finish("12 tests pass.");
    await done;
    expect(await ask()).toEqual({ done: true, outcome: "12 tests pass." });
    await expect(ask()).rejects.toThrow("No such delegated work");
  });

  it("saves notes, and memory only for an Irgat", async () => {
    const { deps, saveNote } = setup();
    await handleRemoteLive({ op: "note", title: "Plan", content: "- a" }, "chat", deps);
    expect(saveNote).toHaveBeenCalledWith("Plan", "- a");
    await expect(
      handleRemoteLive({ op: "remember", entry: "Likes tea" }, "chat", deps),
    ).rejects.toThrow("no memory");
    await expect(handleRemoteLive({ op: "nope" }, "chat", deps)).rejects.toThrow(
      "Unknown live call step",
    );
  });
});
