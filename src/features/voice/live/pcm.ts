/**
 * Raw audio the Gemini Live API speaks: little-endian 16-bit mono PCM,
 * 16 kHz from the microphone and 24 kHz back from the model, base64 in JSON.
 */

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const INPUT_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`;

/**
 * Resamples by averaging each output sample's window of input, which also
 * low-passes well enough for speech. Upsampling interpolates linearly.
 */
export function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0))
    throw new Error("sample rates must be positive");
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      output[i] = end > start ? sum / (end - start) : input[start] ?? 0;
    }
    return output;
  }
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

/** Clamps to [-1, 1] and scales asymmetrically, as PCM16 is. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i] || 0));
    output[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

export function pcm16ToFloat(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++)
    output[i] = input[i] < 0 ? input[i] / 0x8000 : input[i] / 0x7fff;
  return output;
}

/** The samples as little-endian bytes, whatever the host's byte order. */
export function pcm16ToBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return bytes;
}

/** A trailing odd byte is dropped; it cannot hold a sample. */
export function bytesToPcm16(bytes: Uint8Array): Int16Array {
  const count = Math.floor(bytes.length / 2);
  const samples = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true);
  return samples;
}

/** `String.fromCharCode` takes its arguments on the stack; keep calls small. */
const BASE64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Microphone samples at the device rate, as the API's base64 input chunk. */
export function encodeInputChunk(
  samples: Float32Array,
  deviceRate: number,
): string {
  return bytesToBase64(
    pcm16ToBytes(floatToPcm16(resample(samples, deviceRate, INPUT_SAMPLE_RATE))),
  );
}

/** A base64 chunk of the model's speech, as samples ready to play. */
export function decodeOutputChunk(base64: string): Float32Array {
  return pcm16ToFloat(bytesToPcm16(base64ToBytes(base64)));
}

/** The rate a `audio/pcm;rate=24000` mime type names, or the output default. */
export function pcmRate(mimeType: string | undefined): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? "");
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : OUTPUT_SAMPLE_RATE;
}

/** Root-mean-square loudness from 0 to 1. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length));
}

/**
 * Collects microphone frames into chunks of about `chunkMs`, so the socket
 * carries a few messages a second rather than one per audio callback.
 */
export class PcmChunker {
  private parts: Float32Array[] = [];
  private length = 0;
  private readonly target: number;

  constructor(
    private readonly deviceRate: number,
    chunkMs = 100,
  ) {
    this.target = Math.max(1, Math.round((deviceRate * chunkMs) / 1000));
  }

  /** Returns the chunks this frame completed, base64-encoded at 16 kHz. */
  push(frame: Float32Array): string[] {
    this.parts.push(frame.slice());
    this.length += frame.length;
    const chunks: string[] = [];
    while (this.length >= this.target) chunks.push(this.take(this.target));
    return chunks;
  }

  /** Whatever is left, or nothing. */
  flush(): string | null {
    return this.length ? this.take(this.length) : null;
  }

  reset() {
    this.parts = [];
    this.length = 0;
  }

  private take(count: number): string {
    const out = new Float32Array(count);
    let filled = 0;
    while (filled < count) {
      const head = this.parts[0];
      const need = count - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        this.parts.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        this.parts[0] = head.subarray(need);
        filled += need;
      }
    }
    this.length -= count;
    return encodeInputChunk(out, this.deviceRate);
  }
}
