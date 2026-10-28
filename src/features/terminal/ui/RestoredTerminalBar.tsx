import { useCallback, useEffect, useState } from "react";
import { writePty } from "../../../platform/tauri/pty";
import { Loader, Play, X } from "../../../shared/ui/icons";
import {
  devEnvironmentStatus,
  type DevEnvironmentStatus,
} from "../../source-control/model/worktreeEnv";

/** How often the bar re-checks while it is on screen. */
const POLL_MS = 5_000;

export function devStatusText(status: DevEnvironmentStatus): string {
  if (!status.running) return "Development environment is not running";
  return status.port
    ? `Development environment is running on port ${status.port}`
    : "Development environment is running";
}

/**
 * Over a terminal that came back after a restart. The tab is back, its
 * processes are not: say so, and, when the project names a development
 * command, show whether it runs and offer to start it. Nothing is replayed.
 */
export function RestoredTerminalBar({
  ptyId,
  cwd,
  onDismiss,
  check = devEnvironmentStatus,
  write = writePty,
}: {
  ptyId: string;
  cwd: string;
  onDismiss: () => void;
  check?: (cwd: string) => Promise<DevEnvironmentStatus>;
  write?: (id: string, data: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<DevEnvironmentStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      check(cwd)
        .then(setStatus)
        .catch(() => setStatus(null)),
    [check, cwd],
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const start = async () => {
    const command = status?.command?.trim();
    if (!command) return;
    setStarting(true);
    setError(null);
    try {
      // Typed into this shell, where the user sees it run and can stop it.
      await write(ptyId, `${command}\r`);
      setTimeout(() => {
        void refresh().finally(() => setStarting(false));
      }, 2_000);
    } catch (reason) {
      setStarting(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const command = status?.command?.trim();
  return (
    <div
      data-restored-terminal
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-stroke bg-content/[0.03] px-3 py-1.5 font-sans text-[11.5px] text-content/60"
    >
      <span>
        New shell session. Commands from before the restart were not re-run.
      </span>
      {command ? (
        <span
          data-dev-environment={status?.running ? "running" : "stopped"}
          className="flex min-w-0 items-center gap-1.5"
          title={command}
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              status?.running ? "bg-emerald-500" : "bg-content/30"
            }`}
          />
          <span className="truncate">{devStatusText(status!)}</span>
        </span>
      ) : null}
      {error ? <span className="text-red-400">{error}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {command && !status?.running ? (
          <button
            type="button"
            data-start-dev-environment
            disabled={starting}
            onClick={() => void start()}
            title={`Runs ${command} in this terminal`}
            className="flex h-6 items-center gap-1 rounded-md border border-content/15 px-2 text-content/80 transition-colors hover:bg-content/7 hover:text-content disabled:opacity-50"
          >
            {starting ? (
              <Loader className="size-3 animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            Start development environment
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Hide"
          onClick={onDismiss}
          className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/7 hover:text-content"
        >
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  );
}
