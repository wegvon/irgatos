import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "../../../platform/tauri/fs";
import {
  errorRateLimits,
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  parseCursorUsage,
  parseDevinUsage,
  parseOpencodeGoUsage,
  unavailableRateLimits,
  type CursorUsage,
  type DevinUsage,
  type ProviderRateLimits,
  type RateLimitUnavailableReason,
} from "./rateLimits";
import type { ProviderAccountIdentity } from "./providerAccountIdentity";
import {
  inspectHarnessBinary,
  killChild,
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveCursorBinary,
  resolveOpenCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../../integrations/harness/core/child";
import { asRecord } from "../../../integrations/harness/providers/codex/codexProtocol";
import { JsonRpcClient } from "../../../integrations/harness/core/jsonRpc";
import { runtimeProviderBinaryPath } from "./providerBinaryPaths";

const USAGE_CHILD_ID = "irgat-codex-usage";
const DISCOVERY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;

type OpencodeGoUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

/**
 * Fetch OpenCode Go 5h / weekly / monthly usage via the official API.
 * Runs through a Tauri command so the webview CORS policy does not apply.
 */
export async function fetchOpencodeGoRateLimits(): Promise<ProviderRateLimits> {
  let result: OpencodeGoUsageFetch;
  try {
    result = await invoke<OpencodeGoUsageFetch>("fetch_opencode_go_usage");
  } catch (error) {
    return errorRateLimits(
      "opencode",
      error instanceof Error
        ? error.message
        : "OpenCode Go usage unavailable",
    );
  }
  if (result.status === "ok" && result.body) {
    try {
      const parsed = parseOpencodeGoUsage(JSON.parse(result.body));
      if (parsed.session || parsed.weekly || parsed.monthly) return parsed;
    } catch {
      return errorRateLimits("opencode", "OpenCode Go response was not JSON");
    }
    // A 200 with no usable windows is malformed: report an error so the
    // footer retries instead of sticking in "unavailable" forever.
    return errorRateLimits(
      "opencode",
      "OpenCode Go usage response was unexpected",
    );
  }
  if (result.status === "unavailable") {
    return unavailableRateLimits(
      "opencode",
      result.error?.trim() || "OpenCode Go not connected",
      await reasonUnlessMissing(resolveOpenCodeBinary, "unsupported"),
    );
  }
  return errorRateLimits(
    "opencode",
    result.error?.trim() || "OpenCode Go usage unavailable",
  );
}

type DevinUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  usage?: DevinUsage | null;
  error?: string | null;
};

let devinIdentity: ProviderAccountIdentity | null = null;

/** Identity from the latest Devin usage read; Devin caches none on disk. */
export function cachedDevinIdentity(): ProviderAccountIdentity | null {
  return devinIdentity;
}

/**
 * Devin's API server reports the plan's daily and weekly quota. The request
 * names the installed CLI's version, read from the binary rather than pinned.
 */
export async function fetchDevinRateLimits(): Promise<ProviderRateLimits> {
  let cliVersion: string | undefined;
  try {
    const inspected = await inspectHarnessBinary("devin");
    cliVersion = /\d+(?:\.\d+)+/.exec(inspected.version ?? "")?.[0];
  } catch {
    return unavailableRateLimits("devin", "Devin CLI not found", "not-installed");
  }
  if (!cliVersion) return errorRateLimits("devin", "Devin CLI version unknown");
  let result: DevinUsageFetch;
  try {
    result = await invoke<DevinUsageFetch>("fetch_devin_usage", { cliVersion });
  } catch (error) {
    return errorRateLimits(
      "devin",
      error instanceof Error ? error.message : "Devin usage unavailable",
    );
  }
  if (result.status === "ok" && result.usage) {
    devinIdentity = {
      name: result.usage.name ?? null,
      email: result.usage.email ?? null,
      plan: result.usage.plan ?? null,
    };
    return parseDevinUsage(result.usage);
  }
  if (result.status === "unavailable") {
    devinIdentity = null;
    return unavailableRateLimits(
      "devin",
      result.error?.trim() || "Devin not signed in",
      "not-signed-in",
    );
  }
  // A rejected key means that account is no longer signed in; a network
  // failure keeps the identity beside the last usage snapshot.
  if (result.httpStatus === 401 || result.httpStatus === 403) devinIdentity = null;
  return errorRateLimits("devin", result.error?.trim() || "Devin usage unavailable");
}

/** `fallback`, or `not-installed` when the provider's CLI cannot be found. */
async function reasonUnlessMissing(
  resolve: () => Promise<unknown>,
  fallback: RateLimitUnavailableReason,
): Promise<RateLimitUnavailableReason> {
  try {
    await resolve();
    return fallback;
  } catch {
    return "not-installed";
  }
}

type CursorUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  reason?: string | null;
  httpStatus?: number | null;
  usage?: CursorUsage | null;
  error?: string | null;
};

const UNAVAILABLE_REASONS: readonly RateLimitUnavailableReason[] = [
  "not-installed",
  "not-signed-in",
  "unsupported",
];

/** Map a host usage result onto the shared snapshot; unknown shapes fail closed. */
export function cursorRateLimitsFromFetch(
  result: CursorUsageFetch,
): ProviderRateLimits {
  if (result.status === "ok" && result.usage) {
    const parsed = parseCursorUsage(result.usage);
    if (parsed.monthly) return parsed;
    return errorRateLimits("cursor", "Cursor usage response was unexpected");
  }
  if (result.status === "unavailable") {
    const reason = UNAVAILABLE_REASONS.find((value) => value === result.reason);
    return unavailableRateLimits(
      "cursor",
      result.error?.trim() || "Cursor usage unavailable",
      reason ?? null,
    );
  }
  return errorRateLimits(
    "cursor",
    result.error?.trim() || "Cursor usage unavailable",
  );
}

/**
 * Cursor's plan usage for the billing cycle. The host asks the signed-in
 * Cursor CLI for its session and reads Cursor's dashboard with it.
 */
export async function fetchCursorRateLimits(): Promise<ProviderRateLimits> {
  let command: string;
  try {
    command = (await resolveCursorBinary()).path;
  } catch {
    return unavailableRateLimits("cursor", "Cursor CLI not found", "not-installed");
  }
  try {
    return cursorRateLimitsFromFetch(
      await invoke<CursorUsageFetch>("fetch_cursor_usage", {
        command,
        binaryPath: runtimeProviderBinaryPath("cursor") ?? null,
      }),
    );
  } catch (error) {
    return errorRateLimits(
      "cursor",
      error instanceof Error ? error.message : "Cursor usage unavailable",
    );
  }
}

export type CodexRateLimitResetOutcome =
  "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";

type ClaudeUsageFetch = {
  status: "ok" | "error" | "unavailable" | string;
  httpStatus?: number | null;
  body?: string | null;
  error?: string | null;
};

export async function fetchClaudeRateLimits(
  accountId = "default",
): Promise<ProviderRateLimits> {
  try {
    const result = await invoke<ClaudeUsageFetch>("fetch_claude_usage", {
      accountId,
    });
    if (result.status === "ok" && result.body) {
      const parsed = parseClaudeOAuthUsage(result.body);
      if (parsed.session || parsed.weekly) return parsed;
      return {
        ...parsed,
        status: parsed.status === "ok" ? "ok" : parsed.status,
      };
    }
    if (result.status === "unavailable") {
      return unavailableRateLimits(
        "claude",
        result.error?.trim() || "Claude not signed in",
        await reasonUnlessMissing(resolveClaudeBinary, "not-signed-in"),
      );
    }
    return errorRateLimits(
      "claude",
      result.error?.trim() || "Claude usage unavailable",
    );
  } catch (error) {
    return errorRateLimits(
      "claude",
      error instanceof Error ? error.message : "Claude usage unavailable",
    );
  }
}

export async function fetchCodexRateLimits(
  accountId = "default",
): Promise<ProviderRateLimits> {
  let path: string;
  try {
    path = (await resolveCodexBinary()).path;
  } catch {
    return unavailableRateLimits("codex", "Codex CLI not found", "not-installed");
  }

  const cwd = await homeDir();
  try {
    const result = await requestCodexAccount<unknown>(
      path,
      cwd,
      "account/rateLimits/read",
      {},
      accountId,
    );
    const parsed = parseCodexRateLimits(result);
    if (parsed.session || parsed.weekly || parsed.monthly || parsed.resetCredits) {
      return parsed;
    }
    const rec = asRecord(result);
    if (rec && !parsed.session && !parsed.weekly) {
      return unavailableRateLimits(
        "codex",
        "Codex reports limits only for ChatGPT sign-ins",
        "unsupported",
      );
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not signed in|chatgpt authentication required|not authenticated/i.test(
        message,
      )
    ) {
      return unavailableRateLimits(
        "codex",
        "Codex not signed in",
        "not-signed-in",
      );
    }
    if (/ENOENT|not found|could not run/i.test(message)) {
      return unavailableRateLimits(
        "codex",
        "Codex CLI not found",
        "not-installed",
      );
    }
    return errorRateLimits("codex", message);
  }
}

export async function consumeCodexRateLimitResetCredit(
  creditId?: string,
  accountId = "default",
): Promise<CodexRateLimitResetOutcome> {
  const path = (await resolveCodexBinary()).path;
  const cwd = await homeDir();
  const result = await requestCodexAccount<unknown>(
    path,
    cwd,
    "account/rateLimitResetCredit/consume",
    {
      idempotencyKey: crypto.randomUUID(),
      ...(creditId ? { creditId } : {}),
    },
    accountId,
  );
  const outcome = asRecord(result)?.outcome;
  if (
    outcome === "reset" ||
    outcome === "nothingToReset" ||
    outcome === "noCredit" ||
    outcome === "alreadyRedeemed"
  ) {
    return outcome;
  }
  throw new Error("Codex returned an unknown reset result");
}

// Every probe reuses USAGE_CHILD_ID and kills whatever holds it first, so
// probes for different accounts (footer, Settings, account picker) must not
// overlap or they terminate each other.
let codexUsageQueue: Promise<unknown> = Promise.resolve();

function requestCodexAccount<T>(
  path: string,
  cwd: string,
  method: string,
  params: unknown,
  accountId: string,
): Promise<T> {
  const run = codexUsageQueue.then(() =>
    runCodexAccountRequest<T>(path, cwd, method, params, accountId),
  );
  codexUsageQueue = run.catch(() => undefined);
  return run;
}

async function runCodexAccountRequest<T>(
  path: string,
  cwd: string,
  method: string,
  params: unknown,
  accountId: string,
): Promise<T> {
  const rpc = new JsonRpcClient(
    USAGE_CHILD_ID,
    {
      onRequest: (id) => {
        void rpc.respond(id, {}).catch(() => undefined);
      },
    },
    { includeJsonrpc: false, label: "codex-usage" },
  );

  const stop = async () => {
    rpc.close();
    unwatchChild(USAGE_CHILD_ID);
    await killChild(USAGE_CHILD_ID).catch(() => undefined);
  };

  await killChild(USAGE_CHILD_ID).catch(() => undefined);

  watchChild(
    USAGE_CHILD_ID,
    (line) => rpc.pushLine(line),
    () => rpc.close(new Error("Codex usage probe exited")),
  );

  try {
    await spawnChild(
      USAGE_CHILD_ID,
      path,
      ["app-server"],
      cwd,
      {
        provider: "codex",
        id: accountId,
      },
      "codex",
    );
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        await rpc.request(
          "initialize",
          {
            clientInfo: {
              name: "irgat",
              title: "Irgat",
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true },
          },
          REQUEST_TIMEOUT_MS,
        );
        await rpc.notify("initialized", undefined);

        return rpc.request<T>(method, params, REQUEST_TIMEOUT_MS);
      },
      () => {
        void stop();
      },
    );
  } finally {
    await stop();
  }
}

async function withTimeout<T>(
  ms: number,
  work: () => Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = work();
  try {
    return await Promise.race([
      pending,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error("Codex usage probe timed out"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    void pending.catch(() => undefined);
  }
}
