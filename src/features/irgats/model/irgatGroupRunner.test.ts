// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlOutcome } from "../../orchestration/model/orchestration";
import { createIrgat, saveIrgatName, type Irgat } from "./irgat";
import type { IrgatFiles } from "./irgatFiles";
import {
  createIrgatGroup,
  loadIrgatGroupMessages,
  updateIrgatGroup,
  type IrgatGroup,
} from "./irgatGroups";
import {
  IrgatGroupRunner,
  MAX_FOLLOW_UPS_PER_ROUND,
  seatReply,
  type IrgatGroupHost,
} from "./irgatGroupRunner";

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map([["irgat:irgat-roster", "[]"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

type Script = (irgat: string, prompt: string) => string | ControlOutcome | Promise<ControlOutcome>;

/** A host whose members answer from a script, recording every turn. */
function fakeHost(byId: Map<string, string>, script: Script) {
  const turns: { irgat: string; prompt: string }[] = [];
  const replies = new Map<string, string>();
  const seats = new Map<string, string>();
  const closed: string[] = [];
  const stopped: string[] = [];
  let next = 0;
  const host: IrgatGroupHost = {
    openSeat: async (irgatId) => {
      const seatId = `seat-${++next}`;
      seats.set(seatId, irgatId);
      return { seatId, harness: "claude", model: `model-${byId.get(irgatId)}` };
    },
    files: async (irgatId): Promise<IrgatFiles> => ({
      id: irgatId,
      dir: `/a/${irgatId}`,
      soul: `You are the ${byId.get(irgatId)} expert.`,
      soulHash: "s",
      memory: "",
      memoryHash: "m",
      memoryPath: `/a/${irgatId}/MEMORY.md`,
      topics: [],
    }),
    run: async (seatId, prompt) => {
      const name = byId.get(seats.get(seatId)!)!;
      turns.push({ irgat: name, prompt });
      const out = await script(name, prompt);
      const outcome = typeof out === "string" ? { status: "completed" as const, text: out } : out;
      replies.set(seatId, outcome.text);
      return outcome;
    },
    reply: (seatId) => replies.get(seatId) ?? "",
    stop: async (seatId) => void stopped.push(seatId),
    close: async (seatId) => void closed.push(seatId),
  };
  return { host, turns, closed, stopped };
}

function room(names: string[], change?: (g: IrgatGroup) => IrgatGroup) {
  const irgats: Irgat[] = names.map((name) => {
    const irgat = createIrgat();
    saveIrgatName(irgat.id, name);
    return irgat;
  });
  const group = createIrgatGroup(irgats.map((irgat) => irgat.id));
  if (change) updateIrgatGroup(group.id, change);
  const byId = new Map(irgats.map((irgat, i) => [irgat.id, names[i]]));
  const idOf = (name: string) => irgats[names.indexOf(name)].id;
  return { group, byId, idOf, all: irgats.map((irgat) => irgat.id) };
}

const said = (groupId: string) =>
  loadIrgatGroupMessages(groupId).map((m) =>
    m.role === "user" ? `User: ${m.text}` : `${m.name}: ${m.reaction ?? m.text}${m.error ? ` (${m.error})` : ""}`,
  );

describe("a round-table message", () => {
  it("has every member reply in order, each reading the replies before it", async () => {
    const { group, byId, all } = room(["Architect", "Security", "Frontend"]);
    const fake = fakeHost(byId, (name) => `${name} says hi`);
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "Ship it?", [], all);
    await runner.idle(group.id);

    expect(fake.turns.map((t) => t.irgat)).toEqual(["Architect", "Security", "Frontend"]);
    expect(said(group.id)).toEqual([
      "User: Ship it?",
      "Architect: Architect says hi",
      "Security: Security says hi",
      "Frontend: Frontend says hi",
    ]);
    const [first, second, third] = fake.turns.map((t) => t.prompt);
    expect(first.startsWith("/operator ")).toBe(true);
    expect(first).toContain("You are the Architect expert.");
    expect(first).not.toContain("[Irgat: Architect]");
    expect(second).toContain("You are the Security expert.");
    expect(second).toContain("[User] Ship it?");
    expect(second).toContain("[Irgat: Architect] Architect says hi");
    expect(second).toContain("Frontend will reply after you");
    expect(third).toContain("[Irgat: Architect] Architect says hi");
    expect(third).toContain("[Irgat: Security] Security says hi");
    expect(third).toContain("Architect and Security already replied");
    // The roster carries each member's role from its soul.
    expect(first).toContain("- Security, @Security: You are the Security expert.");
  });

  it("records who spoke with which model, and closes every seat", async () => {
    const { group, byId, all } = room(["Architect", "Security"]);
    const fake = fakeHost(byId, () => "ok");
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "hi", [], all);
    await runner.idle(group.id);
    const replies = loadIrgatGroupMessages(group.id).filter((m) => m.role === "irgat");
    expect(replies.map((m) => [m.name, m.harness, m.model])).toEqual([
      ["Architect", "claude", "model-Architect"],
      ["Security", "claude", "model-Security"],
    ]);
    expect(fake.closed).toEqual(["seat-1", "seat-2"]);
    expect(runner.state(group.id)).toEqual({ queue: [] });
  });

  it("only lets the picked members reply", async () => {
    const { group, byId, idOf } = room(["Architect", "Security", "Frontend"]);
    const fake = fakeHost(byId, (name) => name);
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "UI thoughts?", [], [idOf("Frontend"), idOf("Architect")]);
    await runner.idle(group.id);
    expect(fake.turns.map((t) => t.irgat)).toEqual(["Architect", "Frontend"]);
  });

  it("shows the queue while it runs", async () => {
    const { group, byId, all, idOf } = room(["Architect", "Security"]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = fakeHost(byId, async () => {
      await gate;
      return { status: "completed", text: "done" };
    });
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "go", [], all);
    await vi.waitFor(() => expect(fake.turns).toHaveLength(1));
    expect(runner.state(group.id)).toEqual({
      speaking: { irgatId: idOf("Architect"), seatId: "seat-1" },
      queue: [idOf("Security")],
    });
    expect(runner.activeGroups()).toEqual([group.id]);
    release();
    await runner.idle(group.id);
    expect(runner.activeGroups()).toEqual([]);
  });
});

describe("@mentions", () => {
  it("send the message only to the mentioned members, in mention order", async () => {
    const { group, byId, all } = room(["Architect", "Security", "Frontend"]);
    const fake = fakeHost(byId, (name) => name);
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "@Frontend then @Architect: review the nav", [], all);
    await runner.idle(group.id);
    expect(fake.turns.map((t) => t.irgat)).toEqual(["Frontend", "Architect"]);
  });

  it("in a reply hand the mentioned member one follow-up, and no more", async () => {
    const { group, byId, idOf } = room(["Architect", "Security", "Frontend"]);
    const fake = fakeHost(byId, (name) =>
      name === "Architect"
        ? "Looks fine. @Security can you check the tokens?"
        : name === "Security"
          ? "Tokens expire correctly. @Architect agreed."
          : "n/a",
    );
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "@Architect review", [], []);
    await runner.idle(group.id);
    expect(fake.turns.map((t) => t.irgat)).toEqual(["Architect", "Security"]);
    const messages = loadIrgatGroupMessages(group.id);
    expect(messages[1].handoffs).toEqual([idOf("Security")]);
    expect(messages[2].trigger).toEqual({ kind: "handoff", messageId: messages[1].id });
    // Security's reply mentions Architect but a follow-up never hands off again.
    expect(messages).toHaveLength(3);
    expect(fake.turns[1].prompt).toContain("Architect addressed you");
  });

  it("do not hand off to a member still waiting its turn this round", async () => {
    const { group, byId, all } = room(["Architect", "Security"]);
    const fake = fakeHost(byId, (name) => (name === "Architect" ? "@Security over to you" : "noted"));
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "thoughts?", [], all);
    await runner.idle(group.id);
    expect(fake.turns.map((t) => t.irgat)).toEqual(["Architect", "Security"]);
  });

  it("only offer a chip when automatic handoff is off", async () => {
    const { group, byId, idOf } = room(["Architect", "Security"], (g) => ({ ...g, autoHandoff: false }));
    const fake = fakeHost(byId, () => "@Security please check");
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "@Architect go", [], []);
    await runner.idle(group.id);
    expect(fake.turns).toHaveLength(1);
    const reply = loadIrgatGroupMessages(group.id)[1];
    expect(reply.handoffs).toEqual([idOf("Security")]);

    runner.ask(group.id, idOf("Security"), reply.id, "handoff");
    await runner.idle(group.id);
    expect(fake.turns.map((t) => t.irgat)).toEqual(["Architect", "Security"]);
    expect(loadIrgatGroupMessages(group.id)[2].trigger).toEqual({ kind: "handoff", messageId: reply.id });
  });

  it("cap the follow-ups one round hands out", async () => {
    const names = ["Lead", "A", "B", "C", "D", "E"];
    const { group, byId } = room(names);
    const fake = fakeHost(byId, (name) => (name === "Lead" ? "@A @B @C @D @E weigh in" : "ok"));
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "@Lead start", [], []);
    await runner.idle(group.id);
    expect(fake.turns).toHaveLength(1 + MAX_FOLLOW_UPS_PER_ROUND);
    expect(fake.turns.map((t) => t.irgat)).toEqual(["Lead", "A", "B", "C"]);
  });
});

describe("asking for a review", () => {
  it("has the chosen member critique that message", async () => {
    const { group, byId, idOf } = room(["Architect", "Security"]);
    const fake = fakeHost(byId, (name) => `${name} view`);
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "@Architect plan?", [], []);
    await runner.idle(group.id);
    const plan = loadIrgatGroupMessages(group.id)[1];
    runner.ask(group.id, idOf("Security"), plan.id, "review");
    await runner.idle(group.id);
    expect(fake.turns[1].prompt).toContain("review Architect's message above");
    expect(loadIrgatGroupMessages(group.id)[2].trigger).toEqual({ kind: "review", messageId: plan.id });
  });
});

describe("stopping and failures", () => {
  it("stop ends the reply in progress and drops the members still waiting", async () => {
    const { group, byId, all } = room(["Architect", "Security", "Frontend"]);
    let finish!: (outcome: ControlOutcome) => void;
    const fake = fakeHost(byId, () => new Promise<ControlOutcome>((resolve) => (finish = resolve)));
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "go", [], all);
    await vi.waitFor(() => expect(fake.turns).toHaveLength(1));
    const stopping = runner.stop(group.id);
    expect(runner.state(group.id).queue).toEqual([]);
    finish({ status: "cancelled", text: "Half an ans" });
    await stopping;
    await runner.idle(group.id);
    expect(fake.stopped).toEqual(["seat-1"]);
    expect(fake.turns).toHaveLength(1);
    expect(said(group.id)).toEqual([
      "User: go",
      "Architect: Half an ans (Stopped before it finished.)",
    ]);
  });

  it("a failed turn leaves a notice and the round goes on", async () => {
    const { group, byId, all } = room(["Architect", "Security"]);
    const fake = fakeHost(byId, (name) =>
      name === "Architect" ? { status: "failed", text: "", error: "Usage limit reached" } : "fine",
    );
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "go", [], all);
    await runner.idle(group.id);
    const messages = loadIrgatGroupMessages(group.id);
    expect(messages[1]).toMatchObject({ role: "notice", name: "Architect", error: "Usage limit reached" });
    expect(messages[2]).toMatchObject({ role: "irgat", name: "Security", text: "fine" });
    // The notice is not part of what the next member reads.
    expect(fake.turns[1].prompt).not.toContain("Usage limit reached");
  });

  it("a member that cannot get a seat is reported, not skipped silently", async () => {
    const { group, byId, all } = room(["Architect", "Security"]);
    const fake = fakeHost(byId, () => "ok");
    fake.host.openSeat = async () => undefined;
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "go", [], all);
    await runner.idle(group.id);
    expect(loadIrgatGroupMessages(group.id).slice(1).map((m) => m.error)).toEqual([
      "Architect could not start a reply.",
      "Security could not start a reply.",
    ]);
  });

  it("a reaction-only reply is kept as a reaction", async () => {
    const { group, byId, idOf } = room(["Architect", "Security"]);
    const fake = fakeHost(byId, () => "<reaction>👍</reaction>");
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "thanks all", [], [idOf("Architect")]);
    await runner.idle(group.id);
    expect(loadIrgatGroupMessages(group.id)[1]).toMatchObject({ reaction: "👍", text: "" });
  });

  it("a member removed mid-round does not speak", async () => {
    const { group, byId, all, idOf } = room(["Architect", "Security", "Frontend"]);
    const fake = fakeHost(byId, (name) => {
      if (name === "Architect")
        updateIrgatGroup(group.id, (g) => ({
          ...g,
          memberIds: g.memberIds.filter((id) => id !== idOf("Security")),
        }));
      return name;
    });
    const runner = new IrgatGroupRunner(() => fake.host);
    runner.send(group.id, "go", [], all);
    await runner.idle(group.id);
    expect(fake.turns.map((t) => t.irgat)).toEqual(["Architect", "Frontend"]);
  });
});

it("reads a seat's reply as its last words since the prompt", () => {
  expect(
    seatReply({
      blocks: [
        { id: "1", role: "user", text: "q" },
        { id: "2", role: "assistant", text: "thinking out loud" },
        { id: "3", role: "assistant", text: "", tool: { title: "Read a.ts" } },
        { id: "4", role: "assistant", text: "Final answer" },
      ],
    }),
  ).toBe("Final answer");
  expect(seatReply({ blocks: [{ id: "1", role: "assistant", text: "old" }, { id: "2", role: "user", text: "new" }] })).toBe("");
  expect(seatReply(undefined)).toBe("");
});
