// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Habit } from "./irgatHabits";

const files = new Map<string, { text: string; hash: number }>();
const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("./irgatFiles", async (original) => {
  const actual = await original<typeof import("./irgatFiles")>();
  return {
    ...actual,
    readAgentFile: vi.fn(async (irgatId: string) => {
      const file = files.get(irgatId);
      return { text: file?.text ?? null, hash: String(file?.hash ?? 0) };
    }),
    writeAgentFile: vi.fn(async (irgatId: string, _path, text: string) => {
      const hash = (files.get(irgatId)?.hash ?? 0) + 1;
      files.set(irgatId, { text, hash });
      return String(hash);
    }),
  };
});

const {
  fireHabitWebhook,
  habitWebhookInfo,
  habitWebhookTokens,
  subscribeHabitWebhookInfo,
  syncHabitWebhook,
} = await import("./habitWebhook");
const { parseHabits } = await import("./irgatHabits");
const { writeAgentFile } = await import("./irgatFiles");

const TOKEN = "t".repeat(32);

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    name: "Deploy watch",
    instructions: "Check the deploy.",
    schedule: { scheduleKind: "daily", minute: 0, time: "09:00", dayOfWeek: 1 },
    enabled: true,
    createdAt: 0,
    nextRunAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

function store(irgatId: string, habits: Habit[]) {
  files.set(irgatId, { text: JSON.stringify(habits), hash: 1 });
}

beforeEach(() => {
  files.clear();
  invoke.mockReset();
  vi.mocked(writeAgentFile).mockClear();
});

describe("habitWebhookTokens", () => {
  it("lists tokens of enabled habits only", () => {
    expect(
      habitWebhookTokens([
        habit({ triggerToken: TOKEN }),
        habit({ id: "h2", triggerToken: "p".repeat(32), enabled: false }),
        habit({ id: "h3" }),
      ]),
    ).toEqual([TOKEN]);
  });
});

describe("syncHabitWebhook", () => {
  it("passes unique sorted tokens and publishes the port", async () => {
    invoke.mockResolvedValueOnce({ port: 47615, error: null });
    const changed = vi.fn();
    const stop = subscribeHabitWebhookInfo(changed);
    await syncHabitWebhook(["b".repeat(30), "a".repeat(30), "b".repeat(30)]);
    expect(invoke).toHaveBeenCalledWith("habit_webhook_sync", {
      tokens: ["a".repeat(30), "b".repeat(30)],
    });
    expect(habitWebhookInfo()).toEqual({ port: 47615, error: null });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reports a listener that could not start", async () => {
    invoke.mockRejectedValueOnce(new Error("address in use"));
    expect(await syncHabitWebhook([TOKEN])).toEqual({
      port: null,
      error: "address in use",
    });
  });
});

describe("fireHabitWebhook", () => {
  it("requests a run of the habit holding the token, with its payload", async () => {
    store("other", [habit({ id: "x" })]);
    store("mine", [habit({ triggerToken: TOKEN })]);
    const checks = vi.fn();
    window.addEventListener("irgat:irgat-habits-check-now", checks);
    expect(
      await fireHabitWebhook(
        { token: TOKEN, payload: '{"env":"prod"}', receivedAt: 1_000 },
        ["other", "mine"],
      ),
    ).toBe(true);
    const [fired] = parseHabits(files.get("mine")!.text);
    expect(fired.runRequested).toBe(true);
    expect(fired.trigger).toEqual({
      source: "webhook",
      at: 1_000,
      payload: '{"env":"prod"}',
    });
    // Only the Irgat that owns the token is written.
    expect(vi.mocked(writeAgentFile)).toHaveBeenCalledTimes(1);
    expect(checks).toHaveBeenCalledTimes(1);
    window.removeEventListener("irgat:irgat-habits-check-now", checks);
  });

  it("ignores a paused habit and an unknown token", async () => {
    store("mine", [habit({ triggerToken: TOKEN, enabled: false })]);
    expect(
      await fireHabitWebhook({ token: TOKEN, receivedAt: 1 }, ["mine"]),
    ).toBe(false);
    expect(
      await fireHabitWebhook({ token: "u".repeat(32), receivedAt: 1 }, [
        "mine",
      ]),
    ).toBe(false);
    expect(parseHabits(files.get("mine")!.text)[0].runRequested).toBeUndefined();
  });
});
