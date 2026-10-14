import { decodeOutputChunk, PcmChunker, rms } from "./pcm";

/** Served from `public/`, since the CSP only runs scripts from the app itself. */
export const CAPTURE_WORKLET_URL = "/live-voice-capture.js";
export const CAPTURE_WORKLET_NAME = "irgat-live-capture";

/** How far ahead of now the first chunk of a reply is scheduled, in seconds. */
const LEAD_SECONDS = 0.05;

type SourceNode = {
  buffer: unknown;
  onended: (() => void) | null;
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
  disconnect(): void;
};

type BufferLike = {
  duration: number;
  getChannelData(channel: number): Float32Array;
};

/** The parts of an `AudioContext` playback needs. */
export type PlaybackContext = {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceNode;
};

type Scheduled = { source: SourceNode; start: number; end: number; level: number };

/**
 * The model's speech as a gapless queue: each chunk starts where the last
 * one ends. `flush` drops everything at once, which is what barge-in needs.
 */
export class LivePlayback {
  private queue: Scheduled[] = [];
  private cursor = 0;
  private idleListeners = new Set<() => void>();

  constructor(private readonly context: PlaybackContext) {}

  get playing(): boolean {
    return this.queue.length > 0;
  }

  /** Seconds of speech still to play. */
  get buffered(): number {
    return Math.max(0, this.cursor - this.context.currentTime);
  }

  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    return () => this.idleListeners.delete(listener);
  }

  enqueue(samples: Float32Array, sampleRate: number) {
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const now = this.context.currentTime;
    const start = Math.max(this.cursor, now + (this.queue.length ? 0 : LEAD_SECONDS));
    const entry: Scheduled = {
      source,
      start,
      end: start + buffer.duration,
      level: rms(samples),
    };
    source.onended = () => this.finished(entry);
    this.queue.push(entry);
    this.cursor = entry.end;
    source.start(start);
  }

  /** Stops every queued chunk now. Returns whether anything was playing. */
  flush(): boolean {
    const had = this.queue.length > 0;
    const queue = this.queue;
    this.queue = [];
    this.cursor = 0;
    for (const entry of queue) {
      entry.source.onended = null;
      try {
        entry.source.stop();
      } catch {
        // never started or already over
      }
      try {
        entry.source.disconnect();
      } catch {
        // already disconnected
      }
    }
    if (had) this.idle();
    return had;
  }

  /** Loudness of what is sounding right now, for the visualizer. */
  level(): number {
    const now = this.context.currentTime;
    return this.queue.find((entry) => entry.start <= now && now < entry.end)?.level ?? 0;
  }

  private finished(entry: Scheduled) {
    const index = this.queue.indexOf(entry);
    if (index < 0) return;
    this.queue.splice(index, 1);
    try {
      entry.source.disconnect();
    } catch {
      // already disconnected
    }
    if (!this.queue.length) {
      this.cursor = 0;
      this.idle();
    }
  }

  private idle() {
    for (const listener of this.idleListeners) listener();
  }
}

export type BargeInOptions = {
  /** RMS loudness that counts as speech over the Irgat's own voice. */
  threshold?: number;
  /** Consecutive loud frames needed, so a cough or a click does not count. */
  frames?: number;
};

/**
 * Notices the user talking over playback before the server's voice
 * detection does, so the Irgat stops at once rather than a beat later.
 * Echo cancellation keeps its own voice out of the microphone.
 */
export class BargeInDetector {
  private run = 0;
  private fired = false;
  private readonly threshold: number;
  private readonly frames: number;

  constructor(options: BargeInOptions = {}) {
    this.threshold = options.threshold ?? 0.06;
    this.frames = Math.max(1, options.frames ?? 3);
  }

  /** True once per reply, on the frame that crosses the line. */
  feed(level: number, playing: boolean): boolean {
    if (!playing) {
      this.reset();
      return false;
    }
    if (this.fired) return false;
    this.run = level >= this.threshold ? this.run + 1 : 0;
    if (this.run < this.frames) return false;
    this.fired = true;
    return true;
  }

  reset() {
    this.run = 0;
    this.fired = false;
  }
}

export type CaptureHandlers = {
  onFrame: (samples: Float32Array, sampleRate: number) => void;
};

type MediaStreamLike = { getTracks(): { stop(): void }[] };

type MediaDevicesLike = {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
};

export type LiveAudioDeps = {
  createContext?: () => AudioContext;
  mediaDevices?: MediaDevicesLike;
};

/** Microphone settings that keep the Irgat's own voice out of what it hears. */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

export function microphoneError(reason: unknown): string {
  const name = (reason as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Irgatos cannot use the microphone. Allow it in System Settings › Privacy & Security › Microphone.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found";
  if (name === "NotReadableError") return "Another app is holding the microphone";
  return reason instanceof Error ? reason.message : String(reason);
}

export type EngineHandlers = {
  /** A base64 16 kHz PCM chunk to stream up. */
  onChunk: (base64: string) => void;
  /** Microphone loudness from 0 to 1, a few times a second. */
  onLevel?: (level: number) => void;
  /** The user started talking over the Irgat; playback is already flushed. */
  onBargeIn?: () => void;
  onPlaybackIdle?: () => void;
};

/**
 * Microphone in, speech out, on one `AudioContext`. Capture runs on an
 * AudioWorklet, or a ScriptProcessorNode where worklets cannot load.
 */
export class LiveAudioEngine {
  private context: AudioContext | null = null;
  private stream: MediaStreamLike | null = null;
  private nodes: AudioNode[] = [];
  private chunker: PcmChunker | null = null;
  private playback: LivePlayback | null = null;
  private muted = false;
  private bargeInEnabled = true;
  private readonly detector = new BargeInDetector();
  private handlers: EngineHandlers | null = null;

  constructor(private readonly deps: LiveAudioDeps = {}) {}

  get running(): boolean {
    return !!this.context;
  }

  get playing(): boolean {
    return this.playback?.playing ?? false;
  }

  async start(handlers: EngineHandlers, options: { bargeIn?: boolean } = {}) {
    if (this.context) throw new Error("Live audio is already running");
    this.handlers = handlers;
    this.bargeInEnabled = options.bargeIn ?? true;
    const devices = this.deps.mediaDevices ?? globalThis.navigator?.mediaDevices;
    if (!devices?.getUserMedia)
      throw new Error("This system cannot record from the microphone here");
    let stream: MediaStreamLike;
    try {
      stream = await devices.getUserMedia(MIC_CONSTRAINTS);
    } catch (reason) {
      throw new Error(microphoneError(reason));
    }
    const context = (this.deps.createContext ?? (() => new AudioContext()))();
    this.stream = stream;
    this.context = context;
    try {
      if (context.state === "suspended") await context.resume();
      this.chunker = new PcmChunker(context.sampleRate);
      this.playback = new LivePlayback(context as unknown as PlaybackContext);
      this.playback.onIdle(() => {
        this.detector.reset();
        this.handlers?.onPlaybackIdle?.();
      });
      await this.connectMicrophone(context, stream as MediaStream);
    } catch (reason) {
      this.stop();
      throw reason instanceof Error ? reason : new Error(String(reason));
    }
  }

  /** A muted microphone sends nothing, not silence. */
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.chunker?.reset();
      this.detector.reset();
      this.handlers?.onLevel?.(0);
    }
  }

  play(base64: string, sampleRate: number) {
    this.playback?.enqueue(decodeOutputChunk(base64), sampleRate);
  }

  /** Drops queued speech; the server's `interrupted` and barge-in land here. */
  flush(): boolean {
    return this.playback?.flush() ?? false;
  }

  outputLevel(): number {
    return this.playback?.level() ?? 0;
  }

  /** Handles one microphone frame; public so tests can drive it. */
  frame(samples: Float32Array, sampleRate: number) {
    if (this.muted || !this.handlers) return;
    const level = rms(samples);
    this.handlers.onLevel?.(level);
    if (this.bargeInEnabled && this.detector.feed(level, this.playing)) {
      this.flush();
      this.handlers.onBargeIn?.();
    }
    const chunker = this.chunker ?? (this.chunker = new PcmChunker(sampleRate));
    for (const chunk of chunker.push(samples)) this.handlers.onChunk(chunk);
  }

  stop() {
    this.playback?.flush();
    this.playback = null;
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.nodes = [];
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    const context = this.context;
    this.context = null;
    this.chunker = null;
    this.handlers = null;
    this.detector.reset();
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }

  private async connectMicrophone(context: AudioContext, stream: MediaStream) {
    const source = context.createMediaStreamSource(stream);
    // Processing nodes only run while something pulls them; a muted gain
    // to the speakers does, without echoing the microphone.
    const sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);
    this.nodes.push(source, sink);
    const rate = context.sampleRate;
    if (context.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        await context.audioWorklet.addModule(CAPTURE_WORKLET_URL);
        const worklet = new AudioWorkletNode(context, CAPTURE_WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
        });
        worklet.port.onmessage = (event: MessageEvent<Float32Array>) =>
          this.frame(event.data, rate);
        source.connect(worklet);
        worklet.connect(sink);
        this.nodes.push(worklet);
        return;
      } catch (reason) {
        console.warn("Live voice: falling back to ScriptProcessorNode", reason);
      }
    }
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) =>
      this.frame(new Float32Array(event.inputBuffer.getChannelData(0)), rate);
    source.connect(processor);
    processor.connect(sink);
    this.nodes.push(processor);
  }
}
