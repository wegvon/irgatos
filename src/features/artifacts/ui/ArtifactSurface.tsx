import { Artifacts } from "../../../shared/ui/icons";
import type { ArtifactTabSource } from "../../workspace/model/layout";
import { useRegisteredArtifact } from "../hooks/useArtifacts";
import { ArtifactDetail } from "./ArtifactDetail";

/** The workspace tab for one artifact; it follows the artifact as it changes. */
export function ArtifactSurface({ source }: { source: ArtifactTabSource }) {
  const artifact = useRegisteredArtifact(source.id);
  if (!artifact)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Artifacts className="size-5 text-content/30" />
        <p role="status" className="max-w-72 text-[12px] leading-4.5 text-content/55">
          “{source.title}” is no longer available. Its conversation may have
          been closed or archived.
        </p>
      </div>
    );
  return <ArtifactDetail artifact={artifact} />;
}
