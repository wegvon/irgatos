import { describe, expect, it } from "vitest";
import { newSession } from "./session";
import { textQuestion, textQuestionAnswer } from "./interactiveQuestion";
const session = (text: string) => ({
  ...newSession("codex", "/repo"),
  blocks: [{ id: "answer", role: "assistant" as const, text }],
});

describe("interactive questions for providers without a question tool", () => {
  it("renders numbered or lettered choices and sends the selected meaning", () => {
    for (const text of [
      "Boss, hangisi olsun?\n1. Hemen uygula\n2. Bekle",
      "Boss, hangisi olsun?\nA) Hemen uygula\nB) Bekle",
    ]) {
      const prompt = textQuestion(session(text))!;
      expect(prompt.questions[0].options).toEqual([
        { id: "1", label: "Hemen uygula" },
        { id: "2", label: "Bekle" },
      ]);
      expect(
        textQuestionAnswer(prompt, {
          kind: "answered",
          answers: { answer: ["2"] },
        }),
      ).toBe("Boss, hangisi olsun?\nBekle");
      expect(textQuestionAnswer(prompt, { kind: "skipped" })).toContain(
        "onay verdiğimi varsayma",
      );
    }
  });
  it("does not turn plans, code, credentials or answered questions into decisions", () => {
    expect(
      textQuestion(session("Yapılacaklar:\n1. Derle\n2. Test et")),
    ).toBeUndefined();
    expect(
      textQuestion(session("Parolan hangisi?\n1. A\n2. B")),
    ).toBeUndefined();
    expect(
      textQuestion(session("Örnek?\n```\n1. A\n2. B\n```")),
    ).toBeUndefined();
    expect(
      textQuestion({ ...session("Hangisi?\n1. A\n2. B"), busy: true }),
    ).toBeUndefined();
    const answered = session("Hangisi?\n1. A\n2. B");
    expect(
      textQuestion({
        ...answered,
        blocks: [...answered.blocks, { id: "reply", role: "user", text: "B" }],
      }),
    ).toBeUndefined();
  });
  it("retains custom answers and never replaces a native question", () => {
    const original = session("Hangisi?\n1. A\n2. B");
    const prompt = textQuestion(original)!;
    expect(
      textQuestionAnswer(prompt, {
        kind: "answered",
        answers: {},
        custom: { answer: "Daha sonra" },
      }),
    ).toContain("Daha sonra");
    expect(
      textQuestion({ ...original, pendingQuestion: prompt }),
    ).toBeUndefined();
  });
});
