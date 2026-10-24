import { describe, expect, it } from "vitest";
import { standaloneHeightGap } from "./theme";

// iPhone 15 Pro: 393 x 852 points.
const phone = { screenWidth: 393, screenHeight: 852 };

describe("standaloneHeightGap", () => {
  it("adds back the status bar iOS leaves out on the Home Screen", () => {
    expect(
      standaloneHeightGap({
        ...phone,
        standalone: true,
        innerWidth: 393,
        innerHeight: 793,
      }),
    ).toBe(59);
  });

  it("does nothing in Safari", () => {
    expect(
      standaloneHeightGap({
        ...phone,
        standalone: false,
        innerWidth: 393,
        innerHeight: 659,
      }),
    ).toBe(0);
  });

  it("does nothing when the window already fills the screen", () => {
    expect(
      standaloneHeightGap({
        ...phone,
        standalone: true,
        innerWidth: 393,
        innerHeight: 852,
      }),
    ).toBe(0);
  });

  it("uses the long side as height in landscape", () => {
    expect(
      standaloneHeightGap({
        ...phone,
        standalone: true,
        innerWidth: 852,
        innerHeight: 393,
      }),
    ).toBe(0);
  });

  it("ignores split view and large gaps", () => {
    const ipad = { screenWidth: 1024, screenHeight: 1366, standalone: true };
    expect(
      standaloneHeightGap({ ...ipad, innerWidth: 507, innerHeight: 1366 }),
    ).toBe(0);
    expect(
      standaloneHeightGap({ ...ipad, innerWidth: 1024, innerHeight: 1000 }),
    ).toBe(0);
  });
});
