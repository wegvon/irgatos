import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, Session } from "../model/session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

type Row = {
  record: Record<string, unknown> & { blocks: Block[]; title: string };
  revision: number;
  fingerprint: string;
};

/** The parts of `session_store.rs` these tests depend on: revisions. */
function fakeStore() {
  const rows = new Map<string, Row>();
  const writes: { blocks: Block[]; title: string }[] = [];
  mocks.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "session_get") {
        const row = rows.get(args.sessionId as string);
        return row
          ? structuredClone({ ...row.record, revision: row.revision })
          : null;
      }
      if (command === "session_upsert") {
        const { baseRevision, ...session } = args.session as Row["record"] & {
          baseRevision: number | null;
          id: string;
        };
        const row = rows.get(session.id);
        if (row && baseRevision != null && baseRevision !== row.revision)
          throw `stale-session-write:${row.revision}`;
        const fingerprint = JSON.stringify(session);
        const revision =
          row && row.fingerprint === fingerprint
            ? row.revision
            : (row?.revision ?? 0) + 1;
        rows.set(session.id, {
          record: { ...structuredClone(session), createdAt: 1, updatedAt: 2 },
          revision,
          fingerprint,
        });
        writes.push({ blocks: session.blocks, title: session.title });
        return { ...session, createdAt: 1, updatedAt: 2, revision };
      }
      throw new Error(`unexpected ${command}`);
    },
  );
  return { rows, writes };
}

async function openWindow() {
  vi.resetModules();
  return import("./sessionStore");
}

const user = (id: string, text: string): Block => ({ id, role: "user", text });
const reply = (id: string, text: string): Block => ({
  id,
  role: "assistant",
  text,
});

function seed(store: ReturnType<typeof fakeStore>) {
  const record = {
    id: "chat",
    cwd: "/tmp/project",
    harness: "codex",
    model: "",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Chat",
    blocks: [user("u1", "hello"), reply("a1", "hi")],
    createdAt: 1,
    updatedAt: 1,
  };
  store.rows.set("chat", {
    record,
    revision: 1,
    fingerprint: JSON.stringify(record),
  });
}

const storedTexts = (store: ReturnType<typeof fakeStore>) =>
  store.rows.get("chat")!.record.blocks.map((block) => block.text);

describe("one chat open in two windows", () => {
  let store: ReturnType<typeof fakeStore>;
  beforeEach(() => {
    store = fakeStore();
    seed(store);
  });
  afterEach(() => mocks.invoke.mockReset());

  async function continueInA() {
    const windowA = await openWindow();
    const windowB = await openWindow();
    const inA = (await windowA.getSession("chat"))!;
    const inB = (await windowB.getSession("chat"))!;
    const continued: Session = {
      ...inA,
      blocks: [...inA.blocks, user("u2", "continue"), reply("a2", "done")],
    };
    await windowA.upsertSession(continued);
    expect(storedTexts(store)).toEqual(["hello", "hi", "continue", "done"]);
    return { windowA, windowB, inA: continued, inB };
  }

  it("closing the other window keeps every new message", async () => {
    const { windowB, inB } = await continueInA();
    const writes = store.writes.length;
    // B closes and flushes the snapshot it opened before A continued.
    await expect(windowB.upsertSession(inB)).resolves.not.toBeNull();
    expect(storedTexts(store)).toEqual(["hello", "hi", "continue", "done"]);
    expect(store.writes.length).toBe(writes);
  });

  it("merges the closing window's own change onto the newer transcript", async () => {
    const { windowB, inB } = await continueInA();
    await windowB.upsertSession({ ...inB, title: "Renamed in B" });
    expect(storedTexts(store)).toEqual(["hello", "hi", "continue", "done"]);
    expect(store.rows.get("chat")!.record.title).toBe("Renamed in B");
  });

  it("keeps a message sent in the stale window after the other window's turn", async () => {
    const { windowB, inB } = await continueInA();
    await windowB.upsertSession({
      ...inB,
      blocks: [...inB.blocks, user("b1", "from B")],
    });
    expect(storedTexts(store)).toEqual([
      "hello",
      "hi",
      "continue",
      "done",
      "from B",
    ]);
  });

  it("refreshes the other window, which then neither reverts nor rewrites", async () => {
    const { windowB, inB } = await continueInA();
    let shown = inB;
    let clean = false;
    windowB.subscribeSessionRebase((_, rebase) => {
      const next = rebase(shown);
      shown = next.session;
      clean = !next.dirty;
    });
    await windowB.refreshStoredSession("chat", 2, () => shown);
    expect(shown.blocks.map((block) => block.text)).toEqual([
      "hello",
      "hi",
      "continue",
      "done",
    ]);
    expect(clean).toBe(true);
    const writes = store.writes.length;
    // A snapshot taken before the refresh still cannot write its old copy.
    await windowB.upsertSession(inB);
    expect(store.writes.length).toBe(writes);
    // The refreshed copy saves as an identical rewrite.
    await windowB.upsertSession(shown);
    expect(storedTexts(store)).toEqual(["hello", "hi", "continue", "done"]);
    expect(store.rows.get("chat")!.revision).toBe(2);
  });

  it("reading the chat again does not license the open stale copy", async () => {
    const { windowB, inB } = await continueInA();
    // Something in B reads the stored chat (a preview, a search hit).
    await windowB.getSession("chat");
    await windowB.upsertSession(inB);
    expect(storedTexts(store)).toEqual(["hello", "hi", "continue", "done"]);
  });

  it("a later edit in the refreshed window is not undone by the merge", async () => {
    const { windowB, inB } = await continueInA();
    let shown = inB;
    windowB.subscribeSessionRebase((_, rebase) => {
      shown = rebase(shown).session;
    });
    await windowB.refreshStoredSession("chat", 2, () => shown);
    // B rewinds the last turn after adopting it.
    await windowB.upsertSession({ ...shown, blocks: shown.blocks.slice(0, 2) });
    expect(storedTexts(store)).toEqual(["hello", "hi"]);
  });
});
