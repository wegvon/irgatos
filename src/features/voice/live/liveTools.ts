import type { FunctionCall, FunctionDeclaration, FunctionResponse } from "./geminiLiveClient";

export const DELEGATE_TOOL = "delegate_to_irgat_session";
export const SAVE_NOTE_TOOL = "save_irgat_note";
export const MEMORY_TOOL = "update_irgat_memory";

export const DELEGATE_DECLARATION: FunctionDeclaration = {
  name: DELEGATE_TOOL,
  description:
    "Hand real work to this chat's coding agent: reading or changing code, running commands, checking CI, researching. It runs in the background with full tools; you hear back when it starts and again when it finishes. Write the prompt as a complete, self-contained request.",
  parameters: {
    type: "OBJECT",
    properties: {
      prompt: {
        type: "STRING",
        description: "What the agent should do, with every detail it needs.",
      },
    },
    required: ["prompt"],
  },
};

export const SAVE_NOTE_DECLARATION: FunctionDeclaration = {
  name: SAVE_NOTE_TOOL,
  description:
    "Save a note to the user's Irgatos Notes, when they ask you to write something down.",
  parameters: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "A short title." },
      content: { type: "STRING", description: "The note, in Markdown." },
    },
    required: ["title", "content"],
  },
};

export const MEMORY_DECLARATION: FunctionDeclaration = {
  name: MEMORY_TOOL,
  description:
    "Remember one lasting fact across conversations: a decision, a preference, how a project works. Never secrets.",
  parameters: {
    type: "OBJECT",
    properties: {
      entry: { type: "STRING", description: "The fact, in one sentence." },
    },
    required: ["entry"],
  },
};

/** Memory belongs to an Irgat; other chats get the first two. */
export function liveToolDeclarations(options: { memory: boolean }): FunctionDeclaration[] {
  return options.memory
    ? [DELEGATE_DECLARATION, SAVE_NOTE_DECLARATION, MEMORY_DECLARATION]
    : [DELEGATE_DECLARATION, SAVE_NOTE_DECLARATION];
}

export type LiveToolDeps = {
  /** Resolves once the agent took the work, not when it finishes. */
  delegate: (prompt: string) => Promise<{ started: boolean; reason?: string }>;
  saveNote: (title: string, content: string) => Promise<{ created: boolean }>;
  remember?: (entry: string) => Promise<{ added: boolean }>;
};

function arg(call: FunctionCall, name: string): string {
  const value = call.args[name];
  return typeof value === "string" ? value.trim() : "";
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Runs one call and answers it the way the model expects. */
export async function runLiveTool(
  call: FunctionCall,
  deps: LiveToolDeps,
): Promise<FunctionResponse> {
  const answer = (response: Record<string, unknown>): FunctionResponse => ({
    id: call.id,
    name: call.name,
    response,
  });
  try {
    switch (call.name) {
      case DELEGATE_TOOL: {
        const prompt = arg(call, "prompt");
        if (!prompt) return answer({ error: "prompt is empty" });
        const { started, reason } = await deps.delegate(prompt);
        return answer(
          started
            ? {
                result:
                  "Started. The agent is working on it in the background; tell the user briefly, and you will get its result when it finishes.",
              }
            : { error: reason ?? "The agent could not take the work right now" },
        );
      }
      case SAVE_NOTE_TOOL: {
        const content = arg(call, "content");
        if (!content) return answer({ error: "content is empty" });
        const { created } = await deps.saveNote(arg(call, "title"), content);
        return answer({ result: created ? "Saved to Notes." : "That note was already saved." });
      }
      case MEMORY_TOOL: {
        if (!deps.remember) return answer({ error: "This chat has no memory" });
        const entry = arg(call, "entry");
        if (!entry) return answer({ error: "entry is empty" });
        const { added } = await deps.remember(entry);
        return answer({ result: added ? "Remembered." : "Already in memory." });
      }
      default:
        return answer({ error: `Unknown tool ${call.name}` });
    }
  } catch (reason) {
    return answer({ error: errorText(reason) });
  }
}

/** The turn that tells the model how delegated work ended, so it can say so. */
export function delegationResultText(prompt: string, outcome: string | undefined): string {
  const short = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return `<delegation_result>\nThe agent finished the work you delegated: "${short(prompt.replace(/\s+/g, " "), 300)}".\n${
    outcome?.trim()
      ? `Its reply:\n${short(outcome.trim(), 4000)}`
      : "It finished without a written reply."
  }\nTell the user the outcome in a sentence or two, in your own voice.\n</delegation_result>`;
}
