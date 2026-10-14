import { useState } from "react";
import { MessageSquarePlus, X } from "../../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import {
  diffCommentLocation,
  diffCommentReviewTarget,
  formatDiffComment,
} from "../model/diffComment";
import { MOD } from "../../../platform/tauri/platform";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import {
  REVIEW_KIND_META,
  REVIEW_KINDS,
  type ReviewKind,
} from "../../redline/model/reviewNotes";
import { saveReviewNote } from "../../redline/ui/ReviewNotePopover";
import type { UnifiedLine } from "../model/unifiedDiff";

export type DiffCommentComposerTarget = {
  line: UnifiedLine;
  anchor: PopoverAnchor;
};

export function DiffCommentComposer({
  path,
  target,
  onDismiss,
}: {
  path: string;
  target: DiffCommentComposerTarget;
  onDismiss: () => void;
}) {
  const [comment, setComment] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const location = diffCommentLocation({ path, line: target.line });
  const addToChat = () => {
    const text = formatDiffComment({ path, line: target.line }, comment);
    if (!text) return;
    requestAddToChat(text, "plain");
    onDismiss();
  };
  const addToReview = (kind: ReviewKind) => {
    if (!comment.trim()) return;
    const failure = saveReviewNote(
      diffCommentReviewTarget({ path, line: target.line }),
      kind,
      comment,
    );
    if (failure) setReviewError(failure);
    else onDismiss();
  };

  return (
    <Popover
      anchor={target.anchor}
      side="right"
      align="start"
      gap={6}
      width={320}
      onDismiss={onDismiss}
      role="dialog"
      aria-label={`Comment on ${location}`}
      className="p-2"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          addToChat();
        }}
      >
        <div className="mb-1.5 flex items-center gap-2 px-0.5">
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-content/55"
            title={location}
          >
            {location}
          </span>
          <button
            type="button"
            title="Cancel comment"
            aria-label="Cancel comment"
            onClick={onDismiss}
            className="grid size-5 shrink-0 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
        <textarea
          autoFocus
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              comment.trim()
            ) {
              event.preventDefault();
              addToChat();
            }
          }}
          placeholder="Leave a comment…"
          className="max-h-40 min-h-18 w-full resize-y rounded-lg border border-content/10 bg-background-base/70 px-2.5 py-2 text-[13px] leading-5 text-content outline-none placeholder:text-content/35 focus:border-content/20"
        />
        {reviewError ? (
          <p role="alert" className="mt-1 px-0.5 text-[11px] text-red-400">
            {reviewError}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div
            role="group"
            aria-label="Add to Review"
            className="flex items-center gap-0.5"
          >
            <span className="mr-0.5 text-[10px] text-content/40">Review</span>
            {REVIEW_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                data-review-kind={kind}
                disabled={!comment.trim()}
                onClick={() => addToReview(kind)}
                title={`Add to Review: ${REVIEW_KIND_META[kind].label}`}
                aria-label={`Add to Review: ${REVIEW_KIND_META[kind].label}`}
                className="grid size-6 place-items-center rounded-md border border-content/10 text-[12px] text-content hover:bg-content/10 disabled:cursor-default disabled:opacity-40"
              >
                <span aria-hidden="true">{REVIEW_KIND_META[kind].glyph}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-content/35">{MOD}↩</span>
            <button
              type="submit"
              disabled={!comment.trim()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content px-2.5 text-[12px] font-medium text-background-base hover:opacity-80 disabled:cursor-default disabled:opacity-40"
            >
              <MessageSquarePlus className="size-3.5" strokeWidth={1.75} />
              Add to chat
            </button>
          </div>
        </div>
      </form>
    </Popover>
  );
}
