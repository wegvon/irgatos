import { describe, expect, it } from "vitest";
import { workspaceChatTarget } from "./chatTarget";

describe("workspaceChatTarget", () => {
  it("targets the active tab's session", () => {
    expect(
      workspaceChatTarget({
        tabId: "tab-1",
        activeTabId: "tab-1",
        activeSessionId: "session-1",
        irgatViewId: null,
      }),
    ).toBe("session-1");
  });

  it("leaves inactive tabs out", () => {
    expect(
      workspaceChatTarget({
        tabId: "tab-2",
        activeTabId: "tab-1",
        activeSessionId: "session-1",
        irgatViewId: null,
      }),
    ).toBeUndefined();
  });

  it("hands captures to an Irgat in full view instead of the hidden session", () => {
    expect(
      workspaceChatTarget({
        tabId: "tab-1",
        activeTabId: "tab-1",
        activeSessionId: "session-1",
        irgatViewId: "irgat-session",
      }),
    ).toBeUndefined();
  });
});
