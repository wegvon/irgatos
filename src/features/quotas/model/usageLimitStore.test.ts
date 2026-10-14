// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  holdAccountId,
  loadUsageLimitFallbackMinutes,
  saveUsageLimitFallbackMinutes,
  subscribeUsageLimitFallback,
  USAGE_LIMIT_FALLBACK_DEFAULT_MINUTES,
  USAGE_LIMIT_FALLBACK_OPTIONS,
} from "./usageLimitStore";

afterEach(() => localStorage.clear());

describe("fallback window setting", () => {
  it("defaults to an hour, one of the offered choices", () => {
    expect(loadUsageLimitFallbackMinutes()).toBe(60);
    expect(USAGE_LIMIT_FALLBACK_DEFAULT_MINUTES).toBe(60);
    expect(USAGE_LIMIT_FALLBACK_OPTIONS).toContain(60);
  });

  it("saves, reloads and announces the choice", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeUsageLimitFallback(onChange);
    saveUsageLimitFallbackMinutes(120);
    expect(loadUsageLimitFallbackMinutes()).toBe(120);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    saveUsageLimitFallbackMinutes(30);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores nonsense in storage", () => {
    localStorage.setItem("irgat.usageLimitFallbackMinutes", "-4");
    expect(loadUsageLimitFallbackMinutes()).toBe(60);
    localStorage.setItem("irgat.usageLimitFallbackMinutes", "banana");
    expect(loadUsageLimitFallbackMinutes()).toBe(60);
    localStorage.setItem("irgat.usageLimitFallbackMinutes", String(48 * 60));
    expect(loadUsageLimitFallbackMinutes()).toBe(60);
  });
});

describe("holdAccountId", () => {
  it("files single-login providers under the default account", () => {
    expect(holdAccountId("cursor", "work", "/tmp/project")).toBe("default");
  });

  it("uses the session's own profile, else the project's selection", () => {
    expect(holdAccountId("claude", "work", "/tmp/project")).toBe("work");
    expect(holdAccountId("claude", undefined, "/tmp/project")).toBe("default");
  });
});
