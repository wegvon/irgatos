import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Placeholder rect in CSS pixels; the native side scales it by UI zoom. */
export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
};

export type BrowserEventKind =
  "loading" | "loaded" | "title" | "popup" | "blocked" | "download";

export type BrowserEvent = { id: string; kind: BrowserEventKind; url: string };

export type BrowserAction =
  "back" | "forward" | "reload" | { navigate: string };

export function boundsOf(element: Element): BrowserBounds | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.top),
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
  };
}

export function openBrowser(id: string, url: string, bounds: BrowserBounds) {
  return invoke<void>("browser_open", { id, url, bounds });
}

/** `null` hides the view without unloading its page. */
export function setBrowserBounds(id: string, bounds: BrowserBounds | null) {
  return invoke<void>("browser_set_bounds", { id, bounds });
}

export function browserAction(id: string, action: BrowserAction) {
  return invoke<void>("browser_action", { id, action });
}

export function closeBrowser(id: string) {
  return invoke<void>("browser_close", { id });
}

/** Events from this window's browser views only. */
export function listenBrowserEvents(
  id: string,
  handler: (event: BrowserEvent) => void,
): Promise<() => void> {
  return getCurrentWebviewWindow().listen<BrowserEvent>(
    "inline-browser",
    (event) => {
      if (event.payload.id === id) handler(event.payload);
    },
  );
}
