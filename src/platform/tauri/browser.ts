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
  "back" | "forward" | "reload" | "focus" | { navigate: string };

export type ChromeProfile = { id: string; name: string };

export type BrowserBookmark = { name: string; url: string };

export type BrowserHistoryEntry = {
  title: string;
  url: string;
  lastVisited: number | null;
};

/** Cookie values never cross IPC; only the import outcome and safe library data do. */
export type ChromeImportResult = {
  importedCookies: number;
  skippedCookies: number;
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryEntry[];
};

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

/** Prepares the isolated browser store without showing or navigating a page. */
export function prepareBrowser(id: string, bounds: BrowserBounds) {
  return invoke<void>("browser_prepare", { id, bounds });
}

export function listChromeProfiles() {
  return invoke<ChromeProfile[]>("browser_chrome_profiles");
}

/**
 * Reads a selected local Chrome profile after a direct user action.
 * Cookie values remain native and are written only to the browser's own store.
 */
export function importChromeProfile(id: string, profileId: string) {
  return invoke<ChromeImportResult>("browser_import_chrome_profile", {
    id,
    profileId,
  });
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

/** The page's icon as a `data:` URL, or null when it has none. */
export function browserFavicon(id: string) {
  return invoke<string | null>("browser_favicon", { id });
}

/** Events from this window's browser views only; `id` says which tab. */
export function listenBrowserEvents(
  handler: (event: BrowserEvent) => void,
): Promise<() => void> {
  return getCurrentWebviewWindow().listen<BrowserEvent>(
    "inline-browser",
    (event) => handler(event.payload),
  );
}
