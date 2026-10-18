import { describe, expect, it } from "vitest";
import { hiddenKindLabel, hiddenTextNotice } from "./hiddenText";
import type { MailHiddenPart } from "./mail";

const part = (
  kind: MailHiddenPart["kind"],
  suspicious: boolean,
): MailHiddenPart => ({ kind, text: "x", suspicious });

describe("hiddenTextNotice", () => {
  it("says nothing for a message without hidden text", () => {
    expect(hiddenTextNotice([])).toBeNull();
    expect(hiddenTextNotice(undefined)).toBeNull();
  });

  it("warns when any hiding trick looks aimed at an assistant", () => {
    for (const kind of [
      "comment",
      "invisibleStyle",
      "invisibleCharacters",
      "base64",
    ] as const) {
      const notice = hiddenTextNotice([
        part("invisibleStyle", false),
        part(kind, true),
      ]);
      expect(notice?.warning).toBe(true);
      expect(notice?.text).toMatch(/AI assistant/);
    }
  });

  it("notes routine hidden text quietly", () => {
    expect(hiddenTextNotice([part("invisibleStyle", false)])).toEqual({
      warning: false,
      text: "Hidden text removed (1 part). Agents don't see it.",
    });
    expect(
      hiddenTextNotice([part("comment", false), part("comment", false)])?.text,
    ).toMatch(/2 parts/);
  });

  it("labels each kind", () => {
    expect(hiddenKindLabel("base64")).toBe("Encoded text");
    expect(hiddenKindLabel("comment")).toBe("HTML comment");
  });
});
