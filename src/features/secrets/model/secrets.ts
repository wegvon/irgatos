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
export const SECRET_APPROVAL_EVENT = "secrets:approval";
/** Fired by an approval card once the user answers it. */
export const SECRET_APPROVED_EVENT = "irgatos:secret-approved";
export const SECRET_KINDS = ["key", "login"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];
/** "free": agents use it within its limits; "ask": each use waits for the user. */
export type SecretPolicy = "free" | "ask";
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
  kind: SecretKind;
  /** A login's username; not secret. */
  username: string;
  policy: SecretPolicy;
  updatedAt: number;
  /** Programs `secrets.run` may hand it to as an environment variable. */
  commands: string[];
};

export type SecretAudit = {
  at: number;
  secretId: string;
  name: string;
  sessionId: string | null;
  outcome:
    | "saved"
    | "used"
    | "blocked"
    | "revoked"
    | "expired"
    | "ended"
    | "edited"
    | "approved"
    | "denied";
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
  kind?: SecretKind;
  username?: string;
  policy?: SecretPolicy;
  commands?: string[];
  value: string;
};

/** An edit from the vault screen; leave `value` out to keep the current one. */
export type SecretUpdate = {
  id: string;
  name: string;
  label: string;
  description: string;
  hosts: string[];
  allowIn: string[];
  purpose?: string;
  kind: SecretKind;
  username: string;
  policy: SecretPolicy;
  commands: string[];
  value?: string;
};

/** An agent wants to use an "ask" value; the chat shows it as a card. */
export type SecretApproval = {
  requestId: string;
  sessionId: string;
  secretId: string;
  name: string;
  label: string;
  kind: SecretKind;
  action: string;
  method: string;
  target: string;
  state: "pending" | "once" | "chat" | "deny";
};

export type SecretApprovalEvent = Omit<SecretApproval, "state">;
export type SecretApprovalAnswer = { blockId: string; approval: SecretApproval };

export function saveSecret(input: SecretSave) {
  return invoke<SecretMeta>("secrets_save", { input });
}

export function updateSecret(input: SecretUpdate) {
  return invoke<SecretMeta>("secrets_update", { input });
}

export function answerSecretApproval(
  approval: Pick<SecretApproval, "secretId" | "sessionId">,
  answer: "once" | "chat" | "deny",
) {
  return invoke<void>("secrets_approve", {
    input: { secretId: approval.secretId, sessionId: approval.sessionId, answer },
  });
}

/**
 * Records the answer in the vault, then tells the app, which updates the
 * card and lets the agent hear it. The card and the phone both go this way.
 */
export async function settleSecretApproval(
  blockId: string,
  approval: SecretApproval,
  answer: "once" | "chat" | "deny",
) {
  await answerSecretApproval(approval, answer);
  window.dispatchEvent(
    new CustomEvent<SecretApprovalAnswer>(SECRET_APPROVED_EVENT, {
      detail: { blockId, approval: { ...approval, state: answer } },
    }),
  );
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
  return `<secrets>\nWhen a task needs a password, API key or token, never ask the user to paste it into the chat. First run \`${cli} secrets.list\`: the user's vault of API keys and logins is there. If what you need is missing, run \`${cli} secrets.request --json '{"name":"STRIPE_KEY","label":"Stripe secret key","hosts":["api.stripe.com"]}'\`; the user types it into a masked card you never see. Then make the request with \`${cli} secrets.http\`, writing {{secret:NAME}} where the value goes (an Authorization header, by default). Run \`${cli} --help\` for the fields.\n</secrets>`;
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

const APPROVAL_STATES = ["pending", "once", "chat", "deny"] as const;

/** The approval as the chat keeps it; anything malformed is dropped. */
export function sanitizeSecretApproval(value: unknown): SecretApproval | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const text = (item: unknown, max: number) => (typeof item === "string" ? item.slice(0, max) : "");
  if (
    typeof raw.requestId !== "string" ||
    typeof raw.sessionId !== "string" ||
    typeof raw.secretId !== "string" ||
    typeof raw.name !== "string" ||
    !NAME.test(raw.name)
  )
    return undefined;
  return {
    requestId: raw.requestId.slice(0, 64),
    sessionId: raw.sessionId,
    secretId: raw.secretId.slice(0, 64),
    name: raw.name,
    label: text(raw.label, 80) || raw.name,
    kind: raw.kind === "login" ? "login" : "key",
    action: text(raw.action, 40),
    method: text(raw.method, 10),
    target: text(raw.target, 200),
    state: (APPROVAL_STATES as readonly unknown[]).includes(raw.state)
      ? (raw.state as SecretApproval["state"])
      : "pending",
  };
}

/** The card an "ask" value puts in the chat when an agent wants it. */
export function secretApprovalBlock(event: SecretApprovalEvent): Block | null {
  const approval = sanitizeSecretApproval({ ...event, state: "pending" });
  if (!approval) return null;
  return {
    id: `secret-approval-${approval.requestId}`,
    role: "system",
    text: `Approval asked: ${approval.name}`,
    secretApproval: approval,
  };
}

/** A repeated ask for the same value while one is still open reuses it. */
export function pendingSecretApproval(blocks: Block[], secretId: string) {
  return blocks.find(
    (block) =>
      block.secretApproval?.secretId === secretId && block.secretApproval.state === "pending",
  );
}

/** What the agent hears once the user answers an approval. */
export function secretApprovalPrompt(approval: SecretApproval) {
  if (approval.state === "deny")
    return `Irgatos: The user did not allow ${approval.name} this time. Do not retry with it; continue without it or explain what it was needed for.`;
  const scope = approval.state === "chat" ? "for the rest of this chat" : "for one use";
  return `Irgatos: The user allowed ${approval.name} ${scope}. Retry the same ${approval.action || "call"} now.`;
}

export const SECRET_KIND_LABEL: Record<SecretKind, string> = {
  key: "API key",
  login: "Login",
};

/** Filters the vault list by a search: name, label, username, host or note. */
export function matchesSecret(meta: SecretMeta, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    meta.name,
    meta.label,
    meta.username,
    meta.description,
    ...meta.hosts,
    ...(meta.commands ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}
