import type { WorkspaceArtifact } from "./workspaceArtifacts";

/**
 * Artifacts the app has seen, by id, so a viewer tab only needs to remember
 * the id and still follows later edits of the same artifact.
 */
const registry = new Map<string, WorkspaceArtifact>();
const listeners = new Set<() => void>();
let version = 0;

function same(a: WorkspaceArtifact, b: WorkspaceArtifact): boolean {
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.path === b.path &&
    a.createdAt === b.createdAt &&
    !!a.pinned === !!b.pinned &&
    a.scope === b.scope &&
    a.sessionTitle === b.sessionTitle &&
    a.imageData === b.imageData &&
    a.change === b.change &&
    (a.excerpt?.join("\n") ?? "") === (b.excerpt?.join("\n") ?? "")
  );
}

export function registerArtifacts(list: readonly WorkspaceArtifact[]): void {
  let changed = false;
  for (const artifact of list) {
    const previous = registry.get(artifact.id);
    if (previous && (previous === artifact || same(previous, artifact))) continue;
    registry.set(artifact.id, artifact);
    changed = true;
  }
  if (!changed) return;
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function getRegisteredArtifact(id: string): WorkspaceArtifact | undefined {
  return registry.get(id);
}

export function artifactRegistryVersion(): number {
  return version;
}

export function subscribeArtifactRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
