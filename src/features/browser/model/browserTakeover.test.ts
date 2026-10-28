import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_ACTIVE_MS,
  agentActingNow,
  browserActionLabel,
  browserTakeover,
  noteBrowserAgentActing,
  setBrowserHeld,
  subscribeBrowserTakeover,
} from "./browserTakeover";

afterEach(() => setBrowserHeld(false));

describe("watching and taking over the Browser", () => {
  it("shows the agent using the page until it goes quiet", () => {
    const listener = vi.fn();
    const stop = subscribeBrowserTakeover(listener);
    noteBrowserAgentActing("chat-1", "browser.click", 1000);
    stop();
    expect(listener).toHaveBeenCalledTimes(1);
    const state = browserTakeover();
    expect(agentActingNow(state, 1000 + AGENT_ACTIVE_MS - 1)).toEqual({
      sessionId: "chat-1",
      action: "browser.click",
      at: 1000,
    });
    expect(agentActingNow(state, 1000 + AGENT_ACTIVE_MS)).toBeNull();
    expect(browserActionLabel("browser.click")).toBe("Clicking");
    expect(browserActionLabel("browser.future")).toBe("Using the page");
  });

  it("forgets the agent while the user holds the Browser", () => {
    noteBrowserAgentActing("chat-1", "browser.type", 1000);
    setBrowserHeld(true);
    expect(browserTakeover()).toEqual({ held: true, acting: null });
    noteBrowserAgentActing("chat-1", "browser.type", 1001);
    expect(agentActingNow(browserTakeover(), 1001)).toBeNull();
    setBrowserHeld(false);
    expect(browserTakeover().held).toBe(false);
  });
});
