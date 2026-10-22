import { describe, expect, it } from "vitest";
import { base64Bytes, downsample, pcmBase64 } from "./voice";

describe("phone dictation audio", () => {
  it("resamples the microphone to 16 kHz", () => {
    const input = Float32Array.from({ length: 48 }, (_, index) => index / 48);
    const out = downsample(input, 48_000);
    expect(out.length).toBe(16);
    expect(out[1]).toBeCloseTo(3 / 48);
    expect(downsample(input, 16_000)).toEqual(input);
  });

  it("sends 16-bit little-endian PCM in base64", () => {
    const bytes = new Uint8Array(
      base64Bytes(pcmBase64(Float32Array.from([0, 1, -1, 2, Number.NaN]))),
    );
    const view = new DataView(bytes.buffer);
    expect(
      [0, 1, 2, 3, 4].map((index) => view.getInt16(index * 2, true)),
    ).toEqual([0, 32_767, -32_767, 32_767, 0]);
  });
});
