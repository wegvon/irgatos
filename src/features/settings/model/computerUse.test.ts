import { expect, it } from "vitest";
import {
  activeComputerUse,
  computerUseServerConfig,
  permissionState,
  permissionsReady,
  type ComputerUseStatus,
} from "./computerUse";
import type { McpConnection } from "./mcp";

const status = (
  permissions: ComputerUseStatus["permissions"],
): ComputerUseStatus => ({
  binaryPath: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
  appBundle: true,
  version: "0.35.0",
  telemetryEnabled: false,
  telemetrySource: "persisted",
  permissions,
});

it("registers the driver's stdio MCP server with telemetry switched off", () => {
  expect(
    computerUseServerConfig(
      "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    ),
  ).toEqual({
    command: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    args: ["mcp"],
    env: { DO_NOT_TRACK: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" },
  });
});

it("treats only enabled cua-driver entries of agent CLIs as active", () => {
  const server = (
    provider: McpConnection["provider"],
    name: string,
    enabled?: boolean,
  ): McpConnection => ({
    provider,
    name,
    scope: "user",
    configPath: "",
    transport: "stdio",
    enabled,
  });
  expect(
    activeComputerUse([
      server("claude", "cua-driver"),
      server("codex", "cua-driver", false),
      server("cursor", "sentry"),
      server("claude_desktop", "cua-driver"),
      server("opencode", "cua-driver", true),
    ]).map((entry) => entry.provider),
  ).toEqual(["claude", "opencode"]);
});

it("needs both macOS grants before reporting the driver ready", () => {
  expect(permissionState(null)).toBe("unknown");
  expect(permissionState(false)).toBe("missing");
  expect(permissionState(true)).toBe("granted");
  expect(
    permissionsReady(
      status({ accessibility: true, screenRecording: false, detail: null }),
    ),
  ).toBe(false);
  expect(
    permissionsReady(
      status({ accessibility: true, screenRecording: true, detail: null }),
    ),
  ).toBe(true);
  expect(permissionsReady(status(null))).toBe(true);
});
