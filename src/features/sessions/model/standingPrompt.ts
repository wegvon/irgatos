/**
 * The standing prompt: text the user writes once in Settings > Chat that
 * every conversation hears, whatever its provider or where it runs.
 *
 * Like ADHD mode, it is handed over once per provider conversation and again
 * when the text changes, so a long chat does not pay for it on every turn.
 */

const KEY = "irgat.standingPrompt";
const HANDED_KEY = "irgat.standingPrompt.handed";

export const STANDING_PROMPT_CHANGE_EVENT = "irgat:standing-prompt-change";
export const STANDING_PROMPT_MAX_CHARS = 8_000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / quota
  }
}

export function loadStandingPrompt(): string {
  return (read(KEY) ?? "").slice(0, STANDING_PROMPT_MAX_CHARS);
}

export function saveStandingPrompt(text: string) {
  const next = text.slice(0, STANDING_PROMPT_MAX_CHARS);
  if (next.trim()) write(KEY, next);
  else {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing stored either
    }
  }
  try {
    window.dispatchEvent(
      new CustomEvent(STANDING_PROMPT_CHANGE_EVENT, { detail: next }),
    );
  } catch {
    // no window outside the app
  }
}

/** The block an agent reads, or nothing while the prompt is empty. */
export function standingPromptContext(
  text = loadStandingPrompt(),
): string | undefined {
  const body = text.trim();
  if (!body) return undefined;
  return `<standing_prompt>\nThe user's standing instructions for every conversation, set in Irgatos settings. Follow them unless the user asks otherwise in this chat.\n\n${body}\n</standing_prompt>`;
}

/** The `context` field of a remote host's send command, while there is a prompt. */
export function withStandingPrompt(): { context?: string } {
  const context = standingPromptContext();
  return context ? { context } : {};
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

type Handed = { provider?: string; version: string };

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

export type StandingPromptPlan = { context?: string; version?: string };

/**
 * What this turn should carry. A turn without a known provider id starts a
 * new conversation, so it always hears the prompt.
 */
export function planStandingPrompt(
  sessionId: string,
  providerSessionId: string | undefined,
  options: { force?: boolean; text?: string } = {},
): StandingPromptPlan {
  const context = standingPromptContext(options.text);
  if (!context) return {};
  const version = fnv1a(context);
  const handed = readHanded()[sessionId];
  if (
    !options.force &&
    handed &&
    providerSessionId &&
    (handed.provider == null || handed.provider === providerSessionId) &&
    handed.version === version
  )
    return {};
  return { context, version };
}

/** Record that a turn the provider accepted carried this version. */
export function recordStandingPrompt(
  sessionId: string,
  providerSessionId: string | undefined,
  version: string,
) {
  write(
    HANDED_KEY,
    JSON.stringify({
      ...readHanded(),
      [sessionId]: {
        ...(providerSessionId ? { provider: providerSessionId } : {}),
        version,
      },
    }),
  );
}

/** Drop a deleted conversation's receipt. */
export function forgetStandingPrompt(sessionId: string) {
  const handed = readHanded();
  if (sessionId in handed) {
    delete handed[sessionId];
    write(HANDED_KEY, JSON.stringify(handed));
  }
}
