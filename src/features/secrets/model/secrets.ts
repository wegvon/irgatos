import { invoke } from "@tauri-apps/api/core";
import type { Block } from "../../sessions/model/session";

/**
 * Secret input for agents. An agent asks with `app secrets.request`; the
 * chat shows a masked card; the value goes straight to the app's encrypted
 * vault and only its name ever reaches the chat or the agent, which uses it
 * as `{{secret:NAME}}` in `app secrets.http`. See `src-tauri/src/secrets.rs`.
 */

export const SECRET_REQUEST_EVENT = "secrets:request";
export const SECRETS_CHANGED_EVENT = "secrets:changed";
/** Fired by the card once a value is saved or the request declined. */
export const SECRET_ANSWERED_EVENT = "irgatos:secret-answered";
export const DEFAULT_TTL_HOURS = 24;
export const SECRET_PLACES = ["header", "url", "body"] as const;
export type SecretPlace = (typeof SECRET_PLACES)[number];

/** What an agent asked for. Never holds a value. */
export type SecretRequest = {
  requestId: string;
  /** The chat that asked; the vault binds the value to it. */
  sessionId: string;
  name: string;
  label: string;
  description: string;
  hosts: string[];
  allowIn: string[];
  purpose?: string | null;
  once: boolean;
  state: "pending" | "saved" | "declined";
  /** Where the user saved it, once saved. */
  persistent?: boolean;
  expiresAt?: number | null;
};

export type SecretRequestEvent = Omit<SecretRequest, "state">;

export type SecretAnswer = {
  blockId: string;
  request: SecretRequest;
};

/** A saved secret as the app reports it: everything but the value. */
export type SecretMeta = {
  id: string;
  name: string;
  label: string;
  description: string;
  sessionId: string | null;
  hosts: string[];
  allowIn: string[];
  purpose: string | null;
  maxUses: number | null;
  uses: number;
  createdAt: number;
  expiresAt: number | null;
};

export type SecretAudit = {
  at: number;
  secretId: string;
  name: string;
  sessionId: string | null;
  outcome: "saved" | "used" | "blocked" | "revoked" | "expired" | "ended";
  action: string;
  method: string;
  host: string;
  detail: string;
};

export type SecretSave = {
  sessionId?: string;
  name: string;
  label: string;
  description: string;
  hosts: string[];
  allowIn: string[];
  purpose?: string;
  once: boolean;
  persistent: boolean;
  ttlHours?: number;
  value: string;
};

export function saveSecret(input: SecretSave) {
  return invoke<SecretMeta>("secrets_save", { input });
}

export function listSecrets() {
  return invoke<SecretMeta[]>("secrets_list");
}

export function revokeSecret(id: string) {
  return invoke<void>("secrets_revoke", { id });
}

export function secretAudit(limit = 50) {
  return invoke<SecretAudit[]>("secrets_audit", { limit });
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The request as the chat keeps it; anything malformed is dropped. */
export function sanitizeSecretRequest(value: unknown): SecretRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
  if (
    typeof raw.requestId !== "string" ||
    typeof raw.sessionId !== "string" ||
    typeof raw.name !== "string" ||
    !NAME.test(raw.name)
  )
    return undefined;
  const state =
    raw.state === "saved" || raw.state === "declined" ? raw.state : "pending";
  const hosts = strings(raw.hosts);
  if (!hosts.length) return undefined;
  return {
    requestId: raw.requestId.slice(0, 64),
    sessionId: raw.sessionId,
    name: raw.name,
    label: typeof raw.label === "string" ? raw.label.slice(0, 80) : raw.name,
    description: typeof raw.description === "string" ? raw.description.slice(0, 300) : "",
    hosts,
    allowIn: strings(raw.allowIn).filter((place) => (SECRET_PLACES as readonly string[]).includes(place)),
    ...(typeof raw.purpose === "string" && raw.purpose ? { purpose: raw.purpose.slice(0, 60) } : {}),
    once: raw.once === true,
    state,
    ...(state === "saved" ? { persistent: raw.persistent === true } : {}),
    ...(state === "saved" && typeof raw.expiresAt === "number" ? { expiresAt: raw.expiresAt } : {}),
  };
}

/** The card an agent's request puts in the chat. */
export function secretRequestBlock(event: SecretRequestEvent): Block | null {
  const request = sanitizeSecretRequest({ ...event, state: "pending" });
  if (!request) return null;
  return {
    id: `secret-${request.requestId}`,
    role: "system",
    text: `Secret requested: ${request.name}`,
    secretRequest: request,
  };
}

/** A repeated ask for the same name while one is still open reuses it. */
export function pendingSecretRequest(blocks: Block[], name: string) {
  return blocks.find(
    (block) => block.secretRequest?.name === name && block.secretRequest.state === "pending",
  );
}

/** What the agent hears once the user answers. Names only. */
export function secretAnswerPrompt(request: SecretRequest) {
  if (request.state === "declined")
    return `Irgatos: The user declined to enter ${request.name}. Do not ask for it again in chat; continue without it or explain what it would be needed for.`;
  const placeholder = `{{secret:${request.name}}}`;
  const limits = [
    `hosts: ${request.hosts.join(", ")}`,
    `placed in: ${request.allowIn.join(", ") || "header"}`,
    request.purpose ? `purpose: ${request.purpose}` : "",
    request.once ? "usable once" : "",
  ].filter(Boolean);
  return `Irgatos: The user saved ${request.name}. Continue the pending request. Use ${placeholder} with app secrets.http (${limits.join("; ")}). You cannot read the value, and it works nowhere else.`;
}

/** The one-time hint every chat hears, so agents never ask for a paste. */
export function secretsContext(cli: string) {
  return `<secrets>\nWhen a task needs a password, API key or token, never ask the user to paste it into the chat. Run \`${cli} secrets.request --json '{"name":"STRIPE_KEY","label":"Stripe secret key","hosts":["api.stripe.com"]}'\`; the user types it into a masked card you never see. Then make the request with \`${cli} secrets.http\`, writing {{secret:NAME}} where the value goes (an Authorization header, by default). Run \`${cli} secrets.list\` for what is saved and \`${cli} --help\` for the fields.\n</secrets>`;
}

const hinted = new Set<string>();

export function claimSecretsHint(sessionId: string) {
  if (hinted.has(sessionId)) return false;
  hinted.add(sessionId);
  return true;
}

export function secretScopeLabel(meta: Pick<SecretMeta, "sessionId" | "expiresAt">, now = Date.now()) {
  if (!meta.sessionId) return "Saved for all chats";
  if (!meta.expiresAt) return "This chat";
  const hours = Math.round((meta.expiresAt - now) / 3_600_000);
  return hours < 1 ? "This chat · under 1 hour left" : `This chat · ${hours} h left`;
}

export function parseHosts(text: string) {
  return text
    .split(/[\s,]+/)
    .map((host) => host.trim())
    .filter(Boolean);
}
