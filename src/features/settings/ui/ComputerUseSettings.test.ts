// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ComputerUseSettings,
  clearComputerUseStatusCache,
} from "./ComputerUseSettings";
import type { ComputerUseStatus } from "../model/computerUse";
import type { McpConnection } from "../model/mcp";

const invoke = vi.fn();
const ask = vi.fn(async () => true);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => ask(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const BINARY = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const installed: ComputerUseStatus = {
  binaryPath: BINARY,
  appBundle: true,
  version: "0.35.0",
  telemetryEnabled: true,
  telemetrySource: "default",
  permissions: { accessibility: false, screenRecording: null, detail: null },
};

let container: HTMLDivElement;
let root: Root;
const onChanged = vi.fn(async () => {});

beforeEach(() => {
  clearComputerUseStatusCache();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  invoke.mockReset();
  ask.mockClear();
  onChanged.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(
  status: ComputerUseStatus,
  servers: McpConnection[] = [],
) {
  invoke.mockImplementation(async (command: string) =>
    command === "computer_use_status" ? status : undefined,
  );
  await act(async () => {
    root.render(
      createElement(ComputerUseSettings, {
        cwd: "/repo",
        servers,
        loading: false,
        onChanged,
      }),
    );
  });
}

function button(label: string) {
  const match = [...document.body.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.includes(label) ||
      element.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`No button ${label}`);
  return match;
}

function checkbox(label: string) {
  const match = [
    ...document.body.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    ),
  ].find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.parentElement?.textContent?.includes(label),
  );
  if (!match) throw new Error(`No checkbox ${label}`);
  return match;
}

it("offers the standalone app install when the driver is missing", async () => {
  await render({
    binaryPath: null,
    appBundle: false,
    version: null,
    telemetryEnabled: null,
    telemetrySource: null,
    permissions: null,
  });
  expect(container.textContent).toContain("Cua Driver is not installed");
  expect(container.textContent).toContain("https://cua.ai/driver/install.sh");
  expect(container.textContent).toContain("Off");
  expect(container.textContent).not.toContain("Enable for selected");
});

it("enables computer use through mcp_add only after the user confirms", async () => {
  await render(installed);
  expect(container.textContent).toContain("Accessibility");
  expect(container.textContent).toContain("Not granted");
  expect(container.textContent).toContain("Screen Recording");
  expect(container.textContent).toContain("Unknown");
  expect(container.textContent).toContain("Grant in CuaDriver");
  expect(button("Enable for selected").disabled).toBe(true);

  await act(async () =>
    checkbox("Enable computer use for Claude Code").click(),
  );
  await act(async () => checkbox("Enable computer use for Codex").click());
  await act(async () => button("Enable for selected").click());
  expect(document.body.textContent).toContain(
    "Allow agents to control this computer?",
  );
  expect(document.body.textContent).toContain("Claude Code, Codex");
  const confirm = button("Enable computer use");
  expect(confirm.disabled).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith("mcp_add", expect.anything());

  await act(async () =>
    checkbox("I understand that agents can control my desktop").click(),
  );
  await act(async () => confirm.click());

  const config = JSON.stringify({
    command: BINARY,
    args: ["mcp"],
    env: { DO_NOT_TRACK: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" },
  });
  for (const provider of ["claude", "codex"]) {
    expect(invoke).toHaveBeenCalledWith("mcp_add", {
      cwd: "/repo",
      provider,
      scope: "user",
      name: "cua-driver",
      config,
    });
  }
  expect(invoke).toHaveBeenCalledWith("computer_use_disable_telemetry");
  expect(onChanged).toHaveBeenCalled();
  expect(document.body.textContent).not.toContain(
    "Allow agents to control this computer?",
  );
});

it("keeps telemetry untouched when the user unchecks the opt-out", async () => {
  await render({ ...installed, permissions: null });
  await act(async () => checkbox("Enable computer use for Cursor").click());
  await act(async () => button("Enable for selected").click());
  await act(async () => checkbox("Turn off Cua Driver telemetry").click());
  await act(async () =>
    checkbox("I understand that agents can control my desktop").click(),
  );
  await act(async () => button("Enable computer use").click());
  expect(invoke).toHaveBeenCalledWith(
    "mcp_add",
    expect.objectContaining({ provider: "cursor", scope: "user" }),
  );
  expect(invoke).not.toHaveBeenCalledWith("computer_use_disable_telemetry");
});

it("shows where it is active and turns it off for Claude Code", async () => {
  await render({ ...installed, telemetryEnabled: false }, [
    {
      provider: "claude",
      name: "cua-driver",
      scope: "user",
      configPath: "/home/.claude.json",
      transport: "stdio",
    },
  ]);
  expect(
    container.querySelector('[data-testid="computer-use-active"]')?.textContent,
  ).toContain("On · Claude Code");
  expect(container.textContent).toContain("Cua Driver telemetry: Off");
  expect(
    document.body.querySelector(
      '[aria-label="Enable computer use for Claude Code"]',
    ),
  ).toBeNull();

  await act(async () => button("Turn off").click());
  expect(ask).toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("claude_mcp_remove", {
    cwd: "/repo",
    name: "cua-driver",
    scope: "user",
  });
  expect(onChanged).toHaveBeenCalled();
});
