import { describe, expect, it } from "vitest";
import {
  ACTIVE_TURN_SNAPSHOT_MS,
  activeTurnSnapshotDue,
  PERSIST_DEBOUNCE_MS,
  PERSIST_MAX_WAIT_MS,
  persistDelay,
} from "./persistSchedule";

describe("persistDelay", () => {
  it("debounces a fresh change", () => {
    expect(persistDelay(undefined, 1_000)).toBe(PERSIST_DEBOUNCE_MS);
    expect(persistDelay(1_000, 1_000)).toBe(PERSIST_DEBOUNCE_MS);
  });

  it("shortens the wait as the oldest pending change nears the cap", () => {
    const since = 10_000;
    expect(persistDelay(since, since + PERSIST_MAX_WAIT_MS - 200)).toBe(200);
    expect(persistDelay(since, since + PERSIST_MAX_WAIT_MS)).toBe(0);
    expect(persistDelay(since, since + PERSIST_MAX_WAIT_MS + 5_000)).toBe(0);
  });

  it("saves a constant stream of changes at least once per cap", () => {
    let now = 0;
    let since: number | undefined;
    let saves = 0;
    let due = Infinity;
    // A change every 100ms resets the timer, as the persist effect does.
    for (; now <= 3 * PERSIST_MAX_WAIT_MS; now += 100) {
      if (now >= due) {
        saves += 1;
        since = undefined;
      }
      since ??= now;
      due = now + persistDelay(since, now);
    }
    expect(saves).toBeGreaterThanOrEqual(2);
  });
});

describe("activeTurnSnapshotDue", () => {
  it("snapshots a turn first seen running, then once per interval", () => {
    expect(activeTurnSnapshotDue(undefined, 5)).toBe(true);
    expect(
      activeTurnSnapshotDue(1_000, 1_000 + ACTIVE_TURN_SNAPSHOT_MS - 1),
    ).toBe(false);
    expect(activeTurnSnapshotDue(1_000, 1_000 + ACTIVE_TURN_SNAPSHOT_MS)).toBe(
      true,
    );
    expect(activeTurnSnapshotDue(0, 50, 50)).toBe(true);
  });
});
