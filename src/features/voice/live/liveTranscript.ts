import type { Block } from "../../sessions/model/session";

/**
 * The API transcribes both sides in fragments as they are spoken. This
 * gathers them into whole turns for the chat.
 */
export class LiveTranscript {
  private user = "";
  private assistant = "";

  addUser(fragment: string) {
    this.user = join(this.user, fragment);
  }

  addAssistant(fragment: string) {
    this.assistant = join(this.assistant, fragment);
  }

  get pendingUser(): string {
    return this.user.trim();
  }

  get pendingAssistant(): string {
    return this.assistant.trim();
  }

  /** What the user has said so far, cleared. */
  takeUser(): string {
    const text = this.user.trim();
    this.user = "";
    return text;
  }

  takeAssistant(): string {
    const text = this.assistant.trim();
    this.assistant = "";
    return text;
  }
}

/** Fragments arrive with their own spacing; only add one where neither has it. */
function join(text: string, fragment: string): string {
  if (!fragment) return text;
  if (!text) return fragment.replace(/^\s+/, "");
  return /\s$/.test(text) || /^[\s.,!?;:)]/.test(fragment) ? text + fragment : `${text} ${fragment}`;
}

export function liveBlock(
  speaker: "user" | "assistant",
  text: string,
  options: { at?: number; interrupted?: boolean } = {},
): Block {
  return {
    id: crypto.randomUUID(),
    role: speaker,
    text,
    liveVoice: {
      at: options.at ?? Date.now(),
      ...(options.interrupted ? { interrupted: true } : {}),
    },
  };
}

/** The live call's turns the agent's own session has not been told about. */
export function unseenLiveTurns(blocks: readonly Block[]): Block[] {
  const turns: Block[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.liveVoice) {
      if (block.text.trim()) turns.unshift(block);
      continue;
    }
    if (block.role === "user" && !block.draft && !block.internal) break;
  }
  return turns;
}

const LINE_MAX = 800;

/** Hands the next typed turn what was said out loud since the last one. */
export function liveTurnsContext(turns: readonly Block[]): string {
  if (!turns.length) return "";
  const lines = turns.map((turn) => {
    const text = turn.text.replace(/\s+/g, " ").trim();
    const short = text.length > LINE_MAX ? `${text.slice(0, LINE_MAX - 1)}…` : text;
    return `- ${turn.role === "user" ? "User" : "You (live voice)"}: ${short}${
      turn.liveVoice?.interrupted ? " [cut off]" : ""
    }`;
  });
  return `<live_voice_conversation>\nSince the last typed message, the user talked with you in a live voice call in this chat; a separate realtime voice model spoke for you there and handed real work to you. The user heard all of this, so build on it rather than repeating it.\n${lines.join("\n")}\n</live_voice_conversation>`;
}
