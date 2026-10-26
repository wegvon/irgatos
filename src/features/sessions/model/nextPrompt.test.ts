// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/voice", () => ({
  suggestNextPrompt: vi.fn(),
}));

import {
  dismissNextPrompt,
  isNextPromptDismissed,
  nextPromptFor,
  resetNextPrompts,
} from "./nextPrompt";
import { saveNextPromptSuggestions } from "../../settings/model/displayPrefs";

beforeEach(() => {
  localStorage.clear();
  resetNextPrompts();
});

describe("nextPromptFor", () => {
  it("asks once per reply and shares the answer", async () => {
    const suggest = vi.fn(async () => "run the tests");
    const reply = { id: "a1", text: "Done.", prompts: ["fix it"] };
    const first = nextPromptFor(reply, "s1", suggest);
    const second = nextPromptFor({ ...reply }, "s1", suggest);
    expect(await first).toBe("run the tests");
    expect(await second).toBe("run the tests");
    expect(suggest).toHaveBeenCalledExactlyOnceWith("Done.", ["fix it"], "s1");
  });

  it("is nothing when suggestions are off or the call fails", async () => {
    saveNextPromptSuggestions(false);
    const suggest = vi.fn(async () => "x");
    expect(
      await nextPromptFor({ id: "a1", text: "Done." }, "s1", suggest),
    ).toBe(null);
    expect(suggest).not.toHaveBeenCalled();

    saveNextPromptSuggestions(true);
    const failing = vi.fn(async (): Promise<string | null> => {
      throw new Error("offline");
    });
    expect(
      await nextPromptFor({ id: "a2", text: "Done." }, "s1", failing),
    ).toBe(null);
  });

  it("remembers what was dismissed", () => {
    expect(isNextPromptDismissed("a1")).toBe(false);
    dismissNextPrompt("a1");
    expect(isNextPromptDismissed("a1")).toBe(true);
  });
});
