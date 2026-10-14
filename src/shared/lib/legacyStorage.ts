/**
 * Browser storage written before the product rename lives under `monocode.*`
 * and `monocode:*` keys. The current names replace that prefix with `irgat`.
 */
export const LEGACY_STORAGE_MARKER = "irgat:legacy-storage-imported";

/** Keys whose renamed form also changed a "mono" word, so the prefix alone is wrong. */
const RENAMED_KEYS: Readonly<Record<string, string>> = {
  "monocode:mono-roster": "irgat:irgat-roster",
  "monocode:monos-changed": "irgat:irgats-changed",
  "monocode:mono-handed": "irgat:irgat-handed",
  "monocode:monos": "irgat:irgats",
  "monocode:mono-profiles": "irgat:irgat-profiles",
  "monocode:mono-intro-dismissed": "irgat:irgat-intro-dismissed",
  "monocode:open-mono": "irgat:open-irgat",
  "monocode:mono-card-sessions": "irgat:irgat-card-sessions",
  "monocode:mono-declined-habits": "irgat:irgat-declined-habits",
  "monocode:mono-files-changed": "irgat:irgat-files-changed",
  "monocode:mono-habits-active": "irgat:irgat-habits-active",
  "monocode:mono-habits-check-now": "irgat:irgat-habits-check-now",
  "monocode:mono-rotations": "irgat:irgat-rotations",
  "monocode:monos-enabled-change": "irgat:irgats-enabled-change",
  "monocode.monoMenuBarIcon": "irgat.irgatMenuBarIcon",
  "monocode:mono-menu-bar-change": "irgat:irgat-menu-bar-change",
  "monocode-browser-chrome-library": "irgat-browser-chrome-library",
};

/** A chat background kept for one Irgat was keyed `mono:<id>`, now `irgat:<id>`. */
const BACKGROUNDS_KEY = "irgat:project-chat-backgrounds";
const LEGACY_BACKGROUND_PREFIX = "mono:";
const BACKGROUND_PREFIX = "irgat:";

/** The current name for a stored key, or null when it is not a legacy one. */
export function currentStorageKey(legacyKey: string): string | null {
  const renamed = RENAMED_KEYS[legacyKey];
  if (renamed) return renamed;
  if (legacyKey.startsWith("monocode.") || legacyKey.startsWith("monocode:")) {
    return `irgat${legacyKey.slice("monocode".length)}`;
  }
  return null;
}

type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "key" | "length"
>;

function renameBackgroundKeys(storage: StorageLike): void {
  const raw = storage.getItem(BACKGROUNDS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const entries = parsed as Record<string, unknown>;
    let changed = false;
    for (const key of Object.keys(entries)) {
      if (!key.startsWith(LEGACY_BACKGROUND_PREFIX)) continue;
      const current = BACKGROUND_PREFIX + key.slice(LEGACY_BACKGROUND_PREFIX.length);
      if (!(current in entries)) entries[current] = entries[key];
      delete entries[key];
      changed = true;
    }
    if (changed) storage.setItem(BACKGROUNDS_KEY, JSON.stringify(entries));
  } catch {
    // A value that is not JSON is left as the app wrote it.
  }
}

/**
 * Copies legacy keys to their current names once. A key that already exists
 * under the new name wins, and the legacy copy stays where it is so an older
 * build still finds its data. Returns how many keys were copied.
 */
export function migrateLegacyStorage(storage: StorageLike): number {
  try {
    if (storage.getItem(LEGACY_STORAGE_MARKER) != null) return 0;
    const legacyKeys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key != null && currentStorageKey(key) != null) legacyKeys.push(key);
    }
    let copied = 0;
    for (const legacy of legacyKeys) {
      const current = currentStorageKey(legacy);
      if (current == null || storage.getItem(current) != null) continue;
      const value = storage.getItem(legacy);
      if (value == null) continue;
      storage.setItem(current, value);
      copied += 1;
    }
    renameBackgroundKeys(storage);
    storage.setItem(LEGACY_STORAGE_MARKER, "1");
    return copied;
  } catch {
    return 0;
  }
}
