import { beforeEach, expect, it, vi } from "vitest";
import { getIrgatTranscriptPage } from "../../sessions/data/sessionStore";
import { newSession, type Block } from "../../sessions/model/session";
import { readIrgatConversation } from "./irgatConversation";

vi.mock("../../sessions/data/sessionStore", () => ({
  getIrgatTranscriptPage: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
const turns = (start: number, count: number): Block[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `u${start + i}`,
    role: "user",
    text: `Question ${start + i}`,
  }));
const session = () => ({
  ...newSession("codex", "/tmp"),
  blocks: turns(20, 10),
  irgatTranscript: { before: 20, firstBlockId: "u20" },
});

it("reads the recent live exchanges without loading older history", async () => {
  const result = await readIrgatConversation(session(), {});
  expect(result.turns.map((turn) => turn.turnId)).toEqual([
    "u27",
    "u28",
    "u29",
  ]);
  expect(result.nextBefore).toBe("u27");
  expect(getIrgatTranscriptPage).not.toHaveBeenCalled();
});

it("reads archived cursors directly and retains a cursor beyond the loaded page", async () => {
  vi.mocked(getIrgatTranscriptPage).mockResolvedValue({
    blocks: turns(10, 3),
    before: 10,
    hasNewer: true,
  });
  const result = await readIrgatConversation(session(), { before: "u13" });
  expect(getIrgatTranscriptPage).toHaveBeenCalledWith(expect.any(String), {
    beforeBlockId: "u13",
  });
  expect(result.turns.map((turn) => turn.turnId)).toEqual([
    "u10",
    "u11",
    "u12",
  ]);
  expect(result.nextBefore).toBe("u10");
});

it("fills a page that crosses the edge of the writable window without mutating it", async () => {
  const current = session();
  vi.mocked(getIrgatTranscriptPage).mockResolvedValue({
    blocks: turns(10, 10),
    before: 10,
    hasNewer: true,
  });
  const result = await readIrgatConversation(current, { before: "u21" });
  expect(result.turns.map((turn) => turn.turnId)).toEqual([
    "u18",
    "u19",
    "u20",
  ]);
  expect(current.blocks).toHaveLength(10);
});

it("pages past habit-only windows and validates limits before fetching", async () => {
  const current = {
    ...session(),
    blocks: [
      { id: "habit", role: "assistant" as const, text: "Scheduled update" },
    ],
  };
  vi.mocked(getIrgatTranscriptPage).mockResolvedValue({
    blocks: turns(0, 3),
    before: null,
    hasNewer: true,
  });
  expect((await readIrgatConversation(current, {})).turns).toHaveLength(3);
  expect(getIrgatTranscriptPage).toHaveBeenCalledOnce();
  vi.clearAllMocks();
  await expect(
    readIrgatConversation(current, { before: "old", limit: 99 }),
  ).rejects.toThrow("limit");
  expect(getIrgatTranscriptPage).not.toHaveBeenCalled();
});
