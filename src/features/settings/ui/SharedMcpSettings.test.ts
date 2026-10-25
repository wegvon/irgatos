// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharedMcpSettings } from "./SharedMcpSettings";

const invoke = vi.fn();
const ask = vi.fn(async () => true);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => ask(...args),
}));

let container: HTMLDivElement;
let root: Root;
let saved: Record<string, unknown>[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  saved = [];
  invoke.mockReset();
  invoke.mockImplementation(async (command: string, args?: unknown) => {
    switch (command) {
      case "shared_mcp_list":
        return saved;
      case "shared_mcp_executor_url":
        return "https://executor.example.com/mcp";
      case "shared_mcp_save": {
        const server = {
          ...(args as { server: Record<string, unknown> }).server,
          id: "s1",
        };
        saved = [server];
        return server;
      }
      case "shared_mcp_test":
        return { serverName: "executor", tools: 3 };
      case "shared_mcp_remove":
        saved = [];
        return undefined;
      case "secrets_list":
        return [];
      default:
        return undefined;
    }
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function button(label: string) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (element) =>
      element.textContent?.trim() === label ||
      element.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  return found;
}

it("shares Mail's Executor with every agent in one click and checks it", async () => {
  await act(async () => root.render(createElement(SharedMcpSettings)));
  await settle();
  expect(container.textContent).toContain("Nothing shared yet");

  await act(async () => button("Share Executor").click());
  await settle();

  expect(invoke).toHaveBeenCalledWith("shared_mcp_save", {
    server: {
      id: "",
      name: "executor",
      url: "https://executor.example.com/mcp",
      auth: { kind: "executor" },
      enabled: true,
    },
  });
  expect(invoke).toHaveBeenCalledWith("shared_mcp_test", { id: "s1" });
  expect(container.textContent).toContain("Connected to executor · 3 tools");
  expect(container.textContent).toContain("Mail's Executor key");
  expect(() => button("Share Executor")).toThrow();
});

it("turns a server off and removes it after confirming", async () => {
  saved = [
    {
      id: "s1",
      name: "docs",
      url: "https://docs.example.com/mcp",
      auth: { kind: "none" },
      enabled: true,
    },
  ];
  await act(async () => root.render(createElement(SharedMcpSettings)));
  await settle();

  await act(async () => button("Turn off").click());
  await settle();
  expect(invoke).toHaveBeenCalledWith("shared_mcp_save", {
    server: expect.objectContaining({ id: "s1", enabled: false }),
  });
  expect(container.textContent).toContain("Off");

  await act(async () => button("Remove").click());
  await settle();
  expect(ask).toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("shared_mcp_remove", { id: "s1" });
});
