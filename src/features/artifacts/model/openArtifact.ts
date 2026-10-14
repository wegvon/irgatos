import type { WorkspaceArtifact } from "./workspaceArtifacts";

export const OPEN_ARTIFACT_EVENT = "irgat:open-artifact";

export type OpenArtifactRequest = {
  artifact: WorkspaceArtifact;
  /** Keep the tab instead of letting the next preview replace it. */
  pin?: boolean;
};

/** Ask the app to show an artifact; whoever hosts the viewer picks it up. */
export function requestOpenArtifact(artifact: WorkspaceArtifact, pin = false) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenArtifactRequest>(OPEN_ARTIFACT_EVENT, {
      detail: { artifact, pin },
    }),
  );
}
