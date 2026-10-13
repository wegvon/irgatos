import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "../../../app/shell/TitleBar";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  RefreshCw,
  X,
} from "../../../shared/ui/icons";
import {
  boundsOf,
  browserAction,
  importChromeProfile,
  listChromeProfiles,
  listenBrowserEvents,
  openBrowser,
  prepareBrowser,
  setBrowserBounds,
  type BrowserAction,
  type BrowserBookmark,
  type BrowserBounds,
  type BrowserHistoryEntry,
  type ChromeProfile,
} from "../../../platform/tauri/browser";
import { displayAddress, resolveAddress } from "../model/browserAddress";

const BROWSER_ID = "main";
const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 560;
const IMPORT_STORAGE_KEY = "monocode-browser-chrome-library";
/** Native views draw above the page, so they step aside for these. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"]';

let rememberedWidth = DEFAULT_WIDTH;

function intersects(a: DOMRect, b: DOMRect) {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

function sameBounds(a: BrowserBounds | null, b: BrowserBounds | null) {
  if (!a || !b) return a === b;
  return (
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height) &&
    a.viewportWidth === b.viewportWidth
  );
}

/** Bounds for the native view, or null while hidden or covered by an overlay. */
function visibleBounds(slot: HTMLElement, panel: HTMLElement | null) {
  const bounds = boundsOf(slot);
  if (!bounds) return null;
  const rect = slot.getBoundingClientRect();
  for (const overlay of document.querySelectorAll(OVERLAY_SELECTOR)) {
    if (panel?.contains(overlay)) continue;
    if (intersects(rect, overlay.getBoundingClientRect())) return null;
  }
  return bounds;
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

type ImportedLibrary = {
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryEntry[];
};

function readImportedLibrary(): ImportedLibrary {
  try {
    if (typeof window === "undefined") return { bookmarks: [], history: [] };
    const value = localStorage.getItem(IMPORT_STORAGE_KEY);
    if (!value) return { bookmarks: [], history: [] };
    const parsed = JSON.parse(value) as Partial<ImportedLibrary>;
    return {
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { bookmarks: [], history: [] };
  }
}

function saveImportedLibrary(library: ImportedLibrary) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(IMPORT_STORAGE_KEY, JSON.stringify(library));
  } catch {
    // The import itself succeeds even if this optional browser library cannot persist.
  }
}

/**
 * A side panel with a native browser view and its address bar. The view keeps
 * its page while the panel is hidden, and has its own cookie store.
 */
export function BrowserPanel({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [address, setAddress] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [library, setLibrary] = useState<ImportedLibrary>(readImportedLibrary);
  const panelRef = useRef<HTMLElement | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const shown = useRef<BrowserBounds | null>(null);
  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () =>
      Math.max(
        MIN_WIDTH,
        Math.round(
          (typeof window === "undefined"
            ? DEFAULT_WIDTH / 0.75
            : window.innerWidth) * 0.75,
        ),
      ),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    direction: "left",
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });

  const setPanelRef = useCallback(
    (element: HTMLElement | null) => {
      panelRef.current = element;
      resize.setPaneRef(element);
    },
    [resize.setPaneRef],
  );

  const navigate = useCallback(
    async (target: string) => {
      const slot = slotRef.current;
      const bounds = slot ? boundsOf(slot) : null;
      setError(null);
      setNotice(null);
      setUrl(target);
      setAddress(displayAddress(target));
      try {
        if (!started) {
          if (!bounds) return;
          await openBrowser(BROWSER_ID, target, bounds);
          shown.current = bounds;
          setStarted(true);
        } else {
          await browserAction(BROWSER_ID, { navigate: target });
        }
      } catch (reason) {
        setLoading(false);
        setError(message(reason));
      }
    },
    [started],
  );

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenBrowserEvents(BROWSER_ID, (event) => {
      switch (event.kind) {
        case "loading":
          setLoading(true);
          break;
        case "loaded":
          setLoading(false);
          setUrl(event.url);
          if (!editing.current) setAddress(displayAddress(event.url));
          break;
        case "title":
          setTitle(event.url);
          break;
        case "popup":
          void navigateRef.current(event.url);
          break;
        case "blocked":
          setNotice("That page tried to open an address the browser blocks.");
          break;
        case "download":
          setNotice(
            "Downloads aren't supported yet. Open the page in your browser to download.",
          );
          break;
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!started) return;
    const slot = slotRef.current;
    if (!slot || !visible) {
      shown.current = null;
      void setBrowserBounds(BROWSER_ID, null).catch(() => undefined);
      return;
    }
    let frame = 0;
    const sync = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = visibleBounds(slot, panelRef.current);
        if (sameBounds(next, shown.current)) return;
        shown.current = next;
        void setBrowserBounds(BROWSER_ID, next).catch(() => undefined);
      });
    };
    sync();
    const sized = new ResizeObserver(sync);
    sized.observe(slot);
    const host = slot.closest("main");
    if (host) sized.observe(host);
    const overlays = new MutationObserver(sync);
    overlays.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", sync);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      sized.disconnect();
      overlays.disconnect();
      window.removeEventListener("resize", sync);
      shown.current = null;
      void setBrowserBounds(BROWSER_ID, null).catch(() => undefined);
    };
  }, [started, visible]);

  useEffect(() => {
    if (visible && !started) inputRef.current?.focus();
  }, [started, visible]);

  const act = (action: BrowserAction) => {
    if (!started) return;
    setError(null);
    void browserAction(BROWSER_ID, action).catch((reason: unknown) =>
      setError(message(reason)),
    );
  };

  const submit = () => {
    const result = resolveAddress(address);
    if (!result) return;
    if ("error" in result) {
      setError(result.error);
      return;
    }
    editing.current = false;
    inputRef.current?.blur();
    void navigate(result.url);
  };

  const openChromeImport = () => {
    setImportOpen(true);
    setProfilesError(null);
    setProfiles([]);
    setSelectedProfile("");
    void listChromeProfiles()
      .then((available) => {
        setProfiles(available);
        setSelectedProfile(available[0]?.id ?? "");
      })
      .catch(() => {
        setProfilesError(
          "Chrome profiles could not be read. You can still sign in inside Browser.",
        );
      });
  };

  const importSelectedProfile = async () => {
    if (!selectedProfile || importing) return;
    const slot = slotRef.current;
    const bounds = slot ? boundsOf(slot) : null;
    if (!bounds) {
      setProfilesError("Open the browser panel, then try the import again.");
      return;
    }
    setImporting(true);
    setProfilesError(null);
    try {
      await prepareBrowser(BROWSER_ID, bounds);
      const result = await importChromeProfile(BROWSER_ID, selectedProfile);
      const next = { bookmarks: result.bookmarks, history: result.history };
      setLibrary(next);
      saveImportedLibrary(next);
      const skipped =
        result.skippedCookies > 0
          ? ` ${result.skippedCookies} cookie${result.skippedCookies === 1 ? "" : "s"} could not be used.`
          : "";
      setNotice(
        `Imported ${result.importedCookies} cookie${result.importedCookies === 1 ? "" : "s"}, ${result.bookmarks.length} bookmarks, and ${result.history.length} recent history entries.${skipped}`,
      );
      setImportOpen(false);
    } catch {
      setProfilesError(
        "Chrome could not be imported. You can still sign in inside Browser.",
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <aside
      ref={setPanelRef}
      aria-label="Browser"
      aria-hidden={!visible}
      inert={!visible || undefined}
      data-browser-panel=""
      className={`relative min-h-0 max-w-full shrink-0 flex-col text-content max-[950px]:absolute max-[950px]:inset-y-0 max-[950px]:right-0 max-[950px]:z-30 max-[950px]:bg-background-base max-[950px]:shadow-2xl ${
        visible ? "flex" : "hidden"
      }`}
    >
      <div
        role="separator"
        aria-label="Resize browser panel"
        aria-orientation="vertical"
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        className={`absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
      />
      <div className="flex min-h-0 flex-1 flex-col border-l border-stroke">
        <form
          className="flex h-9 shrink-0 items-center gap-0.5 border-b border-stroke px-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <IconButton
            label="Back"
            disabled={!started}
            onClick={() => act("back")}
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="Forward"
            disabled={!started}
            onClick={() => act("forward")}
          >
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="Reload"
            disabled={!started}
            onClick={() => act("reload")}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
          </IconButton>
          <input
            ref={inputRef}
            type="text"
            inputMode="url"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Address"
            placeholder="Search or enter an address"
            value={address}
            title={title || undefined}
            onFocus={(event) => {
              editing.current = true;
              event.currentTarget.select();
            }}
            onBlur={() => {
              editing.current = false;
              if (url) setAddress(displayAddress(url));
            }}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              if (url) setAddress(displayAddress(url));
              event.currentTarget.blur();
            }}
            className="mx-1 h-6 min-w-0 flex-1 rounded-md bg-content/[0.06] px-2 text-[12px] text-content placeholder:text-content/35 focus:bg-content/[0.09] focus:outline-none"
          />
          <button
            type="button"
            onClick={openChromeImport}
            className="h-6 shrink-0 rounded px-1.5 text-[11px] text-content/55 hover:bg-content/10 hover:text-content focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            title="Import a Chrome profile"
          >
            Import
          </button>
          <IconButton
            label="Open in Default Browser"
            disabled={!url}
            onClick={() => {
              if (url) void openUrl(url).catch(() => undefined);
            }}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Close Browser" onClick={onClose}>
            <X className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </form>
        {importOpen ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="chrome-import-title"
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
          >
            <div className="w-full max-w-md rounded-lg border border-stroke bg-background-base p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="chrome-import-title" className="text-sm font-medium">
                    Import from Chrome
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-content/60">
                    Reads cookies and active sign-ins, bookmarks, and recent
                    history from the selected Chrome profile on this Mac.
                  </p>
                </div>
                <IconButton
                  label="Close Chrome import"
                  disabled={importing}
                  onClick={() => setImportOpen(false)}
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </IconButton>
              </div>
              <p className="mt-3 rounded bg-content/[0.05] px-3 py-2 text-[11px] leading-4 text-content/65">
                Cookies and sessions go only to Browser&apos;s isolated data
                store. Bookmark and history lists are saved locally in this
                browser panel. Chrome is not changed.
              </p>
              {profilesError ? (
                <p role="alert" className="mt-3 text-xs text-red-400">
                  {profilesError}
                </p>
              ) : profiles.length === 0 ? (
                <p className="mt-3 text-xs text-content/55">
                  Looking for Chrome profiles…
                </p>
              ) : (
                <label className="mt-3 block text-xs text-content/70">
                  Chrome profile
                  <select
                    aria-label="Chrome profile"
                    value={selectedProfile}
                    disabled={importing}
                    onChange={(event) => setSelectedProfile(event.target.value)}
                    className="mt-1 block h-8 w-full rounded border border-stroke bg-background-raised px-2 text-sm text-content focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {library.bookmarks.length || library.history.length ? (
                <details className="mt-3 text-[11px] text-content/60">
                  <summary className="cursor-pointer hover:text-content">
                    Imported library: {library.bookmarks.length} bookmarks,{" "}
                    {library.history.length} recent entries
                  </summary>
                  <ul className="mt-2 max-h-24 space-y-1 overflow-auto">
                    {[...library.bookmarks, ...library.history]
                      .slice(0, 10)
                      .map((entry) => (
                        <li
                          key={entry.url}
                          className="truncate"
                          title={entry.url}
                        >
                          {"name" in entry ? entry.name : entry.title}
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => setImportOpen(false)}
                  className="h-8 rounded px-3 text-xs text-content/65 hover:bg-content/10 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedProfile || importing}
                  onClick={() => void importSelectedProfile()}
                  className="h-8 rounded bg-accent px-3 text-xs font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? "Importing…" : "Import profile"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {error || notice ? (
          <div
            role={error ? "alert" : "status"}
            className={`shrink-0 border-b border-stroke px-3 py-1.5 text-[11px] ${
              error ? "text-red-400" : "text-content/60"
            }`}
          >
            {error ?? notice}
          </div>
        ) : null}
        <div ref={slotRef} className="relative min-h-0 flex-1 bg-white">
          {started ? null : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background-base px-8 text-center">
              <Globe className="size-6 text-content/30" strokeWidth={1.5} />
              <p className="text-[13px] text-content/75">
                Browse without leaving MonoCode
              </p>
              <p className="max-w-80 text-[12px] leading-5 text-content/45">
                Browser keeps site storage and normal sign-ins in its own
                persistent store, so they stay available after restarting
                MonoCode. Pages here cannot access your projects or agents.
              </p>
              <button
                type="button"
                onClick={openChromeImport}
                className="rounded bg-content/[0.08] px-3 py-1.5 text-xs text-content/75 hover:bg-content/[0.12]"
              >
                Import from Chrome
              </button>
              <p className="max-w-80 text-[11px] leading-4 text-content/40">
                Some sites&apos; passkey sign-ins are unavailable in this
                embedded browser. Use Open in Default Browser if a site asks
                for a passkey.
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
