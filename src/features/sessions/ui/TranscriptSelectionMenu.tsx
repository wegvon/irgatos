import {
  FilePlusCorner,
  MessageSquarePlus,
  Share,
} from "../../../shared/ui/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { type TranscriptSelection } from "../model/transcriptSelection";
import type { ReviewKind } from "../../redline/model/reviewNotes";
import { ReviewKindButtons } from "../../redline/ui/ReviewKindButtons";
import { ReviewNotePopover } from "../../redline/ui/ReviewNotePopover";

type Props = {
  selection: TranscriptSelection | null;
  onAddToChat?: (text: string) => void;
  onAddToNotes?: (text: string) => void | Promise<void>;
  onSendToSession?: (text: string, blockId: string) => void;
  /** Names the message in a review note; without it there is no Add to Review. */
  reviewTarget?: string;
  onDismiss: () => void;
};

export function TranscriptSelectionMenu({
  selection,
  onAddToChat,
  onAddToNotes,
  onSendToSession,
  reviewTarget,
  onDismiss,
}: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  // Focus moving into the note form clears the page selection, so the form
  // keeps its own copy of what was selected.
  const [review, setReview] = useState<{
    kind: ReviewKind;
    text: string;
    rect: DOMRect;
  } | null>(null);

  // Scrolling or resizing moves the text out from under the menu, so the
  // selection it acts on is gone; drop it rather than chase the range.
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

  if (review && reviewTarget) {
    return (
      <ReviewNotePopover
        anchor={review.rect}
        kind={review.kind}
        target={{
          source: "message",
          targetPath: reviewTarget,
          selection: review.text,
        }}
        onDone={() => {
          setReview(null);
          window.getSelection()?.removeAllRanges();
          onDismiss();
        }}
      />
    );
  }

  if (!selection) return null;

  return (
    <Popover
      anchor={selection.rect}
      side="top"
      align="center"
      onDismiss={(reason) => {
        if (reason === "escape") window.getSelection()?.removeAllRanges();
        onDismiss();
      }}
      role="toolbar"
      aria-label="Selected text actions"
      className="p-1"
    >
      <div className="flex min-w-36 flex-col items-stretch gap-0.5">
        {onAddToChat ? (
          <SelectionAction
            label="Add to chat"
            onSelect={() => onAddToChat(selection.text)}
            onDismiss={onDismiss}
          >
            <MessageSquarePlus
              aria-hidden="true"
              className="size-3.5"
              strokeWidth={1.75}
            />
          </SelectionAction>
        ) : null}
        {onAddToNotes ? (
          <SelectionAction
            label="Add to notes"
            onSelect={() => onAddToNotes(selection.text)}
            onDismiss={onDismiss}
          >
            <FilePlusCorner
              aria-hidden="true"
              className="size-3.5"
              strokeWidth={1.75}
            />
          </SelectionAction>
        ) : null}
        {onSendToSession && selection.blockId ? (
          <SelectionAction
            label="Send to session…"
            onSelect={() => onSendToSession(selection.text, selection.blockId!)}
            onDismiss={onDismiss}
          >
            <Share aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          </SelectionAction>
        ) : null}
        {reviewTarget ? (
          <ReviewKindButtons
            onPick={(kind) =>
              setReview({ kind, text: selection.text, rect: selection.rect })
            }
          />
        ) : null}
      </div>
    </Popover>
  );
}

function SelectionAction({
  label,
  children,
  onSelect,
  onDismiss,
}: {
  label: string;
  children: ReactNode;
  onSelect: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending || undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={async () => {
          if (running.current) return;
          running.current = true;
          setPending(true);
          setError(null);
          try {
            const result = onSelect();
            if (result) await result;
            window.getSelection()?.removeAllRanges();
            onDismiss();
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          } finally {
            running.current = false;
            setPending(false);
          }
        }}
        className="flex h-8 w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 font-sans text-[13px] leading-none text-content outline-none ring-accent/40 hover:bg-content/5 focus-visible:ring-2"
      >
        {children}
        {label}
      </button>
      {error && (
        <span
          role="alert"
          className="max-w-xs px-2.5 py-1 text-xs text-content/70"
        >
          Could not save note. {error}
        </span>
      )}
    </>
  );
}
