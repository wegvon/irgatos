import { useSyncExternalStore } from "react";
import type { ReviewNote } from "../model/reviewNotes";
import {
  getActiveReviewScope,
  listReviewNotes,
  subscribeActiveReviewScope,
  subscribeReviewNotes,
} from "../model/reviewStore";

const NONE: ReviewNote[] = [];

export function useReviewNotes(scope: string | null | undefined): ReviewNote[] {
  return useSyncExternalStore(
    subscribeReviewNotes,
    () => (scope ? listReviewNotes(scope) : NONE),
    () => NONE,
  );
}

export function useActiveReviewScope(): string {
  return useSyncExternalStore(
    subscribeActiveReviewScope,
    getActiveReviewScope,
    getActiveReviewScope,
  );
}
