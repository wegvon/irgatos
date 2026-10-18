import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { repoParts, takeNewRepos, type TrendingRepo } from "./trending";

const repo = (fullName: string): TrendingRepo => ({
  fullName,
  url: `https://github.com/${fullName}`,
  description: "",
  language: "",
  languageColor: "",
  stars: 0,
  forks: 0,
  periodStars: 0,
});

describe("trending repositories", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("marks repositories that joined the list since the last look", () => {
    expect(takeNewRepos("daily", "", [repo("a/one"), repo("b/two")]).size).toBe(
      0,
    );
    const fresh = takeNewRepos("daily", "", [repo("b/two"), repo("c/three")]);
    expect([...fresh]).toEqual(["c/three"]);
    // Each period and language keeps its own memory.
    expect(takeNewRepos("weekly", "", [repo("z/z")]).size).toBe(0);
    expect(takeNewRepos("daily", "rust", [repo("z/z")]).size).toBe(0);
    expect(
      takeNewRepos("daily", "", [repo("b/two"), repo("c/three")]).size,
    ).toBe(0);
  });

  it("splits owner and name", () => {
    expect(repoParts("owner/name")).toEqual({ owner: "owner", name: "name" });
    expect(repoParts("lonely")).toEqual({ owner: "", name: "lonely" });
  });
});
