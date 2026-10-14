import { useReviewNotes } from "../hooks/useReviewNotes";
import { countReviewNotes } from "../model/reviewNotes";
import { requestOpenReviewDrawer } from "../model/reviewStore";

/** A header count of open review notes; opens the review drawer. */
export function RedlineReviewBadge({ scope }: { scope: string }) {
  const open = countReviewNotes(useReviewNotes(scope)).open;
  if (!open) return null;
  const label = `${open} open review ${open === 1 ? "note" : "notes"}`;
  return (
    <button
      type="button"
      data-redline-badge
      data-tauri-drag-region="false"
      title={label}
      aria-label={label}
      onClick={() => requestOpenReviewDrawer(scope)}
      className="flex h-6 items-center gap-1 rounded-md bg-content/5 px-2 text-[12px] text-content/75 hover:bg-content/8 hover:text-content"
    >
      <span aria-hidden="true">⁂</span>
      <span className="tabular-nums">{open}</span>
    </button>
  );
}
