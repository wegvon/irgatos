import { isEditTool } from "../../../integrations/harness/core/preview";
import { displayPath, joinPath, pathKey } from "../../../shared/lib/paths";
import type { Block, Session } from "../../sessions/model/session";

/** How an artifact is shown: each format owns a preview, or none for code. */
export type ArtifactFormat =
  | "html"
  | "svg"
  | "mermaid"
  | "markdown"
  | "code"
  | "image";

/**
 * Where an artifact came from. Files and images live on disk and are read
 * live; snippets and documents carry their text; Irgat documents live in the
 * app's own store.
 */
export type ArtifactOrigin =
  | "file"
  | "snippet"
  | "document"
  | "image"
  | "irgat-document"
  | "manual";

export type ArtifactFilter =
  | "all"
  | "files"
  | "previews"
  | "docs"
  | "code"
  | "media";

export const ARTIFACT_FILTERS: { id: ArtifactFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "files", label: "Files" },
  { id: "previews", label: "Previews" },
  { id: "docs", label: "Docs" },
  { id: "code", label: "Code" },
  { id: "media", label: "Media" },
];

/** Current session only, or every session of the project. */
export type ArtifactScope = "session" | "project";

export type WorkspaceArtifact = {
  id: string;
  origin: ArtifactOrigin;
  format: ArtifactFormat;
  title: string;
  /** Highlighting grammar for the source view. */
  language?: string;
  /** Inline text for snippets, documents and pinned copies. */
  content?: string;
  /** Absolute path of a written file or an image on disk. */
  path?: string;
  /** Working copy of the session that produced it. */
  cwd?: string;
  /** Inline image as a data URL, when it never touched the disk. */
  imageData?: string;
  /** Id in the app's artifact store, for documents a Irgat saved. */
  documentId?: string;
  /** What the tool call showed of a write, for when the file is gone. */
  excerpt?: string[];
  change?: "created" | "modified";
  sessionId?: string;
  sessionTitle?: string;
  blockId?: string;
  createdAt: number;
  pinned?: boolean;
  /** Pin list it belongs to: a project or a Irgat. */
  scope?: string;
};

export const SNIPPET_MIN_LINES = 10;
const DOCUMENT_MIN_LINES = 20;
const MAX_TITLE = 80;

/** FNV-1a, so a block gets the same id in the transcript and in the list. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeCode(code: string): string {
  return code.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
}

export function snippetArtifactId(sessionId: string, code: string): string {
  return `snippet:${sessionId}:${hashText(normalizeCode(code))}`;
}

export function fileArtifactId(path: string): string {
  return `file:${pathKey(path)}`;
}

export type FenceInfo = {
  language: string;
  fileName?: string;
  filePath?: string;
  title?: string;
  /** `12:40:src/app.ts` quotes existing code rather than producing any. */
  citation?: boolean;
};

export function parseFenceInfo(info: string): FenceInfo {
  const trimmed = info.trim();
  const [first = "", ...rest] = trimmed.split(/\s+/);
  const meta = rest.join(" ");
  const title =
    meta.match(/\b(?:title|filename|file|name)=(?:"([^"]+)"|'([^']+)'|(\S+))/i) ??
    undefined;
  const titled = title ? (title[1] ?? title[2] ?? title[3]) : undefined;
  if (/^\d+:\d+:.+$/.test(first)) {
    const filePath = first.replace(/^\d+:\d+:/, "");
    return {
      language: languageForFileName(baseName(filePath)),
      fileName: baseName(filePath),
      filePath,
      citation: true,
    };
  }
  const colon = first.match(/^([A-Za-z0-9+#_-]+):(.+\.[A-Za-z0-9]+)$/);
  if (colon) {
    return {
      language: colon[1].toLowerCase(),
      fileName: baseName(colon[2]),
      filePath: colon[2],
      ...(titled ? { title: titled } : {}),
    };
  }
  if (/[/\\]/.test(first) || /^[\w.-]+\.[A-Za-z0-9]{1,8}$/.test(first)) {
    return {
      language: languageForFileName(baseName(first)),
      fileName: baseName(first),
      filePath: first,
      ...(titled ? { title: titled } : {}),
    };
  }
  const fileFromTitle =
    titled && /\.[A-Za-z0-9]{1,8}$/.test(titled) ? baseName(titled) : undefined;
  return {
    language: first.toLowerCase(),
    ...(fileFromTitle ? { fileName: fileFromTitle } : {}),
    ...(titled ? { title: titled } : {}),
  };
}

export type Fence = { info: string; code: string; complete: boolean };

/** Fenced blocks in Markdown, ``` or ~~~, with their info strings. */
export function scanFences(markdown: string): Fence[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const fences: Fence[] = [];
  let open: { marker: string; info: string; body: string[] } | null = null;
  for (const line of lines) {
    if (!open) {
      const start = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (start && !(start[1][0] === "`" && start[2].includes("`"))) {
        open = { marker: start[1], info: start[2], body: [] };
      }
      continue;
    }
    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (
      close &&
      close[1][0] === open.marker[0] &&
      close[1].length >= open.marker.length
    ) {
      fences.push({ info: open.info, code: open.body.join("\n"), complete: true });
      open = null;
      continue;
    }
    open.body.push(line);
  }
  if (open)
    fences.push({ info: open.info, code: open.body.join("\n"), complete: false });
  return fences;
}

const LANGUAGE_FROM_EXT: Record<string, string> = {
  cjs: "javascript",
  htm: "html",
  js: "javascript",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mmd: "mermaid",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  yml: "yaml",
  zsh: "bash",
};

const EXT_FROM_LANGUAGE: Record<string, string> = {
  bash: "sh",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  markdown: "md",
  md: "md",
  mermaid: "mmd",
  python: "py",
  py: "py",
  ruby: "rb",
  rust: "rs",
  shell: "sh",
  sh: "sh",
  sql: "sql",
  svg: "svg",
  text: "txt",
  tsx: "tsx",
  typescript: "ts",
  ts: "ts",
  yaml: "yaml",
  yml: "yaml",
  zsh: "sh",
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Shell",
  c: "C",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kotlin: "Kotlin",
  php: "PHP",
  python: "Python",
  py: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sh: "Shell",
  shell: "Shell",
  sql: "SQL",
  swift: "Swift",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  yaml: "YAML",
  yml: "YAML",
};

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
]);

function baseName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function extensionOf(name: string): string {
  const base = baseName(name).toLowerCase();
  return base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
}

export function languageForFileName(fileName: string): string {
  const lower = baseName(fileName).toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const ext = extensionOf(lower);
  return LANGUAGE_FROM_EXT[ext] ?? ext;
}

export function formatForFileName(fileName: string): ArtifactFormat {
  const ext = extensionOf(fileName);
  if (ext === "html" || ext === "htm" || ext === "xhtml") return "html";
  if (ext === "svg") return "svg";
  if (ext === "md" || ext === "mdx" || ext === "markdown") return "markdown";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "code";
}

function lineCount(code: string): number {
  return code ? code.split("\n").length : 0;
}

function looksLikeSvg(code: string): boolean {
  return /<svg[\s>]/i.test(code) && /<\/svg>/i.test(code);
}

/**
 * Whether a fenced block is worth keeping, and how to show it. Diagrams and
 * pages always count; Markdown and code once they are long or named.
 */
export function classifySnippet({
  language,
  code,
  fileName,
  title,
}: {
  language: string;
  code: string;
  fileName?: string;
  title?: string;
}): { format: ArtifactFormat; language: string } | null {
  const source = normalizeCode(code);
  if (!source.trim()) return null;
  const lang = language.toLowerCase();
  const lines = lineCount(source);
  const named = !!fileName || !!title;
  const fromName = fileName ? formatForFileName(fileName) : undefined;
  if (lang === "mermaid" || fromName === "mermaid")
    return { format: "mermaid", language: "mermaid" };
  if (lang === "svg" || fromName === "svg" || (lang === "xml" && looksLikeSvg(source)))
    return looksLikeSvg(source) ? { format: "svg", language: "xml" } : null;
  if (["html", "htm", "xhtml"].includes(lang) || fromName === "html") {
    if (looksLikeSvg(source) && !/<(?:html|body|div)[\s>]/i.test(source))
      return { format: "svg", language: "xml" };
    return lines >= 3 || /<!doctype html/i.test(source) || named
      ? { format: "html", language: "html" }
      : null;
  }
  if (["md", "markdown", "mdx"].includes(lang) || fromName === "markdown")
    return lines >= SNIPPET_MIN_LINES || named
      ? { format: "markdown", language: "markdown" }
      : null;
  if (lines >= SNIPPET_MIN_LINES || (named && lines >= 2)) {
    const grammar =
      lang && lang !== "text" && lang !== "plaintext" && lang !== "txt"
        ? lang
        : fileName
          ? languageForFileName(fileName) || "text"
          : "text";
    return { format: "code", language: grammar };
  }
  return null;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1)}…` : flat;
}

function firstHeading(markdown: string): string | undefined {
  const match = markdown.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return match ? clip(match[1].replace(/[*_`]/g, "")) : undefined;
}

function htmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (match?.[1]?.trim()) return clip(match[1]);
  const heading = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return heading?.[1]?.trim() ? clip(heading[1]) : undefined;
}

function mermaidTitle(code: string): string {
  const head = code.trim().split(/\s|\n/)[0]?.toLowerCase() ?? "";
  const kinds: Record<string, string> = {
    flowchart: "Flowchart",
    graph: "Flowchart",
    sequencediagram: "Sequence diagram",
    classdiagram: "Class diagram",
    statediagram: "State diagram",
    "statediagram-v2": "State diagram",
    erdiagram: "ER diagram",
    gantt: "Gantt chart",
    pie: "Pie chart",
    mindmap: "Mind map",
    timeline: "Timeline",
    journey: "User journey",
    gitgraph: "Git graph",
  };
  return kinds[head] ?? "Mermaid diagram";
}

export function languageLabel(language?: string): string {
  if (!language) return "Code";
  const key = language.toLowerCase();
  return LANGUAGE_LABELS[key] ?? (key.length <= 4 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
}

function snippetTitle(
  format: ArtifactFormat,
  language: string,
  code: string,
  info: FenceInfo,
): string {
  if (info.fileName) return info.fileName;
  if (info.title) return clip(info.title);
  switch (format) {
    case "html":
      return htmlTitle(code) ?? "HTML page";
    case "svg":
      return "SVG graphic";
    case "mermaid":
      return mermaidTitle(code);
    case "markdown":
      return firstHeading(code) ?? "Markdown document";
    default:
      return `${languageLabel(language)} snippet`;
  }
}

export type ArtifactSource = {
  sessionId: string;
  sessionTitle?: string;
  cwd?: string;
  blockId?: string;
  createdAt?: number;
};

/** The artifact a fenced block becomes, or null for a short or quoted one. */
export function snippetArtifact(
  source: ArtifactSource,
  fence: { info: string; code: string },
): WorkspaceArtifact | null {
  const info = parseFenceInfo(fence.info);
  if (info.citation) return null;
  const kind = classifySnippet({
    language: info.language,
    code: fence.code,
    fileName: info.fileName,
    title: info.title,
  });
  if (!kind) return null;
  const content = normalizeCode(fence.code);
  return {
    id: snippetArtifactId(source.sessionId, content),
    origin: "snippet",
    format: kind.format,
    language: kind.language,
    title: snippetTitle(kind.format, kind.language, content, info),
    content,
    sessionId: source.sessionId,
    ...(source.sessionTitle ? { sessionTitle: source.sessionTitle } : {}),
    ...(source.cwd ? { cwd: source.cwd } : {}),
    ...(source.blockId ? { blockId: source.blockId } : {}),
    createdAt: source.createdAt ?? 0,
  };
}

/** Prose outside fences, so a long code block alone is not a "document". */
function proseOutsideFences(markdown: string): string {
  return markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm, "");
}

function documentArtifact(
  source: ArtifactSource,
  text: string,
  plan: boolean,
): WorkspaceArtifact | null {
  const content = normalizeCode(text);
  if (!content) return null;
  if (!plan) {
    const prose = proseOutsideFences(content);
    const headings = prose.match(/^ {0,3}#{1,3}\s+\S/gm)?.length ?? 0;
    if (headings < 2 || lineCount(content) < DOCUMENT_MIN_LINES) return null;
  }
  const heading = firstHeading(content);
  return {
    id: `document:${source.sessionId}:${hashText(content)}`,
    origin: "document",
    format: "markdown",
    language: "markdown",
    title: plan ? (heading ? `Plan: ${heading}` : "Plan") : (heading ?? "Report"),
    content,
    sessionId: source.sessionId,
    ...(source.sessionTitle ? { sessionTitle: source.sessionTitle } : {}),
    ...(source.cwd ? { cwd: source.cwd } : {}),
    ...(source.blockId ? { blockId: source.blockId } : {}),
    createdAt: source.createdAt ?? 0,
  };
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

export function resolveArtifactPath(path: string, cwd?: string): string {
  if (isAbsolutePath(path) || !cwd) return path;
  return joinPath(cwd, path);
}

function toolSucceeded(block: Block): boolean {
  return ["completed", "success"].includes(block.tool?.status ?? "");
}

function isDeleteTool(block: Block): boolean {
  const kind = block.tool?.kind?.trim().toLowerCase();
  if (kind === "delete" || kind === "move") return true;
  return /^(delete|remove|move|rename)\b/i.test(
    (block.tool?.title ?? block.text ?? "").trim(),
  );
}

function fileArtifacts(
  source: ArtifactSource,
  block: Block,
): WorkspaceArtifact[] {
  const tool = block.tool;
  if (!tool || !toolSucceeded(block) || isDeleteTool(block)) return [];
  if (!isEditTool(tool.kind, tool.title ?? block.text, tool.preview)) return [];
  const preview = tool.preview;
  const raw = new Set<string>();
  if (preview?.path) raw.add(preview.path);
  for (const path of tool.paths ?? []) if (path) raw.add(path);
  const created =
    !!preview?.contentOnly || /^(write|create)\b/i.test(tool.title ?? block.text ?? "");
  return [...raw].map((path) => {
    const absolute = resolveArtifactPath(path, source.cwd);
    const name = baseName(absolute);
    const format = formatForFileName(name);
    const excerpt =
      preview?.path === path && preview.lines?.length
        ? preview.lines
            .filter((line) => line.kind !== "del")
            .map((line) => line.text)
        : undefined;
    return {
      id: fileArtifactId(absolute),
      origin: format === "image" ? "image" : "file",
      format,
      language: format === "image" ? undefined : languageForFileName(name) || "text",
      title: name,
      path: absolute,
      change: created ? "created" : "modified",
      ...(excerpt?.length ? { excerpt } : {}),
      sessionId: source.sessionId,
      ...(source.sessionTitle ? { sessionTitle: source.sessionTitle } : {}),
      ...(source.cwd ? { cwd: source.cwd } : {}),
      blockId: block.id,
      createdAt: source.createdAt ?? 0,
    } satisfies WorkspaceArtifact;
  });
}

function imageArtifacts(
  source: ArtifactSource,
  block: Block,
): WorkspaceArtifact[] {
  const out: WorkspaceArtifact[] = [];
  if (block.role === "image" && block.image?.path) {
    out.push({
      id: fileArtifactId(block.image.path),
      origin: "image",
      format: "image",
      title: block.image.alt?.trim() ? clip(block.image.alt) : block.image.name,
      path: block.image.path,
      sessionId: source.sessionId,
      ...(source.sessionTitle ? { sessionTitle: source.sessionTitle } : {}),
      ...(source.cwd ? { cwd: source.cwd } : {}),
      blockId: block.id,
      createdAt: source.createdAt ?? 0,
    });
  }
  for (const attachment of block.attachments ?? []) {
    if (attachment.kind !== "image") continue;
    const data =
      attachment.data && !attachment.path
        ? `data:${attachment.mimeType || "image/png"};base64,${attachment.data}`
        : undefined;
    if (!attachment.path && !data) continue;
    out.push({
      id: attachment.path
        ? fileArtifactId(attachment.path)
        : `image:${source.sessionId}:${attachment.id}`,
      origin: "image",
      format: "image",
      title: attachment.name || "Image",
      ...(attachment.path ? { path: attachment.path } : {}),
      ...(data ? { imageData: data } : {}),
      sessionId: source.sessionId,
      ...(source.sessionTitle ? { sessionTitle: source.sessionTitle } : {}),
      ...(source.cwd ? { cwd: source.cwd } : {}),
      blockId: block.id,
      createdAt: source.createdAt ?? 0,
    });
  }
  return out;
}

function irgatDocumentArtifacts(
  source: ArtifactSource,
  block: Block,
): WorkspaceArtifact[] {
  return (block.artifactCards ?? []).map((card) => ({
    id: `irgat-document:${card.id}`,
    origin: "irgat-document",
    format: card.kind === "html" ? "html" : "markdown",
    language: card.kind === "html" ? "html" : "markdown",
    title: card.title,
    documentId: card.id,
    sessionId: source.sessionId,
    ...(source.sessionTitle ? { sessionTitle: source.sessionTitle } : {}),
    ...(source.cwd ? { cwd: source.cwd } : {}),
    blockId: block.id,
    createdAt: source.createdAt ?? 0,
  }));
}

export type ExtractOptions = {
  sessionTitle?: string;
  /** Time for blocks older than per-turn timestamps. */
  fallbackAt?: number;
  scope?: string;
};

/**
 * Everything worth keeping from one conversation, newest first: files its
 * tools wrote, substantial blocks and documents in its replies, the images
 * it made or was shown, and documents a Irgat saved.
 */
export function extractSessionArtifacts(
  session: Pick<Session, "id" | "title" | "cwd" | "worktreeCwd" | "blocks">,
  options: ExtractOptions = {},
): WorkspaceArtifact[] {
  const cwd = session.worktreeCwd ?? session.cwd;
  const sessionTitle = options.sessionTitle ?? session.title;
  const found = new Map<string, WorkspaceArtifact>();
  let turnAt = options.fallbackAt ?? 0;
  const put = (artifact: WorkspaceArtifact) => {
    const scoped = options.scope ? { ...artifact, scope: options.scope } : artifact;
    found.delete(scoped.id);
    found.set(scoped.id, scoped);
  };
  for (const block of session.blocks) {
    if (block.internal || block.draft) continue;
    if (block.role === "user") {
      turnAt = block.startedAt ?? block.sentAt ?? turnAt;
    }
    const source: ArtifactSource = {
      sessionId: session.id,
      sessionTitle,
      cwd,
      blockId: block.id,
      createdAt: turnAt,
    };
    if (block.role === "tool") {
      for (const artifact of fileArtifacts(source, block)) put(artifact);
      continue;
    }
    for (const artifact of imageArtifacts(source, block)) put(artifact);
    for (const artifact of irgatDocumentArtifacts(source, block)) put(artifact);
    if (block.streaming) continue;
    if (block.role === "plan" || (block.role === "assistant" && block.plan)) {
      const doc = documentArtifact(source, block.text, true);
      if (doc) put(doc);
      continue;
    }
    if (block.role !== "assistant" || !block.text) continue;
    for (const fence of scanFences(block.text)) {
      if (!fence.complete) continue;
      const artifact = snippetArtifact(source, fence);
      if (artifact) put(artifact);
    }
    const doc = documentArtifact(source, block.text, false);
    if (doc) put(doc);
  }
  return [...found.values()].reverse();
}

/** Identity across sessions: a file is one artifact, however many touched it. */
export function artifactDedupeKey(artifact: WorkspaceArtifact): string {
  return artifact.path ? fileArtifactId(artifact.path) : artifact.id;
}

/**
 * One list from many: the newest copy of each artifact wins, and a pinned
 * copy keeps its place and its pin over a derived one.
 */
export function mergeArtifacts(
  ...lists: readonly (readonly WorkspaceArtifact[])[]
): WorkspaceArtifact[] {
  const byKey = new Map<string, WorkspaceArtifact>();
  for (const list of lists) {
    for (const artifact of list) {
      const key = artifactDedupeKey(artifact);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, artifact);
        continue;
      }
      if (existing.pinned && !artifact.pinned) {
        byKey.set(key, {
          ...artifact,
          id: existing.id,
          pinned: true,
          scope: existing.scope,
          title: existing.title,
          content: existing.content ?? artifact.content,
          createdAt: Math.max(existing.createdAt, artifact.createdAt),
        });
        continue;
      }
      if (artifact.pinned && !existing.pinned) {
        byKey.set(key, {
          ...existing,
          ...artifact,
          createdAt: Math.max(existing.createdAt, artifact.createdAt),
        });
        continue;
      }
      if (artifact.createdAt >= existing.createdAt) byKey.set(key, artifact);
    }
  }
  return sortArtifacts([...byKey.values()]);
}

/** Pinned first, then newest first; ties keep their incoming order. */
export function sortArtifacts(list: readonly WorkspaceArtifact[]): WorkspaceArtifact[] {
  return list
    .map((artifact, index) => ({ artifact, index }))
    .sort(
      (a, b) =>
        Number(!!b.artifact.pinned) - Number(!!a.artifact.pinned) ||
        b.artifact.createdAt - a.artifact.createdAt ||
        a.index - b.index,
    )
    .map(({ artifact }) => artifact);
}

export function artifactMatchesFilter(
  artifact: WorkspaceArtifact,
  filter: ArtifactFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "files":
      return artifact.origin === "file" || artifact.change != null;
    case "previews":
      return ["html", "svg", "mermaid"].includes(artifact.format);
    case "docs":
      return artifact.format === "markdown";
    case "code":
      return artifact.format === "code";
    case "media":
      return artifact.format === "image";
  }
}

export function filterArtifacts(
  list: readonly WorkspaceArtifact[],
  { filter = "all", query = "" }: { filter?: ArtifactFilter; query?: string },
): WorkspaceArtifact[] {
  const needle = query.trim().toLowerCase();
  return list.filter((artifact) => {
    if (!artifactMatchesFilter(artifact, filter)) return false;
    if (!needle) return true;
    return [
      artifact.title,
      artifact.path ? displayPath(artifact.path, artifact.cwd) : "",
      artifact.sessionTitle ?? "",
      artifactKindLabel(artifact),
    ].some((field) => field.toLowerCase().includes(needle));
  });
}

export function artifactKindLabel(artifact: WorkspaceArtifact): string {
  switch (artifact.format) {
    case "html":
      return "HTML";
    case "svg":
      return "SVG";
    case "mermaid":
      return "Mermaid";
    case "markdown":
      return artifact.origin === "document" ? "Doc" : "Markdown";
    case "image":
      return "Image";
    case "code":
      return languageLabel(artifact.language);
  }
}

/** A file name for the icon set, and for exporting the artifact. */
export function artifactFileName(artifact: WorkspaceArtifact): string {
  if (artifact.path) return baseName(artifact.path);
  if (/\.[A-Za-z0-9]{1,8}$/.test(artifact.title) && !/\s/.test(artifact.title))
    return artifact.title;
  const stem =
    artifact.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "artifact";
  const ext =
    artifact.format === "html"
      ? "html"
      : artifact.format === "svg"
        ? "svg"
        : artifact.format === "mermaid"
          ? "mmd"
          : artifact.format === "markdown"
            ? "md"
            : artifact.format === "image"
              ? "png"
              : (EXT_FROM_LANGUAGE[artifact.language?.toLowerCase() ?? ""] ??
                (artifact.language && /^[a-z0-9]{1,6}$/.test(artifact.language)
                  ? artifact.language
                  : "txt"));
  return `${stem}.${ext}`;
}

/** Whether the detail pane can render the artifact, not only list its source. */
export function hasVisualPreview(artifact: WorkspaceArtifact): boolean {
  return artifact.format !== "code";
}

/** A fence long enough to hold `code`, so backticks inside cannot close it. */
export function fenceFor(code: string): string {
  const longest = Math.max(
    0,
    ...[...code.matchAll(/`{3,}/g)].map((match) => match[0].length),
  );
  return "`".repeat(Math.max(3, longest + 1));
}

/** The artifact as Markdown, for a note or a message. */
export function artifactMarkdown(
  artifact: WorkspaceArtifact,
  content: string,
): string {
  if (artifact.format === "markdown") return content;
  if (artifact.format === "image") {
    const where = artifact.path ?? artifact.title;
    return `![${artifact.title}](${where})`;
  }
  const language =
    artifact.format === "svg"
      ? "svg"
      : artifact.format === "mermaid"
        ? "mermaid"
        : (artifact.language ?? "");
  const fence = fenceFor(content);
  return `${fence}${language}\n${content}\n${fence}`;
}

/** What Add to Chat puts in the composer: a path for files, else the text. */
export function artifactChatText(
  artifact: WorkspaceArtifact,
  content: string | undefined,
): string {
  if (artifact.path) {
    const shown = displayPath(artifact.path, artifact.cwd);
    return `\`${shown}\``;
  }
  const body = artifactMarkdown(artifact, content ?? artifact.content ?? "");
  return `${artifact.title}\n\n${body}`;
}

export function artifactNoteBody(
  artifact: WorkspaceArtifact,
  content: string,
): string {
  const lines: string[] = [];
  if (artifact.path)
    lines.push(`Source: \`${displayPath(artifact.path, artifact.cwd)}\``, "");
  else if (artifact.sessionTitle)
    lines.push(`From “${artifact.sessionTitle}”`, "");
  lines.push(artifactMarkdown(artifact, content));
  return lines.join("\n");
}

/** "now", "5m", "3h", "Yesterday", or a date. */
export function formatArtifactTime(at: number, now = Date.now()): string {
  if (!at) return "";
  const delta = Math.max(0, now - at);
  const minute = 60_000;
  if (delta < minute) return "now";
  if (delta < 60 * minute) return `${Math.floor(delta / minute)}m`;
  if (delta < 24 * 60 * minute) return `${Math.floor(delta / (60 * minute))}h`;
  const date = new Date(at);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  }).format(at);
}
