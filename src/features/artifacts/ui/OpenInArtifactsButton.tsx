import { useContext, useMemo } from "react";
import { Artifacts } from "../../../shared/ui/icons";
import { requestOpenArtifact } from "../model/openArtifact";
import type { Block } from "../../sessions/model/session";
import {
  fileArtifacts,
  snippetArtifact,
  type WorkspaceArtifact,
} from "../model/workspaceArtifacts";
import { ArtifactSourceContext } from "./artifactContext";

/**
 * "Open in Artifacts" on a code block of a transcript, when the block is
 * worth keeping. Renders nothing outside a conversation or while streaming.
 */
export function CodeBlockArtifactButton({
  info,
  code,
  incomplete = false,
  className = "markdown-code-artifact",
}: {
  info: string;
  code: string;
  incomplete?: boolean;
  className?: string;
}) {
  const source = useContext(ArtifactSourceContext);
  const artifact = useMemo(
    () =>
      source && !incomplete
        ? snippetArtifact(
            {
              sessionId: source.sessionId,
              sessionTitle: source.sessionTitle,
              cwd: source.cwd,
              createdAt: Date.now(),
            },
            { info, code },
          )
        : null,
    [source, incomplete, info, code],
  );
  if (!artifact) return null;
  return <OpenInArtifactsButton artifact={artifact} className={className} />;
}

/** "Open in Artifacts" on a file a write or edit tool call produced. */
export function ToolArtifactButton({
  block,
  className,
}: {
  block: Block;
  className: string;
}) {
  const source = useContext(ArtifactSourceContext);
  const artifact = useMemo(
    () =>
      source
        ? fileArtifacts(
            {
              sessionId: source.sessionId,
              sessionTitle: source.sessionTitle,
              cwd: source.cwd,
              createdAt: block.startedAt ?? Date.now(),
            },
            block,
          )[0]
        : undefined,
    [source, block],
  );
  if (!artifact) return null;
  return <OpenInArtifactsButton artifact={artifact} className={className} />;
}

export function OpenInArtifactsButton({
  artifact,
  className,
}: {
  artifact: WorkspaceArtifact;
  className: string;
}) {
  return (
    <button
      type="button"
      title="Open in Artifacts"
      aria-label={`Open ${artifact.title} in Artifacts`}
      className={className}
      data-open-artifact={artifact.id}
      onClick={(event) => {
        event.stopPropagation();
        requestOpenArtifact(artifact, true);
      }}
    >
      <Artifacts className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}
