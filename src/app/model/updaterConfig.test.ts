import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getVersion, getBundleType, check, invoke, announce } = vi.hoisted(() => ({
  getVersion: vi.fn(),
  getBundleType: vi.fn(),
  check: vi.fn(),
  invoke: vi.fn(),
  announce: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion,
  getBundleType,
  BundleType: { Nsis: "nsis", Msi: "msi", Deb: "deb", Rpm: "rpm", AppImage: "appimage", App: "app" },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("../../features/settings/model/sounds", () => ({ announceUpdateAvailable: announce }));

import {
  describeCheck,
  isBlockedRepo,
  isUpdateDialogOpen,
  loadUpdateRepo,
  normalizeRepoSlug,
  packageManagerHint,
  probeForUpdate,
  resetUpdaterForTests,
  runUpdateFlow,
  saveUpdateRepo,
  type BuildInfo,
  type UpdateCheck,
} from "./updater";

const BUILD: BuildInfo = {
  version: "0.1.0",
  commit: "89b88053a1966eae8b984d21441372041f5a7b63",
  branch: "main",
  sourceDir: null,
  installPath: "/Applications/Irgatos.app",
  platform: "macos",
  arch: "aarch64",
  defaultRepos: ["wegvon/irgatos"],
  canSelfInstall: true,
};

function checkResult(overrides: Partial<UpdateCheck> = {}): UpdateCheck {
  return {
    build: BUILD,
    repos: ["wegvon/irgatos"],
    release: null,
    releaseNewer: false,
    releaseError: null,
    source: null,
    sourceNewer: false,
    sourceError: null,
    remoteBranch: null,
    ...overrides,
  };
}

const RELEASE = {
  repo: "wegvon/irgatos",
  tag: "v0.2.0",
  version: "0.2.0",
  name: "Irgatos 0.2.0",
  notes: "Faster.",
  htmlUrl: "https://github.com/wegvon/irgatos/releases/tag/v0.2.0",
  publishedAt: null,
  commit: "abcdef0123456789abcdef0123456789abcdef01",
  asset: {
    name: "Irgatos_0.2.0_aarch64.app.tar.gz",
    url: "https://github.com/wegvon/irgatos/releases/download/v0.2.0/Irgatos_0.2.0_aarch64.app.tar.gz",
    size: 10,
    kind: "app-archive" as const,
  },
};

function backend(result: UpdateCheck) {
  invoke.mockImplementation(async (command: string) => {
    if (command === "self_update_info") return BUILD;
    if (command === "self_update_check") return result;
    throw new Error(`unexpected ${command}`);
  });
}

describe("updater checks", () => {
  beforeEach(() => {
    resetUpdaterForTests();
    getBundleType.mockResolvedValue("app");
    getVersion.mockResolvedValue("0.1.0");
    check.mockRejectedValue(new Error("Updater does not have any endpoints set"));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("falls through to GitHub and the checkout when the Tauri feed isn't configured", async () => {
    backend(checkResult());

    const result = await runUpdateFlow(false);

    expect(result).toMatchObject({
      phase: "current",
      currentVersion: "0.1.0",
      currentCommit: BUILD.commit,
      repo: "wegvon/irgatos",
    });
    expect(result.note).toContain("No releases published on wegvon/irgatos yet.");
    expect(invoke).toHaveBeenCalledWith("self_update_check", { repo: null, sourceDir: null });
    expect(isUpdateDialogOpen()).toBe(false);
  });

  it("opens the update dialog for manual checks", async () => {
    backend(checkResult());

    await runUpdateFlow(true);

    expect(isUpdateDialogOpen()).toBe(true);
  });

  it("shares one check between concurrent callers", async () => {
    backend(checkResult());

    const [first, second] = await Promise.all([runUpdateFlow(false), runUpdateFlow(true)]);

    expect(first).toBe(second);
    expect(invoke.mock.calls.filter(([command]) => command === "self_update_check")).toHaveLength(1);
  });

  it("offers a newer GitHub release with one-click install on macOS", async () => {
    backend(checkResult({ release: RELEASE, releaseNewer: true }));

    const result = await runUpdateFlow(false);

    expect(result).toMatchObject({
      phase: "available",
      channel: "release",
      availableVersion: "0.2.0",
      repo: "wegvon/irgatos",
      installable: true,
    });
    expect(announce).toHaveBeenCalledWith("0.2.0");
    await expect(probeForUpdate()).resolves.toEqual({ version: "0.2.0" });
  });

  it("reports the GitHub error when nothing else can answer", async () => {
    check.mockRejectedValue(new Error("network failed"));
    backend(checkResult({ releaseError: "Couldn't reach GitHub: dns" }));

    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "error",
      error: "Couldn't reach GitHub: dns",
    });
  });

  it("reports a backend failure, preferring the native error", async () => {
    check.mockRejectedValue(new Error("network failed"));
    invoke.mockRejectedValue(new Error("command not found"));

    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "error",
      error: "network failed",
    });
  });

  it("takes a signed Tauri feed update when one exists", async () => {
    check.mockResolvedValue({ version: "0.2.0", body: " notes " });
    backend(checkResult());

    await expect(runUpdateFlow(false)).resolves.toMatchObject({
      phase: "available",
      channel: "native",
      availableVersion: "0.2.0",
      notes: "notes",
    });
    expect(invoke).not.toHaveBeenCalledWith("self_update_check", expect.anything());
  });

  it("treats a feed without this platform as unavailable, not as a failure", async () => {
    check.mockRejectedValue(
      new Error(
        'None of the fallback platforms `["linux-x86_64-deb", "linux-x86_64"]` were found in the response `platforms` object',
      ),
    );
    backend(checkResult());

    await expect(runUpdateFlow(true)).resolves.toMatchObject({ phase: "current" });
  });

  it.each([
    ["deb", "sudo apt install"],
    ["rpm", "sudo dnf install"],
  ] as const)("leaves %s installs to their package manager", async (kind, hint) => {
    getBundleType.mockResolvedValue(kind);
    backend(checkResult());

    await expect(runUpdateFlow(true)).resolves.toMatchObject({
      phase: "idle",
      packageManaged: kind,
    });
    expect(check).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("self_update_check", expect.anything());
    expect(packageManagerHint(kind)).toContain(hint);
  });

  it("keeps the automatic probe silent on package-managed installs", async () => {
    getBundleType.mockResolvedValue("deb");

    await expect(probeForUpdate()).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });
});

describe("describeCheck", () => {
  const base = { currentVersion: "0.1.0", currentCommit: BUILD.commit };

  it("sends other platforms to the release page", () => {
    const { snapshot } = describeCheck(
      checkResult({ build: { ...BUILD, canSelfInstall: false }, release: RELEASE, releaseNewer: true }),
      base,
    );
    expect(snapshot).toMatchObject({ phase: "available", installable: false });
    expect(snapshot.note).toBe("Download it from the release page.");
  });

  it("flags a release with no build for this Mac", () => {
    const { snapshot } = describeCheck(
      checkResult({ release: { ...RELEASE, asset: null }, releaseNewer: true }),
      base,
    );
    expect(snapshot.installable).toBe(false);
    expect(snapshot.note).toContain("no macOS download");
  });

  const source = {
    dir: "/Users/turel/src/irgatos",
    branch: "main",
    upstream: "origin/main",
    remoteSlug: "wegvon/irgatos",
    head: BUILD.commit!,
    target: "1234567890123456789012345678901234567890",
    newCommits: 3,
    behind: 3,
    ahead: 0,
    diverged: false,
    dirty: true,
    version: "0.1.0",
    fetchError: null,
  };

  it("offers a rebuild when the checkout has newer commits", () => {
    const { snapshot, pending } = describeCheck(
      checkResult({ source, sourceNewer: true }),
      base,
    );
    expect(pending?.channel).toBe("source");
    expect(snapshot).toMatchObject({
      phase: "available",
      channel: "source",
      newCommits: 3,
      branch: "main",
      availableCommit: source.target,
      installable: true,
    });
    expect(snapshot.note).toContain("Uncommitted changes");
  });

  it("refuses to rebuild a diverged branch", () => {
    const { snapshot } = describeCheck(
      checkResult({ source: { ...source, diverged: true, ahead: 2 }, sourceNewer: true }),
      base,
    );
    expect(snapshot.installable).toBe(false);
    expect(snapshot.note).toContain("2 local commits");
  });

  it("prefers a newer release over source commits", () => {
    const { snapshot } = describeCheck(
      checkResult({ release: RELEASE, releaseNewer: true, source, sourceNewer: true }),
      base,
    );
    expect(snapshot.channel).toBe("release");
  });

  it("explains an up-to-date result", () => {
    const { snapshot } = describeCheck(
      checkResult({
        release: { ...RELEASE, version: "0.1.0", tag: "v0.1.0" },
        remoteBranch: { repo: "wegvon/irgatos", branch: "main", aheadBy: 4 },
        source: { ...source, newCommits: 0, fetchError: "fatal: could not read Username\nmore" },
      }),
      base,
    );
    expect(snapshot.phase).toBe("current");
    expect(snapshot.note).toContain("Latest release: v0.1.0 on wegvon/irgatos.");
    expect(snapshot.note).toContain("4 newer commits on main at wegvon/irgatos");
    expect(snapshot.note).toContain("Couldn't fetch origin/main: fatal: could not read Username");
  });
});

describe("update repository", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["wegvon/irgatos", "wegvon/irgatos"],
    ["https://github.com/wegvon/monocode.git", "wegvon/monocode"],
    ["git@github.com:wegvon/irgatos.git", "wegvon/irgatos"],
    ["https://github.com/wegvon/irgatos/releases", "wegvon/irgatos"],
    ["wegvon/irgatos/extra", null],
    ["https://gitlab.com/wegvon/irgatos", null],
    ["nope", null],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeRepoSlug(input)).toBe(expected);
  });

  it("never points at upstream MonoCode", () => {
    expect(isBlockedRepo("cretou/monocode")).toBe(true);
    expect(isBlockedRepo("Cretou/irgatos")).toBe(true);
    expect(() => saveUpdateRepo("https://github.com/cretou/monocode")).toThrow(/upstream MonoCode/);
    store.set("irgatos.update.repo", "cretou/monocode");
    expect(loadUpdateRepo()).toBeNull();
    expect(packageManagerHint("deb")).toContain("https://github.com/wegvon/irgatos/releases/latest");
    expect(packageManagerHint("deb")).not.toContain("cretou");
  });

  it("saves, normalizes, and clears an override", () => {
    expect(saveUpdateRepo(" https://github.com/turel/irgatos.git ")).toBe("turel/irgatos");
    expect(loadUpdateRepo()).toBe("turel/irgatos");
    expect(packageManagerHint("rpm")).toContain("https://github.com/turel/irgatos/releases/latest");
    expect(saveUpdateRepo("")).toBeNull();
    expect(loadUpdateRepo()).toBeNull();
    expect(() => saveUpdateRepo("not a repo")).toThrow(/owner\/repo/);
  });
});
