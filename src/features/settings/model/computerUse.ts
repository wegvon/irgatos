import type { McpConnection } from "./mcp";

export const COMPUTER_USE_SERVER = "cua-driver";
export const CUA_DRIVER_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"';
export const CUA_DRIVER_DOCS_URL = "https://cua.ai/docs/cua-driver";

export type ComputerUseProvider = Extract<
  McpConnection["provider"],
  "claude" | "codex" | "cursor" | "opencode"
>;

/** Every provider accepts a user-scoped entry, so one choice covers all projects. */
export const COMPUTER_USE_PROVIDERS: ComputerUseProvider[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
];
export const COMPUTER_USE_SCOPE = "user" satisfies McpConnection["scope"];

export type ComputerUsePermissions = {
  accessibility: boolean | null;
  screenRecording: boolean | null;
  detail: string | null;
};

export type ComputerUseStatus = {
  binaryPath: string | null;
  appBundle: boolean;
  version: string | null;
  telemetryEnabled: boolean | null;
  telemetrySource: string | null;
  permissions: ComputerUsePermissions | null;
};

/**
 * The env vars cover the stdio adapter the CLI spawns. On macOS the tools run
 * in CuaDriver.app's daemon, which needs the persisted `telemetry disable`.
 */
export function computerUseServerConfig(binaryPath: string) {
  return {
    command: binaryPath,
    args: ["mcp"],
    env: { DO_NOT_TRACK: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" },
  };
}

export function isComputerUseServer(server: Pick<McpConnection, "name">) {
  return server.name === COMPUTER_USE_SERVER;
}

export function activeComputerUse(servers: McpConnection[]) {
  return servers.filter(
    (server): server is McpConnection & { provider: ComputerUseProvider } =>
      isComputerUseServer(server) &&
      server.enabled !== false &&
      (COMPUTER_USE_PROVIDERS as string[]).includes(server.provider),
  );
}

export type PermissionState = "granted" | "missing" | "unknown";

export function permissionState(value: boolean | null): PermissionState {
  return value === null ? "unknown" : value ? "granted" : "missing";
}

export function permissionsReady(status: ComputerUseStatus | null) {
  const permissions = status?.permissions;
  if (!permissions) return true;
  return (
    permissions.accessibility === true && permissions.screenRecording === true
  );
}
