import type { Block, Session } from "../model/session";

/**
 * What this window last read from or wrote to the store for one session. A
 * write is accepted only while `revision` is still the stored revision.
 */
export type WriteBase = {
  revision: number;
  lineage: string | undefined;
  blocks: readonly Block[];
  header: HeaderSnapshot;
};

type HeaderKey = (typeof HEADER_KEYS)[number];
export type HeaderSnapshot = Record<HeaderKey, string | undefined>;

/** Session fields the store persists outside the transcript. */
const HEADER_KEYS = [
  "cwd",
  "harness",
  "model",
  "modelSettings",
  "runtimeMode",
  "title",
  "queuedMessages",
  "queueStatus",
  "providerSessionId",
  "providerAccountId",
  "context",
  "branch",
  "worktreeCwd",
  "worktreeRemoved",
  "linkedWorkItem",
  "automationId",
  "sidebarHidden",
  "pendingSwitch",
] as const satisfies readonly (keyof Session)[];

/**
 * Three-way merge of a stale in-memory session onto the newer stored copy.
 * Blocks are replaced, never mutated, so identity against `base` tells what
 * this window changed since it last synced: those blocks (and new ones) win,
 * everything else comes from `remote`, and blocks the other window removed
 * stay removed. `dirty` is false when the window had nothing of its own to
 * add, i.e. the stored copy can simply be adopted without a write.
 *
 * Irgat transcripts load in pages, so blocks older than the stored page are
 * kept as they are instead of being read as deletions.
 */
export function rebaseSession(
  local: Session,
  base: WriteBase,
  remote: Session,
): { session: Session; dirty: boolean } {
  const baseById = new Map(base.blocks.map((block) => [block.id, block]));
  const localById = new Map(local.blocks.map((block) => [block.id, block]));
  const remoteIds = new Set(remote.blocks.map((block) => block.id));

  const prefix = olderPages(local, remote, remoteIds);
  const prefixIds = new Set(prefix.map((block) => block.id));

  let dirty = false;
  const blocks = [...prefix];
  for (const stored of remote.blocks) {
    const mine = localById.get(stored.id);
    if (mine && mine !== baseById.get(stored.id)) {
      blocks.push(mine);
      dirty = true;
    } else {
      blocks.push(stored);
    }
  }
  for (const block of local.blocks) {
    if (
      remoteIds.has(block.id) ||
      prefixIds.has(block.id) ||
      baseById.has(block.id)
    )
      continue;
    blocks.push(block);
    dirty = true;
  }

  const session: Session = { ...local, blocks };
  const mine = headerSnapshot(local);
  for (const key of HEADER_KEYS) {
    // Per field, so a title renamed here and a provider id set there both stay.
    const changedHere = mine[key] !== base.header[key];
    if (changedHere) dirty = true;
    const value = (changedHere ? local : remote)[key];
    if (value === undefined) delete session[key];
    else (session as Record<string, unknown>)[key] = value;
  }
  if (remote.irgatTranscript && !prefix.length) {
    session.irgatTranscript = remote.irgatTranscript;
  }
  session.storeLineage = remote.storeLineage;
  return { session, dirty };
}

export function headerSnapshot(session: Session): HeaderSnapshot {
  const snapshot = {} as HeaderSnapshot;
  for (const key of HEADER_KEYS) {
    const value = session[key];
    snapshot[key] = value === undefined ? undefined : JSON.stringify(value);
  }
  return snapshot;
}

/** Blocks from Irgat pages older than the stored page this window read. */
function olderPages(
  local: Session,
  remote: Session,
  remoteIds = new Set(remote.blocks.map((block) => block.id)),
): Block[] {
  if (!remote.irgatTranscript || remote.irgatTranscript.before === null)
    return [];
  const firstShared = local.blocks.findIndex((block) => remoteIds.has(block.id));
  return firstShared > 0 ? local.blocks.slice(0, firstShared) : [];
}

/** What the store holds within the window `local` has loaded. */
export function storedWindow(local: Session, remote: Session): Block[] {
  return [...olderPages(local, remote), ...remote.blocks];
}
