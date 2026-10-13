import { expect, it, vi } from "vitest";
import { createLevelStore } from "./levelStore";

it("clamps levels and only notifies when the level moves", () => {
  const store = createLevelStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);

  store.set(0.4);
  store.set(0.4);
  store.set(3);
  expect(store.get()).toBe(1);
  store.set(-1);
  expect(store.get()).toBe(0);
  expect(listener).toHaveBeenCalledTimes(3);

  unsubscribe();
  store.set(0.5);
  expect(listener).toHaveBeenCalledTimes(3);
});
