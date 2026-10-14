import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeResurfaced,
  EMPTY_INBOX_SNOOZES,
  formatSnoozeUntil,
  isResurfaced,
  loadInboxSnoozes,
  nextSnoozeExpiry,
  parseInboxSnoozes,
  resurfaceDue,
  saveInboxSnoozes,
  snoozeItem,
  snoozedUntil,
  snoozePresets,
  snoozePresetTime,
  startInboxSnoozeWatcher,
  unsnoozeItem,
  updateInboxSnoozes,
} from "./inboxSnooze";

const KEY = "irgat.inboxSnoozes";
const HOUR = 60 * 60 * 1000;

function installBrowser() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  vi.stubGlobal("window", new EventTarget());
  return data;
}

describe("snooze presets", () => {
  // A Wednesday afternoon, local time.
  const wednesday = new Date(2026, 9, 14, 15, 30);

  it("resolves each preset relative to now", () => {
    expect(snoozePresetTime("1h", wednesday)).toBe(wednesday.getTime() + HOUR);
    expect(snoozePresetTime("later-today", wednesday)).toBe(
      wednesday.getTime() + 4 * HOUR,
    );
    expect(new Date(snoozePresetTime("tomorrow", wednesday)!)).toEqual(
      new Date(2026, 9, 15, 9, 0),
    );
    expect(new Date(snoozePresetTime("next-week", wednesday)!)).toEqual(
      new Date(2026, 9, 19, 9, 0),
    );
  });

  it("moves next week a full week ahead on a Monday", () => {
    const monday = new Date(2026, 9, 19, 8, 0);
    expect(new Date(snoozePresetTime("next-week", monday)!)).toEqual(
      new Date(2026, 9, 26, 9, 0),
    );
  });

  it("labels presets with their resolved time", () => {
    const presets = snoozePresets(wednesday);
    expect(presets.map((preset) => preset.id)).toEqual([
      "1h",
      "later-today",
      "tomorrow",
      "next-week",
    ]);
    expect(presets[0].label).toMatch(/^In 1 hour \(today /);
    expect(presets[2].label).toMatch(/^Tomorrow morning \(tomorrow /);
    expect(presets.every((preset) => preset.until > wednesday.getTime())).toBe(
      true,
    );
  });

  it("formats the snooze end relative to today", () => {
    const now = wednesday.getTime();
    expect(formatSnoozeUntil(now + HOUR, now)).toMatch(/^today /);
    expect(formatSnoozeUntil(now + 20 * HOUR, now)).toMatch(/^tomorrow /);
    expect(formatSnoozeUntil(now + 6 * 24 * HOUR, now)).not.toMatch(
      /^(today|tomorrow)/,
    );
  });
});

describe("snooze state", () => {
  const now = 1_000_000;

  it("snoozes, unsnoozes and rejects past times", () => {
    const state = snoozeItem(EMPTY_INBOX_SNOOZES, "a", now + HOUR, now, {
      title: "Fix login",
      ref: "acme/web#1",
    });
    expect(snoozedUntil(state, "a", now)).toBe(now + HOUR);
    expect(snoozedUntil(state, "a", now + HOUR)).toBeUndefined();
    expect(state.snoozed.a).toMatchObject({ title: "Fix login", snoozedAt: now });
    expect(unsnoozeItem(state, "a").snoozed).toEqual({});
    expect(unsnoozeItem(state, "missing")).toBe(state);
    expect(() => snoozeItem(state, "b", now, now)).toThrow(/future/);
    expect(() => snoozeItem(state, "", now + 1, now)).toThrow();
  });

  it("snoozing a resurfaced item clears its badge", () => {
    const back = {
      snoozed: {},
      resurfaced: { a: { at: now } },
    };
    expect(isResurfaced(back, "a")).toBe(true);
    const again = snoozeItem(back, "a", now + HOUR, now);
    expect(isResurfaced(again, "a")).toBe(false);
    expect(acknowledgeResurfaced(back, "a").resurfaced).toEqual({});
    expect(acknowledgeResurfaced(again, "a")).toBe(again);
  });

  it("resurfaces only what is due, oldest first", () => {
    let state = snoozeItem(EMPTY_INBOX_SNOOZES, "late", now + 3 * HOUR, now);
    state = snoozeItem(state, "soon", now + HOUR, now, { title: "Soon" });
    state = snoozeItem(state, "sooner", now + HOUR / 2, now);
    expect(nextSnoozeExpiry(state)).toBe(now + HOUR / 2);
    const result = resurfaceDue(state, now + 2 * HOUR);
    expect(result.resurfaced.map((entry) => entry.key)).toEqual([
      "sooner",
      "soon",
    ]);
    expect(result.resurfaced[1]).toMatchObject({ title: "Soon", at: now + HOUR });
    expect(Object.keys(result.state.snoozed)).toEqual(["late"]);
    expect(Object.keys(result.state.resurfaced).sort()).toEqual([
      "soon",
      "sooner",
    ]);
    expect(resurfaceDue(result.state, now + 2 * HOUR).state).toBe(result.state);
  });

  it("drops malformed stored entries", () => {
    const parsed = parseInboxSnoozes(
      JSON.stringify({
        snoozed: {
          ok: { until: 5, snoozedAt: 1, title: "T" },
          bad: { until: "soon" },
          nul: null,
        },
        resurfaced: { back: { at: 3 }, broken: {} },
      }),
    );
    expect(Object.keys(parsed.snoozed)).toEqual(["ok"]);
    expect(Object.keys(parsed.resurfaced)).toEqual(["back"]);
    expect(parseInboxSnoozes("{")).toBe(EMPTY_INBOX_SNOOZES);
    expect(parseInboxSnoozes("[]").snoozed).toEqual({});
    expect(parseInboxSnoozes(null)).toBe(EMPTY_INBOX_SNOOZES);
  });
});

describe("snooze persistence and watcher", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = installBrowser();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("survives a reload through localStorage", () => {
    const now = Date.now();
    expect(
      updateInboxSnoozes((state) => snoozeItem(state, "x", now + HOUR, now)),
    ).toBe(true);
    expect(JSON.parse(data.get(KEY)!).snoozed.x.until).toBe(now + HOUR);
    data.set(KEY, data.get(KEY)!.replace('"x"', '"y"'));
    expect(Object.keys(loadInboxSnoozes().snoozed)).toEqual(["y"]);
  });

  it("resurfaces a snooze that came due while the app was closed", () => {
    const now = Date.now();
    data.set(
      KEY,
      JSON.stringify({
        snoozed: { gone: { until: now - 1, snoozedAt: now - HOUR, ref: "#9" } },
        resurfaced: {},
      }),
    );
    const onResurface = vi.fn();
    const stop = startInboxSnoozeWatcher(onResurface);
    expect(onResurface).toHaveBeenCalledWith([
      { key: "gone", at: now - 1, ref: "#9" },
    ]);
    expect(isResurfaced(loadInboxSnoozes(), "gone")).toBe(true);
    stop();
  });

  it("fires at the snooze time and follows new snoozes", () => {
    const now = Date.now();
    const onResurface = vi.fn();
    const stop = startInboxSnoozeWatcher(onResurface);
    expect(onResurface).not.toHaveBeenCalled();
    saveInboxSnoozes(snoozeItem(loadInboxSnoozes(), "a", now + HOUR, now));
    vi.advanceTimersByTime(HOUR - 1);
    expect(onResurface).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResurface).toHaveBeenCalledTimes(1);
    expect(onResurface.mock.calls[0][0][0].key).toBe("a");
    stop();
    saveInboxSnoozes(
      snoozeItem(loadInboxSnoozes(), "b", Date.now() + 1000, Date.now()),
    );
    vi.advanceTimersByTime(2000);
    expect(onResurface).toHaveBeenCalledTimes(1);
  });
});
