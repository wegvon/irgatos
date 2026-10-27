/**
 * Watching an agent use the Browser, and taking it over. Each agent action
 * on the window's Browser is announced here; while the user holds the
 * Browser, the app refuses agents' `browser.*` actions until it is handed
 * back.
 */

/** How long after its last action an agent still counts as using the page. */
export const AGENT_ACTIVE_MS = 8000;

export type BrowserAgentActing = {
  sessionId: string;
  action: string;
  at: number;
};

export type BrowserTakeover = {
  /** The user took the Browser over; agents wait. */
  held: boolean;
  acting: BrowserAgentActing | null;
};

let state: BrowserTakeover = { held: false, acting: null };
const listeners = new Set<() => void>();

function update(next: BrowserTakeover) {
  state = next;
  for (const listener of listeners) listener();
}

export function browserTakeover() {
  return state;
}

export function subscribeBrowserTakeover(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function noteBrowserAgentActing(
  sessionId: string,
  action: string,
  now = Date.now(),
) {
  if (state.held) return;
  update({ ...state, acting: { sessionId, action, at: now } });
}

/** Records that the user took the Browser over, or handed it back. */
export function setBrowserHeld(held: boolean) {
  update({ held, acting: null });
}

/** The agent using the Browser right now, if one acted recently. */
export function agentActingNow(value: BrowserTakeover, now = Date.now()) {
  const acting = value.acting;
  if (value.held || !acting || now - acting.at >= AGENT_ACTIVE_MS) return null;
  return acting;
}

const ACTION_LABELS: Record<string, string> = {
  "browser.state": "Looking at the Browser",
  "browser.tabs": "Looking at the tabs",
  "browser.read": "Reading the page",
  "browser.screenshot": "Looking at the page",
  "browser.open": "Opening a page",
  "browser.tab": "Switching tabs",
  "browser.back": "Going back",
  "browser.forward": "Going forward",
  "browser.reload": "Reloading the page",
  "browser.click": "Clicking",
  "browser.type": "Typing",
  "browser.scroll": "Scrolling",
  "browser.eval": "Running a script on the page",
};

export function browserActionLabel(action: string) {
  return ACTION_LABELS[action] ?? "Using the page";
}
