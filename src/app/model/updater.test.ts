import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  check: vi.fn(),
  downloadAndInstall: vi.fn(),
  getVersion: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  openUrl: vi.fn(),
  relaunch: vi.fn(),
  remember: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: mocks.getVersion,
  getBundleType: vi.fn().mockResolvedValue("app"),
  BundleType: { Nsis: "nsis", Msi: "msi", Deb: "deb", Rpm: "rpm", AppImage: "appimage", App: "app" },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("../../features/settings/model/sounds", () => ({ announceUpdateAvailable: mocks.announce }));
vi.mock("./updateNotice", () => ({ rememberInstalledUpdate: mocks.remember }));

type ProgressHandler = (event: { payload: { stage: string; message: string; progress?: number } }) => void;
let progress: ProgressHandler | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  progress = null;
  mocks.getVersion.mockResolvedValue("0.1.0");
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.openUrl.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(async (_event: string, handler: ProgressHandler) => {
    progress = handler;
    return () => {
      progress = null;
    };
  });
});

async function updaterWithNativeUpdate() {
  mocks.check.mockResolvedValue({
    version: "0.1.1",
    downloadAndInstall: mocks.downloadAndInstall,
  });
  mocks.invoke.mockResolvedValue(null);
  const updater = await import("./updater");
  await updater.probeForUpdate();
  return updater;
}

const RELEASE = {
  repo: "wegvon/irgatos",
  tag: "v0.2.0",
  version: "0.2.0",
  name: null,
  notes: null,
  htmlUrl: "https://github.com/wegvon/irgatos/releases/tag/v0.2.0",
  publishedAt: null,
  commit: null,
  asset: {
    name: "Irgatos_0.2.0_aarch64.app.tar.gz",
    url: "https://github.com/wegvon/irgatos/releases/download/v0.2.0/Irgatos_0.2.0_aarch64.app.tar.gz",
    size: 10,
    kind: "app-archive",
  },
};

async function updaterWithRelease(canSelfInstall = true) {
  mocks.check.mockRejectedValue(new Error("Updater does not have any endpoints set"));
  const build = {
    version: "0.1.0",
    commit: null,
    branch: null,
    sourceDir: null,
    installPath: null,
    platform: "macos",
    arch: "aarch64",
    defaultRepos: [],
    canSelfInstall,
  };
  mocks.invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "self_update_info":
        return build;
      case "self_update_check":
        return {
          build,
          repos: ["wegvon/irgatos"],
          release: RELEASE,
          releaseNewer: true,
          releaseError: null,
          source: null,
          sourceNewer: false,
          sourceError: null,
          remoteBranch: null,
        };
      case "self_update_install_release":
        progress?.({ payload: { stage: "downloading", message: "Downloading", progress: 40 } });
        return "/Applications/Irgatos.app";
      case "self_update_relaunch":
        return null;
    }
    throw new Error(`unexpected ${command}`);
  });
  const updater = await import("./updater");
  await updater.runUpdateFlow(false);
  return updater;
}

describe("installPendingUpdate (Tauri feed)", () => {
  it("records a successful installation before relaunching", async () => {
    mocks.downloadAndInstall.mockResolvedValue(undefined);
    const updater = await updaterWithNativeUpdate();

    await updater.installPendingUpdate();

    expect(mocks.remember).toHaveBeenCalledWith("0.1.1");
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.remember.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.relaunch.mock.invocationCallOrder[0]!,
    );
  });

  it("does not record or relaunch after installation fails", async () => {
    mocks.downloadAndInstall.mockRejectedValue(new Error("install failed"));
    const updater = await updaterWithNativeUpdate();

    const result = await updater.installPendingUpdate();

    expect(result.phase).toBe("error");
    expect(result.error).toContain("install failed");
    expect(updater.isUpdateDialogOpen()).toBe(true);
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it("does not record when no update is pending", async () => {
    const updater = await import("./updater");

    expect((await updater.installPendingUpdate()).phase).toBe("idle");
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});

describe("installPendingUpdate (GitHub release)", () => {
  it("downloads, installs, records, then relaunches the installed bundle", async () => {
    const updater = await updaterWithRelease();
    const seen: string[] = [];
    updater.subscribeUpdater(() => seen.push(updater.getUpdaterSnapshot().phase));

    await updater.installPendingUpdate();

    expect(mocks.invoke).toHaveBeenCalledWith("self_update_install_release", {
      repo: "wegvon/irgatos",
      asset: RELEASE.asset,
    });
    expect(mocks.remember).toHaveBeenCalledWith("0.2.0");
    expect(mocks.invoke).toHaveBeenLastCalledWith("self_update_relaunch", {
      bundle: "/Applications/Irgatos.app",
    });
    expect(seen).toEqual(["downloading", "downloading", "relaunching"]);
    expect(progress).toBeNull();
  });

  it("surfaces an install failure and keeps the update for a retry", async () => {
    const updater = await updaterWithRelease();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "self_update_install_release") throw "Couldn't replace /Applications/Irgatos.app";
      return null;
    });

    const result = await updater.installPendingUpdate();

    expect(result).toMatchObject({
      phase: "error",
      error: "Couldn't replace /Applications/Irgatos.app",
      availableVersion: "0.2.0",
    });
    expect(mocks.remember).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("self_update_relaunch", expect.anything());
  });

  it("opens the release page where it can't install itself", async () => {
    const updater = await updaterWithRelease(false);

    await updater.installPendingUpdate();

    expect(mocks.openUrl).toHaveBeenCalledWith(RELEASE.htmlUrl);
    expect(mocks.invoke).not.toHaveBeenCalledWith("self_update_install_release", expect.anything());
  });
});
