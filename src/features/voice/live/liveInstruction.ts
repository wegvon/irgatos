import { ADHD_RULES } from "../../adhd/model/adhdRules";
import type { Block } from "../../sessions/model/session";

export type LiveTurn = { speaker: "user" | "assistant"; text: string };

/** How much of the chat the call starts with. */
export const RECENT_TURNS = 12;
const TURN_MAX = 600;
const RECENT_MAX = 6000;

function squash(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The last few things the user and the agent said, newest last. */
export function recentTurns(blocks: readonly Block[], limit = RECENT_TURNS): LiveTurn[] {
  const turns: LiveTurn[] = [];
  let size = 0;
  for (let i = blocks.length - 1; i >= 0 && turns.length < limit; i--) {
    const block = blocks[i];
    if (block.internal || block.draft) continue;
    if (block.role !== "user" && block.role !== "assistant") continue;
    if (!block.text.trim()) continue;
    const text = squash(block.text, TURN_MAX);
    if (size + text.length > RECENT_MAX) break;
    size += text.length;
    turns.unshift({ speaker: block.role, text });
  }
  return turns;
}

export type LiveInstructionInput = {
  /** The Irgat's or the session's name. */
  name: string;
  soul?: string;
  memory?: string;
  /** Where the Irgat works, as its text turns describe it. */
  projects?: string;
  recent?: readonly LiveTurn[];
  adhd?: boolean;
  /** The standing prompt from Settings > Chat, as its context block. */
  standingPrompt?: string;
  /** Memory tools are offered; Irgats only. */
  memoryTool?: boolean;
};

export function liveSystemInstruction(input: LiveInstructionInput): string {
  const parts: string[] = [
    `<live_voice>\nYou are ${input.name}, talking with the user out loud in a live voice call inside Irgatos. Speak the way a capable colleague talks on a call: short, natural sentences, one idea at a time, and stop when you have answered. Never read out code, file paths, URLs, tables or long lists; summarize them, and offer to put the detail in the chat or a note. Answer in the language the user speaks. If they talk over you, stop and listen.\n</live_voice>`,
    `<live_tools>\nYou cannot touch files, run commands or browse yourself. For any real work (code, repositories, commands, CI, research) call delegate_to_irgat_session with a complete, self-contained prompt: the agent in this chat does it with its full tools in the background. Say in a few words what you handed off, then keep talking with the user; when its result arrives, tell them the outcome briefly. Use save_irgat_note when they ask you to write something down.${
      input.memoryTool
        ? " Use update_irgat_memory for a fact worth keeping across conversations, never for secrets."
        : ""
    }\n</live_tools>`,
  ];
  if (input.projects?.trim()) parts.push(`<projects>\n${input.projects.trim()}\n</projects>`);
  if (input.soul?.trim())
    parts.push(
      `<soul>\nYour standing instructions, from SOUL.md. They rank below what the user asks now.\n\n${input.soul.trim()}\n</soul>`,
    );
  if (input.memory !== undefined)
    parts.push(
      `<memory>\n${input.memory.trim() || "(Empty. Nothing has been remembered yet.)"}\n</memory>`,
    );
  if (input.recent?.length)
    parts.push(
      `<recent_conversation>\nThe chat this call continues, newest last. Pick up from it rather than starting over.\n${input.recent
        .map((turn) => `${turn.speaker === "user" ? "User" : "You"}: ${turn.text}`)
        .join("\n")}\n</recent_conversation>`,
    );
  if (input.adhd)
    parts.push(
      `<adhd_mode>\nThe user turned on ADHD mode. Follow these rules in every answer, out loud too: lead with the one next step, keep it short, and stay on their task.\n\n${ADHD_RULES}\n</adhd_mode>`,
    );
  if (input.standingPrompt?.trim()) parts.push(input.standingPrompt.trim());
  return parts.join("\n\n");
}
