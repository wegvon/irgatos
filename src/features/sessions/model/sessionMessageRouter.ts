import { isIrgatSession } from "../../irgats/model/irgat";
import { isRemoteProjectPath } from "../../projects/model/recents";
import {
  loadCooperativeMode,
  sessionMessageStore,
  type SessionMessageStore,
} from "../data/sessionMessageStore";
import { insertSessionMessageIntoComposer } from "./sessionReferenceEvents";
import { sessionDisplayTitle, type Block, type Session } from "./session";
import {
  MAX_SESSION_MESSAGE_HOPS,
  formatSessionMessagePrompt,
  messageForTurn,
  reconcileSessionMessages,
  type InterSessionMessage,
  type SessionMessageMode,
  type SessionMessageOrigin,
} from "./sessionMessaging";
import {
  cooperativeBridgeBrief,
  cooperativeBriefSignature,
  mayContainSessionMessageDirective,
  parseSessionMessageDirectives,
  resolveDirectiveTarget,
} from "./sessionMessageDirectives";
import { peekLiveSessions } from "../data/sessionReferenceDirectory";

/** How messages reach sessions; the app connects its own submit path. */
export type SessionMessageTransport = {
  sessions: () => readonly Session[];
  /** Submit a turn, or queue it as a follow-up while the session runs. */
  submit: (sessionId: string, text: string) => boolean;
  /** Put text in a session's composer. */
  insertIntoComposer?: (sessionId: string, text: string) => void;
};

let transport: SessionMessageTransport | null = null;

export function connectSessionMessageTransport(
  next: SessionMessageTransport,
): () => void {
  transport = next;
  return () => {
    if (transport === next) transport = null;
  };
}

/** A session that can send and take direct messages. */
export function isMessageableSession(session: Session): boolean {
  return (
    !session.ephemeral &&
    !session.inboxAsk &&
    !session.orchestrationLeadId &&
    !session.sidebarHidden &&
    !session.worktreeRemoved &&
    !isRemoteProjectPath(session.cwd) &&
    !isIrgatSession(session.id)
  );
}

type Party = Pick<Session, "id" | "title" | "harness">;

export type SendSessionMessageInput = {
  from: Party;
  to: readonly Party[];
  text: string;
  mode: SessionMessageMode;
  origin: SessionMessageOrigin;
  sourceBlockId?: string;
  expectReply?: boolean;
  inReplyTo?: string;
  hop?: number;
};

export type RouterDeps = {
  store?: SessionMessageStore;
  transport?: SessionMessageTransport | null;
  now?: () => number;
  newId?: () => string;
};

function resolveDeps(deps: RouterDeps = {}) {
  return {
    store: deps.store ?? sessionMessageStore,
    transport: deps.transport === undefined ? transport : deps.transport,
    now: deps.now ?? Date.now,
    newId: deps.newId ?? (() => crypto.randomUUID()),
  };
}

function titleOf(session: Party): string {
  return sessionDisplayTitle(session.title, session.harness);
}

/** Record a message per target and hand each to its session. */
export function sendSessionMessage(
  input: SendSessionMessageInput,
  deps?: RouterDeps,
): InterSessionMessage[] {
  const { store, newId, now } = resolveDeps(deps);
  const text = input.text.trim();
  if (!text || !input.to.length) return [];
  const broadcastId = input.to.length > 1 ? newId() : undefined;
  const sent: InterSessionMessage[] = [];
  for (const target of input.to) {
    const message: InterSessionMessage = {
      id: newId(),
      fromSessionId: input.from.id,
      fromTitle: titleOf(input.from),
      fromHarness: input.from.harness,
      toSessionId: target.id,
      toTitle: titleOf(target),
      text,
      mode: input.mode,
      origin: input.origin,
      status: "queued",
      createdAt: now(),
      hop: input.hop ?? 0,
      ...(input.sourceBlockId ? { sourceBlockId: input.sourceBlockId } : {}),
      ...(broadcastId ? { broadcastId } : {}),
      ...(input.expectReply ? { expectReply: true } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    };
    store.add(message);
    deliver(message, deps);
    sent.push(store.get(message.id) ?? message);
  }
  return sent;
}

/** Record a directive that could not be sent, so the sender sees why. */
function recordFailure(
  from: Party,
  target: string,
  text: string,
  error: string,
  sourceBlockId: string,
  deps?: RouterDeps,
): void {
  const { store, newId, now } = resolveDeps(deps);
  store.add({
    id: newId(),
    fromSessionId: from.id,
    fromTitle: titleOf(from),
    fromHarness: from.harness,
    toSessionId: "",
    toTitle: target,
    text,
    mode: "run",
    origin: "agent",
    status: "failed",
    createdAt: now(),
    hop: 0,
    sourceBlockId,
    error,
  });
}

function deliver(message: InterSessionMessage, deps?: RouterDeps): void {
  const { store, transport: link, now } = resolveDeps(deps);
  const prompt = formatSessionMessagePrompt(message);
  if (message.mode === "composer") {
    (link?.insertIntoComposer ?? insertSessionMessageIntoComposer)(
      message.toSessionId,
      prompt,
    );
    store.update(message.id, {
      status: "delivered",
      deliveredAt: now(),
      error: undefined,
    });
    return;
  }
  if (!link) {
    store.update(message.id, {
      status: "failed",
      error: "Messaging isn't available right now.",
    });
    return;
  }
  const target = link.sessions().find((s) => s.id === message.toSessionId);
  if (!target) {
    store.update(message.id, {
      status: "failed",
      error: `"${message.toTitle}" is no longer open.`,
    });
    return;
  }
  let accepted = false;
  try {
    accepted = link.submit(message.toSessionId, prompt);
  } catch (error) {
    store.update(message.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  store.update(
    message.id,
    accepted
      ? { status: "queued", error: undefined }
      : {
          status: "failed",
          error: `"${message.toTitle}" didn't accept the message.`,
        },
  );
}

/** Send a failed message again, as a new delivery of the same text. */
export function retrySessionMessage(id: string, deps?: RouterDeps): boolean {
  const { store, now } = resolveDeps(deps);
  const message = store.get(id);
  if (!message || message.status !== "failed" || !message.toSessionId) {
    return false;
  }
  store.update(id, { status: "queued", createdAt: now(), error: undefined });
  deliver({ ...message, status: "queued", createdAt: now() }, deps);
  return store.get(id)?.status !== "failed";
}

export function dismissSessionMessage(id: string, deps?: RouterDeps): void {
  resolveDeps(deps).store.remove(id);
}

const briefed = new Map<string, string>();

/**
 * Send path: while cooperative mode is on, tell the agent which sessions it
 * can message. The note goes out again only when that set changes, since the
 * agent keeps its earlier turns in context.
 */
export function applyCooperativeBridgeToTurn(
  prepared: string,
  sessionId: string | undefined,
  live?: readonly Session[],
): string {
  if (!loadCooperativeMode().enabled) {
    briefed.clear();
    return prepared;
  }
  if (!sessionId) return prepared;
  const sessions = live ?? peekLiveSessions();
  const source = sessions.find((session) => session.id === sessionId);
  if (!source || !isMessageableSession(source)) return prepared;
  const brief = cooperativeBridgeBrief(
    source,
    sessions.filter(isMessageableSession),
  );
  const signature = cooperativeBriefSignature(brief);
  if (!brief || briefed.get(sessionId) === signature) return prepared;
  briefed.set(sessionId, signature);
  return `${prepared}\n\n${brief}`;
}

/** Blocks of each session's latest turn already checked for directives. */
const scannedTurns = new WeakMap<readonly Block[], true>();

/**
 * Bring the message log up to date with the sessions: mark deliveries and
 * replies, return answers the sender asked for, and act on agent directives
 * when cooperative mode is on.
 */
export function syncSessionMessages(
  sessions: readonly Session[],
  deps?: RouterDeps,
): void {
  const { store, now } = resolveDeps(deps);
  store.apply(reconcileSessionMessages(store.snapshot(), sessions, now()));
  forwardReplies(sessions, deps);
  const mode = loadCooperativeMode();
  if (mode.enabled) runDirectives(sessions, mode.since, deps);
}

function forwardReplies(sessions: readonly Session[], deps?: RouterDeps) {
  const { store, now } = resolveDeps(deps);
  for (const message of store.snapshot()) {
    if (
      message.status !== "replied" ||
      !message.expectReply ||
      message.replyForwardedAt != null ||
      !message.replyText
    ) {
      continue;
    }
    store.update(message.id, { replyForwardedAt: now() });
    const from = sessions.find((s) => s.id === message.toSessionId);
    const to = sessions.find((s) => s.id === message.fromSessionId);
    if (!from || !to || !isMessageableSession(to)) continue;
    sendSessionMessage(
      {
        from,
        to: [to],
        text: message.replyText,
        mode: "run",
        origin: "agent",
        inReplyTo: message.id,
        hop: message.hop + 1,
        ...(message.replyBlockId ? { sourceBlockId: message.replyBlockId } : {}),
      },
      deps,
    );
  }
}

function turnStart(blocks: readonly Block[], index: number): number | undefined {
  for (let i = index; i >= 0; i -= 1) {
    const block = blocks[i]!;
    if (block.role === "user" && !block.draft) {
      return block.startedAt ?? block.sentAt;
    }
  }
  return undefined;
}

function runDirectives(
  sessions: readonly Session[],
  since: number,
  deps?: RouterDeps,
) {
  const { store } = resolveDeps(deps);
  const candidates = sessions.filter(isMessageableSession);
  for (const session of candidates) {
    if (session.busy || scannedTurns.has(session.blocks)) continue;
    scannedTurns.set(session.blocks, true);
    let lastUser = -1;
    for (let i = session.blocks.length - 1; i >= 0; i -= 1) {
      const block = session.blocks[i]!;
      if (block.role === "user" && !block.draft) {
        lastUser = i;
        break;
      }
    }
    for (let i = lastUser + 1; i < session.blocks.length; i += 1) {
      const block = session.blocks[i]!;
      if (
        block.role !== "assistant" ||
        block.streaming ||
        !mayContainSessionMessageDirective(block.text) ||
        store.isProcessed(block.id)
      ) {
        continue;
      }
      store.markProcessed(block.id);
      const started = turnStart(session.blocks, i);
      if (started == null || started < since) continue;
      const directives = parseSessionMessageDirectives(block.text);
      if (!directives.length) continue;
      const parent = messageForTurn(store.snapshot(), session, block.id);
      const hop = parent ? parent.hop + 1 : 1;
      for (const directive of directives) {
        if (hop > MAX_SESSION_MESSAGE_HOPS) {
          recordFailure(
            session,
            directive.target,
            directive.text,
            `Not sent: sessions have passed messages ${MAX_SESSION_MESSAGE_HOPS} times in a row.`,
            block.id,
            deps,
          );
          continue;
        }
        const resolved = resolveDirectiveTarget(
          directive.target,
          session,
          candidates,
        );
        if (!resolved.ok) {
          recordFailure(
            session,
            directive.target,
            directive.text,
            resolved.error,
            block.id,
            deps,
          );
          continue;
        }
        sendSessionMessage(
          {
            from: session,
            to: resolved.targets,
            text: directive.text,
            mode: "run",
            origin: "agent",
            sourceBlockId: block.id,
            expectReply: directive.kind === "ask",
            hop,
          },
          deps,
        );
      }
    }
  }
}
