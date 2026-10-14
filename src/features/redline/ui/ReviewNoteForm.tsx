import { useState } from "react";
import { MOD } from "../../../platform/tauri/platform";
import { X } from "../../../shared/ui/icons";
import {
  REVIEW_KIND_META,
  REVIEW_KINDS,
  type ReviewKind,
} from "../model/reviewNotes";

export const REVIEW_NOTE_PLACEHOLDER: Record<ReviewKind, string> = {
  change: "What should change here?",
  question: "What do you want to know?",
  comment: "What should the agent keep in mind?",
};

export function ReviewKindToggle({
  value,
  onChange,
}: {
  value: ReviewKind;
  onChange: (kind: ReviewKind) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Note kind"
      className="flex items-center gap-px rounded-md bg-content/5 p-0.5"
    >
      {REVIEW_KINDS.map((kind) => {
        const meta = REVIEW_KIND_META[kind];
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={value === kind}
            data-review-kind={kind}
            onClick={() => onChange(kind)}
            className={`flex h-5.5 items-center gap-1 rounded px-1.5 text-[11px] ${
              value === kind
                ? "bg-selection text-content"
                : "text-content/55 hover:text-content/85"
            }`}
          >
            <span aria-hidden="true">{meta.glyph}</span>
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** A note on one selection: its kind, its location, and what to do about it. */
export function ReviewNoteForm({
  location,
  initialKind = "change",
  initialNote = "",
  submitLabel = "Add to Review",
  error,
  onSubmit,
  onCancel,
}: {
  location: string;
  initialKind?: ReviewKind;
  initialNote?: string;
  submitLabel?: string;
  error?: string | null;
  onSubmit: (kind: ReviewKind, note: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ReviewKind>(initialKind);
  const [note, setNote] = useState(initialNote);
  const submit = () => {
    if (!note.trim()) return;
    onSubmit(kind, note);
  };
  return (
    <form
      data-review-note-form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
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
          title="Cancel"
          aria-label="Cancel review note"
          onClick={onCancel}
          className="grid size-5 shrink-0 place-items-center rounded text-content/45 hover:bg-content/10 hover:text-content"
        >
          <X className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      <ReviewKindToggle value={kind} onChange={setKind} />
      <textarea
        autoFocus
        rows={3}
        value={note}
        aria-label="Review note"
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={REVIEW_NOTE_PLACEHOLDER[kind]}
        className="mt-1.5 max-h-40 min-h-18 w-full resize-y rounded-lg border border-content/10 bg-background-base/70 px-2.5 py-2 text-[13px] leading-5 text-content outline-none placeholder:text-content/35 focus:border-content/20"
      />
      {error ? (
        <p role="alert" className="mt-1 px-0.5 text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[10px] text-content/35">{MOD}↩ to add</span>
        <button
          type="submit"
          disabled={!note.trim()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-content px-2.5 text-[12px] font-medium text-background-base hover:opacity-80 disabled:cursor-default disabled:opacity-40"
        >
          <span aria-hidden="true">{REVIEW_KIND_META[kind].glyph}</span>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
