import { useSyncExternalStore } from "react";

/**
 * Explicit review state for finished turns. A result stays in Ready to review
 * until the user marks it reviewed: opening the chat or time passing never
 * counts. Each mark names the turn it is for (its finish time), so a later
 * turn with new changes is outstanding again.
 */
export type ReviewMark = { turnAt: number; state: "reviewed" | "later" };

export type ReviewMarks = {
  /**
   * Turns that finished before explicit tracking started keep the old rule
   * (unread, or changed within the last two hours), so installing this does
   * not flood the list with months of history.
   */
  since: number;
  marks: Readonly<Record<string, ReviewMark>>;
};

const KEY = "irgatos.fleet.review.v1";
/** Old sessions are dropped from the file once it grows past this. */
const MAX_MARKS = 500;

const listeners = new Set<() => void>();
let current: ReviewMarks | null = null;

function read(): ReviewMarks {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ReviewMarks>) : null;
    if (parsed && typeof parsed.since === "number")
      return { since: parsed.since, marks: parsed.marks ?? {} };
  } catch {
    // Unreadable state starts tracking afresh.
  }
  const fresh = { since: Date.now(), marks: {} };
  write(fresh);
  return fresh;
}

function write(next: ReviewMarks) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept in memory for this window.
  }
}

export function reviewMarks(): ReviewMarks {
  current ??= read();
  return current;
}

function update(next: ReviewMarks) {
  current = next;
  write(next);
  for (const listener of listeners) listener();
}

export function markReview(
  sessionId: string,
  turnAt: number,
  state: ReviewMark["state"] | null,
) {
  const { since, marks } = reviewMarks();
  const rest = { ...marks };
  delete rest[sessionId];
  const entries = Object.entries(rest);
  const kept =
    entries.length >= MAX_MARKS
      ? Object.fromEntries(
          entries
            .sort(([, a], [, b]) => b.turnAt - a.turnAt)
            .slice(0, MAX_MARKS - 1),
        )
      : rest;
  update({
    since,
    marks: state ? { ...kept, [sessionId]: { turnAt, state } } : kept,
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window marked something: pick it up without a reload.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useReviewMarks(): ReviewMarks {
  return useSyncExternalStore(subscribe, reviewMarks, reviewMarks);
}

/** Test seam: forget the cached state so the next read hits storage. */
export function resetReviewMarksForTest() {
  current = null;
}
