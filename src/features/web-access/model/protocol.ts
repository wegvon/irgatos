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
