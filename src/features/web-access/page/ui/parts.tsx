import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { FleetBucket } from "../../../fleet/model/fleet";
import type { HarnessId } from "../../../sessions/model/session";
import { HarnessIcon } from "../../../sessions/ui/HarnessIcon";
import { LoaderCircle } from "../../../../shared/ui/icons";

/** The page's few colors. Each sets `--tint` for `.tinted`, `.tone-*` and ticks. */
export const TONE = {
  orange: "[--tint:var(--tone-orange)]",
  purple: "[--tint:var(--tone-purple)]",
  green: "[--tint:var(--tone-green)]",
  red: "[--tint:var(--tone-red)]",
  blue: "[--tint:var(--tone-blue)]",
  pink: "[--tint:var(--tone-pink)]",
  teal: "[--tint:var(--tone-teal)]",
  yellow: "[--tint:var(--tone-yellow)]",
  gray: "[--tint:var(--tone-gray)]",
} as const;
export type Tone = keyof typeof TONE;

export const BUCKET_TONE: Record<FleetBucket, Tone> = {
  needsYou: "orange",
  interrupted: "red",
  review: "green",
  running: "purple",
  idle: "gray",
};

export const BUCKET_PILL: Record<FleetBucket, string> = {
  needsYou: "Needs you",
  interrupted: "Interrupted",
  review: "To review",
  running: "Running",
  idle: "Idle",
};

/** A small rounded label with a colored dot: "● High", "● Running". */
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
      <span
        className={`tone-dot size-1.5 rounded-full ${live ? "web-pulse text-(--tint)" : ""}`}
      />
      {children}
    </span>
  );
}

/** A tinted circle holding an icon, as on the stat cards. */
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
      className={`${TONE[tone]} tone-soft flex shrink-0 items-center justify-center rounded-full ${size}`}
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
  return (
    <span
      aria-hidden
      className={`${TONE[BUCKET_TONE[bucket]]} relative inline-flex size-2.5 shrink-0 text-(--tint) ${className}`}
    >
      <span
        className={`size-2.5 rounded-full bg-current ${bucket === "running" || bucket === "needsYou" ? "web-pulse" : ""}`}
      />
    </span>
  );
}

/** Progress as a row of ticks; `value` is 0-1, or null while it is unknown. */
export function Ticks({
  value,
  tone = "purple",
  className = "",
}: {
  value: number | null;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`${TONE[tone]} ticks block ${value === null ? "ticks-live" : ""} ${className}`}
      style={
        value === null
          ? undefined
          : ({ "--value": Math.max(0, Math.min(1, value)) } as CSSProperties)
      }
    />
  );
}

/** The four-point sparkle that stands for Irgatos and its agents. */
export function SparkleGlyph({ className = "size-6" }: { className?: string }) {
  // Each glyph owns its gradient: a shared id breaks once the first copy unmounts.
  const id = `sparkle${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b49bff" />
          <stop offset="0.55" stopColor="#7357ff" />
          <stop offset="1" stopColor="#5a3df0" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M12 1.8c.5 0 .9.33 1.03.8l.95 3.5a6.2 6.2 0 0 0 4.38 4.37l3.5.95a1.07 1.07 0 0 1 0 2.06l-3.5.95a6.2 6.2 0 0 0-4.38 4.37l-.95 3.5a1.07 1.07 0 0 1-2.06 0l-.95-3.5a6.2 6.2 0 0 0-4.38-4.37l-3.5-.95a1.07 1.07 0 0 1 0-2.06l3.5-.95A6.2 6.2 0 0 0 10.02 6.1l.95-3.5c.13-.47.53-.8 1.03-.8Z"
      />
    </svg>
  );
}

/** The sparkle in its white bubble, for empty states and the assistant. */
export function SparkleBubble({
  size = "size-16",
  glyph = "size-8",
}: {
  size?: string;
  glyph?: string;
}) {
  return (
    <span
      className={`sparkle-bubble flex shrink-0 items-center justify-center rounded-full ${size}`}
    >
      <SparkleGlyph className={glyph} />
    </span>
  );
}

/** "✦ Irgatos" in the top left of every screen. */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[18px] font-semibold tracking-[-0.01em] text-(--ink)">
      <SparkleGlyph className="size-[22px]" />
      Irgatos
    </span>
  );
}

/** A white round button for the header: back, bell, close. */
export function RoundButton({
  label,
  onClick,
  children,
  dot = false,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`glass web-press relative flex size-10 shrink-0 items-center justify-center rounded-full text-(--ink) ${className}`}
    >
      {children}
      {dot ? (
        <span className="absolute right-[9px] top-[9px] size-2 rounded-full bg-(--tone-red) ring-2 ring-white" />
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
          <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-white/80 px-1.5 text-[12px] font-semibold tabular-nums text-(--ink-2) shadow-[inset_0_0_0_1px_var(--hairline)]">
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

export const primaryButton =
  "accent-fill web-press inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold disabled:opacity-40 disabled:shadow-none";
export const secondaryButton =
  "glass web-press inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold text-(--ink) disabled:opacity-40";
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
      <div className="mb-5">{icon ?? <SparkleBubble />}</div>
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
                ? "bg-(--tone-red) text-white shadow-lg shadow-red-900/20"
                : "glass-float text-(--ink)"
            }`}
          >
            {toast.tone === "error" ? null : (
              <SparkleGlyph className="size-4 shrink-0" />
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
