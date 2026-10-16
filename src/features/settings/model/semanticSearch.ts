import { invoke } from "@tauri-apps/api/core";
import { pathKey } from "../../../shared/lib/paths";
import { looksLikeProject } from "../../projects/model/recents";

/** Emitted by the indexer while a project is being embedded and when it stops. */
export const SEMANTIC_INDEX_EVENT = "semantic-index:progress";

export type SemanticSearchSettings = {
  enabled: boolean;
  endpoint: string;
  hasKey: boolean;
};

export type SemanticIndexProgress = {
  totalFiles: number;
  doneFiles: number;
  totalChunks: number;
  doneChunks: number;
  removedFiles: number;
};

export type SemanticIndexState = "none" | "indexing" | "partial" | "complete";

export type SemanticIndexStatus = {
  root: string;
  state: SemanticIndexState;
  files: number;
  chunks: number;
  progress: SemanticIndexProgress | null;
  updatedAt: number | null;
  lastError: string | null;
};

export function loadSemanticSearchSettings() {
  return invoke<SemanticSearchSettings>("semantic_index_settings");
}

/** `key`: undefined keeps the stored key, "" removes it. */
export function saveSemanticSearchSettings(settings: {
  enabled: boolean;
  endpoint: string;
  key?: string;
}) {
  return invoke<SemanticSearchSettings>("semantic_index_save_settings", {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    key: settings.key ?? null,
  });
}

export function loadSemanticIndexStatus(roots: string[]) {
  return invoke<SemanticIndexStatus[]>("semantic_index_status", { roots });
}

export function buildSemanticIndex(root: string, rebuild: boolean) {
  return invoke<void>("semantic_index_build", { root, rebuild });
}

export function cancelSemanticIndex(root: string) {
  return invoke<void>("semantic_index_cancel", { root });
}

export function removeSemanticIndex(root: string) {
  return invoke<void>("semantic_index_remove", { root });
}

/** Whether agents in `cwd` can use semantic code search right now. */
export function semanticIndexAvailable(cwd: string) {
  return invoke<boolean>("semantic_index_available", { cwd }).catch(
    () => false,
  );
}

const hinted = new Set<string>();

/**
 * True the first time a session takes a turn in an indexed project during
 * this app run, so the agent hears about code search once, not every turn.
 */
export async function claimCodeSearchHint(sessionId: string, cwd: string) {
  if (hinted.has(sessionId)) return false;
  const available = await semanticIndexAvailable(cwd);
  if (available) hinted.add(sessionId);
  return available;
}

/** The open project first, then recent ones, each once. */
export function indexableProjects(
  cwd: string | undefined,
  recents: { path: string }[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of [cwd, ...(recents ?? []).map((entry) => entry.path)]) {
    if (!path || !looksLikeProject(path)) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** One line under a project's name in Settings. */
export function semanticIndexSummary(status: SemanticIndexStatus): string {
  const indexed = count(status.files, "file", "files");
  switch (status.state) {
    case "none":
      return "Not indexed";
    case "indexing": {
      const progress = status.progress;
      if (!progress || progress.totalFiles === 0)
        return `Checking for changes · ${indexed} indexed`;
      const percent = progress.totalChunks
        ? Math.floor((progress.doneChunks / progress.totalChunks) * 100)
        : 0;
      return `Indexing ${percent}% · ${progress.doneFiles} of ${count(progress.totalFiles, "changed file", "changed files")}`;
    }
    case "partial":
      return status.lastError
        ? `Partial · ${indexed} · stopped: ${status.lastError}`
        : `Partial · ${indexed}`;
    case "complete":
      return `Indexed · ${indexed}, ${count(status.chunks, "chunk", "chunks")}`;
  }
}

/** The one-time hint that tells an agent the search exists. */
export function codeSearchContext(cli: string) {
  return `<code_search>\nThis project has a semantic code index. To find code by meaning or by name, run \`${cli} code.search --json '{"query":"<what you are looking for>","limit":8}'\`. Ask in plain language, in any language, and include identifiers you know. It returns file paths with line ranges; read those lines before relying on them. It is read-only and needs no other app access.\n</code_search>`;
}
