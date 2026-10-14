/**
 * "Remind me later" for Inbox items. A snoozed item leaves the list until its
 * time comes, then resurfaces with a badge until the user opens it. Kept in
 * localStorage so a snooze outlives restarts; one that fell due while the app
 * was closed resurfaces on the next launch.
 */

export type InboxSnoozeMeta = {
  /** Shown in the resurface toast, so it reads without the item loaded. */
  title?: string;
  /** Short reference such as "acme/web#12". */
  ref?: string;
};

export type InboxSnooze = InboxSnoozeMeta & {
  until: number;
  snoozedAt: number;
};

export type InboxResurfaced = InboxSnoozeMeta & {
  at: number;
};

export type InboxSnoozeState = {
  snoozed: Readonly<Record<string, InboxSnooze>>;
  resurfaced: Readonly<Record<string, InboxResurfaced>>;
};

export type InboxSnoozePresetId = "1h" | "later-today" | "tomorrow" | "next-week";

export type InboxSnoozePreset = {
  id: InboxSnoozePresetId;
  label: string;
  until: number;
};

export const INBOX_SNOOZE_PRESET_IDS: readonly InboxSnoozePresetId[] = [
  "1h",
  "later-today",
  "tomorrow",
  "next-week",
];

const STORAGE_KEY = "irgat.inboxSnoozes";
const CHANGED = "irgat:inbox-snoozes-changed";
/** Bounds the store if items vanish upstream while snoozed. */
const MAX_ENTRIES = 500;
const MORNING_HOUR = 9;

export const EMPTY_INBOX_SNOOZES: InboxSnoozeState = {
  snoozed: {},
  resurfaced: {},
};

/** When a preset ends, or null when it would not land in the future. */
export function snoozePresetTime(
  preset: InboxSnoozePresetId,
  now: Date = new Date(),
): number | null {
  const at = now.getTime();
  if (preset === "1h") return at + 60 * 60 * 1000;
  if (preset === "later-today") return at + 4 * 60 * 60 * 1000;
  const date = new Date(now);
  if (preset === "tomorrow") {
    date.setDate(date.getDate() + 1);
  } else {
    // The coming Monday; on a Monday that is a week away.
    date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7));
  }
  date.setHours(MORNING_HOUR, 0, 0, 0);
  return date.getTime() > at ? date.getTime() : null;
}

function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatSnoozeUntil(until: number, now = Date.now()): string {
  const date = new Date(until);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString())
    return `today ${clockLabel(until)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString())
    return `tomorrow ${clockLabel(until)}`;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The menu's presets with their resolved times; past ones are left out. */
export function snoozePresets(now: Date = new Date()): InboxSnoozePreset[] {
  const labels: Record<InboxSnoozePresetId, string> = {
    "1h": "In 1 hour",
    "later-today": "Later today",
    tomorrow: "Tomorrow morning",
    "next-week": "Next week",
  };
  const presets: InboxSnoozePreset[] = [];
  for (const id of INBOX_SNOOZE_PRESET_IDS) {
    const until = snoozePresetTime(id, now);
    if (until == null) continue;
    presets.push({
      id,
      label: `${labels[id]} (${formatSnoozeUntil(until, now.getTime())})`,
      until,
    });
  }
  return presets;
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.slice(0, max)
    : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function meta(value: Record<string, unknown>): InboxSnoozeMeta {
  const title = text(value.title, 300);
  const ref = text(value.ref, 120);
  return { ...(title ? { title } : {}), ...(ref ? { ref } : {}) };
}

/** The stored state; anything malformed is dropped rather than trusted. */
export function parseInboxSnoozes(raw: string | null): InboxSnoozeState {
  if (!raw) return EMPTY_INBOX_SNOOZES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_INBOX_SNOOZES;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_INBOX_SNOOZES;
  const record = parsed as Record<string, unknown>;
  const snoozed: Record<string, InboxSnooze> = {};
  const resurfaced: Record<string, InboxResurfaced> = {};
  if (record.snoozed && typeof record.snoozed === "object") {
    for (const [key, value] of Object.entries(record.snoozed)) {
      if (!key || !value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      if (!finite(entry.until)) continue;
      snoozed[key] = {
        until: entry.until,
        snoozedAt: finite(entry.snoozedAt) ? entry.snoozedAt : entry.until,
        ...meta(entry),
      };
    }
  }
  if (record.resurfaced && typeof record.resurfaced === "object") {
    for (const [key, value] of Object.entries(record.resurfaced)) {
      if (!key || !value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      if (!finite(entry.at)) continue;
      resurfaced[key] = { at: entry.at, ...meta(entry) };
    }
  }
  return { snoozed, resurfaced };
}

function trimmed<T>(
  entries: Record<string, T>,
  age: (entry: T) => number,
): Record<string, T> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return entries;
  const kept = keys
    .sort((a, b) => age(entries[b]) - age(entries[a]))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept.map((key) => [key, entries[key]]));
}

export function snoozeItem(
  state: InboxSnoozeState,
  key: string,
  until: number,
  now: number,
  info: InboxSnoozeMeta = {},
): InboxSnoozeState {
  if (!key) throw new Error("Cannot snooze an item without a key");
  if (!finite(until) || until <= now)
    throw new Error("Choose a time in the future.");
  const { [key]: _back, ...resurfaced } = state.resurfaced;
  return {
    snoozed: trimmed(
      {
        ...state.snoozed,
        [key]: { until, snoozedAt: now, ...meta(info) },
      },
      (entry) => entry.snoozedAt,
    ),
    resurfaced,
  };
}

export function unsnoozeItem(
  state: InboxSnoozeState,
  key: string,
): InboxSnoozeState {
  if (!(key in state.snoozed)) return state;
  const { [key]: _removed, ...snoozed } = state.snoozed;
  return { ...state, snoozed };
}

/** Opening a resurfaced item clears its badge. */
export function acknowledgeResurfaced(
  state: InboxSnoozeState,
  key: string,
): InboxSnoozeState {
  if (!(key in state.resurfaced)) return state;
  const { [key]: _seen, ...resurfaced } = state.resurfaced;
  return { ...state, resurfaced };
}

export function snoozedUntil(
  state: InboxSnoozeState,
  key: string,
  now: number,
): number | undefined {
  const entry = state.snoozed[key];
  return entry && entry.until > now ? entry.until : undefined;
}

export function isResurfaced(state: InboxSnoozeState, key: string): boolean {
  return key in state.resurfaced;
}

/** Moves every snooze whose time has come to the resurfaced set. */
export function resurfaceDue(
  state: InboxSnoozeState,
  now: number,
): {
  state: InboxSnoozeState;
  resurfaced: Array<InboxResurfaced & { key: string }>;
} {
  const due = Object.entries(state.snoozed).filter(
    ([, entry]) => entry.until <= now,
  );
  if (!due.length) return { state, resurfaced: [] };
  const snoozed = { ...state.snoozed };
  const back: Record<string, InboxResurfaced> = { ...state.resurfaced };
  const resurfaced: Array<InboxResurfaced & { key: string }> = [];
  for (const [key, entry] of due.sort((a, b) => a[1].until - b[1].until)) {
    delete snoozed[key];
    const { until: _until, snoozedAt: _snoozedAt, ...info } = entry;
    back[key] = { at: entry.until, ...info };
    resurfaced.push({ key, at: entry.until, ...info });
  }
  return {
    state: { snoozed, resurfaced: trimmed(back, (entry) => entry.at) },
    resurfaced,
  };
}

export function nextSnoozeExpiry(state: InboxSnoozeState): number | undefined {
  let next: number | undefined;
  for (const entry of Object.values(state.snoozed))
    if (next == null || entry.until < next) next = entry.until;
  return next;
}

let cachedRaw: string | null | undefined;
let cachedState: InboxSnoozeState = EMPTY_INBOX_SNOOZES;

export function loadInboxSnoozes(): InboxSnoozeState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedState;
  }
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  cachedState = parseInboxSnoozes(raw);
  return cachedState;
}

/** False when storage refused the write. */
export function saveInboxSnoozes(state: InboxSnoozeState): boolean {
  try {
    const raw = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedState = state;
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
  return true;
}

export function updateInboxSnoozes(
  change: (state: InboxSnoozeState) => InboxSnoozeState,
): boolean {
  const current = loadInboxSnoozes();
  const next = change(current);
  return next === current ? true : saveInboxSnoozes(next);
}

export function subscribeInboxSnoozes(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** setTimeout clamps delays above about 24.8 days to fire at once. */
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

/**
 * Resurfaces due snoozes now and again at each expiry, calling `onResurface`
 * with what came back. Returns a stop function.
 */
export function startInboxSnoozeWatcher(
  onResurface: (items: Array<InboxResurfaced & { key: string }>) => void,
  clock: () => number = Date.now,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // Saving below announces a change, which would re-enter this check.
  let checking = false;
  const check = () => {
    if (stopped || checking) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const now = clock();
    const { state, resurfaced } = resurfaceDue(loadInboxSnoozes(), now);
    if (resurfaced.length) {
      checking = true;
      try {
        saveInboxSnoozes(state);
      } finally {
        checking = false;
      }
      onResurface(resurfaced);
    }
    const next = nextSnoozeExpiry(state);
    if (next == null) return;
    timer = setTimeout(check, Math.min(Math.max(next - now, 0), MAX_TIMER_MS));
  };
  const stop = subscribeInboxSnoozes(check);
  check();
  return () => {
    stopped = true;
    stop();
    if (timer !== undefined) clearTimeout(timer);
  };
}
