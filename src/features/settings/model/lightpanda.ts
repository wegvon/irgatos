import type { McpConnection } from "./mcp";
import { readFlag, writeFlag } from "./storageFlags";

export const LIGHTPANDA_SERVER = "lightpanda";
export const LIGHTPANDA_REPO_URL = "https://github.com/lightpanda-io/browser";
export const LIGHTPANDA_BREW_COMMAND =
  "brew install lightpanda-io/browser/lightpanda";
export const LIGHTPANDA_TELEMETRY_ENV = {
  LIGHTPANDA_DISABLE_TELEMETRY: "true",
} as const;
export const LIGHTPANDA_CDP_ENV = "IRGATOS_LIGHTPANDA_CDP_URL";
export const LIGHTPANDA_INSTALL_PROGRESS = "lightpanda:install-progress";

export type LightpandaProvider = Extract<
  McpConnection["provider"],
  "claude" | "codex" | "cursor" | "opencode"
>;

/** Every provider accepts a user-scoped entry, so one choice covers all projects. */
export const LIGHTPANDA_PROVIDERS: LightpandaProvider[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
];
export const LIGHTPANDA_SCOPE = "user" satisfies McpConnection["scope"];

export type LightpandaSidecar = {
  running: boolean;
  port: number | null;
  cdpUrl: string | null;
  pid: number | null;
};

export type LightpandaStatus = {
  binaryPath: string | null;
  managed: boolean;
  version: string | null;
  installPath: string | null;
  releaseAsset: string | null;
  downloadUrl: string | null;
  sidecar: LightpandaSidecar;
};

export type LightpandaInstallProgress = {
  received: number;
  total: number | null;
};

export const STOPPED_SIDECAR: LightpandaSidecar = {
  running: false,
  port: null,
  cdpUrl: null,
  pid: null,
};

export function lightpandaServerConfig(binaryPath: string) {
  return {
    command: binaryPath,
    args: ["mcp"],
    env: { ...LIGHTPANDA_TELEMETRY_ENV },
  };
}

export function isLightpandaServer(server: Pick<McpConnection, "name">) {
  return server.name === LIGHTPANDA_SERVER;
}

export function activeLightpanda(servers: McpConnection[]) {
  return servers.filter(
    (server): server is McpConnection & { provider: LightpandaProvider } =>
      isLightpandaServer(server) &&
      server.enabled !== false &&
      (LIGHTPANDA_PROVIDERS as string[]).includes(server.provider),
  );
}

/** Blank means "pick a free port"; `undefined` means the input is invalid. */
export function parseSidecarPort(input: string): number | null | undefined {
  const value = input.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1024 && port <= 65535 ? port : undefined;
}

export function installProgressLabel(progress: LightpandaInstallProgress) {
  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
  if (!progress.total) return `${mb(progress.received)} MB`;
  const percent = Math.min(
    100,
    Math.round((progress.received / progress.total) * 100),
  );
  return `${percent}% · ${mb(progress.received)} of ${mb(progress.total)} MB`;
}

const AUTOSTART_KEY = "irgat:lightpanda-sidecar-autostart";
const PORT_KEY = "irgat:lightpanda-sidecar-port";

export function loadSidecarAutostart() {
  return readFlag(AUTOSTART_KEY) ?? false;
}

export function saveSidecarAutostart(value: boolean) {
  writeFlag(AUTOSTART_KEY, value);
}

export function loadSidecarPort(): number | null {
  try {
    return parseSidecarPort(localStorage.getItem(PORT_KEY) ?? "") ?? null;
  } catch {
    return null;
  }
}

export function saveSidecarPort(port: number | null) {
  try {
    if (port === null) localStorage.removeItem(PORT_KEY);
    else localStorage.setItem(PORT_KEY, String(port));
  } catch {
    // private mode / quota
  }
}
