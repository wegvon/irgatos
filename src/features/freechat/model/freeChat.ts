import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import {
  DEFAULT_RUNTIME_MODE,
  newDefaultSession,
  sessionDisplayTitle,
  sessionNeedsInput,
  type HarnessId,
  type RuntimeMode,
  type Session,
} from "../../sessions/model/session";
import { readStoredJson, writeStoredJson } from "../../../shared/lib/safeStorage";
import { isFreeChatCwd } from "./freeChatPath";

export { FREE_CHAT_DIR_SUFFIX, isFreeChatCwd } from "./freeChatPath";

/** Shown wherever a free chat would otherwise show its project. */
export const FREE_CHAT_LABEL = "Chat";

export function isFreeChatSession(
  session: { cwd: string } | undefined | null,
): boolean {
  return !!session && isFreeChatCwd(session.cwd);
}

let scratchDir: Promise<string> | undefined;

/** The scratch folder free chats run in, created on first use. */
export function resolveFreeChatDir(): Promise<string> {
  scratchDir ??= invoke<string>("free_chat_scratch_dir").catch((error) => {
    scratchDir = undefined;
    throw error;
  });
  return scratchDir;
}

export function resetFreeChatDirForTest(): void {
  scratchDir = undefined;
}

export function newFreeChatSession(
  dir: string,
  runtimeMode: RuntimeMode = DEFAULT_RUNTIME_MODE,
): Session {
  return { ...newDefaultSession(dir, runtimeMode), workspaceMode: "current" };
}

export function freeChatDisplayTitle(title: string, harness: HarnessId): string {
  const shown = sessionDisplayTitle(title, harness);
  return shown === "New session" ? "New chat" : shown;
}

export type FreeChatState = "needs-input" | "running" | "unread" | "idle";

export type FreeChatRow = {
  id: string;
  title: string;
  harness: HarnessId;
  model: string;
  pinned: boolean;
  updatedAt: number;
  state: FreeChatState;
  /** Open in memory with nothing sent yet. */
  blank: boolean;
};

function liveSummary(session: Session, now: number): SessionSummary {
  return {
    id: session.id,
    cwd: session.cwd,
    harness: session.harness,
    model: session.model,
    runtimeMode: session.runtimeMode,
    title: session.title,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The Chat list: saved chats merged with the ones open in memory, pinned
 * first, then blank drafts, then most recent. Archived chats stay out.
 */
export function freeChatRows({
  stored,
  live,
  unseen = new Set(),
  now = Date.now(),
  query = "",
}: {
  stored: readonly SessionSummary[];
  live: readonly Session[];
  unseen?: ReadonlySet<string>;
  now?: number;
  query?: string;
}): FreeChatRow[] {
  const liveById = new Map(
    live
      .filter((session) => isFreeChatSession(session) && !session.ephemeral)
      .map((session) => [session.id, session]),
  );
  const byId = new Map<string, SessionSummary>();
  for (const summary of stored) {
    if (isFreeChatCwd(summary.cwd)) byId.set(summary.id, summary);
  }
  for (const session of liveById.values()) {
    const saved = byId.get(session.id);
    byId.set(
      session.id,
      saved
        ? { ...saved, title: session.title, harness: session.harness, model: session.model }
        : liveSummary(session, now),
    );
  }
  const needle = query.trim().toLowerCase();
  const rows: FreeChatRow[] = [];
  for (const summary of byId.values()) {
    if (summary.archived) continue;
    const session = liveById.get(summary.id);
    const title = freeChatDisplayTitle(summary.title, summary.harness);
    if (needle && !title.toLowerCase().includes(needle)) continue;
    const state: FreeChatState =
      session && sessionNeedsInput(session)
        ? "needs-input"
        : session?.busy
          ? "running"
          : unseen.has(summary.id)
            ? "unread"
            : "idle";
    rows.push({
      id: summary.id,
      title,
      harness: summary.harness,
      model: summary.model,
      pinned: !!summary.pinned,
      updatedAt: summary.updatedAt,
      state,
      blank: !!session && session.blocks.length === 0,
    });
  }
  return rows.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      Number(b.blank) - Number(a.blank) ||
      b.updatedAt - a.updatedAt,
  );
}

/** Chats waiting on the user win over unread finished ones for the badge. */
export function freeChatBadge(rows: readonly FreeChatRow[]): {
  count: number;
  tone: "attention" | "unread" | "none";
} {
  const attention = rows.filter((row) => row.state === "needs-input").length;
  if (attention) return { count: attention, tone: "attention" };
  const unread = rows.filter((row) => row.state === "unread").length;
  return unread ? { count: unread, tone: "unread" } : { count: 0, tone: "none" };
}

const VIEW_KEY = "irgatos:freechat:v1";

export type FreeChatViewState = { open: boolean; activeId?: string };

export function loadFreeChatView(): FreeChatViewState {
  const value = readStoredJson(VIEW_KEY);
  if (!value || typeof value !== "object") return { open: false };
  const { open, activeId } = value as Record<string, unknown>;
  return {
    open: open === true,
    ...(typeof activeId === "string" && activeId ? { activeId } : {}),
  };
}

export function saveFreeChatView(state: FreeChatViewState): void {
  try {
    writeStoredJson(VIEW_KEY, state);
  } catch {
    // private mode / quota
  }
}
