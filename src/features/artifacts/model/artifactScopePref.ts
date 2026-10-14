import type { ArtifactScope } from "./workspaceArtifacts";

const KEY = "irgat.artifactsScope.v1";

export function loadArtifactScope(): ArtifactScope {
  try {
    return localStorage.getItem(KEY) === "project" ? "project" : "session";
  } catch {
    return "session";
  }
}

export function saveArtifactScope(scope: ArtifactScope): void {
  try {
    localStorage.setItem(KEY, scope);
  } catch {
    // private mode / quota
  }
}
