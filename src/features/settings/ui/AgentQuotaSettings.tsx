import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "../../../shared/ui/icons";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { HARNESS_TITLE } from "../../sessions/model/session";
import {
  loginHarness,
  supportsHarnessLogin,
} from "../../../integrations/harness/core/auth";
import {
  loadRateLimits,
  useCachedRateLimits,
} from "../../providers/model/rateLimitsCache";
import type { ProviderRateLimits } from "../../providers/model/rateLimits";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  selectedProviderAccountId,
  subscribeProviderAccounts,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { readProviderAccountIdentity } from "../../providers/model/providerAccountIdentity";
import { useShowRemainingUsage } from "../model/displayPrefs";
import {
  formatMeterReset,
  formatRefreshedAt,
  meterTone,
  QUOTA_PROVIDERS,
  QUOTA_SIGN_IN_COMMAND,
  QUOTA_STATE_LABEL,
  quotaFacts,
  quotaMeters,
  quotaState,
  quotaStateMessage,
  type MeterTone,
  type QuotaMeter,
  type QuotaProvider,
  type QuotaState,
} from "../model/agentQuotas";

const CLOCK_MS = 30_000;

const STATE_DOT: Record<QuotaState, string> = {
  checking: "animate-pulse bg-content/25",
  ok: "bg-emerald-400",
  "not-installed": "bg-content/20",
  "not-signed-in": "bg-amber-400",
  unsupported: "bg-content/20",
  error: "bg-red-400",
};

const STATE_TEXT: Record<QuotaState, string> = {
  checking: "text-content/40",
  ok: "text-content/55",
  "not-installed": "text-content/40",
  "not-signed-in": "text-amber-500 dark:text-amber-300",
  unsupported: "text-content/40",
  error: "text-red-400",
};

const METER_FILL: Record<MeterTone, string> = {
  ok: "bg-accent",
  low: "bg-amber-400",
  exhausted: "bg-red-400",
};

function isAccountProvider(
  provider: QuotaProvider,
): provider is ProviderAccountProvider {
  return (PROVIDER_ACCOUNT_PROVIDERS as readonly string[]).includes(provider);
}

/** The account the footer would use outside any project. */
function quotaAccountId(provider: QuotaProvider): string {
  return isAccountProvider(provider)
    ? selectedProviderAccountId(provider, undefined)
    : DEFAULT_PROVIDER_ACCOUNT_ID;
}

function quotaAccountLabel(
  provider: QuotaProvider,
  accountId: string,
): string | null {
  if (!isAccountProvider(provider) || accountId === DEFAULT_PROVIDER_ACCOUNT_ID)
    return null;
  return (
    providerAccounts(provider).find((account) => account.id === accountId)
      ?.label ?? null
  );
}

/**
 * Plan limits for every agent CLI, read from the CLIs' own sign-ins. Rows
 * render from the shared usage cache, so a slow CLI never holds up the page.
 */
export function AgentQuotaSettings() {
  const [, setAccountsVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const accountIds = Object.fromEntries(
    QUOTA_PROVIDERS.map((provider) => [provider, quotaAccountId(provider)]),
  ) as Record<QuotaProvider, string>;
  const accountKey = QUOTA_PROVIDERS.map((p) => accountIds[p]).join("|");

  useEffect(
    () =>
      subscribeProviderAccounts(() => setAccountsVersion((value) => value + 1)),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const provider of QUOTA_PROVIDERS) {
      void loadRateLimits(provider, accountIds[provider]);
    }
    // accountKey captures every account id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  const [refreshingAll, setRefreshingAll] = useState(false);
  const refreshAll = useCallback(() => {
    setRefreshingAll(true);
    void Promise.allSettled(
      QUOTA_PROVIDERS.map((provider) =>
        loadRateLimits(provider, accountIds[provider], true),
      ),
    ).finally(() => {
      setRefreshingAll(false);
      setNow(Date.now());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  return (
    <section data-setting-id="agent-usage" className="pt-0">
      <div className="flex items-end gap-4 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-content">
            Plan limits
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            Read from each CLI you are already signed in to. Numbers come
            straight from the provider; nothing here is estimated.
          </p>
        </div>
        <div className="shrink-0 pb-0.5">
          <SecondaryButton
            disabled={refreshingAll}
            onClick={refreshAll}
            aria-label="Refresh all usage limits"
          >
            <RefreshCw
              className={`size-3.5 ${refreshingAll ? "animate-spin" : ""}`}
              strokeWidth={1.75}
              aria-hidden
            />
            Refresh all
          </SecondaryButton>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-content/10 bg-content/3">
        {QUOTA_PROVIDERS.map((provider) => (
          <QuotaRow
            key={provider}
            provider={provider}
            accountId={accountIds[provider]}
            now={now}
          />
        ))}
      </div>
    </section>
  );
}

function QuotaRow({
  provider,
  accountId,
  now,
}: {
  provider: QuotaProvider;
  accountId: string;
  now: number;
}) {
  const limits = useCachedRateLimits(provider, accountId);
  const state = quotaState(limits);
  const meters = quotaMeters(limits);
  const facts = quotaFacts(limits);
  const message = quotaStateMessage(provider, state, limits);
  const plan = usePlanName(provider, accountId, limits);
  const accountLabel = quotaAccountLabel(provider, accountId);
  const fetching = limits.status === "fetching";
  const [signIn, setSignIn] = useState<"idle" | "running">("idle");
  const [signInError, setSignInError] = useState<string | null>(null);

  const refresh = () => void loadRateLimits(provider, accountId, true);
  const startSignIn = async () => {
    setSignIn("running");
    setSignInError(null);
    try {
      await (accountId === DEFAULT_PROVIDER_ACCOUNT_ID
        ? loginHarness(provider)
        : loginHarness(provider, accountId));
      await loadRateLimits(provider, accountId, true);
    } catch (error) {
      setSignInError(
        error instanceof Error ? error.message : "Could not complete sign-in",
      );
    } finally {
      setSignIn("idle");
    }
  };

  return (
    <div
      className="flex items-start gap-3 border-b border-content/5 px-4 py-3.5 last:border-b-0"
      data-quota-provider={provider}
      data-quota-state={state}
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-content/[0.05] ring-1 ring-inset ring-content/[0.06]">
        <HarnessIcon harness={provider} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium text-content">
            {HARNESS_TITLE[provider]}
          </span>
          {plan ? (
            <span className="rounded bg-content/[0.07] px-1.5 text-[10px] leading-4 text-content/60">
              {plan}
            </span>
          ) : null}
          {accountLabel ? (
            <span className="max-w-[10rem] truncate text-[11px] text-content/40">
              {accountLabel}
            </span>
          ) : null}
          <span
            className={`ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px] ${STATE_TEXT[state]}`}
          >
            <span
              className={`size-1.5 rounded-full ${STATE_DOT[state]}`}
              aria-hidden
            />
            {fetching && meters.length > 0
              ? "Refreshing…"
              : QUOTA_STATE_LABEL[state]}
          </span>
        </div>

        {message ? (
          <p className="mt-1 text-[12px] leading-relaxed text-content/45">
            {meters.length > 0 && state === "error"
              ? `Showing the last result. ${message}`
              : message}
          </p>
        ) : null}

        {state === "not-signed-in" ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {supportsHarnessLogin(provider) ? (
              <SecondaryButton
                disabled={signIn === "running"}
                onClick={() => void startSignIn()}
              >
                {signIn === "running" ? "Waiting for sign-in…" : "Sign in"}
              </SecondaryButton>
            ) : null}
            <code className="rounded bg-content/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-content/55">
              {QUOTA_SIGN_IN_COMMAND[provider]}
            </code>
          </div>
        ) : null}
        {signInError ? (
          <p className="mt-1 text-[11px] text-red-400" role="alert">
            {signInError}
          </p>
        ) : null}

        {meters.length > 0 ? (
          <div className="mt-2.5 grid gap-x-6 gap-y-2.5 @min-[560px]/settings:grid-cols-2">
            {meters.map((meter) => (
              <QuotaMeterBar
                key={meter.key}
                provider={provider}
                meter={meter}
                now={now}
              />
            ))}
          </div>
        ) : state === "checking" ? (
          <div className="mt-2.5 grid gap-x-6 gap-y-2.5 @min-[560px]/settings:grid-cols-2">
            <div className="h-6 animate-pulse rounded bg-content/[0.05]" />
            <div className="h-6 animate-pulse rounded bg-content/[0.05]" />
          </div>
        ) : null}

        {facts.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-content/50 tabular-nums">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </div>
        ) : null}

        <div
          className="mt-2 text-[10px] text-content/30"
          title={
            limits.updatedAt
              ? new Date(limits.updatedAt).toLocaleString()
              : undefined
          }
        >
          {formatRefreshedAt(limits.updatedAt, now)}
        </div>
      </div>
      <button
        type="button"
        disabled={fetching}
        onClick={refresh}
        aria-label={`Refresh ${HARNESS_TITLE[provider]} usage`}
        title="Refresh"
        className="grid size-7 shrink-0 place-items-center rounded-md text-content/40 transition-transform duration-150 hover:bg-content/10 hover:text-content active:scale-[0.96] disabled:opacity-40"
      >
        <RefreshCw
          className={`size-3.5 ${fetching ? "animate-spin" : ""}`}
          strokeWidth={1.75}
        />
      </button>
    </div>
  );
}

function QuotaMeterBar({
  provider,
  meter,
  now,
}: {
  provider: QuotaProvider;
  meter: QuotaMeter;
  now: number;
}) {
  const showRemaining = useShowRemainingUsage();
  const used = meter.usedPercent;
  const shown = Math.round(showRemaining ? 100 - used : used);
  const reset =
    formatMeterReset(meter.resetsAt, now) ?? `${meter.windowLabel} window`;
  return (
    <div
      title={
        meter.resetsAt == null
          ? undefined
          : `Resets ${new Date(meter.resetsAt).toLocaleString()}`
      }
    >
      <div className="flex items-baseline justify-between gap-2 text-[11px] leading-4">
        <span className="min-w-0 truncate text-content/60">
          {meter.label}
          <span className="text-content/35"> · {reset}</span>
        </span>
        <span className="shrink-0 tabular-nums text-content/70">
          {shown}% {showRemaining ? "left" : "used"}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-content/10"
        role="progressbar"
        aria-label={`${HARNESS_TITLE[provider]} ${meter.label} limit ${showRemaining ? "remaining" : "used"}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${METER_FILL[meterTone(used)]}`}
          style={{ width: `${showRemaining ? 100 - used : used}%` }}
        />
      </div>
    </div>
  );
}

/** Plan or tier the provider reported, never guessed. */
function usePlanName(
  provider: QuotaProvider,
  accountId: string,
  limits: ProviderRateLimits,
): string | null {
  const [identityPlan, setIdentityPlan] = useState<string | null>(null);
  const reads = isAccountProvider(provider) && limits.status !== "fetching";

  useEffect(() => {
    if (!reads || !isAccountProvider(provider)) return;
    let cancelled = false;
    void readProviderAccountIdentity(provider, accountId).then((identity) => {
      if (!cancelled) setIdentityPlan(identity?.plan?.trim() || null);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, accountId, reads, limits.updatedAt]);

  if (provider === "cursor") return limits.cursor?.plan ?? null;
  if (provider === "opencode") return limits.status === "ok" ? "OpenCode Go" : null;
  return identityPlan;
}
