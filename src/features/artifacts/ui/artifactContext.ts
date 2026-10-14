import { createContext } from "react";
import { requestAddToChat } from "../../sessions/model/quoteDraft";

/** An open chat that Add to Chat can target. */
export type ArtifactChatTarget = {
  sessionId: string;
  title: string;
  /** The chat whose composer takes Add to Chat without picking. */
  active?: boolean;
};

/** What the viewer asks of the app around it. */
export type ArtifactHost = {
  chatTargets: () => ArtifactChatTarget[];
  addToChat: (text: string, sessionId?: string) => void;
  openFile?: (path: string) => void;
  revealInExplorer?: (path: string) => void;
  openNotes?: () => void;
  /** Pin list for artifacts that do not name one. */
  defaultScope?: string;
};

export const DEFAULT_ARTIFACT_HOST: ArtifactHost = {
  chatTargets: () => [],
  addToChat: (text) => requestAddToChat(text, "plain"),
};

export const ArtifactHostContext =
  createContext<ArtifactHost>(DEFAULT_ARTIFACT_HOST);

/**
 * The conversation a transcript belongs to. Present only where the app can
 * open an artifact, so blocks elsewhere offer no "Open in Artifacts".
 */
export type ArtifactSource = {
  sessionId: string;
  sessionTitle?: string;
  cwd?: string;
};

export const ArtifactSourceContext = createContext<ArtifactSource | null>(null);
