import { persistableAttachment } from "../../sessions/model/attachments";
import type { Attachment, HarnessId } from "../../sessions/model/session";
import { readStoredJson, writeStoredJson } from "../../../shared/lib/safeStorage";
import { findIrgat, irgatLook, listIrgats, type Irgat } from "./irgat";

/**
 * A group room: several Irgats and the user in one conversation. Each member
 * keeps its own soul, memory and model; the room only holds who is in it and
 * what was said, labeled by speaker.
 */
export type IrgatGroup = {
  id: string;
  /** Replaces the name made from its members. */
  name?: string;
  /** Member Irgats, in the order they reply. */
  memberIds: string[];
  /**
   * Who answers a message that mentions nobody: every member in order, or
   * only the ones picked above the composer.
   */
  mode: IrgatGroupMode;
  /** A reply that mentions another member hands it a follow-up turn. */
  autoHandoff: boolean;
  createdAt: number;
};

export type IrgatGroupMode = "round" | "pick";

/** One line of the room's transcript. */
export type IrgatGroupMessage = {
  id: string;
  role: "user" | "irgat" | "notice";
  text: string;
  at: number;
  /** The Irgat that spoke, for "irgat" messages and a failed turn's notice. */
  irgatId?: string;
  /** Its name when it spoke, so the line still reads after a rename or removal. */
  name?: string;
  mascot?: string;
  color?: string;
  harness?: HarnessId;
  model?: string;
  /** A reply that was only an emoji on the message it answers. */
  reaction?: string;
  attachments?: Attachment[];
  /** What prompted this turn when it was not the user's message. */
  trigger?: IrgatGroupTrigger;
  /** The members this message hands the floor to with an @mention. */
  handoffs?: string[];
  /** The turn did not finish; a notice says why. */
  error?: string;
};

export type IrgatGroupTrigger = {
  kind: "handoff" | "review";
  /** The message the turn answers. */
  messageId: string;
};

const ROOMS_KEY = "irgat:irgat-groups";
const TRANSCRIPT_PREFIX = "irgat:irgat-group-chat:";
const GROUPS_CHANGED = "irgat:irgat-groups-changed";
/** The oldest lines go first once a room holds this many. */
export const GROUP_TRANSCRIPT_LIMIT = 500;
/** Only this much of one message is kept. */
const MESSAGE_MAX_CHARS = 40_000;
/** The view key of a group room, which shares the slot an open Irgat uses. */
const VIEW_PREFIX = "irgat-group:";

function readJson(key: string): unknown {
  return readStoredJson(key);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function changed(): void {
  window.dispatchEvent(new CustomEvent(GROUPS_CHANGED));
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && !!id))];
}

function parseGroup(value: unknown): IrgatGroup | undefined {
  const entry = record(value);
  if (typeof entry.id !== "string" || !/^[A-Za-z0-9-]+$/.test(entry.id))
    return undefined;
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  return {
    id: entry.id,
    ...(name ? { name } : {}),
    memberIds: Array.isArray(entry.memberIds)
      ? uniqueIds(entry.memberIds as string[])
      : [],
    mode: entry.mode === "pick" ? "pick" : "round",
    autoHandoff: entry.autoHandoff !== false,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
  };
}

/** Every group room, oldest first. */
export function listIrgatGroups(): IrgatGroup[] {
  const parsed = readJson(ROOMS_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => parseGroup(entry) ?? []);
}

function saveGroups(groups: readonly IrgatGroup[]): void {
  try {
    writeStoredJson(ROOMS_KEY, groups, { backup: true });
  } catch {
    return;
  }
  changed();
}

export function findIrgatGroup(id: string): IrgatGroup | undefined {
  return listIrgatGroups().find((group) => group.id === id);
}

/** A room needs two members to be a group. */
export const MIN_GROUP_MEMBERS = 2;

export function createIrgatGroup(
  memberIds: readonly string[],
  name?: string,
  now = Date.now(),
): IrgatGroup {
  const members = uniqueIds(memberIds);
  if (members.length < MIN_GROUP_MEMBERS)
    throw new Error("Pick at least two Irgats for a group chat.");
  const trimmed = name?.trim().slice(0, 60);
  const group: IrgatGroup = {
    id: newId(),
    ...(trimmed ? { name: trimmed } : {}),
    memberIds: members,
    mode: "round",
    autoHandoff: true,
    createdAt: now,
  };
  saveGroups([...listIrgatGroups(), group]);
  return group;
}

export function updateIrgatGroup(
  id: string,
  change: (group: IrgatGroup) => IrgatGroup,
): IrgatGroup | undefined {
  const groups = listIrgatGroups();
  const index = groups.findIndex((group) => group.id === id);
  if (index < 0) return undefined;
  const next = change(groups[index]);
  const name = next.name?.trim().slice(0, 60);
  if (name) next.name = name;
  else delete next.name;
  next.memberIds = uniqueIds(next.memberIds);
  groups[index] = next;
  saveGroups(groups);
  return next;
}

export function renameIrgatGroup(id: string, name: string): void {
  updateIrgatGroup(id, (group) => ({ ...group, name }));
}

export function addIrgatGroupMember(id: string, irgatId: string): void {
  updateIrgatGroup(id, (group) => ({
    ...group,
    memberIds: [...group.memberIds, irgatId],
  }));
}

export function removeIrgatGroupMember(id: string, irgatId: string): void {
  updateIrgatGroup(id, (group) => ({
    ...group,
    memberIds: group.memberIds.filter((member) => member !== irgatId),
  }));
}

/** Forgets the room and what was said in it. The members are untouched. */
export function removeIrgatGroup(id: string): void {
  try {
    localStorage.removeItem(TRANSCRIPT_PREFIX + id);
  } catch {
    // The transcript is orphaned, never shown again.
  }
  saveGroups(listIrgatGroups().filter((group) => group.id !== id));
}

/** The members that are still Irgats, in reply order. */
export function groupMembers(
  group: Pick<IrgatGroup, "memberIds">,
  roster: readonly Irgat[] = listIrgats(),
): Irgat[] {
  const byId = new Map(roster.map((irgat) => [irgat.id, irgat]));
  return group.memberIds.flatMap((id) => byId.get(id) ?? []);
}

/** "Architect + Security + Frontend", or the first three and how many more. */
export function autoGroupName(names: readonly string[]): string {
  if (!names.length) return "Group chat";
  if (names.length <= 3) return names.join(" + ");
  return `${names.slice(0, 3).join(" + ")} +${names.length - 3}`;
}

/** The room's name: the user's, or its members'. */
export function irgatGroupName(
  group: Pick<IrgatGroup, "name" | "memberIds">,
  roster: readonly Irgat[] = listIrgats(),
): string {
  return (
    group.name?.trim() ||
    autoGroupName(groupMembers(group, roster).map((irgat) => irgatLook(irgat).name))
  );
}

function parseMessage(value: unknown): IrgatGroupMessage | undefined {
  const entry = record(value);
  if (typeof entry.id !== "string" || typeof entry.text !== "string")
    return undefined;
  if (entry.role !== "user" && entry.role !== "irgat" && entry.role !== "notice")
    return undefined;
  return entry as unknown as IrgatGroupMessage;
}

/** What was said in the room, oldest first. */
export function loadIrgatGroupMessages(groupId: string): IrgatGroupMessage[] {
  const parsed = readJson(TRANSCRIPT_PREFIX + groupId);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => parseMessage(entry) ?? []);
}

function storable(message: IrgatGroupMessage): IrgatGroupMessage {
  return {
    ...message,
    text:
      message.text.length > MESSAGE_MAX_CHARS
        ? `${message.text.slice(0, MESSAGE_MAX_CHARS - 1)}…`
        : message.text,
    ...(message.attachments?.length
      ? { attachments: message.attachments.map(persistableAttachment) }
      : { attachments: undefined }),
  };
}

function saveMessages(groupId: string, messages: IrgatGroupMessage[]): void {
  let kept = messages.slice(-GROUP_TRANSCRIPT_LIMIT);
  for (;;) {
    try {
      writeStoredJson(TRANSCRIPT_PREFIX + groupId, kept);
      break;
    } catch {
      // Storage is full: let the oldest half go rather than lose the new line.
      if (kept.length <= 1) return;
      kept = kept.slice(Math.floor(kept.length / 2));
    }
  }
  changed();
}

export function appendIrgatGroupMessage(
  groupId: string,
  message: Omit<IrgatGroupMessage, "id" | "at"> &
    Partial<Pick<IrgatGroupMessage, "id" | "at">>,
): IrgatGroupMessage {
  const full = storable({
    ...message,
    id: message.id ?? newId(),
    at: message.at ?? Date.now(),
  } as IrgatGroupMessage);
  saveMessages(groupId, [...loadIrgatGroupMessages(groupId), full]);
  return full;
}

export function updateIrgatGroupMessage(
  groupId: string,
  messageId: string,
  change: (message: IrgatGroupMessage) => IrgatGroupMessage,
): void {
  const messages = loadIrgatGroupMessages(groupId);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  messages[index] = storable(change(messages[index]));
  saveMessages(groupId, messages);
}

export function clearIrgatGroupMessages(groupId: string): void {
  saveMessages(groupId, []);
}

/** A member's look as a message records it. */
export function speakerFields(
  irgatId: string,
): Pick<IrgatGroupMessage, "irgatId" | "name" | "mascot" | "color"> {
  const irgat = findIrgat(irgatId);
  if (!irgat) return { irgatId };
  const look = irgatLook(irgat);
  return { irgatId, name: look.name, mascot: look.mascot, color: look.color };
}

export function subscribeIrgatGroups(onChange: () => void): () => void {
  window.addEventListener(GROUPS_CHANGED, onChange);
  return () => window.removeEventListener(GROUPS_CHANGED, onChange);
}

/** Snapshot for `useSyncExternalStore`; stable while the rooms are unchanged. */
export function irgatGroupsSnapshot(): string {
  try {
    return localStorage.getItem(ROOMS_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Snapshot of one room's transcript. */
export function irgatGroupTranscriptSnapshot(groupId: string): string {
  try {
    return localStorage.getItem(TRANSCRIPT_PREFIX + groupId) ?? "";
  } catch {
    return "";
  }
}

export function irgatGroupViewKey(groupId: string): string {
  return VIEW_PREFIX + groupId;
}

/** The room a view key opens, when it is a group room's. */
export function irgatGroupOfView(
  viewId: string | null | undefined,
): string | undefined {
  return viewId?.startsWith(VIEW_PREFIX)
    ? viewId.slice(VIEW_PREFIX.length)
    : undefined;
}
