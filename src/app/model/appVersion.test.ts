import { describe, expect, it } from "vitest";
import { formatVersion, shortCommit, shortVersion } from "./appVersion";

describe("app version display", () => {
  it.each([
    ["0.1.0", "v0.1.0", "v0.1"],
    ["v0.2.0", "v0.2.0", "v0.2"],
    ["0.1.3", "v0.1.3", "v0.1.3"],
    ["1.0.0-beta.1", "v1.0.0-beta.1", "v1.0.0-beta.1"],
    ["…", "…", "…"],
    ["", "…", "…"],
  ])("%s reads as %s, or %s in a badge", (input, full, short) => {
    expect(formatVersion(input)).toBe(full);
    expect(shortVersion(input)).toBe(short);
  });

  it("shortens commits to seven characters", () => {
    expect(shortCommit("89b88053a1966eae8b984d21441372041f5a7b63")).toBe("89b8805");
    expect(shortCommit(null)).toBeUndefined();
    expect(shortCommit(" ")).toBeUndefined();
  });
});
