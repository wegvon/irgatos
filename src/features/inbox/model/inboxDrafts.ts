/**
 * Unsent replies typed into an Inbox item's comment box, kept per item so
 * switching items or restarting the app does not lose them.
 */

export type InboxDraft = {
  body: string;
  updatedAt: number;
};

export type InboxDrafts = Readonly<Record<string, InboxDraft>>;

const STORAGE_KEY = "irgat.inboxDrafts";
const CHANGED = "irgat:inbox-drafts-changed";
export const INBOX_DRAFT_MAX_CHARS = 20_000;
const MAX_DRAFTS = 200;

export function parseInboxDrafts(raw: string | null): InboxDrafts {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const drafts: Record<string, InboxDraft> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key || !value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.body !== "string" || !entry.body.trim()) continue;
    drafts[key] = {
      body: entry.body.slice(0, INBOX_DRAFT_MAX_CHARS),
      updatedAt:
        typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
          ? entry.updatedAt
          : 0,
    };
  }
  return drafts;
}

/** Sets or, for blank text, removes one draft. Oldest drafts go past the cap. */
export function withInboxDraft(
  drafts: InboxDrafts,
  key: string,
  body: string,
  now: number,
): InboxDrafts {
  if (!key) return drafts;
  if (!body.trim()) {
    if (!(key in drafts)) return drafts;
    const { [key]: _removed, ...rest } = drafts;
    return rest;
  }
  const next: Record<string, InboxDraft> = {
    ...drafts,
    [key]: { body: body.slice(0, INBOX_DRAFT_MAX_CHARS), updatedAt: now },
  };
  const keys = Object.keys(next);
  if (keys.length <= MAX_DRAFTS) return next;
  const kept = keys
    .sort((a, b) => next[b].updatedAt - next[a].updatedAt)
    .slice(0, MAX_DRAFTS);
  return Object.fromEntries(kept.map((entry) => [entry, next[entry]]));
}

let cachedRaw: string | null | undefined;
let cachedDrafts: InboxDrafts = {};

export function loadInboxDrafts(): InboxDrafts {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return cachedDrafts;
  }
  if (raw === cachedRaw) return cachedDrafts;
  cachedRaw = raw;
  cachedDrafts = parseInboxDrafts(raw);
  return cachedDrafts;
}

export function inboxDraft(key: string): string {
  return loadInboxDrafts()[key]?.body ?? "";
}

/** False when storage refused the write. */
export function saveInboxDraft(
  key: string,
  body: string,
  now = Date.now(),
): boolean {
  const current = loadInboxDrafts();
  const next = withInboxDraft(current, key, body, now);
  if (next === current) return true;
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedDrafts = next;
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
  return true;
}

export function clearInboxDraft(key: string): boolean {
  return saveInboxDraft(key, "");
}

export function subscribeInboxDrafts(listener: () => void): () => void {
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
