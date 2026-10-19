import { isHarnessAvailable } from "../../../integrations/harness/core/availability";
import { isRemoteProjectPath, looksLikeProject } from "../../projects/model/recents";
import {
  mergeModelSettings,
  modelEffortSetting,
  modelsFor,
  preferredModelId,
  resolveModel,
} from "../../sessions/model/models";
import {
  HARNESSES,
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type HarnessId,
  type Session,
} from "../../sessions/model/session";
import {
  addSessionToFolder,
  createFolderWithSessions,
  loadSessionFolders,
  placeSessionInFolder,
  saveSessionFolders,
  setFolderCustomColor,
} from "../../sessions/model/sessionFolders";
import {
  normalizeNoteTags,
  noteTitle,
  type Note,
  type NoteUpsert,
} from "../../notes";
import {
  ARTIFACT_KINDS,
  type Artifact,
  type ArtifactCard,
  type ArtifactKind,
  type ArtifactUpsert,
} from "../../artifacts/artifacts";
import type { QuickLaunch } from "../../quick-composer/model/quickComposer";
import type { Worktree, Worktrees } from "../../source-control/model/worktrees";
import { pathKey, projectName } from "../../../shared/lib/paths";
import type { SplitDir } from "../../workspace/model/layout";
import { consumeOperatorCommand } from "../../sessions/model/operatorCommand";
import { sessionConversationPage, type SessionReadOptions } from "./sessionConversation";
import {
  CARD_FIELDS,
  parseCard,
  type IrgatCard,
} from "../../irgats/model/irgatCards";
import {
  HABITS_MAX,
  checkHabitsNow,
  habitRunningSince,
  habitSchedule,
  habitScheduleLabel,
  HABIT_DELAY_MAX_SECONDS,
  newHabit,
  nextHabitRunAt,
  type Habit,
  type HabitCondition,
} from "../../irgats/model/irgatHabits";
import {
  habitConditionError,
  pauseHabit,
  setHabitGuards,
  type HabitGuardSettings,
} from "../../irgats/model/habitGuards";
import {
  memoryWithinBudget,
  IrgatFileConflict,
  type AgentFilePath,
  type IrgatFiles,
} from "../../irgats/model/irgatFiles";
import {
  addMemoryEntry,
  archiveMemoryEntries,
  fitMemoryBudget,
  memoryDate,
  memoryEntry,
  removeMemoryEntry,
  searchMemory,
  sinceDate,
  supersedeMemoryEntry,
  topicName,
} from "../../irgats/model/irgatMemory";
import {
  assertAgentExchangeAllowed,
  resolveIrgatContact,
  type IrgatContact,
} from "../../irgats/model/irgatDirectMessages";
import {
  externalClaudeContact,
  resolveExternalClaude,
  type ExternalClaudeSession,
} from "../../irgats/model/externalClaude";

export type AppSessionListing = {
  id: string;
  title: string;
  harness: HarnessId;
  model: string;
  busy: boolean;
  hasDraft: boolean;
  archived: boolean;
};

export type AppSessionPlacement = {
  direction: SplitDir;
  besideSessionId: string;
};

export type AgentAppHost = {
  computer?(sessionId: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
  start(
    launch: QuickLaunch,
    id: string,
    placement?: AppSessionPlacement,
    notifyIrgatId?: string,
  ): Promise<void>;
  sessions(cwd: string): Promise<AppSessionListing[]>;
  session(id: string): Promise<Session | null>;
  readConversation?(session: Session, options: SessionReadOptions): Promise<ReturnType<typeof sessionConversationPage>>;
  send(
    id: string,
    prompt: string,
    requestId: string,
    notifyIrgatId?: string,
  ): Promise<{ alreadySubmitted: boolean }>;
  draft(
    id: string,
    prompt: string,
    requestId: string,
  ): Promise<{ alreadySaved: boolean; draft: boolean }>;
  stop(id: string): Promise<void>;
  remove(id: string, mode: "archive" | "delete"): Promise<void>;
  worktrees(cwd: string): Promise<Worktrees>;
  createWorktree(
    cwd: string,
    branch: string,
    base: string,
    existing: boolean,
  ): Promise<Worktree>;
  notes(): Promise<Note[]>;
  note(id: string): Promise<Note | null>;
  saveNote(note: NoteUpsert): Promise<Note>;
  artifacts?(): Promise<Artifact[]>;
  artifact?(id: string): Promise<Artifact | null>;
  saveArtifact?(artifact: ArtifactUpsert): Promise<Artifact>;
  postArtifact?(sourceSessionId: string, card: ArtifactCard): void | Promise<void>;
  /** Whether the session is a Irgat's own conversation, which owns memory. */
  isIrgat(sessionId: string): boolean;
  projects?(): { path: string; name: string }[];
  requestProjectAccess?(sessionId: string, irgatId: string, project: string): void;
  /**
   * The Irgat a session works for: its own conversation or one of its habit
   * runs. Its projects are the ones it may name with "project".
   */
  irgatOf?(sessionId: string): {
    id: string;
    projects: readonly string[];
    /** Main and child chats belonging to this Irgat, independent of projects. */
    sessionIds?: readonly string[];
    showStartedSessionsInSidebar?: boolean;
    /** Files the sessions it starts into a folder named after it. */
    folder?: { name: string; color: string };
  } | undefined;
  /** Every Irgat, for irgats.list and to resolve irgats.send. */
  irgats?(): IrgatContact[];
  /**
   * Puts a message from the calling Irgat in another Irgat's main chat. Its
   * reply comes back to `notifyIrgatId` as a completion report.
   */
  messageIrgat?(
    irgatId: string,
    message: string,
    requestId: string,
    notifyIrgatId: string,
  ): Promise<{ alreadySubmitted: boolean }>;
  /** Claude Code sessions running outside Irgatos, for claude.list and claude.send. */
  externalClaudeSessions?(): Promise<ExternalClaudeSession[]>;
  /**
   * Posts a message from the calling Irgat into an outside Claude Code
   * session. Its answer comes back to `notifyIrgatId` as a completion report.
   */
  messageExternalClaude?(
    session: ExternalClaudeSession,
    message: string,
    requestId: string,
    notifyIrgatId: string,
  ): Promise<void>;
  /** A hidden run of one of a Irgat's habits: it may remember, not schedule. */
  isHabitRun?(sessionId: string): boolean;
  /** Puts a card in the Irgat's chat, or holds it for a habit run's report. */
  postCard?(sourceSessionId: string, card: IrgatCard): void;
  habits?: {
    load(irgatId: string): Promise<Habit[]>;
    update<T>(
      irgatId: string,
      change: (habits: Habit[]) => { habits: Habit[]; result: T },
    ): Promise<T>;
  };
  agentFiles(irgatId: string): Promise<IrgatFiles>;
  readAgentFile(
    irgatId: string,
    path: AgentFilePath,
  ): Promise<{ text: string | null; hash: string }>;
  /** Throws `IrgatFileConflict` when the file moved past `hash`. */
  writeAgentFile(
    irgatId: string,
    path: AgentFilePath,
    text: string,
    hash: string,
  ): Promise<string>;
  /** The clock entries are dated by; tests pin it. */
  now?(): Date;
};

const FIELDS = new Map<string, readonly string[]>([
  ["computer.read", ["query"]],
  ["computer.act", ["tool", "args"]],
  ["projects.list", []],
  ["projects.requestAccess", ["project"]],
  ["irgats.list", []],
  ["irgats.send", ["irgat", "message"]],
  ["claude.list", []],
  ["claude.send", ["session", "message"]],
  ["models.list", []],
  ["sessions.list", ["project"]],
  ["sessions.read", ["sessionId", "before", "limit", "maxChars", "project"]],
  ["sessions.send", ["sessionId", "prompt", "project", "notifyOnComplete"]],
  ["sessions.draft", ["sessionId", "prompt", "project"]],
  ["sessions.stop", ["sessionId", "project"]],
  ["sessions.archive", ["sessionId", "project"]],
  ["sessions.delete", ["sessionId", "project"]],
  [
    "sessions.start",
    [
      "prompt",
      "draft",
      "harness",
      "model",
      "modelSettings",
      "effort",
      "runtimeMode",
      "reveal",
      "workspaceMode",
      "worktreeBase",
      "worktreeCwd",
      "placement",
      "besideSessionId",
      "project",
      "notifyOnComplete",
    ],
  ],
  ["worktrees.list", ["project"]],
  ["worktrees.create", ["branch", "base", "existing", "project"]],
  ["folders.list", ["project"]],
  ["folders.move", ["sessionId", "folderId", "newFolderName", "project"]],
  ["notes.list", ["limit", "offset"]],
  ["notes.read", ["id"]],
  ["notes.write", ["id", "title", "body", "tags"]],
  ["artifacts.list", ["kind", "limit", "offset"]],
  ["artifacts.read", ["id"]],
  ["artifacts.write", ["id", "kind", "title", "body", "summary"]],
  ["soul.read", []],
  ["soul.update", ["text", "expectedHash"]],
  ["memory.read", ["topic"]],
  ["memory.search", ["query", "since"]],
  ["memory.add", ["fact", "topic", "until"]],
  ["memory.replace", ["find", "fact", "topic", "until"]],
  ["memory.remove", ["find", "topic"]],
  ["habits.list", []],
  [
    "habits.add",
    [
      "name",
      "instructions",
      "schedule",
      "requestApproval",
      "ifCondition",
      "delaySeconds",
    ],
  ],
  [
    "habits.update",
    [
      "id",
      "name",
      "instructions",
      "schedule",
      "enabled",
      "requestApproval",
      "ifCondition",
      "delaySeconds",
    ],
  ],
  ["habits.run", ["id"]],
  ["habits.remove", ["id"]],
  ["chat.card", [...CARD_FIELDS]],
]);

function fields(action: string, input: Record<string, unknown>) {
  const allowed = FIELDS.get(action);
  if (!allowed) throw new Error(`Unknown app action: ${action}`);
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length)
    throw new Error(`Unknown ${action} fields: ${unknown.join(", ")}`);
}

function requiredString(value: unknown, name: string, max = 30_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(
      `${name} must be a non-empty string under ${max} characters`,
    );
  return value.trim();
}

function agentPrompt(value: unknown): string {
  const prompt = requiredString(value, "prompt", 240_000);
  if (consumeOperatorCommand(prompt).matched)
    throw new Error("App calls cannot enable /operator in another session");
  return prompt;
}

function completionRecipient(
  source: Session,
  input: Record<string, unknown>,
  host: AgentAppHost,
  defaultForIrgat = false,
): string | undefined {
  const requested = input.notifyOnComplete;
  if (requested !== undefined && typeof requested !== "boolean")
    throw new Error("notifyOnComplete must be a boolean");
  const isIrgat = host.isIrgat(source.id);
  if (!(requested ?? (defaultForIrgat && isIrgat && !input.draft)))
    return undefined;
  if (!isIrgat)
    throw new Error(
      "Completion notifications are only available in a Irgat's chat",
    );
  if (input.draft === true)
    throw new Error("An unsent draft cannot send a completion notification");
  return source.id;
}

function optionalString(
  value: unknown,
  name: string,
  max = 512,
): string | undefined {
  return value === undefined ? undefined : requiredString(value, name, max);
}

function noteBody(value: unknown): string {
  if (typeof value !== "string" || value.length > 240_000)
    throw new Error("body must be a string under 240000 characters");
  return value.replace(/\r\n?/g, "\n");
}

function noteTags(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((tag) => typeof tag !== "string" || tag.length > 48)
  )
    throw new Error(
      "tags must be an array of at most 20 strings under 48 characters each",
    );
  return normalizeNoteTags(value as string[]);
}

/**
 * The project an action works in. A session works in its own; a Irgat works on
 * several, so it names one with "project" (its path or name), and may leave it
 * out when it has one project or is in one of its own.
 */
function requireProject(
  source: Session,
  input: Record<string, unknown>,
  host: AgentAppHost,
): string {
  const irgat = host.irgatOf?.(source.id);
  const named = optionalString(input.project, "project", 4096);
  if (!irgat) {
    if (named) throw new Error("project is only for a Irgat");
    if (!looksLikeProject(source.cwd))
      throw new Error("Choose a project folder in this session first");
    return source.cwd;
  }
  const choices = () =>
    irgat.projects.length
      ? irgat.projects.map((path) => `${projectName(path)} (${path})`).join(", ")
      : "none yet; the user adds them from your details panel";
  if (named) {
    const byPath = irgat.projects.find(
      (path) => pathKey(path) === pathKey(named),
    );
    const byName = irgat.projects.filter(
      (path) => projectName(path) === named,
    );
    const match = byPath ?? (byName.length === 1 ? byName[0] : undefined);
    if (!match) throw new Error(`Not one of your projects. Yours: ${choices()}. Use projects.list to find registered projects and projects.requestAccess to ask the user for access. Do not access it before approval.`);
    return match;
  }
  const own = irgat.projects.find(
    (path) => pathKey(path) === pathKey(source.cwd),
  );
  if (own) return own;
  if (irgat.projects.length === 1) return irgat.projects[0];
  throw new Error(`Pass "project" to choose one. Yours: ${choices()}`);
}

/** A Irgat's chat lives outside its projects; project access follows its roster. */
export function canAccessAgentAppProject(
  source: Session,
  cwd: string,
  irgatProjects?: readonly string[],
): boolean {
  return (irgatProjects ?? [source.cwd]).some(
    (project) => pathKey(project) === pathKey(cwd),
  );
}

/** Own Irgat chats can be read even when no project has been assigned. */
export function canReadAgentAppSession(
  source: Session,
  target: Session,
  irgatProjects?: readonly string[],
  irgatSessionIds?: readonly string[],
): boolean {
  return !!irgatSessionIds?.includes(target.id) ||
    canAccessAgentAppProject(source, target.cwd, irgatProjects);
}

async function projectSession(
  source: Session,
  id: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<Session> {
  const cwd = requireProject(source, input, host);
  if (!(await host.sessions(cwd)).some((session) => session.id === id))
    throw new Error("Session was not found in this project");
  const target = await host.session(id);
  if (!target || pathKey(target.cwd) !== pathKey(cwd))
    throw new Error("Session was not found in this project");
  return target;
}

/** Two short body paragraphs, with a hard cap independent of Markdown length. */
export function notePreview(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n\n")
    .slice(0, 400);
}

/**
 * Puts a session a Irgat started into the sidebar folder named after it,
 * making that folder in its color the first time.
 */
function fileInIrgatFolder(
  cwd: string,
  sessionId: string,
  folder: { name: string; color: string },
): void {
  const folders = loadSessionFolders(cwd);
  const own = folders.find((entry) => entry.name === folder.name);
  if (own) {
    saveSessionFolders(cwd, addSessionToFolder(folders, own.id, sessionId));
    return;
  }
  const created = createFolderWithSessions(folders, [sessionId], folder.name);
  saveSessionFolders(
    cwd,
    setFolderCustomColor(created.folders, created.id, folder.color),
  );
}

function startLaunch(
  source: Session,
  input: Record<string, unknown>,
  host: AgentAppHost,
): QuickLaunch {
  const cwd = requireProject(source, input, host);
  const prompt = agentPrompt(input.prompt);
  const draft = input.draft ?? false;
  if (typeof draft !== "boolean") throw new Error("draft must be a boolean");
  const harness = input.harness ?? source.harness;
  if (!HARNESSES.includes(harness as HarnessId))
    throw new Error("Unknown harness; run models.list for available providers");
  const chosenHarness = harness as HarnessId;
  if (!isHarnessAvailable(chosenHarness))
    throw new Error(`${chosenHarness} is not available in Irgatos`);
  const requestedModel = optionalString(input.model, "model");
  const model = requestedModel
    ? modelsFor(chosenHarness).find((entry) => entry.id === requestedModel)
    : resolveModel(
        chosenHarness,
        chosenHarness === source.harness
          ? source.model
          : preferredModelId(chosenHarness),
      );
  if (!model || model.harness !== chosenHarness)
    throw new Error("Unknown model; run models.list for exact model IDs");
  const rawSettings = input.modelSettings;
  if (
    rawSettings !== undefined &&
    (!rawSettings ||
      typeof rawSettings !== "object" ||
      Array.isArray(rawSettings))
  )
    throw new Error(
      "modelSettings must be an object of setting IDs and values",
    );
  const requestedSettings = {
    ...((rawSettings ?? {}) as Record<string, unknown>),
  };
  if (input.effort !== undefined) {
    const effort = modelEffortSetting(model);
    if (!effort)
      throw new Error(`${model.id} does not expose an effort setting`);
    requestedSettings[effort.id] = requiredString(input.effort, "effort", 128);
  }
  for (const [key, value] of Object.entries(requestedSettings)) {
    const setting = model.settings?.find((entry) => entry.id === key);
    if (
      !setting ||
      typeof value !== "string" ||
      !setting.options.some((option) => option.value === value)
    )
      throw new Error(
        `Invalid model setting ${key}; run models.list for allowed values`,
      );
  }
  const runtimeMode = input.runtimeMode ?? source.runtimeMode;
  if (!RUNTIME_MODES.includes(runtimeMode as Session["runtimeMode"]))
    throw new Error(`runtimeMode must be one of: ${RUNTIME_MODES.join(", ")}`);
  const reveal = input.reveal ?? false;
  if (typeof reveal !== "boolean") throw new Error("reveal must be a boolean");
  const workspaceMode = input.workspaceMode ?? "current";
  if (workspaceMode !== "current" && workspaceMode !== "worktree")
    throw new Error("workspaceMode must be current or worktree");
  const worktreeBase = optionalString(input.worktreeBase, "worktreeBase");
  if (worktreeBase && workspaceMode !== "worktree")
    throw new Error("worktreeBase requires workspaceMode worktree");
  const worktreeCwd = optionalString(input.worktreeCwd, "worktreeCwd");
  if (worktreeCwd && workspaceMode !== "current")
    throw new Error("worktreeCwd requires workspaceMode current");
  const currentWorktree =
    worktreeCwd ||
    (pathKey(cwd) === pathKey(source.cwd) ? source.worktreeCwd : undefined);
  return {
    cwd,
    prompt,
    // Shown unless the Irgat behind the caller turned its sessions off.
    ...(host.irgatOf?.(source.id)?.showStartedSessionsInSidebar === false
      ? { sidebarHidden: true }
      : {}),
    ...(draft ? { draft: true } : {}),
    harness: chosenHarness,
    model: model.id,
    modelSettings: mergeModelSettings(model, {
      ...(chosenHarness === source.harness && model.id === source.model
        ? source.modelSettings
        : {}),
      ...(requestedSettings as Record<string, string>),
    }),
    runtimeMode: runtimeMode as Session["runtimeMode"],
    // A Irgat delegates work without navigating the user out of their chat.
    reveal: host.isIrgat(source.id) ? false : reveal,
    workspaceMode,
    ...(workspaceMode === "current" && currentWorktree
      ? { worktreeCwd: currentWorktree }
      : {}),
    ...(worktreeBase ? { worktreeBase } : {}),
  };
}

function memoryPath(topic: unknown): AgentFilePath {
  return topic === undefined
    ? "MEMORY.md"
    : `memory/${topicName(requiredString(topic, "topic", 80))}.md`;
}

async function handleSoul(
  source: Session,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  const irgatId = host.isIrgat(source.id)
    ? host.irgatOf?.(source.id)?.id
    : undefined;
  if (!irgatId)
    throw new Error("Only a Irgat's own conversation can manage its soul");
  if (action === "soul.read") {
    const files = await host.agentFiles(irgatId);
    return { file: "SOUL.md", text: files.soul, hash: files.soulHash };
  }
  if (typeof input.text !== "string" || input.text.length > 240_000)
    throw new Error("text must be a string under 240000 characters");
  const expectedHash = requiredString(input.expectedHash, "expectedHash", 128);
  try {
    const hash = await host.writeAgentFile(
      irgatId,
      "SOUL.md",
      input.text,
      expectedHash,
    );
    return { file: "SOUL.md", updated: true, hash };
  } catch (error) {
    if (error instanceof IrgatFileConflict)
      throw new Error(
        "SOUL.md changed since you read it. Run soul.read and reapply the user's requested changes to the current text before calling soul.update again.",
      );
    throw error;
  }
}

/**
 * Read, change and write one memory file over the version it read, again
 * from the top when the user saved the same file in between.
 */
async function editAgentFile<T>(
  host: AgentAppHost,
  irgatId: string,
  path: AgentFilePath,
  edit: (text: string) => { text: string; result: T },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const current = await host.readAgentFile(irgatId, path);
    const fallback =
      current.text == null && path !== "MEMORY.md"
        ? `# ${path.slice("memory/".length, -".md".length)}\n\n`
        : "";
    const next = edit(current.text ?? fallback);
    try {
      if (next.text !== (current.text ?? ""))
        await host.writeAgentFile(irgatId, path, next.text, current.hash);
      return next.result;
    } catch (error) {
      if (!(error instanceof IrgatFileConflict) || attempt >= 2)
        throw error;
    }
  }
}

/**
 * Keeps MEMORY.md within what loads. The archive is written first, so a line
 * is never out of one file without already being in the other. If the user
 * saved MEMORY.md in between, the trim waits for the next write.
 */
async function keepMemoryInBudget(
  host: AgentAppHost,
  irgatId: string,
  keep: string,
  date: string,
): Promise<string[]> {
  const memory = await host.readAgentFile(irgatId, "MEMORY.md");
  const fitted = fitMemoryBudget(memory.text ?? "", keep, date);
  if (!fitted.moved.length) return [];
  await editAgentFile(host, irgatId, "memory/archive.md", (archive) => ({
    text: archiveMemoryEntries(archive, fitted.moved, date),
    result: undefined,
  }));
  try {
    await host.writeAgentFile(irgatId, "MEMORY.md", fitted.text, memory.hash);
  } catch (error) {
    if (!(error instanceof IrgatFileConflict)) throw error;
    return [];
  }
  return fitted.moved;
}

async function handleMemory(
  source: Session,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  const irgatId = host.irgatOf?.(source.id)?.id;
  if (!irgatId) throw new Error("Memory belongs to the Irgat's conversation");
  const path = memoryPath(input.topic);
  const date = memoryDate(host.now?.() ?? new Date());
  const until = optionalString(input.until, "until", 10);
  const report = async (result: Record<string, unknown>, keep?: string) => {
    const moved =
      path === "MEMORY.md" && keep
        ? await keepMemoryInBudget(host, irgatId, keep, date)
        : [];
    return {
      file: path,
      ...result,
      ...(moved.length
        ? { movedToArchive: moved.length, moved: moved.slice(0, 5) }
        : {}),
    };
  };
  switch (action) {
    case "memory.search": {
      const query =
        input.query === undefined
          ? ""
          : requiredString(input.query, "query", 500);
      const since =
        input.since === undefined
          ? undefined
          : sinceDate(
              requiredString(input.since, "since", 20),
              host.now?.() ?? new Date(),
            );
      const files = await host.agentFiles(irgatId);
      const paths: AgentFilePath[] = [
        "MEMORY.md",
        ...files.topics.map((topic) => `memory/${topic}.md` as const),
        "memory/archive.md",
      ];
      const texts = await Promise.all(
        paths.map(async (file) => ({
          file,
          text:
            file === "MEMORY.md"
              ? files.memory
              : ((await host.readAgentFile(irgatId, file)).text ?? ""),
        })),
      );
      const hits = searchMemory(texts, query, { since });
      return hits.length
        ? { hits }
        : { hits, note: "Nothing in memory matches. It may never have been saved." };
    }
    case "memory.read": {
      if (path !== "MEMORY.md") {
        const topic = await host.readAgentFile(irgatId, path);
        if (topic.text == null) throw new Error("No such memory topic");
        return { file: path, text: topic.text };
      }
      const files = await host.agentFiles(irgatId);
      const budget = memoryWithinBudget(files.memory);
      return {
        file: path,
        text: files.memory,
        lines: budget.lines,
        notLoaded: budget.droppedLines,
        topics: files.topics,
      };
    }
    case "memory.add": {
      const entry = memoryEntry(requiredString(input.fact, "fact"), date, until);
      const added = await editAgentFile(host, irgatId, path, (text) => {
        const next = addMemoryEntry(text, entry);
        return { text: next.text, result: next.added };
      });
      return added
        ? report({ added: entry }, entry)
        : { file: path, alreadyRemembered: true };
    }
    case "memory.replace": {
      const find = requiredString(input.find, "find", 2000);
      const entry = memoryEntry(requiredString(input.fact, "fact"), date, until);
      await editAgentFile(host, irgatId, path, (text) => ({
        text: supersedeMemoryEntry(text, find, entry, date),
        result: undefined,
      }));
      return report({ superseded: find, added: entry }, entry);
    }
    case "memory.remove": {
      const find = requiredString(input.find, "find", 2000);
      const removed = await editAgentFile(host, irgatId, path, (text) => {
        const next = removeMemoryEntry(text, find);
        return { text: next.text, result: next.removed };
      });
      return { file: path, removed };
    }
  }
  throw new Error(`Unknown app action: ${action}`);
}

function habitView(habit: Habit) {
  return {
    id: habit.id,
    name: habit.name,
    instructions: habit.instructions,
    schedule: habitScheduleLabel(habit.schedule),
    enabled: habit.enabled,
    nextRun: habit.enabled ? new Date(habit.nextRunAt).toLocaleString() : null,
    ...(habitRunningSince(habit.id) != null ? { running: true } : {}),
    ...(habit.requestApproval ? { requestApproval: true } : {}),
    ...(habit.ifCondition ? { ifCondition: habit.ifCondition } : {}),
    ...(habit.delaySeconds ? { delaySeconds: habit.delaySeconds } : {}),
    // The token is the user's secret; the agent only learns that one exists.
    ...(habit.triggerToken ? { hasTrigger: true } : {}),
    ...(habit.approval?.state === "pending"
      ? { waiting: "for the user's approval" }
      : habit.delayedUntil && habit.delayedUntil > Date.now()
        ? {
            waiting: `until ${new Date(habit.delayedUntil).toLocaleString()}`,
          }
        : {}),
    ...(habit.lastRunAt
      ? {
          lastRun: new Date(habit.lastRunAt).toLocaleString(),
          lastOutcome: habit.lastOutcome,
          ...(habit.lastError ? { lastError: habit.lastError } : {}),
        }
      : {}),
  };
}

/**
 * Guards from the CLI over the habit's current ones. An agent can make a
 * habit ask first but cannot stop it asking: approval is the user's call.
 */
function habitGuardsInput(
  input: Record<string, unknown>,
  current?: Habit,
): HabitGuardSettings | undefined {
  if (
    input.requestApproval === undefined &&
    input.ifCondition === undefined &&
    input.delaySeconds === undefined
  )
    return undefined;
  if (
    input.requestApproval !== undefined &&
    typeof input.requestApproval !== "boolean"
  )
    throw new Error("requestApproval must be true or false");
  if (input.requestApproval === false && current?.requestApproval)
    throw new Error(
      "Only the user can stop a habit asking first, from the habit's page",
    );
  let ifCondition: HabitCondition | null = current?.ifCondition ?? null;
  if (input.ifCondition === null) ifCondition = null;
  else if (input.ifCondition !== undefined) {
    const raw = input.ifCondition as Record<string, unknown> | undefined;
    if (raw?.kind === "shell" && typeof raw.command === "string")
      ifCondition = { kind: "shell", command: raw.command };
    else if (raw?.kind === "expression" && typeof raw.expression === "string")
      ifCondition = { kind: "expression", expression: raw.expression };
    else
      throw new Error(
        'ifCondition must be null, {"kind":"shell","command":"..."} or {"kind":"expression","expression":"..."}',
      );
    const error = habitConditionError(ifCondition);
    if (error) throw new Error(`ifCondition: ${error}`);
  }
  let delaySeconds = current?.delaySeconds ?? 0;
  if (input.delaySeconds !== undefined) {
    if (
      typeof input.delaySeconds !== "number" ||
      !Number.isFinite(input.delaySeconds) ||
      input.delaySeconds < 0 ||
      input.delaySeconds > HABIT_DELAY_MAX_SECONDS
    )
      throw new Error(
        `delaySeconds must be 0 to ${HABIT_DELAY_MAX_SECONDS} (a day)`,
      );
    delaySeconds = input.delaySeconds;
  }
  return {
    requestApproval:
      typeof input.requestApproval === "boolean"
        ? input.requestApproval
        : !!current?.requestApproval,
    ifCondition,
    delaySeconds,
  };
}

async function handleHabits(
  source: Session,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  const habits = host.habits;
  // A habit's own run cannot schedule more runs.
  const irgatId = host.isIrgat(source.id)
    ? host.irgatOf?.(source.id)?.id
    : undefined;
  if (!habits || !irgatId)
    throw new Error("Only a Irgat's own conversation can manage its habits");
  const now = host.now?.() ?? new Date();
  const find = (list: Habit[]) => {
    const id = requiredString(input.id, "id", 128);
    const habit = list.find((entry) => entry.id === id);
    if (!habit) throw new Error("No habit with that id; run habits.list");
    return habit;
  };
  switch (action) {
    case "habits.list":
      return { habits: (await habits.load(irgatId)).map(habitView) };
    case "habits.add": {
      const name = requiredString(input.name, "name", 80);
      const instructions = requiredString(input.instructions, "instructions", 4_000);
      const schedule = habitSchedule(input.schedule);
      const guards = habitGuardsInput(input);
      const habit = await habits.update(irgatId, (list) => {
        if (list.length >= HABITS_MAX)
          throw new Error(`A Irgat can have at most ${HABITS_MAX} habits`);
        const plain = newHabit({ name, instructions, schedule }, now.getTime());
        const created = guards ? setHabitGuards(plain, guards) : plain;
        return { habits: [...list, created], result: created };
      });
      return { habit: habitView(habit) };
    }
    case "habits.update": {
      const patch = {
        ...(input.name === undefined
          ? {}
          : { name: requiredString(input.name, "name", 80) }),
        ...(input.instructions === undefined
          ? {}
          : {
              instructions: requiredString(
                input.instructions,
                "instructions",
                4_000,
              ),
            }),
        ...(input.schedule === undefined
          ? {}
          : { schedule: habitSchedule(input.schedule) }),
      };
      if (input.enabled !== undefined && typeof input.enabled !== "boolean")
        throw new Error("enabled must be true or false");
      const habit = await habits.update(irgatId, (list) => {
        const current = find(list);
        const guards = habitGuardsInput(input, current);
        const guarded = guards ? setHabitGuards(current, guards) : current;
        const next: Habit = {
          ...(input.enabled === false && current.enabled
            ? pauseHabit(guarded)
            : guarded),
          ...patch,
          ...(input.enabled === undefined
            ? {}
            : { enabled: input.enabled as boolean }),
        };
        // A new schedule, or turning it back on, counts from now.
        if (patch.schedule || (next.enabled && !current.enabled))
          next.nextRunAt = nextHabitRunAt(next.schedule, now.getTime());
        return {
          habits: list.map((entry) => (entry.id === next.id ? next : entry)),
          result: next,
        };
      });
      return { habit: habitView(habit) };
    }
    case "habits.run": {
      const running = habitRunningSince(requiredString(input.id, "id", 128));
      if (running != null)
        throw new Error(
          `That habit is already running (started ${new Date(running).toLocaleTimeString()}); its result will be posted here when it ends`,
        );
      const habit = await habits.update(irgatId, (list) => {
        const next = { ...find(list), runRequested: true };
        return {
          habits: list.map((entry) => (entry.id === next.id ? next : entry)),
          result: next,
        };
      });
      checkHabitsNow();
      return {
        habit: habitView(habit),
        note: "It starts now, on its own. Whatever it finds is posted to this chat, or nothing if there is nothing to say.",
      };
    }
    case "habits.remove": {
      const removed = await habits.update(irgatId, (list) => {
        const habit = find(list);
        return {
          habits: list.filter((entry) => entry.id !== habit.id),
          result: habit,
        };
      });
      return { removed: removed.name };
    }
  }
  throw new Error(`Unknown app action: ${action}`);
}

function artifactKind(value: unknown): ArtifactKind {
  if (value === undefined) return "document";
  if (ARTIFACT_KINDS.includes(value as ArtifactKind))
    return value as ArtifactKind;
  throw new Error('Unsupported artifact kind; use "document" or "html"');
}

async function handleArtifacts(
  source: Session,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  if (!(host.isIrgat(source.id) || host.isHabitRun?.(source.id)))
    throw new Error("Only a Irgat can create or read artifacts");
  if (!host.artifact) throw new Error("Artifacts are unavailable");
  if (action === "artifacts.list") {
    if (!host.artifacts) throw new Error("Artifacts are unavailable");
    const kind =
      input.kind === undefined ? undefined : artifactKind(input.kind);
    const limit = input.limit ?? 30;
    const offset = input.offset ?? 0;
    if (
      !Number.isInteger(limit) ||
      (limit as number) < 1 ||
      (limit as number) > 100
    )
      throw new Error("limit must be an integer from 1 to 100");
    if (!Number.isInteger(offset) || (offset as number) < 0)
      throw new Error("offset must be a non-negative integer");
    const artifacts = (await host.artifacts()).filter(
      (artifact) => kind === undefined || artifact.kind === kind,
    );
    return {
      total: artifacts.length,
      offset,
      artifacts: artifacts
        .slice(offset as number, (offset as number) + (limit as number))
        .map(({ id, kind, title, updatedAt }) => ({
          id,
          kind,
          title,
          updatedAt,
        })),
    };
  }
  if (action === "artifacts.read") {
    const artifact = await host.artifact(requiredString(input.id, "id", 256));
    if (!artifact) throw new Error("Artifact was not found");
    return artifact;
  }
  if (!host.saveArtifact || !host.postArtifact)
    throw new Error("Artifacts are unavailable");
  const kind = artifactKind(input.kind);
  const id = optionalString(input.id, "id", 256);
  if (id && !/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error("Invalid artifact ID");
  const title =
    input.title === undefined
      ? undefined
      : requiredString(input.title, "title", 200);
  const body = input.body === undefined ? undefined : noteBody(input.body);
  const summary =
    input.summary === undefined
      ? undefined
      : requiredString(input.summary, "summary", 280);
  let artifact: Artifact;
  if (id) {
    if (title === undefined && body === undefined)
      throw new Error("Supply title or body to update an artifact");
    const current = await host.artifact(id);
    if (!current) throw new Error("Artifact was not found");
    if (current.kind !== kind)
      throw new Error("An artifact's kind cannot be changed");
    artifact = await host.saveArtifact({
      id,
      kind,
      title: title ?? current.title,
      body: body ?? current.body,
    });
  } else {
    if (body === undefined)
      throw new Error("body is required to create an artifact");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
      throw new Error("Invalid request ID");
    const createdId = `artifact-${source.id}-${requestId}`;
    const existing = await host.artifact(createdId);
    if (
      existing &&
      (existing.kind !== kind ||
        existing.title !== (title ?? noteTitle(body)) ||
        existing.body !== body)
    )
      throw new Error("Request ID was already used for another artifact");
    artifact =
      existing ??
      (await host.saveArtifact({
        id: createdId,
        kind,
        title: title ?? noteTitle(body),
        body,
        sourceSessionId: source.id,
        ...(looksLikeProject(source.cwd) ? { sourceCwd: source.cwd } : {}),
      }));
  }
  const card: ArtifactCard = {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    ...(summary ? { summary } : {}),
  };
  await host.postArtifact(source.id, card);
  return { ...card, saved: true, attached: true };
}

export async function handleAgentApp(
  source: Session,
  requestId: string,
  action: string,
  input: Record<string, unknown>,
  host: AgentAppHost,
): Promise<unknown> {
  fields(action, input);
  if (action === "computer.read" || action === "computer.act") {
    if (host.isHabitRun?.(source.id)) throw new Error("Scheduled habits cannot use shared application windows");
    if (!host.computer) throw new Error("Application control is unavailable");
    if (action === "computer.read") {
      const query = input.query == null ? undefined : requiredString(input.query, "query", 1000);
      return host.computer(source.id, "get_window_state", query ? { query } : {});
    }
    const tool = requiredString(input.tool, "tool", 40);
    if (!["click", "type_text", "scroll", "press_key", "hotkey"].includes(tool))
      throw new Error("Unsupported window action");
    if (!input.args || typeof input.args !== "object" || Array.isArray(input.args))
      throw new Error("args must be an object");
    return host.computer(source.id, tool, input.args as Record<string, unknown>);
  }
  if (action === "projects.list" || action === "projects.requestAccess") {
    const irgat = host.irgatOf?.(source.id);
    if (!irgat || !host.isIrgat(source.id))
      throw new Error("Project access requests are only available in a Irgat chat");
    const projects = host.projects?.() ?? [];
    if (action === "projects.list")
      return projects.map((project) => ({
        ...project,
        access: irgat.projects.some((path) => pathKey(path) === pathKey(project.path)),
      }));
    const named = requiredString(input.project, "project", 4096);
    const byPath = projects.find((project) => pathKey(project.path) === pathKey(named));
    const byName = projects.filter((project) => project.name.toLowerCase() === named.toLowerCase());
    const project = byPath ?? (byName.length === 1 ? byName[0] : undefined);
    if (!project) throw new Error("Choose a registered project path from projects.list");
    if (irgat.projects.some((path) => pathKey(path) === pathKey(project.path)))
      return { project: project.path, access: true };
    if (!host.requestProjectAccess) throw new Error("Project approval is unavailable");
    host.requestProjectAccess(source.id, irgat.id, project.path);
    return { project: project.path, access: false, pending: true,
      note: "The user must approve in the chat. End your turn and wait; do not access the project or substitute provider-native subagents. After approval Irgatos will continue your request." };
  }
  if (action === "irgats.list" || action === "irgats.send") {
    const self = host.isIrgat(source.id) ? host.irgatOf?.(source.id) : undefined;
    if (!self || !host.irgats || !host.messageIrgat)
      throw new Error("Only a Irgat's chat can message other Irgats");
    const contacts = host.irgats();
    if (action === "irgats.list")
      return { irgats: contacts.filter((contact) => contact.id !== self.id) };
    const target = resolveIrgatContact(
      contacts,
      requiredString(input.irgat, "irgat", 256),
      self.id,
    );
    const message = requiredString(input.message, "message", 240_000);
    if (consumeOperatorCommand(message).matched)
      throw new Error("App calls cannot enable /operator in another session");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
      throw new Error("Invalid request ID");
    assertAgentExchangeAllowed(source);
    const result = await host.messageIrgat(
      target.id,
      message,
      `app-${source.id}-${requestId}`,
      source.id,
    );
    return {
      irgatId: target.id,
      name: target.name,
      submitted: true,
      ...result,
      notifyOnComplete: true,
      note: `${target.name} answers in its own chat. Its reply comes back to you as a notification once you are idle: tell the user you asked ${target.name}, end your turn, and pass the answer on when it arrives.`,
    };
  }
  if (action === "claude.list" || action === "claude.send") {
    if (!host.isIrgat(source.id) || !host.externalClaudeSessions || !host.messageExternalClaude)
      throw new Error("Only a Irgat's chat can message Claude Code sessions outside Irgatos");
    const sessions = await host.externalClaudeSessions();
    if (action === "claude.list")
      return { sessions: sessions.map(externalClaudeContact) };
    const target = resolveExternalClaude(
      sessions,
      requiredString(input.session, "session", 4096),
    );
    const message = requiredString(input.message, "message", 240_000);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
      throw new Error("Invalid request ID");
    const contact = externalClaudeContact(target);
    if (!contact.canMessage)
      throw new Error(`${contact.name} does not take messages; it may need a newer Claude Code`);
    if (contact.busy)
      throw new Error(`${contact.name} is busy; try again when it finishes`);
    assertAgentExchangeAllowed(source);
    await host.messageExternalClaude(target, message, `app-${source.id}-${requestId}`, source.id);
    return {
      sessionId: contact.id,
      name: contact.name,
      submitted: true,
      notifyOnComplete: true,
      note: `${contact.name} got your message in its own Claude Code window. Its answer comes back to you as a notification once you are idle: tell the user you asked it, end your turn, and pass the answer on when it arrives.`,
    };
  }
  if (action.startsWith("artifacts."))
    return handleArtifacts(source, requestId, action, input, host);
  if (action.startsWith("soul."))
    return handleSoul(source, action, input, host);
  if (action.startsWith("memory."))
    return handleMemory(source, action, input, host);
  if (action.startsWith("habits."))
    return handleHabits(source, action, input, host);
  if (action === "chat.card") {
    if (
      !host.postCard ||
      !(host.isIrgat(source.id) || host.isHabitRun?.(source.id))
    )
      throw new Error("Only a Irgat can put cards in its chat");
    const card = parseCard(input);
    host.postCard(source.id, card);
    return {
      posted: card.type,
      note: host.isIrgat(source.id)
        ? "It shows in the chat where you are in your reply."
        : "It goes out with your report, after its text; if you stay quiet, it is dropped.",
    };
  }
  switch (action) {
    case "models.list":
      return {
        runtimeModes: RUNTIME_MODES.map((id) => ({
          id,
          label: RUNTIME_MODE_LABEL[id],
          description: RUNTIME_MODE_HINT[id],
        })),
        harnesses: HARNESSES.map((harness) => ({
          id: harness,
          available: isHarnessAvailable(harness),
          models: modelsFor(harness).map((model) => ({
            id: model.id,
            name: model.name,
            settings: model.settings ?? [],
          })),
        })),
      };
    case "sessions.list": {
      const irgat = host.irgatOf?.(source.id);
      if (input.project === undefined && irgat?.sessionIds) {
        const chats = await Promise.all(irgat.sessionIds.map((id) =>
          id === source.id ? source : host.session(id),
        ));
        return {
          irgatId: irgat.id,
          sessions: chats.flatMap((chat) => chat ? [{
            id: chat.id,
            title: chat.title,
            harness: chat.harness,
            model: chat.model,
            busy: !!chat.busy,
            hasDraft: chat.blocks.some((block) => block.role === "user" && block.draft),
            archived: false,
          }] : []),
        };
      }
      const cwd = requireProject(source, input, host);
      return { cwd, sessions: await host.sessions(cwd) };
    }
    case "sessions.read": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      const ownChat = host.irgatOf?.(source.id)?.sessionIds?.includes(id);
      const target = id === source.id && host.isIrgat?.(id)
        ? source : ownChat
          ? await host.session(id)
          : await projectSession(source, id, input, host);
      if (!target) throw new Error("Irgat chat is no longer available");
      const options = {
        before: optionalString(input.before, "before", 256),
        limit: input.limit as number | undefined,
        maxChars: input.maxChars as number | undefined,
      };
      return host.readConversation ? host.readConversation(target, options) : sessionConversationPage(target, options);
    }
    case "sessions.send": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      const prompt = agentPrompt(input.prompt);
      const notifyIrgatId = completionRecipient(source, input, host);
      if (id === source.id)
        throw new Error(
          "Use the current conversation to continue this session",
        );
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      await projectSession(source, id, input, host);
      const result = await host.send(
        id,
        prompt,
        `app-${source.id}-${requestId}`,
        ...(notifyIrgatId ? [notifyIrgatId] : []),
      );
      return {
        sessionId: id,
        submitted: true,
        ...result,
        ...(notifyIrgatId ? { notifyOnComplete: true } : {}),
      };
    }
    case "sessions.draft": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      const prompt = agentPrompt(input.prompt);
      if (id === source.id)
        throw new Error("Use the composer to save a draft in this session");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      await projectSession(source, id, input, host);
      const result = await host.draft(
        id,
        prompt,
        `app-${source.id}-${requestId}`,
      );
      return { sessionId: id, saved: true, ...result };
    }
    case "sessions.stop":
    case "sessions.archive":
    case "sessions.delete": {
      const id = requiredString(input.sessionId, "sessionId", 256);
      if (id === source.id)
        throw new Error("Cannot stop, archive or delete the calling session");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      const target = await projectSession(source, id, input, host);
      if (
        target.orchestrationLeadId ||
        host.isIrgat(id) ||
        host.isHabitRun?.(id)
      )
        throw new Error("Only regular project sessions can be managed here");
      if (action === "sessions.stop") {
        await host.stop(id);
        return { sessionId: id, stopped: true };
      }
      const mode = action === "sessions.archive" ? "archive" : "delete";
      await host.remove(id, mode);
      return {
        sessionId: id,
        [mode === "archive" ? "archived" : "deleted"]: true,
      };
    }
    case "sessions.start": {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error(
          "request ID must use letters, digits, underscores or hyphens",
        );
      const launch = startLaunch(source, input, host);
      // Completion reports follow local sessions only; a session on another
      // machine is followed from that project's Sessions sidebar.
      const notifyIrgatId = isRemoteProjectPath(launch.cwd)
        ? undefined
        : completionRecipient(source, input, host, true);
      if (input.worktreeCwd !== undefined) {
        const chosen = (await host.worktrees(launch.cwd)).worktrees.find(
          (tree) =>
            !tree.missing &&
            pathKey(tree.path) === pathKey(launch.worktreeCwd!),
        );
        if (!chosen)
          throw new Error(
            "Worktree is unavailable in this project; run worktrees.list",
          );
        launch.worktreeCwd =
          pathKey(chosen.path) === pathKey(launch.cwd)
            ? undefined
            : chosen.path;
      }
      const placement = input.placement ?? "tab";
      if (placement !== "tab" && placement !== "right" && placement !== "down")
        throw new Error("placement must be tab, right or down");
      if (input.besideSessionId !== undefined && placement === "tab")
        throw new Error("besideSessionId requires placement right or down");
      // A split defaults to the caller's pane, but an Irgat's chat is not a
      // project pane, so its launch opens normally unless it names a pane.
      const besideSessionId =
        placement === "tab"
          ? undefined
          : (optionalString(input.besideSessionId, "besideSessionId", 256) ??
            (host.isIrgat(source.id) ? undefined : source.id));
      const id = `app-${source.id}-${requestId}`;
      if (besideSessionId)
        await host.start(
          launch,
          id,
          { direction: placement as SplitDir, besideSessionId },
          ...(notifyIrgatId ? [notifyIrgatId] : []),
        );
      else if (notifyIrgatId) await host.start(launch, id, undefined, notifyIrgatId);
      else await host.start(launch, id);
      const folder = host.irgatOf?.(source.id)?.folder;
      if (folder && !launch.sidebarHidden)
        fileInIrgatFolder(launch.cwd, id, folder);
      return {
        id,
        cwd: launch.cwd,
        harness: launch.harness,
        model: launch.model,
        submitted: !launch.draft,
        draft: !!launch.draft,
        ...(notifyIrgatId ? { notifyOnComplete: true } : {}),
      };
    }
    case "worktrees.list":
      return host.worktrees(requireProject(source, input, host));
    case "worktrees.create": {
      const cwd = requireProject(source, input, host);
      const branch = requiredString(input.branch, "branch", 400);
      const existing = input.existing ?? false;
      if (typeof existing !== "boolean")
        throw new Error("existing must be a boolean");
      const base = optionalString(input.base, "base", 400);
      if (existing && base)
        throw new Error("base cannot be set for an existing branch");
      return host.createWorktree(cwd, branch, base ?? "HEAD", existing);
    }
    case "folders.list": {
      const cwd = requireProject(source, input, host);
      return {
        cwd,
        folders: loadSessionFolders(cwd).map(({ id, name, sessionIds }) => ({
          id,
          name,
          sessionIds,
        })),
      };
    }
    case "folders.move": {
      const cwd = requireProject(source, input, host);
      const sessionId = requiredString(input.sessionId, "sessionId", 256);
      const folderId = optionalString(input.folderId, "folderId", 256);
      const newFolderName = optionalString(
        input.newFolderName,
        "newFolderName",
        100,
      );
      if (!!folderId === !!newFolderName)
        throw new Error("Supply exactly one of folderId or newFolderName");
      if (
        !(await host.sessions(cwd)).some((session) => session.id === sessionId)
      )
        throw new Error("Session was not found in this project");
      const folders = loadSessionFolders(cwd);
      if (folderId && !folders.some((folder) => folder.id === folderId))
        throw new Error("Folder was not found in this project");
      const next = placeSessionInFolder(
        folders,
        sessionId,
        folderId
          ? { kind: "existing", folderId }
          : { kind: "new", name: newFolderName! },
      );
      saveSessionFolders(cwd, next);
      const folder = next.find((entry) => entry.sessionIds.includes(sessionId));
      return { sessionId, folderId: folder?.id, folderName: folder?.name };
    }
    case "notes.list": {
      const limit = input.limit ?? 30;
      const offset = input.offset ?? 0;
      if (
        !Number.isInteger(limit) ||
        (limit as number) < 1 ||
        (limit as number) > 100
      )
        throw new Error("limit must be an integer from 1 to 100");
      if (!Number.isInteger(offset) || (offset as number) < 0)
        throw new Error("offset must be a non-negative integer");
      const notes = await host.notes();
      return {
        total: notes.length,
        offset,
        notes: notes
          .slice(offset as number, (offset as number) + (limit as number))
          .map((note) => ({
            id: note.id,
            title: note.title,
            preview: notePreview(note.body),
            tags: note.tags,
            sourceCwd: note.sourceCwd,
          })),
      };
    }
    case "notes.read": {
      const id = requiredString(input.id, "id", 256);
      const note = await host.note(id);
      if (!note) throw new Error("Note was not found");
      return note;
    }
    case "notes.write": {
      const id = optionalString(input.id, "id", 256);
      if (id && !/^[A-Za-z0-9_-]+$/.test(id))
        throw new Error("Invalid note ID");
      const title =
        input.title === undefined
          ? undefined
          : requiredString(input.title, "title", 200);
      const body = input.body === undefined ? undefined : noteBody(input.body);
      const tags = input.tags === undefined ? undefined : noteTags(input.tags);
      if (id) {
        if (title === undefined && body === undefined && tags === undefined)
          throw new Error("Supply title, body or tags to update a note");
        const current = await host.note(id);
        if (!current) throw new Error("Note was not found");
        return host.saveNote({
          id,
          title: title ?? current.title,
          body: body ?? current.body,
          tags: tags ?? current.tags,
        });
      }
      if (body === undefined)
        throw new Error("body is required to create a note");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw new Error("Invalid request ID");
      const createdId = `app-${source.id}-${requestId}`;
      const existing = await host.note(createdId);
      if (existing) {
        if (
          existing.title !== (title ?? noteTitle(body)) ||
          existing.body !== body ||
          JSON.stringify(existing.tags) !== JSON.stringify(tags ?? [])
        )
          throw new Error("Request ID was already used for another note");
        return existing;
      }
      return host.saveNote({
        id: createdId,
        title: title ?? noteTitle(body),
        body,
        tags: tags ?? [],
        sourceSessionId: source.id,
        ...(looksLikeProject(source.cwd) ? { sourceCwd: source.cwd } : {}),
      });
    }
  }
}
