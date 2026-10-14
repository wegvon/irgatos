import type { ControlOutcome } from "../../orchestration/model/orchestration";
import type {
  Attachment,
  HarnessId,
  Session,
} from "../../sessions/model/session";
import { findIrgat, irgatLook } from "./irgat";
import type { IrgatFiles } from "./irgatFiles";
import {
  cleanGroupReply,
  groupTurnPrompt,
  soulRole,
  type GroupRosterEntry,
  type GroupTurnReason,
} from "./irgatGroupContext";
import { handoffTargets, resolveGroupSpeakers } from "./irgatGroupMentions";
import {
  appendIrgatGroupMessage,
  findIrgatGroup,
  groupMembers,
  irgatGroupName,
  loadIrgatGroupMessages,
  speakerFields,
  type IrgatGroupMessage,
} from "./irgatGroups";
import { irgatReaction } from "./irgatReaction";

/** A seat's reply: its last words since the prompt, streaming or final. */
export function seatReply(seat: Pick<Session, "blocks"> | undefined): string {
  if (!seat) return "";
  for (let i = seat.blocks.length - 1; i >= 0; i--) {
    const block = seat.blocks[i];
    if (block.role === "user") break;
    if (block.role === "assistant" && !block.tool && block.text.trim())
      return block.text;
  }
  return "";
}

/** The hidden session one member's turn runs in. */
export type GroupSeat = { seatId: string; harness: HarnessId; model: string };

/**
 * What the app does for a room. Each turn runs in a hidden session of its
 * own with the member's model, like a habit run, so the member's own chat is
 * never touched and a room survives restarts with nothing to rebind.
 */
export type IrgatGroupHost = {
  /** A hidden session for one turn, with the member's provider and model. */
  openSeat(irgatId: string, title: string): Promise<GroupSeat | undefined>;
  files(irgatId: string): Promise<IrgatFiles>;
  /** Sends the turn and resolves once it settles. */
  run(
    seatId: string,
    prompt: string,
    attachments: Attachment[],
  ): Promise<ControlOutcome>;
  /** The seat's final reply text. */
  reply(seatId: string): string;
  stop(seatId: string): Promise<void>;
  /** Stops the seat if it is still busy, then deletes it. */
  close(seatId: string): Promise<void>;
  /** A member finished a reply. */
  onReply?(groupId: string, message: IrgatGroupMessage): void;
};

type Turn = {
  irgatId: string;
  reason: GroupTurnReason;
  attachments: Attachment[];
  /** Follow-ups a reply hands out are one hop deep, so a room never loops. */
  depth: number;
  /** The room's stop count when queued; a stop since then cancels the turn. */
  generation: number;
};

export type GroupRunState = {
  /** The member replying now, and its seat once it has one. */
  speaking?: { irgatId: string; seatId?: string };
  /** Members still to reply, in order. */
  queue: string[];
};

type Room = {
  queue: Turn[];
  speaking?: { irgatId: string; seatId?: string };
  /** Bumped by each stop. */
  generation: number;
  loop?: Promise<void>;
  /** Follow-ups handed out per round, by the user message that started it. */
  followUps: Map<string, number>;
};

const IDLE: GroupRunState = { queue: [] };

/** Follow-ups one round may hand out, whatever the replies mention. */
export const MAX_FOLLOW_UPS_PER_ROUND = 3;

function roundOf(turn: Turn, messages: readonly IrgatGroupMessage[]): string {
  if (turn.reason.kind === "round") return turn.reason.messageId;
  const index = messages.findIndex((m) => m.id === turn.reason.messageId);
  for (let i = index; i >= 0; i--)
    if (messages[i].role === "user") return messages[i].id;
  return turn.reason.messageId;
}

/**
 * Runs a room's turns one member at a time, so each reads the replies before
 * it. A message the user sends mid-round waits for the round to finish.
 */
export class IrgatGroupRunner {
  private rooms = new Map<string, Room>();
  private states = new Map<string, GroupRunState>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(private host: () => IrgatGroupHost) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever any room's run state does. */
  snapshot = (): number => this.version;

  state(groupId: string): GroupRunState {
    return this.states.get(groupId) ?? IDLE;
  }

  /** Every room with a turn running or waiting. */
  activeGroups(): string[] {
    return [...this.states.keys()];
  }

  /** Resolves once the room has nothing left to run. */
  idle(groupId: string): Promise<void> {
    return this.rooms.get(groupId)?.loop ?? Promise.resolve();
  }

  /**
   * Posts the user's message and queues the members who reply to it. Returns
   * the posted message, or undefined when the room is gone.
   */
  send(
    groupId: string,
    text: string,
    attachments: Attachment[],
    picked: readonly string[],
  ): IrgatGroupMessage | undefined {
    const group = findIrgatGroup(groupId);
    if (!group) return undefined;
    const members = groupMembers(group).map((irgat) => ({
      id: irgat.id,
      name: irgatLook(irgat).name,
    }));
    const speakers = resolveGroupSpeakers({ text, members, picked });
    const message = appendIrgatGroupMessage(groupId, {
      role: "user",
      text,
      ...(attachments.length ? { attachments } : {}),
    });
    this.enqueue(
      groupId,
      speakers.map((irgatId) => ({
        irgatId,
        reason: { kind: "round", messageId: message.id },
        attachments,
        depth: 0,
      })),
    );
    return message;
  }

  /** One member answers a message: an @mention it was handed, or a review. */
  ask(
    groupId: string,
    irgatId: string,
    messageId: string,
    kind: "handoff" | "review",
  ): void {
    this.enqueue(groupId, [
      { irgatId, reason: { kind, messageId }, attachments: [], depth: 1 },
    ]);
  }

  /** Stops the reply in progress and drops the members still waiting. */
  async stop(groupId: string): Promise<void> {
    const room = this.rooms.get(groupId);
    if (!room) return;
    room.generation++;
    room.queue = [];
    this.publish(groupId);
    const seat = room.speaking?.seatId;
    if (seat) await this.host().stop(seat).catch(() => undefined);
  }

  private room(groupId: string): Room {
    let room = this.rooms.get(groupId);
    if (!room) {
      room = { queue: [], generation: 0, followUps: new Map() };
      this.rooms.set(groupId, room);
    }
    return room;
  }

  private enqueue(
    groupId: string,
    turns: Omit<Turn, "generation">[],
  ): void {
    if (!turns.length) return;
    const room = this.room(groupId);
    room.queue.push(
      ...turns.map((turn) => ({ ...turn, generation: room.generation })),
    );
    this.publish(groupId);
    if (!room.loop) this.start(groupId, room);
  }

  private start(groupId: string, room: Room): void {
    room.loop = this.drain(groupId, room).finally(() => {
      room.loop = undefined;
      room.speaking = undefined;
      if (room.queue.length) this.start(groupId, room);
      else this.rooms.delete(groupId);
      this.publish(groupId);
    });
  }

  private async drain(groupId: string, room: Room): Promise<void> {
    for (;;) {
      const turn = room.queue.shift();
      if (!turn) return;
      room.speaking = { irgatId: turn.irgatId };
      this.publish(groupId);
      try {
        await this.runTurn(groupId, room, turn);
      } catch (error) {
        appendIrgatGroupMessage(groupId, {
          role: "notice",
          ...speakerFields(turn.irgatId),
          text: "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      room.speaking = undefined;
    }
  }

  private async runTurn(groupId: string, room: Room, turn: Turn) {
    const group = findIrgatGroup(groupId);
    const irgat = findIrgat(turn.irgatId);
    if (!group || !irgat || !group.memberIds.includes(irgat.id)) return;
    const host = this.host();
    const members = groupMembers(group);
    const files = await Promise.all(
      members.map((member) => host.files(member.id).catch(() => undefined)),
    );
    const roster: GroupRosterEntry[] = members.map((member, index) => ({
      id: member.id,
      name: irgatLook(member).name,
      role: soulRole(files[index]?.soul),
    }));
    const selfIndex = members.findIndex((member) => member.id === irgat.id);
    const self = roster[selfIndex];
    const selfFiles = files[selfIndex];
    const look = irgatLook(irgat);
    if (!selfFiles)
      throw new Error(`${look.name} could not read its SOUL.md and MEMORY.md.`);
    const messages = loadIrgatGroupMessages(groupId);
    const round = roundOf(turn, messages);
    const nameOf = new Map(roster.map((entry) => [entry.id, entry.name]));
    const after = room.queue
      .filter((next) => roundOf(next, messages) === round && next.depth === 0)
      .flatMap((next) => nameOf.get(next.irgatId) ?? []);
    const roomName = irgatGroupName(group);
    const stopped = () => turn.generation !== room.generation;
    const prompt = groupTurnPrompt({
      room: roomName,
      self,
      look,
      files: selfFiles,
      roster,
      messages,
      reason: turn.reason,
      after,
    });
    if (stopped()) return;
    const seat = await host.openSeat(irgat.id, `${roomName} · ${look.name}`);
    if (!seat) throw new Error(`${look.name} could not start a reply.`);
    let outcome: ControlOutcome = { status: "cancelled", text: "" };
    let reply = "";
    try {
      if (stopped()) return;
      room.speaking = { irgatId: irgat.id, seatId: seat.seatId };
      this.publish(groupId);
      // /operator gives the turn the app access the Irgat has in its own chat.
      outcome = await host.run(seat.seatId, `/operator ${prompt}`, turn.attachments);
      reply = cleanGroupReply(host.reply(seat.seatId) || outcome.text, look.name);
    } finally {
      await host.close(seat.seatId).catch(() => undefined);
    }
    const cut = stopped() || outcome.status === "cancelled";
    if (outcome.status === "failed" && !cut) {
      appendIrgatGroupMessage(groupId, {
        role: "notice",
        ...speakerFields(irgat.id),
        text: reply,
        error: outcome.error ?? "The reply did not finish.",
      });
      return;
    }
    if (!reply) return;
    const reaction = irgatReaction(reply);
    const handoffs = reaction
      ? []
      : handoffTargets(
          reply,
          irgat.id,
          roster.map((entry) => ({ id: entry.id, name: entry.name })),
        );
    const message = appendIrgatGroupMessage(groupId, {
      role: "irgat",
      ...speakerFields(irgat.id),
      harness: seat.harness,
      model: seat.model,
      text: reaction ? "" : reply,
      ...(reaction ? { reaction } : {}),
      ...(turn.reason.kind === "round" ? {} : { trigger: turn.reason }),
      ...(handoffs.length ? { handoffs } : {}),
      ...(cut ? { error: "Stopped before it finished." } : {}),
    });
    host.onReply?.(groupId, message);
    if (cut || !group.autoHandoff || turn.depth > 0) return;
    const used = room.followUps.get(round) ?? 0;
    // A member still to speak this round reads the mention when it does.
    const waiting = new Set(
      room.queue
        .filter((next) => roundOf(next, messages) === round)
        .map((next) => next.irgatId),
    );
    const followUps = handoffs
      .filter((id) => !waiting.has(id))
      .slice(0, Math.max(0, MAX_FOLLOW_UPS_PER_ROUND - used))
      .map<Turn>((irgatId) => ({
        irgatId,
        reason: { kind: "handoff", messageId: message.id },
        attachments: [],
        depth: 1,
        generation: turn.generation,
      }));
    if (!followUps.length) return;
    room.followUps.set(round, used + followUps.length);
    room.queue.unshift(...followUps);
    this.publish(groupId);
  }

  private publish(groupId: string): void {
    const room = this.rooms.get(groupId);
    if (room && (room.speaking || room.queue.length))
      this.states.set(groupId, {
        ...(room.speaking ? { speaking: { ...room.speaking } } : {}),
        queue: room.queue.map((turn) => turn.irgatId),
      });
    else this.states.delete(groupId);
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
