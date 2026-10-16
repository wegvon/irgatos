/**
 * Lets the app's tab shortcuts (⌘T, ⌘W, ⌘⇧[ ⌘⇧], ⌘[ ⌘]) act on Browser
 * tabs while Browser has focus, instead of on the workspace's panes.
 */
export type BrowserTabCommand =
  "new" | "close" | "next" | "prev" | "back" | "forward";

const COMMANDS = new Set<string>([
  "new",
  "close",
  "next",
  "prev",
  "back",
  "forward",
]);

type Handler = (command: BrowserTabCommand) => boolean;

let handler: Handler | null = null;

/** Registers the Browser panel; returns the unregister function. */
export function setBrowserTabCommandHandler(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** True when Browser took the command; the caller then does nothing. */
export function runBrowserTabCommand(name: string): boolean {
  if (!handler || !COMMANDS.has(name)) return false;
  return handler(name as BrowserTabCommand);
}

/**
 * Browser has focus when focus is inside its panel, or when the window is
 * active but its own document is not: the native page view then holds focus.
 * A focused iframe (an artifact) also takes the document's focus, so it is
 * excluded.
 */
export function browserHasFocus(panel: HTMLElement | null) {
  if (!panel) return false;
  const active = document.activeElement;
  if (active && panel.contains(active)) return true;
  return !document.hasFocus() && !(active instanceof HTMLIFrameElement);
}
