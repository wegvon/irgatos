import { BundleType, getBundleType, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { announceUpdateAvailable } from "../../features/settings/model/sounds";
import { formatVersion } from "./appVersion";
import { rememberInstalledUpdate } from "./updateNotice";

/**
 * Irgatos's own repository, then its pre-rename name. GitHub redirects the
 * old name once the repo is renamed, so both keep working.
 */
export const DEFAULT_UPDATE_REPOS = ["wegvon/irgatos", "wegvon/monocode"] as const;
/** Upstream MonoCode owners ship a different app under the same asset names. */
const BLOCKED_REPO_OWNERS = ["cretou", "hardbeat920"];
const REPO_KEY = "irgatos.update.repo";
const SOURCE_DIR_KEY = "irgatos.update.sourceDir";

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "building"
  | "relaunching"
  | "error";

/**
 * `native`: the Tauri updater feed (signed builds). `release`: a GitHub
 * Release asset. `source`: newer commits in the checkout this build came from.
 */
export type UpdateChannel = "native" | "release" | "source";

export type UpdaterSnapshot = {
  phase: UpdaterPhase;
  currentVersion: string;
  currentCommit?: string;
  branch?: string;
  availableVersion?: string;
  availableCommit?: string;
  channel?: UpdateChannel;
  progress?: number;
  /** Latest progress line (download name, build output). */
  detail?: string;
  notes?: string;
  releaseUrl?: string;
  repo?: string;
  newCommits?: number;
  /** False when the update can only be fetched by hand from `releaseUrl`. */
  installable?: boolean;
  /** Secondary status: latest release seen, fetch failures, caveats. */
  note?: string;
  error?: string;
  /** Set on Linux .deb/.rpm installs, which update through apt/dnf. */
  packageManaged?: PackageManagedInstall;
};

export type BuildInfo = {
  version: string;
  commit: string | null;
  branch: string | null;
  sourceDir: string | null;
  installPath: string | null;
  platform: "macos" | "linux" | "windows";
  arch: string;
  defaultRepos: string[];
  canSelfInstall: boolean;
};

export type ReleaseAsset = {
  name: string;
  url: string;
  size: number;
  kind: "app-archive" | "dmg";
};

export type ReleaseInfo = {
  repo: string;
  tag: string;
  version: string;
  name: string | null;
  notes: string | null;
  htmlUrl: string;
  publishedAt: string | null;
  commit: string | null;
  asset: ReleaseAsset | null;
};

export type SourceInfo = {
  dir: string;
  branch: string;
  upstream: string | null;
  remoteSlug: string | null;
  head: string;
  target: string;
  newCommits: number;
  behind: number;
  ahead: number;
  diverged: boolean;
  dirty: boolean;
  version: string | null;
  fetchError: string | null;
};

export type UpdateCheck = {
  build: BuildInfo;
  repos: string[];
  release: ReleaseInfo | null;
  releaseNewer: boolean;
  releaseError: string | null;
  source: SourceInfo | null;
  sourceNewer: boolean;
  sourceError: string | null;
  remoteBranch: { repo: string; branch: string; aheadBy: number } | null;
};

type Pending =
  | { channel: "native"; update: Update }
  | { channel: "release"; release: ReleaseInfo }
  | { channel: "source"; source: SourceInfo };

type Progress = { stage: string; message: string; progress?: number | null };

const BUSY_PHASES: readonly UpdaterPhase[] = [
  "downloading",
  "installing",
  "building",
  "relaunching",
];

export function isUpdateBusy(snapshot: UpdaterSnapshot): boolean {
  return BUSY_PHASES.includes(snapshot.phase);
}

// --- Shared state: Settings, the sidebar, and the dialog all read one store.

let snapshot: UpdaterSnapshot = { phase: "idle", currentVersion: "…" };
const listeners = new Set<() => void>();
let pending: Pending | null = null;
let inFlight: Promise<UpdaterSnapshot> | null = null;

export function subscribeUpdater(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUpdaterSnapshot(): UpdaterSnapshot {
  return snapshot;
}

function publish(
  next: UpdaterSnapshot,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): UpdaterSnapshot {
  snapshot = next;
  for (const listener of listeners) listener();
  onProgress?.(next);
  return next;
}

let dialogOpen = false;
const dialogListeners = new Set<() => void>();

export function subscribeUpdateDialog(listener: () => void): () => void {
  dialogListeners.add(listener);
  return () => dialogListeners.delete(listener);
}

export function isUpdateDialogOpen(): boolean {
  return dialogOpen;
}

function setDialogOpen(open: boolean) {
  if (dialogOpen === open) return;
  dialogOpen = open;
  for (const listener of dialogListeners) listener();
}

export function openUpdateDialog() {
  setDialogOpen(true);
}

export function closeUpdateDialog() {
  setDialogOpen(false);
}

// --- Configuration

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `owner/repo` from a slug or a GitHub URL; null for anything else. */
export function normalizeRepoSlug(input: string): string | null {
  const text = input.trim().replace(/\/+$/, "");
  const match =
    /^(?:git@github\.com:|(?:[a-z+]+:\/\/)?(?:[^@/]+@)?github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/.exec(
      text,
    );
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo || [owner, repo].some((part) => part === "." || part === "..")) {
    return null;
  }
  // A bare slug has exactly two segments; only URLs may carry a path after it.
  if (!text.includes("github.com") && text.split("/").length !== 2) return null;
  return `${owner}/${repo}`;
}

export function isBlockedRepo(slug: string): boolean {
  const owner = slug.split("/")[0]?.toLowerCase() ?? "";
  return BLOCKED_REPO_OWNERS.includes(owner);
}

export function loadUpdateRepo(): string | null {
  const stored = storage()?.getItem(REPO_KEY);
  const slug = stored ? normalizeRepoSlug(stored) : null;
  return slug && !isBlockedRepo(slug) ? slug : null;
}

/** Saves an override, or clears it for an empty value. Throws when invalid. */
export function saveUpdateRepo(input: string): string | null {
  const store = storage();
  if (!input.trim()) {
    store?.removeItem(REPO_KEY);
    return null;
  }
  const slug = normalizeRepoSlug(input);
  if (!slug) throw new Error("Use owner/repo, e.g. wegvon/irgatos.");
  if (isBlockedRepo(slug)) {
    throw new Error(`${slug} is upstream MonoCode, not Irgatos.`);
  }
  store?.setItem(REPO_KEY, slug);
  return slug;
}

export function loadUpdateSourceDir(): string | null {
  return storage()?.getItem(SOURCE_DIR_KEY)?.trim() || null;
}

export function saveUpdateSourceDir(input: string): string | null {
  const store = storage();
  const value = input.trim();
  if (value) store?.setItem(SOURCE_DIR_KEY, value);
  else store?.removeItem(SOURCE_DIR_KEY);
  buildInfo = null;
  return value || null;
}

export function releasesUrl(repo: string = loadUpdateRepo() ?? DEFAULT_UPDATE_REPOS[0]): string {
  return `https://github.com/${repo}/releases/latest`;
}

// --- Platform probes

/**
 * Linux `.deb` and `.rpm` installs belong to apt/dnf. The release feed only
 * publishes an AppImage target, so the plugin reports no matching platform
 * for them; surface that as "update through your package manager" instead of
 * a raw error, and never self-install.
 */
export type PackageManagedInstall = "deb" | "rpm";

export async function packageManagedInstall(): Promise<PackageManagedInstall | null> {
  let type: string | null;
  try {
    type = await getBundleType();
  } catch {
    return null;
  }
  if (type === BundleType.Deb) return "deb";
  if (type === BundleType.Rpm) return "rpm";
  return null;
}

export function packageManagerHint(kind: PackageManagedInstall): string {
  const url = releasesUrl();
  return kind === "deb"
    ? `Download one .deb from ${url} and run: sudo apt install ./Irgatos_X.Y.Z_amd64.deb\nReplace the file name with the one you downloaded.`
    : `Download one .rpm from ${url} and run: sudo dnf install ./Irgatos-X.Y.Z-1.x86_64.rpm\nReplace the file name with the one you downloaded.`;
}

function isTargetMissingError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  // tauri-plugin-updater Error::TargetsNotFound / Error::TargetNotFound.
  return /none of the fallback platforms|the platform `[^`]*` was not found/i.test(text);
}

function isUpdaterNotConfiguredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /updater does not have any endpoints set|pubkey/i.test(text);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.0.0";
  }
}

let buildInfo: Promise<BuildInfo | null> | null = null;

export function readBuildInfo(): Promise<BuildInfo | null> {
  buildInfo ??= Promise.resolve()
    .then(() => invoke<BuildInfo>("self_update_info", { sourceDir: loadUpdateSourceDir() }))
    .then((info) => info ?? null)
    .catch(() => null);
  return buildInfo;
}

let identity: Promise<void> | null = null;

/** Fills in the running version and commit without checking for updates. */
export function loadCurrentBuild(): Promise<void> {
  identity ??= Promise.all([
    readAppVersion(),
    readBuildInfo(),
    packageManagedInstall(),
  ]).then(([currentVersion, info, managed]) => {
    if (snapshot.currentVersion !== "…") return;
    publish({
      ...snapshot,
      currentVersion,
      currentCommit: info?.commit ?? undefined,
      branch: info?.branch ?? undefined,
      packageManaged: managed ?? undefined,
    });
  });
  return identity;
}

// --- Checking

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim())?.trim() ?? text;
}

type Base = Pick<UpdaterSnapshot, "currentVersion" | "currentCommit" | "branch">;

/** Turns the backend's findings into what the UI shows and what to install. */
export function describeCheck(
  result: UpdateCheck,
  base: Base,
): { snapshot: UpdaterSnapshot; pending: Pending | null } {
  const { release, source, build } = result;
  if (release && result.releaseNewer) {
    const installable = build.canSelfInstall && release.asset != null;
    return {
      pending: { channel: "release", release },
      snapshot: {
        ...base,
        phase: "available",
        channel: "release",
        availableVersion: release.version,
        availableCommit: release.commit ?? undefined,
        notes: release.notes ?? undefined,
        releaseUrl: release.htmlUrl,
        repo: release.repo,
        installable,
        note: installable
          ? undefined
          : build.canSelfInstall
            ? `${release.tag} has no macOS download for this Mac yet.`
            : "Download it from the release page.",
      },
    };
  }

  if (source && result.sourceNewer) {
    const installable = build.canSelfInstall && !source.diverged;
    const notes = [
      source.diverged
        ? `${source.branch} has ${plural(source.ahead, "local commit")} that ${source.upstream ?? "its upstream"} doesn't. Merge or rebase it in a terminal first.`
        : null,
      source.dirty && !source.diverged
        ? "Uncommitted changes in the checkout are kept and included in the build."
        : null,
      build.canSelfInstall ? null : `Rebuild from ${source.dir} to update.`,
      source.fetchError
        ? `Couldn't fetch ${source.upstream ?? "the remote"}: ${firstLine(source.fetchError)}`
        : null,
    ].filter(Boolean);
    return {
      pending: { channel: "source", source },
      snapshot: {
        ...base,
        phase: "available",
        channel: "source",
        availableVersion: source.version ?? base.currentVersion,
        availableCommit: source.target,
        newCommits: source.newCommits,
        branch: source.branch,
        repo: source.remoteSlug ?? undefined,
        installable,
        note: notes.join(" ") || undefined,
      },
    };
  }

  const repos = result.repos.join(" or ");
  const unreachable = !release && result.releaseError != null;
  const notes = [
    release
      ? `Latest release: ${formatVersion(release.version)} on ${release.repo}.`
      : unreachable
        ? `Couldn't check GitHub Releases: ${result.releaseError}`
        : `No releases published on ${repos} yet.`,
    result.remoteBranch && result.remoteBranch.aheadBy > 0
      ? `${plural(result.remoteBranch.aheadBy, "newer commit")} on ${result.remoteBranch.branch} at ${result.remoteBranch.repo}, not released yet.`
      : null,
    source?.fetchError
      ? `Couldn't fetch ${source.upstream ?? "the remote"}: ${firstLine(source.fetchError)}`
      : null,
    result.sourceError ? `Source checkout: ${firstLine(result.sourceError)}` : null,
  ].filter(Boolean);

  if (unreachable && !source) {
    return {
      pending: null,
      snapshot: {
        ...base,
        phase: "error",
        repo: result.repos[0],
        error: result.releaseError ?? undefined,
      },
    };
  }
  return {
    pending: null,
    snapshot: {
      ...base,
      phase: "current",
      repo: release?.repo ?? result.repos[0],
      releaseUrl: release?.htmlUrl,
      note: notes.join(" "),
    },
  };
}

async function performCheck(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const [currentVersion, info] = await Promise.all([readAppVersion(), readBuildInfo()]);
  const base: Base = {
    currentVersion,
    currentCommit: info?.commit ?? undefined,
    branch: info?.branch ?? undefined,
  };
  publish({ ...base, phase: "checking", repo: loadUpdateRepo() ?? DEFAULT_UPDATE_REPOS[0] }, onProgress);

  const managed = await packageManagedInstall();
  if (managed) {
    pending = null;
    return publish({ ...base, phase: "idle", packageManaged: managed }, onProgress);
  }

  // Signed builds carry a Tauri updater feed; take it when it has something.
  let nativeError: string | undefined;
  try {
    const update = await check();
    if (update) {
      pending = { channel: "native", update };
      announceUpdateAvailable(update.version);
      return publish(
        {
          ...base,
          phase: "available",
          channel: "native",
          availableVersion: update.version,
          notes: update.body?.trim() || undefined,
          installable: true,
        },
        onProgress,
      );
    }
  } catch (err) {
    if (!isUpdaterNotConfiguredError(err) && !isTargetMissingError(err)) {
      nativeError = errorText(err);
    }
  }

  let result: UpdateCheck;
  try {
    result = await invoke<UpdateCheck>("self_update_check", {
      repo: loadUpdateRepo(),
      sourceDir: loadUpdateSourceDir(),
    });
  } catch (err) {
    pending = null;
    return publish(
      { ...base, phase: "error", error: nativeError ?? errorText(err) },
      onProgress,
    );
  }

  const described = describeCheck(result, base);
  pending = described.pending;
  if (described.pending?.channel === "release") {
    announceUpdateAvailable(described.pending.release.version);
  }
  return publish(described.snapshot, onProgress);
}

/**
 * Checks every feed. `manual` (menu, Settings) opens the update dialog so the
 * result is always visible; automatic checks stay silent.
 */
export async function runUpdateFlow(
  manual = false,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  if (manual) openUpdateDialog();
  if (isUpdateBusy(snapshot)) {
    onProgress?.(snapshot);
    return snapshot;
  }
  if (!inFlight) {
    inFlight = performCheck(onProgress).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }
  const result = await inFlight;
  onProgress?.(result);
  return result;
}

/** Automatic launch check; resolves with the available version, if any. */
export async function probeForUpdate(): Promise<{ version: string } | null> {
  const result = await runUpdateFlow(false);
  return result.phase === "available" && result.availableVersion
    ? { version: result.availableVersion }
    : null;
}

// --- Installing

function stagePhase(stage: string): UpdaterPhase {
  switch (stage) {
    case "downloading":
      return "downloading";
    case "installing":
      return "installing";
    case "relaunching":
      return "relaunching";
    default:
      return "building";
  }
}

async function followProgress(
  base: UpdaterSnapshot,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UnlistenFn> {
  try {
    return await listen<Progress>("self-update-progress", ({ payload }) => {
      publish(
        {
          ...base,
          phase: stagePhase(payload.stage),
          detail: payload.message,
          progress: payload.progress ?? undefined,
          error: undefined,
        },
        onProgress,
      );
    });
  } catch {
    return () => {};
  }
}

async function installNative(
  update: Update,
  base: UpdaterSnapshot,
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  let downloaded = 0;
  let contentLength = 0;
  publish({ ...base, phase: "downloading", availableVersion: update.version, progress: 0 }, onProgress);
  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      }
      publish(
        {
          ...base,
          phase: event.event === "Finished" ? "installing" : "downloading",
          availableVersion: update.version,
          progress:
            contentLength > 0
              ? Math.min(100, Math.round((downloaded / contentLength) * 100))
              : undefined,
        },
        onProgress,
      );
    });
    rememberInstalledUpdate(update.version);
    pending = null;
    publish({ ...base, phase: "relaunching", progress: undefined }, onProgress);
    await relaunch();
    return { phase: "current", currentVersion: update.version };
  } catch (err) {
    openUpdateDialog();
    return publish(
      {
        ...base,
        phase: "error",
        availableVersion: update.version,
        error: `Couldn't install the update. ${errorText(err)}`,
      },
      onProgress,
    );
  }
}

/** Installs whatever the last check found, then relaunches into it. */
export async function installPendingUpdate(
  onProgress?: (snapshot: UpdaterSnapshot) => void,
): Promise<UpdaterSnapshot> {
  const currentVersion = await readAppVersion();
  const job = pending;
  if (!job) {
    return publish(
      { phase: "idle", currentVersion, currentCommit: snapshot.currentCommit },
      onProgress,
    );
  }
  if (isUpdateBusy(snapshot)) return snapshot;
  const base: UpdaterSnapshot = { ...snapshot, currentVersion, error: undefined };

  if (job.channel === "native") return installNative(job.update, base, onProgress);

  if (base.installable === false) {
    if (job.channel === "release") {
      await openUrl(job.release.htmlUrl).catch(() => undefined);
    } else {
      openUpdateDialog();
    }
    return snapshot;
  }

  const stop = await followProgress(base, onProgress);
  try {
    publish(
      {
        ...base,
        phase: job.channel === "release" ? "downloading" : "building",
        progress: job.channel === "release" ? 0 : undefined,
        detail: undefined,
      },
      onProgress,
    );
    const bundle =
      job.channel === "release"
        ? await invoke<string>("self_update_install_release", {
            repo: job.release.repo,
            asset: job.release.asset,
          })
        : await invoke<string>("self_update_install_source", {
            sourceDir: loadUpdateSourceDir(),
          });
    rememberInstalledUpdate(
      job.channel === "release" ? job.release.version : (job.source.version ?? currentVersion),
    );
    pending = null;
    stop();
    publish(
      { ...base, phase: "relaunching", progress: undefined, detail: `Installed ${bundle}` },
      onProgress,
    );
    await invoke("self_update_relaunch", { bundle });
    return snapshot;
  } catch (err) {
    stop();
    openUpdateDialog();
    return publish({ ...base, phase: "error", error: errorText(err) }, onProgress);
  }
}

/** Test helper: forget the shared state between cases. */
export function resetUpdaterForTests() {
  snapshot = { phase: "idle", currentVersion: "…" };
  pending = null;
  inFlight = null;
  buildInfo = null;
  identity = null;
  dialogOpen = false;
}
