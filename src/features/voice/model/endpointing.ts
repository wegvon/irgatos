/**
 * Decides when someone has finished talking, from input loudness and from
 * the recognizer producing words. Speech is anything well above the room's
 * noise floor; the turn ends once speech was heard and a pause has lasted
 * `pauseMs`. The floor follows the quietest recent input, so a fan or a
 * noisy café raises the bar instead of counting as speech.
 */
export type Endpointer = {
  /** A loudness sample from 0 to 1. */
  level: (level: number, now: number) => void;
  /** The recognizer produced new words, which only happens while talking. */
  words: (now: number) => void;
  /** Speech has been heard and the pause after it is long enough. */
  ended: (now: number) => boolean;
  heard: () => boolean;
};

export type EndpointOptions = {
  pauseMs: number;
  /** Sustained loudness needed before a sound counts as speech. */
  minSpeechMs?: number;
};

/** How far above the floor speech sits, on the 0 to 1 meter scale. */
const SPEECH_MARGIN = 0.16;
const MIN_THRESHOLD = 0.22;
/** Per sample, while quiet; the floor drops to quieter input at once. */
const FLOOR_RISE = 0.04;
const FLOOR_CREEP = 0.003;
/** A dip this short inside a word does not restart the speech timer. */
const BLIP_MS = 250;

export function createEndpointer({
  pauseMs,
  minSpeechMs = 250,
}: EndpointOptions): Endpointer {
  let floor: number | null = null;
  let speechStart: number | null = null;
  let lastVoice = 0;
  let heard = false;

  return {
    level(level, now) {
      floor ??= level;
      const threshold = Math.max(MIN_THRESHOLD, floor + SPEECH_MARGIN);
      if (level >= threshold) {
        // A steady new noise source creeps into the floor instead of
        // holding the turn open forever.
        floor += (level - floor) * FLOOR_CREEP;
        speechStart ??= now;
        lastVoice = now;
        if (now - speechStart >= minSpeechMs) heard = true;
        return;
      }
      if (level < floor) floor = level;
      else floor += (level - floor) * FLOOR_RISE;
      if (speechStart != null && !heard && now - lastVoice > BLIP_MS)
        speechStart = null;
    },
    words(now) {
      heard = true;
      lastVoice = Math.max(lastVoice, now);
    },
    ended(now) {
      return heard && now - lastVoice >= pauseMs;
    },
    heard: () => heard,
  };
}
