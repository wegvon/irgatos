/**
 * Shared look of the Fleet session cards: one quiet surface with a hairline
 * border and a soft lift, tinted amber when the agent waits on the user.
 */
export const FLEET_CARD =
  "group relative overflow-hidden rounded-[10px] border shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors";

export const FLEET_CARD_CALM =
  "border-content/[0.08] bg-content/[0.025] hover:border-content/[0.14]";

export const FLEET_CARD_WAITING = "border-amber-400/35 bg-amber-400/[0.05]";

/** The card's main row: icon, two text lines, time. */
export const FLEET_CARD_HEAD =
  "flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left";

/** Small tile the harness or habit icon sits in. */
export const FLEET_ICON_TILE =
  "grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]";
