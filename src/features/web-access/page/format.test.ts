import { describe, expect, it } from "vitest";
import { ago, basename, dueLabel, duration, plural } from "./format";

describe("browser page text", () => {
  it("writes compact ages", () => {
    const now = 10 * 86_400_000;
    expect(ago(undefined, now)).toBe("");
    expect(ago(now - 20_000, now)).toBe("now");
    expect(ago(now - 4 * 60_000, now)).toBe("4m");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3h");
    expect(ago(now - 2 * 86_400_000, now)).toBe("2d");
    expect(ago(now + 60_000, now)).toBe("now");
  });

  it("writes turn durations", () => {
    expect(duration(12_400)).toBe("12s");
    expect(duration(250_000)).toBe("4m 10s");
    expect(duration(3_900_000)).toBe("1h 5m");
  });

  it("names due days relative to today", () => {
    const now = new Date(2026, 9, 16, 14).getTime();
    expect(dueLabel(new Date(2026, 9, 16, 9).getTime(), now)).toBe("Today");
    expect(dueLabel(new Date(2026, 9, 17, 23).getTime(), now)).toBe("Tomorrow");
    expect(dueLabel(new Date(2026, 9, 15, 1).getTime(), now)).toBe("Yesterday");
  });

  it("shortens paths and counts", () => {
    expect(basename("/Users/me/code/shop/")).toBe("shop");
    expect(basename("src/app/App.tsx")).toBe("App.tsx");
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(3, "file")).toBe("3 files");
  });
});
