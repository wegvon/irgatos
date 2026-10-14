import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backupKey,
  CORRUPT_COPIES_KEPT,
  corruptCopies,
  corruptKey,
  readStoredJson,
  writeStoredJson,
} from "./safeStorage";

function memoryStorage(listable = true) {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
  if (!listable) return { items, storage };
  const listing = Object.defineProperties(storage, {
    key: { value: (index: number) => [...items.keys()][index] ?? null },
    length: { get: () => items.size },
  });
  return { items, storage: listing };
}

afterEach(() => vi.restoreAllMocks());

describe("readStoredJson", () => {
  it("reads a value as it was stored", () => {
    const { items, storage } = memoryStorage();
    items.set("rooms", '[{"id":"a"}]');
    expect(readStoredJson("rooms", { storage })).toEqual([{ id: "a" }]);
    expect(readStoredJson("missing", { storage })).toBeUndefined();
  });

  it("keeps a malformed value aside and restores the last good copy", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { items, storage } = memoryStorage();
    writeStoredJson("rooms", ["a"], { storage, backup: true });
    writeStoredJson("rooms", ["a", "b"], { storage, backup: true });
    items.set("rooms", '["a", "b');

    expect(readStoredJson("rooms", { storage, now: () => 42 })).toEqual(["a"]);
    expect(items.get("rooms")).toBe('["a"]');
    expect(items.get(corruptKey("rooms", 42))).toBe('["a", "b');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("starts empty without a good copy but never loses the malformed value", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { items, storage } = memoryStorage();
    items.set("chat", "{not json");
    items.set(backupKey("chat"), "also {broken");
    expect(readStoredJson("chat", { storage, now: () => 7 })).toBeUndefined();
    expect(items.has("chat")).toBe(false);
    expect(items.get(corruptKey("chat", 7))).toBe("{not json");
  });

  it("does not overwrite an earlier corrupt copy from the same millisecond", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { items, storage } = memoryStorage();
    items.set("chat", "{one");
    readStoredJson("chat", { storage, now: () => 5 });
    items.set("chat", "{two");
    readStoredJson("chat", { storage, now: () => 5 });
    expect(items.get(corruptKey("chat", 5))).toBe("{one");
    expect(items.get(corruptKey("chat", 6))).toBe("{two");
  });

  it("keeps only the newest corrupt copies when storage can list its keys", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { items, storage } = memoryStorage();
    for (let at = 1; at <= CORRUPT_COPIES_KEPT + 2; at += 1) {
      items.set("chat", `{broken ${at}`);
      readStoredJson("chat", { storage, now: () => at * 10 });
    }
    items.set(corruptKey("other", 1), "x");
    expect(corruptCopies("chat", storage)).toEqual([
      corruptKey("chat", 30),
      corruptKey("chat", 40),
      corruptKey("chat", 50),
    ]);
    expect(items.has(corruptKey("other", 1))).toBe(true);
  });

  it("still recovers when storage cannot list its keys", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { items, storage } = memoryStorage(false);
    items.set("chat", "{broken");
    expect(readStoredJson("chat", { storage, now: () => 1 })).toBeUndefined();
    expect(corruptCopies("chat", storage)).toEqual([]);
    expect(items.get(corruptKey("chat", 1))).toBe("{broken");
  });

  it("treats storage that throws as empty", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(readStoredJson("rooms", { storage })).toBeUndefined();
  });
});

describe("writeStoredJson", () => {
  it("keeps the replaced value only when asked and only when it parses", () => {
    const { items, storage } = memoryStorage();
    writeStoredJson("chat", [1], { storage });
    writeStoredJson("chat", [2], { storage });
    expect(items.has(backupKey("chat"))).toBe(false);

    writeStoredJson("rooms", [1], { storage, backup: true });
    expect(items.has(backupKey("rooms"))).toBe(false);
    writeStoredJson("rooms", [1], { storage, backup: true });
    expect(items.has(backupKey("rooms"))).toBe(false);
    writeStoredJson("rooms", [2], { storage, backup: true });
    expect(items.get(backupKey("rooms"))).toBe("[1]");
    items.set("rooms", "{torn");
    writeStoredJson("rooms", [3], { storage, backup: true });
    expect(items.get(backupKey("rooms"))).toBe("[1]");
    expect(items.get("rooms")).toBe("[3]");
  });

  it("lets a full storage error reach the caller even if the copy fit", () => {
    const { items, storage } = memoryStorage();
    items.set("rooms", "[1]");
    const full = {
      ...storage,
      setItem: (key: string, value: string) => {
        if (key === "rooms") throw new Error("QuotaExceededError");
        storage.setItem(key, value);
      },
    };
    expect(() =>
      writeStoredJson("rooms", [2], { storage: full, backup: true }),
    ).toThrow("QuotaExceededError");
    expect(items.get("rooms")).toBe("[1]");
  });
});
