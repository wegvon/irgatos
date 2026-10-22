import { useMemo, type ReactNode } from "react";
import type { WebOverview } from "../../model/protocol";
import type { Screen } from "../route";
import { Artifacts } from "./Artifacts";
import { Board } from "./Board";
import { allEntries } from "./Chats";
import { Feed } from "./Feed";
import { Notes } from "./Notes";
import {
  Artifacts as ArtifactsIcon,
  Feed as FeedIcon,
  Kanban,
  StickyNote,
} from "../../../../shared/ui/icons";

type WorkspaceName = "feed" | "notes" | "board" | "artifacts";

/** The desktop rail's Feed, Notes, Board and Artifacts, in its order. */
export const WORKSPACE_SCREENS: {
  name: WorkspaceName;
  label: string;
  Icon: typeof FeedIcon;
}[] = [
  { name: "feed", label: "Feed", Icon: FeedIcon },
  { name: "notes", label: "Notes", Icon: StickyNote },
  { name: "board", label: "Board", Icon: Kanban },
  { name: "artifacts", label: "Artifacts", Icon: ArtifactsIcon },
];

export function isWorkspaceScreen(name: Screen["name"]): name is WorkspaceName {
  return WORKSPACE_SCREENS.some((entry) => entry.name === name);
}

export function WorkspaceScreen({
  name,
  overview,
  now,
  wide,
  header,
}: {
  name: WorkspaceName;
  overview: WebOverview | null;
  now: number;
  wide: boolean;
  header?: ReactNode;
}) {
  const live = useMemo(
    () =>
      new Set(
        overview ? allEntries(overview).map((entry) => entry.sessionId) : [],
      ),
    [overview],
  );
  const props = { now, wide, header };
  switch (name) {
    case "feed":
      return <Feed {...props} />;
    case "notes":
      return <Notes {...props} />;
    case "board":
      return <Board {...props} />;
    case "artifacts":
      return <Artifacts {...props} live={live} />;
  }
}
