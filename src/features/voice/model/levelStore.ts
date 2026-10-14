/**
 * Input loudness arrives a few dozen times a second. It lives outside React
 * state so only the meter re-renders, not the composer around it.
 */
export type LevelStore = {
  get: () => number;
  set: (level: number) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createLevelStore(): LevelStore {
  let level = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => level,
    set: (next) => {
      const clamped = Math.max(0, Math.min(1, next));
      if (clamped === level) return;
      level = clamped;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
