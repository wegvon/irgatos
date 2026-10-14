import type { Block } from "../../sessions/model/session";

export type LiveSessionInfo = {
  id: string;
  title: string;
  cwd: string;
  blocks: readonly Block[];
};

export type Delegation = {
  started: boolean;
  reason?: string;
  /** Settles with the agent's reply once the delegated turn is over. */
  done?: Promise<string | undefined>;
};

/**
 * What a Live call needs from the app shell, which owns the sessions. The
 * shell registers it once, so the composers only need a session id.
 */
export type LiveHost = {
  session: (sessionId: string) => LiveSessionInfo | undefined;
  append: (sessionId: string, block: Block) => void;
  delegate: (sessionId: string, prompt: string) => Promise<Delegation>;
};

let current: LiveHost | null = null;

export function setLiveHost(host: LiveHost): () => void {
  current = host;
  return () => {
    if (current === host) current = null;
  };
}

export function liveHost(): LiveHost | null {
  return current;
}
