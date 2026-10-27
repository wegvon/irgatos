import { useSyncExternalStore } from "react";
import type { LiveHost } from "../../voice/live/liveHost";
import { LiveAudioEngine } from "../../voice/live/liveAudioEngine";
import {
  defaultClient,
  LIVE_IDLE,
  LiveVoiceController,
  type LiveState,
} from "../../voice/live/liveSession";
import {
  LIVE_SETTINGS_DEFAULTS,
  type LiveVoiceName,
} from "../../voice/live/liveSettings";
import type { WebLiveCall, WebLiveDelegation } from "../model/protocol";
import { quietWrite, write } from "./client";

/** How often the phone asks whether handed-off work has finished. */
const DELEGATION_POLL_MS = 4000;
/** Past this, the call has long ended; the chat shows the result anyway. */
const DELEGATION_GIVE_UP_MS = 30 * 60 * 1000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks the Mac for the result of work handed off during a call. */
async function delegationResult(
  sessionId: string,
  delegation: string,
): Promise<string | undefined> {
  const until = Date.now() + DELEGATION_GIVE_UP_MS;
  while (Date.now() < until) {
    await wait(DELEGATION_POLL_MS);
    try {
      const result = await quietWrite<WebLiveDelegation>("live", {
        sessionId,
        op: "delegation",
        delegation,
      });
      if (result.done) return result.outcome ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The phone's Live call: the same controller as on the Mac, talking to
 * Gemini straight from the phone with a one-use token. The Mac writes the
 * instruction and does everything that touches the chat.
 */
export function phoneLiveController(
  takeContext: () => AudioContext | undefined = () => undefined,
): LiveVoiceController {
  let call: WebLiveCall | null = null;
  const step = (sessionId: string, op: string, body: Record<string, unknown> = {}) =>
    quietWrite("live", { sessionId, op, ...body });
  const host: LiveHost = {
    // The Mac knows the chat; the controller only needs its id here.
    session: (id) => ({ id, title: "", cwd: "", blocks: [] }),
    append: (sessionId, block) => {
      void write("live", {
        sessionId,
        op: "append",
        role: block.role,
        text: block.text,
        interrupted: !!block.liveVoice?.interrupted,
      }).catch(() => undefined);
    },
    delegate: async (sessionId, prompt) => {
      const result = (await write("live", { sessionId, op: "delegate", prompt })) as {
        started: boolean;
        reason?: string;
        id?: string;
      };
      return {
        started: result.started,
        reason: result.reason,
        done: result.id ? delegationResult(sessionId, result.id) : undefined,
      };
    },
  };
  return new LiveVoiceController({
    host: () => host,
    apiKey: async (info) => {
      call = await quietWrite<WebLiveCall>("live", { sessionId: info.id, op: "start" });
      return call.token;
    },
    createClient: defaultClient,
    // Phones only play sound from an AudioContext made during the tap.
    createEngine: () => {
      const context = takeContext();
      return new LiveAudioEngine(context ? { createContext: () => context } : {});
    },
    settings: () => ({
      model: call?.model ?? LIVE_SETTINGS_DEFAULTS.model,
      voice: (call?.voice as LiveVoiceName | undefined) ?? LIVE_SETTINGS_DEFAULTS.voice,
      localBargeIn: call?.localBargeIn ?? LIVE_SETTINGS_DEFAULTS.localBargeIn,
      saveTranscript: call?.saveTranscript ?? LIVE_SETTINGS_DEFAULTS.saveTranscript,
    }),
    instruction: async () => ({
      text: call?.instruction ?? "",
      memoryTool: call?.memoryTool ?? false,
    }),
    tools: (info) => ({
      saveNote: (title, content) =>
        step(info.id, "note", { title, content }) as Promise<{ created: boolean }>,
      ...(call?.memoryTool
        ? {
            remember: (entry: string) =>
              step(info.id, "remember", { entry }) as Promise<{ added: boolean }>,
          }
        : {}),
    }),
  });
}

let controller: LiveVoiceController | null = null;
let tapped: AudioContext | undefined;

export function phoneLive(): LiveVoiceController {
  controller ??= phoneLiveController(() => {
    const context = tapped;
    tapped = undefined;
    return context;
  });
  return controller;
}

/** Starts or ends the call; call it straight from the tap. */
export function togglePhoneLive(sessionId: string) {
  const live = phoneLive();
  const starting = !live.isActive(sessionId) || live.getState().phase === "error";
  if (starting && typeof AudioContext !== "undefined") {
    void tapped?.close().catch(() => undefined);
    tapped = new AudioContext();
    void tapped.resume().catch(() => undefined);
  }
  void live.toggle(sessionId);
}

/** The call's state; `idle` for every chat but the one on the call. */
export function usePhoneLive(sessionId: string): LiveState {
  const live = phoneLive();
  const state = useSyncExternalStore(live.subscribe, live.getState, () => LIVE_IDLE);
  return state.sessionId === sessionId ? state : LIVE_IDLE;
}

/** Whether this browser can hold a call: a microphone and Web Audio. */
export function canTalkLive(): boolean {
  return (
    typeof WebSocket !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== "undefined"
  );
}
