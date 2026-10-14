// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterSessionMessage } from "../model/sessionMessaging";
import {
  COOPERATIVE_MODE_CHANGE_EVENT,
  createSessionMessageStore,
  loadCooperativeMode,
  resetCooperativeModeCache,
  saveCooperativeMode,
} from "./sessionMessageStore";

const KEY = "test.sessionMessages";

function message(id: string): InterSessionMessage {
  return {
    id,
    fromSessionId: "a",
    fromTitle: "A",
    toSessionId: "b",
    toTitle: "B",
    text: "hello",
    mode: "run",
    origin: "user",
    status: "queued",
    createdAt: 1,
    hop: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetCooperativeModeCache();
});

describe("createSessionMessageStore", () => {
  it("records, patches and persists messages", () => {
    const store = createSessionMessageStore(KEY);
    const listener = vi.fn();
    store.subscribe(listener);
    store.add(message("m1"));
    store.add(message("m2"));
    store.update("m1", { status: "delivered", deliveredAt: 5 });
    store.apply([{ id: "m2", patch: { status: "failed", error: "nope" } }]);
    expect(listener).toHaveBeenCalledTimes(4);

    const reloaded = createSessionMessageStore(KEY);
    expect(reloaded.get("m1")).toMatchObject({
      status: "delivered",
      deliveredAt: 5,
    });
    expect(reloaded.get("m2")).toMatchObject({ status: "failed", error: "nope" });
    reloaded.remove("m1");
    expect(reloaded.snapshot().map((entry) => entry.id)).toEqual(["m2"]);
  });

  it("keeps a stable snapshot until something changes", () => {
    const store = createSessionMessageStore(KEY);
    store.add(message("m1"));
    const before = store.snapshot();
    store.apply([]);
    store.update("missing", { status: "replied" });
    expect(store.snapshot()).toBe(before);
  });

  it("remembers which replies it has read directives from", () => {
    const store = createSessionMessageStore(KEY);
    store.markProcessed("block-1");
    expect(createSessionMessageStore(KEY).isProcessed("block-1")).toBe(true);
    expect(store.isProcessed("block-2")).toBe(false);
  });

  it("survives damaged storage", () => {
    localStorage.setItem(KEY, "{not json");
    const store = createSessionMessageStore(KEY);
    expect(store.snapshot()).toEqual([]);
    localStorage.setItem(
      KEY,
      JSON.stringify({ messages: [{ id: 3 }, message("ok")], processed: [1, "b"] }),
    );
    const partial = createSessionMessageStore(KEY);
    expect(partial.snapshot().map((entry) => entry.id)).toEqual(["ok"]);
    expect(partial.isProcessed("b")).toBe(true);
  });
});

describe("cooperative mode", () => {
  it("is off until turned on, and remembers since when", () => {
    expect(loadCooperativeMode()).toEqual({ enabled: false, since: 0 });
    const changed = vi.fn();
    window.addEventListener(COOPERATIVE_MODE_CHANGE_EVENT, changed);
    saveCooperativeMode(true, 1234);
    expect(loadCooperativeMode()).toEqual({ enabled: true, since: 1234 });
    resetCooperativeModeCache();
    expect(loadCooperativeMode()).toEqual({ enabled: true, since: 1234 });
    saveCooperativeMode(false);
    resetCooperativeModeCache();
    expect(loadCooperativeMode().enabled).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(COOPERATIVE_MODE_CHANGE_EVENT, changed);
  });
});
