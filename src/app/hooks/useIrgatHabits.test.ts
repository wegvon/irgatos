// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Habit } from "../../features/irgats/model/irgatHabits";
import type { Block, Session } from "../../features/sessions/model/session";

let stored: Habit[] = [];
let fileVersion = 0;
const IRGAT = {
  id: "irgat-1",
  sessionId: "irgat",
  mascot: "skull",
  color: "#fff",
  projects: ["/code/app"],
};

vi.mock("../../features/irgats/model/irgat", async (original) => ({
  ...(await original<object>()),
  listIrgats: () => [IRGAT],
  findIrgat: (id: string) => (id === IRGAT.id ? IRGAT : undefined),
  irgatLook: () => ({
    name: "Skull",
    mascot: "skull",
    color: "#fff",
    projects: [{ path: "/code/app", name: "app" }],
  }),
}));
vi.mock("../../features/irgats/model/irgatFiles", async (original) => {
  const actual =
    await original<typeof import("../../features/irgats/model/irgatFiles")>();
  return {
    ...actual,
    loadIrgatFiles: vi.fn(async () => ({
      id: "a",
      dir: "/data/irgats/a",
      soul: "Be brief.",
      soulHash: "s",
      memory: "",
      memoryHash: "m",
      memoryPath: "/data/irgats/a/MEMORY.md",
      topics: [],
    })),
    readAgentFile: vi.fn(async () => ({
      text: JSON.stringify(stored),
      hash: String(fileVersion),
    })),
    // Model the native store's atomic compare-and-save, including conflicts
    // between independent window schedulers.
    writeAgentFile: vi.fn(async (_irgatId, _path, text, expectedHash) => {
      if (expectedHash !== String(fileVersion))
        throw new actual.IrgatFileConflict();
      stored = JSON.parse(text) as Habit[];
      return String(++fileVersion);
    }),
  };
});

const { runCheck } = vi.hoisted(() => ({ runCheck: vi.fn() }));
vi.mock("../../features/sessions/model/completionGate", async (original) => ({
  ...(await original<object>()),
  runCheckCommand: (...args: unknown[]) => runCheck(...args),
}));

const { useIrgatHabits } = await import("./useIrgatHabits");
const { approveHabit } = await import(
  "../../features/irgats/model/habitGuards"
);
const { shouldPersistSession } =
  await import("../../features/sessions/data/sessionStore");
const {
  checkHabitsNow,
  habitRunSessionId,
  habitRunningSince,
  relayApproval,
  stopHabitRun,
} = await import("../../features/irgats/model/irgatHabits");
const { loadIrgatFiles } = await import("../../features/irgats/model/irgatFiles");

let root: Root;
let extraRoots: Root[] = [];
const originalWindow = window;
beforeEach(() => {
  fileVersion = 0;
  extraRoots = [];
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  vi.stubGlobal("window", originalWindow);
  act(() => root.unmount());
  for (const extra of extraRoots) act(() => extra.unmount());
  vi.unstubAllGlobals();
});

function setup(
  reply: string,
  approve?: { wait: Promise<void> },
  waitingHabit = false,
) {
  stored = [
    {
      id: "h1",
      name: "Morning CI check",
      instructions: "Tell me if CI is red.",
      schedule: {
        scheduleKind: "daily",
        time: "09:00",
        minute: 0,
        dayOfWeek: 1,
      },
      enabled: true,
      createdAt: 0,
      nextRunAt: Date.now() - 60_000,
    },
  ];
  if (waitingHabit)
    stored.push({ ...stored[0], id: "h2", name: "Waiting habit" });
  const host = makeHost(reply, approve);
  mountHost(host);
  return host;
}

function makeHost(reply: string, approve?: { wait: Promise<void> }) {
  const irgat = {
    id: "irgat",
    cwd: "/code/app",
    harness: "claude",
    model: "claude:x",
    blocks: [],
  } as unknown as Session;
  const sessions: Session[] = [irgat];
  const host = {
    sessions: () => sessions,
    open: vi.fn(async () => irgat),
    add: vi.fn((session: Session) => sessions.push(session)),
    run: vi.fn(async (id: string, prompt: string) => {
      const run = sessions.find((session) => session.id === id)!;
      if (approve) {
        run.blocks = [
          { id: "u", role: "user", text: prompt },
          {
            id: "ask",
            role: "approval",
            text: "",
            tool: { title: "git push" },
            approval: { requestId: 7 },
          },
        ];
        await approve.wait;
        run.blocks[1] = {
          ...run.blocks[1],
          approval: { requestId: 7, decided: "allow" },
        };
      }
      run.blocks = [
        ...run.blocks,
        { id: "u", role: "user", text: prompt },
        {
          id: "t",
          role: "assistant",
          text: "",
          tool: { title: "gh run list" },
        },
        { id: "a", role: "assistant", text: reply },
      ];
      return { status: "completed" as const, text: reply };
    }),
    remove: vi.fn(async () => {}),
    post: vi.fn(),
    // Like the app: the request is relayed, so later polls skip it.
    askApproval: vi.fn(
      (irgatId: string, _habit: Habit, runId: string, block: Block) =>
        relayApproval({
          irgatId,
          runId,
          requestId: block.approval!.requestId,
          blockId: "b",
        }),
    ),
    endApprovals: vi.fn(),
    respond: vi.fn(),
  };
  return host;
}

function mountHost(
  host: ReturnType<typeof makeHost>,
  target = root,
  surface = originalWindow,
) {
  function Probe() {
    useIrgatHabits(host);
    return null;
  }
  vi.stubGlobal("window", surface);
  act(() => target.render(createElement(Probe)));
  vi.stubGlobal("window", originalWindow);
}

/** Separate native windows have separate owner slots and share the file store. */
function isolatedWindow(): Window {
  let owner: unknown;
  return new Proxy(originalWindow, {
    get(target, key) {
      if (key === "__irgatHabitsScheduler") return owner;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (key === "__irgatHabitsScheduler") {
        owner = value;
        return true;
      }
      return Reflect.set(target, key, value);
    },
    deleteProperty(target, key) {
      if (key === "__irgatHabitsScheduler") {
        owner = undefined;
        return true;
      }
      return Reflect.deleteProperty(target, key);
    },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

it("runs a due habit in a hidden session and posts what it found", async () => {
  const host = setup("CI is red on main since #712.");
  await vi.waitFor(() => expect(host.post).toHaveBeenCalled());
  const [irgatId, habit, text, name] = host.post.mock.calls[0];
  expect([irgatId, habit.id, text, name]).toEqual([
    "irgat",
    "h1",
    "CI is red on main since #712.",
    "Skull",
  ]);
  const prompt = host.run.mock.calls[0][1] as string;
  expect(prompt.startsWith("/operator ")).toBe(true);
  expect(prompt).toContain("Habit: Morning CI check");
  const runId = host.add.mock.calls[0][0].id;
  // Nobody watches a habit's run, so it never stops to ask before each step.
  expect(host.add.mock.calls[0][0].runtimeMode).toBe("full-access");
  // Never saved, so it can never show up with the project's chats.
  expect(host.add.mock.calls[0][0].ephemeral).toBe(true);
  expect(shouldPersistSession(host.add.mock.calls[0][0])).toBe(false);
  expect(host.endApprovals).toHaveBeenCalledWith(runId);
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("posted"));
  expect(stored[0].runs?.[0]).toMatchObject({
    outcome: "posted",
    report: "CI is red on main since #712.",
  });
  expect(host.remove).toHaveBeenCalledWith(runId);
  expect(stored[0].nextRunAt).toBeGreaterThan(Date.now());
});

it("posts nothing when the run has nothing to say", async () => {
  const host = setup("NOTHING_TO_REPORT");
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("quiet"));
  expect(host.post).not.toHaveBeenCalled();
  expect(host.remove).toHaveBeenCalled();
});

it("lets a long-running habit finish and post after thirty minutes", async () => {
  vi.useFakeTimers();
  const hold = deferred();
  const host = setup("PR review complete.");
  const run = host.run.getMockImplementation()!;
  host.run.mockImplementationOnce(async (id, prompt) => {
    await hold.promise;
    return run(id, prompt);
  });
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    });
    expect(host.run).toHaveBeenCalledTimes(1);
    expect(host.remove).not.toHaveBeenCalled();
    expect(stored[0].lastOutcome).toBeUndefined();

    await act(async () => hold.resolve());
    expect(host.post).toHaveBeenCalledWith(
      "irgat",
      expect.objectContaining({ id: "h1" }),
      "PR review complete.",
      "Skull",
      [],
    );
    expect(stored[0].lastOutcome).toBe("posted");
    expect(host.remove).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => hold.resolve());
    vi.useRealTimers();
  }
});

it("stops and records a habit that is still running after one hour", async () => {
  vi.useFakeTimers();
  const hold = deferred();
  const host = setup("PR review complete.");
  host.run.mockImplementationOnce(async () => {
    await hold.promise;
    return { status: "completed", text: "PR review complete." };
  });
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 2_000);
    });
    expect(host.run).toHaveBeenCalledTimes(1);
    expect(host.remove).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(host.remove).toHaveBeenCalledTimes(1);
    expect(host.post).not.toHaveBeenCalled();
    expect(stored[0]).toMatchObject({
      lastOutcome: "failed",
      lastError: "It took too long and was stopped.",
    });
  } finally {
    await act(async () => hold.resolve());
    vi.useRealTimers();
  }
});

it(
  "puts an approval the run still asks for to the user, once",
  { timeout: 15_000 },
  async () => {
    let allow!: () => void;
    const wait = new Promise<void>((resolve) => (allow = resolve));
    const host = setup("Pushed the fix.", { wait });
    await vi.waitFor(() => expect(host.askApproval).toHaveBeenCalled(), {
      timeout: 5_000,
    });
    const [irgatId, habit, runId, block] = host.askApproval.mock.calls[0];
    expect([irgatId, habit.id, block.approval.requestId]).toEqual([
      "irgat",
      "h1",
      7,
    ]);
    expect(runId).toBe(host.add.mock.calls[0][0].id);
    // Still waiting on the user through the next poll: not asked again.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    allow();
    await vi.waitFor(() => expect(host.post).toHaveBeenCalled(), {
      timeout: 5_000,
    });
    expect(host.askApproval).toHaveBeenCalledTimes(1);
  },
);

it("starts a habit asked to run now without waiting for the next minute", async () => {
  const host = setup("CI is red.");
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("posted"));
  const scheduled = stored[0].nextRunAt;
  stored = [{ ...stored[0], runRequested: true }];
  checkHabitsNow();
  await vi.waitFor(() => expect(host.run).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(stored[0].runs).toHaveLength(2));
  expect(stored[0].runRequested).toBeUndefined();
  expect(stored[0].nextRunAt).toBe(scheduled);
});

it("launches a due habit only once across independent window schedulers", async () => {
  const first = setup("NOTHING_TO_REPORT");
  const second = makeHost("NOTHING_TO_REPORT");
  const extra = createRoot(document.createElement("div"));
  extraRoots.push(extra);
  mountHost(second, extra, isolatedWindow());
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("quiet"));
  await act(async () => {});
  expect(first.run.mock.calls.length + second.run.mock.calls.length).toBe(1);
  expect(stored[0].runs).toHaveLength(1);
});

it.each(["removed", "paused", "rescheduled"] as const)(
  "does not launch a waiting habit that was %s during an earlier run",
  async (change) => {
    const hold = deferred();
    const host = setup("NOTHING_TO_REPORT", undefined, true);
    host.run.mockImplementationOnce(async () => {
      await hold.promise;
      return { status: "completed", text: "NOTHING_TO_REPORT" };
    });
    try {
      await vi.waitFor(() => expect(host.run).toHaveBeenCalledTimes(1));
      stored = stored.flatMap((habit) => {
        if (habit.id !== "h2") return [habit];
        if (change === "removed") return [];
        return [
          {
            ...habit,
            ...(change === "paused"
              ? { enabled: false }
              : { nextRunAt: Date.now() + 60_000 }),
          },
        ];
      });
      fileVersion++;
    } finally {
      hold.resolve();
    }
    await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("quiet"));
    await act(async () => {});
    expect(host.run).toHaveBeenCalledTimes(1);
  },
);

it("rechecks a habit removed while its files were being prepared", async () => {
  const hold = deferred();
  const load = vi.mocked(loadIrgatFiles);
  const files = await load(IRGAT.id);
  load.mockImplementationOnce(async () => {
    await hold.promise;
    return files;
  });
  const host = setup("NOTHING_TO_REPORT");
  try {
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    stored = [];
    fileVersion++;
  } finally {
    hold.resolve();
  }
  await act(async () => {});
  expect(host.run).not.toHaveBeenCalled();
  expect(host.add).not.toHaveBeenCalled();
});

it("uses a waiting habit's latest instructions when it launches", async () => {
  const hold = deferred();
  const host = setup("NOTHING_TO_REPORT", undefined, true);
  host.run.mockImplementationOnce(async () => {
    await hold.promise;
    return { status: "completed", text: "NOTHING_TO_REPORT" };
  });
  try {
    await vi.waitFor(() => expect(host.run).toHaveBeenCalledTimes(1));
    stored = stored.map((habit) =>
      habit.id === "h2"
        ? { ...habit, instructions: "Inspect only the release branch." }
        : habit,
    );
    fileVersion++;
  } finally {
    hold.resolve();
  }
  await vi.waitFor(() => expect(host.run).toHaveBeenCalledTimes(2));
  expect(host.run.mock.calls[1][1]).toContain(
    "Inspect only the release branch.",
  );
  await vi.waitFor(() => expect(stored[1].lastOutcome).toBe("quiet"));
});

function setupGuarded(guards: Partial<Habit>, reply = "NOTHING_TO_REPORT") {
  stored = [
    {
      id: "h1",
      name: "Guarded",
      instructions: "Check the deploy.",
      schedule: { scheduleKind: "daily", time: "09:00", minute: 0, dayOfWeek: 1 },
      enabled: true,
      createdAt: 0,
      nextRunAt: Date.now() - 60_000,
      ...guards,
    },
  ];
  const host = makeHost(reply);
  mountHost(host);
  return host;
}

it("skips a run whose shell condition fails, without starting a session", async () => {
  runCheck.mockResolvedValueOnce({
    status: "failed",
    exitCode: 1,
    output: "no READY file",
    truncated: 0,
    durationMs: 3,
  });
  const host = setupGuarded({
    ifCondition: { kind: "shell", command: "test -f READY" },
  });
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("skipped"));
  expect(runCheck).toHaveBeenCalledWith("/code/app", "test -f READY", 60_000);
  expect(stored[0].runs?.[0].reason).toContain("no READY file");
  expect(stored[0].nextRunAt).toBeGreaterThan(Date.now());
  expect(host.add).not.toHaveBeenCalled();
});

it("runs once a shell condition passes", async () => {
  runCheck.mockResolvedValueOnce({
    status: "passed",
    exitCode: 0,
    output: "",
    truncated: 0,
    durationMs: 3,
  });
  const host = setupGuarded({
    ifCondition: { kind: "shell", command: "test -f READY" },
  });
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("quiet"));
  expect(host.run).toHaveBeenCalledTimes(1);
});

it("fails a run whose condition cannot be checked", async () => {
  const host = setupGuarded({
    ifCondition: { kind: "expression", expression: "weather.sunny" },
  });
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("failed"));
  expect(stored[0].lastError).toContain('Unknown name "weather"');
  expect(host.add).not.toHaveBeenCalled();
});

it("waits for approval, then runs once approved", async () => {
  const host = setupGuarded({
    requestApproval: true,
    ifCondition: { kind: "expression", expression: "runs.count == 0" },
  });
  await vi.waitFor(() => expect(stored[0].approval?.state).toBe("pending"));
  expect(stored[0].runRequested).toBe(true);
  // Another check while it waits does nothing.
  await act(async () => checkHabitsNow());
  expect(host.add).not.toHaveBeenCalled();

  stored = stored.map((habit) => approveHabit(habit));
  fileVersion++;
  await act(async () => checkHabitsNow());
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("quiet"));
  expect(host.run).toHaveBeenCalledTimes(1);
  expect(stored[0].approval).toBeUndefined();
  expect(stored[0].runRequested).toBeUndefined();
});

it("drops a run nobody approved in time", async () => {
  const host = setupGuarded({
    requestApproval: true,
    runRequested: true,
    approval: {
      state: "pending",
      requestedAt: Date.now() - 13 * 60 * 60 * 1000,
    },
  });
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("skipped"));
  expect(stored[0].runs?.[0].reason).toBe("Nobody approved it in time.");
  expect(host.add).not.toHaveBeenCalled();
});

it("waits out the delay before running", async () => {
  const host = setupGuarded({ delaySeconds: 1 });
  await vi.waitFor(() => expect(stored[0].delayedUntil).toBeDefined());
  expect(host.add).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("quiet"), {
    timeout: 3_000,
  });
  expect(host.run).toHaveBeenCalledTimes(1);
  expect(stored[0].delayedUntil).toBeUndefined();
});

it("hands a webhook payload to the run", async () => {
  const host = setupGuarded({
    enabled: true,
    nextRunAt: Date.now() + 3_600_000,
    runRequested: true,
    trigger: { source: "webhook", at: Date.now(), payload: "build 42 failed" },
    ifCondition: {
      kind: "expression",
      expression: 'trigger.payload contains "failed"',
    },
  });
  await vi.waitFor(() => expect(host.run).toHaveBeenCalledTimes(1));
  expect(host.run.mock.calls[0][1]).toContain(
    "<trigger_payload>\nbuild 42 failed\n</trigger_payload>",
  );
  await vi.waitFor(() => expect(stored[0].lastOutcome).toBe("quiet"));
  expect(stored[0].trigger).toBeUndefined();
});

it("stops a run the user asks to stop and records it as stopped", async () => {
  vi.useFakeTimers();
  const hold = deferred();
  const host = setup("PR review complete.");
  host.run.mockImplementationOnce(async () => {
    await hold.promise;
    return { status: "completed", text: "PR review complete." };
  });
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(host.run).toHaveBeenCalledTimes(1);
    const runId = host.add.mock.calls[0][0].id;
    expect(habitRunSessionId("h1")).toBe(runId);

    stopHabitRun("h1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(host.remove).toHaveBeenCalledWith(runId);
    expect(host.post).not.toHaveBeenCalled();
    expect(stored[0]).toMatchObject({ lastOutcome: "skipped" });
    expect(stored[0].runs?.[0]).toMatchObject({
      outcome: "skipped",
      reason: "You stopped this run.",
    });
    expect(habitRunningSince("h1")).toBeUndefined();
    expect(habitRunSessionId("h1")).toBeUndefined();
  } finally {
    await act(async () => hold.resolve());
    vi.useRealTimers();
  }
});
