import { invoke } from "@tauri-apps/api/core";
import {
  agentDurationMs,
  agentSummary,
  buildAgentTree,
  buildAgents,
  buildIrgatTree,
  flattenTree,
  type AgentTreeNode,
} from "../../agent-tree/model/agentTree";
import {
  AGENT_TREE_WINDOWS,
  loadAgentTreeState,
  windowSince,
  type AgentTreeWindow,
} from "../../agent-tree/model/agentTreeStore";
import { triggerLabel } from "../../automations/model/automationLabels";
import {
  createManualAutomationRun,
  listAutomationRuns,
  listAutomations,
  setAutomationEnabled,
  type Automation,
  type AutomationRun,
} from "../../automations/model/automations";
import { isFreeChatCwd } from "../../freechat/model/freeChat";
import {
  externalClaudeName,
  type ExternalClaudeSession,
} from "../../irgats/model/externalClaude";
import {
  IRGAT_COLORS,
  addIrgatProject,
  createIrgat,
  defaultIrgatName,
  findIrgat,
  irgatForSession,
  irgatLook,
  irgatSessionIds,
  removeIrgatProject,
  saveIrgatMascot,
  saveIrgatName,
  setIrgatPaused,
  updateIrgat,
  type Irgat,
} from "../../irgats/model/irgat";
import {
  editIrgatFile,
  loadIrgatFiles,
  saveIrgatFile,
  type IrgatFiles,
} from "../../irgats/model/irgatFiles";
import { memoryLines, withoutLine } from "../../irgats/model/irgatMemory";
import { irgatLaunchesAcrossChats } from "../../irgats/model/irgatSpawnedSessions";
import { ensureIrgatSession } from "../../irgats/model/irgatWorkspace";
import { PROJECT_MASCOTS } from "../../projects/model/projectMascots";
import { modelsFor, resolveModel } from "../../sessions/model/models";
import {
  HARNESS_TITLE,
  RUNTIME_MODES,
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  type HarnessId,
  type RuntimeMode,
  type Session,
} from "../../sessions/model/session";
import { projectName } from "../../../shared/lib/paths";
import {
  latestReply,
  spokenReply,
  type Reply,
} from "../../voice/model/spokenReply";
import { nextPromptFor } from "../../sessions/model/nextPrompt";
import {
  loadVoiceSettings,
  type VoiceSettings,
} from "../../voice/model/voiceSettings";
import { summarizeReply } from "../../../platform/tauri/voice";
import type {
  WebAgent,
  WebAgents,
  WebAutomation,
  WebAutomationRun,
  WebAutomations,
  WebIrgatDetail,
  WebIrgatOptions,
  WebOutsideSession,
  WebNextPrompt,
  WebSpokenReply,
  WebVoice,
} from "./protocol";

/**
 * The browser companion's Fleet agents, automations, Irgat settings and
 * voice: what the Mac's own screens do, through the same stores.
 */
export type WebAgentsDeps = {
  /** Claude Code sessions running outside Irgatos. */
  outside: () => Promise<ExternalClaudeSession[]>;
  interruptedIds: () => ReadonlySet<string>;
  automations: {
    list: () => Promise<Automation[]>;
    runs: (automationId: string) => Promise<AutomationRun[]>;
    setEnabled: (automation: Automation, enabled: boolean) => Promise<unknown>;
    /** Records a manual run and starts it, as Run now on the Mac does. */
    run: (automation: Automation) => Promise<void>;
  };
  irgats: {
    create: () => Irgat;
    files: (irgatId: string) => Promise<IrgatFiles>;
    saveSoul: (irgatId: string, text: string, hash: string) => Promise<string>;
    forget: (
      irgatId: string,
      edit: (text: string) => string,
    ) => Promise<unknown>;
    setModel: (sessionId: string, harness: HarnessId, model: string) => void;
    setMode: (sessionId: string, mode: RuntimeMode) => void;
  };
  voice: {
    settings: () => VoiceSettings;
    summarize: (text: string, locale: string) => Promise<string | null>;
    parts: (text: string, provider: string) => Promise<string[]>;
    synthesize: (text: string, provider: string) => Promise<string>;
    dictateStart: () => Promise<string>;
    dictateChunk: (session: string, pcm: string) => Promise<string>;
    dictateFinish: (session: string) => Promise<string>;
    /** The grey next-message suggestion, shared with the desktop composer. */
    nextPrompt: (reply: Reply, sessionId: string) => Promise<string | null>;
  };
};

/** What the main handler shares with these actions. */
export type WebAgentsHost = {
  sessions: () => readonly Session[];
  irgatsEnabled: () => boolean;
  irgatHost: Parameters<typeof ensureIrgatSession>[1];
  projects: () => readonly string[];
  harnesses: () => HarnessId[];
  modelName: (harness: HarnessId, model: string) => string;
  findSession: (input: Input) => Promise<Session>;
  agents?: WebAgentsDeps;
};

type Input = Record<string, unknown>;

export const webAgentsDefaults: Omit<
  WebAgentsDeps,
  "interruptedIds" | "automations" | "irgats"
> & {
  automations: Omit<WebAgentsDeps["automations"], "run">;
  irgats: Omit<WebAgentsDeps["irgats"], "setModel" | "setMode">;
} = {
  outside: () => invoke<ExternalClaudeSession[]>("external_claude_sessions"),
  automations: {
    list: listAutomations,
    runs: listAutomationRuns,
    setEnabled: setAutomationEnabled,
  },
  irgats: {
    create: () => createIrgat(),
    files: loadIrgatFiles,
    saveSoul: (irgatId, text, hash) =>
      saveIrgatFile(irgatId, "soul", text, hash),
    forget: (irgatId, edit) => editIrgatFile(irgatId, "memory", edit),
  },
  voice: {
    settings: loadVoiceSettings,
    summarize: summarizeReply,
    parts: (text, provider) =>
      invoke<string[]>("voice_speech_parts", { text, provider }),
    synthesize: (text, provider) =>
      invoke<string>("voice_synthesize", { text, provider }),
    dictateStart: () => invoke<string>("voice_relay_start"),
    dictateChunk: (session, pcm) =>
      invoke<string>("voice_relay_chunk", { session, pcm }),
    dictateFinish: (session) =>
      invoke<string>("voice_relay_finish", { session }),
    nextPrompt: (reply, sessionId) => nextPromptFor(reply, sessionId),
  },
};

/** Starts a recorded manual run the way the Automations screen does. */
export async function runAutomationNow(
  automation: Automation,
  launch: (automation: Automation, run: AutomationRun) => Promise<unknown>,
) {
  const run = await createManualAutomationRun(automation.id);
  await launch(automation, run);
}

export const WEB_AGENTS_READS = [
  "agents",
  "automations",
  "automationRuns",
  "irgat",
  "irgatOptions",
  "voice",
] as const;
export const WEB_AGENTS_WRITES = [
  "automationRun",
  "automationEnabled",
  "irgatCreate",
  "irgatUpdate",
  "irgatSoul",
  "irgatForget",
  "voiceReply",
  "voiceAudio",
  "nextPrompt",
  "dictateStart",
  "dictateChunk",
  "dictateFinish",
] as const;
const ACTIONS = new Set<string>([...WEB_AGENTS_READS, ...WEB_AGENTS_WRITES]);

export function isWebAgentsAction(action: string): boolean {
  return ACTIONS.has(action);
}

function text(input: Input, key: string, max: number): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
}

function irgatName(sessionId: string): string | undefined {
  const irgat = irgatForSession(sessionId);
  return irgat ? irgatLook(irgat).name : undefined;
}

/** The tree in drawing order, each card with how deep it hangs. */
export function webAgents(root: AgentTreeNode, now: number): WebAgent[] {
  const out: WebAgent[] = [];
  const walk = (node: AgentTreeNode, depth: number) => {
    const duration = agentDurationMs(node, now);
    out.push({
      id: node.id,
      depth,
      name: node.name,
      role: node.role,
      ...(node.harness ? { harness: node.harness } : {}),
      model: node.model,
      task: node.task,
      status: node.status,
      ...(node.activity ? { activity: node.activity } : {}),
      ...(node.error ? { error: node.error } : {}),
      ...(node.costUsd != null ? { costUsd: node.costUsd } : {}),
      ...(node.tokens != null ? { tokens: node.tokens } : {}),
      ...(duration ? { durationMs: duration } : {}),
      ...(node.startedAt ? { startedAt: node.startedAt } : {}),
      ...(node.sessionId ? { sessionId: node.sessionId } : {}),
    });
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
}

function treeWindow(input: Input): AgentTreeWindow {
  const wanted = input.window;
  return AGENT_TREE_WINDOWS.includes(wanted as AgentTreeWindow)
    ? (wanted as AgentTreeWindow)
    : loadAgentTreeState().window;
}

function outsideSession(session: ExternalClaudeSession): WebOutsideSession {
  return {
    id: session.sessionId,
    name: externalClaudeName(session),
    folder: session.cwd,
    status: session.status,
    ...(session.startedAt ? { startedAt: session.startedAt } : {}),
    ...(session.statusUpdatedAt
      ? { statusUpdatedAt: session.statusUpdatedAt }
      : {}),
  };
}

function needs(host: WebAgentsHost): WebAgentsDeps {
  if (!host.agents) throw new Error("Update Irgatos on your Mac first.");
  return host.agents;
}

function requestedIrgat(host: WebAgentsHost, input: Input): Irgat {
  if (!host.irgatsEnabled())
    throw new Error("Irgats are turned off on your Mac.");
  const irgat = findIrgat(text(input, "irgatId", 200));
  if (!irgat) throw new Error("That Irgat no longer exists.");
  return irgat;
}

async function findAutomation(deps: WebAgentsDeps, input: Input) {
  const id = text(input, "id", 200);
  const automation = (await deps.automations.list()).find(
    (entry) => entry.id === id,
  );
  if (!automation) throw new Error("That automation no longer exists.");
  return automation;
}

function webAutomation(
  host: WebAgentsHost,
  automation: Automation,
): WebAutomation {
  return {
    id: automation.id,
    name: automation.name || "Untitled automation",
    prompt: automation.prompt,
    place:
      !automation.cwd || isFreeChatCwd(automation.cwd)
        ? "Chat"
        : projectName(automation.cwd),
    harness: automation.harness,
    modelName: host.modelName(automation.harness, automation.model),
    trigger: triggerLabel(automation),
    enabled: automation.enabled,
    nextRunAt: automation.enabled ? automation.nextRunAt : 0,
    ...(automation.lastRunAt ? { lastRunAt: automation.lastRunAt } : {}),
    ...(automation.lastRunStatus
      ? { lastRunStatus: automation.lastRunStatus }
      : {}),
    ...(automation.lastRunError
      ? { lastRunError: automation.lastRunError }
      : {}),
    ...(automation.lastSessionId
      ? { lastSessionId: automation.lastSessionId }
      : {}),
  };
}

/** The Irgat's chat, loaded, which holds its model and permissions. */
async function irgatSession(host: WebAgentsHost, irgat: Irgat) {
  const session = await ensureIrgatSession(irgat.id, host.irgatHost);
  if (!session) throw new Error("Irgatos could not open this Irgat.");
  return session;
}

function irgatAgents(
  host: WebAgentsHost,
  deps: WebAgentsDeps,
  irgat: Irgat,
  sessionId: string,
  name: string,
  now: number,
): WebAgent[] {
  const sessions = host.sessions();
  const open = new Map(sessions.map((entry) => [entry.id, entry]));
  const launches = irgatLaunchesAcrossChats(
    irgatSessionIds(irgat),
    sessionId,
    (id) => open.get(id)?.blocks,
  );
  const tree = buildIrgatTree(
    {
      irgatSessionId: sessionId,
      launches: launches.map((launch) => ({
        sessionId: launch.sessionId,
        title: launch.title,
        harness: launch.harness,
        model: launch.model,
      })),
      sessions,
    },
    {
      now,
      since: windowSince("all", now),
      interruptedIds: deps.interruptedIds(),
      irgatName: (id) => (id === sessionId ? name : irgatName(id)),
      retries: loadAgentTreeState().retries,
    },
  );
  // The Irgat itself is the screen; only what it started is listed.
  return tree
    ? webAgents(tree, now)
        .slice(1)
        .map((agent) => ({ ...agent, depth: agent.depth - 1 }))
    : [];
}

function harnessTitle(harness: HarnessId): string {
  return HARNESS_TITLE[harness] ?? harness;
}

/** Answers the companion's agents, automations, Irgat and voice calls. */
export async function handleWebAgents(
  host: WebAgentsHost,
  action: string,
  input: Input,
): Promise<unknown> {
  const deps = needs(host);
  switch (action) {
    case "agents": {
      const now = Date.now();
      const window = treeWindow(input);
      const agents = buildAgents(host.sessions(), {
        now,
        since: windowSince(window, now),
        interruptedIds: deps.interruptedIds(),
        irgatName,
        retries: loadAgentTreeState().retries,
      });
      const tree = buildAgentTree(agents);
      const outside = await deps.outside().catch(() => []);
      const result: WebAgents = {
        window,
        agents: webAgents(tree, now),
        summary: agentSummary(flattenTree(tree).slice(1)),
        outside: (Array.isArray(outside) ? outside : []).map(outsideSession),
      };
      return result;
    }
    case "automations": {
      const automations = await deps.automations.list();
      const result: WebAutomations = {
        automations: automations
          .slice()
          .sort(
            (a, b) =>
              Number(b.enabled) - Number(a.enabled) ||
              a.name.localeCompare(b.name),
          )
          .map((automation) => webAutomation(host, automation)),
      };
      return result;
    }
    case "automationRuns": {
      const automation = await findAutomation(deps, input);
      const runs = await deps.automations.runs(automation.id);
      return runs
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 20)
        .map((run): WebAutomationRun => ({
          id: run.id,
          trigger: run.trigger,
          status: run.status,
          createdAt: run.createdAt,
          ...(run.startedAt ? { startedAt: run.startedAt } : {}),
          ...(run.completedAt ? { completedAt: run.completedAt } : {}),
          ...(run.sessionId ? { sessionId: run.sessionId } : {}),
          ...(run.error ? { error: run.error } : {}),
        }));
    }
    case "automationRun": {
      const automation = await findAutomation(deps, input);
      await deps.automations.run(automation);
      return { started: true };
    }
    case "automationEnabled": {
      const automation = await findAutomation(deps, input);
      const enabled = input.enabled === true;
      if (automation.enabled !== enabled)
        await deps.automations.setEnabled(automation, enabled);
      return { enabled };
    }
    case "irgat": {
      const irgat = requestedIrgat(host, input);
      const session = await irgatSession(host, irgat);
      const look = irgatLook(irgat);
      const files = await deps.irgats.files(irgat.id);
      const now = Date.now();
      const result: WebIrgatDetail = {
        id: irgat.id,
        name: look.name,
        defaultName: defaultIrgatName(irgat.mascot),
        mascot: { name: look.mascot, color: look.color },
        projects: look.projects.map((project) => ({
          path: project.path,
          label: project.name,
        })),
        sessionId: session.id,
        harness: session.harness,
        model: session.model,
        modelName: host.modelName(session.harness, session.model),
        runtimeMode: session.runtimeMode,
        busy: !!session.busy,
        showSessions: irgat.showStartedSessionsInSidebar !== false,
        groupInFolder: irgat.useSidebarFolders === true,
        paused: irgat.paused === true,
        soul: files.soul,
        memory: memoryLines(files.memory).map((line) => ({
          index: line.index,
          text: line.text,
          struck: line.struck,
          ...(line.date ? { date: line.date } : {}),
        })),
        agents: irgatAgents(host, deps, irgat, session.id, look.name, now),
      };
      return result;
    }
    case "irgatOptions": {
      const result: WebIrgatOptions = {
        mascots: PROJECT_MASCOTS.map((mascot) => mascot.name),
        colors: [...IRGAT_COLORS],
        projects: host
          .projects()
          .slice(0, 60)
          .map((path) => ({ path, label: projectName(path) })),
        harnesses: host.harnesses().map((harness) => ({
          id: harness,
          label: harnessTitle(harness),
          models: modelsFor(harness).map((model) => ({
            id: model.id,
            label: model.name,
          })),
        })),
        modes: RUNTIME_MODES.map((mode) => ({
          id: mode,
          label: RUNTIME_MODE_LABEL[mode],
          hint: RUNTIME_MODE_HINT[mode],
        })),
      };
      return result;
    }
    case "irgatCreate": {
      if (!host.irgatsEnabled())
        throw new Error("Irgats are turned off on your Mac.");
      const irgat = deps.irgats.create();
      const session = await ensureIrgatSession(irgat.id, host.irgatHost);
      return { irgatId: irgat.id, sessionId: session?.id ?? null };
    }
    case "irgatUpdate": {
      const irgat = requestedIrgat(host, input);
      if ("name" in input) saveIrgatName(irgat.id, text(input, "name", 80));
      if ("mascot" in input) {
        const mascot = text(input, "mascot", 80);
        if (!PROJECT_MASCOTS.some((entry) => entry.name === mascot))
          throw new Error("Pick one of the mascots.");
        saveIrgatMascot(irgat.id, mascot);
      }
      if ("color" in input) {
        const color = text(input, "color", 80);
        if (!(IRGAT_COLORS as readonly string[]).includes(color))
          throw new Error("Pick one of the colors.");
        updateIrgat(irgat.id, (current) => ({ ...current, color }));
      }
      if ("addProject" in input) {
        const path = text(input, "addProject", 2_000);
        if (!host.projects().includes(path))
          throw new Error("Pick one of your projects.");
        addIrgatProject(irgat.id, path);
      }
      if ("removeProject" in input)
        removeIrgatProject(irgat.id, text(input, "removeProject", 2_000));
      if (typeof input.showSessions === "boolean") {
        const on = input.showSessions;
        updateIrgat(irgat.id, (current) => ({
          ...current,
          showStartedSessionsInSidebar: on,
        }));
      }
      if (typeof input.groupInFolder === "boolean") {
        const on = input.groupInFolder;
        updateIrgat(irgat.id, ({ useSidebarFolders: _, ...current }) =>
          on ? { ...current, useSidebarFolders: true } : current,
        );
      }
      if (typeof input.paused === "boolean")
        setIrgatPaused(irgat.id, input.paused);
      if ("harness" in input || "mode" in input) {
        const session = await irgatSession(host, irgat);
        if ("harness" in input) {
          const harness = text(input, "harness", 40) as HarnessId;
          if (!host.harnesses().includes(harness))
            throw new Error("That provider is not available on your Mac.");
          const model =
            typeof input.model === "string" ? input.model : undefined;
          deps.irgats.setModel(
            session.id,
            harness,
            resolveModel(harness, model).id,
          );
        }
        if ("mode" in input) {
          const mode = text(input, "mode", 40) as RuntimeMode;
          if (!RUNTIME_MODES.includes(mode))
            throw new Error("Pick one of the permission modes.");
          deps.irgats.setMode(session.id, mode);
        }
      }
      return { updated: true };
    }
    case "irgatSoul": {
      const irgat = requestedIrgat(host, input);
      const soul = text(input, "soul", 50_000);
      const files = await deps.irgats.files(irgat.id);
      if (typeof input.was === "string" && input.was !== files.soul)
        throw new Error(
          "The soul changed on your Mac while you were editing. Reopen it.",
        );
      await deps.irgats.saveSoul(irgat.id, soul, files.soulHash);
      return { saved: true };
    }
    case "irgatForget": {
      const irgat = requestedIrgat(host, input);
      const index = Number(input.index);
      const fact = text(input, "text", 5_000);
      if (!Number.isSafeInteger(index) || index < 0)
        throw new Error("Missing index");
      let found = true;
      await deps.irgats.forget(irgat.id, (current) => {
        // Only the line the phone showed; the file may have moved since.
        const line = memoryLines(current).find(
          (entry) => entry.index === index,
        );
        found = line?.text === fact;
        return found ? withoutLine(current, index) : current;
      });
      if (!found)
        throw new Error("Its memory changed on your Mac. Pull to refresh.");
      return { forgotten: true };
    }
    case "voice": {
      const settings = deps.voice.settings();
      const result: WebVoice = {
        dictation: settings.dictation,
        summary: settings.speechSummary,
        locale: settings.locale,
      };
      return result;
    }
    case "voiceReply": {
      const session = await host.findSession(input);
      const reply = latestReply(session.blocks, session.queuedMessages);
      if (!reply) throw new Error("There is no finished reply to read yet.");
      const settings = deps.voice.settings();
      const summary = settings.speechSummary
        ? await deps.voice.summarize(reply.text, settings.locale)
        : null;
      const words = summary ?? spokenReply(reply.text);
      if (!words) throw new Error("This reply has nothing to read aloud.");
      const result: WebSpokenReply = {
        parts: await deps.voice.parts(words, settings.speechProvider),
        summarized: !!summary,
      };
      return result;
    }
    case "nextPrompt": {
      const session = await host.findSession(input);
      const reply = session.busy
        ? null
        : latestReply(session.blocks, session.queuedMessages);
      const result: WebNextPrompt = {
        replyId: reply?.id ?? null,
        text: reply ? await deps.voice.nextPrompt(reply, session.id) : null,
      };
      return result;
    }
    case "voiceAudio": {
      const settings = deps.voice.settings();
      return {
        wav: await deps.voice.synthesize(
          text(input, "text", 4_000),
          settings.speechProvider,
        ),
      };
    }
    case "dictateStart":
      return { session: await deps.voice.dictateStart() };
    case "dictateChunk":
      return {
        text: await deps.voice.dictateChunk(
          text(input, "session", 200),
          text(input, "pcm", 200_000),
        ),
      };
    case "dictateFinish":
      return {
        text: await deps.voice.dictateFinish(text(input, "session", 200)),
      };
    default:
      throw new Error("Unknown action");
  }
}
