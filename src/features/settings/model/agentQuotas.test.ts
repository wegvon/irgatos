import { describe, expect, it } from "vitest";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  parseCursorUsage,
  parseDevinUsage,
  unavailableRateLimits,
} from "../../providers/model/rateLimits";
import {
  formatMeterReset,
  formatRefreshedAt,
  meterTone,
  quotaFacts,
  quotaMeters,
  quotaState,
  quotaStateMessage,
} from "./agentQuotas";

const NOW = Date.UTC(2026, 9, 13, 20, 0, 0);

const claudeBody = JSON.stringify({
  five_hour: { utilization: 34, resets_at: "2026-10-13T22:10:00Z" },
  seven_day: { utilization: 61.4, resets_at: "2026-10-17T08:00:00Z" },
  seven_day_opus: null,
});

const codexResult = {
  rateLimits: {
    primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_791_936_000 },
    secondary: { usedPercent: 47, windowDurationMins: 10_080, resetsAt: 1_792_454_400 },
  },
  rateLimitResetCredits: { availableCount: 1 },
};

describe("quotaState", () => {
  it("separates every state a row can be in", () => {
    expect(quotaState(idleRateLimits("claude"))).toBe("checking");
    expect(quotaState(fetchingRateLimits("claude"))).toBe("checking");
    expect(quotaState(parseClaudeOAuthUsage(claudeBody))).toBe("ok");
    expect(
      quotaState(unavailableRateLimits("cursor", "x", "not-installed")),
    ).toBe("not-installed");
    expect(
      quotaState(unavailableRateLimits("codex", "x", "not-signed-in")),
    ).toBe("not-signed-in");
    expect(quotaState(unavailableRateLimits("opencode", "x", "unsupported"))).toBe(
      "unsupported",
    );
    expect(quotaState(errorRateLimits("cursor", "offline"))).toBe("error");
  });

  it("never shows an ok row without numbers", () => {
    expect(quotaState(parseClaudeOAuthUsage("{}"))).toBe("unsupported");
  });

  it("treats an unexplained unavailable result as not exposed", () => {
    expect(quotaState(unavailableRateLimits("claude", "removed account"))).toBe(
      "unsupported",
    );
  });

  it("keeps the last numbers visible behind a refresh error", () => {
    const stale = errorRateLimits(
      "claude",
      "Claude usage request failed (500)",
      parseClaudeOAuthUsage(claudeBody),
    );
    expect(quotaState(stale)).toBe("error");
    expect(quotaMeters(stale)).toHaveLength(2);
  });
});

describe("quotaMeters", () => {
  it("lists Claude's 5-hour and weekly windows as reported", () => {
    const meters = quotaMeters(parseClaudeOAuthUsage(claudeBody));
    expect(meters.map(({ key, label, usedPercent }) => [key, label, usedPercent])).toEqual([
      ["session", "5-hour", 34],
      ["weekly", "Weekly", 61.4],
    ]);
    expect(meters[0]?.resetsAt).toBe(Date.parse("2026-10-13T22:10:00Z"));
  });

  it("lists Codex windows and its reset credits", () => {
    const limits = parseCodexRateLimits(codexResult);
    expect(quotaMeters(limits).map((meter) => meter.label)).toEqual([
      "5-hour",
      "Weekly",
    ]);
    expect(quotaFacts(limits)).toEqual(["1 limit reset available"]);
  });

  it("calls Devin's short window daily", () => {
    const limits = parseDevinUsage({
      dailyRemainingPercent: 70,
      weeklyRemainingPercent: 40,
      extraUsageBalanceMicros: -1_670_000,
    });
    expect(quotaMeters(limits).map((meter) => [meter.label, meter.usedPercent])).toEqual([
      ["Daily", 30],
      ["Weekly", 60],
    ]);
    expect(quotaFacts(limits)).toEqual(["Extra usage balance $-1.67"]);
  });

  it("shows Cursor's billing cycle with its spend", () => {
    const limits = parseCursorUsage({
      plan: "Pro",
      planPercentUsed: 62,
      autoPercentUsed: 12.5,
      apiPercentUsed: 49.5,
      includedUsedCents: 1240,
      includedLimitCents: 2000,
      onDemandUsedCents: 0,
      onDemandLimitCents: 5000,
      billingCycleStartMs: 1_790_812_800_000,
      billingCycleEndMs: 1_793_491_200_000,
    });
    expect(quotaMeters(limits)).toEqual([
      {
        key: "monthly",
        label: "Billing cycle",
        usedPercent: 62,
        windowLabel: "31d",
        resetsAt: 1_793_491_200_000,
      },
    ]);
    expect(quotaFacts(limits)).toEqual([
      "$12.40 of $20.00 included usage",
      "Auto 13% · API 50%",
      "On-demand $0.00 of $50.00",
    ]);
  });

  it("shows on-demand spend without a limit only when there is some", () => {
    expect(
      quotaFacts(parseCursorUsage({ planPercentUsed: 5, onDemandUsedCents: 0 })),
    ).toEqual([]);
    expect(
      quotaFacts(parseCursorUsage({ planPercentUsed: 5, onDemandUsedCents: 731 })),
    ).toEqual(["On-demand $7.31 used"]);
  });

  it("omits Cursor figures it did not receive", () => {
    const limits = parseCursorUsage({ planPercentUsed: 5 });
    expect(quotaMeters(limits)[0]?.resetsAt).toBeNull();
    expect(quotaFacts(limits)).toEqual([]);
    expect(limits.cursor?.plan).toBeNull();
  });
});

describe("quotaStateMessage", () => {
  it("explains each empty state per provider", () => {
    const limits = unavailableRateLimits("opencode", "No OpenCode Go subscription", "unsupported");
    expect(quotaStateMessage("opencode", "unsupported", limits)).toMatch(
      /OpenCode Go subscription/,
    );
    expect(
      quotaStateMessage("codex", "not-installed", idleRateLimits("codex")),
    ).toBe("The Codex CLI isn't installed on this machine.");
    expect(
      quotaStateMessage(
        "cursor",
        "not-signed-in",
        unavailableRateLimits(
          "cursor",
          "Cursor rejected the CLI session. Run `agent login` again.",
          "not-signed-in",
        ),
      ),
    ).toMatch(/rejected/);
    expect(
      quotaStateMessage(
        "cursor",
        "unsupported",
        unavailableRateLimits(
          "cursor",
          "Cursor reports plan usage only for `agent login` sign-ins, not API keys.",
          "unsupported",
        ),
      ),
    ).toMatch(/not API keys/);
    expect(
      quotaStateMessage("claude", "ok", parseClaudeOAuthUsage(claudeBody)),
    ).toBeNull();
  });
});

describe("formatting", () => {
  it("formats reset and refresh times", () => {
    expect(formatMeterReset(null, NOW)).toBeNull();
    expect(formatMeterReset(NOW + 2 * 3_600_000 + 10 * 60_000, NOW)).toBe(
      "Resets in 2h 10m",
    );
    expect(formatMeterReset(NOW - 1, NOW)).toBe("Resets now");
    expect(formatRefreshedAt(0, NOW)).toBe("Not checked yet");
    expect(formatRefreshedAt(NOW - 10_000, NOW)).toBe("Updated just now");
    expect(formatRefreshedAt(NOW - 4 * 60_000, NOW)).toBe("Updated 4m ago");
    expect(formatRefreshedAt(NOW - 3 * 3_600_000, NOW)).toBe("Updated 3h ago");
    expect(formatRefreshedAt(NOW - 2 * 86_400_000, NOW)).toBe("Updated 2d ago");
  });

  it("colours meters by how much is used", () => {
    expect(meterTone(10)).toBe("ok");
    expect(meterTone(80)).toBe("low");
    expect(meterTone(100)).toBe("exhausted");
    expect(meterTone(Number.NaN)).toBe("ok");
  });
});
