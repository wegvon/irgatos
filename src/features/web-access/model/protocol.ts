/**
 * What the browser page and the app's relay handler exchange. The page is a
 * thin client of the running app, so these are read-only snapshots of the
 * live state plus the few actions a phone or tablet needs.
 */
import type {
  AgentRole,
  AgentStatus,
  AgentSummary,
} from "../../agent-tree/model/agentTree";
import type { AgentTreeWindow } from "../../agent-tree/model/agentTreeStore";
import type { AutomationRunStatus } from "../../automations/model/automations";
import type { FleetEntry, FleetRequest } from "../../fleet/model/fleet";
import type { IdeasState } from "../../ideas/model/ideas";
import type { InboxKind, InboxProvider } from "../../inbox/model/githubTasks";
import type { AccountStatusTone } from "../../providers/model/accountUsage";
import type { RateLimitProvider } from "../../providers/model/rateLimits";
import type { IrgatStatus } from "../../irgats/model/irgat";
import type { ServiceStatus } from "../../service-status/model/serviceStatus";
import type {
  BlockRole,
  HarnessId,
  RuntimeMode,
} from "../../sessions/model/session";
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
  tool?: {
    label: string;
    status?: string;
    kind?: string;
    detail?: string;
    /** What the step printed or found, e.g. a command's output. */
    output?: string;
  };
  approval?: { requestId: number; decided?: "allow" | "deny" | "cancelled" };
  /** Attachments on a user turn, by name only. */
  files?: string[];
  /** Images on this block, loaded one by one with the `image` read. */
  images?: WebImage[];
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
  /** The model's own id, for the model picker. */
  modelId: string;
  /** Missing on a provider without access modes. */
  runtimeMode?: RuntimeMode;
  /** The model's reasoning effort, when it has one. */
  effort?: WebEffort;
};

/** `index` counts the block's images in the order the page got them. */
export type WebImage = { index: number; name: string };

export type WebImageData = { mimeType: string; data: string };

export type WebEffort = {
  id: string;
  value: string;
  options: { value: string; label: string }[];
};

export type WebModels = {
  harnesses: {
    harness: HarnessId;
    title: string;
    models: { id: string; name: string }[];
  }[];
};

/** A chat that is not open on the Mac, from its saved history. */
export type WebHistoryEntry = {
  sessionId: string;
  title: string;
  harness: HarnessId;
  projectLabel: string;
  branch?: string;
  updatedAt: number;
};

export type WebHistory = { chats: WebHistoryEntry[] };

export type WebBranches = {
  /** Empty when the folder is not a git repository. */
  current: string;
  branches: string[];
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
  /** The access a new chat gets on the Mac. */
  mode?: RuntimeMode;
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

/** One card of an Agent Tree, flattened in drawing order with its depth. */
export type WebAgent = {
  id: string;
  /** 0 for the top card: the app itself, or the Irgat. */
  depth: number;
  name: string;
  role: AgentRole;
  harness?: HarnessId;
  model: string;
  task: string;
  status: AgentStatus;
  activity?: string;
  error?: string;
  costUsd?: number;
  tokens?: number;
  /** Work time when the Mac answered. */
  durationMs?: number;
  startedAt?: number;
  /** The chat it opens; a subagent opens its parent's. */
  sessionId?: string;
};

/** A Claude Code session running on the Mac outside Irgatos. */
export type WebOutsideSession = {
  id: string;
  name: string;
  folder: string;
  /** "busy", "waiting" or "idle", as Claude Code reports it. */
  status: string;
  startedAt?: number;
  statusUpdatedAt?: number;
};

export type WebAgents = {
  window: AgentTreeWindow;
  agents: WebAgent[];
  summary: AgentSummary;
  outside: WebOutsideSession[];
};

export type WebAutomation = {
  id: string;
  name: string;
  prompt: string;
  /** Where its runs start: a project's name, or "Chat". */
  place: string;
  harness: HarnessId;
  modelName: string;
  /** "Daily at 9:00 AM", or the first event it reacts to. */
  trigger: string;
  enabled: boolean;
  /** 0 when only events start it. */
  nextRunAt: number;
  lastRunAt?: number;
  lastRunStatus?: AutomationRunStatus;
  lastRunError?: string;
  lastSessionId?: string;
};

export type WebAutomations = { automations: WebAutomation[] };

export type WebAutomationRun = {
  id: string;
  trigger: "scheduled" | "manual" | "event";
  status: AutomationRunStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  sessionId?: string;
  error?: string;
};

export type WebLabeled = { id: string; label: string };

/** An Irgat as its settings and Agents tabs show it on the Mac. */
export type WebIrgatDetail = {
  id: string;
  name: string;
  /** The name it goes by when the user gives it none. */
  defaultName: string;
  mascot: WebMascot;
  projects: { path: string; label: string }[];
  /** Its own chat, which carries its model and permissions. */
  sessionId: string;
  harness: HarnessId;
  model: string;
  modelName: string;
  runtimeMode: RuntimeMode;
  busy: boolean;
  showSessions: boolean;
  groupInFolder: boolean;
  soul: string;
  memory: { index: number; text: string; date?: string; struck: boolean }[];
  agents: WebAgent[];
};

/** What an Irgat's settings can pick from. */
export type WebIrgatOptions = {
  mascots: string[];
  colors: string[];
  projects: { path: string; label: string }[];
  harnesses: (WebLabeled & { models: WebLabeled[] })[];
  modes: (WebLabeled & { hint: string })[];
};

/** The Mac's voice settings the page follows. */
export type WebVoice = {
  dictation: boolean;
  /** Read a short summary rather than the whole reply. */
  summary: boolean;
  locale: string;
};

export type WebSpokenReply = {
  /** The words to read, in the pieces the Mac makes audio for. */
  parts: string[];
  /** A Gemini summary, not an excerpt of the reply. */
  summarized: boolean;
};

/** One chat found by the page's search; the Mac opens closed ones on demand. */
export type WebSearchHit = {
  sessionId: string;
  /** By title, by a message's words, or by meaning when no word matched. */
  kind: "chat" | "message" | "meaning";
  title: string;
  place: string;
  harness: HarnessId;
  updatedAt: number;
  preview?: string;
};

export type WebSearch = {
  query: string;
  hits: WebSearchHit[];
  /** How meaning search stands, when it is not simply on. */
  note: string | null;
};

export type WebInboxItem = {
  key: string;
  provider: InboxProvider;
  kind: InboxKind;
  /** "#12" or a tracker id like "APP-7". */
  ref: string;
  title: string;
  /** The repository, or the tracker team. */
  source: string;
  place: string;
  url: string;
  status: string;
  updatedAt: number;
  labels: { name: string; color: string }[];
  /** Updated since it was last opened, on the Mac or here. */
  unseen: boolean;
  needsAction: boolean;
  snoozedUntil?: number;
  /** Why GitLab or Azure DevOps put it on the user's to-do list. */
  attention?: string;
  agentChats: number;
};

export type WebInbox = {
  items: WebInboxItem[];
  /** Per-source fetch problems, e.g. a GitHub rate limit. */
  errors: string[];
  at: number;
};

export type WebInboxDetail = {
  item: WebInboxItem;
  body: string;
  author?: string;
};

export type WebUsageWindow = {
  title: string;
  usedPercent: number;
  resetsAt: number | null;
};

export type WebUsageAccount = {
  provider: RateLimitProvider;
  title: string;
  /** Set only when the provider has more than one account. */
  account?: string;
  tone: AccountStatusTone;
  status: string;
  detail?: string;
  windows: WebUsageWindow[];
  /** Devin's extra usage balance in dollars. */
  extra?: number;
};

export type WebUsage = {
  accounts: WebUsageAccount[];
  /** The Mac's "show remaining" setting, so both read the same way. */
  showRemaining: boolean;
  at: number;
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
  "html" | "svg" | "mermaid" | "markdown" | "code" | "image";

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

/** One Gmail account on the Mac; `id` is its Executor connection. */
export type WebMailAccount = { id: string; email: string };

export type WebMailRow = {
  account: string;
  id: string;
  subject: string;
  from: string;
  /** The sender's name, or the address when it has none. */
  sender: string;
  snippet: string;
  date: number;
  unread: boolean;
  messageCount: number;
};

export type WebMail = {
  /** False until Mail is set up in the Mac's settings. */
  configured: boolean;
  accounts: WebMailAccount[];
  /** Newest first across the accounts asked for. */
  threads: WebMailRow[];
  /** Hand back as `more` to load the next page; empty at the end. */
  more: string;
  errors: { account: string; message: string }[];
};

export type WebMailMessage = {
  id: string;
  from: string;
  sender: string;
  to: string;
  cc: string;
  date: number;
  body: string;
  quoted: string;
  attachments: string[];
  /** Sent by the account itself, or another of the user's accounts. */
  mine: boolean;
  /** Why some of the sender's text is not shown; the text stays on the Mac. */
  hidden?: { warning: boolean; text: string };
};

/** A thread to read; replying and sending stay on the Mac. */
export type WebMailThread = {
  account: string;
  id: string;
  subject: string;
  unread: boolean;
  messages: WebMailMessage[];
  /** The latest reply draft, e.g. one an agent saved. */
  draft?: string;
};
