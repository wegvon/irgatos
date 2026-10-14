import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Trash2,
} from "../../../shared/ui/icons";
import { useReviewNotes } from "../hooks/useReviewNotes";
import {
  countReviewNotes,
  formatLineRange,
  formatReviewBatch,
  orderReviewNotes,
  REVIEW_KIND_META,
  type ReviewNote,
} from "../model/reviewNotes";
import {
  clearResolvedReviewNotes,
  markReviewNotesSent,
  OPEN_REVIEW_DRAWER_EVENT,
  removeReviewNote,
  updateReviewNote,
} from "../model/reviewStore";
import { ReviewNoteForm } from "./ReviewNoteForm";

export function submitReviewLabel(open: number): string {
  return `Submit Review (${open} ${open === 1 ? "note" : "notes"})`;
}

type Props = {
  scope: string;
  /** Sends the batch as this chat's next turn; false keeps the notes open. */
  onSend: (text: string) => boolean | void | Promise<boolean | void>;
  /** Puts the batch in this chat's draft instead, to edit before sending. */
  onInsert: (text: string) => void;
  disabled?: boolean;
};

/**
 * The review in progress for one project or Irgat: a pill above the composer
 * while it has notes, opening into a drawer to edit them or submit them all
 * as one turn.
 */
export function RedlineReviewTray({ scope, onSend, onInsert, disabled }: Props) {
  const notes = useReviewNotes(scope);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const counts = countReviewNotes(notes);
  const ordered = useMemo(() => orderReviewNotes(notes), [notes]);
  const open = useMemo(
    () => ordered.filter((note) => note.status === "open"),
    [ordered],
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string }>).detail;
      if (detail?.scope === scope) setExpanded(true);
    };
    window.addEventListener(OPEN_REVIEW_DRAWER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_REVIEW_DRAWER_EVENT, onOpen);
  }, [scope]);

  if (!notes.length) return null;

  const submit = async () => {
    if (sendingRef.current || !open.length || disabled) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const taken = await onSend(formatReviewBatch(open));
      if (taken === false) {
        setError("The chat did not take the review. Your notes are still open.");
        return;
      }
      markReviewNotesSent(
        scope,
        open.map((note) => note.id),
      );
      setExpanded(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const insert = () => {
    if (!open.length) return;
    onInsert(formatReviewBatch(open));
    markReviewNotesSent(
      scope,
      open.map((note) => note.id),
    );
    setExpanded(false);
  };

  const summary = [
    counts.open ? `${counts.open} open` : null,
    counts.sent ? `${counts.sent} sent` : null,
    counts.resolved ? `${counts.resolved} resolved` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      data-redline-review
      aria-label="Review notes"
      className="mx-auto mb-1.5 w-full max-w-4xl rounded-lg border border-content/10 bg-background-base/80 font-sans backdrop-blur-sm"
    >
      <div className="flex h-8 items-center gap-2 px-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-[12px] text-content/75 hover:text-content"
        >
          <span aria-hidden="true" className="text-content">
            ⁂
          </span>
          <span className="font-medium text-content">Review</span>
          <span className="truncate text-content/55">{summary}</span>
          {expanded ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronUp className="size-3 shrink-0" />
          )}
        </button>
        <button
          type="button"
          disabled={!open.length || sending || disabled}
          onClick={() => void submit()}
          title="Send every open note as one turn"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-content px-2 text-[11px] font-medium text-background-base hover:opacity-80 disabled:cursor-default disabled:opacity-40"
        >
          <ArrowUp className="size-3" strokeWidth={2} />
          {sending ? "Sending…" : submitReviewLabel(open.length)}
        </button>
      </div>
      {error ? (
        <p role="alert" className="px-3 pb-1.5 text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
      {expanded ? (
        <div className="border-t border-stroke">
          <ol className="max-h-72 overflow-y-auto py-1" aria-label="Notes">
            {ordered.map((note) => (
              <li key={note.id} data-review-note={note.id} data-status={note.status}>
                {editing === note.id ? (
                  <div className="px-2 py-1.5">
                    <ReviewNoteForm
                      location={noteLocation(note)}
                      initialKind={note.kind}
                      initialNote={note.note}
                      submitLabel="Save"
                      onCancel={() => setEditing(null)}
                      onSubmit={(kind, text) => {
                        updateReviewNote(scope, note.id, { kind, note: text });
                        setEditing(null);
                      }}
                    />
                  </div>
                ) : (
                  <ReviewNoteRow
                    note={note}
                    onEdit={() => setEditing(note.id)}
                    onDelete={() => removeReviewNote(scope, note.id)}
                    onToggleResolved={() =>
                      updateReviewNote(scope, note.id, {
                        status: note.status === "resolved" ? "open" : "resolved",
                      })
                    }
                    onReopen={() =>
                      updateReviewNote(scope, note.id, { status: "open" })
                    }
                  />
                )}
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-1.5 border-t border-stroke px-2 py-1.5">
            {counts.resolved ? (
              <button
                type="button"
                onClick={() => clearResolvedReviewNotes(scope)}
                className="h-6 rounded-md px-2 text-[11px] text-content/55 hover:bg-content/8 hover:text-content"
              >
                Clear resolved
              </button>
            ) : null}
            <span className="flex-1" />
            <button
              type="button"
              disabled={!open.length || disabled}
              onClick={insert}
              title="Put the review in this chat's draft to edit before sending"
              className="inline-flex h-6 items-center gap-1 rounded-md border border-content/10 px-2 text-[11px] text-content/70 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-40"
            >
              <MessageSquarePlus className="size-3" />
              Insert into chat
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function noteLocation(note: ReviewNote): string {
  const lines = formatLineRange(note.lineRange);
  return lines ? `${note.targetPath} · ${lines}` : note.targetPath;
}

const STATUS_LABEL: Record<ReviewNote["status"], string> = {
  open: "",
  sent: "Sent",
  resolved: "Resolved",
};

function ReviewNoteRow({
  note,
  onEdit,
  onDelete,
  onToggleResolved,
  onReopen,
}: {
  note: ReviewNote;
  onEdit: () => void;
  onDelete: () => void;
  onToggleResolved: () => void;
  onReopen: () => void;
}) {
  const meta = REVIEW_KIND_META[note.kind];
  const done = note.status === "resolved";
  const excerpt = note.selection.split("\n").find((line) => line.trim());
  return (
    <div
      className={`group flex items-start gap-2 px-3 py-1.5 hover:bg-content/4 ${done ? "opacity-55" : ""}`}
    >
      <span
        aria-label={meta.label}
        title={meta.label}
        className="mt-0.5 w-3.5 shrink-0 text-center text-[13px] text-content"
      >
        {meta.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="min-w-0 truncate font-mono text-[11px] text-content/55"
            title={noteLocation(note)}
          >
            {noteLocation(note)}
          </span>
          {STATUS_LABEL[note.status] ? (
            <span className="shrink-0 rounded bg-content/8 px-1 text-[10px] leading-4 text-content/60">
              {STATUS_LABEL[note.status]}
            </span>
          ) : null}
        </div>
        {excerpt ? (
          <p className="truncate border-l-2 border-content/15 pl-1.5 text-[11px] text-content/50">
            {excerpt.trim()}
          </p>
        ) : null}
        <p
          className={`whitespace-pre-wrap break-words text-[12px] leading-4.5 text-content ${done ? "line-through" : ""}`}
        >
          {note.note}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100">
        {note.status === "sent" ? (
          <RowAction label="Reopen" onClick={onReopen}>
            <RotateCcw className="size-3" />
          </RowAction>
        ) : null}
        {done ? null : (
          <RowAction label="Edit note" onClick={onEdit}>
            <Pencil className="size-3" />
          </RowAction>
        )}
        <RowAction
          label={done ? "Mark unresolved" : "Mark resolved"}
          onClick={onToggleResolved}
        >
          {done ? <RotateCcw className="size-3" /> : <Check className="size-3" />}
        </RowAction>
        <RowAction label="Delete note" onClick={onDelete}>
          <Trash2 className="size-3" />
        </RowAction>
      </div>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-5.5 place-items-center rounded text-content/55 hover:bg-content/10 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}
