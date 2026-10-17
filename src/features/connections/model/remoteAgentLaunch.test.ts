// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { launchRemoteSession } from "./remoteAgentLaunch";
import { rememberRemoteProject, remotePath } from "./remoteProjects";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const cwd = remotePath("env", "/home/coder/project");
const launch = {
  prompt: "Choose one city name",
  cwd,
  harness: "claude" as const,
  reveal: false,
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "remote_machines")
      return [
        {
          id: "machine",
          name: "Gulce",
          environmentId: "env",
          endpoint: "ssh://gulce",
        },
      ];
    if (command === "remote_request") {
      const { params } = args as {
        params: { type: string; commandId: string };
      };
      return {
        commandId: params.commandId,
        sessionId: "host-session",
        revision: 1,
      };
    }
    throw new Error(`Unexpected command ${command}`);
  });
});

it("creates the session on the machine and sends the prompt with retry-safe command IDs", async () => {
  rememberRemoteProject("env", {
    id: "project",
    cwd: "/home/coder/project",
    name: "project",
  } as never);
  await expect(launchRemoteSession(launch, "app-irgat-req1")).resolves.toEqual({
    machineId: "machine",
    sessionId: "host-session",
  });
  const dispatched = vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "remote_request")
    .map(([, args]) => (args as { params: Record<string, unknown> }).params);
  expect(dispatched).toEqual([
    expect.objectContaining({
      type: "create",
      commandId: "app-irgat-req1:create",
      projectId: "project",
      harness: "claude",
    }),
    {
      type: "send",
      commandId: "app-irgat-req1:send",
      sessionId: "host-session",
      text: "Choose one city name",
    },
  ]);
});

it("explains when the remote project is not open on this computer", async () => {
  await expect(launchRemoteSession(launch, "req")).rejects.toThrow(
    "not open on this computer",
  );
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects drafts instead of starting a turn", async () => {
  rememberRemoteProject("env", {
    id: "project",
    cwd: "/home/coder/project",
    name: "project",
  } as never);
  await expect(
    launchRemoteSession({ ...launch, draft: true }, "req"),
  ).rejects.toThrow("Drafts are not available");
});
