import { useSyncExternalStore } from "react";
import { adhdEnabledFor } from "../../adhd/model/adhdMode";
import { irgatForSession, irgatLook } from "../../irgats/model/irgat";
import {
  editIrgatFile,
  irgatProjectsBrief,
  loadIrgatFiles,
  memoryWithinBudget,
} from "../../irgats/model/irgatFiles";
import {
  addMemoryEntry,
  memoryDate,
  memoryEntry,
} from "../../irgats/model/irgatMemory";
import { saveNoteOnce } from "../../notes/notes";
import { liveKey } from "../../../platform/tauri/liveVoice";
import { liveSystemInstruction, recentTurns } from "./liveInstruction";
import type { LiveSessionInfo } from "./liveHost";
import {
  defaultClient,
  defaultEngine,
  defaultHost,
  defaultSettings,
  LIVE_IDLE,
  LiveVoiceController,
  type LiveControllerDeps,
  type LiveInstruction,
  type LiveState,
} from "./liveSession";

/** SOUL.md, MEMORY.md and the chat so far for an Irgat; the chat alone otherwise. */
export async function liveInstructionFor(info: LiveSessionInfo): Promise<LiveInstruction> {
  const adhd = adhdEnabledFor(info.id);
  const recent = recentTurns(info.blocks);
  const irgat = irgatForSession(info.id);
  if (!irgat)
    return {
      text: liveSystemInstruction({ name: info.title.trim() || "the agent", recent, adhd }),
      memoryTool: false,
    };
  const look = irgatLook(irgat);
  const files = await loadIrgatFiles(irgat.id).catch(() => null);
  return {
    text: liveSystemInstruction({
      name: look.name,
      soul: files?.soul,
      memory: files ? memoryWithinBudget(files.memory).text : undefined,
      projects: irgatProjectsBrief(look),
      recent,
      adhd,
      memoryTool: true,
    }),
    memoryTool: true,
  };
}

export function appLiveDeps(): LiveControllerDeps {
  return {
    host: defaultHost,
    apiKey: liveKey,
    createClient: defaultClient,
    createEngine: defaultEngine,
    settings: defaultSettings,
    instruction: liveInstructionFor,
    tools: (info) => {
      const irgat = irgatForSession(info.id);
      return {
        saveNote: async (title, content) => {
          const { created } = await saveNoteOnce({
            ...(title ? { title } : {}),
            body: content,
            sourceSessionId: info.id,
            ...(info.cwd ? { sourceCwd: info.cwd } : {}),
          });
          return { created };
        },
        ...(irgat
          ? {
              remember: async (fact: string) => {
                const entry = memoryEntry(fact, memoryDate());
                let added = false;
                await editIrgatFile(irgat.id, "memory", (text) => {
                  const next = addMemoryEntry(text, entry);
                  added = next.added;
                  return next.text;
                });
                return { added };
              },
            }
          : {}),
      };
    },
  };
}

let controller: LiveVoiceController | null = null;

/** The app's one Live call controller. */
export function liveVoice(): LiveVoiceController {
  controller ??= new LiveVoiceController(appLiveDeps());
  return controller;
}

/** Swaps the controller, for tests. */
export function setLiveVoice(next: LiveVoiceController | null) {
  controller = next;
}

const noop = () => () => {};

/** The call's state; `idle` for every chat but the one on the call. */
export function useLiveVoice(sessionId?: string): LiveState {
  const live = liveVoice();
  const state = useSyncExternalStore(
    live?.subscribe ?? noop,
    live?.getState ?? (() => LIVE_IDLE),
    () => LIVE_IDLE,
  );
  if (sessionId !== undefined && state.sessionId !== sessionId) return LIVE_IDLE;
  return state;
}
