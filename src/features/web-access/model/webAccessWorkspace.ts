import { projectName } from "../../../shared/lib/paths";
import { getArtifact, type Artifact } from "../../artifacts/artifacts";
import { sessionArtifacts } from "../../artifacts/hooks/useArtifacts";
import {
  listPinnedArtifacts,
  projectArtifactScope,
} from "../../artifacts/model/pinnedArtifacts";
import {
  ARTIFACT_FILTERS,
  artifactKindLabel,
  artifactMarkdown,
  artifactMatchesFilter,
  extractSessionArtifacts,
  mergeArtifacts,
  type WorkspaceArtifact,
} from "../../artifacts/model/workspaceArtifacts";
import {
  collectNow,
  loadFeedItems,
  loadFeedOverview,
  markFeedItems,
  markFeedViewRead,
  metricsLine,
  removeFeedInterest,
  saveFeedInterest,
  scorePercent,
  type FeedCollector,
  type FeedItem,
  type FeedOverview,
  type FeedViewId,
} from "../../feed/model/feed";
import {
  loadTrending,
  type TrendingPage,
  type TrendingPeriod,
} from "../../feed/model/trending";
import { isFreeChatCwd } from "../../freechat/model/freeChatPath";
import { findIrgat, irgatLook } from "../../irgats/model/irgat";
import {
  CARD_SESSION_LABEL,
  SESSION_ATTENTION_LABEL,
  cardSessionView,
  liveCardSession,
  type CardSessionState,
} from "../../kanban/model/cardSession";
import {
  createKanbanCard,
  deleteKanbanCard,
  kanbanProject,
  loadKanbanBoard,
  moveKanbanCard,
  normalizeCardLabels,
  parseQuickCard,
  updateKanbanCard,
  MAX_CARD_TITLE,
  type KanbanBoard,
  type KanbanCard,
} from "../../kanban/model/kanban";
import {
  NOTES_CHANGED_EVENT,
  composeNoteMessage,
  deleteNote,
  getNote,
  loadNotes,
  noteComposerCard,
  notePreview,
  noteSourceProject,
  noteTitle,
  normalizeNoteTags,
  upsertNote,
  type Note,
} from "../../notes/notes";
import {
  getSession,
  listSessionsByProject,
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import type { Session } from "../../sessions/model/session";
import { readBinaryFile, readTextFile } from "../../../platform/tauri/fs";
import { sniffImageMime } from "../../files/model/filePreview";
import type {
  WebArtifact,
  WebArtifactRow,
  WebArtifacts,
  WebBoard,
  WebBoardCard,
  WebBoardProject,
  WebBoardSession,
  WebFeed,
  WebFeedItem,
  WebNote,
  WebNoteRow,
  WebNotes,
  WebTrending,
} from "./protocol";

/**
 * Feed, Notes, Board and Artifacts for the browser page: the desktop rail's
 * views, read and changed through the same stores the Mac uses, so both
 * always show the same thing.
 */
export type WorkspaceDeps = {
  feed: {
    overview: () => Promise<FeedOverview>;
    items: (
      view: FeedViewId,
      interestId: string | null,
      unreadOnly: boolean,
      offset: number,
      limit: number,
    ) => Promise<{ items: FeedItem[]; total: number }>;
    mark: (
      ids: string[],
      change: { read?: boolean; saved?: boolean; hidden?: boolean },
    ) => Promise<unknown>;
    markAll: (view: FeedViewId, interestId: string | null) => Promise<unknown>;
    saveInterest: (interest: {
      id?: string;
      title: string;
      description: string;
      enabled: boolean;
    }) => Promise<unknown>;
    removeInterest: (id: string) => Promise<unknown>;
    collect: (collector: FeedCollector) => Promise<unknown>;
    trending: (
      since: TrendingPeriod,
      language: string,
      refresh: boolean,
    ) => Promise<TrendingPage>;
  };
  notes: {
    list: () => Promise<Note[]>;
    get: (id: string) => Promise<Note | null>;
    save: (note: {
      id: string;
      title: string;
      body: string;
      tags: string[];
      finalizeSlug?: boolean;
    }) => Promise<Note>;
    remove: (id: string) => Promise<unknown>;
    /** Tells the Mac's Notes view to reload. */
    changed: () => void;
  };
  board: {
    load: (project: string) => Promise<KanbanBoard>;
    create: (
      columnId: string,
      card: { id: string; title: string; notes: string; labels: string[] },
      index?: number,
    ) => Promise<unknown>;
    update: (card: {
      id: string;
      title: string;
      notes: string;
      labels: string[];
    }) => Promise<unknown>;
    move: (id: string, columnId: string, index: number) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  };
  artifacts: {
    pinned: (scope: string) => readonly WorkspaceArtifact[];
    saved: (cwd: string) => Promise<SessionSummary[]>;
    session: (id: string) => Promise<Session | null>;
    document: (id: string) => Promise<Artifact | null>;
    readText: (path: string) => Promise<string>;
    readBytes: (path: string) => Promise<Uint8Array>;
  };
};

export const workspaceDefaults: WorkspaceDeps = {
  feed: {
    overview: loadFeedOverview,
    items: loadFeedItems,
    mark: markFeedItems,
    markAll: markFeedViewRead,
    saveInterest: saveFeedInterest,
    removeInterest: removeFeedInterest,
    collect: collectNow,
    trending: loadTrending,
  },
  notes: {
    list: () => loadNotes(true),
    get: getNote,
    save: upsertNote,
    remove: deleteNote,
    changed: () => window.dispatchEvent(new Event(NOTES_CHANGED_EVENT)),
  },
  board: {
    load: loadKanbanBoard,
    create: createKanbanCard,
    update: updateKanbanCard,
    move: moveKanbanCard,
    remove: deleteKanbanCard,
  },
  artifacts: {
    pinned: listPinnedArtifacts,
    saved: listSessionsByProject,
    session: getSession,
    document: getArtifact,
    readText: readTextFile,
    readBytes: readBinaryFile,
  },
};

/** What the workspace actions need of the page's own handler deps. */
export type WorkspaceHost = {
  sessions: () => readonly Session[];
  projects: () => readonly string[];
  freeChatDir: () => Promise<string>;
  newId: () => string;
  /** Opens a saved chat in this window without showing it on the Mac. */
  open: (sessionId: string) => Promise<Session | null | undefined>;
  /** Starts a chat the way the page's New chat does. */
  newChat: (input: Record<string, unknown>) => Promise<unknown>;
  workspace?: WorkspaceDeps;
};

type Input = Record<string, unknown>;

function text(input: Input, key: string, max = 100_000): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
}

function optional(input: Input, key: string, max = 200): string | null {
  const value = input[key];
  return typeof value === "string" && value && value.length <= max
    ? value
    : null;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, max);
}

// ---- Feed ----

const FEED_TABS: readonly FeedViewId[] = ["feed", "filtered", "saved"];
const FEED_PAGE = 30;
const TEXT_MAX = 4_000;

function feedTab(input: Input): FeedViewId {
  const view = input.view;
  return FEED_TABS.includes(view as FeedViewId) ? (view as FeedViewId) : "feed";
}

function webFeedItem(
  item: FeedItem,
  interests: ReadonlyMap<string, string>,
): WebFeedItem {
  return {
    id: item.id,
    source: item.source,
    url: /^https?:\/\//i.test(item.url) ? item.url : "",
    author: item.author,
    authorName: item.authorName,
    text: item.text.slice(0, TEXT_MAX),
    summary: item.summary,
    at: item.publishedAt ?? item.collectedAt,
    metrics: metricsLine(item.metrics),
    media: item.media.length,
    interest:
      (item.interestId ? interests.get(item.interestId) : undefined) ??
      item.agentInterest,
    score: item.score == null ? null : scorePercent(item.score),
    read: item.read,
    saved: item.saved,
    similar: item.similar,
  };
}

function collectorName(collector: FeedCollector | null): string | null {
  if (!collector) return null;
  const irgat = findIrgat(collector.irgatId);
  return irgat ? irgatLook(irgat).name : null;
}

async function feed(ws: WorkspaceDeps, input: Input): Promise<WebFeed> {
  const view = feedTab(input);
  const interestId = optional(input, "interestId");
  const offset = Math.max(0, Math.min(10_000, Number(input.offset) || 0));
  const [overview, page] = await Promise.all([
    ws.feed.overview(),
    ws.feed.items(
      view,
      interestId,
      input.unread === "1",
      0,
      offset + FEED_PAGE,
    ),
  ]);
  const titles = new Map(
    overview.interests.map((interest) => [interest.id, interest.title]),
  );
  const collected = Object.values(overview.lastCollected);
  return {
    interests: overview.interests.map((interest) => ({
      id: interest.id,
      title: interest.title,
      description: interest.description,
      enabled: interest.enabled,
    })),
    counts: {
      unread: overview.counts.unread,
      filtered: overview.counts.filtered,
      saved: overview.counts.saved,
    },
    scoring: overview.scoring,
    collector: collectorName(overview.collector),
    lastCollected: collected.length ? Math.max(...collected) : null,
    items: page.items.map((item) => webFeedItem(item, titles)),
    total: page.total,
  };
}

const PERIODS: readonly TrendingPeriod[] = ["daily", "weekly", "monthly"];

async function trending(ws: WorkspaceDeps, input: Input): Promise<WebTrending> {
  const since = PERIODS.includes(input.since as TrendingPeriod)
    ? (input.since as TrendingPeriod)
    : "daily";
  const language = optional(input, "language", 20) ?? "";
  const page = await ws.feed.trending(since, language, input.refresh === "1");
  return {
    fetchedAt: page.fetchedAt,
    repos: page.repos.map((repo) => ({
      fullName: repo.fullName,
      url: /^https:\/\//i.test(repo.url) ? repo.url : "",
      description: repo.description,
      language: repo.language,
      languageColor: /^#[0-9a-f]{3,8}$/i.test(repo.languageColor)
        ? repo.languageColor
        : "",
      stars: repo.stars,
      forks: repo.forks,
      periodStars: repo.periodStars,
    })),
  };
}

// ---- Notes ----

const NOTE_PICTURE = /!\[([^\]]*)\]\(<?\/note-assets\/[^)]*\)/g;
const PICTURE_TOKEN = /\*\(📷 Picture (\d+), on your Mac\)\*/g;

/**
 * Pictures in a note live in the Mac's app folder, which the page cannot
 * load: the phone sees a numbered placeholder for each.
 */
export function phoneNoteBody(body: string): string {
  let count = 0;
  return body.replace(
    NOTE_PICTURE,
    () => `*(📷 Picture ${++count}, on your Mac)*`,
  );
}

/** Puts the pictures back where the phone kept their placeholders. */
export function restoreNotePictures(edited: string, original: string): string {
  const pictures = [...original.matchAll(NOTE_PICTURE)].map(
    (match) => match[0],
  );
  return edited.replace(
    PICTURE_TOKEN,
    (token, index: string) => pictures[Number(index) - 1] ?? token,
  );
}

function noteRow(note: Note): WebNoteRow {
  return {
    id: note.id,
    title: note.title || "Untitled",
    preview: notePreview(note.body, note.title),
    tags: note.tags,
    project: noteSourceProject(note.sourceCwd),
    updatedAt: note.updatedAt,
  };
}

async function findNote(ws: WorkspaceDeps, input: Input): Promise<Note> {
  const note = await ws.notes.get(text(input, "id", 200));
  if (!note) throw new Error("This note was deleted on your Mac.");
  return note;
}

// ---- Board ----

/** The projects with a board: the recents, and the chats' own folder. */
async function boardProjects(host: WorkspaceHost): Promise<WebBoardProject[]> {
  const chat = await host.freeChatDir().catch(() => "");
  const recents = host
    .projects()
    .filter((path) => !isFreeChatCwd(path))
    .slice(0, 30)
    .map((path) => ({ path, label: projectName(path) }));
  return chat ? [...recents, { path: chat, label: "Chats" }] : recents;
}

async function requestedProject(
  host: WorkspaceHost,
  input: Input,
): Promise<{ project: WebBoardProject; projects: WebBoardProject[] }> {
  const projects = await boardProjects(host);
  const wanted = optional(input, "project", 2_000);
  const project = wanted
    ? projects.find((entry) => entry.path === wanted)
    : projects[0];
  if (!project)
    throw new Error(
      wanted
        ? "Pick one of your projects."
        : "Open a project on your Mac first.",
    );
  return { project, projects };
}

const STATE_TONE: Record<CardSessionState, WebBoardSession["tone"]> = {
  running: "accent",
  "needs-input": "amber",
  finished: "emerald",
  failed: "rose",
  stopped: "muted",
  draft: "muted",
  interrupted: "muted",
  missing: "muted",
};

function boardCard(
  card: KanbanCard,
  open: ReadonlyMap<string, Session>,
): WebBoardCard {
  const link = card.session;
  let session: WebBoardSession | null = null;
  if (link) {
    const loaded = open.get(link.id);
    const view = cardSessionView(
      link,
      loaded ? liveCardSession(loaded) : undefined,
    );
    session = {
      sessionId: link.id,
      label: view.attention
        ? SESSION_ATTENTION_LABEL[view.attention]
        : CARD_SESSION_LABEL[view.state],
      tone: STATE_TONE[view.state],
      live: !!loaded,
      saved: !!loaded || link.saved,
    };
  }
  return {
    id: card.id,
    title: card.title,
    notes: card.notes,
    labels: card.labels,
    updatedAt: card.updatedAt,
    session,
  };
}

async function board(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  input: Input,
): Promise<WebBoard> {
  const { project, projects } = await requestedProject(host, input);
  const loaded = await ws.board.load(project.path);
  const open = new Map(host.sessions().map((session) => [session.id, session]));
  return {
    project: project.path,
    label: project.label,
    projects,
    columns: loaded.columns.map((column) => ({
      id: column.id,
      title: column.title,
      cards: column.cards.map((card) => boardCard(card, open)),
    })),
  };
}

/** The card and its board, found on the project the page names. */
async function boardCardOf(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  input: Input,
) {
  const { project } = await requestedProject(host, input);
  const loaded = await ws.board.load(project.path);
  const id = text(input, "id", 200);
  for (const column of loaded.columns) {
    const card = column.cards.find((entry) => entry.id === id);
    if (card) return { board: loaded, column, card };
  }
  throw new Error("This card was moved or deleted on your Mac.");
}

async function boardColumn(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  input: Input,
) {
  const { project } = await requestedProject(host, input);
  const loaded = await ws.board.load(project.path);
  const id = text(input, "columnId", 200);
  const column = loaded.columns.find((entry) => entry.id === id);
  if (!column) throw new Error("That column no longer exists.");
  return column;
}

// ---- Artifacts ----

/** Saved chats a list reads, newest first, as the desktop's Artifacts tab. */
const SAVED_LIMIT = 40;
const IMAGE_MAX = 8 * 1024 * 1024;
const ARTIFACT_TEXT_MAX = 400_000;

type Remembered = { updatedAt: number; artifacts: WorkspaceArtifact[] };
const stored = new Map<string, Remembered>();
/** What the page was last shown, so opening one never takes a path from it. */
const shown = new Map<string, Map<string, WorkspaceArtifact>>();

export function resetWorkspaceCacheForTest() {
  stored.clear();
  shown.clear();
}

function samePath(a: string, b: string) {
  return kanbanProject(a) === kanbanProject(b);
}

async function projectArtifacts(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  cwd: string,
): Promise<{ artifacts: WorkspaceArtifact[]; failed: number }> {
  const scope = projectArtifactScope(cwd);
  const live = host
    .sessions()
    .filter(
      (session) =>
        samePath(session.cwd, cwd) &&
        !session.ephemeral &&
        !session.inboxAsk &&
        !session.sidebarHidden &&
        session.blocks.length > 0,
    );
  const open = new Set(live.map((session) => session.id));
  const summaries = (await ws.artifacts.saved(cwd).catch(() => []))
    .filter(
      (summary) => !summary.archived && !summary.draft && !open.has(summary.id),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SAVED_LIMIT);
  let failed = 0;
  const saved: WorkspaceArtifact[][] = [];
  for (let index = 0; index < summaries.length; index += 4) {
    const batch = summaries.slice(index, index + 4);
    const lists = await Promise.all(
      batch.map(async (summary) => {
        const known = stored.get(summary.id);
        if (known?.updatedAt === summary.updatedAt) return known.artifacts;
        const session = await ws.artifacts
          .session(summary.id)
          .catch(() => null);
        if (!session) {
          failed += 1;
          return [];
        }
        const artifacts = extractSessionArtifacts(session, {
          sessionTitle: summary.title || session.title,
          fallbackAt: summary.updatedAt,
          scope,
        });
        stored.set(summary.id, { updatedAt: summary.updatedAt, artifacts });
        return artifacts;
      }),
    );
    saved.push(...lists);
  }
  const artifacts = mergeArtifacts(
    ws.artifacts.pinned(scope),
    ...live.map((session) => sessionArtifacts(session, { scope })),
    ...saved,
  );
  return { artifacts, failed };
}

function artifactRow(artifact: WorkspaceArtifact): WebArtifactRow {
  return {
    id: artifact.id,
    title: artifact.title,
    format: artifact.format,
    kind: artifactKindLabel(artifact),
    filters: ARTIFACT_FILTERS.filter(
      (filter) =>
        filter.id !== "all" && artifactMatchesFilter(artifact, filter.id),
    ).map((filter) => filter.id),
    ...(artifact.path ? { path: artifact.path } : {}),
    ...(artifact.sessionId ? { sessionId: artifact.sessionId } : {}),
    ...(artifact.sessionTitle ? { sessionTitle: artifact.sessionTitle } : {}),
    pinned: !!artifact.pinned,
    createdAt: artifact.createdAt,
  };
}

async function artifacts(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  input: Input,
): Promise<WebArtifacts> {
  const { project, projects } = await requestedProject(host, {
    project: input.project,
  });
  const found = await projectArtifacts(host, ws, project.path);
  shown.set(
    project.path,
    new Map(found.artifacts.map((artifact) => [artifact.id, artifact])),
  );
  return {
    project: project.path,
    label: project.label,
    projects,
    artifacts: found.artifacts.map(artifactRow),
    failed: found.failed,
  };
}

/** Only an artifact this project lists: the page never names a file itself. */
async function findArtifact(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  input: Input,
): Promise<WorkspaceArtifact> {
  const { project } = await requestedProject(host, { project: input.project });
  const id = text(input, "id", 400);
  let artifact = shown.get(project.path)?.get(id);
  if (!artifact) {
    const found = await projectArtifacts(host, ws, project.path);
    artifact = found.artifacts.find((entry) => entry.id === id);
  }
  if (!artifact) throw new Error("This artifact is no longer in the project.");
  return artifact;
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

async function artifactText(
  ws: WorkspaceDeps,
  artifact: WorkspaceArtifact,
): Promise<{ text: string; stale?: string }> {
  try {
    if (artifact.path)
      return { text: await ws.artifacts.readText(artifact.path) };
    if (artifact.documentId) {
      const saved = await ws.artifacts.document(artifact.documentId);
      if (!saved) throw new Error("This document is no longer available.");
      return { text: saved.body };
    }
    return { text: artifact.content ?? "" };
  } catch (cause) {
    const fallback =
      artifact.content ??
      (artifact.excerpt?.length ? artifact.excerpt.join("\n") : undefined);
    if (fallback == null) throw cause;
    return { text: fallback, stale: errorText(cause) };
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function artifact(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  input: Input,
): Promise<WebArtifact> {
  const found = await findArtifact(host, ws, input);
  const row = artifactRow(found);
  if (found.format === "image") {
    if (found.imageData)
      return { ...row, text: "", markdown: "", image: found.imageData };
    if (!found.path) throw new Error("This image is not on disk.");
    const bytes = await ws.artifacts.readBytes(found.path);
    if (bytes.length > IMAGE_MAX)
      throw new Error("This image is too big for the phone.");
    const mime = sniffImageMime(bytes);
    if (!mime) throw new Error("This file is not an image the page can show.");
    return {
      ...row,
      text: "",
      markdown: "",
      image: `data:${mime};base64,${base64(bytes)}`,
    };
  }
  const read = await artifactText(ws, found);
  const body =
    read.text.length > ARTIFACT_TEXT_MAX
      ? `${read.text.slice(0, ARTIFACT_TEXT_MAX)}\n…`
      : read.text;
  return {
    ...row,
    text: body,
    markdown: artifactMarkdown(found, body),
    ...(read.stale ? { stale: read.stale } : {}),
  };
}

/** The page of an HTML artifact, which the Mac serves into a sandboxed frame. */
async function artifactFrame(
  host: WorkspaceHost,
  ws: WorkspaceDeps,
  input: Input,
): Promise<string> {
  const found = await findArtifact(host, ws, input);
  if (found.format !== "html" && found.format !== "svg")
    throw new Error("Only pages and pictures have a preview.");
  const { text: body } = await artifactText(ws, found);
  return found.format === "svg"
    ? `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent}svg{max-width:100%;height:auto;display:block;margin:auto}</style>${body}`
    : body;
}

/**
 * Answers the Feed, Notes, Board and Artifacts calls, or `undefined` when
 * `action` is not one of them.
 */
export function handleWorkspaceAction(
  host: WorkspaceHost,
  action: string,
  input: Input,
): Promise<unknown> | undefined {
  const ws = host.workspace ?? workspaceDefaults;
  switch (action) {
    case "feed":
      return feed(ws, input);
    case "feedTrending":
      return trending(ws, input);
    case "feedMark":
      return (async () => {
        const ids = stringList(input.ids, 500);
        if (!ids.length) throw new Error("Missing ids");
        const change: { read?: boolean; saved?: boolean; hidden?: boolean } =
          {};
        for (const key of ["read", "saved", "hidden"] as const)
          if (typeof input[key] === "boolean")
            change[key] = input[key] as boolean;
        await ws.feed.mark(ids, change);
        return { marked: ids.length };
      })();
    case "feedMarkAll":
      return (async () => {
        await ws.feed.markAll(feedTab(input), optional(input, "interestId"));
        return { marked: true };
      })();
    case "feedInterest":
      return (async () => {
        const title = text(input, "title", 200).trim();
        if (!title) throw new Error("Give the interest a name.");
        const id = optional(input, "id");
        await ws.feed.saveInterest({
          ...(id ? { id } : {}),
          title,
          description:
            typeof input.description === "string"
              ? input.description.slice(0, 2_000)
              : "",
          enabled: input.enabled !== false,
        });
        return { saved: true };
      })();
    case "feedInterestDelete":
      return (async () => {
        await ws.feed.removeInterest(text(input, "id", 200));
        return { deleted: true };
      })();
    case "feedCollect":
      return (async () => {
        const overview = await ws.feed.overview();
        if (!overview.collector)
          throw new Error(
            "Pick an Irgat to collect the Feed on your Mac first.",
          );
        await ws.feed.collect(overview.collector);
        return { collecting: true };
      })();

    case "notes":
      return (async (): Promise<WebNotes> => {
        const notes = await ws.notes.list();
        return {
          notes: [...notes]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(noteRow),
        };
      })();
    case "note":
      return (async (): Promise<WebNote> => {
        const note = await findNote(ws, input);
        return { ...noteRow(note), body: phoneNoteBody(note.body) };
      })();
    case "noteSave":
      return (async () => {
        const id = optional(input, "id");
        const current = id ? await findNote(ws, input) : null;
        const body =
          "body" in input
            ? text(input, "body", 200_000).replace(/\r\n?/g, "\n")
            : (current?.body ?? "");
        const title =
          "title" in input
            ? text(input, "title", 200).trim()
            : (current?.title ?? "");
        if (!current && !title && !body.trim())
          throw new Error("Write the note first.");
        const saved = await ws.notes.save({
          id: current?.id ?? host.newId(),
          title: title || noteTitle(body),
          body: current ? restoreNotePictures(body, current.body) : body,
          tags:
            "tags" in input
              ? normalizeNoteTags(stringList(input.tags, 40))
              : (current?.tags ?? []),
          finalizeSlug: true,
        });
        ws.notes.changed();
        return { id: saved.id };
      })();
    case "noteDelete":
      return (async () => {
        const note = await findNote(ws, input);
        await ws.notes.remove(note.id);
        ws.notes.changed();
        return { deleted: true };
      })();
    case "noteChat":
      return (async () => {
        const note = await findNote(ws, input);
        if (!note.body.trim()) throw new Error("This note is empty.");
        const ask =
          typeof input.text === "string" ? input.text.slice(0, 20_000) : "";
        return host.newChat({
          text: composeNoteMessage(noteComposerCard(note), ask),
          ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
        });
      })();

    case "board":
      return board(host, ws, input);
    case "boardAdd":
      return (async () => {
        const column = await boardColumn(host, ws, input);
        const parsed = parseQuickCard(text(input, "text", 2_000));
        if (!parsed.title) throw new Error("Write the card first.");
        const id = host.newId();
        await ws.board.create(
          column.id,
          { id, title: parsed.title, notes: "", labels: parsed.labels },
          0,
        );
        return { id };
      })();
    case "boardUpdate":
      return (async () => {
        const { card } = await boardCardOf(host, ws, input);
        const title =
          "title" in input
            ? text(input, "title", MAX_CARD_TITLE * 2)
                .trim()
                .slice(0, MAX_CARD_TITLE)
            : card.title;
        if (!title) throw new Error("A card needs a title.");
        await ws.board.update({
          id: card.id,
          title,
          notes: "notes" in input ? text(input, "notes", 50_000) : card.notes,
          labels:
            "labels" in input
              ? normalizeCardLabels(stringList(input.labels, 10))
              : card.labels,
        });
        return { updated: true };
      })();
    case "boardMove":
      return (async () => {
        const { board: loaded, card } = await boardCardOf(host, ws, input);
        const columnId = text(input, "columnId", 200);
        if (!loaded.columns.some((column) => column.id === columnId))
          throw new Error("That column no longer exists.");
        const index = Number.isSafeInteger(input.index)
          ? Number(input.index)
          : 0;
        await ws.board.move(card.id, columnId, Math.max(0, index));
        return { moved: true };
      })();
    case "boardDelete":
      return (async () => {
        const { card } = await boardCardOf(host, ws, input);
        await ws.board.remove(card.id);
        return { deleted: true };
      })();
    case "boardOpenChat":
      return (async () => {
        const { card } = await boardCardOf(host, ws, input);
        if (!card.session) throw new Error("This card has no chat.");
        const session = await host.open(card.session.id);
        if (!session) throw new Error("This chat was deleted on your Mac.");
        return { sessionId: session.id };
      })();

    case "artifacts":
      return artifacts(host, ws, input);
    case "artifact":
      return artifact(host, ws, input);
    case "artifactFrame":
      return artifactFrame(host, ws, input);
    default:
      return undefined;
  }
}
