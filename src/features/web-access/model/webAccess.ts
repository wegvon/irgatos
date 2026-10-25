import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ApprovalDecision } from "../../../integrations/harness";
import { homeDir } from "../../../platform/tauri/fs";
import { projectName } from "../../../shared/lib/paths";
import {
  buildFleet,
  fleetActivity,
  fleetRequests,
} from "../../fleet/model/fleet";
import {
  isFreeChatCwd,
  resolveFreeChatDir,
} from "../../freechat/model/freeChat";
import {
  createCard,
  deleteCard,
  loadIdeas,
  moveCard,
  parseQuickIdea,
  updateCard,
  type IdeaCardInput,
  type IdeasState,
  type IdeaTask,
} from "../../ideas/model/ideas";
import {
  findIrgat,
  irgatForSession,
  irgatLook,
  irgatSessionIds,
  irgatState,
  listIrgats,
  updateIrgat,
  type Irgat,
  type IrgatState,
} from "../../irgats/model/irgat";
import {
  createIrgatChildSession,
  deleteIrgatChildSession,
  ensureIrgatSession,
} from "../../irgats/model/irgatWorkspace";
import { hiddenTextNotice } from "../../mail/model/hiddenText";
import {
  MAIL_FOLDERS,
  isFromMe,
  listMail,
  loadMailAccounts,
  loadMailSettings,
  loadMailThread,
  mailQuery,
  modifyMailThread,
  senderName,
  type MailAccount,
  type MailFolderId,
  type MailPage,
  type MailThread,
} from "../../mail/model/mail";
import { loadRecents } from "../../projects/model/recents";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import {
  checkServices,
  serviceIds,
  serviceLabel,
  type ServiceStatus,
} from "../../service-status/model/serviceStatus";
import {
  listRecentSessions,
  upsertSession,
  type SessionSummary,
} from "../../sessions/data/sessionStore";
import { gitBranches, type GitBranches } from "../../../platform/tauri/fs";
import {
  MAX_ATTACHMENTS,
  MAX_EMBED_BYTES,
  attachmentsFromFiles,
} from "../../sessions/model/attachments";
import { loadIrgatsEnabled } from "../../settings/model/settings";
import {
  loadAccentColor,
  loadThemeDarkLightness,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
  loadThemePalette,
} from "../../settings/model/appearance";
import {
  hasProbedHarnessAvailability,
  isHarnessAvailable,
} from "../../../integrations/harness/core/availabilityState";
import {
  defaultSessionChoice,
  modelEffortSetting,
  modelsFor,
  resolveModel,
  showProviderInModelPicker,
  type AgentModel,
} from "../../sessions/model/models";
import {
  HARNESSES,
  HARNESS_TITLE,
  RUNTIME_MODES,
  sessionDisplayTitle,
  sessionWorkCwd,
  type Attachment,
  type Block,
  type HarnessId,
  type RuntimeMode,
  type Session,
} from "../../sessions/model/session";
import { toolCallLabel } from "../../sessions/model/transcriptActivity";
import {
  buildQuestionReply,
  type UserQuestionReply,
} from "../../sessions/model/userQuestion";
import { loadVoiceSettings } from "../../voice/model/voiceSettings";
import {
  handleWebAgents,
  isWebAgentsAction,
  type WebAgentsDeps,
} from "./webAccessAgents";
import {
  handleWorkspaceAction,
  type WorkspaceDeps,
} from "./webAccessWorkspace";
import type {
  WebAppearance,
  WebBlock,
  WebBranches,
  WebEffort,
  WebHarnessChoice,
  WebHistory,
  WebImageData,
  WebModels,
  WebIrgat,
  WebIrgats,
  WebMail,
  WebMailThread,
  WebOverview,
  WebProjects,
  WebServices,
  WebSession,
} from "./protocol";
import {
  inboxChatPrompt,
  webInbox,
  webInboxDetail,
  webLookupDefaults,
  webSearch,
  webUsage,
  type WebLookupDeps,
} from "./webLookups";
import { settleSecretApproval, type SecretApproval } from "../../secrets/model/secrets";

/**
 * Browser access: the Rust side serves a small page to the user's other
 * devices and relays each API call here, so the browser always reads and
 * acts on this window's live sessions.
 */
export type WebAccessDeps = {
  sessions: () => readonly Session[];
  /** A `plan` turn asks the agent for a plan first, as the composer's Plan does. */
  submit: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options?: { intent?: "plan" },
  ) => boolean;
  /** Loads a saved chat into this window without showing it on the Mac. */
  openStored: (sessionId: string) => Promise<Session | null>;
  /** The composer's model picker, effort and access pickers. */
  setModel: (sessionId: string, harness: HarnessId, model: string) => void;
  setModelSettings: (
    sessionId: string,
    settings: Record<string, string>,
  ) => void;
  setRuntimeMode: (sessionId: string, mode: RuntimeMode) => void;
  /** Saved chats across every project, newest first. */
  history: () => Promise<SessionSummary[]>;
  models: (harness: HarnessId) => AgentModel[];
  branches: (cwd: string) => Promise<GitBranches>;
  /** A file on the Mac as base64, for an image a chat shows. */
  readFile: (path: string) => Promise<string>;
  /** Turns a file the page uploaded into an attachment, as a paste does. */
  attach: (file: File) => Promise<Attachment | null>;
  approve: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  /** Answers a vault approval card as the card on the Mac would. */
  answerSecretApproval: (
    blockId: string,
    approval: SecretApproval,
    answer: "once" | "chat" | "deny",
  ) => Promise<void>;
  answer: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ) => void;
  stop: (sessionId: string) => void;
  /** Starts a new chat the way the floating composer does. */
  launch: (launch: QuickLaunch, sessionId: string) => Promise<void>;
  /** Loads an Irgat's chats into this window without showing them on the Mac. */
  irgatHost: IrgatHost;
  irgatsEnabled: () => boolean;
  /** Stores a new chat before it is shown, as the desktop's own does. */
  saveSession: (session: Session) => Promise<unknown>;
  /** Renames a chat the way the sidebar does. */
  rename: (sessionId: string, title: string) => Promise<void>;
  /** Deletes a chat without the Mac's confirmation: the page asked. */
  remove: (sessionId: string) => Promise<boolean>;
  /** Recent project folders, newest first. */
  projects: () => readonly string[];
  freeChatDir: () => Promise<string>;
  choice: (cwd?: string) => { harness: HarnessId; model: string };
  harnesses: () => HarnessId[];
  modelName: (harness: HarnessId, model: string) => string;
  appearance: () => WebAppearance;
  /** The Mac user's first name, for the page's greeting. */
  owner: () => Promise<string>;
  ideas: {
    load: () => Promise<IdeasState>;
    create: (
      listId: string,
      card: IdeaCardInput,
      index?: number,
    ) => Promise<unknown>;
    update: (card: IdeaCardInput) => Promise<unknown>;
    move: (id: string, listId: string, index: number) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  };
  services: () => Promise<ServiceStatus[]>;
  /** Gmail through Executor, read only: nothing here sends or deletes. */
  mail: {
    configured: () => Promise<boolean>;
    accounts: () => Promise<MailAccount[]>;
    list: (
      query: string,
      accounts: string[],
      pageTokens: Record<string, string> | null,
    ) => Promise<MailPage>;
    thread: (account: string, threadId: string) => Promise<MailThread>;
    markRead: (account: string, threadId: string) => Promise<void>;
  };
  newId: () => string;
  /** Fleet agents, automations, Irgat settings and voice. */
  agents?: WebAgentsDeps;
  /** Search, Inbox and usage limits; missing where a test leaves them out. */
  lookups?: WebLookupDeps;
  /** Feed, Notes, Board and Artifacts; the app's own stores when left out. */
  workspace?: WorkspaceDeps;
};

type IrgatHost = Parameters<typeof ensureIrgatSession>[1];

let owner: Promise<string> | undefined;

/** "/Users/turel" → "Turel": the home folder is named after the account. */
export function ownerName(home: string): string {
  const name =
    home
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  return name ? name[0]!.toUpperCase() + name.slice(1) : "";
}

/** The parts that read the app's own settings and stores, not live React state. */
export const webAccessDefaults: Omit<
  WebAccessDeps,
  | "sessions"
  | "submit"
  | "approve"
  | "answer"
  | "stop"
  | "launch"
  | "irgatHost"
  | "rename"
  | "remove"
  | "openStored"
  | "setModel"
  | "setModelSettings"
  | "setRuntimeMode"
> = {
  attach: async (file) => (await attachmentsFromFiles([file]))[0] ?? null,
  answerSecretApproval: settleSecretApproval,
  projects: () => loadRecents().map((project) => project.path),
  freeChatDir: resolveFreeChatDir,
  choice: (cwd) => defaultSessionChoice(cwd),
  harnesses: () =>
    HARNESSES.filter((id) =>
      showProviderInModelPicker(
        id,
        isHarnessAvailable(id),
        hasProbedHarnessAvailability(),
      ),
    ),
  modelName: (harness, model) => resolveModel(harness, model).name,
  appearance: () => ({
    preference: loadThemePreference(),
    hue: loadThemeHue(),
    saturation: loadThemeSaturation(),
    darkLightness: loadThemeDarkLightness(),
    accent: loadAccentColor(),
    palette: loadThemePalette(),
  }),
  owner: () => (owner ??= homeDir().then(ownerName, () => "")),
  ideas: {
    load: loadIdeas,
    create: createCard,
    update: updateCard,
    move: moveCard,
    remove: deleteCard,
  },
  services: () => checkServices(serviceIds(loadVoiceSettings())),
  mail: {
    configured: () =>
      loadMailSettings().then(
        (settings) => !!settings.endpoint && settings.hasKey,
      ),
    accounts: () => loadMailAccounts(),
    list: listMail,
    thread: loadMailThread,
    markRead: (account, threadId) =>
      modifyMailThread(account, threadId, "read"),
  },
  irgatsEnabled: loadIrgatsEnabled,
  saveSession: upsertSession,
  newId: () => crypto.randomUUID(),
  history: () => listRecentSessions(HISTORY_LIMIT),
  models: modelsFor,
  branches: gitBranches,
  readFile: (path) => invoke<string>("read_file_base64", { path }),
  lookups: webLookupDefaults,
};

export type WebAccessStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
  error: string | null;
  urls: string[];
  tailscale: boolean;
};

/** Newest blocks a browser gets per session; older ones stay on the Mac. */
export const WEB_TRANSCRIPT_LIMIT = 80;
/** How far "Show earlier messages" can reach back in one read. */
export const WEB_TRANSCRIPT_MAX = 2_000;
const TEXT_MAX = 20_000;
const STEP_TEXT_MAX = 4_000;
/** Saved chats the history list offers; search reaches the rest. */
const HISTORY_LIMIT = 200;
const PROJECTS_LIMIT = 200;
/** Base64 of an 8 MB image; bigger ones stay on the Mac. */
const IMAGE_MAX = 11_200_000;
/** The Fx provider has no access modes; its composer hides the picker. */
const NO_ACCESS_MODES: readonly HarnessId[] = ["fx"];

type Input = Record<string, unknown>;

function text(input: Input, key: string, max = 100_000): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
}

/**
 * Files the page sends in pieces, each under the relay's body limit, then
 * names in its next message. Kept in memory for an hour; a message takes
 * the ones it names.
 */
type Upload = {
  name: string;
  type: string;
  parts: string[];
  length: number;
  at: number;
  file?: Attachment;
};
const uploads = new Map<string, Upload>();
const UPLOAD_TTL = 60 * 60 * 1000;
/** Base64 of the largest file a chat embeds. */
const MAX_UPLOAD_CHARS = Math.ceil(MAX_EMBED_BYTES / 3) * 4;

async function receiveUpload(deps: WebAccessDeps, input: Input) {
  const now = Date.now();
  for (const [id, upload] of uploads)
    if (now - upload.at > UPLOAD_TTL) uploads.delete(id);
  const chunk = text(input, "chunk", 400_000);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(chunk))
    throw new Error("The file arrived damaged. Try again.");
  let id = typeof input.uploadId === "string" ? input.uploadId : "";
  let upload = id ? uploads.get(id) : undefined;
  if (id && !upload) throw new Error("The upload expired. Attach it again.");
  if (!upload) {
    if (uploads.size >= 50) throw new Error("Too many files at once.");
    id = crypto.randomUUID();
    upload = {
      name: text(input, "name", 200).trim() || "file",
      type: typeof input.type === "string" ? input.type.slice(0, 100) : "",
      parts: [],
      length: 0,
      at: now,
    };
    uploads.set(id, upload);
  }
  upload.parts.push(chunk);
  upload.length += chunk.length;
  upload.at = now;
  if (upload.length > MAX_UPLOAD_CHARS) {
    uploads.delete(id);
    throw new Error(
      `Files up to ${MAX_EMBED_BYTES / 1024 / 1024} MB can be attached.`,
    );
  }
  if (input.last !== true) return { uploadId: id };
  const data = upload.parts.join("");
  upload.parts = [];
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const file = await deps.attach(
    new File([bytes], upload.name, { type: upload.type }),
  );
  if (!file) {
    uploads.delete(id);
    throw new Error(`Irgatos could not attach ${upload.name}.`);
  }
  upload.file = file;
  return { uploadId: id, name: file.name, size: file.size, kind: file.kind };
}

/** The finished uploads a message names, taken out of the store. */
function takeUploads(input: Input): Attachment[] {
  const ids = Array.isArray(input.files)
    ? input.files.filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length > MAX_ATTACHMENTS)
    throw new Error(`Attach up to ${MAX_ATTACHMENTS} files at a time.`);
  const files = ids.map((id) => {
    const file = uploads.get(id)?.file;
    if (!file) throw new Error("A file is missing. Attach it again.");
    return file;
  });
  for (const id of ids) uploads.delete(id);
  return files;
}

function requestId(input: Input): number {
  const value = Number(input.requestId);
  if (!Number.isSafeInteger(value)) throw new Error("Missing requestId");
  return value;
}

function irgatName(sessionId: string): string | undefined {
  const irgat = irgatForSession(sessionId);
  return irgat ? irgatLook(irgat).name : undefined;
}

/**
 * A chat open in this window. An Irgat's chats load on demand, as the Mac
 * itself only loads them when they are opened there.
 */
async function findSession(
  deps: WebAccessDeps,
  input: Input,
): Promise<Session> {
  const id = text(input, "sessionId" in input ? "sessionId" : "id", 200);
  const session = deps.sessions().find((entry) => entry.id === id);
  if (session) return session;
  if (deps.irgatsEnabled() && irgatForSession(id)) {
    const loaded = await deps.irgatHost.load(id);
    if (loaded) return loaded;
  }
  // A chat from the history opens on the page the way it opens on the Mac.
  const stored = await deps.openStored(id);
  if (stored) return stored;
  throw new Error("This chat is not open in Irgatos.");
}

function requestedIrgat(deps: WebAccessDeps, input: Input): Irgat {
  if (!deps.irgatsEnabled())
    throw new Error("Irgats are turned off on your Mac.");
  const irgat = findIrgat(text(input, "irgatId", 200));
  if (!irgat) throw new Error("That Irgat no longer exists.");
  return irgat;
}

const IDLE: IrgatState = { status: "idle" };

/**
 * The Irgat as the desktop rail shows it: its look, and the state of the
 * chat that matters most. Chats not loaded on the Mac read as idle.
 */
function webIrgat(irgat: Irgat, open: ReadonlyMap<string, Session>): WebIrgat {
  const look = irgatLook(irgat);
  const states = irgatSessionIds(irgat).flatMap((id) => {
    const session = open.get(id);
    return session ? [irgatState(session)] : [];
  });
  const state =
    states.find((entry) => entry.status === "needs-you") ??
    states.find((entry) => entry.status === "working") ??
    states[0] ??
    IDLE;
  return {
    id: irgat.id,
    name: look.name,
    mascot: { name: look.mascot, color: look.color },
    projects: look.projects.map((project) => project.name),
    status: state.status,
    ...(state.activity ? { activity: state.activity } : {}),
    chats: (irgat.childSessionIds ?? []).map((sessionId, index) => {
      const session = open.get(sessionId);
      return {
        sessionId,
        title: session
          ? sessionDisplayTitle(session.title, session.harness)
          : `Chat ${index + 1}`,
        status: session ? irgatState(session).status : "idle",
      };
    }),
  };
}

function clip(value: string, max = TEXT_MAX): string {
  return value.length > max
    ? `${value.slice(0, max)}\n\n… (open on the Mac for the rest)`
    : value;
}

function shownBlock(block: Block): boolean {
  return !block.internal && !block.draft && !block.irgatSessionCompletion;
}

function toolDetail(block: Block): string | undefined {
  const preview = block.tool?.preview;
  const raw =
    (preview?.kind === "shell" ? preview.query : undefined) ??
    block.tool?.detail ??
    "";
  const detail = raw.trim();
  return detail ? clip(detail, STEP_TEXT_MAX) : undefined;
}

function toolOutput(block: Block): string | undefined {
  const output = block.tool?.preview?.output?.trim();
  return output ? clip(output, STEP_TEXT_MAX) : undefined;
}

type ImageSource = {
  name: string;
  mimeType: string;
  path?: string;
  data?: string;
};

/** The block's images in a fixed order, so `index` names one across reads. */
function imageSources(block: Block): ImageSource[] {
  return [
    ...(block.image ? [block.image] : []),
    ...(block.attachments ?? []).filter(
      (file) => file.kind === "image" && (file.data || file.path),
    ),
  ];
}

export function webBlock(block: Block, cwd: string): WebBlock {
  const detail = block.tool ? toolDetail(block) : undefined;
  const output = block.tool ? toolOutput(block) : undefined;
  const images = imageSources(block);
  const files = (block.attachments ?? []).filter(
    (file) => !images.includes(file),
  );
  const at = block.sentAt ?? block.startedAt;
  return {
    id: block.id,
    role: block.role,
    text: block.role === "tool" ? "" : clip(block.text ?? ""),
    ...(block.streaming ? { streaming: true } : {}),
    ...(block.tool
      ? {
          tool: {
            label: toolCallLabel(block, cwd),
            ...(block.tool.status ? { status: block.tool.status } : {}),
            ...(block.tool.kind ? { kind: block.tool.kind } : {}),
            ...(detail ? { detail } : {}),
            ...(output ? { output } : {}),
          },
        }
      : {}),
    ...(block.approval
      ? {
          approval: {
            requestId: block.approval.requestId,
            ...(block.approval.decided
              ? { decided: block.approval.decided }
              : {}),
          },
        }
      : {}),
    ...(block.secretApproval
      ? {
          secretApproval: {
            name: block.secretApproval.name,
            label: block.secretApproval.label,
            target: block.secretApproval.target,
            state: block.secretApproval.state,
          },
        }
      : {}),
    ...(files.length ? { files: files.map((file) => file.name) } : {}),
    ...(images.length
      ? { images: images.map((image, index) => ({ index, name: image.name })) }
      : {}),
    ...(at ? { at } : {}),
    ...(block.durationMs ? { durationMs: block.durationMs } : {}),
  };
}

function placeLabel(session: Session): string {
  if (isFreeChatCwd(session.cwd)) return "Chat";
  return irgatName(session.id) ?? projectName(session.cwd);
}

function harnessChoice(
  deps: WebAccessDeps,
  harness: HarnessId,
  model: string,
): WebHarnessChoice {
  return {
    harness,
    title: HARNESS_TITLE[harness] ?? harness,
    model,
    modelName: deps.modelName(harness, model),
  };
}

const SERVICES_TTL_MS = 60_000;
let servicesCache: { at: number; value: Promise<ServiceStatus[]> } | null =
  null;

/** One check a minute is plenty; the page asks every time it refreshes. */
function cachedServices(deps: WebAccessDeps, fresh: boolean) {
  const now = Date.now();
  if (fresh || !servicesCache || now - servicesCache.at > SERVICES_TTL_MS) {
    const value = deps.services();
    servicesCache = { at: now, value };
    value.catch(() => {
      if (servicesCache?.value === value) servicesCache = null;
    });
  }
  return servicesCache.value;
}

export function resetWebAccessCacheForTest() {
  servicesCache = null;
}

async function boardOfList(deps: WebAccessDeps, listId: string) {
  const state = await deps.ideas.load();
  for (const board of state.boards)
    if (board.lists.some((list) => list.id === listId)) return board;
  throw new Error("That idea list no longer exists.");
}

async function findCard(deps: WebAccessDeps, id: string) {
  const state = await deps.ideas.load();
  for (const board of state.boards)
    for (const list of board.lists) {
      const card = list.cards.find((entry) => entry.id === id);
      if (card) return card;
    }
  throw new Error("That idea no longer exists.");
}

function tasks(value: unknown): IdeaTask[] {
  if (!Array.isArray(value)) throw new Error("Missing tasks");
  return value.slice(0, 200).map((task) => {
    const entry = (task ?? {}) as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.text !== "string")
      throw new Error("Invalid task");
    return {
      id: entry.id,
      text: entry.text.slice(0, 2_000),
      done: !!entry.done,
    };
  });
}

/** Answers one relayed call. Throws with a message the browser shows. */
export async function handleWebAccess(
  deps: WebAccessDeps,
  action: string,
  input: Input,
): Promise<unknown> {
  switch (action) {
    case "overview": {
      const fleet = buildFleet(deps.sessions(), { irgatName });
      const overview: WebOverview = {
        needsYou: fleet.needsYou,
        running: fleet.running,
        review: fleet.review,
        interrupted: fleet.interrupted,
        idle: fleet.idle,
        appearance: deps.appearance(),
        owner: await deps.owner(),
        at: Date.now(),
      };
      return overview;
    }
    case "session": {
      const session = await findSession(deps, input);
      const cwd = sessionWorkCwd(session);
      const irgat = irgatForSession(session.id);
      const look = irgat ? irgatLook(irgat) : undefined;
      const blocks = session.blocks.filter(shownBlock);
      const limit = transcriptLimit(input.limit);
      const view: WebSession = {
        id: session.id,
        title: sessionDisplayTitle(session.title, session.harness),
        harness: session.harness,
        model: deps.modelName(session.harness, session.model),
        ...(look
          ? {
              irgat: look.name,
              mascot: { name: look.mascot, color: look.color },
            }
          : {}),
        cwd: session.cwd,
        projectLabel: placeLabel(session),
        ...(session.branch && !isFreeChatCwd(session.cwd)
          ? { branch: session.branch }
          : {}),
        busy: !!session.busy,
        ...(session.busy ? { activity: fleetActivity(session) } : {}),
        requests: fleetRequests(session),
        omitted: Math.max(0, blocks.length - limit),
        blocks: blocks.slice(-limit).map((block) => webBlock(block, cwd)),
        deletable: irgat?.sessionId !== session.id,
        modelId: session.model,
        ...(NO_ACCESS_MODES.includes(session.harness)
          ? {}
          : { runtimeMode: session.runtimeMode }),
        ...effortOf(deps, session),
      };
      return view;
    }
    case "image": {
      const session = await findSession(deps, input);
      const block = session.blocks.find(
        (entry) => entry.id === text(input, "blockId", 200),
      );
      const image = block
        ? imageSources(block)[Number(input.index)]
        : undefined;
      if (!image) throw new Error("That image is no longer in the chat.");
      const data = image.data ?? (await deps.readFile(image.path!));
      if (data.length > IMAGE_MAX)
        throw new Error("This image is too large to show here.");
      const result: WebImageData = { mimeType: image.mimeType, data };
      return result;
    }
    case "history": {
      const open = new Set(deps.sessions().map((entry) => entry.id));
      const rows = await deps.history();
      const result: WebHistory = {
        chats: rows
          .filter(
            (row) =>
              !open.has(row.id) &&
              !row.archived &&
              !row.draft &&
              !row.sidebarHidden &&
              !row.orchestrationLeadId &&
              !irgatForSession(row.id),
          )
          .map((row) => ({
            sessionId: row.id,
            title: sessionDisplayTitle(row.title, row.harness),
            harness: row.harness,
            projectLabel: isFreeChatCwd(row.cwd)
              ? "Chat"
              : projectName(row.cwd),
            ...(row.branch && !isFreeChatCwd(row.cwd)
              ? { branch: row.branch }
              : {}),
            updatedAt: row.updatedAt,
          })),
      };
      return result;
    }
    case "models": {
      const result: WebModels = {
        harnesses: deps.harnesses().map((harness) => ({
          harness,
          title: HARNESS_TITLE[harness] ?? harness,
          models: deps
            .models(harness)
            .map((model) => ({ id: model.id, name: model.name })),
        })),
      };
      return result;
    }
    case "branches": {
      const cwd = typeof input.cwd === "string" ? input.cwd : "";
      if (!deps.projects().includes(cwd))
        throw new Error("Pick one of your projects.");
      const found = await deps.branches(cwd).catch(() => null);
      const result: WebBranches = {
        current: found?.current ?? "",
        branches: (found?.branches ?? [])
          .filter((branch) => !branch.remote)
          .map((branch) => branch.name),
      };
      return result;
    }
    case "setModel": {
      const session = await findSession(deps, input);
      const harness = text(input, "harness", 100) as HarnessId;
      const model = text(input, "model", 300);
      if (!deps.harnesses().includes(harness))
        throw new Error("That provider is not available on your Mac.");
      const known = deps.models(harness);
      if (known.length && !known.some((entry) => entry.id === model))
        throw new Error("That model is not available on your Mac.");
      deps.setModel(session.id, harness, model);
      return { model };
    }
    case "setEffort": {
      const session = await findSession(deps, input);
      const effort = effortOf(deps, session).effort;
      const value = text(input, "value", 100);
      if (!effort || !effort.options.some((option) => option.value === value))
        throw new Error("This model has no such effort level.");
      deps.setModelSettings(session.id, {
        ...session.modelSettings,
        [effort.id]: value,
      });
      return { effort: value };
    }
    case "setMode": {
      const session = await findSession(deps, input);
      const mode = runtimeMode(input.mode);
      if (!mode || NO_ACCESS_MODES.includes(session.harness))
        throw new Error("Pick one of the access modes.");
      deps.setRuntimeMode(session.id, mode);
      return { mode };
    }
    case "renameChat": {
      const session = await findSession(deps, input);
      const title = text(input, "title", 200).trim();
      if (!title) throw new Error("Give the chat a name.");
      await deps.rename(session.id, title);
      return { renamed: true };
    }
    case "deleteChat": {
      const session = await findSession(deps, input);
      const irgat = irgatForSession(session.id);
      if (irgat?.sessionId === session.id)
        throw new Error(
          "This is the Irgat's own chat. Delete the Irgat on your Mac.",
        );
      // An Irgat's chat leaves its list only once storage lets it go.
      const removed = irgat
        ? await deleteIrgatChildSession(irgat.id, session.id, () =>
            deps.remove(session.id),
          )
        : await deps.remove(session.id);
      if (!removed)
        throw new Error("Irgatos could not delete this chat right now.");
      return { deleted: true };
    }
    case "upload":
      return receiveUpload(deps, input);
    case "send": {
      const session = await findSession(deps, input);
      const message = text(input, "text").trim();
      const hasFiles = Array.isArray(input.files) && input.files.length > 0;
      if (!message && !hasFiles) throw new Error("Write a message first.");
      const attachments = takeUploads(input);
      const sent =
        input.plan === true
          ? deps.submit(session.id, message, attachments, { intent: "plan" })
          : deps.submit(session.id, message, attachments);
      if (!sent)
        throw new Error("Irgatos could not send this message right now.");
      return { sent: true };
    }
    case "approval": {
      const session = await findSession(deps, input);
      const id = requestId(input);
      const decision = input.decision;
      if (decision !== "allow" && decision !== "deny")
        throw new Error("Decision must be allow or deny");
      const open = fleetRequests(session).some(
        (request) => request.kind === "approval" && request.requestId === id,
      );
      if (!open) throw new Error("This request was already answered.");
      deps.approve(session.id, id, decision);
      return { decided: decision };
    }
    case "secretApproval": {
      const session = await findSession(deps, input);
      const blockId = typeof input.blockId === "string" ? input.blockId : "";
      const answer = input.answer;
      if (answer !== "once" && answer !== "chat" && answer !== "deny")
        throw new Error("Answer must be once, chat or deny");
      const approval = session.blocks.find((block) => block.id === blockId)?.secretApproval;
      if (!approval || approval.state !== "pending")
        throw new Error("This approval was already answered.");
      await deps.answerSecretApproval(blockId, approval, answer);
      return { answered: answer };
    }
    case "answer": {
      const session = await findSession(deps, input);
      const prompt = session.pendingQuestion;
      if (!prompt || prompt.requestId !== requestId(input))
        throw new Error("This question was already answered.");
      const answers = stringLists(input.answers);
      const custom = strings(input.custom);
      const reply =
        input.skip === true
          ? ({ kind: "skipped" } as const)
          : buildQuestionReply(prompt.questions, answers, custom);
      deps.answer(session.id, prompt.requestId, reply);
      return { answered: reply.kind };
    }
    case "stop": {
      const session = await findSession(deps, input);
      if (session.busy) deps.stop(session.id);
      return { stopped: !!session.busy };
    }
    case "projects": {
      const chat = deps.choice();
      const result: WebProjects = {
        projects: [
          {
            path: "",
            label: "Chat",
            choice: harnessChoice(deps, chat.harness, chat.model),
          },
          ...deps
            .projects()
            .slice(0, PROJECTS_LIMIT)
            .map((path) => {
              const choice = deps.choice(path);
              return {
                path,
                label: projectName(path),
                choice: harnessChoice(deps, choice.harness, choice.model),
              };
            }),
        ],
        harnesses: deps
          .harnesses()
          .map((harness) =>
            harnessChoice(
              deps,
              harness,
              deps.choice().harness === harness
                ? deps.choice().model
                : resolveModel(harness).id,
            ),
          ),
      };
      return result;
    }
    case "newChat": {
      const prompt = text(input, "text").trim();
      const hasFiles = Array.isArray(input.files) && input.files.length > 0;
      if (!prompt && !hasFiles)
        throw new Error("Write what the chat should do.");
      const path = typeof input.cwd === "string" ? input.cwd : "";
      if (path && !deps.projects().includes(path))
        throw new Error("Pick one of your projects.");
      const cwd = path || (await deps.freeChatDir());
      const fallback = deps.choice(path || undefined);
      const harness =
        typeof input.harness === "string" &&
        deps.harnesses().includes(input.harness as HarnessId)
          ? (input.harness as HarnessId)
          : fallback.harness;
      const picked = typeof input.model === "string" ? input.model : "";
      const model = deps.models(harness).some((entry) => entry.id === picked)
        ? picked
        : harness === fallback.harness
          ? fallback.model
          : resolveModel(harness).id;
      const mode = runtimeMode(input.mode);
      const base = typeof input.worktree === "string" ? input.worktree : "";
      if (base) {
        if (!path) throw new Error("A worktree needs a project.");
        const found = await deps.branches(path).catch(() => null);
        if (!found?.branches.some((branch) => branch.name === base))
          throw new Error("That branch is no longer in the project.");
      }
      const attachments = takeUploads(input);
      const sessionId = deps.newId();
      await deps.launch(
        {
          prompt,
          ...(attachments.length ? { attachments } : {}),
          cwd,
          harness,
          model,
          reveal: false,
          ...(mode && !NO_ACCESS_MODES.includes(harness)
            ? { runtimeMode: mode }
            : {}),
          ...(input.plan === true ? { intent: "plan" as const } : {}),
          ...(base
            ? { workspaceMode: "worktree" as const, worktreeBase: base }
            : path
              ? {}
              : { workspaceMode: "current" as const }),
        },
        sessionId,
      );
      return { sessionId };
    }
    case "irgats": {
      const enabled = deps.irgatsEnabled();
      const open = new Map(deps.sessions().map((entry) => [entry.id, entry]));
      const result: WebIrgats = {
        enabled,
        irgats: enabled
          ? listIrgats().map((irgat) => webIrgat(irgat, open))
          : [],
      };
      return result;
    }
    case "irgatOpen": {
      const irgat = requestedIrgat(deps, input);
      const chat = typeof input.sessionId === "string" ? input.sessionId : "";
      if (chat && !irgatSessionIds(irgat).includes(chat))
        throw new Error("That chat no longer belongs to this Irgat.");
      // The main chat goes through the Irgat, which starts it again if lost.
      const session =
        chat && chat !== irgat.sessionId
          ? await deps.irgatHost.load(chat)
          : await ensureIrgatSession(irgat.id, deps.irgatHost);
      if (!session) throw new Error("Irgatos could not open this chat.");
      return { sessionId: session.id };
    }
    case "irgatNewChat": {
      const irgat = requestedIrgat(deps, input);
      const parent = await ensureIrgatSession(irgat.id, deps.irgatHost);
      if (!parent) throw new Error("Irgatos could not open this Irgat.");
      const child = createIrgatChildSession(
        irgat.id,
        parent,
        (id) => deps.sessions().find((entry) => entry.id === id)?.title,
      );
      try {
        // A row with nothing stored behind it could not be opened later.
        if (!(await deps.saveSession(child)))
          throw new Error("Irgatos could not save the new chat.");
      } catch (error) {
        updateIrgat(irgat.id, (current) => ({
          ...current,
          childSessionIds: current.childSessionIds?.filter(
            (id) => id !== child.id,
          ),
        }));
        throw error;
      }
      deps.irgatHost.add(child);
      return { sessionId: child.id };
    }
    case "ideas":
      return deps.ideas.load();
    case "ideaAdd": {
      const listId = text(input, "listId", 200);
      const board = await boardOfList(deps, listId);
      const parsed = parseQuickIdea(text(input, "text", 2_000), board.labels);
      if (!parsed.title) throw new Error("Write the idea first.");
      const card: IdeaCardInput = {
        id: deps.newId(),
        title: parsed.title,
        description: "",
        labelIds: parsed.labelIds,
        project: null,
        tasks: [],
        dueAt: null,
      };
      await deps.ideas.create(listId, card, 0);
      return { id: card.id };
    }
    case "ideaUpdate": {
      const current = await findCard(deps, text(input, "id", 200));
      const title =
        "title" in input ? text(input, "title", 2_000).trim() : current.title;
      if (!title) throw new Error("An idea needs a title.");
      await deps.ideas.update({
        id: current.id,
        title,
        description:
          "description" in input
            ? text(input, "description", 50_000)
            : current.description,
        labelIds: current.labelIds,
        project: current.project,
        tasks: "tasks" in input ? tasks(input.tasks) : current.tasks,
        dueAt: current.dueAt,
      });
      return { updated: true };
    }
    case "ideaMove": {
      const card = await findCard(deps, text(input, "id", 200));
      const listId = text(input, "listId", 200);
      await boardOfList(deps, listId);
      const index = Number.isSafeInteger(input.index) ? Number(input.index) : 0;
      await deps.ideas.move(card.id, listId, Math.max(0, index));
      return { moved: true };
    }
    case "ideaDelete": {
      const card = await findCard(deps, text(input, "id", 200));
      await deps.ideas.remove(card.id);
      return { deleted: true };
    }
    case "services": {
      const services = await cachedServices(deps, input.fresh === "1");
      const result: WebServices = {
        services: services.map((service) => ({
          ...service,
          label: serviceLabel(service.id),
        })),
      };
      return result;
    }
    case "search":
      return webSearch(lookups(deps), deps.sessions(), text(input, "q", 500));
    case "inbox":
      return webInbox(lookups(deps), deps.sessions(), input.fresh === "1");
    case "inboxItem":
      return webInboxDetail(
        lookups(deps),
        deps.sessions(),
        text(input, "key", 500),
      );
    case "inboxStart": {
      const { prompt, cwd: path } = await inboxChatPrompt(
        lookups(deps),
        text(input, "key", 500),
        typeof input.text === "string" ? input.text.slice(0, 100_000) : "",
      );
      const cwd = path || (await deps.freeChatDir());
      const { harness, model } = deps.choice(path || undefined);
      const sessionId = deps.newId();
      await deps.launch(
        {
          prompt,
          cwd,
          harness,
          model,
          reveal: false,
          ...(path ? {} : { workspaceMode: "current" as const }),
        },
        sessionId,
      );
      return { sessionId };
    }
    case "usage":
      return webUsage(lookups(deps), deps.harnesses(), input.fresh === "1");
    case "mail": {
      const configured = await deps.mail.configured();
      if (!configured) {
        const result: WebMail = {
          configured,
          accounts: [],
          threads: [],
          more: "",
          errors: [],
        };
        return result;
      }
      const accounts = await deps.mail.accounts();
      const folder = MAIL_FOLDERS.some((f) => f.id === input.folder)
        ? (input.folder as MailFolderId)
        : MAIL_FOLDERS[0].id;
      const search = typeof input.search === "string" ? input.search : "";
      const account = typeof input.account === "string" ? input.account : "";
      const ids = accounts.some((a) => a.id === account)
        ? [account]
        : accounts.map((a) => a.id);
      const more = typeof input.more === "string" ? input.more : "";
      const page = await deps.mail.list(
        mailQuery(folder, search.slice(0, 500)),
        ids,
        more ? strings(JSON.parse(more)) : null,
      );
      const result: WebMail = {
        configured,
        accounts: accounts.map(({ id, email }) => ({ id, email })),
        threads: page.threads.map((row) => ({
          account: row.account,
          id: row.id,
          subject: row.subject,
          from: row.from,
          sender: senderName(row.from),
          snippet: row.snippet,
          date: row.date,
          unread: row.unread,
          messageCount: row.messageCount,
        })),
        more: Object.keys(page.nextPageTokens).length
          ? JSON.stringify(page.nextPageTokens)
          : "",
        errors: page.errors,
      };
      return result;
    }
    case "mailThread": {
      const account = text(input, "account", 500);
      const id = text(input, "id", 500);
      const [thread, accounts] = await Promise.all([
        deps.mail.thread(account, id),
        deps.mail.accounts().catch(() => [] as MailAccount[]),
      ]);
      const others = accounts.map((a) => a.email).filter(Boolean);
      const result: WebMailThread = {
        account,
        id: thread.id,
        subject: thread.subject,
        unread: thread.unread,
        messages: thread.messages.map((m) => {
          const hidden = hiddenTextNotice(m.hidden);
          return {
            id: m.id,
            from: m.from,
            sender: senderName(m.from),
            to: m.to,
            cc: m.cc,
            date: m.date,
            body: m.body,
            quoted: m.quoted ?? "",
            attachments: m.attachments,
            mine: isFromMe(m.from, thread.me, others),
            ...(hidden ? { hidden } : {}),
          };
        }),
        draft: thread.drafts[thread.drafts.length - 1]?.body || undefined,
      };
      return result;
    }
    case "mailMarkRead": {
      await deps.mail.markRead(
        text(input, "account", 500),
        text(input, "id", 500),
      );
      return { read: true };
    }
    default: {
      if (isWebAgentsAction(action))
        return handleWebAgents(
          { ...deps, findSession: (given) => findSession(deps, given) },
          action,
          input,
        );
      const workspace = handleWorkspaceAction(
        {
          ...deps,
          open: deps.irgatHost.load,
          newChat: (next) => handleWebAccess(deps, "newChat", next),
        },
        action,
        input,
      );
      if (workspace) return workspace;
      throw new Error("Unknown action");
    }
  }
}

function lookups(deps: WebAccessDeps): WebLookupDeps {
  if (!deps.lookups) throw new Error("Not available on this Mac.");
  return deps.lookups;
}

function strings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value))
    if (typeof entry === "string") out[key] = entry;
  return out;
}

function transcriptLimit(value: unknown): number {
  const asked = Math.floor(Number(value));
  return Number.isFinite(asked) && asked > WEB_TRANSCRIPT_LIMIT
    ? Math.min(asked, WEB_TRANSCRIPT_MAX)
    : WEB_TRANSCRIPT_LIMIT;
}

function runtimeMode(value: unknown): RuntimeMode | undefined {
  return RUNTIME_MODES.find((mode) => mode === value);
}

function effortOf(
  deps: WebAccessDeps,
  session: Session,
): { effort?: WebEffort } {
  const model =
    deps.models(session.harness).find((entry) => entry.id === session.model) ??
    resolveModel(session.harness, session.model);
  const setting = modelEffortSetting(model);
  if (!setting) return {};
  return {
    effort: {
      id: setting.id,
      value: session.modelSettings?.[setting.id] ?? setting.value,
      options: setting.options.map(({ value, label }) => ({ value, label })),
    },
  };
}

function stringLists(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value))
    if (Array.isArray(entry))
      out[key] = entry.filter(
        (item): item is string => typeof item === "string",
      );
  return out;
}

/** Answers the page's calls while this is the main window. */
export function connectWebAccess(deps: () => WebAccessDeps): () => void {
  const window = getCurrentWebviewWindow();
  if (window.label !== "main") return () => {};
  const unlisten = window.listen<{
    id: string;
    action: string;
    input: Input;
  }>("web-access-request", async ({ payload }) => {
    let response: unknown;
    try {
      response = {
        ok: true,
        result: await handleWebAccess(
          deps(),
          payload.action,
          payload.input ?? {},
        ),
      };
    } catch (error) {
      response = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    void invoke("web_access_reply", { id: payload.id, response }).catch(
      console.error,
    );
  });
  return () => void unlisten.then((stop) => stop());
}

export const webAccessStatus = () =>
  invoke<WebAccessStatus>("web_access_status");
export const setWebAccessEnabled = (enabled: boolean) =>
  invoke<WebAccessStatus>("web_access_set_enabled", { enabled });
export const rotateWebAccessToken = () =>
  invoke<WebAccessStatus>("web_access_rotate_token");
