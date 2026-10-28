import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { pathKey } from "../../../shared/lib/paths";

/** Per-project worktree settings, mirrored from `worktree_lifecycle.rs`. */
export type WorktreeConfig = {
  portRange?: [number, number];
  setup?: string;
  /** Starts the development environment; run only from "Start development environment". */
  dev?: string;
};

export type WorktreeSettings = {
  /** `.irgatos/worktree.json`, committed with the project. */
  shared: WorktreeConfig;
  sharedPath: string | null;
  sharedError: string | null;
  /** This clone's overrides from Project Settings. */
  local: WorktreeConfig;
  effective: WorktreeConfig;
  defaultPortRange: [number, number];
};

export type WorktreeSetupStatus = "running" | "succeeded" | "failed";

export type WorktreeSetupEvent = {
  path: string;
  command: string;
  status: WorktreeSetupStatus;
  exitCode: number | null;
  output: string;
  logPath: string | null;
  port: number | null;
  startedAt: number;
  finishedAt: number | null;
};

export const WORKTREE_SETUP_EVENT = "worktree-setup";
export const OPEN_BROWSER_URL_EVENT = "irgatos:open-browser-url";

export const loadWorktreeSettings = (cwd: string) =>
  invoke<WorktreeSettings>("worktree_settings", { cwd });

export const saveWorktreeSettings = (cwd: string, local: WorktreeConfig) =>
  invoke<WorktreeSettings>("worktree_settings_save", { cwd, local });

export const worktreePort = (cwd: string) =>
  invoke<number | null>("worktree_port", { cwd });

export const worktreeSetupStatus = (path: string) =>
  invoke<WorktreeSetupEvent | null>("worktree_setup_status", { path });

export const runWorktreeSetup = (path: string) =>
  invoke<string | null>("worktree_setup_run", { path });

export const listenWorktreeSetup = (
  handler: (event: WorktreeSetupEvent) => void,
) =>
  listen<WorktreeSetupEvent>(WORKTREE_SETUP_EVENT, ({ payload }) =>
    handler(payload),
  );

export function formatPortRange(range: readonly [number, number] | undefined) {
  return range ? `${range[0]}–${range[1]}` : "";
}

/**
 * Accepts "4100-4199", "4100–4199" or "4100 4199". Empty input clears the
 * override. Mirrors the backend's validation so errors show before saving.
 */
export function parsePortRangeInput(
  input: string,
): { range?: [number, number]; error?: string } {
  const text = input.trim();
  if (!text) return {};
  const match = /^(\d{1,5})\s*(?:[-–—:]|\s)\s*(\d{1,5})$/.exec(text);
  if (!match) return { error: "Enter a range like 4100-4199." };
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end > 65535) {
    return { error: "Ports must be between 1 and 65535." };
  }
  if (start > end) return { error: "The first port must not be above the last." };
  if (end - start + 1 > 10_000) {
    return { error: "Use a range of at most 10000 ports." };
  }
  return { range: [start, end] };
}

/** What a clone gets without local overrides: the shared file, then defaults. */
export function inheritedConfig(settings: WorktreeSettings): WorktreeConfig {
  return {
    portRange: settings.shared.portRange ?? settings.defaultPortRange,
    setup: settings.shared.setup,
    dev: settings.shared.dev,
  };
}

/**
 * Local override to save from the form. Values equal to the inherited ones are
 * not stored, and a blank port range falls back to them.
 */
export function localConfigFromForm(
  portRange: string,
  setup: string,
  inherited: WorktreeConfig,
  dev?: string,
): { config?: WorktreeConfig; error?: string } {
  const parsed = parsePortRangeInput(portRange);
  if (parsed.error) return { error: parsed.error };
  const config: WorktreeConfig = {};
  if (parsed.range && !sameRange(parsed.range, inherited.portRange)) {
    config.portRange = parsed.range;
  }
  const command = setup.trim();
  // An empty override is how a clone turns a committed setup command off.
  if (command !== (inherited.setup ?? "").trim()) config.setup = command;
  const devCommand = dev?.trim();
  if (devCommand !== undefined && devCommand !== (inherited.dev ?? "").trim()) {
    config.dev = devCommand;
  }
  return { config };
}

function sameRange(
  a: readonly [number, number] | undefined,
  b: readonly [number, number] | undefined,
) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

export function portUrl(port: number) {
  return `http://localhost:${port}`;
}

/** Ask the in-app browser panel to open a URL. */
export function openInAppBrowser(url: string) {
  window.dispatchEvent(
    new CustomEvent<string>(OPEN_BROWSER_URL_EVENT, { detail: url }),
  );
}

const setupRuns = new Map<string, WorktreeSetupEvent>();
const setupListeners = new Set<() => void>();
let setupSubscribed = false;

/** Latest setup event per worktree, kept for UI that mounts after the run started. */
export function rememberSetupEvent(event: WorktreeSetupEvent) {
  const key = pathKey(event.path);
  const previous = setupRuns.get(key);
  if (previous && previous.startedAt > event.startedAt) return;
  setupRuns.set(key, event);
  for (const listener of setupListeners) listener();
}

export function setupEventFor(path: string): WorktreeSetupEvent | undefined {
  return setupRuns.get(pathKey(path));
}

export function subscribeSetupEvents(listener: () => void) {
  setupListeners.add(listener);
  if (!setupSubscribed) {
    setupSubscribed = true;
    void listenWorktreeSetup(rememberSetupEvent).catch(() => {
      setupSubscribed = false;
    });
  }
  return () => {
    setupListeners.delete(listener);
  };
}

export function setupSummary(event: WorktreeSetupEvent): string {
  if (event.status === "running") return `Running ${event.command}`;
  if (event.status === "succeeded") return `Setup finished: ${event.command}`;
  const code = event.exitCode == null ? "" : ` (exit ${event.exitCode})`;
  return `Setup failed${code}: ${event.command}`;
}

export type DevEnvironmentStatus = {
  /** The project's development command; absent when none is set. */
  command?: string | null;
  root?: string | null;
  running: boolean;
  pid?: number | null;
  port?: number | null;
};

/** Whether the project's development command is running in its checkout. */
export const devEnvironmentStatus = (cwd: string) =>
  invoke<DevEnvironmentStatus>("dev_environment_status", { cwd });
