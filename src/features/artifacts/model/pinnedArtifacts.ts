import { pathKey } from "../../../shared/lib/paths";
import {
  formatForFileName,
  hashText,
  languageForFileName,
  type ArtifactFormat,
  type WorkspaceArtifact,
} from "./workspaceArtifacts";

const KEY = "irgat.pinnedArtifacts.v1";
/** localStorage is shared with everything else; keep one pin from crowding it. */
export const MAX_PINNED_CONTENT = 512 * 1024;
export const MAX_PINNED_PER_SCOPE = 200;

type Stored = Record<string, WorkspaceArtifact[]>;

const listeners = new Set<() => void>();
let cache: Stored | null = null;

export function projectArtifactScope(cwd: string): string {
  return `project:${pathKey(cwd)}`;
}

export function irgatArtifactScope(irgatId: string): string {
  return `irgat:${irgatId}`;
}

const FORMATS: readonly ArtifactFormat[] = [
  "html",
  "svg",
  "mermaid",
  "markdown",
  "code",
  "image",
];

function sanitize(raw: unknown): WorkspaceArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.title !== "string") return null;
  if (!FORMATS.includes(value.format as ArtifactFormat)) return null;
  const text = (key: string) =>
    typeof value[key] === "string" ? (value[key] as string) : undefined;
  const origin = text("origin");
  const excerpt = Array.isArray(value.excerpt)
    ? value.excerpt.filter((line): line is string => typeof line === "string")
    : undefined;
  return {
    id: value.id,
    origin:
      origin === "file" ||
      origin === "snippet" ||
      origin === "document" ||
      origin === "image" ||
      origin === "irgat-document"
        ? origin
        : "manual",
    format: value.format as ArtifactFormat,
    title: value.title,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    pinned: true,
    ...(text("language") ? { language: text("language") } : {}),
    ...(text("content") != null ? { content: text("content") } : {}),
    ...(text("path") ? { path: text("path") } : {}),
    ...(text("cwd") ? { cwd: text("cwd") } : {}),
    ...(text("imageData") ? { imageData: text("imageData") } : {}),
    ...(text("documentId") ? { documentId: text("documentId") } : {}),
    ...(text("sessionId") ? { sessionId: text("sessionId") } : {}),
    ...(text("sessionTitle") ? { sessionTitle: text("sessionTitle") } : {}),
    ...(text("blockId") ? { blockId: text("blockId") } : {}),
    ...(text("scope") ? { scope: text("scope") } : {}),
    ...(value.change === "created" || value.change === "modified"
      ? { change: value.change }
      : {}),
    ...(excerpt?.length ? { excerpt } : {}),
  };
}

function readAll(): Stored {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const out: Stored = {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [scope, list] of Object.entries(parsed)) {
        if (!Array.isArray(list)) continue;
        const items = list
          .map(sanitize)
          .filter((item): item is WorkspaceArtifact => item != null)
          .map((item) => ({ ...item, scope }));
        if (items.length) out[scope] = items;
      }
    }
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

function writeAll(next: Stored): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota: the pin still holds for this run
  }
  for (const listener of [...listeners]) listener();
}

export function subscribePinnedArtifacts(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: WorkspaceArtifact[] = [];

export function listPinnedArtifacts(scope: string): WorkspaceArtifact[] {
  return readAll()[scope] ?? EMPTY;
}

export function isArtifactPinned(scope: string, id: string): boolean {
  return listPinnedArtifacts(scope).some((item) => item.id === id);
}

export class PinnedArtifactTooLargeError extends Error {
  constructor() {
    super("This artifact is too large to pin. Save it to a file instead.");
  }
}

/**
 * Keep a copy in the scope's list. Text is snapshotted so the pin outlives
 * the conversation; a file keeps its path and is read live.
 */
export function pinArtifact(
  scope: string,
  artifact: WorkspaceArtifact,
  content?: string,
  now = Date.now(),
): WorkspaceArtifact {
  const snapshot = artifact.path ? undefined : (content ?? artifact.content);
  if (snapshot && snapshot.length > MAX_PINNED_CONTENT)
    throw new PinnedArtifactTooLargeError();
  if (artifact.imageData && artifact.imageData.length > MAX_PINNED_CONTENT)
    throw new PinnedArtifactTooLargeError();
  const pinned: WorkspaceArtifact = {
    ...artifact,
    ...(snapshot != null ? { content: snapshot } : {}),
    pinned: true,
    scope,
    createdAt: artifact.createdAt || now,
  };
  const all = readAll();
  const rest = (all[scope] ?? []).filter((item) => item.id !== artifact.id);
  writeAll({
    ...all,
    [scope]: [pinned, ...rest].slice(0, MAX_PINNED_PER_SCOPE),
  });
  return pinned;
}

export function unpinArtifact(scope: string, id: string): void {
  const all = readAll();
  const list = all[scope];
  if (!list?.some((item) => item.id === id)) return;
  const next = { ...all };
  const remaining = list.filter((item) => item.id !== id);
  if (remaining.length) next[scope] = remaining;
  else delete next[scope];
  writeAll(next);
}

/** A pasted or typed artifact, kept straight away. */
export function createManualArtifact(
  scope: string,
  input: { title: string; content: string; format?: ArtifactFormat; language?: string },
  now = Date.now(),
): WorkspaceArtifact {
  const title = input.title.trim() || "Untitled artifact";
  const format = input.format ?? guessFormat(input.content, title);
  const language =
    input.language ??
    (format === "html"
      ? "html"
      : format === "svg"
        ? "xml"
        : format === "markdown"
          ? "markdown"
          : format === "mermaid"
            ? "mermaid"
            : languageForFileName(title) || "text");
  return pinArtifact(
    scope,
    {
      id: `manual:${now.toString(36)}:${hashText(input.content)}`,
      origin: "manual",
      format,
      language,
      title,
      content: input.content.replace(/\r\n?/g, "\n"),
      createdAt: now,
    },
    undefined,
    now,
  );
}

/** A best guess from the text itself, for pasted artifacts. */
export function guessFormat(content: string, title = ""): ArtifactFormat {
  const fromName = /\.[A-Za-z0-9]{1,8}$/.test(title)
    ? formatForFileName(title)
    : undefined;
  if (fromName && fromName !== "code" && fromName !== "image") return fromName;
  const text = content.trim();
  if (/^<svg[\s>]/i.test(text) && /<\/svg>\s*$/i.test(text)) return "svg";
  if (/^(<!doctype html|<html[\s>])/i.test(text)) return "html";
  if (
    /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|timeline|journey|gitGraph)\b/.test(
      text,
    )
  )
    return "mermaid";
  if (/^#{1,6}\s/m.test(text) || /^\s*[-*]\s+\S/m.test(text)) return "markdown";
  return "code";
}

/** Tests only. */
export function resetPinnedArtifactsCache(): void {
  cache = null;
}
