import type { AppWindow, WindowSelection } from "../model/appWindows";
import { X, Square } from "../../../shared/ui/icons";

export function AppWindowPicker({
  windows,
  active,
  onActive,
  onPick,
  loading,
  error,
}: {
  windows: AppWindow[];
  active: number;
  onActive: (index: number) => void;
  onPick: (window: AppWindow) => void;
  loading: boolean;
  error: string;
}) {
  return (
    <div
      data-app-window-picker
      className="overflow-hidden rounded-lg border border-content/10 bg-background-base/95 backdrop-blur-xl"
    >
      <p className="px-3 py-1.5 text-[11px] text-content/50">
        Open applications · share one window
      </p>
      {loading ? (
        <p role="status" className="px-3 py-2 text-xs text-content/50">
          Reading open windows…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-3 py-2 text-xs text-red-400">
          {error}. Check Computer Use in Settings → MCP.
        </p>
      ) : null}
      {!loading && !error && !windows.length ? (
        <p className="px-3 py-2 text-xs text-content/50">No matching windows</p>
      ) : null}
      <div
        role="listbox"
        aria-label="Open application windows"
        className="max-h-40 overflow-y-auto p-1"
      >
        {windows.map((window, index) => (
          <button
            key={`${window.pid}:${window.window_id}`}
            type="button"
            role="option"
            aria-selected={active === index}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActive(index)}
            onClick={() => onPick(window)}
            ref={(el) => {
              if (active === index) el?.scrollIntoView?.({ block: "nearest" });
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-content ${active === index ? "bg-selection" : ""}`}
          >
            <span className="shrink-0 font-medium">{window.app_name}</span>
            <span className="truncate text-content/50">
              {window.title || "Untitled window"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SharedAppWindow({
  selection,
  disabled,
  onControl,
  onRemove,
  onStop,
}: {
  selection: WindowSelection;
  disabled: boolean;
  onControl: (allowed: boolean) => void;
  onRemove: () => void;
  onStop?: () => void;
}) {
  return (
    <div
      data-shared-app-window
      className="flex flex-wrap items-center gap-2 border-b border-content/10 px-3 py-2 text-xs text-content"
    >
      <span className="min-w-0 flex-1 truncate" title={selection.window.title}>
        @{selection.window.app_name} ·{" "}
        {selection.window.title || "Untitled window"}
      </span>
      <span className="text-[11px] text-content/50">Screen shared</span>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={selection.allowControl}
          disabled={disabled}
          onChange={(event) => onControl(event.target.checked)}
        />
        Allow control
      </label>
      {onStop ? (
        <button
          type="button"
          aria-label="Stop application control"
          onClick={onStop}
          className="flex items-center gap-1 rounded px-2 py-1 text-red-400 hover:bg-content/5"
        >
          <Square className="size-3" />
          Stop
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Stop sharing window"
        disabled={disabled}
        onClick={onRemove}
        className="rounded p-1 hover:bg-content/5"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
