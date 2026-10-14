// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  LightpandaSettings,
  clearLightpandaStatusCache,
} from "./LightpandaSettings";
import type { LightpandaSidecar, LightpandaStatus } from "../model/lightpanda";
import type { McpConnection } from "../model/mcp";

const invoke = vi.fn();
const ask = vi.fn(async () => true);
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    name: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => ask(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../../platform/tauri/clipboard", () => ({
  copyText: vi.fn(async () => {}),
}));

const BINARY = "/Users/me/.irgatos/bin/lightpanda";
const stopped: LightpandaSidecar = {
  running: false,
  port: null,
  cdpUrl: null,
  pid: null,
};
const running: LightpandaSidecar = {
  running: true,
  port: 9333,
  cdpUrl: "ws://127.0.0.1:9333",
  pid: 42,
};
const missing: LightpandaStatus = {
  binaryPath: null,
  managed: false,
  version: null,
  installPath: BINARY,
  releaseAsset: "lightpanda-aarch64-macos",
  downloadUrl:
    "https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-macos",
  sidecar: stopped,
};
const installed: LightpandaStatus = {
  ...missing,
  binaryPath: BINARY,
  managed: true,
  version: "1.1.0-nightly.10552+dd2cd5d7f",
};

let container: HTMLDivElement;
let root: Root;
const onChanged = vi.fn(async () => {});

beforeEach(() => {
  clearLightpandaStatusCache();
  localStorage.clear();
  listeners.clear();
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
  status: LightpandaStatus,
  servers: McpConnection[] = [],
  variant: "full" | "sidecar" = "full",
  extra: Record<string, (args: unknown) => unknown> = {},
) {
  invoke.mockImplementation(async (command: string, args: unknown) => {
    if (command in extra) return extra[command](args);
    return command === "lightpanda_status" ? status : undefined;
  });
  await act(async () => {
    root.render(
      variant === "sidecar"
        ? createElement(LightpandaSettings, { variant: "sidecar" })
        : createElement(LightpandaSettings, {
            cwd: "/repo",
            servers,
            loading: false,
            onChanged,
          }),
    );
  });
}

function button(label: string) {
  const match = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.includes(label) ||
      element.getAttribute("aria-label") === label,
  );
  if (!match) throw new Error(`No button ${label}`);
  return match;
}

function checkbox(label: string) {
  const match = [
    ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.parentElement?.textContent?.includes(label),
  );
  if (!match) throw new Error(`No checkbox ${label}`);
  return match;
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("offers a one-click install of the official release when missing", async () => {
  let finish: (status: LightpandaStatus) => void = () => {};
  await render(missing, [], "full", {
    lightpanda_install: () =>
      new Promise<LightpandaStatus>((resolve) => (finish = resolve)),
  });
  expect(container.textContent).toContain("Lightpanda is not installed");
  expect(container.textContent).toContain("Not installed");
  expect(container.textContent).toContain("lightpanda-aarch64-macos");
  expect(container.textContent).toContain(BINARY);
  expect(container.textContent).toContain("AGPL-3.0");
  expect(container.textContent).toContain(
    "brew install lightpanda-io/browser/lightpanda",
  );
  expect(container.textContent).not.toContain("MCP server for agents");

  await act(async () => button("Install Lightpanda").click());
  expect(invoke).toHaveBeenCalledWith("lightpanda_install");
  await act(async () =>
    listeners.get("lightpanda:install-progress")?.({
      payload: { received: 46 * 1024 * 1024, total: 92 * 1024 * 1024 },
    }),
  );
  expect(container.textContent).toContain("Downloading… 50%");

  await act(async () => finish(installed));
  expect(container.textContent).toContain(
    "Detected · 1.1.0-nightly.10552+dd2cd5d7f",
  );
  expect(listeners.has("lightpanda:install-progress")).toBe(false);
});

it("shows install failures and disables install on unsupported platforms", async () => {
  await render(missing, [], "full", {
    lightpanda_install: () => Promise.reject("Could not download Lightpanda"),
  });
  await act(async () => button("Install Lightpanda").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not download Lightpanda",
  );

  await act(async () => root.unmount());
  root = createRoot(container);
  clearLightpandaStatusCache();
  await render({ ...missing, releaseAsset: null, downloadUrl: null });
  expect(button("Install Lightpanda").disabled).toBe(true);
  expect(container.textContent).toContain(
    "There is no Lightpanda release for this platform",
  );
});

it("registers lightpanda mcp with telemetry off for the chosen agents", async () => {
  await render(installed);
  expect(
    container.querySelector('[data-testid="lightpanda-detected"]')?.textContent,
  ).toContain("Detected");
  expect(button("Add to selected").disabled).toBe(true);

  await act(async () => checkbox("Add Lightpanda to Claude Code").click());
  await act(async () => checkbox("Add Lightpanda to Cursor").click());
  await act(async () => button("Add to Claude Code, Cursor").click());

  const config = JSON.stringify({
    command: BINARY,
    args: ["mcp"],
    env: { LIGHTPANDA_DISABLE_TELEMETRY: "true" },
  });
  for (const provider of ["claude", "cursor"]) {
    expect(invoke).toHaveBeenCalledWith("mcp_add", {
      cwd: "/repo",
      provider,
      scope: "user",
      name: "lightpanda",
      config,
    });
  }
  expect(onChanged).toHaveBeenCalled();
});

it("reports per-agent registration failures", async () => {
  await render(installed, [], "full", {
    mcp_add: (args) => {
      if ((args as { provider: string }).provider === "codex")
        throw "config is read-only";
    },
  });
  await act(async () => checkbox("Add Lightpanda to Codex").click());
  await act(async () => checkbox("Add Lightpanda to OpenCode").click());
  await act(async () => button("Add to Codex, OpenCode").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Codex: config is read-only",
  );
});

it("removes it from an agent after confirmation", async () => {
  await render(installed, [
    {
      provider: "claude",
      name: "lightpanda",
      scope: "user",
      configPath: "/home/.claude.json",
      transport: "stdio",
    },
    {
      provider: "codex",
      name: "lightpanda",
      scope: "user",
      configPath: "/home/.codex/config.toml",
      transport: "stdio",
    },
  ]);
  expect(container.textContent).toContain("Added · user");
  expect(
    container.querySelector('[aria-label="Add Lightpanda to Claude Code"]'),
  ).toBeNull();
  const [claude, codex] = [...container.querySelectorAll("button")].filter(
    (element) => element.textContent === "Remove",
  );

  ask.mockResolvedValueOnce(false);
  await act(async () => claude.click());
  expect(invoke).not.toHaveBeenCalledWith(
    "claude_mcp_remove",
    expect.anything(),
  );

  await act(async () => claude.click());
  expect(invoke).toHaveBeenCalledWith("claude_mcp_remove", {
    cwd: "/repo",
    name: "lightpanda",
    scope: "user",
  });
  await act(async () => codex.click());
  expect(invoke).toHaveBeenCalledWith("mcp_remove", {
    cwd: "/repo",
    provider: "codex",
    name: "lightpanda",
    configPath: "/home/.codex/config.toml",
  });
  expect(onChanged).toHaveBeenCalledTimes(2);
});

it("starts the CDP sidecar on the chosen port and stops it", async () => {
  await render(installed, [], "full", {
    lightpanda_sidecar_start: () => running,
    lightpanda_sidecar_stop: () => stopped,
  });
  expect(
    container.querySelector('[data-testid="lightpanda-sidecar-state"]')
      ?.textContent,
  ).toBe("Stopped");
  expect(container.textContent).toContain("IRGATOS_LIGHTPANDA_CDP_URL");

  const port = container.querySelector<HTMLInputElement>(
    '[aria-label="Lightpanda CDP port"]',
  )!;
  await type(port, "80");
  expect(button("Start").disabled).toBe(true);
  expect(container.textContent).toContain("Use a port from 1024 to 65535");
  await type(port, "9333");
  await act(async () => button("Start").click());
  expect(invoke).toHaveBeenCalledWith("lightpanda_sidecar_start", {
    port: 9333,
  });
  expect(localStorage.getItem("irgat:lightpanda-sidecar-port")).toBe("9333");
  expect(
    container.querySelector('[data-testid="lightpanda-sidecar-state"]')
      ?.textContent,
  ).toBe("Running · port 9333");
  expect(
    container.querySelector('[data-testid="lightpanda-cdp-url"]')?.textContent,
  ).toBe("ws://127.0.0.1:9333");
  expect(port.disabled).toBe(true);

  await act(async () => button("Stop").click());
  expect(invoke).toHaveBeenCalledWith("lightpanda_sidecar_stop");
  expect(
    container.querySelector('[data-testid="lightpanda-sidecar-state"]')
      ?.textContent,
  ).toBe("Stopped");
});

it("lets the sidecar pick a free port and surfaces start errors", async () => {
  await render(installed, [], "full", {
    lightpanda_sidecar_start: () => {
      throw "Lightpanda exited (exit status: 1): address in use";
    },
  });
  await act(async () => button("Start").click());
  expect(invoke).toHaveBeenCalledWith("lightpanda_sidecar_start", {
    port: null,
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "address in use",
  );
});

it("remembers the autostart choice", async () => {
  await render(installed);
  const box = checkbox("Start it when Irgatos opens");
  expect(box.checked).toBe(false);
  await act(async () => box.click());
  expect(localStorage.getItem("irgat:lightpanda-sidecar-autostart")).toBe("1");
});

it("shows only status and the sidecar on the Irgats page", async () => {
  await render({ ...installed, sidecar: running }, [], "sidecar");
  expect(container.textContent).toContain("Lightpanda Headless Browser");
  expect(container.textContent).toContain("Running · port 9333");
  expect(container.textContent).not.toContain("MCP server for agents");
  expect(
    container.querySelector('input[aria-label^="Add Lightpanda"]'),
  ).toBeNull();
});

it("offers updates only for the copy Irgatos manages", async () => {
  await render({
    ...installed,
    managed: false,
    binaryPath: "/opt/homebrew/bin/lightpanda",
  });
  expect(container.textContent).toContain("/opt/homebrew/bin/lightpanda");
  expect(
    [...container.querySelectorAll("button")].some(
      (element) => element.textContent === "Update",
    ),
  ).toBe(false);
});
