import { useState } from "react";
import { ChevronRight } from "../../../shared/ui/icons";
import type { ApprovalBrief, Reversibility } from "../model/approvalBrief";

const UNDO_TONE: Record<Reversibility, string> = {
  none: "bg-emerald-400",
  yes: "bg-emerald-400",
  partly: "bg-amber-400",
  unknown: "bg-amber-400",
  no: "bg-rose-400",
};

/**
 * What an approval will do, why, what it touches and whether it can be taken
 * back, with the exact command folded away. `what` and `why` drop out where
 * the transcript already shows the call and the agent's words above it.
 */
export function ApprovalExplainer({
  brief,
  showWhat = true,
  showWhy = true,
  showTechnical = true,
  className = "",
}: {
  brief: ApprovalBrief;
  showWhat?: boolean;
  showWhy?: boolean;
  showTechnical?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const technical = showTechnical ? brief.technical : undefined;
  return (
    <div
      data-approval-brief={brief.risk}
      className={`flex min-w-0 flex-col gap-1 text-[12px] leading-[1.45] ${className}`}
    >
      {showWhat ? (
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-content/40">
            Permission
          </span>
          <span className="min-w-0 truncate font-medium text-content/90" title={brief.what}>
            {brief.what}
          </span>
        </span>
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-content/65">
        {showWhy && brief.why ? (
          <>
            <dt className="text-content/40">Why</dt>
            <dd className="min-w-0 italic">{brief.why}</dd>
          </>
        ) : null}
        <dt className="text-content/40">Effect</dt>
        <dd className="min-w-0">{brief.impact}</dd>
        <dt className="text-content/40">Undo</dt>
        <dd className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${UNDO_TONE[brief.reversible]}`} />
          <span className={brief.reversible === "no" ? "text-rose-400/90" : ""}>{brief.undo}</span>
        </dd>
      </dl>
      {technical ? (
        <div className="min-w-0">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1 text-[11px] text-content/45 hover:text-content/70"
          >
            <ChevronRight
              className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
              strokeWidth={2}
            />
            Technical details
          </button>
          {open ? (
            <code className="mt-1 block max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md bg-content/5 px-2 py-1 font-mono text-[11px] leading-relaxed text-content/70 select-text">
              {technical}
            </code>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
