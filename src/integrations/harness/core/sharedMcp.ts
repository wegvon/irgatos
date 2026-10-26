import { invoke } from "@tauri-apps/api/core";
import { hasHeadlessChildBackend } from "./child";

/** One MCP server the user shares with every agent (Settings > MCP). Agents
 * start it as a local stdio command, the Irgatos bridge, which reaches the
 * real server through the app; the server's key never leaves the app. */
export type SharedMcpLaunch = {
  name: string;
  command: string;
  args: string[];
  env: [string, string][];
};

/** The shared servers for a new agent session. Headless hosts run on other
 * machines, where the bridge does not exist, so they get none; a failure
 * here never stops a session from starting. */
export async function sharedMcpLaunches(): Promise<SharedMcpLaunch[]> {
  try {
    if (hasHeadlessChildBackend()) return [];
    const launches = await invoke<SharedMcpLaunch[]>("shared_mcp_specs");
    return Array.isArray(launches) ? launches : [];
  } catch {
    return [];
  }
}

/** ACP `session/new` and `session/load` stdio entries. */
export async function acpSharedMcpServers(): Promise<
  {
    name: string;
    command: string;
    args: string[];
    env: { name: string; value: string }[];
  }[]
> {
  return (await sharedMcpLaunches()).map((launch) => ({
    name: launch.name,
    command: launch.command,
    args: launch.args,
    env: launch.env.map(([name, value]) => ({ name, value })),
  }));
}

/** Claude Code `--mcp-config` JSON, or undefined when nothing is shared. */
export function claudeSharedMcpConfig(
  launches: SharedMcpLaunch[],
): string | undefined {
  if (launches.length === 0) return undefined;
  return JSON.stringify({
    mcpServers: Object.fromEntries(
      launches.map((launch) => [
        launch.name,
        {
          type: "stdio",
          command: launch.command,
          args: launch.args,
          env: Object.fromEntries(launch.env),
        },
      ]),
    ),
  });
}

/** Codex thread config with the shared servers added. Each one is its own
 * `mcp_servers.<name>` override so the user's servers stay; when the config
 * already carries the whole table (a private Irgat store), they join it. */
export function withCodexSharedMcp(
  config: Record<string, unknown> | undefined,
  launches: SharedMcpLaunch[],
): Record<string, unknown> | undefined {
  if (launches.length === 0) return config;
  const servers = launches.map(
    (launch) =>
      [
        launch.name,
        {
          command: launch.command,
          args: launch.args,
          env: Object.fromEntries(launch.env),
        },
      ] as const,
  );
  const table = config?.mcp_servers;
  if (table !== null && typeof table === "object" && !Array.isArray(table)) {
    return {
      ...config,
      mcp_servers: { ...table, ...Object.fromEntries(servers) },
    };
  }
  return {
    ...config,
    ...Object.fromEntries(
      servers.map(([name, server]) => [`mcp_servers.${name}`, server]),
    ),
  };
}
