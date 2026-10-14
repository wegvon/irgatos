import { useMemo, useSyncExternalStore } from "react";
import { Brain } from "../../../shared/ui/icons";
import { playCue } from "../../settings/model/sounds";
import type { Block } from "../../sessions/model/session";
import { adhdFocus, adhdFocusLabel } from "../model/adhdFocus";
import {
  adhdChatOverride,
  adhdEnabledFor,
  loadAdhdState,
  subscribeAdhdState,
  toggleAdhdMode,
} from "../model/adhdMode";

export type AdhdChipSession = {
  id: string;
  blocks: readonly Block[];
  busy?: boolean;
};

export function useAdhdState() {
  return useSyncExternalStore(subscribeAdhdState, loadAdhdState, loadAdhdState);
}

function chipTitle(on: boolean, chatOnly: boolean): string {
  if (on && chatOnly)
    return "ADHD mode is on for this chat. Click to turn it off everywhere.";
  if (on)
    return "ADHD mode is on: agents lead with the next action and skip the filler. Click to turn it off.";
  if (chatOnly)
    return "ADHD mode is off for this chat. Click to turn it on everywhere.";
  return "Turn on ADHD mode: agents lead with the next action, number steps, and skip the filler.";
}

/**
 * The status bar switch for ADHD mode, with the current chat's next step or
 * task progress beside it so it stays on screen while the agent works.
 */
export function AdhdModeChip({
  session,
  variant = "footer",
}: {
  session?: AdhdChipSession;
  variant?: "footer" | "composer";
}) {
  const state = useAdhdState();
  const on = adhdEnabledFor(session?.id, state);
  const chatOnly = adhdChatOverride(session?.id, state) !== undefined;
  const busy = session?.busy === true;
  const blocks = session?.blocks;
  const focus = useMemo(
    () => (on && state.showFocus && blocks ? adhdFocus(blocks, busy) : null),
    [on, state.showFocus, blocks, busy],
  );
  if (!state.showInStatusBar) return null;
  const label = focus ? adhdFocusLabel(focus, busy) : undefined;

  return (
    <div
      className="inline-flex min-w-0 shrink items-center gap-1.5"
      data-adhd-mode={on ? "on" : "off"}
    >
      <button
        type="button"
        aria-label="ADHD mode"
        aria-pressed={on}
        title={chipTitle(on, chatOnly)}
        onClick={() => {
          toggleAdhdMode(session?.id);
          playCue("switch");
        }}
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 hover:bg-content/10 ${
          variant === "composer" ? "h-6" : "h-5"
        } ${on ? "text-accent" : "text-content/40 hover:text-content"}`}
      >
        <Brain className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span>
          {chatOnly ? (on ? "ADHD · this chat" : "ADHD paused") : "ADHD"}
        </span>
      </button>
      {label ? (
        <span
          data-testid="adhd-focus"
          title={label}
          className={`min-w-0 truncate ${
            variant === "composer" ? "max-w-56" : "max-w-[22rem]"
          } ${
            focus?.kind === "progress" && focus.done >= focus.total
              ? "text-emerald-600 dark:text-emerald-300/90"
              : "text-content/70"
          }`}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
