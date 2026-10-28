import { useEffect, useState } from "react";
import { Artifacts } from "../../../shared/ui/icons";
import type { ArtifactTabSource } from "../../workspace/model/layout";
import { getSession } from "../../sessions/data/sessionStore";
import { requestOpenReferencedSession } from "../../sessions/model/sessionReferenceEvents";
import { sessionArtifacts, useRegisteredArtifact } from "../hooks/useArtifacts";
import {
  getRegisteredArtifact,
  registerArtifacts,
} from "../model/artifactRegistry";
import { ArtifactDetail } from "./ArtifactDetail";

type Lookup = "idle" | "loading" | "missing";

/**
 * A restored tab only remembers the artifact's id and conversation; the
 * registry is filled by conversations that are open. Read that conversation
 * from the store so the view comes back without reopening the chat.
 */
export async function restoreArtifact(
  source: ArtifactTabSource,
  load: typeof getSession = getSession,
): Promise<boolean> {
  if (getRegisteredArtifact(source.id)) return true;
  if (!source.sessionId) return false;
  const session = await load(source.sessionId).catch(() => null);
  if (!session) return false;
  registerArtifacts(sessionArtifacts(session));
  return !!getRegisteredArtifact(source.id);
}

/** The workspace tab for one artifact; it follows the artifact as it changes. */
export function ArtifactSurface({
  source,
  restored = false,
}: {
  source: ArtifactTabSource;
  /** Reopened after a restart, before its conversation was open again. */
  restored?: boolean;
}) {
  const artifact = useRegisteredArtifact(source.id);
  const [lookup, setLookup] = useState<Lookup>(() =>
    restored && source.sessionId ? "loading" : "idle",
  );
  useEffect(() => {
    if (artifact || !restored || !source.sessionId) return;
    let current = true;
    setLookup("loading");
    void restoreArtifact(source).then((found) => {
      if (current) setLookup(found ? "idle" : "missing");
    });
    return () => {
      current = false;
    };
    // The source object is recreated with its tab; its id is what matters.
  }, [artifact, restored, source.id, source.sessionId]);

  if (artifact) return <ArtifactDetail artifact={artifact} />;
  const conversation = source.sessionId;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Artifacts className="size-5 text-content/30" />
      <p
        role="status"
        className="max-w-72 text-[12px] leading-4.5 text-content/55"
      >
        {lookup === "loading"
          ? `Restoring “${source.title}”…`
          : restored
            ? `“${source.title}” was open before Irgatos restarted, but it could not be restored here. It is still in the conversation that made it.`
            : `“${source.title}” is no longer available. Its conversation may have been closed or archived.`}
      </p>
      {conversation && lookup !== "loading" ? (
        <button
          type="button"
          data-open-artifact-conversation
          onClick={() =>
            requestOpenReferencedSession({ sessionId: conversation })
          }
          className="rounded-md border border-content/15 px-2.5 py-1 text-[12px] text-content/75 transition-colors hover:bg-content/7 hover:text-content"
        >
          {source.sessionTitle
            ? `Open “${source.sessionTitle}”`
            : "Open its conversation"}
        </button>
      ) : null}
    </div>
  );
}
