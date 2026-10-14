import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { CircleAlert, Globe, Loader, RotateCcw } from "../../../shared/ui/icons";
import {
  openInAppBrowser,
  portUrl,
  rememberSetupEvent,
  runWorktreeSetup,
  setupEventFor,
  setupSummary,
  subscribeSetupEvents,
  worktreePort,
  worktreeSetupStatus,
} from "../model/worktreeEnv";

/**
 * The linked worktree's `PORT`, opening its dev server in the browser panel,
 * plus the setup command's progress while it runs or after it failed.
 */
export function WorktreePortBadge({ cwd }: { cwd: string }) {
  const [port, setPort] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const anchor = useRef<HTMLButtonElement>(null);
  const setup = useSyncExternalStore(subscribeSetupEvents, () =>
    setupEventFor(cwd),
  );

  useEffect(() => {
    let current = true;
    setPort(null);
    void worktreePort(cwd)
      .then((value) => {
        if (current) setPort(value);
      })
      .catch(() => undefined);
    void worktreeSetupStatus(cwd)
      .then((event) => {
        if (event) rememberSetupEvent(event);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [cwd]);

  const effectivePort = port ?? setup?.port ?? null;
  const showSetup = setup && setup.status !== "succeeded";
  if (effectivePort == null && !showSetup) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {effectivePort != null ? (
        <button
          type="button"
          data-worktree-port={effectivePort}
          title={`PORT=${effectivePort} in this worktree. Click to open ${portUrl(effectivePort)} in the browser panel, ⌘/Ctrl-click for your browser.`}
          aria-label={`Open port ${effectivePort}`}
          onClick={(event) => {
            const url = portUrl(effectivePort);
            if (event.metaKey || event.ctrlKey) {
              void openUrl(url).catch(() => undefined);
            } else {
              openInAppBrowser(url);
            }
          }}
          className="flex h-5 items-center gap-1 rounded-md bg-content/6 px-1.5 font-mono text-[11px] text-content/60 tabular-nums hover:bg-content/12 hover:text-content"
        >
          <Globe className="size-3" />:{effectivePort}
        </button>
      ) : null}
      {showSetup ? (
        <button
          ref={anchor}
          type="button"
          title={setupSummary(setup)}
          aria-label={setupSummary(setup)}
          aria-expanded={details}
          onClick={() => setDetails((open) => !open)}
          className={`flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] ${
            setup.status === "failed"
              ? "bg-red-500/10 text-red-400 hover:bg-red-500/15"
              : "bg-content/6 text-content/55 hover:bg-content/12"
          }`}
        >
          {setup.status === "running" ? (
            <Loader className="size-3 animate-spin" />
          ) : (
            <CircleAlert className="size-3" />
          )}
          {setup.status === "running" ? "Setting up" : "Setup failed"}
        </button>
      ) : null}
      {details && showSetup ? (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={380}
          maxHeight={320}
          onDismiss={() => setDetails(false)}
          role="dialog"
          aria-label="Worktree setup"
          className="flex flex-col gap-2 p-3 text-[12px]"
        >
          <p className="font-medium">{setupSummary(setup)}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-content/6 p-2 font-mono text-[11px] text-content/70">
            {setup.output ||
              (setup.status === "running" ? "Waiting for output…" : "No output")}
          </pre>
          {setup.logPath ? (
            <p className="break-all text-[11px] text-content/40">
              Full log: {setup.logPath}
            </p>
          ) : null}
          {retryError ? (
            <p role="alert" className="text-[11px] text-red-400">
              {retryError}
            </p>
          ) : null}
          {setup.status === "failed" ? (
            <button
              type="button"
              onClick={() => {
                setRetryError(undefined);
                void runWorktreeSetup(cwd).catch((error) =>
                  setRetryError(String(error)),
                );
              }}
              className="flex h-7 w-fit items-center gap-1.5 rounded-md bg-content/8 px-2 text-[11px] hover:bg-content/12"
            >
              <RotateCcw className="size-3" />
              Run setup again
            </button>
          ) : null}
        </Popover>
      ) : null}
    </span>
  );
}
