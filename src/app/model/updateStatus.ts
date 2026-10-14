import { formatVersion } from "./appVersion";
import type { UpdaterSnapshot } from "./updater";

function commits(count: number | undefined): string {
  const n = count ?? 0;
  return `${n} new commit${n === 1 ? "" : "s"}`;
}

/** One-line status for the dialog title area, Settings, and the sidebar. */
export function updateHeadline(snapshot: UpdaterSnapshot): string {
  const available = formatVersion(snapshot.availableVersion);
  switch (snapshot.phase) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return `Irgatos is up to date at ${formatVersion(snapshot.currentVersion)}`;
    case "available":
      if (snapshot.channel === "source") {
        const bump =
          snapshot.availableVersion && snapshot.availableVersion !== snapshot.currentVersion
            ? ` (${available})`
            : "";
        return `${commits(snapshot.newCommits)} on ${snapshot.branch ?? "your branch"}${bump}`;
      }
      return `Irgatos ${available} is available`;
    case "downloading":
      return `Downloading ${available}${snapshot.progress != null ? ` ${snapshot.progress}%` : "…"}`;
    case "installing":
      return `Installing ${available}…`;
    case "building":
      return "Building from source…";
    case "relaunching":
      return "Relaunching…";
    case "error":
      return snapshot.availableVersion ? "Update failed" : "Couldn't check for updates";
    case "idle":
      return snapshot.packageManaged
        ? "Updates come from your package manager"
        : "Irgatos checks GitHub Releases and your source checkout";
  }
}

/** Label for the main action, or null when there is nothing to start. */
export function updateActionLabel(snapshot: UpdaterSnapshot): string | null {
  if (snapshot.phase !== "available") return null;
  if (snapshot.installable === false) {
    return snapshot.channel === "release" ? "Open release page" : null;
  }
  return snapshot.channel === "source" ? "Rebuild & Relaunch" : "Update & Relaunch";
}
