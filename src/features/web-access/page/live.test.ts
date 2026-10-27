import { beforeEach, describe, expect, it, vi } from "vitest";

const writes: { action: string; body: Record<string, unknown> }[] = [];
const answer = vi.fn(async (body: Record<string, unknown>): Promise<unknown> => {
  if (body.op === "start")
    return {
      token: "auth_tokens/t",
      model: "models/live",
      voice: "Kore",
      localBargeIn: false,
      saveTranscript: true,
      instruction: "You are Ada.",
      memoryTool: true,
    };
  return { ok: true };
});
vi.mock("./client", () => ({
  quietWrite: async (action: string, body: Record<string, unknown>) => {
    writes.push({ action, body });
    return answer(body);
  },
  write: async (action: string, body: Record<string, unknown>) => {
    writes.push({ action, body });
    return answer(body);
  },
}));

const { phoneLiveController } = await import("./live");
const { liveUrl, LIVE_TOKEN_ENDPOINT } = await import(
  "../../voice/live/geminiLiveClient"
);

type Deps = {
  apiKey: (info: { id: string }) => Promise<string>;
  settings: () => Record<string, unknown>;
  instruction: () => Promise<{ text: string; memoryTool: boolean }>;
  tools: (info: { id: string }) => { remember?: unknown };
  host: () => { append: (id: string, block: unknown) => void };
};

beforeEach(() => {
  writes.length = 0;
});

describe("the phone's Live call", () => {
  it("asks the Mac for a token and instruction, then talks to Gemini with the token", async () => {
    const live = phoneLiveController();
    // The controller's own deps, as the call would use them.
    const deps = (live as unknown as { deps: Deps }).deps;
    expect(await deps.apiKey({ id: "chat" })).toBe("auth_tokens/t");
    expect(writes[0]).toEqual({ action: "live", body: { sessionId: "chat", op: "start" } });
    expect(deps.settings()).toEqual({
      model: "models/live",
      voice: "Kore",
      localBargeIn: false,
      saveTranscript: true,
    });
    expect(await deps.instruction()).toEqual({ text: "You are Ada.", memoryTool: true });
    expect(deps.tools({ id: "chat" }).remember).toBeTypeOf("function");
    deps.host().append("chat", {
      id: "b",
      role: "user",
      text: "Merhaba",
      liveVoice: { at: 1 },
    });
    expect(writes[1].body).toEqual({
      sessionId: "chat",
      op: "append",
      role: "user",
      text: "Merhaba",
      interrupted: false,
    });
    expect(liveUrl("auth_tokens/t")).toBe(
      `${LIVE_TOKEN_ENDPOINT}?access_token=auth_tokens%2Ft`,
    );
  });
});
