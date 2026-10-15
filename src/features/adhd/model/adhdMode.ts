import type { BuiltinSkill } from "../../skills/model/skills";
import {
  ADHD_RULES_VERSION,
  ADHD_STOP_PHRASES,
  adhdDisabledContext,
  adhdRulesContext,
} from "./adhdRules";

const KEY = "irgat.adhdMode";
const HANDED_KEY = "irgat.adhdMode.handed";

export const ADHD_MODE_CHANGE_EVENT = "irgat:adhd-mode-change";

export type AdhdSettings = {
  /** The always-on switch: every chat follows it unless it has its own choice. */
  enabled: boolean;
  showInStatusBar: boolean;
};

export type AdhdState = AdhdSettings & {
  /** Chats switched away from `enabled` with a command or a stop phrase. */
  chats: Record<string, boolean>;
};

export const ADHD_SETTINGS_DEFAULTS: AdhdSettings = {
  enabled: false,
  showInStatusBar: true,
};

const DEFAULT_STATE: AdhdState = { ...ADHD_SETTINGS_DEFAULTS, chats: {} };

let cached: { raw: string | null; value: AdhdState } | undefined;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode / quota
  }
}

function parse(raw: string | null): AdhdState {
  if (!raw) return DEFAULT_STATE;
  try {
    const stored = JSON.parse(raw) as Partial<AdhdState>;
    const bool = (key: keyof AdhdSettings) =>
      typeof stored[key] === "boolean"
        ? (stored[key] as boolean)
        : ADHD_SETTINGS_DEFAULTS[key];
    const chats: Record<string, boolean> = {};
    if (stored.chats && typeof stored.chats === "object") {
      for (const [id, value] of Object.entries(stored.chats)) {
        if (typeof value === "boolean") chats[id] = value;
      }
    }
    return {
      enabled: bool("enabled"),
      showInStatusBar: bool("showInStatusBar"),
      chats,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

/** Stable between changes, so it can back `useSyncExternalStore`. */
export function loadAdhdState(): AdhdState {
  const raw = read(KEY);
  if (cached?.raw !== raw) cached = { raw, value: parse(raw) };
  return cached.value;
}

function saveState(next: AdhdState) {
  write(KEY, next);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADHD_MODE_CHANGE_EVENT));
}

export function subscribeAdhdState(onChange: () => void) {
  window.addEventListener(ADHD_MODE_CHANGE_EVENT, onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  // Floating Irgat chats run in their own window and share this storage.
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(ADHD_MODE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Flipping the always-on switch also drops every per-chat exception. */
export function saveAdhdSettings(patch: Partial<AdhdSettings>) {
  const current = loadAdhdState();
  const next: AdhdState = { ...current, ...patch };
  if (patch.enabled !== undefined && patch.enabled !== current.enabled)
    next.chats = {};
  saveState(next);
}

export function adhdEnabledFor(
  sessionId: string | undefined,
  state: AdhdState = loadAdhdState(),
): boolean {
  const own = sessionId ? state.chats[sessionId] : undefined;
  return own ?? state.enabled;
}

/** A chat's own choice, when it differs from the always-on switch. */
export function adhdChatOverride(
  sessionId: string | undefined,
  state: AdhdState = loadAdhdState(),
): boolean | undefined {
  return sessionId ? state.chats[sessionId] : undefined;
}

export function setAdhdForChat(sessionId: string, enabled: boolean) {
  const current = loadAdhdState();
  const chats = { ...current.chats };
  if (enabled === current.enabled) delete chats[sessionId];
  else chats[sessionId] = enabled;
  saveState({ ...current, chats });
}

/** The status bar chip: turn the mode the other way everywhere, this chat included. */
export function toggleAdhdMode(sessionId?: string) {
  saveState({
    ...loadAdhdState(),
    enabled: !adhdEnabledFor(sessionId),
    chats: {},
  });
}

export function clearAdhdChatOverrides() {
  saveState({ ...loadAdhdState(), chats: {} });
}

export type AdhdCommand =
  | { action: "on" | "off" | "toggle" | "usage"; phrase?: false }
  /** A stop phrase only counts while the mode is on; otherwise it is a message. */
  | { action: "off"; phrase: true };

export const ADHD_COMMAND_USAGE = "Usage: /i-have-adhd [on|off]";

export const ADHD_COMMAND: BuiltinSkill = {
  kind: "builtin",
  name: "i-have-adhd",
  invocation: "i-have-adhd",
  description:
    "Toggle ADHD mode for this chat: next action first, numbered steps, no filler.",
  scope: "builtin",
  source: "irgat",
};

/** `/i-have-adhd [on|off]` (or `/adhd`), or a stop phrase typed on its own. */
export function parseAdhdCommand(text: string): AdhdCommand | null {
  const command = text.match(/^\s*\/(?:i-have-adhd|adhd)(?:\s+(.*?))?\s*$/i);
  if (command) {
    const argument = (command[1] ?? "").trim().toLowerCase();
    if (!argument) return { action: "toggle" };
    if (["on", "enable", "aç", "ac"].includes(argument)) return { action: "on" };
    if (["off", "stop", "disable", "kapat"].includes(argument))
      return { action: "off" };
    return { action: "usage" };
  }
  const phrase = text
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[.!\s]+$/, "")
    .replace(/\s+/g, " ");
  return (ADHD_STOP_PHRASES as readonly string[]).includes(phrase)
    ? { action: "off", phrase: true }
    : null;
}

/**
 * Apply a composer command to one chat and return the line Irgatos shows for
 * it, or `null` when the text should go to the agent as an ordinary message.
 */
export function applyAdhdCommand(
  sessionId: string,
  command: AdhdCommand,
): string | null {
  const enabled = adhdEnabledFor(sessionId);
  if (command.phrase && !enabled) return null;
  if (command.action === "usage") return ADHD_COMMAND_USAGE;
  const next =
    command.action === "toggle" ? !enabled : command.action === "on";
  setAdhdForChat(sessionId, next);
  return next
    ? "ADHD mode on for this chat. The agent gets the i-have-adhd rules with your next message."
    : "ADHD mode disabled.";
}

type Handed = {
  provider?: string;
  state: "on" | "off";
  version?: string;
};

function readHanded(): Record<string, Handed> {
  try {
    const parsed = JSON.parse(read(HANDED_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, Handed>)
      : {};
  } catch {
    return {};
  }
}

export type AdhdContextPlan = {
  /** Text the app adds to this turn, if the provider needs to hear anything. */
  context?: string;
  state?: Handed["state"];
};

/**
 * Like the upstream session hook, hand the rules over once per provider
 * conversation, again when they change, and a short notice once they are
 * turned off. A turn without a known provider id starts a new conversation.
 */
export function planAdhdContext(
  sessionId: string,
  providerSessionId: string | undefined,
  enabled: boolean,
  options: { force?: boolean } = {},
): AdhdContextPlan {
  const handed = readHanded()[sessionId];
  const sameSession =
    !options.force &&
    !!handed &&
    !!providerSessionId &&
    (handed.provider == null || handed.provider === providerSessionId);
  if (enabled) {
    if (
      sameSession &&
      handed.state === "on" &&
      handed.version === ADHD_RULES_VERSION
    )
      return {};
    return { context: adhdRulesContext(), state: "on" };
  }
  if (sameSession && handed.state === "on")
    return { context: adhdDisabledContext(), state: "off" };
  return {};
}

/** Record what a turn the provider accepted carried. */
export function recordAdhdContext(
  sessionId: string,
  providerSessionId: string | undefined,
  state: Handed["state"],
) {
  write(HANDED_KEY, {
    ...readHanded(),
    [sessionId]: {
      ...(providerSessionId ? { provider: providerSessionId } : {}),
      state,
      ...(state === "on" ? { version: ADHD_RULES_VERSION } : {}),
    },
  });
}

/** Drop a deleted conversation's choice and receipt. */
export function forgetAdhdChat(sessionId: string) {
  const handed = readHanded();
  if (sessionId in handed) {
    delete handed[sessionId];
    write(HANDED_KEY, handed);
  }
  const current = loadAdhdState();
  if (sessionId in current.chats) {
    const chats = { ...current.chats };
    delete chats[sessionId];
    saveState({ ...current, chats });
  }
}
