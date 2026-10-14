import { pathKey } from "../../../shared/lib/paths";
import {
  createReviewNote,
  sanitizeReviewNote,
  type ReviewKind,
  type ReviewNote,
  type ReviewNoteInput,
  type ReviewStatus,
} from "./reviewNotes";

const KEY = "irgat.redlineReview.v1";
/** localStorage is shared with everything else; keep one review from crowding it. */
export const MAX_REVIEW_NOTES_PER_SCOPE = 200;
/** Where a note lands when no project or Irgat is in front. */
export const GLOBAL_REVIEW_SCOPE = "global";

type Stored = Record<string, ReviewNote[]>;

const listeners = new Set<() => void>();
let cache: Stored | null = null;
let sequence = 0;

export function projectReviewScope(cwd: string): string {
  return `project:${pathKey(cwd)}`;
}

export function irgatReviewScope(irgatId: string): string {
  return `irgat:${irgatId}`;
}

export class ReviewFullError extends Error {
  constructor() {
    super(
      `This review already holds ${MAX_REVIEW_NOTES_PER_SCOPE} notes. Submit or clear some first.`,
    );
  }
}

function readAll(): Stored {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const out: Stored = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [scope, list] of Object.entries(parsed)) {
        if (!Array.isArray(list)) continue;
        const notes = list
          .map(sanitizeReviewNote)
          .filter((note): note is ReviewNote => note != null)
          .slice(0, MAX_REVIEW_NOTES_PER_SCOPE);
        if (notes.length) out[scope] = notes;
      }
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

function writeAll(next: Stored): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota: the review still holds for this run
  }
  for (const listener of [...listeners]) listener();
}

function writeScope(scope: string, notes: ReviewNote[]): void {
  const next = { ...readAll() };
  if (notes.length) next[scope] = notes;
  else delete next[scope];
  writeAll(next);
}

export function subscribeReviewNotes(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: ReviewNote[] = [];

export function listReviewNotes(scope: string): ReviewNote[] {
  return readAll()[scope] ?? EMPTY;
}

function nextId(now: number): string {
  sequence += 1;
  return `rv-${now.toString(36)}-${sequence.toString(36)}`;
}

/**
 * Queue a note in `scope`. A full review gives up its oldest resolved note
 * first; with none to spare it refuses rather than lose open work.
 */
export function addReviewNote(
  scope: string,
  input: ReviewNoteInput,
  now = Date.now(),
): ReviewNote | null {
  const note = createReviewNote(input, now, nextId(now));
  if (!note) return null;
  let notes = [...listReviewNotes(scope)];
  if (notes.length >= MAX_REVIEW_NOTES_PER_SCOPE) {
    const resolved = notes.findIndex((item) => item.status === "resolved");
    if (resolved < 0) throw new ReviewFullError();
    notes.splice(resolved, 1);
  }
  notes = [...notes, note];
  writeScope(scope, notes);
  return note;
}

export type ReviewNotePatch = {
  kind?: ReviewKind;
  note?: string;
  status?: ReviewStatus;
};

export function updateReviewNote(
  scope: string,
  id: string,
  patch: ReviewNotePatch,
  now = Date.now(),
): void {
  const notes = listReviewNotes(scope);
  const index = notes.findIndex((item) => item.id === id);
  if (index < 0) return;
  const current = notes[index];
  const text = patch.note?.replace(/\r\n?/g, "\n").trim();
  const status = patch.status ?? current.status;
  const next: ReviewNote = {
    ...current,
    ...(patch.kind ? { kind: patch.kind } : {}),
    ...(text ? { note: text } : {}),
    status,
  };
  if (status === "resolved" && current.status !== "resolved")
    next.resolvedAt = now;
  if (status !== "resolved") delete next.resolvedAt;
  if (status === "open") delete next.sentAt;
  const updated = [...notes];
  updated[index] = next;
  writeScope(scope, updated);
}

export function removeReviewNote(scope: string, id: string): void {
  const notes = listReviewNotes(scope);
  if (!notes.some((item) => item.id === id)) return;
  writeScope(
    scope,
    notes.filter((item) => item.id !== id),
  );
}

export function markReviewNotesSent(
  scope: string,
  ids: readonly string[],
  now = Date.now(),
): void {
  const wanted = new Set(ids);
  const notes = listReviewNotes(scope);
  if (!notes.some((item) => wanted.has(item.id))) return;
  writeScope(
    scope,
    notes.map((item) =>
      wanted.has(item.id) && item.status === "open"
        ? { ...item, status: "sent", sentAt: now }
        : item,
    ),
  );
}

export function clearResolvedReviewNotes(scope: string): void {
  const notes = listReviewNotes(scope);
  if (!notes.some((item) => item.status === "resolved")) return;
  writeScope(
    scope,
    notes.filter((item) => item.status !== "resolved"),
  );
}

export function resetReviewStoreCache(): void {
  cache = null;
}

let activeScope: string | null = null;
const activeListeners = new Set<() => void>();

/** The project or Irgat in front, which notes without a scope join. */
export function setActiveReviewScope(scope: string | null): void {
  if (scope === activeScope) return;
  activeScope = scope;
  for (const listener of [...activeListeners]) listener();
}

export function getActiveReviewScope(): string {
  return activeScope ?? GLOBAL_REVIEW_SCOPE;
}

export function subscribeActiveReviewScope(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

export function addReviewNoteToActiveScope(
  input: ReviewNoteInput,
  now = Date.now(),
): { scope: string; note: ReviewNote } | null {
  const scope = getActiveReviewScope();
  const note = addReviewNote(scope, input, now);
  return note ? { scope, note } : null;
}

export const OPEN_REVIEW_DRAWER_EVENT = "irgat:open-review-drawer";

export function requestOpenReviewDrawer(scope: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ scope: string }>(OPEN_REVIEW_DRAWER_EVENT, {
      detail: { scope },
    }),
  );
}
