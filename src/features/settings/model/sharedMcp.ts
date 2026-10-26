import { invoke } from "@tauri-apps/api/core";
import type { SecretMeta } from "../../secrets/model/secrets";

export type SharedMcpAuth =
  { kind: "none" } | { kind: "executor" } | { kind: "vault"; secretId: string };

/** An MCP server every agent gets, signed in once in Irgatos. */
export type SharedMcpServer = {
  id: string;
  name: string;
  url: string;
  auth: SharedMcpAuth;
  enabled: boolean;
};

export type SharedMcpTest = { serverName: string; tools: number };

export const SHARED_MCP_NAME_PATTERN = "[A-Za-z0-9_-]{1,48}";

export function listSharedMcp(): Promise<SharedMcpServer[]> {
  return invoke<SharedMcpServer[]>("shared_mcp_list");
}

export function saveSharedMcp(
  server: SharedMcpServer,
): Promise<SharedMcpServer> {
  return invoke<SharedMcpServer>("shared_mcp_save", { server });
}

export function removeSharedMcp(id: string): Promise<void> {
  return invoke("shared_mcp_remove", { id });
}

export function testSharedMcp(id: string): Promise<SharedMcpTest> {
  return invoke<SharedMcpTest>("shared_mcp_test", { id });
}

/** Executor's MCP URL when Mail is connected, else null. */
export async function executorMcpUrl(): Promise<string | null> {
  return (await invoke<string | null>("shared_mcp_executor_url")) ?? null;
}

/** Vault keys a shared server can sign in with: saved for every chat, free
 * to use, without a use limit, and allowed in headers. The app checks the
 * host again on every request. */
export function usableVaultKeys(secrets: SecretMeta[]): SecretMeta[] {
  return secrets.filter(
    (secret) =>
      secret.sessionId === null &&
      secret.kind === "key" &&
      secret.policy === "free" &&
      secret.maxUses === null &&
      secret.allowIn.includes("header"),
  );
}

export function sharedMcpAuthLabel(
  auth: SharedMcpAuth,
  secrets: SecretMeta[],
): string {
  switch (auth.kind) {
    case "none":
      return "No sign-in";
    case "executor":
      return "Mail's Executor key";
    case "vault": {
      const secret = secrets.find((entry) => entry.id === auth.secretId);
      return secret
        ? `Vault: ${secret.label || secret.name}`
        : "Vault key missing";
    }
  }
}

export function sharedMcpHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
