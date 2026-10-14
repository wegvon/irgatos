import { describe, expect, it, vi } from "vitest";
import type { Block } from "../../sessions/model/session";
import type {
  FunctionResponse,
  LiveCloseInfo,
  LiveServerEvent,
  LiveSetupOptions,
} from "./geminiLiveClient";
import type { EngineHandlers } from "./liveAudioEngine";
import type { Delegation, LiveHost } from "./liveHost";
import { LIVE_SETTINGS_DEFAULTS, type LiveVoiceSettings } from "./liveSettings";
import { LiveVoiceController, type LiveControllerDeps } from "./liveSession";

class FakeClient {
  setup: LiveSetupOptions | null = null;
  connected = false;
  audio: string[] = [];
  streamEnds = 0;
  texts: string[] = [];
  toolResponses: FunctionResponse[][] = [];
  closed = false;
  private events: ((event: LiveServerEvent) => void)[] = [];
  private closes: ((info: LiveCloseInfo) => void)[] = [];
  constructor(private readonly failWith?: Error) {}
  connect = async (setup: LiveSetupOptions) => {
    this.setup = setup;
    if (this.failWith) throw this.failWith;
    this.connected = true;
  };
  onEvent = (listener: (event: LiveServerEvent) => void) => {
    this.events.push(listener);
    return () => {};
  };
  onClose = (listener: (info: LiveCloseInfo) => void) => {
    this.closes.push(listener);
    return () => {};
  };
  sendAudio = (chunk: string) => this.audio.push(chunk);
  sendAudioStreamEnd = () => this.streamEnds++;
  sendText = (text: string) => this.texts.push(text);
  sendToolResponse = (responses: FunctionResponse[]) => this.toolResponses.push(responses);
  close = () => {
    this.closed = true;
    this.connected = false;
  };
  emit(...events: LiveServerEvent[]) {
    for (const event of events) for (const listener of this.events) listener(event);
  }
  hangUp(reason: string) {
    this.connected = false;
    for (const listener of this.closes) listener({ code: 1011, reason, expected: false });
  }
}

class FakeEngine {
  handlers: EngineHandlers | null = null;
  options: { bargeIn?: boolean } | undefined;
  playing = false;
  played: { data: string; rate: number }[] = [];
  muted = false;
  flushes = 0;
  stopped = false;
  start = async (handlers: EngineHandlers, options?: { bargeIn?: boolean }) => {
    this.handlers = handlers;
    this.options = options;
  };
  stop = () => {
    this.stopped = true;
  };
  setMuted = (muted: boolean) => {
    this.muted = muted;
  };
  play = (data: string, rate: number) => {
    this.played.push({ data, rate });
    this.playing = true;
  };
  flush = () => {
    this.flushes++;
    const had = this.playing;
    this.playing = false;
    return had;
  };
  outputLevel = () => 0;
  finishPlaying() {
    this.playing = false;
    this.handlers?.onPlaybackIdle?.();
  }
}

function setup(
  options: {
    key?: string | null;
    settings?: Partial<LiveVoiceSettings>;
    memoryTool?: boolean;
    delegation?: Delegation;
    noSession?: boolean;
    client?: FakeClient;
  } = {},
) {
  const appended: { sessionId: string; block: Block }[] = [];
  const client = options.client ?? new FakeClient();
  const engine = new FakeEngine();
  let clock = 1_000;
  const host: LiveHost = {
    session: (id) =>
      options.noSession
        ? undefined
        : { id, title: "Irgat", cwd: "/repo", blocks: [{ id: "b", role: "user", text: "hi" }] },
    append: (sessionId, block) => appended.push({ sessionId, block }),
    delegate: vi.fn(async () => options.delegation ?? { started: true }),
  };
  const saveNote = vi.fn(async () => ({ created: true }));
  const remember = vi.fn(async () => ({ added: true }));
  const instruction = vi.fn(async () => ({
    text: "SYSTEM",
    memoryTool: options.memoryTool ?? true,
  }));
  const deps: LiveControllerDeps = {
    host: () => host,
    apiKey: async () => (options.key === undefined ? "AIza-key" : options.key),
    createClient: vi.fn(() => client),
    createEngine: () => engine,
    settings: () => ({ ...LIVE_SETTINGS_DEFAULTS, ...options.settings }),
    instruction,
    tools: () => ({ saveNote, remember }),
    now: () => clock,
  };
  const controller = new LiveVoiceController(deps);
  return {
    controller,
    client,
    engine,
    host,
    appended,
    deps,
    instruction,
    saveNote,
    remember,
    tick: (ms: number) => (clock += ms),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("starting a call", () => {
  it("connects with the voice, model, instruction and tools, then listens", async () => {
    const t = setup({ settings: { voice: "Fenrir", localBargeIn: false } });
    const phases: string[] = [];
    t.controller.subscribe(() => phases.push(t.controller.getState().phase));
    await t.controller.start("chat");
    expect(t.deps.createClient).toHaveBeenCalledWith("AIza-key");
    expect(t.client.setup).toMatchObject({
      model: LIVE_SETTINGS_DEFAULTS.model,
      voice: "Fenrir",
      systemInstruction: "SYSTEM",
    });
    expect(t.client.setup?.tools?.map((tool) => tool.name)).toEqual([
      "delegate_to_irgat_session",
      "save_irgat_note",
      "update_irgat_memory",
    ]);
    expect(t.engine.options).toEqual({ bargeIn: false });
    expect(phases[0]).toBe("connecting");
    expect(t.controller.getState()).toMatchObject({ phase: "listening", sessionId: "chat" });
    expect(t.controller.isActive("chat")).toBe(true);
    expect(t.controller.isActive("other")).toBe(false);
    t.controller.end();
  });

  it("asks for a key when there is none", async () => {
    const t = setup({ key: null });
    await t.controller.start("chat");
    expect(t.controller.getState()).toMatchObject({
      phase: "error",
      sessionId: "chat",
      error: "Add a Gemini API key in Settings › Voice to talk live",
    });
    expect(t.deps.createClient).not.toHaveBeenCalled();
  });

  it("fails cleanly when the chat is gone or Gemini refuses", async () => {
    const gone = setup({ noSession: true });
    await gone.controller.start("chat");
    expect(gone.controller.getState().phase).toBe("error");

    const refused = setup({ client: new FakeClient(new Error("API key not valid")) });
    await refused.controller.start("chat");
    expect(refused.controller.getState()).toMatchObject({
      phase: "error",
      error: "API key not valid",
    });
    expect(refused.client.closed).toBe(true);
    expect(refused.engine.handlers).toBeNull();
  });

  it("leaves memory out for a chat that is not an Irgat", async () => {
    const t = setup({ memoryTool: false });
    await t.controller.start("chat");
    expect(t.client.setup?.tools?.map((tool) => tool.name)).toEqual([
      "delegate_to_irgat_session",
      "save_irgat_note",
    ]);
  });
});

describe("during a call", () => {
  it("streams the microphone unless muted", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.engine.handlers?.onChunk("A");
    t.controller.setMuted(true);
    expect(t.engine.muted).toBe(true);
    expect(t.client.streamEnds).toBe(1);
    t.engine.handlers?.onChunk("B");
    t.controller.setMuted(false);
    t.engine.handlers?.onChunk("C");
    expect(t.client.audio).toEqual(["A", "C"]);
    expect(t.controller.getState().muted).toBe(false);
  });

  it("speaks, then listens again once the turn is over and played", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.client.emit(
      { type: "inputTranscript", text: "is CI green" },
      { type: "audio", data: "AAA=", rate: 24_000 },
      { type: "outputTranscript", text: "Checking." },
    );
    expect(t.engine.played).toEqual([{ data: "AAA=", rate: 24_000 }]);
    expect(t.controller.getState()).toMatchObject({
      phase: "speaking",
      caption: { speaker: "assistant", text: "Checking." },
    });
    t.client.emit({ type: "turnComplete" });
    expect(t.controller.getState().phase).toBe("speaking");
    t.engine.finishPlaying();
    expect(t.controller.getState().phase).toBe("listening");
    expect(t.appended.map(({ sessionId, block }) => [sessionId, block.role, block.text])).toEqual([
      ["chat", "user", "is CI green"],
      ["chat", "assistant", "Checking."],
    ]);
    expect(t.appended[1].block.liveVoice).toEqual({ at: 1_000 });
  });

  it("shows thinking once the user has gone quiet", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.engine.handlers?.onLevel?.(0.2);
    t.client.emit({ type: "inputTranscript", text: "hello" });
    expect(t.controller.getState()).toMatchObject({
      phase: "listening",
      caption: { speaker: "user", text: "hello" },
    });
    t.tick(300);
    t.engine.handlers?.onLevel?.(0.001);
    expect(t.controller.getState().phase).toBe("listening");
    t.tick(500);
    t.engine.handlers?.onLevel?.(0.001);
    expect(t.controller.getState().phase).toBe("thinking");
  });

  it("drops queued speech when the server says the user interrupted", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.client.emit(
      { type: "audio", data: "AAA=", rate: 24_000 },
      { type: "outputTranscript", text: "The long answer is" },
      { type: "interrupted" },
    );
    expect(t.engine.flushes).toBe(1);
    expect(t.engine.playing).toBe(false);
    expect(t.controller.getState().phase).toBe("listening");
    expect(t.appended).toHaveLength(1);
    expect(t.appended[0].block).toMatchObject({
      role: "assistant",
      text: "The long answer is",
      liveVoice: { interrupted: true },
    });
  });

  it("treats a local barge-in the same way", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.client.emit(
      { type: "audio", data: "AAA=", rate: 24_000 },
      { type: "outputTranscript", text: "So" },
    );
    t.engine.playing = false;
    t.engine.handlers?.onBargeIn?.();
    expect(t.controller.getState().phase).toBe("listening");
    expect(t.appended[0].block.liveVoice?.interrupted).toBe(true);
  });

  it("keeps the transcript out of the chat when asked to", async () => {
    const t = setup({ settings: { saveTranscript: false } });
    await t.controller.start("chat");
    t.client.emit(
      { type: "inputTranscript", text: "secret" },
      { type: "outputTranscript", text: "ok" },
      { type: "turnComplete" },
    );
    expect(t.appended).toEqual([]);
  });
});

describe("tools", () => {
  it("delegates, says it started, then reports the result back to the model", async () => {
    let finish!: (text: string | undefined) => void;
    const done = new Promise<string | undefined>((resolve) => (finish = resolve));
    const t = setup({ delegation: { started: true, done } });
    await t.controller.start("chat");
    t.client.emit({ type: "inputTranscript", text: "please fix the flaky test" });
    t.client.emit({
      type: "toolCall",
      calls: [{ id: "c1", name: "delegate_to_irgat_session", args: { prompt: "Fix the flaky test" } }],
    });
    expect(t.controller.getState().phase).toBe("delegating");
    // The user's request lands in the chat before the agent's turn does.
    expect(t.appended.map(({ block }) => block.text)).toEqual(["please fix the flaky test"]);
    await flush();
    expect(t.host.delegate).toHaveBeenCalledWith("chat", "Fix the flaky test");
    expect(t.client.toolResponses).toHaveLength(1);
    expect(t.client.toolResponses[0][0]).toMatchObject({
      id: "c1",
      name: "delegate_to_irgat_session",
    });
    expect(String(t.client.toolResponses[0][0].response.result)).toMatch(/^Started/);
    expect(t.controller.getState().phase).toBe("thinking");
    finish("Fixed in 3 files; tests pass.");
    await flush();
    expect(t.client.texts).toHaveLength(1);
    expect(t.client.texts[0]).toContain("Fixed in 3 files; tests pass.");
  });

  it("does not report a delegation to a call that has ended", async () => {
    let finish!: (text: string | undefined) => void;
    const done = new Promise<string | undefined>((resolve) => (finish = resolve));
    const t = setup({ delegation: { started: true, done } });
    await t.controller.start("chat");
    t.client.emit({
      type: "toolCall",
      calls: [{ id: "c1", name: "delegate_to_irgat_session", args: { prompt: "x" } }],
    });
    await flush();
    t.controller.end();
    finish("late");
    await flush();
    expect(t.client.texts).toEqual([]);
  });

  it("runs several calls in one message and answers them together", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.client.emit({
      type: "toolCall",
      calls: [
        { id: "n", name: "save_irgat_note", args: { title: "T", content: "C" } },
        { id: "m", name: "update_irgat_memory", args: { entry: "Likes tea" } },
      ],
    });
    expect(t.controller.getState().phase).toBe("thinking");
    await flush();
    expect(t.saveNote).toHaveBeenCalledWith("T", "C");
    expect(t.remember).toHaveBeenCalledWith("Likes tea");
    expect(t.client.toolResponses[0].map((response) => response.id)).toEqual(["n", "m"]);
  });
});

describe("ending", () => {
  it("hangs up, keeps what was said, and ignores anything after", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.client.emit({ type: "inputTranscript", text: "bye" });
    t.controller.end();
    expect(t.controller.getState()).toMatchObject({ phase: "idle", sessionId: null });
    expect(t.client.closed).toBe(true);
    expect(t.engine.stopped).toBe(true);
    expect(t.appended.map(({ block }) => block.text)).toEqual(["bye"]);
    t.client.emit({ type: "audio", data: "AAA=", rate: 24_000 });
    expect(t.engine.played).toEqual([]);
    expect(t.controller.getState().phase).toBe("idle");
  });

  it("shows why the call dropped when Gemini hangs up", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.client.hangUp("Quota exceeded");
    expect(t.controller.getState()).toMatchObject({
      phase: "error",
      error: "Quota exceeded",
      sessionId: "chat",
    });
    expect(t.engine.stopped).toBe(true);
  });

  it("surfaces an error message from the server", async () => {
    const t = setup();
    await t.controller.start("chat");
    t.client.emit({ type: "error", message: "Model not found" });
    expect(t.controller.getState()).toMatchObject({ phase: "error", error: "Model not found" });
  });

  it("toggles: a second press ends the call, and one in another chat moves it", async () => {
    const t = setup();
    await t.controller.toggle("chat");
    expect(t.controller.isActive("chat")).toBe(true);
    await t.controller.toggle("chat");
    expect(t.controller.getState().phase).toBe("idle");
    await t.controller.start("chat");
    await t.controller.start("other");
    expect(t.controller.getState().sessionId).toBe("other");
  });
});
