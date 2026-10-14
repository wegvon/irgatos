import {
  REVIEW_KIND_META,
  REVIEW_KINDS,
  type ReviewKind,
} from "../model/reviewNotes";

/** "Add to Review" as one compact group: ✎ change, ◇ question, ◆ comment. */
export function ReviewKindButtons({
  onPick,
  label = "Add to Review",
}: {
  onPick: (kind: ReviewKind) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-review-kinds
      className="flex h-7 items-center gap-0.5 rounded-lg pl-2 pr-0.5 font-sans text-[13px] leading-none text-content/70"
    >
      <span className="mr-1 whitespace-nowrap">{label}</span>
      {REVIEW_KINDS.map((kind) => {
        const meta = REVIEW_KIND_META[kind];
        return (
          <button
            key={kind}
            type="button"
            data-review-kind={kind}
            title={`${label}: ${meta.label}`}
            aria-label={`${label}: ${meta.label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(kind)}
            className="grid size-6 place-items-center rounded-md text-[13px] text-content outline-none ring-accent/40 hover:bg-content/8 focus-visible:ring-2"
          >
            <span aria-hidden="true">{meta.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}
