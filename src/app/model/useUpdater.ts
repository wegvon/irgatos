import { useEffect, useSyncExternalStore } from "react";
import {
  getUpdaterSnapshot,
  isUpdateDialogOpen,
  loadCurrentBuild,
  runUpdateFlow,
  subscribeUpdateDialog,
  subscribeUpdater,
  type UpdaterSnapshot,
} from "./updater";

export function useUpdater(): UpdaterSnapshot {
  return useSyncExternalStore(subscribeUpdater, getUpdaterSnapshot, getUpdaterSnapshot);
}

export function useUpdateDialogOpen(): boolean {
  return useSyncExternalStore(subscribeUpdateDialog, isUpdateDialogOpen, isUpdateDialogOpen);
}

/** The running version and commit, loaded once per window. */
export function useAppBuild(): Pick<UpdaterSnapshot, "currentVersion" | "currentCommit" | "branch"> {
  const snapshot = useUpdater();
  useEffect(() => {
    void loadCurrentBuild();
  }, []);
  return {
    currentVersion: snapshot.currentVersion,
    currentCommit: snapshot.currentCommit,
    branch: snapshot.branch,
  };
}

let automaticCheckStarted = false;

/** One silent check per window, however many sidebars mount. */
export function useAutomaticUpdateCheck() {
  useEffect(() => {
    if (automaticCheckStarted) return;
    automaticCheckStarted = true;
    void runUpdateFlow(false).catch(() => undefined);
  }, []);
}
