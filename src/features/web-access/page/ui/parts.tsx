import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { FleetBucket } from "../../../fleet/model/fleet";
import type { HarnessId } from "../../../sessions/model/session";
import { HarnessIcon } from "../../../sessions/ui/HarnessIcon";
import { LoaderCircle } from "../../../../shared/ui/icons";

export const BUCKET_COLOR: Record<FleetBucket, string> = {
  needsYou: "text-(--warn)",
  interrupted: "text-(--bad)",
  review: "text-(--ok)",
  running: "text-(--accent)",
  idle: "text-content/30",
};

export function StatusDot({
  bucket,
  className = "",
}: {
  bucket: FleetBucket;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex size-2.5 shrink-0 ${BUCKET_COLOR[bucket]} ${className}`}
    >
      <span
        className={`size-2.5 rounded-full bg-current ${bucket === "running" || bucket === "needsYou" ? "web-pulse" : ""}`}
      />
    </span>
  );
}

export function Harness({
  harness,
  className = "size-3.5",
}: {
  harness: HarnessId;
  className?: string;
}) {
  return (
    <span className="inline-flex shrink-0 text-content/70">
      <HarnessIcon harness={harness} className={className} />
    </span>
  );
}

export function SectionTitle({
  children,
  count,
  action,
  id,
}: {
  children: ReactNode;
  count?: number;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div
      id={id}
      className="flex scroll-mt-4 items-baseline justify-between px-1 pb-2"
    >
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-content/45">
        {children}
        {count != null ? (
          <span className="ml-1.5 font-medium text-content/30">{count}</span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

/** An inset grouped list, iOS Settings style. */
export function Group({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-stroke overflow-hidden rounded-[18px] bg-(--surface) shadow-[0_0_0_0.5px_var(--color-stroke)]">
      {children}
    </div>
  );
}

export const primaryButton =
  "web-press inline-flex h-11 items-center justify-center gap-2 rounded-[14px] bg-(--accent) px-5 text-[15px] font-semibold text-white disabled:opacity-40";
export const secondaryButton =
  "web-press inline-flex h-11 items-center justify-center gap-2 rounded-[14px] bg-selection px-5 text-[15px] font-semibold text-content active:bg-selection-hover disabled:opacity-40";
export const plainButton =
  "web-press inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-[15px] font-medium text-(--accent) disabled:opacity-40";

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <LoaderCircle className={`animate-spin ${className}`} />;
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-8 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-(--surface) text-content/45 shadow-[0_0_0_0.5px_var(--color-stroke)]">
        {icon}
      </div>
      <div className="text-[17px] font-semibold">{title}</div>
      {children ? (
        <div className="mt-1.5 max-w-[30ch] text-[15px] leading-snug text-content/50">
          {children}
        </div>
      ) : null}
    </div>
  );
}

type Toast = { id: number; text: string; tone: "info" | "error" };

const ToastContext = createContext<
  (text: string, tone?: Toast["tone"]) => void
>(() => {});

export const useToast = () => useContext(ToastContext);

/** Short notes at the top: what an action did, or why it failed. */
export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++next.current;
    setToasts((current) => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      tone === "error" ? 4500 : 2200,
    );
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+8px)] z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`web-pop-in max-w-md rounded-full px-4 py-2.5 text-[14px] font-medium shadow-lg shadow-black/25 ${
              toast.tone === "error"
                ? "bg-(--bad) text-white"
                : "web-bar text-content shadow-[0_0_0_0.5px_var(--color-stroke)]"
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Runs an action once at a time and reports its failure as a toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, action: () => Promise<T>, done?: string) => {
      setBusy(key);
      try {
        const result = await action();
        if (done) toast(done);
        return result;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

/** The Mac's clock, ticking locally between polls. */
export function useNow(macAt: number | undefined): number {
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (macAt) setOffset(macAt - Date.now());
  }, [macAt]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return Date.now() + offset;
}
