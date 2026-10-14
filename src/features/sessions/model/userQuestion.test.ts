import { describe, expect, it } from "vitest";
import {
  CUSTOM_OPTION_ID,
  buildProxySessionInitBypassReply,
  buildQuestionReply,
  isProxySessionInitQuestions,
  questionAnswersComplete,
  questionIsComplete,
  questionPromptTitle,
  questionsFromUnknown,
  selectedAnswerLabels,
} from "./userQuestion";

describe("questionsFromUnknown", () => {
  it("parses Claude-style AskUserQuestion input", () => {
    const questions = questionsFromUnknown({
      questions: [
        {
          header: "Format",
          question: "How should I format the output?",
          multiSelect: false,
          options: [
            { label: "Summary", description: "Brief overview" },
            { label: "Detailed", description: "Full explanation" },
          ],
        },
        {
          header: "Sections",
          question: "Which sections should I include?",
          multiSelect: true,
          options: [
            { label: "Introduction" },
            { label: "Conclusion" },
          ],
        },
      ],
    });
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      prompt: "How should I format the output?",
      header: "Format",
      multiSelect: false,
      allowCustom: true,
    });
    expect(questions[1]?.multiSelect).toBe(true);
    expect(questionPromptTitle(questions)).toBe("Format");
  });

  it("parses Cursor-style ask_question params without adding Other", () => {
    const questions = questionsFromUnknown({
      title: "Need input",
      questions: [
        {
          id: "q1",
          prompt: "Which mode should I use?",
          allowMultiple: true,
          options: [
            { id: "agent", label: "Agent" },
            { id: "plan", label: "Plan" },
          ],
        },
      ],
    });
    expect(questions[0]).toMatchObject({
      id: "q1",
      prompt: "Which mode should I use?",
      multiSelect: true,
      allowCustom: false,
    });
    expect(questions[0]?.options.map((option) => option.id)).toEqual([
      "agent",
      "plan",
    ]);
  });

  it("honors OpenCode custom/multiple flags", () => {
    const questions = questionsFromUnknown({
      questions: [
        {
          question: "Pick a name",
          multiple: false,
          custom: false,
          options: [{ label: "Alpha" }],
        },
      ],
    });
    expect(questions[0]).toMatchObject({
      prompt: "Pick a name",
      multiSelect: false,
      allowCustom: false,
    });
  });
});

describe("question answers", () => {
  const questions = questionsFromUnknown({
    questions: [
      {
        question: "Which file?",
        options: [{ label: "a.ts" }, { label: "b.ts" }],
      },
    ],
  });
  const question = questions[0]!;

  it("requires a selection before continue", () => {
    expect(questionAnswersComplete(questions, {}, {})).toBe(false);
    expect(
      questionAnswersComplete(questions, { [question.id]: ["a.ts"] }, {}),
    ).toBe(true);
  });

  it("requires custom text when Other is selected", () => {
    expect(
      questionAnswersComplete(
        questions,
        { [question.id]: [CUSTOM_OPTION_ID] },
        {},
      ),
    ).toBe(false);
    expect(
      questionAnswersComplete(
        questions,
        { [question.id]: [CUSTOM_OPTION_ID] },
        { [question.id]: "c.ts" },
      ),
    ).toBe(true);
  });

  it("maps selected ids back to labels and custom text", () => {
    expect(
      selectedAnswerLabels(question, {
        kind: "answered",
        answers: { [question.id]: ["b.ts"] },
      }),
    ).toEqual(["b.ts"]);
    expect(
      selectedAnswerLabels(question, {
        kind: "answered",
        answers: { [question.id]: [CUSTOM_OPTION_ID] },
        custom: { [question.id]: "c.ts" },
      }),
    ).toEqual(["c.ts"]);
  });
});

describe("buildQuestionReply", () => {
  const questions = questionsFromUnknown({
    questions: [
      {
        question: "Language?",
        header: "Language",
        options: [{ label: "TypeScript" }, { label: "JavaScript" }],
      },
      {
        question: "Which files?",
        header: "Files",
        multiSelect: true,
        options: [{ label: "a.ts" }, { label: "b.ts" }],
      },
    ],
  });
  const language = questions[0]!;
  const files = questions[1]!;

  it("skips the whole prompt when no question was answered", () => {
    expect(buildQuestionReply(questions, {}, {})).toEqual({ kind: "skipped" });
    expect(questionIsComplete(language, {}, {})).toBe(false);
  });

  it("keeps answers for questions that were filled and drops skipped ones", () => {
    expect(
      buildQuestionReply(
        questions,
        { [files.id]: ["a.ts", "b.ts"] },
        {},
      ),
    ).toEqual({
      kind: "answered",
      answers: { [files.id]: ["a.ts", "b.ts"] },
    });
  });

  it("includes every completed question", () => {
    expect(
      buildQuestionReply(
        questions,
        {
          [language.id]: [CUSTOM_OPTION_ID],
          [files.id]: ["a.ts"],
        },
        { [language.id]: "Python" },
      ),
    ).toEqual({
      kind: "answered",
      answers: {
        [language.id]: [CUSTOM_OPTION_ID],
        [files.id]: ["a.ts"],
      },
      custom: { [language.id]: "Python" },
    });
  });

  it("translates MemoryProxy Chinese session-init questions while preserving wire labels", () => {
    const rawPrompt =
      "\u672c\u6b21\u5bf9\u8bdd\u662f\u5426\u8981\u5173\u8054\u56e2\u961f\u8d44\u4ea7\uff1f\uff08\u8bf7\u9009\u62e9\u6700\u5339\u914d\u7684\u9009\u9879\uff0c\u5f53\u524d\u6682\u4e0d\u652f\u6301\u81ea\u5b9a\u4e49\u8f93\u5165\u3002\u82e5\u9009\u62e9\u8df3\u8fc7\uff0c\u672c\u6b21 Session \u5c06\u4e0d\u6ce8\u5165\u56e2\u961f\u8d44\u4ea7\uff09";
    const yesWire = "\u662f\uff0c\u5173\u8054\u8d44\u4ea7";
    const noWire = "\u5426\uff0c\u672c\u6b21\u4e0d\u5173\u8054";
    const parsed = questionsFromUnknown({
      questions: [
        {
          header: "\u5173\u8054\u8d44\u4ea7",
          question: rawPrompt,
          multiSelect: false,
          options: [
            {
              label: yesWire,
              description:
                "\u9009\u62e9 Team / Agent / Task\uff0c\u6ce8\u5165\u56e2\u961f\u4e0a\u4e0b\u6587",
            },
            {
              label: noWire,
              description:
                "\u4e0d\u6ce8\u5165\u4efb\u4f55\u5185\u5bb9\uff0c\u76f4\u63a5\u653e\u884c",
            },
          ],
        },
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      header: "Link Team Assets",
      prompt:
        "Link team assets to this session? (Choose the best matching option; custom input is not supported. If skipped, no team assets will be injected into this session.)",
      wirePrompt: rawPrompt,
      options: [
        {
          label: "Yes, link assets",
          wireLabel: yesWire,
          description: "Select Team / Agent / Task to inject team context",
        },
        {
          label: "No, skip for this session",
          wireLabel: noWire,
          description: "Continue without injecting any team context",
        },
      ],
    });
    expect(isProxySessionInitQuestions(parsed)).toBe(true);
    const bypass = buildProxySessionInitBypassReply(parsed);
    expect(bypass.kind).toBe("answered");
    if (bypass.kind === "answered") {
      expect(selectedAnswerLabels(parsed[0]!, bypass)).toEqual([noWire]);
    }
  });
});
