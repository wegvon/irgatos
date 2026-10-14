import { describe, expect, it } from "vitest";
import {
  dictationAnchor,
  restoreAnchor,
  spliceTranscript,
} from "./dictationText";

describe("dictationAnchor", () => {
  it("splits the draft around the selection", () => {
    expect(dictationAnchor("fix the bug now", 4, 7)).toEqual({
      before: "fix ",
      selected: "the",
      after: " bug now",
    });
  });

  it("clamps a selection past the end of the text", () => {
    expect(dictationAnchor("hi", 9, 12)).toEqual({
      before: "hi",
      selected: "",
      after: "",
    });
    expect(dictationAnchor("hi", 2, 1)).toEqual({
      before: "hi",
      selected: "",
      after: "",
    });
  });
});

describe("spliceTranscript", () => {
  it("fills an empty draft and puts the caret after the words", () => {
    expect(
      spliceTranscript(dictationAnchor("", 0, 0), " run the tests "),
    ).toEqual({ text: "run the tests", caret: 13 });
  });

  it("spaces dictated words from the text on both sides", () => {
    const anchor = dictationAnchor("Please and commit", 6, 6);
    expect(spliceTranscript(anchor, "run the tests")).toEqual({
      text: "Please run the tests and commit",
      caret: 20,
    });
  });

  it("keeps punctuation that follows the caret attached", () => {
    const anchor = dictationAnchor("Ship it.", 7, 7);
    expect(spliceTranscript(anchor, "today").text).toBe("Ship it today.");
  });

  it("does not double a space the draft already has", () => {
    const anchor = dictationAnchor("Then ", 5, 5);
    expect(spliceTranscript(anchor, "deploy").text).toBe("Then deploy");
  });

  it("applies every revision to the same anchor, so earlier guesses vanish", () => {
    const anchor = dictationAnchor("Note: ", 6, 6);
    spliceTranscript(anchor, "wreck a nice");
    expect(spliceTranscript(anchor, "recognize speech").text).toBe(
      "Note: recognize speech",
    );
  });

  it("replaces the selection, and an empty transcript leaves it out", () => {
    const anchor = dictationAnchor("use tabs here", 4, 8);
    expect(spliceTranscript(anchor, "spaces").text).toBe("use spaces here");
    expect(spliceTranscript(anchor, "  ")).toEqual({
      text: "use  here",
      caret: 4,
    });
  });
});

describe("restoreAnchor", () => {
  it("puts the draft and selection back as they were", () => {
    const anchor = dictationAnchor("use tabs here", 4, 8);
    expect(restoreAnchor(anchor)).toEqual({
      text: "use tabs here",
      selectionStart: 4,
      selectionEnd: 8,
    });
  });
});
