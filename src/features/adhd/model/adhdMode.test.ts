// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADHD_COMMAND,
  ADHD_COMMAND_USAGE,
  ADHD_SETTINGS_DEFAULTS,
  adhdChatOverride,
  adhdEnabledFor,
  applyAdhdCommand,
  clearAdhdChatOverrides,
  forgetAdhdChat,
  loadAdhdState,
  parseAdhdCommand,
  planAdhdContext,
  recordAdhdContext,
  saveAdhdSettings,
  setAdhdForChat,
  subscribeAdhdState,
  toggleAdhdMode,
} from "./adhdMode";
import { adhdDisabledContext, adhdRulesContext } from "./adhdRules";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("ADHD mode settings", () => {
  it("starts off, with the status bar switch and next step shown", () => {
    expect(loadAdhdState()).toEqual({ ...ADHD_SETTINGS_DEFAULTS, chats: {} });
    expect(ADHD_SETTINGS_DEFAULTS).toEqual({
      enabled: false,
      showInStatusBar: true,
      showFocus: true,
    });
  });

  it("persists across reloads and returns a stable snapshot between changes", () => {
    saveAdhdSettings({ enabled: true, showFocus: false });
    const first = loadAdhdState();
    expect(loadAdhdState()).toBe(first);
    expect(JSON.parse(localStorage.getItem("irgat.adhdMode")!)).toEqual({
      enabled: true,
      showInStatusBar: true,
      showFocus: false,
      chats: {},
    });
    expect(first.enabled).toBe(true);
  });

  it("ignores damaged or mistyped storage", () => {
    localStorage.setItem("irgat.adhdMode", "{not json");
    expect(loadAdhdState().enabled).toBe(false);
    localStorage.setItem(
      "irgat.adhdMode",
      JSON.stringify({ enabled: "yes", chats: { a: true, b: "no" } }),
    );
    expect(loadAdhdState()).toEqual({
      ...ADHD_SETTINGS_DEFAULTS,
      chats: { a: true },
    });
  });

  it("notifies subscribers in this window and from other windows", () => {
    const listener = vi.fn();
    const stop = subscribeAdhdState(listener);
    saveAdhdSettings({ enabled: true });
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "irgat.adhdMode" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    saveAdhdSettings({ enabled: false });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("lets a chat differ from the always-on switch until the switch flips", () => {
    saveAdhdSettings({ enabled: true });
    setAdhdForChat("a", false);
    expect(adhdEnabledFor("a")).toBe(false);
    expect(adhdEnabledFor("b")).toBe(true);
    expect(adhdEnabledFor(undefined)).toBe(true);
    expect(adhdChatOverride("a")).toBe(false);
    // Matching the switch again is not an exception.
    setAdhdForChat("a", true);
    expect(adhdChatOverride("a")).toBeUndefined();

    setAdhdForChat("a", false);
    saveAdhdSettings({ showFocus: false });
    expect(adhdChatOverride("a")).toBe(false);
    saveAdhdSettings({ enabled: false });
    expect(loadAdhdState().chats).toEqual({});
  });

  it("toggles from the status bar relative to what the open chat shows", () => {
    saveAdhdSettings({ enabled: true });
    setAdhdForChat("paused", false);
    toggleAdhdMode("paused");
    expect(loadAdhdState()).toMatchObject({ enabled: true, chats: {} });
    toggleAdhdMode("paused");
    expect(loadAdhdState().enabled).toBe(false);
    toggleAdhdMode();
    expect(loadAdhdState().enabled).toBe(true);
  });

  it("clears every per-chat exception", () => {
    setAdhdForChat("a", true);
    setAdhdForChat("b", true);
    clearAdhdChatOverrides();
    expect(loadAdhdState().chats).toEqual({});
  });
});

describe("ADHD mode commands", () => {
  it("parses the upstream command, its arguments and the /adhd alias", () => {
    expect(parseAdhdCommand("/i-have-adhd")).toEqual({ action: "toggle" });
    expect(parseAdhdCommand("  /I-HAVE-ADHD  ")).toEqual({ action: "toggle" });
    expect(parseAdhdCommand("/i-have-adhd on")).toEqual({ action: "on" });
    expect(parseAdhdCommand("/adhd off")).toEqual({ action: "off" });
    expect(parseAdhdCommand("/i-have-adhd stop")).toEqual({ action: "off" });
    expect(parseAdhdCommand("/adhd kapat")).toEqual({ action: "off" });
    expect(parseAdhdCommand("/i-have-adhd maybe")).toEqual({
      action: "usage",
    });
  });

  it("recognizes stop phrases only when they are the whole message", () => {
    for (const text of [
      "stop adhd mode",
      "Stop ADHD mode.",
      "normal mode!",
      "  normal   mode ",
      "ADHD modunu kapat",
      "normal mod",
    ])
      expect(parseAdhdCommand(text), text).toEqual({
        action: "off",
        phrase: true,
      });
    expect(parseAdhdCommand("please stop adhd mode later")).toBeNull();
    expect(parseAdhdCommand("/i-have-adhdx")).toBeNull();
    expect(parseAdhdCommand("fix the build")).toBeNull();
  });

  it("applies commands to one chat and confirms like upstream", () => {
    expect(applyAdhdCommand("a", { action: "on" })).toContain(
      "ADHD mode on for this chat",
    );
    expect(adhdEnabledFor("a")).toBe(true);
    expect(adhdEnabledFor("b")).toBe(false);
    expect(applyAdhdCommand("a", { action: "toggle" })).toBe(
      "ADHD mode disabled.",
    );
    expect(adhdEnabledFor("a")).toBe(false);
    expect(applyAdhdCommand("a", { action: "usage" })).toBe(
      ADHD_COMMAND_USAGE,
    );
  });

  it("lets a stop phrase through to the agent while the mode is off", () => {
    expect(applyAdhdCommand("a", { action: "off", phrase: true })).toBeNull();
    saveAdhdSettings({ enabled: true });
    expect(applyAdhdCommand("a", { action: "off", phrase: true })).toBe(
      "ADHD mode disabled.",
    );
    expect(adhdEnabledFor("a")).toBe(false);
    expect(adhdEnabledFor("b")).toBe(true);
  });

  it("lists the command under its upstream name", () => {
    expect(ADHD_COMMAND).toMatchObject({
      kind: "builtin",
      name: "i-have-adhd",
      invocation: "i-have-adhd",
      source: "irgat",
    });
  });
});

describe("ADHD mode context", () => {
  it("hands the rules to a new conversation once", () => {
    const first = planAdhdContext("s", undefined, true);
    expect(first).toEqual({ context: adhdRulesContext(), state: "on" });
    recordAdhdContext("s", "p1", "on");
    expect(planAdhdContext("s", "p1", true)).toEqual({});
  });

  it("matches a receipt made before the provider id arrived", () => {
    recordAdhdContext("s", undefined, "on");
    expect(planAdhdContext("s", "p1", true)).toEqual({});
  });

  it("hands the rules again to a fresh provider conversation", () => {
    recordAdhdContext("s", "p1", "on");
    expect(planAdhdContext("s", "p2", true).state).toBe("on");
    expect(planAdhdContext("s", undefined, true).state).toBe("on");
  });

  it("hands them again when an edited turn replaces the last one", () => {
    recordAdhdContext("s", "p1", "on");
    expect(planAdhdContext("s", "p1", true, { force: true }).state).toBe("on");
  });

  it("resends when the ruleset changed since it was handed over", () => {
    localStorage.setItem(
      "irgat.adhdMode.handed",
      JSON.stringify({ s: { provider: "p1", state: "on", version: "old" } }),
    );
    expect(planAdhdContext("s", "p1", true).state).toBe("on");
  });

  it("tells a conversation that saw the rules once that they are off", () => {
    recordAdhdContext("s", "p1", "on");
    expect(planAdhdContext("s", "p1", false)).toEqual({
      context: adhdDisabledContext(),
      state: "off",
    });
    recordAdhdContext("s", "p1", "off");
    expect(planAdhdContext("s", "p1", false)).toEqual({});
    expect(planAdhdContext("s", "p1", true).state).toBe("on");
  });

  it("says nothing to conversations that never had the rules", () => {
    expect(planAdhdContext("s", "p1", false)).toEqual({});
    recordAdhdContext("s", "p1", "on");
    expect(planAdhdContext("s", "p2", false)).toEqual({});
  });

  it("forgets a deleted chat's choice and receipt", () => {
    saveAdhdSettings({ enabled: true });
    setAdhdForChat("s", false);
    recordAdhdContext("s", "p1", "on");
    recordAdhdContext("t", "p2", "on");
    forgetAdhdChat("s");
    expect(adhdChatOverride("s")).toBeUndefined();
    expect(planAdhdContext("s", "p1", true).state).toBe("on");
    expect(planAdhdContext("t", "p2", true)).toEqual({});
  });
});
