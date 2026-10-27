import type {
  WebLiveCall,
  WebLiveDelegation,
} from "../../web-access/model/protocol";
import type { LiveHost, LiveSessionInfo } from "./liveHost";
import type { LiveInstruction } from "./liveSession";
import type { LiveVoiceSettings } from "./liveSettings";
import type { LiveToolDeps } from "./liveTools";
import { liveBlock } from "./liveTranscript";

/**
 * The Mac's half of a Live call the phone runs: the phone talks to Gemini
 * with a one-use token, and asks the Mac for everything that touches the
 * chat, the agent, notes and memory, the same way a call on the Mac would.
 */
export type RemoteLiveDeps = {
  host: () => LiveHost | null;
  /** A one-use Gemini Live token; the key stays on the Mac. */
  token: () => Promise<string>;
  settings: () => LiveVoiceSettings;
  instruction: (info: LiveSessionInfo) => Promise<LiveInstruction>;
  tools: (info: LiveSessionInfo) => Omit<LiveToolDeps, "delegate">;
};

type Input = Record<string, unknown>;

const MAX_TEXT = 20_000;
/** Work handed off from a call, kept until the phone collects the result. */
const DELEGATION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_DELEGATIONS = 50;

type Delegated = { at: number; outcome?: string | null };
const delegations = new Map<string, Delegated>();

function text(input: Input, key: string, max = MAX_TEXT): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
}

function trackDelegation(id: string, now: number) {
  for (const [key, entry] of delegations)
    if (now - entry.at > DELEGATION_TTL_MS) delegations.delete(key);
  while (delegations.size >= MAX_DELEGATIONS)
    delegations.delete(delegations.keys().next().value!);
  const entry: Delegated = { at: now };
  delegations.set(id, entry);
  return entry;
}

/** Answers the phone's `live` write for the chat `sessionId`. */
export async function handleRemoteLive(
  input: Input,
  sessionId: string,
  deps: RemoteLiveDeps,
  now = Date.now(),
): Promise<unknown> {
  const host = deps.host();
  const info = host?.session(sessionId);
  if (!host || !info) throw new Error("This chat cannot take a live call");
  switch (input.op) {
    case "start": {
      const instruction = await deps.instruction(info);
      const settings = deps.settings();
      const call: WebLiveCall = {
        token: await deps.token(),
        model: settings.model,
        voice: settings.voice,
        localBargeIn: settings.localBargeIn,
        saveTranscript: settings.saveTranscript,
        instruction: instruction.text,
        memoryTool: instruction.memoryTool,
      };
      return call;
    }
    case "append": {
      const role = input.role;
      if (role !== "user" && role !== "assistant")
        throw new Error("Missing role");
      const said = text(input, "text").trim();
      if (said)
        host.append(
          sessionId,
          liveBlock(role, said, { at: now, interrupted: input.interrupted === true }),
        );
      return { ok: true };
    }
    case "delegate": {
      const delegation = await host.delegate(sessionId, text(input, "prompt"));
      if (!delegation.started || !delegation.done)
        return { started: delegation.started, reason: delegation.reason };
      const id = crypto.randomUUID();
      const entry = trackDelegation(id, now);
      void delegation.done.then(
        (outcome) => (entry.outcome = outcome ?? null),
        () => (entry.outcome = null),
      );
      return { started: true, id };
    }
    case "delegation": {
      const id = text(input, "delegation", 100);
      const entry = delegations.get(id);
      if (!entry) throw new Error("No such delegated work");
      if (entry.outcome === undefined) return { done: false } as WebLiveDelegation;
      delegations.delete(id);
      return { done: true, outcome: entry.outcome } as WebLiveDelegation;
    }
    case "note":
      return deps.tools(info).saveNote(text(input, "title", 500), text(input, "content"));
    case "remember": {
      const remember = deps.tools(info).remember;
      if (!remember) throw new Error("This chat has no memory");
      return remember(text(input, "entry", 2_000));
    }
    default:
      throw new Error("Unknown live call step");
  }
}
