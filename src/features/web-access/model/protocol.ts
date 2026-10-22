/**
 * What the browser page and the app's relay handler exchange. The page is a
 * thin client of the running app, so these are read-only snapshots of the
 * live state plus the few actions a phone or tablet needs.
 */
import type { FleetEntry, FleetRequest } from "../../fleet/model/fleet";
import type { IdeasState } from "../../ideas/model/ideas";
import type {
  InboxKind,
  InboxProvider,
} from "../../inbox/model/githubTasks";
import type { AccountStatusTone } from "../../providers/model/accountUsage";
import type { RateLimitProvider } from "../../providers/model/rateLimits";
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
