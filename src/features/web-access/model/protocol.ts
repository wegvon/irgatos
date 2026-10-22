/**
 * What the browser page and the app's relay handler exchange. The page is a
 * thin client of the running app, so these are read-only snapshots of the
 * live state plus the few actions a phone or tablet needs.
 */
import type { FleetEntry, FleetRequest } from "../../fleet/model/fleet";
import type { IdeasState } from "../../ideas/model/ideas";
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
