import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  formatEditorSelectionReference,
  type EditorCodeSelection,
} from "../model/editorSelection";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import type { ReviewKind } from "../../redline/model/reviewNotes";
import { ReviewKindButtons } from "../../redline/ui/ReviewKindButtons";
import { ReviewNotePopover } from "../../redline/ui/ReviewNotePopover";

export type EditorSelectionTarget = EditorCodeSelection & {
  anchor: DOMRect;
  /** The selected source, quoted in a review note. */
  text?: string;
};

export function EditorSelectionMenu({
  selection,
  onDismiss,
}: {
  selection: EditorSelectionTarget | null;
  onDismiss: () => void;
}) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const [review, setReview] = useState<{
    kind: ReviewKind;
    selection: EditorSelectionTarget;
  } | null>(null);

  // A rect captured from CodeMirror is in viewport coordinates. Once the
  // editor moves, dismiss the action instead of leaving it over stale text.
  useEffect(() => {
    if (!selection || review) return;
    const dismiss = () => onDismissRef.current();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection, review]);

  if (review) {
    const picked = review.selection;
    return (
      <ReviewNotePopover
        anchor={picked.anchor}
        kind={review.kind}
        target={{
          source: "file",
          targetPath: picked.path.replace(/\\/g, "/"),
          lineRange: { start: picked.startLine, end: picked.endLine },
          selection: picked.text ?? "",
        }}
        onDone={() => {
          setReview(null);
          onDismiss();
        }}
      />
    );
  }

  if (!selection) return null;

  return (
    <Popover
      anchor={selection.anchor}
      side="top"
      align="center"
      gap={6}
      onDismiss={onDismiss}
      role="toolbar"
      aria-label="Selected code actions"
      className="p-1"
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            requestAddToChat(formatEditorSelectionReference(selection), "plain");
            onDismiss();
          }}
          className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 font-sans text-[13px] leading-none text-content outline-none ring-accent/40 hover:bg-content/5 focus-visible:ring-2"
        >
          <MessageSquarePlus
            aria-hidden="true"
            className="size-3.5"
            strokeWidth={1.75}
          />
          Add to chat
        </button>
        <ReviewKindButtons
          onPick={(kind) => setReview({ kind, selection })}
        />
      </div>
    </Popover>
  );
}
