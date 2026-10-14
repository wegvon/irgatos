// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  activeLightpanda,
  installProgressLabel,
  lightpandaServerConfig,
  loadSidecarAutostart,
  loadSidecarPort,
  parseSidecarPort,
  saveSidecarAutostart,
  saveSidecarPort,
} from "./lightpanda";
import type { McpConnection } from "./mcp";

beforeEach(() => localStorage.clear());

it("registers `lightpanda mcp` with telemetry disabled", () => {
  expect(lightpandaServerConfig("/Users/me/.irgatos/bin/lightpanda")).toEqual({
    command: "/Users/me/.irgatos/bin/lightpanda",
    args: ["mcp"],
    env: { LIGHTPANDA_DISABLE_TELEMETRY: "true" },
  });
});

it("returns a fresh env object so callers cannot mutate the shared default", () => {
  const first = lightpandaServerConfig("/a");
  (first.env as Record<string, string>).EXTRA = "1";
  expect(lightpandaServerConfig("/a").env).toEqual({
    LIGHTPANDA_DISABLE_TELEMETRY: "true",
  });
});

it("treats only enabled lightpanda entries of agent CLIs as active", () => {
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
    activeLightpanda([
      server("claude", "lightpanda"),
      server("codex", "lightpanda", false),
      server("cursor", "cua-driver"),
      server("claude_desktop", "lightpanda"),
      server("opencode", "lightpanda", true),
    ]).map((entry) => entry.provider),
  ).toEqual(["claude", "opencode"]);
});

it("accepts a blank or unprivileged sidecar port only", () => {
  expect(parseSidecarPort("")).toBeNull();
  expect(parseSidecarPort("  ")).toBeNull();
  expect(parseSidecarPort("9222")).toBe(9222);
  expect(parseSidecarPort(" 65535 ")).toBe(65535);
  expect(parseSidecarPort("80")).toBeUndefined();
  expect(parseSidecarPort("65536")).toBeUndefined();
  expect(parseSidecarPort("92a2")).toBeUndefined();
  expect(parseSidecarPort("-1")).toBeUndefined();
  expect(parseSidecarPort("9222.5")).toBeUndefined();
});

it("labels download progress with and without a known size", () => {
  expect(installProgressLabel({ received: 5 * 1024 * 1024, total: null })).toBe(
    "5.0 MB",
  );
  expect(
    installProgressLabel({
      received: 46 * 1024 * 1024,
      total: 92 * 1024 * 1024,
    }),
  ).toBe("50% · 46.0 of 92.0 MB");
  expect(installProgressLabel({ received: 10, total: 5 })).toMatch(/^100%/);
});

it("remembers the autostart choice and the port", () => {
  expect(loadSidecarAutostart()).toBe(false);
  saveSidecarAutostart(true);
  expect(loadSidecarAutostart()).toBe(true);

  expect(loadSidecarPort()).toBeNull();
  saveSidecarPort(9333);
  expect(loadSidecarPort()).toBe(9333);
  saveSidecarPort(null);
  expect(loadSidecarPort()).toBeNull();
  localStorage.setItem("irgat:lightpanda-sidecar-port", "22");
  expect(loadSidecarPort()).toBeNull();
});
