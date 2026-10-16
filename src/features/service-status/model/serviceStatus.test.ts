import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POLL_MS,
  chipText,
  createServiceStatusStore,
  overallState,
  serviceIds,
  stateLine,
  type ServiceStatus,
} from "./serviceStatus";

const status = (
  id: string,
  state: ServiceStatus["state"],
  extra: Partial<ServiceStatus> = {},
): ServiceStatus => ({
  id,
  host: `${id}.turel.se`,
  state,
  latencyMs: state === "offline" ? null : 120,
  detail: null,
  ...extra,
});

describe("serviceIds", () => {
  it("asks for the voice services only when they are in use", () => {
    expect(
      serviceIds({ engine: "qwen", readReplies: true, speechProvider: "ema" }),
    ).toEqual(["embed", "executor", "asr", "tts:ema"]);
    expect(
      serviceIds({ engine: "apple", readReplies: false, speechProvider: "drama" }),
    ).toEqual(["embed", "executor"]);
  });
});

describe("chip text", () => {
  it("stays short when everything answers and names what is down", () => {
    expect(chipText([status("embed", "online")])).toBe("Services");
    expect(chipText([status("embed", "offline"), status("asr", "slow")])).toBe(
      "Semantic search offline",
    );
    expect(
      chipText([status("embed", "offline"), status("executor", "offline")]),
    ).toBe("2 services offline");
    expect(chipText([status("tts:drama", "slow")])).toBe("Voice · Drama slow");
  });

  it("colors by the worst state", () => {
    expect(overallState([])).toBe("online");
    expect(overallState([status("a", "online"), status("b", "slow")])).toBe(
      "slow",
    );
    expect(overallState([status("a", "offline"), status("b", "slow")])).toBe(
      "offline",
    );
  });

  it("shows latency or why it is offline", () => {
    expect(stateLine(status("embed", "online"))).toBe("Online · 120 ms");
    expect(
      stateLine(status("embed", "offline", { detail: "HTTP 502" })),
    ).toBe("Offline · HTTP 502");
  });
});

describe("store", () => {
  afterEach(() => vi.useRealTimers());

  it("checks on first subscribe, polls each minute and stops when unused", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => [status("embed", "online")]);
    const store = createServiceStatusStore(check, () => ["embed"]);
    const stop = store.subscribe(() => {});
    await vi.waitFor(() => expect(store.get().checkedAt).not.toBeNull());
    expect(check).toHaveBeenCalledTimes(1);
    expect(store.get().statuses).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("keeps the last answer when a check fails", async () => {
    let fail = false;
    const check = vi.fn(async () => {
      if (fail) throw new Error("ipc");
      return [status("embed", "online")];
    });
    const store = createServiceStatusStore(check, () => ["embed"]);
    await store.refresh();
    fail = true;
    await store.refresh();
    expect(store.get().statuses).toHaveLength(1);
    expect(store.get().checking).toBe(false);
  });
});
