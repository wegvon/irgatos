import type {
  InterSessionMessage,
  SessionMessagePatch,
} from "../model/sessionMessaging";

const STORAGE_KEY = "irgat.sessionMessages.v1";
const COOPERATIVE_KEY = "irgat.sessionMessaging.cooperative";
const MESSAGE_LIMIT = 400;
const PROCESSED_LIMIT = 1_000;

export const COOPERATIVE_MODE_CHANGE_EVENT = "irgat:session-cooperative-change";

type Persisted = {
  messages: InterSessionMessage[];
  /** Agent replies whose directives have been acted on, by block id. */
  processed: string[];
};

export type SessionMessageStore = {
  snapshot: () => readonly InterSessionMessage[];
  subscribe: (listener: () => void) => () => void;
  get: (id: string) => InterSessionMessage | undefined;
  add: (message: InterSessionMessage) => void;
  update: (id: string, patch: Partial<InterSessionMessage>) => void;
  apply: (patches: readonly SessionMessagePatch[]) => void;
  remove: (id: string) => void;
  isProcessed: (blockId: string) => boolean;
  markProcessed: (blockId: string) => void;
  clear: () => void;
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): Persisted {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return { messages: [], processed: [] };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.filter(
            (message): message is InterSessionMessage =>
              !!message &&
              typeof message.id === "string" &&
              typeof message.fromSessionId === "string" &&
              typeof message.toSessionId === "string",
          )
        : [],
      processed: Array.isArray(parsed.processed)
        ? parsed.processed.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { messages: [], processed: [] };
  }
}

export function createSessionMessageStore(
  key = STORAGE_KEY,
): SessionMessageStore {
  let loaded: Persisted | null = null;
  let messages: readonly InterSessionMessage[] = [];
  let processed = new Set<string>();
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded) return;
    loaded = read(key);
    messages = loaded.messages;
    processed = new Set(loaded.processed);
  };
  const persist = () => {
    try {
      storage()?.setItem(
        key,
        JSON.stringify({
          messages: messages.slice(-MESSAGE_LIMIT),
          processed: [...processed].slice(-PROCESSED_LIMIT),
        } satisfies Persisted),
      );
    } catch {
      // Storage full or unavailable: the in-memory state still works.
    }
  };
  const commit = (next: readonly InterSessionMessage[]) => {
    messages =
      next.length > MESSAGE_LIMIT ? next.slice(next.length - MESSAGE_LIMIT) : next;
    persist();
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => {
      load();
      return messages;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: (id) => {
      load();
      return messages.find((message) => message.id === id);
    },
    add: (message) => {
      load();
      commit([...messages, message]);
    },
    update: (id, patch) => {
      load();
      if (!messages.some((message) => message.id === id)) return;
      commit(
        messages.map((message) =>
          message.id === id ? { ...message, ...patch } : message,
        ),
      );
    },
    apply: (patches) => {
      load();
      if (!patches.length) return;
      const byId = new Map(patches.map((entry) => [entry.id, entry.patch]));
      commit(
        messages.map((message) => {
          const patch = byId.get(message.id);
          return patch ? { ...message, ...patch } : message;
        }),
      );
    },
    remove: (id) => {
      load();
      commit(messages.filter((message) => message.id !== id));
    },
    isProcessed: (blockId) => {
      load();
      return processed.has(blockId);
    },
    markProcessed: (blockId) => {
      load();
      if (processed.has(blockId)) return;
      processed.add(blockId);
      if (processed.size > PROCESSED_LIMIT) {
        processed = new Set([...processed].slice(-PROCESSED_LIMIT));
      }
      persist();
    },
    clear: () => {
      loaded = { messages: [], processed: [] };
      messages = [];
      processed = new Set();
      persist();
      for (const listener of listeners) listener();
    },
  };
}

export const sessionMessageStore = createSessionMessageStore();

export type CooperativeMode = {
  enabled: boolean;
  /** Directives in turns that started earlier than this are ignored. */
  since: number;
};

const COOPERATIVE_OFF: CooperativeMode = { enabled: false, since: 0 };
let cooperative: CooperativeMode | null = null;

export function loadCooperativeMode(): CooperativeMode {
  if (cooperative) return cooperative;
  try {
    const raw = storage()?.getItem(COOPERATIVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<CooperativeMode>) : null;
    cooperative =
      parsed && parsed.enabled === true && typeof parsed.since === "number"
        ? { enabled: true, since: parsed.since }
        : COOPERATIVE_OFF;
  } catch {
    cooperative = COOPERATIVE_OFF;
  }
  return cooperative;
}

export function saveCooperativeMode(enabled: boolean, now = Date.now()): void {
  cooperative = enabled ? { enabled: true, since: now } : COOPERATIVE_OFF;
  try {
    if (enabled) storage()?.setItem(COOPERATIVE_KEY, JSON.stringify(cooperative));
    else storage()?.removeItem(COOPERATIVE_KEY);
  } catch {
    // The choice still holds for this run.
  }
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOPERATIVE_MODE_CHANGE_EVENT));
}

export function subscribeCooperativeMode(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(COOPERATIVE_MODE_CHANGE_EVENT, listener);
  return () =>
    window.removeEventListener(COOPERATIVE_MODE_CHANGE_EVENT, listener);
}

/** Forget the cached flag, so the next read comes from storage. */
export function resetCooperativeModeCache(): void {
  cooperative = null;
}
