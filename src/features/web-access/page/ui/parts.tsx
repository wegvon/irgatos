import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { FleetBucket } from "../../../fleet/model/fleet";
import { LABEL_STYLES, type LabelColor } from "../../../ideas/model/ideas";
import type { HarnessId } from "../../../sessions/model/session";
import { HarnessIcon } from "../../../sessions/ui/HarnessIcon";
import { Check, CircleAlert, LoaderCircle } from "../../../../shared/ui/icons";

/** The desktop's status colors. Each sets `--tint` for `.tone-*` and bars. */
export const TONE = {
  amber: "[--tint:var(--tone-amber)]",
  rose: "[--tint:var(--tone-rose)]",
  emerald: "[--tint:var(--tone-emerald)]",
  accent: "[--tint:var(--tone-accent)]",
  muted: "[--tint:var(--tone-muted)]",
} as const;
export type Tone = keyof typeof TONE;

/** As in the desktop's Fleet view. */
export const BUCKET_TONE: Record<FleetBucket, Tone> = {
  needsYou: "amber",
  interrupted: "rose",
  review: "accent",
  running: "muted",
  idle: "muted",
};

export const BUCKET_PILL: Record<FleetBucket, string> = {
  needsYou: "Needs you",
  interrupted: "Interrupted",
  review: "To review",
  running: "Running",
  idle: "Idle",
};

/** A status chip: "● Needs you", or a spinner while it runs. */
export function Pill({
  tone,
  children,
  live = false,
  className = "",
}: {
  tone: Tone;
  children: ReactNode;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`${TONE[tone]} tone-soft inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold ${className}`}
    >
      {live ? (
        <LoaderCircle className="size-3 animate-spin" strokeWidth={2.2} />
      ) : (
        <span className="tone-dot size-1.5 rounded-full" />
      )}
      {children}
    </span>
  );
}

/** An idea label in the desktop board's own colors. */
export function LabelChip({
  color,
  children,
}: {
  color: LabelColor;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[12px] font-medium ${LABEL_STYLES[color]}`}
    >
      {children}
    </span>
  );
}

/** A quiet square holding an icon; the icon carries the tone. */
export function IconBadge({
  tone,
  children,
  size = "size-9",
}: {
  tone: Tone;
  children: ReactNode;
  size?: string;
}) {
  return (
    <span
      className={`${TONE[tone]} tone-text flex shrink-0 items-center justify-center rounded-xl bg-content/6 ${size}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  bucket,
  className = "",
}: {
  bucket: FleetBucket;
  className?: string;
}) {
  if (bucket === "running")
    return (
      <LoaderCircle
        aria-hidden
        className={`size-3 shrink-0 animate-spin text-(--ink-3) ${className}`}
      />
    );
  return (
    <span
      aria-hidden
      className={`${TONE[BUCKET_TONE[bucket]]} tone-dot inline-flex size-2 shrink-0 rounded-full ${className}`}
    />
  );
}

/** A thin progress bar; `value` is 0-1. */
export function Ticks({
  value,
  tone = "accent",
  className = "",
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`${TONE[tone]} ticks block ${className}`}
      style={{ "--value": Math.max(0, Math.min(1, value)) } as CSSProperties}
    />
  );
}

/** The Irgatos mark, as on the desktop's splash screen. */
export function BrandMark({ className = "size-6" }: { className?: string }) {
  return (
    <img
      src="/irgat.png"
      alt=""
      aria-hidden
      draggable={false}
      className={`shrink-0 select-none ${className}`}
    />
  );
}

/** The mark and name in the top left of every screen. */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-(--ink)">
      <BrandMark className="size-6 rounded-md" />
      Irgatos
    </span>
  );
}

/** A round header button: back, close. */
export function RoundButton({
  label,
  onClick,
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`web-press relative flex size-10 shrink-0 items-center justify-center rounded-full bg-content/8 text-(--ink) ${className}`}
    >
      {children}
    </button>
  );
}

/** The desktop's amber count of chats waiting on you; tap to see them. */
export function NeedsYouButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={count ? `${count} waiting on you` : "Nothing waiting"}
      onClick={onClick}
      className="web-press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-content/8 px-3 text-[14px] font-semibold text-(--ink)"
    >
      <CircleAlert
        className={`size-[18px] ${count ? "text-(--tone-amber)" : "text-(--ink-3)"}`}
      />
      {count ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[12px] font-semibold tabular-nums text-black">
          {count}
        </span>
      ) : null}
    </button>
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
    <span className="inline-flex shrink-0 text-(--ink-2)">
      <HarnessIcon harness={harness} className={className} />
    </span>
  );
}

/** A section's title row: "Needs you  3" with an optional action. */
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
      className="flex scroll-mt-4 items-center justify-between gap-3 px-1 pb-2.5"
    >
      <h2 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-(--ink)">
        {children}
        {count != null ? (
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-content/8 px-1.5 text-[12px] font-semibold tabular-nums text-(--ink-2)">
            {count}
          </span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

/** A frosted card that holds a list; rows divide with a hairline. */
export function Group({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`glass divide-y divide-(--hairline) overflow-hidden rounded-[24px] ${className}`}
    >
      {children}
    </div>
  );
}

/** The desktop's solid primary action: white on dark, ink on light, or the accent. */
export const primaryButton =
  "primary-action web-press inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold";
export const secondaryButton =
  "web-press inline-flex h-12 items-center justify-center gap-2 rounded-full bg-content/8 px-6 text-[15px] font-semibold text-(--ink) disabled:opacity-40";
export const plainButton =
  "web-press inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-3.5 text-[15px] font-semibold text-(--accent) disabled:opacity-40";

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <LoaderCircle className={`animate-spin ${className}`} />;
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <div className="mb-5">
        {icon ?? <BrandMark className="size-14 rounded-2xl opacity-80" />}
      </div>
      <div className="text-[19px] font-semibold tracking-[-0.01em]">
        {title}
      </div>
      {children ? (
        <div className="mt-1.5 max-w-[30ch] text-[15px] leading-snug text-(--ink-2)">
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
      <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+10px)] z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`web-pop-in flex max-w-md items-center gap-2 rounded-full px-4 py-2.5 text-[14px] font-semibold ${
              toast.tone === "error"
                ? "bg-rose-500 text-white shadow-lg shadow-black/20"
                : "glass-float text-(--ink)"
            }`}
          >
            {toast.tone === "error" ? null : (
              <Check className="size-4 shrink-0 text-(--tone-emerald)" />
            )}
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
