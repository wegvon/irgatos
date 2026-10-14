import { describe, expect, it } from "vitest";
import {
  currentStorageKey,
  LEGACY_STORAGE_MARKER,
  migrateLegacyStorage,
} from "./legacyStorage";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("currentStorageKey", () => {
  it("swaps the prefix and keeps the rest", () => {
    expect(currentStorageKey("monocode.themeHue")).toBe("irgat.themeHue");
    expect(currentStorageKey("monocode:theme")).toBe("irgat:theme");
    expect(currentStorageKey("monocode.remote-history.v2:/work/app")).toBe(
      "irgat.remote-history.v2:/work/app",
    );
  });

  it("maps the keys whose wording changed too", () => {
    expect(currentStorageKey("monocode:mono-roster")).toBe("irgat:irgat-roster");
    expect(currentStorageKey("monocode:open-mono")).toBe("irgat:open-irgat");
    expect(currentStorageKey("monocode.monoMenuBarIcon")).toBe(
      "irgat.irgatMenuBarIcon",
    );
    expect(currentStorageKey("monocode-browser-chrome-library")).toBe(
      "irgat-browser-chrome-library",
    );
  });

  it("leaves current and unrelated keys alone", () => {
    expect(currentStorageKey("irgat.themeHue")).toBeNull();
    expect(currentStorageKey("somethingElse")).toBeNull();
  });
});

describe("migrateLegacyStorage", () => {
  it("copies legacy keys when the new ones are absent and keeps the old", () => {
    const storage = memoryStorage({
      "monocode.themeHue": "120",
      "monocode:mono-roster": '[{"id":"a"}]',
      "monocode.ciRepairs.v1.pr-7": "{}",
    });
    expect(migrateLegacyStorage(storage)).toBe(3);
    expect(storage.getItem("irgat.themeHue")).toBe("120");
    expect(storage.getItem("irgat:irgat-roster")).toBe('[{"id":"a"}]');
    expect(storage.getItem("irgat.ciRepairs.v1.pr-7")).toBe("{}");
    expect(storage.getItem("monocode.themeHue")).toBe("120");
    expect(storage.getItem(LEGACY_STORAGE_MARKER)).toBe("1");
  });

  it("prefers a key that already exists under the new name", () => {
    const storage = memoryStorage({
      "monocode.themeHue": "120",
      "irgat.themeHue": "300",
      "monocode.colorScheme": "light",
    });
    expect(migrateLegacyStorage(storage)).toBe(1);
    expect(storage.getItem("irgat.themeHue")).toBe("300");
    expect(storage.getItem("monocode.themeHue")).toBe("120");
    expect(storage.getItem("irgat.colorScheme")).toBe("light");
  });

  it("runs once, so a key the user later removed is not brought back", () => {
    const storage = memoryStorage({ "monocode.themeHue": "120" });
    migrateLegacyStorage(storage);
    storage.data.delete("irgat.themeHue");
    expect(migrateLegacyStorage(storage)).toBe(0);
    expect(storage.getItem("irgat.themeHue")).toBeNull();
  });

  it("does nothing to a store with no legacy keys", () => {
    const storage = memoryStorage({ "irgat.themeHue": "10" });
    expect(migrateLegacyStorage(storage)).toBe(0);
    expect(storage.getItem("irgat.themeHue")).toBe("10");
  });

  it("renames per-Irgat chat background keys inside the stored map", () => {
    const storage = memoryStorage({
      "monocode:project-chat-backgrounds": "x",
      "irgat:project-chat-backgrounds": JSON.stringify({
        "mono:abc": { path: "/bg/a.png" },
        "/work/app": { path: "/bg/b.png" },
      }),
    });
    migrateLegacyStorage(storage);
    expect(
      JSON.parse(storage.getItem("irgat:project-chat-backgrounds") ?? "{}"),
    ).toEqual({
      "irgat:abc": { path: "/bg/a.png" },
      "/work/app": { path: "/bg/b.png" },
    });
  });

  it("copies the stored background map and renames its per-Irgat keys", () => {
    const storage = memoryStorage({
      "monocode:project-chat-backgrounds": JSON.stringify({
        "mono:abc": { path: "/bg/a.png" },
      }),
    });
    migrateLegacyStorage(storage);
    expect(
      JSON.parse(storage.getItem("irgat:project-chat-backgrounds") ?? "{}"),
    ).toEqual({ "irgat:abc": { path: "/bg/a.png" } });
  });
});
