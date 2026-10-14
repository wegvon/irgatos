// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionMessageStore,
  resetCooperativeModeCache,
  saveCooperativeMode,
  type SessionMessageStore,
} from "../data/sessionMessageStore";
import type { Block, Session } from "./session";
import {
  DELIVERY_ACK_TIMEOUT_MS,
  DELIVERY_PROGRESS_TIMEOUT_MS,
  createProgressTracker,
} from "./deliveryGuards";
import {
  SESSION_MESSAGE_GUARD_INTERVAL_MS,
  applyCooperativeBridgeToTurn,
  checkSessionMessageGuards,
  forceSendSessionMessage,
  retrySessionMessage,
  sendSessionMessage,
  startSessionMessageGuardTimer,
  syncSessionMessages,
  type RouterDeps,
  type SessionMessageTransport,
} from "./sessionMessageRouter";
import { formatSessionMessagePrompt } from "./sessionMessaging";

function session(id: string, title: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "claude",
    model: "claude:opus",
    modelSettings: {},
    runtimeMode: "default" as Session["runtimeMode"],
    title,
    cwd: "/repo/app",
    blocks: [],
    ...patch,
  };
}

let store: SessionMessageStore;
let sessions: Session[];
let submit: ReturnType<typeof vi.fn<(id: string, text: string) => boolean>>;
let insert: ReturnType<typeof vi.fn<(id: string, text: string) => void>>;
let deps: RouterDeps;
let ids: number;
let clock: number;

const lead = session("aaaaaaaa-lead", "Lead");
const docs = session("bbbbbbbb-docs", "Docs");
const tests = session("cccccccc-test", "Tests");

beforeEach(() => {
  localStorage.clear();
  resetCooperativeModeCache();
  store = createSessionMessageStore(`test.router.${Math.random()}`);
  sessions = [lead, docs, tests];
  submit = vi.fn<(id: string, text: string) => boolean>(() => true);
  insert = vi.fn<(id: string, text: string) => void>();
  ids = 0;
  clock = 1_000;
  const transport: SessionMessageTransport = {
    sessions: () => sessions,
    submit,
    insertIntoComposer: insert,
  };
  deps = {
    store,
    transport,
    now: () => clock,
    newId: () => `id-${++ids}`,
  };
});

describe("sendSessionMessage", () => {
  it("submits a labelled turn and waits for the target to take it", () => {
    const [sent] = sendSessionMessage(
      {
        from: lead,
        to: [docs],
        text: "Update the README",
        mode: "run",
        origin: "user",
        sourceBlockId: "r1",
      },
      deps,
    );
    expect(submit).toHaveBeenCalledWith(
      docs.id,
      '[Message from session "Lead"]\n\nUpdate the README',
    );
    expect(sent).toMatchObject({
      fromSessionId: lead.id,
      toSessionId: docs.id,
      toTitle: "Docs",
      status: "queued",
      sourceBlockId: "r1",
      createdAt: 1_000,
    });
  });

  it("places a composer message and counts it delivered", () => {
    const [sent] = sendSessionMessage(
      { from: lead, to: [docs], text: "Look at this", mode: "composer", origin: "user" },
      deps,
    );
    expect(insert).toHaveBeenCalledWith(
      docs.id,
      '[Message from session "Lead"]\n\nLook at this',
    );
    expect(submit).not.toHaveBeenCalled();
    expect(sent).toMatchObject({ status: "delivered", deliveredAt: 1_000 });
  });

  it("broadcasts one tracked message per target", () => {
    const sent = sendSessionMessage(
      { from: lead, to: [docs, tests], text: "Pause work", mode: "run", origin: "user" },
      deps,
    );
    expect(submit).toHaveBeenCalledTimes(2);
    expect(sent.map((entry) => entry.toSessionId)).toEqual([docs.id, tests.id]);
    expect(sent[0]!.broadcastId).toBeDefined();
    expect(sent[0]!.broadcastId).toBe(sent[1]!.broadcastId);
  });

  it("fails when the target refuses or is gone, and can be retried", () => {
    submit.mockReturnValueOnce(false);
    const [refused] = sendSessionMessage(
      { from: lead, to: [docs], text: "Hi", mode: "run", origin: "user" },
      deps,
    );
    expect(refused).toMatchObject({
      status: "failed",
      error: `"Docs" didn't accept the message.`,
    });
    expect(retrySessionMessage(refused!.id, deps)).toBe(true);
    expect(store.get(refused!.id)).toMatchObject({ status: "queued" });

    const [gone] = sendSessionMessage(
      {
        from: lead,
        to: [session("dddddddd-gone", "Gone")],
        text: "Hi",
        mode: "run",
        origin: "user",
      },
      deps,
    );
    expect(gone).toMatchObject({ status: "failed", error: `"Gone" is no longer open.` });
  });

  it("does nothing for an empty message", () => {
    expect(
      sendSessionMessage(
        { from: lead, to: [docs], text: "  ", mode: "run", origin: "user" },
        deps,
      ),
    ).toEqual([]);
    expect(store.snapshot()).toEqual([]);
  });
});

function delivered(target: Session, prompt: string, reply: string, busy = false): Session {
  const blocks: Block[] = [
    { id: `${target.id}-u`, role: "user", text: prompt, startedAt: 1_500 },
    { id: `${target.id}-r`, role: "assistant", text: reply },
  ];
  return { ...target, blocks, busy };
}

describe("syncSessionMessages", () => {
  it("tracks delivery and reply, then returns the answer the sender asked for", () => {
    const [asked] = sendSessionMessage(
      {
        from: lead,
        to: [docs],
        text: "Which port?",
        mode: "run",
        origin: "user",
        expectReply: true,
        sourceBlockId: "lead-r1",
      },
      deps,
    );
    const prompt = formatSessionMessagePrompt(asked!);
    sessions = [lead, delivered(docs, prompt, "", true), tests];
    syncSessionMessages(sessions, deps);
    expect(store.get(asked!.id)).toMatchObject({
      status: "delivered",
      deliveredBlockId: `${docs.id}-u`,
      deliveredAt: 1_500,
    });

    clock = 3_000;
    sessions = [lead, delivered(docs, prompt, "Port 4100."), tests];
    syncSessionMessages(sessions, deps);
    expect(store.get(asked!.id)).toMatchObject({
      status: "replied",
      repliedAt: 3_000,
      replyBlockId: `${docs.id}-r`,
      replyText: "Port 4100.",
      replyForwardedAt: 3_000,
    });
    expect(submit).toHaveBeenLastCalledWith(
      lead.id,
      '[Reply from session "Docs"]\n\nPort 4100.',
    );
    const forwarded = store.snapshot().find((entry) => entry.inReplyTo === asked!.id);
    expect(forwarded).toMatchObject({
      fromSessionId: docs.id,
      toSessionId: lead.id,
      sourceBlockId: `${docs.id}-r`,
      hop: 1,
    });

    syncSessionMessages([...sessions], deps);
    expect(submit).toHaveBeenCalledTimes(2);
  });
});

function withReply(
  source: Session,
  text: string,
  startedAt = 2_000,
  turn = 1,
): Session {
  return {
    ...source,
    blocks: [
      { id: `${source.id}-u${turn}`, role: "user", text: "split the work", startedAt },
      { id: `${source.id}-r${turn}`, role: "assistant", text },
    ],
  };
}

describe("agent directives", () => {
  it("are ignored while cooperative mode is off", () => {
    sessions = [withReply(lead, '@send:"Docs" Update the README'), docs];
    syncSessionMessages(sessions, deps);
    expect(submit).not.toHaveBeenCalled();
  });

  it("hand work to a sibling once, with a receipt on the reply", () => {
    saveCooperativeMode(true, 0);
    sessions = [
      withReply(lead, 'On it.\n@send:"Docs" Update the README\n@ask:Tests Is CI green?'),
      docs,
      tests,
    ];
    syncSessionMessages(sessions, deps);
    expect(submit.mock.calls).toEqual([
      [docs.id, '[Message from session "Lead"]\n\nUpdate the README'],
      [
        tests.id,
        expect.stringMatching(/^\[Message from session "Lead"\]\n\nIs CI green\?/),
      ],
    ]);
    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        origin: "agent",
        sourceBlockId: `${lead.id}-r1`,
        hop: 1,
      }),
      expect.objectContaining({ expectReply: true }),
    ]);
    sessions = sessions.map((entry) => ({ ...entry, blocks: [...entry.blocks] }));
    syncSessionMessages(sessions, deps);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("waits for the turn to finish and skips turns from before it was enabled", () => {
    saveCooperativeMode(true, 5_000);
    sessions = [withReply(lead, '@send:"Docs" old news', 2_000), docs];
    syncSessionMessages(sessions, deps);
    sessions = [
      { ...withReply(lead, '@send:"Docs" new work', 6_000, 2), busy: true },
      docs,
    ];
    syncSessionMessages(sessions, deps);
    expect(submit).not.toHaveBeenCalled();
    sessions = [withReply(lead, '@send:"Docs" new work', 6_000, 2), docs];
    syncSessionMessages(sessions, deps);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("records why a directive could not be sent", () => {
    saveCooperativeMode(true, 0);
    sessions = [withReply(lead, "@send:Nobody hello"), docs];
    syncSessionMessages(sessions, deps);
    expect(submit).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        status: "failed",
        toSessionId: "",
        toTitle: "Nobody",
        sourceBlockId: `${lead.id}-r1`,
        error: 'No open session is called "Nobody".',
      }),
    ]);
  });

  it("stops sessions that keep messaging each other", () => {
    saveCooperativeMode(true, 0);
    store.add({
      id: "deep",
      fromSessionId: docs.id,
      fromTitle: "Docs",
      toSessionId: lead.id,
      toTitle: "Lead",
      text: "split the work",
      mode: "run",
      origin: "agent",
      status: "delivered",
      createdAt: 1_000,
      hop: 4,
      deliveredBlockId: `${lead.id}-u1`,
    });
    sessions = [withReply(lead, '@send:"Docs" and again'), docs];
    syncSessionMessages(sessions, deps);
    expect(submit).not.toHaveBeenCalled();
    expect(store.snapshot().at(-1)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("4 times in a row"),
    });
  });
});

describe("applyCooperativeBridgeToTurn", () => {
  it("briefs an agent once per set of sibling sessions", () => {
    const own = session("eeeeeeee-own", "Own");
    const live = [own, docs];
    expect(applyCooperativeBridgeToTurn("prompt", own.id, live)).toBe("prompt");
    saveCooperativeMode(true, 0);
    const first = applyCooperativeBridgeToTurn("prompt", own.id, live);
    expect(first).toContain("<irgatos-session-bridge>");
    expect(first).toContain('"Docs"');
    expect(applyCooperativeBridgeToTurn("again", own.id, live)).toBe("again");
    expect(
      applyCooperativeBridgeToTurn("more", own.id, [...live, tests]),
    ).toContain('"Tests"');
    expect(applyCooperativeBridgeToTurn("solo", own.id, [own])).toBe("solo");
  });
});

describe("delivery guards", () => {
  const approval = (target: Session, requestId = 7): Session => ({
    ...target,
    busy: true,
    blocks: [{ id: `${target.id}-tool`, role: "tool", text: "rm -rf build", approval: { requestId } }],
  });
  const asking = (target: Session): Session => ({
    ...target,
    busy: true,
    pendingQuestion: { requestId: 9, questions: [] } as unknown as Session["pendingQuestion"],
  });
  const send = (to: Session = docs) =>
    sendSessionMessage({ from: lead, to: [to], text: "Ship it", mode: "run", origin: "user" }, deps)[0]!;

  beforeEach(() => {
    deps.progress = createProgressTracker();
  });

  it("holds a prompt for a target waiting on approval instead of submitting it", () => {
    sessions = [lead, approval(docs), tests];
    const held = send();
    expect(submit).not.toHaveBeenCalled();
    expect(held).toMatchObject({ status: "blocked", blockedBy: "approval" });
    expect(held.dispatchedAt).toBeUndefined();
  });

  it("holds a prompt for a target waiting on an answer", () => {
    sessions = [lead, asking(docs), tests];
    expect(send()).toMatchObject({ status: "blocked", blockedBy: "question" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("releases a held prompt once the target is unblocked", () => {
    sessions = [lead, approval(docs), tests];
    const held = send();
    syncSessionMessages(sessions, deps);
    expect(submit).not.toHaveBeenCalled();
    clock = 2_000;
    sessions = [lead, { ...docs, busy: true }, tests];
    syncSessionMessages(sessions, deps);
    expect(submit).toHaveBeenCalledWith(docs.id, '[Message from session "Lead"]\n\nShip it');
    expect(store.get(held.id)).toMatchObject({ status: "queued", dispatchedAt: 2_000 });
    expect(store.get(held.id)?.blockedBy).toBeUndefined();
  });

  it("follows the target from approval to question while holding", () => {
    sessions = [lead, approval(docs), tests];
    const held = send();
    sessions = [lead, asking(docs), tests];
    checkSessionMessageGuards(sessions, deps);
    expect(store.get(held.id)).toMatchObject({ status: "blocked", blockedBy: "question" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("shows a submitted prompt as blocked while the target waits, then queued again", () => {
    sessions = [lead, { ...docs, busy: true }, tests];
    const queued = send();
    expect(queued).toMatchObject({ status: "queued", dispatchedAt: 1_000 });
    sessions = [lead, approval(docs), tests];
    checkSessionMessageGuards(sessions, deps);
    expect(store.get(queued.id)).toMatchObject({ status: "blocked", blockedBy: "approval" });
    clock = 4_000;
    sessions = [lead, { ...docs, busy: true }, tests];
    checkSessionMessageGuards(sessions, deps);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(store.get(queued.id)).toMatchObject({ status: "queued", dispatchedAt: 4_000 });
  });

  it("marks a prompt stalled when an idle target never starts the turn", () => {
    const queued = send();
    checkSessionMessageGuards(sessions, deps);
    clock = 1_000 + DELIVERY_ACK_TIMEOUT_MS - 1;
    checkSessionMessageGuards(sessions, deps);
    expect(store.get(queued.id)?.status).toBe("queued");
    clock = 1_000 + DELIVERY_ACK_TIMEOUT_MS;
    checkSessionMessageGuards(sessions, deps);
    expect(store.get(queued.id)).toMatchObject({ status: "stalled", stalledAt: clock });
  });

  it("marks a prompt stalled when a running target stops making progress", () => {
    sessions = [lead, { ...docs, busy: true, blocks: [{ id: "a", role: "assistant", text: "w" }] }, tests];
    const queued = send();
    checkSessionMessageGuards(sessions, deps);
    clock = 60_000;
    sessions = [lead, { ...docs, busy: true, blocks: [{ id: "a", role: "assistant", text: "working" }] }, tests];
    checkSessionMessageGuards(sessions, deps);
    clock = 60_000 + DELIVERY_PROGRESS_TIMEOUT_MS - 1;
    checkSessionMessageGuards(sessions, deps);
    expect(store.get(queued.id)?.status).toBe("queued");
    clock = 60_000 + DELIVERY_PROGRESS_TIMEOUT_MS;
    checkSessionMessageGuards(sessions, deps);
    expect(store.get(queued.id)?.status).toBe("stalled");
  });

  it("counts a stalled prompt delivered once a turn carries it after all", () => {
    const queued = send();
    checkSessionMessageGuards(sessions, deps);
    clock = 1_000 + DELIVERY_ACK_TIMEOUT_MS;
    checkSessionMessageGuards(sessions, deps);
    expect(store.get(queued.id)?.status).toBe("stalled");
    sessions = [lead, delivered(docs, formatSessionMessagePrompt(queued), "", true), tests];
    syncSessionMessages(sessions, deps);
    expect(store.get(queued.id)).toMatchObject({ status: "delivered" });
    expect(store.get(queued.id)?.stalledAt).toBeUndefined();
  });

  it("retries a stalled prompt and force-sends a blocked one", () => {
    const stalled = send();
    checkSessionMessageGuards(sessions, deps);
    clock = 1_000 + DELIVERY_ACK_TIMEOUT_MS;
    checkSessionMessageGuards(sessions, deps);
    expect(retrySessionMessage(stalled.id, deps)).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(store.get(stalled.id)).toMatchObject({ status: "queued", dispatchedAt: clock });

    sessions = [lead, approval(docs), tests];
    const held = send();
    expect(retrySessionMessage(held.id, deps)).toBe(false);
    expect(forceSendSessionMessage(held.id, deps)).toBe(true);
    expect(submit).toHaveBeenCalledTimes(3);
    expect(store.get(held.id)).toMatchObject({ status: "queued" });
    expect(forceSendSessionMessage(held.id, deps)).toBe(false);
  });

  it("leaves composer messages alone", () => {
    sessions = [lead, approval(docs), tests];
    const [placed] = sendSessionMessage(
      { from: lead, to: [docs], text: "Look", mode: "composer", origin: "user" },
      deps,
    );
    expect(placed).toMatchObject({ status: "delivered" });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("re-checks on a timer only while a message needs it", () => {
    let tick: (() => void) | undefined;
    const set = vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(SESSION_MESSAGE_GUARD_INTERVAL_MS);
      tick = fn;
      return 1;
    });
    const clear = vi.fn();
    const stop = startSessionMessageGuardTimer(() => sessions, deps, { set, clear });
    const apply = vi.spyOn(store, "apply");
    tick!();
    expect(apply).not.toHaveBeenCalled();
    const queued = send();
    tick!();
    clock = 1_000 + DELIVERY_ACK_TIMEOUT_MS;
    tick!();
    expect(store.get(queued.id)?.status).toBe("stalled");
    stop();
    expect(clear).toHaveBeenCalledWith(1);
  });
});
