import { leafIds, type WorkspaceTab } from "../../workspace/model/layout";
import {
  HARNESSES,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import { isFreeChatSession } from "../../freechat/model/freeChat";
import { pathKey } from "../../../shared/lib/paths";
import { looksLikeProject } from "./recents";

/**
 * The conversation each project was last worked in, kept apart from the open
 * tabs: closing tabs to declutter must not lose the way back. Shared by every
 * window through localStorage.
 */
export type LastConversation = {
  sessionId: string;
  title: string;
  /** Read with the title: a fresh chat's title is its harness name. */
  harness?: HarnessId;
  /** When this conversation became the project's last one. */
  at: number;
};

export type LastConversations = Readonly<Record<string, LastConversation>>;

const KEY = "irgatos.lastConversation.v1";
const CHANGED = "irgatos:last-conversation-changed";
/** Opening a remembered conversation from a blank chat in that project. */
export const CONTINUE_CONVERSATION_EVENT = "irgatos:continue-conversation";

export type ContinueConversationDetail = {
  sessionId: string;
  /** The blank chat the offer was shown in. */
  fromSessionId: string;
};

const EMPTY: LastConversations = Object.freeze({});
let cachedRaw: string | null = null;
let cached: LastConversations = EMPTY;

function parse(raw: string | null): LastConversations {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return EMPTY;
    }
    const result: Record<string, LastConversation> = {};
    for (const [project, entry] of Object.entries(value)) {
      if (!entry || typeof entry !== "object") continue;
      const { sessionId, title, harness, at } = entry as Record<
        string,
        unknown
      >;
      if (typeof sessionId !== "string" || !sessionId) continue;
      result[project] = {
        sessionId,
        title: typeof title === "string" ? title : "",
        ...((HARNESSES as unknown[]).includes(harness)
          ? { harness: harness as HarnessId }
          : {}),
        at: typeof at === "number" && Number.isFinite(at) ? at : 0,
      };
    }
    return result;
  } catch {
    return EMPTY;
  }
}

export function loadLastConversations(): LastConversations {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = parse(raw);
  return cached;
}

function save(next: LastConversations): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

export function subscribeLastConversations(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function lastConversationFor(
  memory: LastConversations,
  cwd: string,
): LastConversation | undefined {
  return looksLikeProject(cwd) ? memory[pathKey(cwd)] : undefined;
}

type Candidate = Pick<
  Session,
  | "id"
  | "cwd"
  | "title"
  | "harness"
  | "blocks"
  | "inboxAsk"
  | "orchestrationLeadId"
> & { ephemeral?: boolean };

/**
 * A conversation the user would want to come back to: a project chat that has
 * been spoken in. Workers, Inbox asks, free and throwaway chats are reached
 * from elsewhere, and a blank chat is not a place to return to.
 */
export function isReturnableConversation(
  session: Candidate | undefined,
  isIrgatSession: (id: string) => boolean = () => false,
): session is Candidate {
  if (!session) return false;
  if (session.inboxAsk || session.ephemeral || session.orchestrationLeadId) {
    return false;
  }
  if (!looksLikeProject(session.cwd) || isFreeChatSession(session)) {
    return false;
  }
  if (isIrgatSession(session.id)) return false;
  return session.blocks.some((block) => block.role === "user");
}

/** The focused chat of the active tab, when it is one to return to. */
export function focusedConversation(
  tabs: readonly WorkspaceTab[],
  sessions: readonly Candidate[],
  activeTabId: string,
  isIrgatSession?: (id: string) => boolean,
): Candidate | undefined {
  const tab = tabs.find((entry) => entry.id === activeTabId);
  if (!tab || !leafIds(tab.layout).includes(tab.focusedId)) return undefined;
  const session = sessions.find((entry) => entry.id === tab.focusedId);
  return isReturnableConversation(session, isIrgatSession)
    ? session
    : undefined;
}

export function withLastConversation(
  memory: LastConversations,
  session: Pick<Session, "id" | "cwd" | "title" | "harness">,
  now: number,
): LastConversations {
  const project = pathKey(session.cwd);
  const previous = memory[project];
  if (
    previous?.sessionId === session.id &&
    previous.title === session.title &&
    previous.harness === session.harness
  ) {
    return memory;
  }
  return {
    ...memory,
    [project]: {
      sessionId: session.id,
      title: session.title,
      harness: session.harness,
      // A rename keeps the time it became the last conversation.
      at: previous?.sessionId === session.id ? previous.at : now,
    },
  };
}

export function withoutConversations(
  memory: LastConversations,
  sessionIds: Iterable<string>,
): LastConversations {
  const gone = new Set(sessionIds);
  const kept = Object.entries(memory).filter(
    ([, entry]) => !gone.has(entry.sessionId),
  );
  return kept.length === Object.keys(memory).length
    ? memory
    : Object.fromEntries(kept);
}

export function rememberLastConversation(
  session: Pick<Session, "id" | "cwd" | "title" | "harness">,
  now = Date.now(),
): void {
  const memory = loadLastConversations();
  const next = withLastConversation(memory, session, now);
  if (next !== memory) save(next);
}

/** Deleted or archived chats are no longer offered as the way back. */
export function forgetConversations(sessionIds: Iterable<string>): void {
  const memory = loadLastConversations();
  const next = withoutConversations(memory, sessionIds);
  if (next !== memory) save(next);
}

export function requestContinueConversation(
  detail: ContinueConversationDetail,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ContinueConversationDetail>(CONTINUE_CONVERSATION_EVENT, {
      detail,
    }),
  );
}
