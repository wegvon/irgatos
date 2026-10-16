import { invoke } from "@tauri-apps/api/core";
import type { VoiceSettings } from "../../voice/model/voiceSettings";

/** How often the bottom bar re-checks while the window is visible. */
export const POLL_MS = 60_000;
/** Coming back to the window re-checks when the last check is older. */
export const STALE_MS = 30_000;

export type ServiceState = "online" | "slow" | "offline";

export type ServiceStatus = {
  id: string;
  host: string;
  state: ServiceState;
  latencyMs: number | null;
  detail: string | null;
};

const LABEL: Record<string, string> = {
  embed: "Semantic search",
  executor: "Mail (Executor)",
  asr: "Transcription",
  "tts:drama": "Voice · Drama",
  "tts:ema": "Voice · EMA",
  "tts:kahya": "Voice · Kahya",
};

export const serviceLabel = (id: string) => LABEL[id] ?? id;

/**
 * The services this app is set to use. Semantic search and Mail are asked
 * for always; the app leaves them out until their endpoint is configured.
 */
export function serviceIds(
  voice: Pick<VoiceSettings, "engine" | "readReplies" | "speechProvider">,
): string[] {
  const ids = ["embed", "executor"];
  if (voice.engine === "qwen") ids.push("asr");
  if (voice.readReplies) ids.push(`tts:${voice.speechProvider}`);
  return ids;
}

export function checkServices(ids: string[]) {
  return invoke<ServiceStatus[]>("service_status_check", { ids });
}

const RANK: Record<ServiceState, number> = { online: 0, slow: 1, offline: 2 };

/** The worst state, which colors the chip. */
export function overallState(statuses: ServiceStatus[]): ServiceState {
  return statuses.reduce<ServiceState>(
    (worst, s) => (RANK[s.state] > RANK[worst] ? s.state : worst),
    "online",
  );
}

/** The chip's text: short when all is well, names the problem otherwise. */
export function chipText(statuses: ServiceStatus[]): string {
  const down = statuses.filter((s) => s.state === "offline");
  if (down.length === 1) return `${serviceLabel(down[0]!.id)} offline`;
  if (down.length > 1) return `${down.length} services offline`;
  const slow = statuses.filter((s) => s.state === "slow");
  if (slow.length === 1) return `${serviceLabel(slow[0]!.id)} slow`;
  if (slow.length > 1) return `${slow.length} services slow`;
  return "Services";
}

export function stateLine(status: ServiceStatus): string {
  switch (status.state) {
    case "online":
      return `Online · ${status.latencyMs ?? 0} ms`;
    case "slow":
      return `Slow · ${status.latencyMs ?? 0} ms`;
    case "offline":
      return status.detail ? `Offline · ${status.detail}` : "Offline";
  }
}

export function checkedAgo(checkedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export type ServiceSnapshot = {
  statuses: ServiceStatus[];
  checkedAt: number | null;
  checking: boolean;
};

/**
 * One poller for the whole app: every footer reads the same snapshot, and
 * checks run only while something is subscribed and the window is visible.
 */
export function createServiceStatusStore(
  check: (ids: string[]) => Promise<ServiceStatus[]>,
  ids: () => string[],
  clock: () => number = Date.now,
) {
  let snapshot: ServiceSnapshot = { statuses: [], checkedAt: null, checking: false };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> | null = null;

  const set = (patch: Partial<ServiceSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };

  const refresh = () => {
    if (inflight) return inflight;
    set({ checking: true });
    inflight = check(ids())
      .then((statuses) => set({ statuses, checkedAt: clock(), checking: false }))
      .catch(() => set({ checking: false }))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const visible = () =>
    typeof document === "undefined" || document.visibilityState !== "hidden";

  const tick = () => {
    if (visible()) void refresh();
  };

  const onVisible = () => {
    if (!visible()) return;
    if (snapshot.checkedAt == null || clock() - snapshot.checkedAt > STALE_MS)
      void refresh();
  };

  return {
    get: () => snapshot,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        onVisible();
        timer = setInterval(tick, POLL_MS);
        if (typeof document !== "undefined")
          document.addEventListener("visibilitychange", onVisible);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        if (timer) clearInterval(timer);
        timer = null;
        if (typeof document !== "undefined")
          document.removeEventListener("visibilitychange", onVisible);
      };
    },
  };
}
