import { projectKey, projectName } from "../../../shared/lib/paths";
import { readStoredJson, writeStoredJson } from "../../../shared/lib/safeStorage";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupMascot,
  TAB_GROUP_COLORS,
} from "../../workspace/model/tabGroups";
import {
  hasPendingApproval,
  type Block,
  type Session,
} from "../../sessions/model/session";
import {
  PROJECT_MASCOTS,
  projectMascot,
} from "../../projects/model/projectMascots";
import { removeIrgatBackground } from "./irgatBackground";
import { collectRailProjects, loadRecents } from "../../projects/model/recents";

/** The project palette's colors, plus indigo for a Irgat's ninth preset. */
export const IRGAT_COLORS = [
  ...TAB_GROUP_COLORS.slice(1),
  "hsl(245 75% 65%)",
] as const;

/**
 * A Irgat is a long-lived agent of its own: a name, a mascot and a color, one
 * conversation, and the projects it works on. It is not tied to any one of
 * them; it lives on the rail beside the projects and can be given more.
 */
export type Irgat = {
  id: string;
  /** Its conversation; absent until it is first opened. */
  sessionId?: string;
  /** Replaces the mascot's own name. */
  name?: string;
  mascot: string;
  color: string;
  /** Project folders it works on, in the order they were added. */
  projects: string[];
  /** New sessions stay out of the project sidebar unless turned on. */
  showStartedSessionsInSidebar?: boolean;
  /** Files the sessions it starts into a sidebar folder named after it. */
  useSidebarFolders?: boolean;
  /** Superseded by SOUL.md; only read once, to seed it. */
  instructions?: string;
  /**
   * From when each project had its own Irgat: the project whose agent folder
   * it inherits. The folder moves under its id the first time it is read.
   */
  legacyProject?: string;
};

const ROSTER_KEY = "irgat:irgat-roster";
const IRGATS_CHANGED = "irgat:irgats-changed";
export const HANDED_KEY = "irgat:irgat-handed";

/** Storage from when each project had one Irgat, keyed by project. */
const LEGACY_AGENTS_KEY = "irgat:irgats";
const LEGACY_PROFILES_KEY = "irgat:irgat-profiles";
/** And from before Irgats had their name. */
const LEGACY_KEYS: [string, string][] = [
  ["irgat:project-agents", LEGACY_AGENTS_KEY],
  ["irgat:project-agent-profiles", LEGACY_PROFILES_KEY],
  ["irgat:project-agent-handed", HANDED_KEY],
];

function readJson(key: string): unknown {
  return readStoredJson(key);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

let migrated = false;

/**
 * Turns each project's Irgat into one of its own that works on that project,
 * keeping its conversation, name and look. One never claimed is dropped.
 */
export function migrateLegacyIrgatStorage(): void {
  if (migrated) return;
  migrated = true;
  try {
    for (const [legacy, key] of LEGACY_KEYS) {
      const value = localStorage.getItem(legacy);
      if (value == null) continue;
      if (localStorage.getItem(key) == null) localStorage.setItem(key, value);
      localStorage.removeItem?.(legacy);
    }
    if (localStorage.getItem(ROSTER_KEY) != null) return;
    const agents = record(readJson(LEGACY_AGENTS_KEY));
    const profiles = record(readJson(LEGACY_PROFILES_KEY));
    const mascots = loadTabGroupMascots();
    const colors = loadTabGroupColors();
    const customColors = loadTabGroupCustomColors();
    const roster: Irgat[] = [];
    for (const project of new Set([
      ...Object.keys(agents),
      ...Object.keys(profiles),
    ])) {
      const sessionId = agents[project];
      const profile = record(profiles[project]);
      if (typeof sessionId !== "string" && profile.claim !== "claimed")
        continue;
      const seed = projectName(project);
      roster.push({
        id: newIrgatId(),
        ...(typeof sessionId === "string" ? { sessionId } : {}),
        ...(typeof profile.name === "string" && profile.name.trim()
          ? { name: profile.name }
          : {}),
        mascot: projectMascot(seed, resolveTabGroupMascot(project, mascots))
          .name,
        color: resolveTabGroupColor(project, colors, customColors, seed),
        projects: [project],
        ...(typeof profile.instructions === "string" &&
        profile.instructions.trim()
          ? { instructions: profile.instructions }
          : {}),
        legacyProject: project,
      });
    }
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
    localStorage.removeItem?.(LEGACY_AGENTS_KEY);
    localStorage.removeItem?.(LEGACY_PROFILES_KEY);
  } catch {
    // Storage unavailable: there is nothing to move either.
  }
}

function newIrgatId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseIrgat(value: unknown): Irgat | undefined {
  const entry = record(value);
  if (typeof entry.id !== "string" || !/^[A-Za-z0-9-]+$/.test(entry.id))
    return undefined;
  const text = (key: string) =>
    typeof entry[key] === "string" ? (entry[key] as string) : undefined;
  const sessionId = text("sessionId");
  const name = text("name");
  const instructions = text("instructions");
  const legacyProject = text("legacyProject");
  return {
    id: entry.id,
    ...(sessionId ? { sessionId } : {}),
    ...(name ? { name } : {}),
    mascot: text("mascot") ?? PROJECT_MASCOTS[0].name,
    color: text("color") ?? TAB_GROUP_COLORS[1],
    projects: Array.isArray(entry.projects)
      ? entry.projects.filter(
          (path): path is string => typeof path === "string" && !!path,
        )
      : [],
    ...(typeof entry.showStartedSessionsInSidebar === "boolean"
      ? { showStartedSessionsInSidebar: entry.showStartedSessionsInSidebar }
      : {}),
    ...(entry.useSidebarFolders === true ? { useSidebarFolders: true } : {}),
    ...(instructions ? { instructions } : {}),
    ...(legacyProject ? { legacyProject } : {}),
  };
}

/** Every Irgat, in the order the rail shows them. */
export function listIrgats(): Irgat[] {
  migrateLegacyIrgatStorage();
  const parsed = readJson(ROSTER_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => parseIrgat(entry) ?? []);
}

function saveRoster(roster: readonly Irgat[]): void {
  try {
    writeStoredJson(ROSTER_KEY, roster, { backup: true });
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(IRGATS_CHANGED));
}

export function findIrgat(id: string): Irgat | undefined {
  return listIrgats().find((irgat) => irgat.id === id);
}

/** The Irgat whose conversation this is. */
export function irgatForSession(sessionId: string): Irgat | undefined {
  return listIrgats().find((irgat) => irgat.sessionId === sessionId);
}

export function isIrgatSession(sessionId: string): boolean {
  return !!irgatForSession(sessionId);
}

/**
 * The mascot and color the next Irgat gets: ones the others are not using yet,
 * where any are left.
 */
export function nextIrgatLook(
  roster: readonly Pick<Irgat, "mascot" | "color">[] = listIrgats(),
): { mascot: string; color: string } {
  const mascots = new Set(roster.map((irgat) => irgat.mascot));
  const colors = new Set(roster.map((irgat) => irgat.color));
  const palette = IRGAT_COLORS;
  return {
    mascot: (
      PROJECT_MASCOTS.find((mascot) => !mascots.has(mascot.name)) ??
      PROJECT_MASCOTS[roster.length % PROJECT_MASCOTS.length]
    ).name,
    color:
      palette.find((color) => !colors.has(color)) ??
      palette[roster.length % palette.length],
  };
}

/** A new Irgat with the next look, starting with the projects given, if any. */
export function createIrgat(projects: readonly string[] = []): Irgat {
  const roster = listIrgats();
  const irgat: Irgat = {
    id: newIrgatId(),
    ...nextIrgatLook(roster),
    projects: uniqueProjects(projects),
  };
  saveRoster([...roster, irgat]);
  return irgat;
}

const INTRO_DISMISSED_KEY = "irgat:irgat-intro-dismissed";

/** Whether the user passed on the intro that meets them before any Irgat. */
export function irgatIntroDismissed(): boolean {
  try {
    return localStorage.getItem(INTRO_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissIrgatIntro(): void {
  try {
    localStorage.setItem(INTRO_DISMISSED_KEY, "1");
  } catch {
    // It shows again next launch; harmless.
  }
  window.dispatchEvent(new CustomEvent(IRGATS_CHANGED));
}

const OPEN_IRGAT_KEY = "irgat:open-irgat";

/** The Irgat whose conversation was open, so the next launch reopens it. */
export function loadOpenIrgat(): string | undefined {
  try {
    return localStorage.getItem(OPEN_IRGAT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveOpenIrgat(irgatId: string | undefined): void {
  try {
    if (irgatId) localStorage.setItem(OPEN_IRGAT_KEY, irgatId);
    else localStorage.removeItem(OPEN_IRGAT_KEY);
  } catch {
    // The next launch opens the workspace instead; harmless.
  }
}

function uniqueProjects(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = projectKey(path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Discover sidebar projects without granting access or changing assignments. */
export function irgatKnownProjects(irgat: Pick<Irgat, "projects">, currentCwd: string): string[] {
  return uniqueProjects([
    ...irgat.projects,
    ...[...collectRailProjects(loadRecents(), currentCwd).values()].map((project) => project.path),
  ]);
}

export function updateIrgat(
  id: string,
  change: (irgat: Irgat) => Irgat,
): Irgat | undefined {
  const roster = listIrgats();
  const index = roster.findIndex((irgat) => irgat.id === id);
  if (index < 0) return undefined;
  const next = change(roster[index]);
  if (!next.name?.trim()) delete next.name;
  if (!next.instructions?.trim()) delete next.instructions;
  next.projects = uniqueProjects(next.projects);
  roster[index] = next;
  saveRoster(roster);
  return next;
}

/** Forgets the Irgat and its background. Its folder of files stays on disk. */
export function removeIrgat(id: string): void {
  removeIrgatBackground(id);
  saveRoster(listIrgats().filter((irgat) => irgat.id !== id));
}

export function reorderIrgats(ids: readonly string[]): void {
  const roster = listIrgats();
  const order = new Map(ids.map((id, index) => [id, index]));
  saveRoster(
    [...roster].sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

export function saveIrgatSessionId(irgatId: string, sessionId: string): void {
  updateIrgat(irgatId, (irgat) => ({ ...irgat, sessionId }));
}

export function saveIrgatName(irgatId: string, name: string): void {
  updateIrgat(irgatId, (irgat) => ({ ...irgat, name }));
}

export function saveIrgatMascot(irgatId: string, mascot: string): void {
  updateIrgat(irgatId, (irgat) => ({ ...irgat, mascot }));
}

export function addIrgatProject(irgatId: string, path: string): void {
  updateIrgat(irgatId, (irgat) => ({
    ...irgat,
    projects: [...irgat.projects, path],
  }));
}

export function removeIrgatProject(irgatId: string, path: string): void {
  const key = projectKey(path);
  updateIrgat(irgatId, (irgat) => ({
    ...irgat,
    projects: irgat.projects.filter((project) => projectKey(project) !== key),
  }));
}

/** Whether the Irgat has been given this project. */
export function irgatWorksOn(irgat: Pick<Irgat, "projects">, path: string) {
  const key = projectKey(path);
  return irgat.projects.some((project) => projectKey(project) === key);
}

export function subscribeIrgats(onChange: () => void): () => void {
  window.addEventListener(IRGATS_CHANGED, onChange);
  return () => window.removeEventListener(IRGATS_CHANGED, onChange);
}

/**
 * Snapshot for `useSyncExternalStore`; stable while storage is unchanged.
 * Project labels are part of it, since a Irgat's look names its projects.
 */
export function monosSnapshot(): string {
  migrateLegacyIrgatStorage();
  try {
    return `${localStorage.getItem(ROSTER_KEY) ?? ""}|${JSON.stringify(
      loadTabGroupLabels(),
    )}|${irgatIntroDismissed()}`;
  } catch {
    return "";
  }
}

/** Mascots whose Irgat name is shorter than the mascot's. */
const IRGAT_NAME: Record<string, string> = { mushroom: "Shroom" };

/** The name a Irgat goes by until the user names it: "IrgatCrab", "IrgatShroom". */
export function defaultIrgatName(mascot: string): string {
  return `Irgat${IRGAT_NAME[mascot] ?? mascot.charAt(0).toUpperCase() + mascot.slice(1)}`;
}

/** One project a Irgat works on, as the rail labels it. */
export type IrgatProject = { path: string; name: string };

export type IrgatLook = {
  /** The user's name for it, or its default: "IrgatInvader", "IrgatGhost". */
  name: string;
  mascot: string;
  color: string;
  projects: IrgatProject[];
};

/** How a Irgat looks, and the projects it works on by their rail labels. */
export function irgatLook(irgat: Irgat): IrgatLook {
  const labels = loadTabGroupLabels();
  return {
    name: irgat.name?.trim() || defaultIrgatName(irgat.mascot),
    mascot: irgat.mascot,
    color: irgat.color,
    projects: irgat.projects.map((path) => ({
      path,
      name: resolveTabGroupLabel(projectKey(path), labels, projectName(path)),
    })),
  };
}

/** Its projects as a phrase: "app", "app and site", "app, site and api". */
export function irgatProjectsPhrase(projects: readonly IrgatProject[]): string {
  const names = projects.map((project) => project.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Plain one-line take on a step's title, for the Irgat's status. */
function plainLine(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>)\s*/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/^\s*[-\d.]+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the agent is doing right now, as the Irgats roster shows it. */
export type IrgatStatus = "working" | "needs-you" | "idle";

export type IrgatState = {
  status: IrgatStatus;
  /** Short present-tense note while working or waiting. */
  activity?: string;
};

export const IRGAT_STATUS_LABEL: Record<IrgatStatus, string> = {
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
};

/** The agent's state, with the step it is on or the call it is waiting for. */
export function irgatState(
  session: Pick<
    Session,
    "blocks" | "busy" | "pendingQuestion" | "worktreeRemoved" | "usageLimit"
  >,
): IrgatState {
  const { blocks, pendingQuestion: question } = session;
  if (!session.worktreeRemoved && question) {
    return {
      status: "needs-you",
      activity: question.title?.trim() || question.questions[0]?.prompt.trim(),
    };
  }
  if (!session.worktreeRemoved && hasPendingApproval(blocks)) {
    const approval = latest(
      blocks,
      (block) => !!block.approval && !block.approval.decided,
    );
    return {
      status: "needs-you",
      activity: approval?.tool?.title
        ? `Approve ${plainLine(approval.tool.title)}`
        : "Waiting for approval",
    };
  }
  if (!session.worktreeRemoved && session.usageLimit) {
    return { status: "needs-you", activity: "Usage limit reached" };
  }
  if (!session.busy) return { status: "idle" };
  const last = blocks[blocks.length - 1];
  if (last?.role === "assistant" && !last.tool && last.streaming) {
    return { status: "working", activity: "Writing a reply" };
  }
  // Only a step from the current turn says what it is doing now.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user") break;
    if (block.tool?.title) {
      return { status: "working", activity: plainLine(block.tool.title) };
    }
  }
  return { status: "working", activity: "Thinking" };
}

function latest(
  blocks: readonly Block[],
  match: (block: Block) => boolean,
): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (match(blocks[i])) return blocks[i];
  }
  return undefined;
}
