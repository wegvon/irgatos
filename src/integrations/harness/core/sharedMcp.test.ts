import { describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  acpSharedMcpServers,
  claudeSharedMcpConfig,
  sharedMcpLaunches,
  withCodexSharedMcp,
  type SharedMcpLaunch,
} from "./sharedMcp";

const launch: SharedMcpLaunch = {
  name: "executor",
  command: "/Applications/Irgatos.app/Contents/MacOS/irgatos",
  args: ["mcp-bridge", "id1"],
  env: [
    ["IRGAT_MCP_ENDPOINT", "127.0.0.1:5000"],
    ["IRGAT_MCP_TOKEN", "t"],
  ],
};

describe("shared MCP servers", () => {
  it("reach ACP agents as stdio servers", async () => {
    invoke.mockResolvedValueOnce([launch]);
    expect(await acpSharedMcpServers()).toEqual([
      {
        name: "executor",
        command: launch.command,
        args: ["mcp-bridge", "id1"],
        env: [
          { name: "IRGAT_MCP_ENDPOINT", value: "127.0.0.1:5000" },
          { name: "IRGAT_MCP_TOKEN", value: "t" },
        ],
      },
    ]);
  });

  it("never stop a session from starting", async () => {
    invoke.mockRejectedValueOnce(new Error("no app"));
    expect(await sharedMcpLaunches()).toEqual([]);
    invoke.mockResolvedValueOnce(undefined);
    expect(await sharedMcpLaunches()).toEqual([]);
  });

  it("join Claude Code through --mcp-config", () => {
    expect(claudeSharedMcpConfig([])).toBeUndefined();
    expect(JSON.parse(claudeSharedMcpConfig([launch])!)).toEqual({
      mcpServers: {
        executor: {
          type: "stdio",
          command: launch.command,
          args: ["mcp-bridge", "id1"],
          env: { IRGAT_MCP_ENDPOINT: "127.0.0.1:5000", IRGAT_MCP_TOKEN: "t" },
        },
      },
    });
  });

  it("join Codex as single overrides that keep the user's servers", () => {
    expect(withCodexSharedMcp(undefined, [])).toBeUndefined();
    const store = { sqlite_home: "/x" };
    expect(withCodexSharedMcp(store, [])).toBe(store);
    expect(withCodexSharedMcp(undefined, [launch])).toEqual({
      "mcp_servers.executor": {
        command: launch.command,
        args: ["mcp-bridge", "id1"],
        env: { IRGAT_MCP_ENDPOINT: "127.0.0.1:5000", IRGAT_MCP_TOKEN: "t" },
      },
    });
    const joined = withCodexSharedMcp(
      { sqlite_home: "/x", mcp_servers: { docs: { command: "node" } } },
      [launch],
    );
    expect(joined?.sqlite_home).toBe("/x");
    expect(Object.keys(joined?.mcp_servers as object)).toEqual([
      "docs",
      "executor",
    ]);
  });
});
