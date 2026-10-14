import { createLevelStore, type LevelStore } from "../model/levelStore";
import {
  GeminiLiveClient,
  type FunctionCall,
  type LiveCloseInfo,
  type LiveServerEvent,
  type LiveSetupOptions,
  type FunctionResponse,
} from "./geminiLiveClient";
import { LiveAudioEngine, type EngineHandlers } from "./liveAudioEngine";
import { liveHost, type LiveHost, type LiveSessionInfo } from "./liveHost";
import { loadLiveSettings, type LiveVoiceSettings } from "./liveSettings";
import { LiveTranscript, liveBlock } from "./liveTranscript";
import {
  DELEGATE_TOOL,
  delegationResultText,
  liveToolDeclarations,
  runLiveTool,
  type LiveToolDeps,
} from "./liveTools";

export type LivePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "delegating"
  | "error";

export type LiveState = {
  phase: LivePhase;
  sessionId: string | null;
  muted: boolean;
  error: string | null;
  /** The line being spoken right now, by either side, for the pill. */
  caption: { speaker: "user" | "assistant"; text: string } | null;
};

export const LIVE_IDLE: LiveState = {
  phase: "idle",
  sessionId: null,
  muted: false,
  error: null,
  caption: null,
};

/** Quiet after the user spoke that reads as "waiting for the reply". */
const THINKING_AFTER_MS = 700;
/** The microphone level that counts as the user still talking. */
const SPEAKING_LEVEL = 0.03;
const CAPTION_MAX = 160;

type ClientLike = Pick<
  GeminiLiveClient,
  | "connect"
  | "onEvent"
  | "onClose"
  | "sendAudio"
  | "sendAudioStreamEnd"
  | "sendText"
  | "sendToolResponse"
  | "close"
  | "connected"
>;

type EngineLike = Pick<
  LiveAudioEngine,
  "start" | "stop" | "setMuted" | "play" | "flush" | "outputLevel" | "playing"
>;

export type LiveInstruction = { text: string; memoryTool: boolean };

export type LiveControllerDeps = {
  host: () => LiveHost | null;
  apiKey: () => Promise<string | null>;
  createClient: (apiKey: string) => ClientLike;
  createEngine: () => EngineLike;
  settings: () => LiveVoiceSettings;
  instruction: (info: LiveSessionInfo) => Promise<LiveInstruction>;
  /** Tool effects outside delegation, bound to the call's session. */
  tools: (info: LiveSessionInfo) => Omit<LiveToolDeps, "delegate">;
  now?: () => number;
};

function short(text: string): string {
  return text.length > CAPTION_MAX ? `…${text.slice(-(CAPTION_MAX - 1))}` : text;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * One Live voice call at a time, for one chat: connects Gemini Live, runs
 * the microphone and speaker, answers tool calls, and writes what was said
 * into the chat when each turn ends.
 */
export class LiveVoiceController {
  private state: LiveState = LIVE_IDLE;
  private listeners = new Set<() => void>();
  private client: ClientLike | null = null;
  private engine: EngineLike | null = null;
  private transcript = new LiveTranscript();
  private info: LiveSessionInfo | null = null;
  /** Bumped per call, so a late callback from an ended call does nothing. */
  private generation = 0;
  private lastLoudAt = 0;
  private turnOpen = false;
  private toolsRunning = 0;
  readonly inputLevels: LevelStore = createLevelStore();
  readonly outputLevels: LevelStore = createLevelStore();
  private outputTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: LiveControllerDeps) {}

  getState = (): LiveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  isActive(sessionId?: string): boolean {
    return (
      this.state.phase !== "idle" &&
      (sessionId === undefined || this.state.sessionId === sessionId)
    );
  }

  async toggle(sessionId: string) {
    if (this.isActive(sessionId) && this.state.phase !== "error") this.end();
    else await this.start(sessionId);
  }

  async start(sessionId: string) {
    if (this.state.phase !== "idle") this.end();
    const generation = ++this.generation;
    const alive = () => generation === this.generation;
    this.set({ ...LIVE_IDLE, phase: "connecting", sessionId });
    try {
      const host = this.deps.host();
      const info = host?.session(sessionId);
      if (!host || !info) throw new Error("This chat cannot start a live call");
      this.info = info;
      const key = await this.deps.apiKey();
      if (!alive()) return;
      if (!key) throw new Error("Add a Gemini API key in Settings › Voice to talk live");
      const settings = this.deps.settings();
      const instruction = await this.deps.instruction(info);
      if (!alive()) return;
      const client = this.deps.createClient(key);
      this.client = client;
      client.onEvent((event) => {
        if (alive()) this.handle(event);
      });
      client.onClose((close) => {
        if (alive()) this.closed(close);
      });
      const setup: LiveSetupOptions = {
        model: settings.model,
        voice: settings.voice,
        systemInstruction: instruction.text,
        tools: liveToolDeclarations({ memory: instruction.memoryTool }),
      };
      await client.connect(setup);
      if (!alive()) return;
      const engine = this.deps.createEngine();
      this.engine = engine;
      const handlers: EngineHandlers = {
        onChunk: (chunk) => {
          if (alive() && !this.state.muted) this.client?.sendAudio(chunk);
        },
        onLevel: (level) => {
          if (alive()) this.heard(level);
        },
        onBargeIn: () => {
          if (alive()) this.interrupted();
        },
        onPlaybackIdle: () => {
          if (alive()) this.playbackIdle();
        },
      };
      await engine.start(handlers, { bargeIn: settings.localBargeIn });
      if (!alive()) return;
      this.outputTimer = setInterval(() => {
        this.outputLevels.set(this.engine?.outputLevel() ?? 0);
      }, 50);
      this.set({ phase: "listening" });
    } catch (reason) {
      if (!alive()) return;
      this.fail(errorText(reason));
    }
  }

  setMuted(muted: boolean) {
    if (this.state.phase === "idle" || this.state.muted === muted) return;
    this.engine?.setMuted(muted);
    if (muted) this.client?.sendAudioStreamEnd();
    this.inputLevels.set(0);
    this.set({ muted });
  }

  /** Hangs up, keeping whatever was said so far in the chat. */
  end() {
    if (this.state.phase === "idle") return;
    this.generation++;
    this.flushTurn(this.engine?.playing ?? false);
    this.teardown();
    this.set(LIVE_IDLE);
  }

  private teardown() {
    if (this.outputTimer) clearInterval(this.outputTimer);
    this.outputTimer = null;
    this.engine?.stop();
    this.engine = null;
    this.client?.close();
    this.client = null;
    this.info = null;
    this.turnOpen = false;
    this.toolsRunning = 0;
    this.transcript = new LiveTranscript();
    this.inputLevels.set(0);
    this.outputLevels.set(0);
  }

  private fail(message: string) {
    const sessionId = this.state.sessionId;
    this.flushTurn(false);
    this.generation++;
    this.teardown();
    this.set({ ...LIVE_IDLE, phase: "error", sessionId, error: message });
  }

  private closed(close: LiveCloseInfo) {
    if (close.expected) return;
    this.fail(close.reason || "The live call ended");
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private heard(level: number) {
    this.inputLevels.set(level);
    const now = this.now();
    if (level >= SPEAKING_LEVEL) this.lastLoudAt = now;
    if (
      this.state.phase === "listening" &&
      this.transcript.pendingUser &&
      now - this.lastLoudAt > THINKING_AFTER_MS
    )
      this.set({ phase: "thinking" });
  }

  private handle(event: LiveServerEvent) {
    switch (event.type) {
      case "audio":
        this.turnOpen = true;
        this.engine?.play(event.data, event.rate);
        if (!this.toolsRunning && this.state.phase !== "speaking")
          this.set({ phase: "speaking" });
        return;
      case "inputTranscript":
        this.transcript.addUser(event.text);
        this.set({ caption: { speaker: "user", text: short(this.transcript.pendingUser) } });
        return;
      case "outputTranscript":
        this.turnOpen = true;
        this.transcript.addAssistant(event.text);
        this.set({
          caption: { speaker: "assistant", text: short(this.transcript.pendingAssistant) },
        });
        return;
      case "interrupted":
        this.interrupted();
        return;
      case "turnComplete":
        this.flushTurn(false);
        this.turnOpen = false;
        if (!this.engine?.playing && !this.toolsRunning) this.set({ phase: "listening" });
        return;
      case "toolCall":
        void this.runTools(event.calls);
        return;
      case "error":
        this.fail(event.message);
        return;
      default:
        return;
    }
  }

  private interrupted() {
    this.engine?.flush();
    if (this.turnOpen || this.transcript.pendingAssistant) this.flushTurn(true);
    this.turnOpen = false;
    if (!this.toolsRunning) this.set({ phase: "listening" });
  }

  private playbackIdle() {
    this.outputLevels.set(0);
    if (!this.turnOpen && !this.toolsRunning && this.state.phase === "speaking")
      this.set({ phase: "listening" });
  }

  /** Writes the turn into the chat: what the user said, then the reply. */
  private flushTurn(interrupted: boolean) {
    const sessionId = this.state.sessionId;
    const user = this.transcript.takeUser();
    const assistant = this.transcript.takeAssistant();
    if (!sessionId || !this.deps.settings().saveTranscript) return;
    const host = this.deps.host();
    if (!host) return;
    const at = this.now();
    if (user) host.append(sessionId, liveBlock("user", user, { at }));
    if (assistant) host.append(sessionId, liveBlock("assistant", assistant, { at, interrupted }));
  }

  private async runTools(calls: FunctionCall[]) {
    const generation = this.generation;
    const info = this.info;
    const host = this.deps.host();
    if (!info || !host) return;
    // The agent should see what the user just asked for in the chat first.
    this.flushUser();
    this.toolsRunning++;
    const delegating = calls.some((call) => call.name === DELEGATE_TOOL);
    this.set({ phase: delegating ? "delegating" : "thinking" });
    const deps: LiveToolDeps = {
      ...this.deps.tools(info),
      delegate: async (prompt) => {
        const delegation = await host.delegate(info.id, prompt);
        if (delegation.started && delegation.done)
          void delegation.done.then((outcome) => {
            if (generation !== this.generation || !this.client?.connected) return;
            this.client.sendText(delegationResultText(prompt, outcome));
          });
        return delegation;
      },
    };
    let responses: FunctionResponse[] = [];
    try {
      responses = await Promise.all(calls.map((call) => runLiveTool(call, deps)));
    } finally {
      if (generation === this.generation) {
        this.toolsRunning = Math.max(0, this.toolsRunning - 1);
        this.client?.sendToolResponse(responses);
        if (!this.toolsRunning)
          this.set({ phase: this.engine?.playing ? "speaking" : "thinking" });
      }
    }
  }

  private flushUser() {
    const sessionId = this.state.sessionId;
    const user = this.transcript.takeUser();
    if (!user || !sessionId || !this.deps.settings().saveTranscript) return;
    this.deps.host()?.append(sessionId, liveBlock("user", user, { at: this.now() }));
  }

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export function defaultClient(apiKey: string): ClientLike {
  return new GeminiLiveClient({ apiKey });
}

export function defaultEngine(): EngineLike {
  return new LiveAudioEngine();
}

export const defaultHost = liveHost;
export const defaultSettings = loadLiveSettings;
