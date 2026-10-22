import { quietWrite } from "./client";
import type { WebSpokenReply } from "../model/protocol";

/**
 * Voice on the phone. Dictation records here and sends 16 kHz pieces through
 * the Mac to the same speech service its own composer uses; replies are
 * spoken with the Mac's voice, as audio the Mac fetches and the phone plays.
 */

export const DICTATION_RATE = 16_000;
/** About a second per piece: live enough, and well under the Mac's body limit. */
const PIECE = DICTATION_RATE;
/** The Mac's composer stops at ten minutes too. */
const LIMIT_SAMPLES = DICTATION_RATE * 600;

/** Linear resampling, as the Mac does; speech survives it fine. */
export function downsample(
  samples: Float32Array,
  from: number,
  to = DICTATION_RATE,
): Float32Array {
  if (!samples.length || from <= 0 || from === to) return samples.slice();
  const ratio = from / to;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const position = index * ratio;
    const base = Math.floor(position);
    const next = Math.min(base + 1, samples.length - 1);
    const fraction = position - base;
    out[index] = samples[base]! + (samples[next]! - samples[base]!) * fraction;
  }
  return out;
}

/** 16-bit little-endian PCM in base64, half the size of float samples. */
export function pcmBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => {
    const clamped = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    view.setInt16(index * 2, Math.round(clamped * 32_767), true);
  });
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

export function base64Bytes(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | undefined {
  const scope = window as typeof window & {
    webkitAudioContext?: AudioContextClass;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

export function canDictate(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && !!audioContextClass();
}

/** Lets speech play with the ringer switch off, where Safari allows it. */
function playThroughSilentMode() {
  const session = (
    navigator as Navigator & { audioSession?: { type: string } }
  ).audioSession;
  try {
    if (session) session.type = "playback";
  } catch {
    // older Safari
  }
}

export type Dictation = {
  /** Ends the recording; settles with the final transcript. */
  stop: () => Promise<string>;
  cancel: () => void;
};

/**
 * Records until stopped, sending a piece about every second. `onText` gets
 * the transcript so far after each piece and `onLevel` the loudness, 0-1.
 */
export async function startDictation({
  onText,
  onLevel,
}: {
  onText: (text: string) => void;
  onLevel?: (level: number) => void;
}): Promise<Dictation> {
  const Context = audioContextClass();
  if (!Context || !navigator.mediaDevices?.getUserMedia)
    throw new Error("This browser cannot record here. Use https.");
  // Asked first, inside the tap, so Safari shows its prompt.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new Context();
  let session: string;
  try {
    ({ session } = await quietWrite<{ session: string }>("dictateStart", {}));
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    throw error;
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  let buffered: Float32Array[] = [];
  let bufferedLength = 0;
  let total = 0;
  let queue = Promise.resolve();
  let failure: Error | null = null;
  let closed = false;

  const send = (samples: Float32Array) => {
    const pcm = pcmBase64(samples);
    queue = queue.then(async () => {
      if (failure || closed) return;
      try {
        const { text } = await quietWrite<{ text: string }>("dictateChunk", {
          session,
          pcm,
        });
        if (!closed) onText(text);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    });
  };
  const flush = (all: boolean) => {
    while (bufferedLength >= PIECE || (all && bufferedLength > 0)) {
      const joined = new Float32Array(bufferedLength);
      let at = 0;
      for (const part of buffered) {
        joined.set(part, at);
        at += part.length;
      }
      const take = all ? joined.length : PIECE;
      send(joined.slice(0, take));
      const rest = joined.slice(take);
      buffered = rest.length ? [rest] : [];
      bufferedLength = rest.length;
    }
  };

  processor.onaudioprocess = (event) => {
    if (closed) return;
    const input = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (const value of input) sum += value * value;
    onLevel?.(Math.min(1, Math.sqrt(sum / input.length) * 4));
    const samples = downsample(input, context.sampleRate);
    total += samples.length;
    if (total > LIMIT_SAMPLES) return;
    buffered.push(samples);
    bufferedLength += samples.length;
    flush(false);
  };
  source.connect(processor);
  processor.connect(context.destination);

  const release = () => {
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
    } catch {
      // already gone
    }
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => {});
  };

  return {
    stop: async () => {
      release();
      flush(true);
      await queue;
      closed = true;
      const { text } = await quietWrite<{ text: string }>("dictateFinish", {
        session,
      });
      if (failure && !text) throw failure;
      return text;
    },
    cancel: () => {
      closed = true;
      release();
      void quietWrite("dictateFinish", { session }).catch(() => {});
    },
  };
}

/** One reply read aloud; `stop` cuts it short. */
export type Speech = { done: Promise<void>; stop: () => void };

let player: AudioContext | null = null;

/**
 * Must run inside the tap: Safari only lets a page start audio from a
 * gesture, and the context then stays allowed for the pieces that follow.
 */
export function unlockAudio(): AudioContext {
  const Context = audioContextClass();
  if (!Context) throw new Error("This browser cannot play audio.");
  playThroughSilentMode();
  player ??= new Context();
  void player.resume().catch(() => {});
  return player;
}

export function speakReply(
  sessionId: string,
  onStage?: (stage: "preparing" | "speaking") => void,
): Speech {
  const context = unlockAudio();
  let stopped = false;
  let current: AudioBufferSourceNode | null = null;
  const audio = (text: string) =>
    quietWrite<{ wav: string }>("voiceAudio", { text }).then(({ wav }) =>
      context.decodeAudioData(base64Bytes(wav)),
    );
  const done = (async () => {
    onStage?.("preparing");
    const reply = await quietWrite<WebSpokenReply>("voiceReply", {
      sessionId,
    });
    // Each piece is fetched while the one before it plays.
    let next = reply.parts[0] ? audio(reply.parts[0]) : null;
    for (let index = 0; next && !stopped; index++) {
      const buffer = await next;
      next = reply.parts[index + 1] ? audio(reply.parts[index + 1]!) : null;
      if (stopped) break;
      onStage?.("speaking");
      await new Promise<void>((resolve) => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.onended = () => resolve();
        current = source;
        source.start();
      });
    }
    next?.catch(() => {});
  })();
  return {
    done,
    stop: () => {
      stopped = true;
      try {
        current?.stop();
      } catch {
        // not started
      }
    },
  };
}
