import { INPUT_MIME_TYPE, pcmRate } from "./pcm";
import { LIVE_ENDPOINT } from "./liveSettings";

/**
 * The Gemini Multimodal Live API over one WebSocket: a `setup` message
 * first, then microphone audio up and the model's speech, transcripts and
 * tool calls down, both ways at once.
 * https://ai.google.dev/api/live
 */

export type JsonSchema = {
  type: "OBJECT" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN" | "ARRAY";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters?: JsonSchema;
};

export type LiveSetupOptions = {
  model: string;
  voice: string;
  systemInstruction: string;
  tools?: FunctionDeclaration[];
};

export type FunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type FunctionResponse = {
  id: string;
  name: string;
  response: Record<string, unknown>;
};

export type LiveServerEvent =
  | { type: "setupComplete" }
  | { type: "audio"; data: string; rate: number }
  | { type: "text"; text: string }
  | { type: "inputTranscript"; text: string }
  | { type: "outputTranscript"; text: string }
  | { type: "interrupted" }
  | { type: "generationComplete" }
  | { type: "turnComplete" }
  | { type: "toolCall"; calls: FunctionCall[] }
  | { type: "toolCallCancellation"; ids: string[] }
  | { type: "goAway"; timeLeft?: string }
  | { type: "error"; message: string };

export function buildSetupMessage(options: LiveSetupOptions) {
  return {
    setup: {
      model: options.model,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice } },
        },
      },
      systemInstruction: { parts: [{ text: options.systemInstruction }] },
      ...(options.tools?.length
        ? { tools: [{ functionDeclarations: options.tools }] }
        : {}),
      // Server-side voice activity detection; speech that starts while the
      // model talks cuts it off, and the server says so with `interrupted`.
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: false },
        activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Audio fills the context fast; without this a call ends after minutes.
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

export function audioMessage(base64: string) {
  return {
    realtimeInput: { mediaChunks: [{ mimeType: INPUT_MIME_TYPE, data: base64 }] },
  };
}

/** Sent when the microphone pauses, so the server stops waiting for more. */
export function audioStreamEndMessage() {
  return { realtimeInput: { audioStreamEnd: true } };
}

/** A typed or app-written turn, in the same conversation as the audio. */
export function textTurnMessage(text: string, turnComplete = true) {
  return {
    clientContent: {
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete,
    },
  };
}

export function toolResponseMessage(responses: FunctionResponse[]) {
  return { toolResponse: { functionResponses: responses } };
}

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** One server message, as the events it carries, in the order to handle them. */
export function parseServerMessage(raw: string): LiveServerEvent[] {
  let message: Raw | undefined;
  try {
    message = record(JSON.parse(raw));
  } catch {
    return [{ type: "error", message: "The live service sent something unreadable" }];
  }
  if (!message) return [];
  const events: LiveServerEvent[] = [];
  const error = record(message.error);
  if (error)
    events.push({
      type: "error",
      message: text(error.message) ?? "The live service reported an error",
    });
  if (message.setupComplete !== undefined) events.push({ type: "setupComplete" });
  const content = record(message.serverContent);
  if (content) {
    // Interruption first: whatever is still queued to play is stale.
    if (content.interrupted === true) events.push({ type: "interrupted" });
    const input = text(record(content.inputTranscription)?.text);
    if (input) events.push({ type: "inputTranscript", text: input });
    const parts = record(content.modelTurn)?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const entry = record(part);
        const inline = record(entry?.inlineData);
        const data = text(inline?.data);
        if (data && (text(inline?.mimeType) ?? "audio/pcm").startsWith("audio/"))
          events.push({ type: "audio", data, rate: pcmRate(text(inline?.mimeType)) });
        const said = text(entry?.text);
        if (said && entry?.thought !== true) events.push({ type: "text", text: said });
      }
    }
    const output = text(record(content.outputTranscription)?.text);
    if (output) events.push({ type: "outputTranscript", text: output });
    if (content.generationComplete === true)
      events.push({ type: "generationComplete" });
    if (content.turnComplete === true) events.push({ type: "turnComplete" });
  }
  const toolCall = record(message.toolCall);
  if (toolCall && Array.isArray(toolCall.functionCalls)) {
    const calls = toolCall.functionCalls.flatMap((call): FunctionCall[] => {
      const entry = record(call);
      const name = text(entry?.name);
      if (!entry || !name) return [];
      return [{ id: text(entry.id) ?? name, name, args: record(entry.args) ?? {} }];
    });
    if (calls.length) events.push({ type: "toolCall", calls });
  }
  const cancelled = record(message.toolCallCancellation)?.ids;
  if (Array.isArray(cancelled))
    events.push({
      type: "toolCallCancellation",
      ids: cancelled.filter((id): id is string => typeof id === "string"),
    });
  const goAway = record(message.goAway);
  if (goAway) events.push({ type: "goAway", timeLeft: text(goAway.timeLeft) });
  return events;
}

/** The parts of a browser `WebSocket` the client uses, so tests can stand in. */
export type LiveSocket = {
  readonly readyState: number;
  binaryType: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
};

export type LiveSocketFactory = (url: string) => LiveSocket;

const OPEN = 1;

export type LiveCloseInfo = { code: number; reason: string; expected: boolean };

export type GeminiLiveClientOptions = {
  apiKey: string;
  endpoint?: string;
  socket?: LiveSocketFactory;
  /** How long to wait for `setupComplete`. */
  setupTimeoutMs?: number;
};

/** The method a one-use token opens a call with, instead of a key. */
export const LIVE_TOKEN_ENDPOINT = `${LIVE_ENDPOINT}Constrained`;

/** One-use tokens the Mac hands a phone look like `auth_tokens/…`. */
export function isLiveToken(apiKey: string): boolean {
  return apiKey.startsWith("auth_tokens/");
}

export function liveUrl(apiKey: string, endpoint?: string): string {
  if (isLiveToken(apiKey))
    return `${endpoint ?? LIVE_TOKEN_ENDPOINT}?access_token=${encodeURIComponent(apiKey)}`;
  return `${endpoint ?? LIVE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
}

/** Close reasons sometimes quote the request; never show the key. */
export function redactKey(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message
    .split(apiKey)
    .join("«key»")
    .split(encodeURIComponent(apiKey))
    .join("«key»");
}

function closeMessage(code: number, reason: string): string {
  if (reason.trim()) return reason.trim();
  if (code === 1006) return "The connection to Gemini dropped";
  if (code === 1008) return "Gemini refused the request";
  return `Gemini closed the connection (${code})`;
}

export class GeminiLiveClient {
  private socket: LiveSocket | null = null;
  private listeners = new Set<(event: LiveServerEvent) => void>();
  private closeListeners = new Set<(info: LiveCloseInfo) => void>();
  private ready = false;
  private closing = false;
  /** Blob frames decode asynchronously; this keeps messages in order. */
  private inbox: Promise<void> = Promise.resolve();

  constructor(private readonly options: GeminiLiveClientOptions) {}

  get connected(): boolean {
    return this.ready && this.socket?.readyState === OPEN;
  }

  onEvent(listener: (event: LiveServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: (info: LiveCloseInfo) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  /** Opens the socket and sends `setup`; settles once the server accepts it. */
  connect(setup: LiveSetupOptions): Promise<void> {
    if (this.socket) return Promise.reject(new Error("Already connected"));
    const { apiKey } = this.options;
    if (!apiKey.trim()) return Promise.reject(new Error("Add a Gemini API key first"));
    const factory =
      this.options.socket ?? ((url: string) => new WebSocket(url) as unknown as LiveSocket);
    const socket = factory(liveUrl(apiKey.trim(), this.options.endpoint));
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        fail(new Error("Gemini did not answer the setup in time"));
        this.close();
      }, this.options.setupTimeoutMs ?? 15_000);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      socket.onopen = () => {
        socket.send(JSON.stringify(buildSetupMessage(setup)));
      };
      socket.onmessage = ({ data }) => {
        this.inbox = this.inbox
          .then(() => frameText(data))
          .then((raw) => {
            if (raw == null) return;
            for (const event of parseServerMessage(raw)) {
              if (event.type === "setupComplete") {
                this.ready = true;
                succeed();
              }
              this.emit(event);
            }
          })
          .catch(console.error);
      };
      socket.onerror = () => {
        // The close event that follows carries the reason.
      };
      socket.onclose = ({ code, reason }) => {
        const expected = this.closing;
        this.ready = false;
        this.socket = null;
        const message = redactKey(closeMessage(code, reason ?? ""), apiKey);
        fail(new Error(message));
        void this.inbox.then(() => {
          for (const listener of this.closeListeners)
            listener({ code, reason: message, expected });
        });
      };
    });
  }

  sendAudio(base64: string) {
    this.send(audioMessage(base64));
  }

  sendAudioStreamEnd() {
    this.send(audioStreamEndMessage());
  }

  sendText(text: string, turnComplete = true) {
    this.send(textTurnMessage(text, turnComplete));
  }

  sendToolResponse(responses: FunctionResponse[]) {
    if (responses.length) this.send(toolResponseMessage(responses));
  }

  close() {
    this.closing = true;
    this.ready = false;
    const socket = this.socket;
    if (!socket) return;
    try {
      socket.close(1000, "Live voice ended");
    } catch {
      // already closed
    }
  }

  private send(message: unknown) {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private emit(event: LiveServerEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

async function frameText(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data))
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  if (data && typeof (data as Blob).text === "function") return (data as Blob).text();
  return null;
}
