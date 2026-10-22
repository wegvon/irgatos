/**
 * What the browser page and the app's relay handler exchange. The page is a
 * thin client of the running app, so these are read-only snapshots of the
 * live state plus the few actions a phone or tablet needs.
 */
import type { FleetEntry, FleetRequest } from "../../fleet/model/fleet";
import type { IdeasState } from "../../ideas/model/ideas";
import type { IrgatStatus } from "../../irgats/model/irgat";
import type { ServiceStatus } from "../../service-status/model/serviceStatus";
import type { BlockRole, HarnessId } from "../../sessions/model/session";
import type { ThemePalette } from "../../settings/model/appearance";

export type WebAppearance = {
  preference: "system" | "dark" | "light";
  hue: number;
  saturation: number;
  darkLightness: number;
  accent: string | null;
  /** Missing in appearances cached by an older page. */
  palette?: ThemePalette;
};

export type WebOverview = {
  needsYou: FleetEntry[];
  running: FleetEntry[];
  review: FleetEntry[];
  interrupted: FleetEntry[];
  idle: FleetEntry[];
  appearance: WebAppearance;
  /** The Mac user's first name, for the greeting; empty when unknown. */
  owner: string;
  /** The Mac's clock, so ages read right on a device whose clock is off. */
  at: number;
};

export type WebBlock = {
  id: string;
  role: BlockRole;
  text: string;
  streaming?: boolean;
  tool?: { label: string; status?: string; kind?: string; detail?: string };
  approval?: { requestId: number; decided?: "allow" | "deny" | "cancelled" };
  /** Attachments on a user turn, by name only. */
  files?: string[];
  at?: number;
  durationMs?: number;
};

export type WebSession = {
  id: string;
  title: string;
  harness: HarnessId;
  model: string;
  irgat?: string;
  /** The Irgat's mascot, for its own chats. */
  mascot?: WebMascot;
  cwd: string;
  projectLabel: string;
  branch?: string;
  busy: boolean;
  activity?: string;
  requests: FleetRequest[];
  /** Older messages left on the Mac. */
  omitted: number;
  blocks: WebBlock[];
  /** An Irgat's own chat goes with the Irgat, so only the Mac deletes it. */
  deletable: boolean;
};

export type WebHarnessChoice = {
  harness: HarnessId;
  title: string;
  model: string;
  modelName: string;
};

export type WebProject = {
  /** Empty for a free chat, which the Mac places in its scratch folder. */
  path: string;
  label: string;
  /** The provider and model a new chat here starts with. */
  choice: WebHarnessChoice;
};

export type WebProjects = {
  projects: WebProject[];
  harnesses: WebHarnessChoice[];
};

export type WebIdeas = IdeasState;

export type WebServices = { services: (ServiceStatus & { label: string })[] };

export type WebMascot = { name: string; color: string };

/** One of an Irgat's extra chats; the Irgat itself opens its main one. */
export type WebIrgatChat = {
  sessionId: string;
  title: string;
  /** Unknown until the chat is loaded on the Mac. */
  status: IrgatStatus;
};

export type WebIrgat = {
  id: string;
  name: string;
  mascot: WebMascot;
  /** The projects it works on, by their sidebar names. */
  projects: string[];
  /** Its most pressing chat: waiting on you, then working, then the main one. */
  status: IrgatStatus;
  activity?: string;
  chats: WebIrgatChat[];
};

export type WebIrgats = {
  /** Irgats can be turned off in the Mac's settings. */
  enabled: boolean;
  irgats: WebIrgat[];
};

// ---- Feed, Notes, Board and Artifacts, as the desktop rail shows them ----

export type WebFeedTab = "feed" | "filtered" | "saved";

export type WebFeedInterest = {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
};

export type WebFeedItem = {
  id: string;
  source: string;
  url: string;
  author: string;
  authorName: string;
  text: string;
  summary: string;
  at: number;
  /** "1.2K likes · 30 reposts". */
  metrics: string;
  /** Pictures stay on the post: the page loads nothing from other sites. */
  media: number;
  interest: string;
  /** Match with the interest, in percent. */
  score: number | null;
  read: boolean;
  saved: boolean;
  similar: number;
};

export type WebFeed = {
  interests: WebFeedInterest[];
  counts: { unread: number; filtered: number; saved: number };
  /** Smart Search is on, so posts are matched by meaning. */
  scoring: boolean;
  /** An Irgat collects the feed, so Collect now can run it. */
  collector: string | null;
  lastCollected: number | null;
  items: WebFeedItem[];
  total: number;
};

export type WebTrendingRepo = {
  fullName: string;
  url: string;
  description: string;
  language: string;
  languageColor: string;
  stars: number;
  forks: number;
  periodStars: number;
};

export type WebTrending = { repos: WebTrendingRepo[]; fetchedAt: number };

export type WebNoteRow = {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  /** The project it was saved from, when there is one. */
  project: string | null;
  updatedAt: number;
};

export type WebNotes = { notes: WebNoteRow[] };

export type WebNote = WebNoteRow & { body: string };

export type WebBoardProject = { path: string; label: string };

export type WebBoardSession = {
  sessionId: string;
  /** "Running", "Need approval", "Finished"… */
  label: string;
  tone: "amber" | "accent" | "emerald" | "rose" | "muted";
  /** Open in this window, so the chat opens right away. */
  live: boolean;
  /** Stored on the Mac, so it can still be opened. */
  saved: boolean;
};

export type WebBoardCard = {
  id: string;
  title: string;
  notes: string;
  labels: string[];
  updatedAt: number;
  session: WebBoardSession | null;
};

export type WebBoardColumn = {
  id: string;
  title: string;
  cards: WebBoardCard[];
};

export type WebBoard = {
  project: string;
  label: string;
  projects: WebBoardProject[];
  columns: WebBoardColumn[];
};

export type WebArtifactFormat =
  | "html"
  | "svg"
  | "mermaid"
  | "markdown"
  | "code"
  | "image";

export type WebArtifactRow = {
  id: string;
  title: string;
  format: WebArtifactFormat;
  /** "HTML", "Doc", "TypeScript"… */
  kind: string;
  /** "Files", "Docs"… as the desktop's filter chips. */
  filters: string[];
  path?: string;
  sessionId?: string;
  sessionTitle?: string;
  pinned: boolean;
  createdAt: number;
};

export type WebArtifacts = {
  project: string;
  label: string;
  projects: WebBoardProject[];
  artifacts: WebArtifactRow[];
  /** Saved chats that could not be read. */
  failed: number;
};

export type WebArtifact = WebArtifactRow & {
  /** Text for documents, code and sources; empty for images. */
  text: string;
  /** Markdown that shows it: the document itself, or the code in a fence. */
  markdown: string;
  /** A data URL for an image. */
  image?: string;
  /** The file is gone, so this is what the chat last showed of it. */
  stale?: string;
};
