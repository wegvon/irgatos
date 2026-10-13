import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({
  live: 0,
  maxLive: 0,
  spawned: [] as string[],
  installed: new Set(["claude", "codex", "cursor", "opencode"]),
}));

function resolver(name: string) {
  return async () => {
    if (!child.installed.has(name)) throw new Error(`${name} not found`);
    return { path: `/bin/${name}` };
  };
}

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  homeDir: async () => "/home/test",
}));
vi.mock("../../../integrations/harness/core/child", () => ({
  resolveCodexBinary: async () => ({ path: "/bin/codex" }),
  resolveClaudeBinary: resolver("claude"),
  resolveCursorBinary: resolver("cursor"),
  resolveOpenCodeBinary: resolver("opencode"),
  inspectHarnessBinary: async () => ({
    path: "/bin/devin",
    version: "devin 3000.6.7 (260a97c8)",
  }),
  spawnChild: async (
    _id: string,
    _path: string,
    _args: string[],
    _cwd: string,
    account: { id: string },
  ) => {
    child.live += 1;
    child.maxLive = Math.max(child.maxLive, child.live);
    child.spawned.push(account.id);
  },
  watchChild: () => undefined,
  unwatchChild: () => {
    child.live = Math.max(0, child.live - 1);
  },
  killChild: async () => undefined,
}));
vi.mock("../../../integrations/harness/core/jsonRpc", () => ({
  JsonRpcClient: class {
    close() {}
    pushLine() {}
    respond() {
      return Promise.resolve();
    }
    notify() {
      return Promise.resolve();
    }
    async request(method: string) {
      if (method !== "account/rateLimits/read") return {};
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        rateLimits: {
          primary: { usedPercent: 10, windowDurationMins: 300 },
        },
      };
    }
  },
}));

import { invoke } from "@tauri-apps/api/core";
import {
  cachedDevinIdentity,
  cursorRateLimitsFromFetch,
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
  fetchCursorRateLimits,
  fetchDevinRateLimits,
  fetchOpencodeGoRateLimits,
} from "./rateLimitsFetch";
import { withProbeTimeout } from "./rateLimitsCache";
import { idleRateLimits } from "./rateLimits";

beforeEach(() => {
  child.installed = new Set(["claude", "codex", "cursor", "opencode"]);
  vi.mocked(invoke).mockReset();
});

const cursorOk = {
  status: "ok",
  httpStatus: 200,
  usage: {
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
  },
};

describe("fetchCursorRateLimits", () => {
  it("passes the resolved CLI to the host and maps the billing cycle", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(cursorOk);
    const limits = await fetchCursorRateLimits();
    expect(invoke).toHaveBeenLastCalledWith("fetch_cursor_usage", {
      command: "/bin/cursor",
      binaryPath: null,
    });
    expect(limits.status).toBe("ok");
    expect(limits.monthly).toEqual({
      usedPercent: 62,
      windowMinutes: 44_640,
      resetsAt: 1_793_491_200_000,
    });
    expect(limits.cursor).toEqual({
      plan: "Pro",
      autoPercentUsed: 12.5,
      apiPercentUsed: 49.5,
      includedUsed: 12.4,
      includedLimit: 20,
      onDemandUsed: 0,
      onDemandLimit: 50,
    });
  });

  it("reports a missing CLI as not installed without calling the host", async () => {
    child.installed.delete("cursor");
    const limits = await fetchCursorRateLimits();
    expect(invoke).not.toHaveBeenCalled();
    expect(limits.status).toBe("unavailable");
    expect(limits.reason).toBe("not-installed");
  });

  it("keeps the host's reason and drops unknown ones", () => {
    expect(
      cursorRateLimitsFromFetch({
        status: "unavailable",
        reason: "not-signed-in",
        error: "Cursor CLI is not signed in. Run `agent login`.",
      }).reason,
    ).toBe("not-signed-in");
    expect(
      cursorRateLimitsFromFetch({ status: "unavailable", reason: "surprise" })
        .reason,
    ).toBeNull();
  });

  it("fails closed on malformed results and host errors", async () => {
    expect(
      cursorRateLimitsFromFetch({
        status: "ok",
        usage: { planPercentUsed: Number.NaN },
      }).status,
    ).toBe("error");
    expect(cursorRateLimitsFromFetch({ status: "ok" }).status).toBe("error");
    expect(cursorRateLimitsFromFetch({ status: "weird" }).status).toBe("error");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("command not found"));
    const limits = await fetchCursorRateLimits();
    expect(limits.status).toBe("error");
    expect(limits.error).toBe("command not found");
  });
});

describe("unavailable reasons", () => {
  it("tells a missing Claude CLI apart from a signed-out one", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: "unavailable",
      error: "Claude not signed in",
    });
    expect((await fetchClaudeRateLimits()).reason).toBe("not-signed-in");
    child.installed.delete("claude");
    expect((await fetchClaudeRateLimits()).reason).toBe("not-installed");
  });

  it("treats OpenCode without a Go subscription as unsupported", async () => {
    vi.mocked(invoke).mockResolvedValue({
      status: "unavailable",
      error: "No OpenCode Go subscription",
    });
    expect((await fetchOpencodeGoRateLimits()).reason).toBe("unsupported");
    child.installed.delete("opencode");
    expect((await fetchOpencodeGoRateLimits()).reason).toBe("not-installed");
  });
});

describe("withProbeTimeout", () => {
  it("turns a hung probe into an error", async () => {
    const hung = new Promise<never>(() => undefined);
    const limits = await withProbeTimeout("cursor", hung, 10);
    expect(limits.status).toBe("error");
    expect(limits.error).toBe("Usage check timed out");
  });

  it("passes a prompt result through", async () => {
    const value = { ...idleRateLimits("claude"), status: "ok" as const };
    expect(await withProbeTimeout("claude", Promise.resolve(value), 1000)).toBe(
      value,
    );
  });
});

describe("fetchDevinRateLimits", () => {
  const signedIn = {
    status: "ok",
    httpStatus: 200,
    usage: { name: "Ada", email: "ada@example.com", plan: "Pro", weeklyRemainingPercent: 42 },
  };

  it("sends the installed CLI's version and keeps the identity it returns", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(signedIn);
    const limits = await fetchDevinRateLimits();
    expect(invoke).toHaveBeenLastCalledWith("fetch_devin_usage", { cliVersion: "3000.6.7" });
    expect(limits.weekly?.usedPercent).toBe(58);
    expect(cachedDevinIdentity()).toEqual({ name: "Ada", email: "ada@example.com", plan: "Pro" });
  });

  it("forgets the identity when the key is rejected, not on a network failure", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(signedIn);
    await fetchDevinRateLimits();
    vi.mocked(invoke).mockResolvedValueOnce({ status: "error", error: "Devin usage request failed: timeout" });
    await fetchDevinRateLimits();
    expect(cachedDevinIdentity()?.email).toBe("ada@example.com");
    vi.mocked(invoke).mockResolvedValueOnce({
      status: "error",
      httpStatus: 401,
      error: "Devin sign-in expired",
    });
    const limits = await fetchDevinRateLimits();
    expect(limits.status).toBe("error");
    expect(cachedDevinIdentity()).toBeNull();
  });
});

describe("fetchCodexRateLimits", () => {
  beforeEach(() => {
    child.live = 0;
    child.maxLive = 0;
    child.spawned = [];
  });

  it("runs usage probes for different accounts one at a time", async () => {
    const results = await Promise.all([
      fetchCodexRateLimits("default"),
      fetchCodexRateLimits("account-work"),
      fetchCodexRateLimits("account-personal"),
    ]);

    expect(child.maxLive).toBe(1);
    expect(child.spawned).toEqual([
      "default",
      "account-work",
      "account-personal",
    ]);
    expect(results.map((result) => result.session?.usedPercent)).toEqual([
      10, 10, 10,
    ]);
  });
});
