import { describe, expect, it } from "vitest";
import { createEndpointer } from "./endpointing";

/** Feeds one sample every 50 ms, the rate Rust reports levels at. */
function feed(
  endpointer: ReturnType<typeof createEndpointer>,
  from: number,
  ms: number,
  level: number,
) {
  for (let at = from; at < from + ms; at += 50) endpointer.level(level, at);
  return from + ms;
}

describe("createEndpointer", () => {
  it("ends the turn after speech and then the configured pause", () => {
    const endpointer = createEndpointer({ pauseMs: 1200 });
    let now = feed(endpointer, 0, 1000, 0.1);
    expect(endpointer.heard()).toBe(false);
    expect(endpointer.ended(now)).toBe(false);

    now = feed(endpointer, now, 1500, 0.6);
    expect(endpointer.heard()).toBe(true);
    const lastWord = now - 50;

    now = feed(endpointer, now, 1000, 0.12);
    expect(endpointer.ended(now)).toBe(false);
    now = feed(endpointer, now, 400, 0.12);
    expect(endpointer.ended(now)).toBe(true);
    expect(now - lastWord).toBeGreaterThanOrEqual(1200);
  });

  it("never ends a capture where nobody spoke", () => {
    const endpointer = createEndpointer({ pauseMs: 800 });
    const now = feed(endpointer, 0, 10_000, 0.15);
    expect(endpointer.heard()).toBe(false);
    expect(endpointer.ended(now)).toBe(false);
  });

  it("ignores clicks and coughs shorter than a syllable", () => {
    const endpointer = createEndpointer({ pauseMs: 800 });
    let now = feed(endpointer, 0, 500, 0.1);
    for (let click = 0; click < 5; click += 1) {
      now = feed(endpointer, now, 100, 0.9);
      now = feed(endpointer, now, 600, 0.1);
    }
    expect(endpointer.heard()).toBe(false);
    expect(endpointer.ended(now + 5000)).toBe(false);
  });

  it("keeps a short breath inside a sentence from ending the turn", () => {
    const endpointer = createEndpointer({ pauseMs: 1200 });
    let now = feed(endpointer, 0, 300, 0.1);
    now = feed(endpointer, now, 800, 0.6);
    now = feed(endpointer, now, 700, 0.1);
    expect(endpointer.ended(now)).toBe(false);
    now = feed(endpointer, now, 800, 0.6);
    now = feed(endpointer, now, 700, 0.1);
    expect(endpointer.ended(now)).toBe(false);
  });

  it("raises the bar in a noisy room instead of hearing the noise as speech", () => {
    const endpointer = createEndpointer({ pauseMs: 1200 });
    let now = feed(endpointer, 0, 2000, 0.4);
    expect(endpointer.heard()).toBe(false);
    now = feed(endpointer, now, 600, 0.75);
    expect(endpointer.heard()).toBe(true);
    now = feed(endpointer, now, 1300, 0.42);
    expect(endpointer.ended(now)).toBe(true);
  });

  it("counts new words from the recognizer as speech, even when quiet", () => {
    const endpointer = createEndpointer({ pauseMs: 1000 });
    feed(endpointer, 0, 2000, 0.1);
    endpointer.words(2000);
    expect(endpointer.heard()).toBe(true);
    expect(endpointer.ended(2900)).toBe(false);
    endpointer.words(2900);
    expect(endpointer.ended(3800)).toBe(false);
    expect(endpointer.ended(3900)).toBe(true);
  });
});
