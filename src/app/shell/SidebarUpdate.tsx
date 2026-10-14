import { ArrowDownCircle, Loader } from "../../shared/ui/icons";
import { useCallback, useRef } from "react";
import { formatVersion, shortCommit, shortVersion } from "../model/appVersion";
import {
  installPendingUpdate,
  isUpdateBusy,
  openUpdateDialog,
  type UpdaterSnapshot,
} from "../model/updater";
import { updateHeadline } from "../model/updateStatus";
import { useAppBuild, useAutomaticUpdateCheck, useUpdater } from "../model/useUpdater";
import type { InstalledUpdate } from "../model/updateNotice";
import { UpdateRailCard } from "./UpdateRailCard";

// The sidebar row only earns its space when there is something to act on: an
// update waiting to be installed, or one already in progress. Every other
// phase — including a probe that failed — stays silent, because manual "Check
// for updates" already lives in Settings and the app menu.
export function isSidebarUpdateActionable(snapshot: UpdaterSnapshot): boolean {
  return snapshot.phase === "available" || isUpdateBusy(snapshot);
}

export function SidebarUpdateFooter({
  update,
  onOpenWhatsNew,
  onDismissUpdate,
}: {
  update?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
}) {
  const snapshot = useUpdater();
  // The automatic check runs whether or not it ends up rendering anything, so
  // a newly published version still surfaces on its own.
  useAutomaticUpdateCheck();

  const card =
    update && onOpenWhatsNew && onDismissUpdate ? (
      <UpdateRailCard
        update={update}
        onOpen={onOpenWhatsNew}
        onDismiss={onDismissUpdate}
      />
    ) : null;
  const actionable = isSidebarUpdateActionable(snapshot);

  if (!card && !actionable) return null;

  // The gap down to the Settings block belongs to that block's own padding, so
  // the footer can disappear without leaving the sidebar's bottom row flush
  // against the scrolling list above it.
  return (
    <div className="flex flex-col gap-1.5 p-2 pb-0">
      {card}
      {actionable ? <SidebarUpdate snapshot={snapshot} /> : null}
    </div>
  );
}

function sidebarLabel(snapshot: UpdaterSnapshot): string {
  if (snapshot.phase !== "available") return updateHeadline(snapshot);
  if (snapshot.channel === "source") {
    const count = snapshot.newCommits ?? 0;
    return `Rebuild with ${count} new commit${count === 1 ? "" : "s"}`;
  }
  return `Update to ${snapshot.availableVersion}`;
}

export function SidebarUpdate({
  snapshot,
  onSnapshot,
}: {
  snapshot: UpdaterSnapshot;
  onSnapshot?: (next: UpdaterSnapshot) => void;
}) {
  const busy = isUpdateBusy(snapshot);
  // `busy` only flips after installPendingUpdate awaits readAppVersion, so a
  // second click can still land. The ref closes that window immediately.
  const installing = useRef(false);

  const onClick = useCallback(async () => {
    if (busy || installing.current) return;
    installing.current = true;
    openUpdateDialog();
    try {
      await installPendingUpdate(onSnapshot);
    } finally {
      installing.current = false;
    }
  }, [busy, onSnapshot]);

  return (
    <button
      type="button"
      onClick={busy ? openUpdateDialog : onClick}
      aria-disabled={busy || undefined}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
        busy
          ? "bg-content/5 text-content/75 hover:bg-content/10 hover:text-content"
          : "bg-accent/15 text-content hover:bg-accent/20"
      }`}
    >
      <span className="grid size-[18px] shrink-0 place-items-center">
        {busy ? (
          <Loader className="size-4 animate-spin opacity-70" aria-hidden />
        ) : (
          <ArrowDownCircle className="size-4 text-accent" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1 flex items-center">
        <span className="block truncate text-[12px] font-medium leading-tight">
          {sidebarLabel(snapshot)}
        </span>
        <span className="ml-auto block shrink-0 pl-2 text-[11px] text-content/40">
          {formatVersion(snapshot.currentVersion)}
        </span>
      </span>
    </button>
  );
}

/** Subtle `v0.1` next to the Settings row; the tooltip has the full build. */
export function AppVersionBadge() {
  const build = useAppBuild();
  if (build.currentVersion === "…") return null;
  const commit = shortCommit(build.currentCommit);
  return (
    <span
      className="shrink-0 rounded px-1 font-mono text-[10px] leading-4 text-content/35"
      title={`Irgatos ${formatVersion(build.currentVersion)}${commit ? ` (${commit})` : ""}`}
    >
      {shortVersion(build.currentVersion)}
    </span>
  );
}
