import { createRoot } from "react-dom/client";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { KanbanView } from "../../src/features/kanban/ui/KanbanView";
import {
  KANBAN_CHANGED,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
  type StoredSessionStatus,
} from "../../src/features/kanban/model/kanban";
import type { LiveCardSession } from "../../src/features/kanban/model/cardSession";
import type { HarnessId } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

// The real board view over an in-memory copy of the Rust store, so pointer
// drags run against real layout in Chromium and WebKit.
const PROJECT = "/Users/demo/src/irgat";
const DAY = 86_400_000;
const now = Date.now();

const TITLES = [
  "Persist split pane sizes per project",
  "Retry harness spawn when the CLI is mid-update",
  "Show token usage in the session footer",
  "Fix scroll jump when a long diff renders",
  "Keyboard shortcut for the command palette on Linux",
  "Collapse finished tool calls by default",
  "Group worktree sessions under their branch",
  "Add copy button to code blocks in notes",
  "Debounce file watcher events on large repos",
  "Remember the last model per harness",
  "Highlight failed turns in the session list",
  "Speed up first paint of long transcripts",
];
const LABELS = [["bug"], ["ui"], ["perf"], ["bug", "p1"], ["docs"], [], ["ui", "p2"], []];
const NOTES = [
  "",
  "Repro: open a 2k-line diff, scroll to the bottom, switch tabs and back.\n\n- [ ] add a test\n- [ ] check WebKit",
  "",
  "Blocked on the settings migration landing first.",
];

function card(id: string, columnId: string, index: number): KanbanCard {
  return {
    id,
    columnId,
    title: TITLES[index % TITLES.length]!,
    notes: NOTES[index % NOTES.length]!,
    labels: LABELS[index % LABELS.length]!,
    createdAt: now - (index + 2) * DAY,
    updatedAt: now - (index % 5) * 3_600_000,
  };
}

function column(id: string, title: string, cards: KanbanCard[]): KanbanColumn {
  return { id, title, cards, createdAt: now - 30 * DAY, updatedAt: now - 30 * DAY };
}

function seed(kind: string): KanbanBoard {
  const titles = ["Backlog", "In progress", "Review", "Done"];
  if (kind === "many") titles.splice(2, 0, "Blocked", "QA");
  const sizes =
    kind === "empty"
      ? titles.map(() => 0)
      : kind === "many"
        ? [32, 9, 4, 6, 7, 24]
        : [4, 2, 1, 2];
  let next = 0;
  const columns = titles.map((title, columnIndex) => {
    const id = `col-${columnIndex}`;
    const cards = Array.from({ length: sizes[columnIndex]! }, () => {
      const index = next++;
      return card(`card-${index}`, id, index);
    });
    return column(id, title, cards);
  });
  return { id: "board-1", project: PROJECT, columns, createdAt: now - 30 * DAY };
}

const SESSIONS: Record<string, { title: string; harness: string; status: StoredSessionStatus }> = {
  "s-split": { title: "Persist split pane sizes", harness: "claude", status: "finished" },
  "s-usage": { title: "Token usage in the footer", harness: "codex", status: "failed" },
  "s-tools": { title: "Collapse finished tool calls", harness: "claude", status: "running" },
  "s-worktree": { title: "Group worktree sessions", harness: "codex", status: "needs-input" },
  "s-notes": { title: "Copy button for note code blocks", harness: "cursor", status: "finished" },
};
const LINKED: Record<string, string> = {
  "card-0": "s-split",
  "card-2": "s-usage",
  "card-5": "s-tools",
  "card-6": "s-worktree",
  "card-7": "s-notes",
};
const LIVE = new Set(["s-tools", "s-worktree"]);

function attachSession(item: KanbanCard, sessionId: string | null) {
  const known = sessionId ? SESSIONS[sessionId] : undefined;
  item.session = sessionId
    ? {
        id: sessionId,
        status: known?.status ?? "finished",
        title: known?.title ?? "Untitled session",
        harness: known?.harness ?? "claude",
        saved: true,
      }
    : null;
}

const params = new URLSearchParams(location.search);
let board = seed(params.get("seed") ?? "demo");
for (const item of board.columns.flatMap((entry) => entry.cards)) {
  const sessionId = LINKED[item.id];
  if (sessionId) attachSession(item, sessionId);
}
const liveSessions = new Map<string, LiveCardSession>(
  [...LIVE].map((id) => [
    id,
    {
      status: SESSIONS[id]!.status,
      title: SESSIONS[id]!.title,
      harness: SESSIONS[id]!.harness as HarnessId,
    },
  ]),
);
const sessionEvents: string[] = [];
const clone = <T,>(value: T): T => structuredClone(value);
const findColumn = (id: string) => board.columns.find((item) => item.id === id);
const findCard = (id: string) =>
  board.columns.flatMap((item) => item.cards).find((item) => item.id === id);
const withoutCard = (id: string) => {
  for (const item of board.columns) item.cards = item.cards.filter((entry) => entry.id !== id);
};

type Args = Record<string, unknown>;
const handlers: Record<string, (args: Args) => unknown> = {
  kanban_board: () => clone(board),
  kanban_card_create: (args) => {
    const input = args.card as KanbanCard;
    const target = findColumn(args.columnId as string)!;
    const created = { ...input, columnId: target.id, createdAt: Date.now(), updatedAt: Date.now() };
    const index = (args.index as number | null) ?? target.cards.length;
    target.cards.splice(index, 0, created);
    return clone(created);
  },
  kanban_card_update: (args) => {
    const input = args.card as KanbanCard;
    const current = findCard(input.id)!;
    Object.assign(current, input, { updatedAt: Date.now() });
    return clone(current);
  },
  kanban_card_move: (args) => {
    const current = findCard(args.id as string)!;
    const target = findColumn(args.columnId as string)!;
    withoutCard(current.id);
    if (current.columnId !== target.id) current.updatedAt = Date.now();
    current.columnId = target.id;
    target.cards.splice(args.index as number, 0, current);
  },
  kanban_card_delete: (args) => withoutCard(args.id as string),
  kanban_card_restore: (args) => {
    const restored = clone(args.card as KanbanCard);
    findColumn(restored.columnId)!.cards.splice(args.index as number, 0, restored);
    return clone(restored);
  },
  kanban_column_create: (args) => {
    const created = column(args.id as string, args.title as string, []);
    board.columns.push(created);
    return clone(created);
  },
  kanban_column_rename: (args) => {
    findColumn(args.id as string)!.title = args.title as string;
  },
  kanban_column_move: (args) => {
    const moved = findColumn(args.id as string)!;
    board.columns = board.columns.filter((item) => item !== moved);
    board.columns.splice(args.index as number, 0, moved);
  },
  kanban_column_delete: (args) => {
    board.columns = board.columns.filter((item) => item.id !== args.id);
  },
  kanban_column_restore: (args) => {
    board.columns.splice(args.index as number, 0, clone(args.column as KanbanColumn));
  },
  kanban_card_link_session: (args) => {
    const current = findCard(args.id as string)!;
    attachSession(current, (args.sessionId as string | null) ?? null);
    current.updatedAt = Date.now();
    return clone(current);
  },
  kanban_session_status: () => undefined,
  kanban_session_links: () =>
    board.columns.flatMap((entry) =>
      entry.cards.flatMap((item) =>
        item.session
          ? [{ sessionId: item.session.id, cardId: item.id, project: PROJECT, status: item.session.status }]
          : [],
      ),
    ),
  session_list_by_project: () =>
    Object.entries(SESSIONS).map(([id, session], index) => ({
      id,
      cwd: PROJECT,
      harness: session.harness,
      model: "default",
      runtimeMode: "default",
      title: session.title,
      createdAt: now - (index + 1) * DAY,
      updatedAt: now - index * 3_600_000,
    })),
};

mockWindows("main");
mockIPC(
  (command, payload) => {
    const handler = handlers[command];
    if (!handler) return null;
    const result = handler((payload ?? {}) as Args);
    if (command.startsWith("kanban_card") || command.startsWith("kanban_column")) {
      void emit(KANBAN_CHANGED, { project: PROJECT });
    }
    return result;
  },
  { shouldMockEvents: true },
);

Object.assign(window, {
  kanbanState: () =>
    board.columns.map((item) => ({ title: item.title, cards: item.cards.map((entry) => entry.id) })),
  kanbanSessionEvents: () => [...sessionEvents],
});

createRoot(document.getElementById("root")!).render(
  <div className="flex h-full w-full bg-background-base text-content">
    <KanbanView
      besideRail
      cwd={PROJECT}
      recents={[{ path: PROJECT, openedAt: now }]}
      liveSessions={liveSessions}
      onStartSession={(item) => sessionEvents.push(`start:${item.id}`)}
      onOpenSession={(sessionId) => {
        sessionEvents.push(`open:${sessionId}`);
      }}
      onClose={() => {}}
    />
  </div>,
);
