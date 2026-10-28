import type { RecoveryBrief } from "../model/recovery";

const ROWS: { key: keyof Omit<RecoveryBrief, "next">; label: string }[] = [
  { key: "done", label: "Done" },
  { key: "kept", label: "Kept" },
  { key: "left", label: "Left" },
];

/**
 * What a stopped chat got done, what is safe and what is left, under the
 * notice that says it stopped. `tone` matches the notice it sits under.
 */
export function RecoveryDetails({
  brief,
  tone,
  framed = true,
}: {
  brief: RecoveryBrief;
  tone: "rose" | "amber";
  /** Sits under a composer notice and continues its frame. */
  framed?: boolean;
}) {
  const frame =
    tone === "rose"
      ? "border-rose-400/25 bg-rose-400/[0.06]"
      : "border-amber-400/25 bg-amber-400/[0.06]";
  return (
    <div
      data-recovery-details
      className={`${framed ? `relative z-0 border border-y-0 ${frame} px-2.5 pb-2 pt-1` : ""} text-[11.5px] leading-[1.45] text-content/60`}
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5">
        {ROWS.map(({ key, label }) =>
          brief[key].length ? (
            <div key={key} className="contents">
              <dt className="text-content/40">{label}</dt>
              <dd className="min-w-0 truncate" title={brief[key].join("\n")}>
                {brief[key].join(" · ")}
              </dd>
            </div>
          ) : null,
        )}
        <dt className="text-content/40">Next</dt>
        <dd className="min-w-0 text-content/80">{brief.next}</dd>
      </dl>
    </div>
  );
}
