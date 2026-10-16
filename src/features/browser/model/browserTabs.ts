import { displayAddress } from "./browserAddress";

/** One Browser tab; each has its own native page view under `id`. */
export type BrowserTab = {
  id: string;
  /** The page shown or to show; null for a new, empty tab. */
  url: string | null;
  title: string;
  loading: boolean;
  /** True once the tab's native view exists and shows its page. */
  started: boolean;
  /** The page's icon as a data URL, when it has one. */
  icon: string | null;
};

const STORAGE_KEY = "irgat-browser-tabs";
/** The tab the single-page Browser used, so its view keeps its page. */
export const FIRST_TAB_ID = "main";

let counter = 0;

export function newTab(url: string | null = null, id?: string): BrowserTab {
  counter += 1;
  return {
    id: id ?? `tab-${Date.now().toString(36)}-${counter}`,
    url,
    title: "",
    loading: false,
    started: false,
    icon: null,
  };
}

/** The tab's name in the strip: its title, else its address without scheme. */
export function tabLabel(tab: BrowserTab) {
  if (tab.title.trim()) return tab.title.trim();
  if (!tab.url) return "New Tab";
  return displayAddress(tab.url).replace(/^https?:\/\/(www\.)?/, "");
}

/** The neighbour `step` tabs away, wrapping around at either end. */
export function cycleTab(tabs: BrowserTab[], activeId: string, step: 1 | -1) {
  const index = tabs.findIndex((tab) => tab.id === activeId);
  if (index < 0 || tabs.length < 2) return activeId;
  return tabs[(index + step + tabs.length) % tabs.length].id;
}

/**
 * Removes a tab. The tab to its right becomes active, or the one to its left
 * when it was last; closing the only tab leaves one empty tab.
 */
export function closeTab(
  tabs: BrowserTab[],
  activeId: string,
  id: string,
): { tabs: BrowserTab[]; activeId: string } {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return { tabs, activeId };
  const rest = tabs.filter((tab) => tab.id !== id);
  if (rest.length === 0) {
    const blank = newTab();
    return { tabs: [blank], activeId: blank.id };
  }
  if (id !== activeId) return { tabs: rest, activeId };
  return { tabs: rest, activeId: rest[Math.min(index, rest.length - 1)].id };
}

type Saved = { tabs: { url: string; title: string }[]; active: number };

/**
 * Tabs from the last run. They load only when shown, so restoring many tabs
 * does not open every page at once.
 */
export function restoreTabs(): { tabs: BrowserTab[]; activeId: string } {
  const first = newTab(null, FIRST_TAB_ID);
  const fallback = { tabs: [first], activeId: first.id };
  try {
    if (typeof window === "undefined") return fallback;
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return fallback;
    const saved = JSON.parse(value) as Partial<Saved>;
    const entries = Array.isArray(saved.tabs)
      ? saved.tabs.filter(
          (entry): entry is Saved["tabs"][number] =>
            !!entry && typeof entry.url === "string" && !!entry.url,
        )
      : [];
    if (entries.length === 0) return fallback;
    const tabs = entries.map((entry, index) => ({
      ...newTab(entry.url, index === 0 ? FIRST_TAB_ID : undefined),
      title: typeof entry.title === "string" ? entry.title : "",
    }));
    const active =
      typeof saved.active === "number" && tabs[saved.active] ? saved.active : 0;
    return { tabs, activeId: tabs[active].id };
  } catch {
    return fallback;
  }
}

/** Keeps the open pages for the next run; empty tabs are not kept. */
export function saveTabs(tabs: BrowserTab[], activeId: string) {
  try {
    if (typeof window === "undefined") return;
    const kept = tabs.filter((tab) => tab.url);
    const saved: Saved = {
      tabs: kept.map((tab) => ({ url: tab.url ?? "", title: tab.title })),
      active: Math.max(
        0,
        kept.findIndex((tab) => tab.id === activeId),
      ),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Tabs still work for this run if they cannot be kept.
  }
}

type Snapshot = { tabs: readonly BrowserTab[]; activeId: string };
let snapshot: Snapshot = { tabs: [], activeId: FIRST_TAB_ID };
const listeners = new Set<() => void>();

/** The Browser's open tabs and which one is shown, for other features. */
export function currentBrowserTabs(): Snapshot {
  return snapshot;
}

/** Calls `listener` whenever the tabs or the active tab change. */
export function subscribeBrowserTabs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The Browser panel reports its tabs here. */
export function publishBrowserTabs(
  tabs: readonly BrowserTab[],
  activeId: string,
) {
  snapshot = { tabs, activeId };
  listeners.forEach((listener) => listener());
}
