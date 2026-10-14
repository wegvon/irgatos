import {
  clampUsedPercent,
  DAILY_WINDOW_MINUTES,
  formatResetDuration,
  formatWindowLabel,
  type ProviderRateLimits,
  type RateLimitProvider,
  type RateLimitWindow,
} from "../../providers/model/rateLimits";

/** Agents whose plan limits Settings shows, in display order. */
export const QUOTA_PROVIDERS = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "devin",
] as const satisfies readonly RateLimitProvider[];

export type QuotaProvider = (typeof QUOTA_PROVIDERS)[number];

export type QuotaState =
  | "checking"
  | "ok"
  | "not-installed"
  | "not-signed-in"
  | "unsupported"
  | "error";

export function quotaState(limits: ProviderRateLimits): QuotaState {
  switch (limits.status) {
    case "idle":
    case "fetching":
      return "checking";
    case "ok":
      return quotaMeters(limits).length > 0 ? "ok" : "unsupported";
    case "error":
      return "error";
    case "unavailable":
      return limits.reason ?? "unsupported";
  }
}

export const QUOTA_STATE_LABEL: Record<QuotaState, string> = {
  checking: "Checking…",
  ok: "Up to date",
  "not-installed": "Not installed",
  "not-signed-in": "Not signed in",
  unsupported: "Not exposed",
  error: "Couldn't refresh",
};

/** How each CLI is signed in to from a terminal, shown beside the state. */
export const QUOTA_SIGN_IN_COMMAND: Record<QuotaProvider, string> = {
  claude: "claude auth login",
  codex: "codex login",
  cursor: "agent login",
  opencode: "opencode auth login",
  devin: "devin auth login",
};

/** Plain-language reason a row shows no numbers, per provider and state. */
export function quotaStateMessage(
  provider: QuotaProvider,
  state: QuotaState,
  limits: ProviderRateLimits,
): string | null {
  switch (state) {
    case "checking":
    case "ok":
      return null;
    case "not-installed":
      return `The ${QUOTA_CLI_NAME[provider]} CLI isn't installed on this machine.`;
    case "not-signed-in":
      return provider === "cursor" && limits.error
        ? limits.error
        : `Sign in to the ${QUOTA_CLI_NAME[provider]} CLI to see its limits.`;
    case "unsupported":
      return QUOTA_UNSUPPORTED_MESSAGE[provider](limits);
    case "error":
      return limits.error || "The usage check failed.";
  }
}

const QUOTA_CLI_NAME: Record<QuotaProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  devin: "Devin",
};

const QUOTA_UNSUPPORTED_MESSAGE: Record<
  QuotaProvider,
  (limits: ProviderRateLimits) => string
> = {
  claude: () =>
    "Claude reports limits only for Claude.ai subscriptions, not API keys.",
  codex: () =>
    "Codex reports limits only for ChatGPT sign-ins. API-key sign-ins have no plan quota.",
  cursor: (limits) =>
    limits.error || "This Cursor CLI does not expose plan usage.",
  opencode: () =>
    "OpenCode has no plan quota of its own. Limits show here only with an OpenCode Go subscription.",
  devin: () => "Devin did not report a quota for this plan.",
};

export type QuotaMeter = {
  key: "session" | "weekly" | "monthly";
  label: string;
  usedPercent: number;
  windowLabel: string;
  resetsAt: number | null;
};

/** Every window the provider actually reported; nothing is inferred. */
export function quotaMeters(limits: ProviderRateLimits): QuotaMeter[] {
  const meter = (
    key: QuotaMeter["key"],
    label: string,
    window: RateLimitWindow | null,
  ): QuotaMeter | null =>
    window
      ? {
          key,
          label,
          usedPercent: clampUsedPercent(window.usedPercent),
          windowLabel: formatWindowLabel(window.windowMinutes),
          resetsAt: window.resetsAt,
        }
      : null;
  return [
    meter(
      "session",
      limits.session?.windowMinutes === DAILY_WINDOW_MINUTES
        ? "Daily"
        : "5-hour",
      limits.session,
    ),
    meter("weekly", "Weekly", limits.weekly),
    meter(
      "monthly",
      limits.provider === "cursor" ? "Billing cycle" : "Monthly",
      limits.monthly,
    ),
  ].filter((entry) => entry != null);
}

function formatDollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Secondary figures a provider reported alongside its windows. */
export function quotaFacts(limits: ProviderRateLimits): string[] {
  const facts: string[] = [];
  const cursor = limits.cursor;
  if (cursor) {
    if (cursor.includedUsed != null && cursor.includedLimit != null) {
      facts.push(
        `${formatDollars(cursor.includedUsed)} of ${formatDollars(cursor.includedLimit)} included usage`,
      );
    }
    if (cursor.autoPercentUsed != null || cursor.apiPercentUsed != null) {
      facts.push(
        [
          cursor.autoPercentUsed != null
            ? `Auto ${Math.round(clampUsedPercent(cursor.autoPercentUsed))}%`
            : null,
          cursor.apiPercentUsed != null
            ? `API ${Math.round(clampUsedPercent(cursor.apiPercentUsed))}%`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    }
    if (cursor.onDemandUsed != null && cursor.onDemandLimit != null) {
      facts.push(
        `On-demand ${formatDollars(cursor.onDemandUsed)} of ${formatDollars(cursor.onDemandLimit)}`,
      );
    } else if (cursor.onDemandUsed != null && cursor.onDemandUsed > 0) {
      facts.push(`On-demand ${formatDollars(cursor.onDemandUsed)} used`);
    }
  }
  if (limits.extraUsageBalance != null) {
    facts.push(`Extra usage balance ${formatDollars(limits.extraUsageBalance)}`);
  }
  const credits = limits.resetCredits?.availableCount ?? 0;
  if (credits > 0) {
    facts.push(`${credits} limit reset${credits === 1 ? "" : "s"} available`);
  }
  return facts;
}

/** "Resets in 2h 10m", or null when the provider gave no reset time. */
export function formatMeterReset(
  resetsAt: number | null,
  now: number,
): string | null {
  if (resetsAt == null) return null;
  const duration = formatResetDuration(resetsAt - now);
  return duration === "now" ? "Resets now" : `Resets in ${duration}`;
}

export function formatRefreshedAt(updatedAt: number, now: number): string {
  if (!updatedAt) return "Not checked yet";
  const elapsed = Math.max(0, now - updatedAt);
  if (elapsed < 60_000) return "Updated just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

export type MeterTone = "ok" | "low" | "exhausted";

export function meterTone(usedPercent: number): MeterTone {
  const used = clampUsedPercent(usedPercent);
  if (used >= 100) return "exhausted";
  if (used >= 80) return "low";
  return "ok";
}
