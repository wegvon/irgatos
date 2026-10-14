import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { MessageSquarePlus } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { locateSelection, type ReviewKind, type ReviewSource } from "../model/reviewNotes";
import { ReviewKindButtons } from "./ReviewKindButtons";
import { ReviewNotePopover } from "./ReviewNotePopover";

type DomSelection = { text: string; rect: DOMRect };

/** Text selected inside `container`, with where it sits on screen. */
export function readContainedSelection(
  container: HTMLElement,
  selection: Selection | null,
): DomSelection | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
    return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString().replace(/\r\n?/g, "\n").trim();
  if (!text) return null;
  const rect = range.getBoundingClientRect();
  return { text, rect };
}

/**
 * Add to chat and Add to Review for text selected in a rendered document.
 * `source` is the document's text, used to find which lines were selected.
 */
export function TextSelectionReviewMenu({
  containerRef,
  source,
  reviewSource,
  targetPath,
  onAddToChat,
}: {
  containerRef: RefObject<HTMLElement | null>;
  source: string;
  reviewSource: ReviewSource;
  targetPath: string;
  onAddToChat?: (text: string) => void;
}) {
  const [selection, setSelection] = useState<DomSelection | null>(null);
  const [kind, setKind] = useState<ReviewKind | null>(null);
  const kindRef = useRef(kind);
  kindRef.current = kind;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMouseUp = () => {
      if (kindRef.current) return;
      window.setTimeout(() => {
        setSelection(readContainedSelection(container, window.getSelection()));
      }, 0);
    };
    container.addEventListener("mouseup", onMouseUp);
    return () => container.removeEventListener("mouseup", onMouseUp);
  }, [containerRef]);

  useEffect(() => {
    if (!selection || kind) return;
    const dismiss = () => setSelection(null);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection, kind]);

  if (!selection) return null;
  const close = () => {
    setKind(null);
    setSelection(null);
  };

  if (kind) {
    return (
      <ReviewNotePopover
        anchor={selection.rect}
        kind={kind}
        target={{
          source: reviewSource,
          targetPath,
          lineRange: locateSelection(source, selection.text),
          selection: selection.text,
        }}
        onDone={() => {
          window.getSelection()?.removeAllRanges();
          close();
        }}
      />
    );
  }

  return (
    <Popover
      anchor={selection.rect}
      side="top"
      align="center"
      gap={6}
      onDismiss={close}
      role="toolbar"
      aria-label="Selected text actions"
      className="p-1"
    >
      <div className="flex items-center gap-0.5">
        {onAddToChat ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onAddToChat(selection.text);
              window.getSelection()?.removeAllRanges();
              close();
            }}
            className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 font-sans text-[13px] leading-none text-content outline-none ring-accent/40 hover:bg-content/5 focus-visible:ring-2"
          >
            <MessageSquarePlus aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            Add to chat
          </button>
        ) : null}
        <ReviewKindButtons onPick={setKind} />
      </div>
    </Popover>
  );
}

/** Rendered text that offers Add to chat and Add to Review on selection. */
export function ReviewableSelection({
  children,
  ...menu
}: {
  children: ReactNode;
  source: string;
  reviewSource: ReviewSource;
  targetPath: string;
  onAddToChat?: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="contents" data-reviewable-selection>
      {children}
      <TextSelectionReviewMenu containerRef={ref} {...menu} />
    </div>
  );
}

/** A selection quoted for the chat, under the name of where it came from. */
export function selectionChatText(targetPath: string, text: string): string {
  const quote = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `From ${targetPath}:\n\n${quote}`;
}
