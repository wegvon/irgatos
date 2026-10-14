// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { startLightpandaIfEnabled } from "./useLightpandaAutostart";
import {
  saveSidecarAutostart,
  saveSidecarPort,
} from "../../features/settings/model/lightpanda";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
});

it("does nothing until the user opts in", async () => {
  expect(await startLightpandaIfEnabled()).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it("starts the sidecar on the remembered port", async () => {
  saveSidecarAutostart(true);
  saveSidecarPort(9333);
  invoke.mockResolvedValue({ running: true });
  expect(await startLightpandaIfEnabled()).toBe(true);
  expect(invoke).toHaveBeenCalledWith("lightpanda_sidecar_start", {
    port: 9333,
  });
});

it("lets Lightpanda pick a port and swallows start failures", async () => {
  saveSidecarAutostart(true);
  invoke.mockRejectedValue("Lightpanda is not installed");
  expect(await startLightpandaIfEnabled()).toBe(false);
  expect(invoke).toHaveBeenCalledWith("lightpanda_sidecar_start", {
    port: null,
  });
});
