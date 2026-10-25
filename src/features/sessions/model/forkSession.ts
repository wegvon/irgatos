import { buildDeterministicHandoff, buildHandoffComposerCard } from "./handoff";
import {
  formatSessionTitle,
  sessionDisplayTitle,
  type Block,
  type Session,
} from "./session";

export const FORK_LABEL = "Fork";

/** The divider a fork opens with, naming the chat it was copied from. */
export type ForkPointMeta = {
  fromSessionId: string;
  fromTitle: string;
};

/** What a fork keeps from its source, and how a provider can find the cut. */
export type ForkPlan = {
  blocks: Block[];
  /** User turns kept; the provider copy must end after this many. */
  keepTurns: number;
  /** The first user message left out, absent when the fork keeps everything. */
  nextPrompt?: string;
  /** Provider id of the last kept turn, when the harness reported one. */
  throughProviderTurnId?: string;
};

function isUserTurn(block: Block): boolean {
  return block.role === "user" && !block.draft;
}

/**
 * Blocks through `turn` (or the whole chat), without what belongs to the
 * source's live state: drafts, streaming text and open side threads.
 */
export function planFork(source: Session, turn?: Block[]): ForkPlan | null {
  const lastId = turn?.[turn.length - 1]?.id;
  const end = lastId
    ? source.blocks.findIndex((block) => block.id === lastId)
    : source.blocks.length - 1;
  if (end < 0) return null;
  const kept = source.blocks.slice(0, end + 1);
  const users = kept.filter(isUserTurn);
  if (users.length === 0) return null;
  const next = source.blocks.slice(end + 1).find(isUserTurn);
  const throughProviderTurnId = [...users]
    .reverse()
    .find((block) => block.providerTurnId)?.providerTurnId;
  return {
    blocks: kept.flatMap((block) => {
      if (block.draft || (block.streaming && !block.text.trim())) return [];
      const {
        streaming: _streaming,
        btwThreads: _btwThreads,
        providerTurnId: _providerTurnId,
        appRequestId: _appRequestId,
        ...rest
      } = block;
      return [rest];
    }),
    keepTurns: users.length,
    ...(next ? { nextPrompt: next.text } : {}),
    ...(throughProviderTurnId ? { throughProviderTurnId } : {}),
  };
}

export function forkTitle(source: Session): string {
  const display = sessionDisplayTitle(source.title, source.harness);
  const base = display === "New session" ? "Chat" : display;
  return formatSessionTitle(source.harness, `${base} (fork)`);
}

export function forkPointBlock(source: Session, id: string): Block {
  return {
    id,
    role: "system",
    text: "",
    forkPoint: {
      fromSessionId: source.id,
      fromTitle: sessionDisplayTitle(source.title, source.harness),
    },
  };
}

/**
 * The fork's transcript and, when the provider could not copy the
 * conversation, a recap chip its first message carries instead.
 */
export function forkedSession(input: {
  source: Session;
  plan: ForkPlan;
  fresh: Session;
  dividerId: string;
  providerSessionId: string | null;
}): Session {
  const { source, plan, fresh, providerSessionId } = input;
  const blocks = [...plan.blocks, forkPointBlock(source, input.dividerId)];
  const session: Session = {
    ...fresh,
    title: forkTitle(source),
    blocks,
    ...(source.worktreeCwd ? { worktreeCwd: source.worktreeCwd } : {}),
    ...(source.branch ? { branch: source.branch } : {}),
    ...(source.providerAccountId
      ? { providerAccountId: source.providerAccountId }
      : {}),
  };
  if (providerSessionId) return { ...session, providerSessionId };
  return {
    ...session,
    handoffCard: buildHandoffComposerCard({
      from: source.harness,
      to: source.harness,
      brief: buildDeterministicHandoff({ ...source, blocks: plan.blocks }),
      userRequest: "",
      files: [],
    }),
  };
}

/** True for a turn copied from the source, which the provider never ran here. */
export function isForkedCopy(blocks: Block[], blockId: string): boolean {
  const divider = blocks.findIndex((block) => block.forkPoint);
  if (divider < 0) return false;
  const index = blocks.findIndex((block) => block.id === blockId);
  return index >= 0 && index < divider;
}

export function canForkSession(session: Session): boolean {
  return (
    !session.ephemeral &&
    !session.inboxAsk &&
    !session.orchestrationLeadId &&
    !session.worktreeRemoved &&
    session.blocks.some(isUserTurn)
  );
}
