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
import { irgatForSession, irgatLook } from "../../irgats/model/irgat";
import { loadRecents } from "../../projects/model/recents";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import {
  checkServices,
  serviceIds,
  serviceLabel,
  type ServiceStatus,
} from "../../service-status/model/serviceStatus";
import {
  loadAccentColor,
  loadThemeDarkLightness,
  loadThemeHue,
  loadThemePreference,
  loadThemeSaturation,
} from "../../settings/model/appearance";
import {
  hasProbedHarnessAvailability,
  isHarnessAvailable,
} from "../../../integrations/harness/core/availabilityState";
import {
  defaultSessionChoice,
  resolveModel,
  showProviderInModelPicker,
} from "../../sessions/model/models";
import {
  HARNESSES,
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionWorkCwd,
  type Block,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import { toolCallLabel } from "../../sessions/model/transcriptActivity";
import {
  buildQuestionReply,
  type UserQuestionReply,
} from "../../sessions/model/userQuestion";
import { loadVoiceSettings } from "../../voice/model/voiceSettings";
import type {
  WebAppearance,
  WebBlock,
  WebHarnessChoice,
  WebOverview,
  WebProjects,
  WebServices,
  WebSession,
} from "./protocol";

/**
 * Browser access: the Rust side serves a small page to the user's other
 * devices and relays each API call here, so the browser always reads and
 * acts on this window's live sessions.
 */
export type WebAccessDeps = {
  sessions: () => readonly Session[];
  submit: (sessionId: string, text: string) => boolean;
  approve: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  answer: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ) => void;
  stop: (sessionId: string) => void;
  /** Starts a new chat the way the floating composer does. */
  launch: (launch: QuickLaunch, sessionId: string) => Promise<void>;
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
  newId: () => string;
};

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
  "sessions" | "submit" | "approve" | "answer" | "stop" | "launch"
> = {
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
  newId: () => crypto.randomUUID(),
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
const TEXT_MAX = 20_000;

type Input = Record<string, unknown>;

function text(input: Input, key: string, max = 100_000): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
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

function findSession(deps: WebAccessDeps, input: Input): Session {
  const id = text(input, "sessionId" in input ? "sessionId" : "id", 200);
  const session = deps.sessions().find((entry) => entry.id === id);
  if (!session) throw new Error("This chat is not open in Irgatos.");
  return session;
}

function clip(value: string, max = TEXT_MAX): string {
  return value.length > max
    ? `${value.slice(0, max)}\n\n… (open on the Mac for the rest)`
    : value;
}

function shownBlock(block: Block): boolean {
  return (
    !block.internal &&
    !block.draft &&
    !block.irgatSessionCompletion &&
    block.role !== "reasoning"
  );
}

function toolDetail(block: Block): string | undefined {
  const preview = block.tool?.preview;
  const raw =
    (preview?.kind === "shell" ? preview.query : undefined) ??
    block.tool?.detail ??
    "";
  const detail = raw.trim();
  return detail ? clip(detail, 600) : undefined;
}

export function webBlock(block: Block, cwd: string): WebBlock {
  const detail = block.tool ? toolDetail(block) : undefined;
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
    ...(block.attachments?.length
      ? { files: block.attachments.map((file) => file.name) }
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
      const session = findSession(deps, input);
      const cwd = sessionWorkCwd(session);
      const blocks = session.blocks.filter(shownBlock);
      const view: WebSession = {
        id: session.id,
        title: sessionDisplayTitle(session.title, session.harness),
        harness: session.harness,
        model: deps.modelName(session.harness, session.model),
        ...(irgatName(session.id) ? { irgat: irgatName(session.id) } : {}),
        cwd: session.cwd,
        projectLabel: placeLabel(session),
        ...(session.branch && !isFreeChatCwd(session.cwd)
          ? { branch: session.branch }
          : {}),
        busy: !!session.busy,
        ...(session.busy ? { activity: fleetActivity(session) } : {}),
        requests: fleetRequests(session),
        omitted: Math.max(0, blocks.length - WEB_TRANSCRIPT_LIMIT),
        blocks: blocks
          .slice(-WEB_TRANSCRIPT_LIMIT)
          .map((block) => webBlock(block, cwd)),
      };
      return view;
    }
    case "send": {
      const session = findSession(deps, input);
      const message = text(input, "text").trim();
      if (!message) throw new Error("Write a message first.");
      if (!deps.submit(session.id, message))
        throw new Error("Irgatos could not send this message right now.");
      return { sent: true };
    }
    case "approval": {
      const session = findSession(deps, input);
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
    case "answer": {
      const session = findSession(deps, input);
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
      const session = findSession(deps, input);
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
            .slice(0, 30)
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
      if (!prompt) throw new Error("Write what the chat should do.");
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
      const model =
        harness === fallback.harness
          ? fallback.model
          : resolveModel(harness).id;
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
    default:
      throw new Error("Unknown action");
  }
}

function strings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value))
    if (typeof entry === "string") out[key] = entry;
  return out;
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
