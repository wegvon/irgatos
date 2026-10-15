import { useSyncExternalStore } from "react";
import { Brain } from "../../../shared/ui/icons";
import { playCue } from "../../settings/model/sounds";
import {
  adhdChatOverride,
  adhdEnabledFor,
  loadAdhdState,
  subscribeAdhdState,
  toggleAdhdMode,
} from "../model/adhdMode";

export type AdhdChipSession = { id: string };

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

/** The status bar switch for ADHD mode. */
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
  if (!state.showInStatusBar) return null;

  return (
    <button
      type="button"
      data-adhd-mode={on ? "on" : "off"}
      aria-label="ADHD mode"
      aria-pressed={on}
      title={chipTitle(on, chatOnly)}
      onClick={() => {
        toggleAdhdMode(session?.id);
        playCue("switch");
      }}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 hover:bg-content/10 ${
        // The composer row sizes the quota chip and model name the same way.
        variant === "composer" ? "h-6.5 text-[12px]" : "h-5"
      } ${on ? "text-accent" : "text-content/40 hover:text-content"}`}
    >
      <Brain className="size-3.5" strokeWidth={1.75} aria-hidden />
      <span>
        {chatOnly ? (on ? "ADHD · this chat" : "ADHD paused") : "ADHD"}
      </span>
    </button>
  );
}
