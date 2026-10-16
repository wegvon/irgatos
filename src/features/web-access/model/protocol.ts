/**
 * What the browser page and the app's relay handler exchange. The page is a
 * thin client of the running app, so these are read-only snapshots of the
 * live state plus the few actions a phone or tablet needs.
 */
import type { FleetEntry, FleetRequest } from "../../fleet/model/fleet";
import type { IdeasState } from "../../ideas/model/ideas";
import type { ServiceStatus } from "../../service-status/model/serviceStatus";
import type { BlockRole, HarnessId } from "../../sessions/model/session";

export type WebOverview = {
  needsYou: FleetEntry[];
  running: FleetEntry[];
  review: FleetEntry[];
  interrupted: FleetEntry[];
  idle: FleetEntry[];
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
  cwd: string;
  projectLabel: string;
  branch?: string;
  busy: boolean;
  activity?: string;
  requests: FleetRequest[];
  /** Older messages left on the Mac. */
  omitted: number;
  blocks: WebBlock[];
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
