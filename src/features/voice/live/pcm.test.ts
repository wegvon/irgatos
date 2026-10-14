import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToPcm16,
  decodeOutputChunk,
  encodeInputChunk,
  floatToPcm16,
  INPUT_MIME_TYPE,
  pcm16ToBytes,
  pcm16ToFloat,
  PcmChunker,
  pcmRate,
  resample,
  rms,
} from "./pcm";

describe("PCM16 conversion", () => {
  it("scales floats to the full signed 16-bit range and clamps beyond it", () => {
    expect(Array.from(floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -3])))).toEqual([
      0, 32767, -32768, 16384, -16384, 32767, -32768,
    ]);
  });

  it("treats NaN as silence", () => {
    expect(Array.from(floatToPcm16(new Float32Array([Number.NaN])))).toEqual([0]);
  });

  it("round-trips floats through PCM16 within one step", () => {
    const input = new Float32Array([0, 0.25, -0.25, 0.999, -0.999, 0.001]);
    const back = pcm16ToFloat(floatToPcm16(input));
    input.forEach((value, index) => expect(back[index]).toBeCloseTo(value, 4));
  });

  it("writes little-endian bytes", () => {
    const bytes = pcm16ToBytes(new Int16Array([1, -2, 0x1234]));
    expect(Array.from(bytes)).toEqual([0x01, 0x00, 0xfe, 0xff, 0x34, 0x12]);
    expect(Array.from(bytesToPcm16(bytes))).toEqual([1, -2, 0x1234]);
  });

  it("drops a trailing odd byte and reads from an offset view", () => {
    const backing = new Uint8Array([9, 0x01, 0x00, 0x02, 0x00, 0x07]);
    expect(Array.from(bytesToPcm16(backing.subarray(1)))).toEqual([1, 2]);
  });
});

describe("base64", () => {
  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const encoded = bytesToBase64(bytes);
    expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
  });

  it("handles buffers larger than one fromCharCode batch", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) & 0xff);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("ignores whitespace in what the server sends", () => {
    expect(Array.from(base64ToBytes("AQI\nD"))).toEqual([1, 2, 3]);
  });
});

describe("resample", () => {
  it("averages windows when downsampling 48 kHz to 16 kHz", () => {
    const input = new Float32Array([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]);
    expect(Array.from(resample(input, 48_000, 16_000)).map((v) => +v.toFixed(3))).toEqual([
      0.3, 1, -1,
    ]);
  });

  it("handles a ratio that is not a whole number", () => {
    const input = new Float32Array(441).fill(0.5);
    const output = resample(input, 44_100, 16_000);
    expect(output.length).toBe(160);
    expect(output.every((value) => Math.abs(value - 0.5) < 1e-6)).toBe(true);
  });

  it("interpolates when upsampling and copies when rates match", () => {
    expect(Array.from(resample(new Float32Array([0, 1]), 1, 2))).toEqual([0, 0.5, 1, 1]);
    const same = new Float32Array([0.1, 0.2]);
    const copy = resample(same, 16_000, 16_000);
    expect(copy).toEqual(same);
    expect(copy).not.toBe(same);
  });

  it("rejects nonsense rates", () => {
    expect(() => resample(new Float32Array(1), 0, 16_000)).toThrow();
  });
});

describe("chunks", () => {
  it("encodes a microphone frame as 16 kHz base64 PCM", () => {
    const frame = new Float32Array(480).fill(0.5);
    const bytes = base64ToBytes(encodeInputChunk(frame, 48_000));
    expect(bytes.length).toBe(160 * 2);
    expect(bytesToPcm16(bytes)[0]).toBe(16384);
    expect(INPUT_MIME_TYPE).toBe("audio/pcm;rate=16000");
  });

  it("decodes the model's 24 kHz chunk into playable floats", () => {
    const base64 = bytesToBase64(pcm16ToBytes(new Int16Array([0, 16384, -32768])));
    const samples = decodeOutputChunk(base64);
    expect(Array.from(samples).map((v) => +v.toFixed(3))).toEqual([0, 0.5, -1]);
  });

  it("reads the rate from the mime type", () => {
    expect(pcmRate("audio/pcm;rate=24000")).toBe(24_000);
    expect(pcmRate("audio/pcm; rate=16000")).toBe(16_000);
    expect(pcmRate("audio/pcm")).toBe(24_000);
    expect(pcmRate(undefined)).toBe(24_000);
  });

  it("measures loudness", () => {
    expect(rms(new Float32Array())).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array([4]))).toBe(1);
  });

  it("collects frames into 100 ms chunks and keeps the remainder", () => {
    const chunker = new PcmChunker(48_000, 100);
    expect(chunker.push(new Float32Array(2048))).toEqual([]);
    expect(chunker.push(new Float32Array(2048))).toEqual([]);
    const chunks = chunker.push(new Float32Array(2048));
    expect(chunks).toHaveLength(1);
    // 4800 device samples are 1600 at 16 kHz.
    expect(base64ToBytes(chunks[0]).length).toBe(3200);
    const rest = chunker.flush();
    expect(rest && base64ToBytes(rest).length).toBe(((6144 - 4800) / 3) * 2);
    expect(chunker.flush()).toBeNull();
  });

  it("emits several chunks from one large frame, in order", () => {
    const chunker = new PcmChunker(16_000, 10);
    const frame = Float32Array.from({ length: 480 }, (_, i) => (i < 160 ? 0.5 : i < 320 ? -0.5 : 0));
    const chunks = chunker.push(frame).map((chunk) => bytesToPcm16(base64ToBytes(chunk))[0]);
    expect(chunks).toEqual([16384, -16384, 0]);
  });

  it("forgets buffered audio on reset", () => {
    const chunker = new PcmChunker(16_000, 100);
    chunker.push(new Float32Array(100));
    chunker.reset();
    expect(chunker.flush()).toBeNull();
  });
});
