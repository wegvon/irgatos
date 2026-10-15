import { useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  loadVoiceSettings,
  subscribeVoiceSettings,
} from "../../voice/model/voiceSettings";
import {
  checkServices,
  checkedAgo,
  chipText,
  createServiceStatusStore,
  overallState,
  serviceIds,
  serviceLabel,
  stateLine,
  type ServiceState,
} from "../model/serviceStatus";

const store = createServiceStatusStore(checkServices, () =>
  serviceIds(loadVoiceSettings()),
);

// A voice change adds or drops a service, so check again right away.
if (typeof window !== "undefined") {
  subscribeVoiceSettings(() => void store.refresh());
}

const DOT: Record<ServiceState, string> = {
  online: "bg-emerald-500",
  slow: "bg-amber-500",
  offline: "bg-red-500",
};

const TEXT: Record<ServiceState, string> = {
  online: "text-content/40 hover:text-content",
  slow: "text-amber-600 dark:text-amber-300",
  offline: "text-red-600 dark:text-red-400",
};

/**
 * A dot in the bottom bar showing whether the remote services this app is
 * set to use (semantic search, Mail's Executor, the voice services) answer.
 * Hidden until one of them is configured.
 */
export function ServiceStatusChip() {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.get,
    store.get,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { statuses, checkedAt, checking } = snapshot;
  if (statuses.length === 0) return null;

  const state = overallState(statuses);
  const now = Date.now();
  const ago = checkedAt ? checkedAgo(checkedAt, now) : "";
  const title = [
    ...statuses.map(
      (s) => `${serviceLabel(s.id)} (${s.host}): ${stateLine(s)}`,
    ),
    ago ? `Checked ${ago}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1.5 hover:bg-content/10 ${TEXT[state]}`}
        aria-label={`Service status: ${chipText(statuses)}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={open ? undefined : title}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${DOT[state]} ${checking ? "animate-pulse" : ""}`}
          aria-hidden
        />
        <span>{chipText(statuses)}</span>
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align="end"
          gap={7}
          width={300}
          autoFocus
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label="Service status"
          tabIndex={-1}
          className="p-2 text-content"
        >
          <ul className="flex flex-col gap-1">
            {statuses.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[12px]"
              >
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${DOT[s.state]}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{serviceLabel(s.id)}</span>
                  <span className="block truncate text-[11px] text-content/45">
                    {s.host}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-[11px] tabular-nums ${
                    s.state === "online" ? "text-content/55" : TEXT[s.state]
                  }`}
                >
                  {stateLine(s)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center justify-between border-t border-stroke px-1.5 pt-1.5 text-[11px] text-content/45">
            <span>{ago ? `Checked ${ago} · every minute` : "Checking…"}</span>
            <button
              type="button"
              className="inline-flex h-5 items-center gap-1 rounded px-1.5 hover:bg-content/10 hover:text-content disabled:opacity-50"
              disabled={checking}
              onClick={() => void store.refresh()}
            >
              <RefreshCw
                className={`size-2.5 ${checking ? "animate-spin" : ""}`}
                strokeWidth={1.75}
                aria-hidden
              />
              Check now
            </button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
