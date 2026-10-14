import { useState } from "react";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import {
  formatLineRange,
  type ReviewKind,
  type ReviewLineRange,
  type ReviewSource,
} from "../model/reviewNotes";
import { addReviewNoteToActiveScope } from "../model/reviewStore";
import { ReviewNoteForm } from "./ReviewNoteForm";

export type ReviewDraftTarget = {
  source: ReviewSource;
  targetPath: string;
  lineRange?: ReviewLineRange;
  selection: string;
};

export function reviewTargetLocation(target: {
  targetPath: string;
  lineRange?: ReviewLineRange;
}): string {
  const lines = formatLineRange(target.lineRange);
  return lines ? `${target.targetPath} · ${lines}` : target.targetPath;
}

/** Saves one note into the review in front; returns an error message on failure. */
export function saveReviewNote(
  target: ReviewDraftTarget,
  kind: ReviewKind,
  note: string,
): string | null {
  try {
    const saved = addReviewNoteToActiveScope({ ...target, kind, note });
    return saved ? null : "Write a note before adding it to the review.";
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/** The note form on its own, anchored where the selection was. */
export function ReviewNotePopover({
  anchor,
  target,
  kind,
  onDone,
}: {
  anchor: PopoverAnchor;
  target: ReviewDraftTarget;
  kind: ReviewKind;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const location = reviewTargetLocation(target);
  return (
    <Popover
      anchor={anchor}
      side="top"
      align="center"
      gap={6}
      width={320}
      onDismiss={onDone}
      role="dialog"
      aria-label={`Review note on ${location}`}
      className="p-2"
    >
      <ReviewNoteForm
        location={location}
        initialKind={kind}
        error={error}
        onCancel={onDone}
        onSubmit={(nextKind, note) => {
          const failure = saveReviewNote(target, nextKind, note);
          if (failure) setError(failure);
          else onDone();
        }}
      />
    </Popover>
  );
}
