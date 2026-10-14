import { describe, expect, it, vi } from "vitest";
import {
  BargeInDetector,
  CAPTURE_WORKLET_URL,
  LiveAudioEngine,
  LivePlayback,
  MIC_CONSTRAINTS,
  microphoneError,
  type PlaybackContext,
} from "./liveAudioEngine";
import { base64ToBytes, bytesToBase64, pcm16ToBytes } from "./pcm";

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start(when = 0) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
  }
}

class FakePlaybackContext implements PlaybackContext {
  currentTime = 0;
  destination = { kind: "speakers" };
  sources: FakeSource[] = [];
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => data };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

const speech = (seconds: number, level = 0.5) =>
  new Float32Array(Math.round(24_000 * seconds)).fill(level);

describe("LivePlayback", () => {
  it("schedules chunks back to back without gaps", () => {
    const context = new FakePlaybackContext();
    const playback = new LivePlayback(context);
    playback.enqueue(speech(0.5), 24_000);
    playback.enqueue(speech(0.25), 24_000);
    const [first, second] = context.sources;
    expect(first.startedAt).toBeCloseTo(0.05);
    expect(second.startedAt).toBeCloseTo(0.55);
    expect(first.connect).toHaveBeenCalledWith(context.destination);
    expect(playback.playing).toBe(true);
    expect(playback.buffered).toBeCloseTo(0.8);
  });

  it("starts fresh after it ran dry", () => {
    const context = new FakePlaybackContext();
    const playback = new LivePlayback(context);
    const idle = vi.fn();
    playback.onIdle(idle);
    playback.enqueue(speech(0.1), 24_000);
    context.currentTime = 2;
    context.sources[0].onended?.();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(playback.playing).toBe(false);
    playback.enqueue(speech(0.1), 24_000);
    expect(context.sources[1].startedAt).toBeCloseTo(2.05);
  });

  it("flushes everything queued at once for barge-in", () => {
    const context = new FakePlaybackContext();
    const playback = new LivePlayback(context);
    const idle = vi.fn();
    playback.onIdle(idle);
    for (let i = 0; i < 3; i++) playback.enqueue(speech(0.2), 24_000);
    expect(playback.flush()).toBe(true);
    expect(context.sources.every((source) => source.stopped)).toBe(true);
    expect(context.sources.every((source) => source.onended === null)).toBe(true);
    expect(playback.playing).toBe(false);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(playback.flush()).toBe(false);
    playback.enqueue(speech(0.1), 24_000);
    expect(context.sources[3].startedAt).toBeCloseTo(0.05);
  });

  it("reports the loudness of what is sounding now", () => {
    const context = new FakePlaybackContext();
    const playback = new LivePlayback(context);
    playback.enqueue(speech(0.5, 0.2), 24_000);
    playback.enqueue(speech(0.5, 0.8), 24_000);
    context.currentTime = 0.3;
    expect(playback.level()).toBeCloseTo(0.2);
    context.currentTime = 0.7;
    expect(playback.level()).toBeCloseTo(0.8);
    context.currentTime = 5;
    expect(playback.level()).toBe(0);
  });

  it("ignores empty chunks", () => {
    const context = new FakePlaybackContext();
    const playback = new LivePlayback(context);
    playback.enqueue(new Float32Array(), 24_000);
    expect(context.sources).toHaveLength(0);
  });
});

describe("BargeInDetector", () => {
  it("fires once on sustained speech over playback", () => {
    const detector = new BargeInDetector({ threshold: 0.1, frames: 3 });
    expect(detector.feed(0.5, true)).toBe(false);
    expect(detector.feed(0.5, true)).toBe(false);
    expect(detector.feed(0.5, true)).toBe(true);
    expect(detector.feed(0.5, true)).toBe(false);
  });

  it("needs consecutive loud frames, so a click does not count", () => {
    const detector = new BargeInDetector({ threshold: 0.1, frames: 2 });
    expect(detector.feed(0.5, true)).toBe(false);
    expect(detector.feed(0.01, true)).toBe(false);
    expect(detector.feed(0.5, true)).toBe(false);
    expect(detector.feed(0.5, true)).toBe(true);
  });

  it("does nothing while the Irgat is silent, and rearms after", () => {
    const detector = new BargeInDetector({ threshold: 0.1, frames: 1 });
    expect(detector.feed(0.9, false)).toBe(false);
    expect(detector.feed(0.9, true)).toBe(true);
    detector.feed(0, false);
    expect(detector.feed(0.9, true)).toBe(true);
  });
});

describe("microphoneError", () => {
  it("explains the common getUserMedia failures", () => {
    expect(microphoneError({ name: "NotAllowedError" })).toContain("Privacy & Security");
    expect(microphoneError({ name: "NotFoundError" })).toBe("No microphone was found");
    expect(microphoneError({ name: "NotReadableError" })).toContain("Another app");
    expect(microphoneError(new Error("boom"))).toBe("boom");
  });
});

/** A context with no AudioWorklet, so capture takes the ScriptProcessor path. */
function fakeAudioContext() {
  const processor = {
    onaudioprocess: null as null | ((event: unknown) => void),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const sink = { ...node(), gain: { value: 1 } };
  const playback = new FakePlaybackContext();
  const context = {
    state: "suspended",
    sampleRate: 48_000,
    get currentTime() {
      return playback.currentTime;
    },
    destination: playback.destination,
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    createMediaStreamSource: vi.fn(() => node()),
    createGain: vi.fn(() => sink),
    createScriptProcessor: vi.fn(() => processor),
    createBuffer: playback.createBuffer.bind(playback),
    createBufferSource: playback.createBufferSource.bind(playback),
  };
  return { context, processor, sink, playback };
}

async function startedEngine(options: { bargeIn?: boolean } = {}) {
  const fake = fakeAudioContext();
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
  const engine = new LiveAudioEngine({
    createContext: () => fake.context as unknown as AudioContext,
    mediaDevices: { getUserMedia },
  });
  const handlers = {
    onChunk: vi.fn(),
    onLevel: vi.fn(),
    onBargeIn: vi.fn(),
    onPlaybackIdle: vi.fn(),
  };
  await engine.start(handlers, options);
  const micFrame = (level: number) =>
    fake.processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(2048).fill(level) },
    });
  return { engine, handlers, fake, track, getUserMedia, micFrame };
}

const chunkOf = (samples: number[]) => bytesToBase64(pcm16ToBytes(Int16Array.from(samples)));

describe("LiveAudioEngine", () => {
  it("opens the microphone with echo cancellation and resumes the context", async () => {
    const { getUserMedia, fake } = await startedEngine();
    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
    expect(MIC_CONSTRAINTS.audio).toMatchObject({ echoCancellation: true, channelCount: 1 });
    expect(fake.context.resume).toHaveBeenCalled();
    expect(fake.sink.gain.value).toBe(0);
    expect(fake.processor.connect).toHaveBeenCalledWith(fake.sink);
  });

  it("falls back to a ScriptProcessorNode and streams 16 kHz chunks", async () => {
    const { handlers, micFrame } = await startedEngine();
    micFrame(0.25);
    micFrame(0.25);
    expect(handlers.onChunk).not.toHaveBeenCalled();
    micFrame(0.25);
    expect(handlers.onChunk).toHaveBeenCalledTimes(1);
    expect(base64ToBytes(handlers.onChunk.mock.calls[0][0]).length).toBe(3200);
    expect(handlers.onLevel).toHaveBeenLastCalledWith(0.25);
  });

  it("sends nothing while muted", async () => {
    const { engine, handlers, micFrame } = await startedEngine();
    engine.setMuted(true);
    for (let i = 0; i < 5; i++) micFrame(0.5);
    expect(handlers.onChunk).not.toHaveBeenCalled();
    expect(handlers.onLevel).toHaveBeenLastCalledWith(0);
    engine.setMuted(false);
    for (let i = 0; i < 3; i++) micFrame(0.5);
    expect(handlers.onChunk).toHaveBeenCalledTimes(1);
  });

  it("plays the model's speech and flushes it when the user talks over it", async () => {
    const { engine, handlers, fake, micFrame } = await startedEngine();
    engine.play(chunkOf(new Array(2400).fill(8000)), 24_000);
    engine.play(chunkOf(new Array(2400).fill(8000)), 24_000);
    expect(engine.playing).toBe(true);
    micFrame(0.4);
    micFrame(0.4);
    expect(handlers.onBargeIn).not.toHaveBeenCalled();
    micFrame(0.4);
    expect(handlers.onBargeIn).toHaveBeenCalledTimes(1);
    expect(engine.playing).toBe(false);
    expect(fake.playback.sources.every((source) => source.stopped)).toBe(true);
    expect(handlers.onPlaybackIdle).toHaveBeenCalled();
  });

  it("leaves barge-in to the server when local detection is off", async () => {
    const { engine, handlers, micFrame } = await startedEngine({ bargeIn: false });
    engine.play(chunkOf(new Array(2400).fill(8000)), 24_000);
    for (let i = 0; i < 6; i++) micFrame(0.9);
    expect(handlers.onBargeIn).not.toHaveBeenCalled();
    expect(engine.playing).toBe(true);
    expect(engine.flush()).toBe(true);
  });

  it("releases the microphone and closes the context on stop", async () => {
    const { engine, fake, track } = await startedEngine();
    engine.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(fake.context.close).toHaveBeenCalled();
    expect(engine.running).toBe(false);
    expect(engine.flush()).toBe(false);
  });

  it("explains a denied microphone and opens nothing", async () => {
    const createContext = vi.fn();
    const engine = new LiveAudioEngine({
      createContext,
      mediaDevices: {
        getUserMedia: async () => {
          throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
        },
      },
    });
    await expect(engine.start({ onChunk: vi.fn() })).rejects.toThrow("Microphone");
    expect(createContext).not.toHaveBeenCalled();
  });

  it("loads the capture worklet from the app's own origin", () => {
    expect(CAPTURE_WORKLET_URL).toBe("/live-voice-capture.js");
  });
});
