import { expect, it } from "vitest";
import { decodeKey } from "./push";

it("decodes the Mac's URL-safe key", () => {
  expect([...decodeKey("BAEC_-8")]).toEqual([4, 1, 2, 255, 239]);
});
