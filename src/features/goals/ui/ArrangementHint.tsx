import { Sparkles, X } from "../../../shared/ui/icons";
import type { Arrangement } from "../model/arrangement";

/**
 * Under the first message: how Irgatos would run this, why, and one click to
 * set it up. Everything it sets stays in the composer's own controls.
 */
export function ArrangementHint({
  arrangement,
  onUse,
  onDismiss,
}: {
  arrangement: Arrangement;
  onUse: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      data-arrangement-hint={arrangement.mode}
      className="mx-1 mt-1.5 flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12px] leading-[1.45] text-content/60"
    >
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent/80" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-content/85">Suggested: {arrangement.title}.</span>{" "}
        {arrangement.benefit}
      </span>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onUse}
        className="shrink-0 rounded-md bg-content/10 px-2 py-0.5 text-[11.5px] font-medium text-content/80 hover:bg-content/20"
      >
        Use
      </button>
      <button
        type="button"
        aria-label="Hide suggestion"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onDismiss}
        className="shrink-0 rounded-md p-0.5 text-content/40 hover:bg-content/10 hover:text-content/70"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
