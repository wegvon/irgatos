/**
 * JSON in localStorage that survives a malformed value.
 *
 * A value that no longer parses is kept as `<key>.corrupt-<millis>.bak`
 * instead of being overwritten by the next save, and a store written with
 * `backup` falls back to its last good copy, `<key>.bak`.
 */

/** Corrupt copies kept per key; older ones are dropped. */
export const CORRUPT_COPIES_KEPT = 3;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem"> &
  Partial<Pick<Storage, "key" | "length">>;

export type StoredJsonOptions = {
  /** Keep the value being replaced as `<key>.bak`. Doubles the space used. */
  backup?: boolean;
  storage?: StorageLike;
  now?: () => number;
};

export function backupKey(key: string): string {
  return `${key}.bak`;
}

export function corruptKey(key: string, at: number): string {
  return `${key}.corrupt-${at}.bak`;
}

function storageOf(options: StoredJsonOptions): StorageLike | undefined {
  if (options.storage) return options.storage;
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function parse(raw: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return undefined;
  }
}

/** The corrupt copies of `key`, oldest first. Empty when the storage cannot list its keys. */
export function corruptCopies(key: string, storage?: StorageLike): string[] {
  const store = storage ?? storageOf({});
  if (
    !store ||
    typeof store.key !== "function" ||
    typeof store.length !== "number"
  )
    return [];
  const prefix = `${key}.corrupt-`;
  const found: Array<[number, string]> = [];
  for (let index = 0; index < store.length; index += 1) {
    const name = store.key(index);
    if (!name?.startsWith(prefix) || !name.endsWith(".bak")) continue;
    const stamp = Number(name.slice(prefix.length, -".bak".length));
    if (Number.isFinite(stamp)) found.push([stamp, name]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}

function quarantine(
  store: StorageLike,
  key: string,
  raw: string,
  now: number,
): void {
  let at = now;
  while (store.getItem(corruptKey(key, at)) != null) at += 1;
  try {
    store.setItem(corruptKey(key, at), raw);
  } catch {
    // Storage is full; the malformed value is lost either way.
  }
  const copies = corruptCopies(key, store);
  for (const old of copies.slice(
    0,
    Math.max(0, copies.length - CORRUPT_COPIES_KEPT),
  ))
    store.removeItem(old);
  console.warn(
    `[storage] ${key} was malformed; kept it as ${corruptKey(key, at)}`,
  );
}

/**
 * The parsed value at `key`, or `undefined` when there is none. A malformed
 * value is kept aside and the last good copy, if any, restored in its place.
 */
export function readStoredJson(
  key: string,
  options: StoredJsonOptions = {},
): unknown {
  const store = storageOf(options);
  if (!store) return undefined;
  try {
    const raw = store.getItem(key);
    if (!raw) return undefined;
    const parsed = parse(raw);
    if (parsed) return parsed.value;
    quarantine(store, key, raw, (options.now ?? Date.now)());
    const saved = store.getItem(backupKey(key));
    const restored = saved ? parse(saved) : undefined;
    if (saved && restored) {
      store.setItem(key, saved);
      return restored.value;
    }
    store.removeItem(key);
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Saves `value` at `key`. Throws what `setItem` throws, so callers can trim
 * and retry when storage is full.
 */
export function writeStoredJson(
  key: string,
  value: unknown,
  options: StoredJsonOptions = {},
): void {
  const store = storageOf(options);
  if (!store) throw new Error("Storage is unavailable");
  const text = JSON.stringify(value);
  if (options.backup) {
    const current = store.getItem(key);
    if (current && current !== text && parse(current)) {
      try {
        store.setItem(backupKey(key), current);
      } catch {
        // The copy is a fallback; never let it block the save itself.
      }
    }
  }
  store.setItem(key, text);
}
