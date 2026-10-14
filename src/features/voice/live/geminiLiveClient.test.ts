import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audioMessage,
  buildSetupMessage,
  GeminiLiveClient,
  liveUrl,
  parseServerMessage,
  redactKey,
  textTurnMessage,
  toolResponseMessage,
  type LiveServerEvent,
  type LiveSocket,
} from "./geminiLiveClient";
import { LIVE_ENDPOINT } from "./liveSettings";
import { DELEGATE_DECLARATION } from "./liveTools";

class FakeSocket implements LiveSocket {
  readyState = 0;
  binaryType = "blob";
  sent: unknown[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: LiveSocket["onopen"] = null;
  onmessage: LiveSocket["onmessage"] = null;
  onerror: LiveSocket["onerror"] = null;
  onclose: LiveSocket["onclose"] = null;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1005, reason: reason ?? "" });
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown, as: "text" | "buffer" | "blob" = "text") {
    const json = JSON.stringify(message);
    const data =
      as === "text"
        ? json
        : as === "buffer"
          ? new TextEncoder().encode(json).buffer
          : new Blob([json]);
    this.onmessage?.({ data });
  }

  drop(code: number, reason: string) {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function connected(options: { setupTimeoutMs?: number } = {}) {
  let socket!: FakeSocket;
  const client = new GeminiLiveClient({
    apiKey: "AIza secret/key",
    socket: (url) => (socket = new FakeSocket(url)),
    ...options,
  });
  const events: LiveServerEvent[] = [];
  client.onEvent((event) => events.push(event));
  const ready = client.connect({
    model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
    voice: "Kore",
    systemInstruction: "Be brief.",
    tools: [DELEGATE_DECLARATION],
  });
  return { client, socket, events, ready };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("setup", () => {
  it("asks for audio replies in the chosen voice with both transcriptions", () => {
    const { setup } = buildSetupMessage({
      model: "models/gemini-2.0-flash-live-001",
      voice: "Charon",
      systemInstruction: "SOUL",
      tools: [DELEGATE_DECLARATION],
    });
    expect(setup.model).toBe("models/gemini-2.0-flash-live-001");
    expect(setup.generationConfig).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
    });
    expect(setup.systemInstruction).toEqual({ parts: [{ text: "SOUL" }] });
    expect(setup.tools).toEqual([{ functionDeclarations: [DELEGATE_DECLARATION] }]);
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.realtimeInputConfig).toEqual({
      automaticActivityDetection: { disabled: false },
      activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    });
  });

  it("leaves tools out when there are none", () => {
    const { setup } = buildSetupMessage({ model: "m", voice: "Puck", systemInstruction: "" });
    expect("tools" in setup).toBe(false);
  });

  it("puts the key in the BidiGenerateContent URL, escaped", () => {
    expect(liveUrl("a b/c")).toBe(`${LIVE_ENDPOINT}?key=a%20b%2Fc`);
    expect(LIVE_ENDPOINT).toBe(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
    );
  });

  it("shapes the client messages the way the API reads them", () => {
    expect(audioMessage("QUJD")).toEqual({
      realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: "QUJD" }] },
    });
    expect(textTurnMessage("hi")).toEqual({
      clientContent: { turns: [{ role: "user", parts: [{ text: "hi" }] }], turnComplete: true },
    });
    expect(toolResponseMessage([{ id: "1", name: "n", response: { result: "ok" } }])).toEqual({
      toolResponse: { functionResponses: [{ id: "1", name: "n", response: { result: "ok" } }] },
    });
  });
});

describe("parseServerMessage", () => {
  it("reads speech, transcripts and the end of the turn in order", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          serverContent: {
            inputTranscription: { text: "what's up" },
            modelTurn: {
              parts: [
                { inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAA=" } },
                { text: "thinking", thought: true },
                { text: "Hello" },
              ],
            },
            outputTranscription: { text: "Hello" },
            turnComplete: true,
          },
        }),
      ),
    ).toEqual([
      { type: "inputTranscript", text: "what's up" },
      { type: "audio", data: "AAA=", rate: 24_000 },
      { type: "text", text: "Hello" },
      { type: "outputTranscript", text: "Hello" },
      { type: "turnComplete" },
    ]);
  });

  it("puts an interruption before anything else in the message", () => {
    const events = parseServerMessage(
      JSON.stringify({
        serverContent: { interrupted: true, inputTranscription: { text: "wait" } },
      }),
    );
    expect(events.map((event) => event.type)).toEqual(["interrupted", "inputTranscript"]);
  });

  it("reads tool calls, cancellations, goAway and setupComplete", () => {
    expect(parseServerMessage('{"setupComplete":{}}')).toEqual([{ type: "setupComplete" }]);
    expect(
      parseServerMessage(
        JSON.stringify({
          toolCall: {
            functionCalls: [
              { id: "c1", name: "save_irgat_note", args: { title: "T", content: "C" } },
              { name: "delegate_to_irgat_session" },
              { id: "broken" },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        type: "toolCall",
        calls: [
          { id: "c1", name: "save_irgat_note", args: { title: "T", content: "C" } },
          { id: "delegate_to_irgat_session", name: "delegate_to_irgat_session", args: {} },
        ],
      },
    ]);
    expect(parseServerMessage('{"toolCallCancellation":{"ids":["c1",2]}}')).toEqual([
      { type: "toolCallCancellation", ids: ["c1"] },
    ]);
    expect(parseServerMessage('{"goAway":{"timeLeft":"10s"}}')).toEqual([
      { type: "goAway", timeLeft: "10s" },
    ]);
  });

  it("reports errors and survives junk", () => {
    expect(parseServerMessage('{"error":{"message":"quota"}}')).toEqual([
      { type: "error", message: "quota" },
    ]);
    expect(parseServerMessage("not json")[0].type).toBe("error");
    expect(parseServerMessage("[]")).toEqual([]);
    expect(parseServerMessage('{"usageMetadata":{}}')).toEqual([]);
  });
});

describe("GeminiLiveClient", () => {
  it("sends setup once the socket opens and resolves on setupComplete", async () => {
    const { client, socket, ready } = connected();
    expect(socket.url).toContain("?key=AIza%20secret%2Fkey");
    expect(socket.binaryType).toBe("arraybuffer");
    socket.open();
    expect(socket.sent).toHaveLength(1);
    expect((socket.sent[0] as { setup: { generationConfig: unknown } }).setup.generationConfig).toEqual({
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    });
    expect(client.connected).toBe(false);
    socket.receive({ setupComplete: {} });
    await ready;
    expect(client.connected).toBe(true);
  });

  it("streams audio and answers tool calls only while open", async () => {
    const { client, socket, ready } = connected();
    client.sendAudio("ignored");
    socket.open();
    socket.receive({ setupComplete: {} });
    await ready;
    client.sendAudio("QUJD");
    client.sendAudioStreamEnd();
    client.sendToolResponse([]);
    client.sendToolResponse([{ id: "c1", name: "n", response: { result: "ok" } }]);
    client.sendText("done");
    expect(socket.sent.slice(1)).toEqual([
      audioMessage("QUJD"),
      { realtimeInput: { audioStreamEnd: true } },
      toolResponseMessage([{ id: "c1", name: "n", response: { result: "ok" } }]),
      textTurnMessage("done"),
    ]);
  });

  it("decodes binary frames and keeps them in arrival order", async () => {
    const { socket, events, ready } = connected();
    socket.open();
    socket.receive({ setupComplete: {} }, "blob");
    socket.receive({ serverContent: { outputTranscription: { text: "one" } } }, "buffer");
    socket.receive({ serverContent: { outputTranscription: { text: "two" } } });
    await ready;
    await flush();
    expect(events).toEqual([
      { type: "setupComplete" },
      { type: "outputTranscript", text: "one" },
      { type: "outputTranscript", text: "two" },
    ]);
  });

  it("rejects with the close reason, without the key", async () => {
    const { socket, ready } = connected();
    socket.open();
    socket.drop(1008, "API key not valid: AIza secret/key");
    await expect(ready).rejects.toThrow("API key not valid: «key»");
  });

  it("tells listeners when the server hangs up, and that it was not asked to", async () => {
    const { client, socket, ready } = connected();
    const closes: unknown[] = [];
    client.onClose((info) => closes.push(info));
    socket.open();
    socket.receive({ setupComplete: {} });
    await ready;
    socket.drop(1011, "");
    await flush();
    expect(closes).toEqual([
      { code: 1011, reason: "Gemini closed the connection (1011)", expected: false },
    ]);
    expect(client.connected).toBe(false);
  });

  it("marks its own close as expected", async () => {
    const { client, socket, ready } = connected();
    const closes: { expected: boolean }[] = [];
    client.onClose((info) => closes.push(info));
    socket.open();
    socket.receive({ setupComplete: {} });
    await ready;
    client.close();
    await flush();
    expect(socket.closed).toEqual({ code: 1000, reason: "Live voice ended" });
    expect(closes[0].expected).toBe(true);
  });

  it("gives up when setup never completes", async () => {
    vi.useFakeTimers();
    const { socket, ready } = connected({ setupTimeoutMs: 1000 });
    socket.open();
    const failure = expect(ready).rejects.toThrow("did not answer the setup");
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(socket.closed).not.toBeNull();
  });

  it("refuses to connect without a key or twice", async () => {
    const client = new GeminiLiveClient({ apiKey: "  ", socket: (url) => new FakeSocket(url) });
    await expect(client.connect({ model: "m", voice: "Puck", systemInstruction: "" })).rejects.toThrow(
      "Gemini API key",
    );
    const { client: open } = connected();
    await expect(open.connect({ model: "m", voice: "Puck", systemInstruction: "" })).rejects.toThrow(
      "Already connected",
    );
  });

  it("redacts raw and URL-encoded keys", () => {
    expect(redactKey("x a/b y a%2Fb", "a/b")).toBe("x «key» y «key»");
    expect(redactKey("nothing", "")).toBe("nothing");
  });
});
