import { openUrl } from "@tauri-apps/plugin-opener";
import { formatVersion, shortCommit } from "../model/appVersion";
import { updateActionLabel, updateHeadline } from "../model/updateStatus";
import {
  closeUpdateDialog,
  installPendingUpdate,
  isUpdateBusy,
  runUpdateFlow,
  type UpdaterSnapshot,
} from "../model/updater";
import { useUpdateDialogOpen, useUpdater } from "../model/useUpdater";
import { Modal } from "../../shared/ui/Modal";
import { SecondaryButton } from "../../shared/ui/SecondaryButton";
import {
  AlertCircle,
  ArrowDownCircle,
  CheckCircle,
  Loader,
  RefreshCw,
} from "../../shared/ui/icons";

export function UpdateDialog({
  onOpenWhatsNew,
}: {
  onOpenWhatsNew?: (version: string) => void;
}) {
  const open = useUpdateDialogOpen();
  const snapshot = useUpdater();
  if (!open) return null;
  return (
    <Modal title="Software Update" size="sm" onClose={closeUpdateDialog}>
      <UpdateDialogBody snapshot={snapshot} onOpenWhatsNew={onOpenWhatsNew} />
    </Modal>
  );
}

function StatusIcon({ snapshot }: { snapshot: UpdaterSnapshot }) {
  if (snapshot.phase === "checking" || isUpdateBusy(snapshot)) {
    return <Loader className="size-5 animate-spin text-content/60" aria-hidden />;
  }
  if (snapshot.phase === "available") {
    return <ArrowDownCircle className="size-5 text-accent" aria-hidden />;
  }
  if (snapshot.phase === "error") {
    return <AlertCircle className="size-5 text-red-400" aria-hidden />;
  }
  if (snapshot.phase === "current") {
    return <CheckCircle className="size-5 text-emerald-500" aria-hidden />;
  }
  return <RefreshCw className="size-5 text-content/50" strokeWidth={1.75} aria-hidden />;
}

function VersionLine({
  label,
  version,
  commit,
  extra,
}: {
  label: string;
  version: string;
  commit?: string;
  extra?: string;
}) {
  const short = shortCommit(commit);
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="w-16 shrink-0 text-content/45">{label}</span>
      <span className="font-mono text-content">{formatVersion(version)}</span>
      {short ? (
        <span className="font-mono text-content/45" title={commit}>
          {short}
        </span>
      ) : null}
      {extra ? <span className="min-w-0 truncate text-content/45">{extra}</span> : null}
    </div>
  );
}

export function UpdateDialogBody({
  snapshot,
  onOpenWhatsNew,
}: {
  snapshot: UpdaterSnapshot;
  onOpenWhatsNew?: (version: string) => void;
}) {
  const busy = snapshot.phase === "checking" || isUpdateBusy(snapshot);
  const action = updateActionLabel(snapshot);
  const showAvailable =
    snapshot.availableVersion != null &&
    (snapshot.phase === "available" || isUpdateBusy(snapshot) || snapshot.phase === "error");

  const onAction = () => {
    void installPendingUpdate();
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-2">
      <div className="flex items-start gap-3" role="status" aria-live="polite">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center">
          <StatusIcon snapshot={snapshot} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-snug text-content">
            {updateHeadline(snapshot)}
          </p>
          {snapshot.phase === "error" && snapshot.error ? (
            <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-red-400/90">
              {snapshot.error}
            </p>
          ) : null}
          {snapshot.note && !busy ? (
            <p className="mt-1 text-[12px] leading-relaxed text-content/50">{snapshot.note}</p>
          ) : null}
          {snapshot.phase === "idle" && snapshot.packageManaged ? (
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-content/50">
              Download the newer package from GitHub Releases and install it with apt or dnf.
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-lg bg-content/5 px-3 py-2">
        <VersionLine
          label="Installed"
          version={snapshot.currentVersion}
          commit={snapshot.currentCommit}
          extra={snapshot.channel !== "source" ? snapshot.branch : undefined}
        />
        {showAvailable ? (
          <VersionLine
            label={snapshot.channel === "source" ? "Source" : "Available"}
            version={snapshot.availableVersion!}
            commit={snapshot.availableCommit}
            extra={
              snapshot.channel === "source"
                ? snapshot.branch
                : snapshot.repo
                  ? `on ${snapshot.repo}`
                  : undefined
            }
          />
        ) : null}
      </div>

      {snapshot.phase === "downloading" ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-content/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={snapshot.progress}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${snapshot.progress ?? 0}%` }}
          />
        </div>
      ) : null}
      {busy && snapshot.detail ? (
        <p
          className="truncate font-mono text-[11px] text-content/45"
          title={snapshot.detail}
        >
          {snapshot.detail}
        </p>
      ) : null}
      {snapshot.phase === "building" ? (
        <p className="text-[11px] text-content/40">
          You can close this window; Irgatos relaunches when the build is installed.
        </p>
      ) : null}

      {snapshot.phase === "available" && snapshot.notes ? (
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-content/8 px-3 py-2 text-[12px] leading-relaxed text-content/70">
          {snapshot.notes}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex min-w-0 items-center gap-2">
          {snapshot.releaseUrl && !busy ? (
            <button
              type="button"
              onClick={() => void openUrl(snapshot.releaseUrl!).catch(() => undefined)}
              className="truncate text-[12px] text-content/50 underline-offset-2 hover:text-content hover:underline"
            >
              {snapshot.phase === "available" ? "Release notes" : "All releases"}
            </button>
          ) : null}
          {snapshot.phase === "current" && onOpenWhatsNew ? (
            <button
              type="button"
              onClick={() => {
                closeUpdateDialog();
                onOpenWhatsNew(snapshot.currentVersion);
              }}
              className="truncate text-[12px] text-content/50 underline-offset-2 hover:text-content hover:underline"
            >
              What's new
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action ? (
            <>
              <SecondaryButton onClick={closeUpdateDialog}>Later</SecondaryButton>
              <button
                type="button"
                onClick={onAction}
                className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-on-accent hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {action}
              </button>
            </>
          ) : busy ? (
            <SecondaryButton onClick={closeUpdateDialog}>Hide</SecondaryButton>
          ) : (
            <>
              <SecondaryButton onClick={() => void runUpdateFlow(true)}>
                <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
                Check again
              </SecondaryButton>
              <SecondaryButton onClick={closeUpdateDialog}>Done</SecondaryButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
