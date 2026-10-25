// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  forgetStandingPrompt,
  loadStandingPrompt,
  planStandingPrompt,
  recordStandingPrompt,
  saveStandingPrompt,
  STANDING_PROMPT_CHANGE_EVENT,
  STANDING_PROMPT_MAX_CHARS,
  standingPromptContext,
  withStandingPrompt,
} from "./standingPrompt";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("standing prompt", () => {
  it("is empty by default and adds nothing", () => {
    expect(loadStandingPrompt()).toBe("");
    expect(standingPromptContext()).toBeUndefined();
    expect(withStandingPrompt()).toEqual({});
    expect(planStandingPrompt("s1", undefined)).toEqual({});
  });

  it("saves, caps and announces the text", () => {
    const heard: string[] = [];
    const listener = (event: Event) =>
      heard.push((event as CustomEvent<string>).detail);
    window.addEventListener(STANDING_PROMPT_CHANGE_EVENT, listener);
    saveStandingPrompt("x".repeat(STANDING_PROMPT_MAX_CHARS + 10));
    window.removeEventListener(STANDING_PROMPT_CHANGE_EVENT, listener);
    expect(loadStandingPrompt()).toHaveLength(STANDING_PROMPT_MAX_CHARS);
    expect(heard[0]).toHaveLength(STANDING_PROMPT_MAX_CHARS);
    saveStandingPrompt("   ");
    expect(localStorage.getItem("irgat.standingPrompt")).toBeNull();
  });

  it("wraps the text so the agent can tell it from the user's message", () => {
    saveStandingPrompt("  Answer in Turkish.  ");
    const context = standingPromptContext()!;
    expect(context.startsWith("<standing_prompt>\n")).toBe(true);
    expect(context).toContain("\n\nAnswer in Turkish.\n</standing_prompt>");
    expect(withStandingPrompt()).toEqual({ context });
  });

  it("hands the prompt once per provider conversation and again when it changes", () => {
    saveStandingPrompt("Answer in Turkish.");
    const first = planStandingPrompt("s1", undefined);
    expect(first.context).toBe(standingPromptContext());
    recordStandingPrompt("s1", "p1", first.version!);
    expect(planStandingPrompt("s1", "p1")).toEqual({});
    // A new provider conversation (rotation, restart) hears it again.
    expect(planStandingPrompt("s1", "p2").context).toBeDefined();
    expect(planStandingPrompt("s1", undefined).context).toBeDefined();
    // An edited resend rewinds the provider, so it is handed again.
    expect(planStandingPrompt("s1", "p1", { force: true }).context).toBeDefined();
    saveStandingPrompt("Answer in English.");
    expect(planStandingPrompt("s1", "p1").context).toContain("Answer in English.");
    // Other chats are independent.
    expect(planStandingPrompt("s2", "p9").context).toBeDefined();
  });

  it("forgets a deleted chat's receipt", () => {
    saveStandingPrompt("Be brief.");
    recordStandingPrompt("s1", "p1", planStandingPrompt("s1", undefined).version!);
    forgetStandingPrompt("s1");
    expect(planStandingPrompt("s1", "p1").context).toBeDefined();
  });
});
