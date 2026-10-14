import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { AgentQuotaSettings } from "../../src/features/settings/ui/AgentQuotaSettings";
import { setCachedRateLimits } from "../../src/features/providers/model/rateLimitsCache";
import {
  parseCodexRateLimits,
  unavailableRateLimits,
} from "../../src/features/providers/model/rateLimits";
import "../../src/styles/index.css";

// The real Settings section over fixture outputs of each provider's usage
// source. `?state=populated` signs every CLI in; `?state=empty` covers the
// rows that have no numbers to show.
const state = new URLSearchParams(location.search).get("state") ?? "populated";
const now = Date.now();
const HOUR = 3_600_000;
const iso = (offset: number) => new Date(now + offset).toISOString();

const claudeBody = JSON.stringify({
  five_hour: { utilization: 34, resets_at: iso(2 * HOUR + 10 * 60_000) },
  seven_day: { utilization: 61, resets_at: iso(3 * 24 * HOUR + 4 * HOUR) },
});

const cursorUsage = {
  plan: "Pro",
  planPercentUsed: 62,
  autoPercentUsed: 12.5,
  apiPercentUsed: 49.5,
  includedUsedCents: 1240,
  includedLimitCents: 2000,
  onDemandUsedCents: 0,
  onDemandLimitCents: 5000,
  billingCycleStartMs: now - 12 * 24 * HOUR,
  billingCycleEndMs: now + 18 * 24 * HOUR + 6 * HOUR,
};

const opencodeBody = JSON.stringify({
  usage: {
    rolling: { status: "ok", percent: 8, resetsAt: iso(4 * HOUR) },
    weekly: { status: "ok", percent: 27, resetsAt: iso(5 * 24 * HOUR) },
    monthly: { status: "rate-limited", percent: 100, resetsAt: iso(9 * 24 * HOUR) },
  },
});

mockWindows("main");
mockIPC((cmd, args) => {
  const populated = state === "populated";
  if (cmd.startsWith("harness_resolve_")) {
    const provider = cmd.slice("harness_resolve_".length);
    if (!populated && provider === "devin") throw new Error("not found");
    return { path: `/usr/local/bin/${provider}` };
  }
  if (cmd === "harness_exec") return "devin 3000.6.7 (260a97c8)";
  if (cmd === "provider_account_identity") {
    const provider = (args as { provider: string }).provider;
    return populated
      ? { plan: provider === "claude" ? "Max" : "Plus", email: null }
      : null;
  }
  if (cmd === "fetch_claude_usage") {
    return populated
      ? { status: "ok", httpStatus: 200, body: claudeBody }
      : { status: "unavailable", error: "Claude not signed in" };
  }
  if (cmd === "fetch_cursor_usage") {
    return populated
      ? { status: "ok", httpStatus: 200, usage: cursorUsage }
      : {
          status: "unavailable",
          reason: "unsupported",
          error:
            "Cursor reports plan usage only for `agent login` sign-ins, not API keys.",
        };
  }
  if (cmd === "fetch_opencode_go_usage") {
    return populated
      ? { status: "ok", httpStatus: 200, body: opencodeBody }
      : { status: "unavailable", httpStatus: 403, error: "No OpenCode Go subscription" };
  }
  if (cmd === "fetch_devin_usage") {
    return {
      status: "ok",
      httpStatus: 200,
      usage: {
        plan: "Pro",
        dailyRemainingPercent: 70,
        dailyResetsAt: Math.floor((now + 9 * HOUR) / 1000),
        weeklyRemainingPercent: 45,
        weeklyResetsAt: Math.floor((now + 4 * 24 * HOUR) / 1000),
      },
    };
  }
  return null;
});

// Codex usage arrives over its app-server JSON-RPC, so its fixture result is
// cached directly instead of through a mocked child process.
setCachedRateLimits(
  "codex",
  "default",
  state === "populated"
    ? parseCodexRateLimits({
        rateLimits: {
          primary: {
            usedPercent: 12,
            windowDurationMins: 300,
            resetsAt: Math.floor((now + 3 * HOUR) / 1000),
          },
          secondary: {
            usedPercent: 47,
            windowDurationMins: 10_080,
            resetsAt: Math.floor((now + 6 * 24 * HOUR) / 1000),
          },
        },
        rateLimitResetCredits: { availableCount: 1 },
      })
    : unavailableRateLimits("codex", "Codex not signed in", "not-signed-in"),
);

createRoot(document.getElementById("root")!).render(
  <div className="@container/settings h-full overflow-y-auto bg-background text-content">
    <div className="mx-auto w-full max-w-5xl px-5 py-6 pb-16 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8">
      <header className="pb-4">
        <h1 className="text-[20px] font-semibold leading-tight text-content">
          Usage
        </h1>
        <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-content/45">
          Plan limits and what is left for each agent CLI, read from the CLIs
          you are signed in to.
        </p>
      </header>
      <AgentQuotaSettings />
    </div>
  </div>,
);
