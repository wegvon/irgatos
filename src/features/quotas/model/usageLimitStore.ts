import {
  selectedProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import type { HarnessId } from "../../sessions/model/session";
import {
  DEFAULT_ACCOUNT,
  DEFAULT_USAGE_LIMIT_FALLBACK_MS,
  UsageLimitRegistry,
} from "./usageLimitRegistry";

const FALLBACK_KEY = "irgat.usageLimitFallbackMinutes";
export const USAGE_LIMIT_FALLBACK_CHANGE_EVENT =
  "irgat:usage-limit-fallback-change";

/** Choices for how long to hold when the provider gives no reset time. */
export const USAGE_LIMIT_FALLBACK_OPTIONS = [15, 30, 60, 120, 300] as const;
export const USAGE_LIMIT_FALLBACK_DEFAULT_MINUTES =
  DEFAULT_USAGE_LIMIT_FALLBACK_MS / 60_000;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadUsageLimitFallbackMinutes(): number {
  const raw = Number(browserStorage()?.getItem(FALLBACK_KEY));
  return Number.isFinite(raw) && raw >= 1 && raw <= 24 * 60
    ? raw
    : USAGE_LIMIT_FALLBACK_DEFAULT_MINUTES;
}

export function saveUsageLimitFallbackMinutes(minutes: number): void {
  try {
    browserStorage()?.setItem(FALLBACK_KEY, String(minutes));
  } catch {
    return;
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(USAGE_LIMIT_FALLBACK_CHANGE_EVENT));
}

export function subscribeUsageLimitFallback(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(USAGE_LIMIT_FALLBACK_CHANGE_EVENT, onChange);
  return () =>
    window.removeEventListener(USAGE_LIMIT_FALLBACK_CHANGE_EVENT, onChange);
}

/** The app's one registry, persisted so a hold survives a restart. */
export const usageLimitRegistry = new UsageLimitRegistry({
  storage: browserStorage(),
  fallbackMs: () => loadUsageLimitFallbackMinutes() * 60_000,
});

/**
 * The account a hold is filed under: the session's own, else the project's
 * selected profile for providers with accounts, else the CLI's one login.
 */
export function holdAccountId(
  harness: HarnessId,
  providerAccountId: string | undefined,
  cwd: string | undefined,
): string {
  if (!supportsProviderAccounts(harness)) return DEFAULT_ACCOUNT;
  return providerAccountId ?? selectedProviderAccountId(harness, cwd);
}
