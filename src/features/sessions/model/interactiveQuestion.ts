import type { Session } from "./session";
import {
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "./userQuestion";

export const INTERACTIVE_QUESTION_RULES = `\n\n<interactive_questions>\nAsk every user question through the available interactive question tool (AskUserQuestion, request_user_input, ask_question, or equivalent). Always supply concrete clickable choices, including yes/no decisions. Never ask the user to type A/B/C or 1/2/3. If no question tool is available, end your reply with one question on its own line ending in ?, followed by 2–8 numbered choices (1. Choice, 2. Choice). Irgatos renders those choices as buttons. Put your recommendation first. Only request free text for information that cannot be chosen, and never ask for passwords or secrets in chat.\n</interactive_questions>`;

export const TEXT_QUESTION_ID = -2147483647;

/** Only a final, unanswered question followed entirely by choices becomes a form. */
export function textQuestion(
  session: Pick<Session, "blocks" | "busy" | "pendingQuestion">,
): UserQuestionPrompt | undefined {
  if (session.busy || session.pendingQuestion) return undefined;
  const last = [...session.blocks]
    .reverse()
    .find((block) => block.role === "assistant" || block.role === "user");
  if (last?.role !== "assistant" || last.streaming || last.text.includes("```"))
    return undefined;
  const lines = last.text
    .trim()
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastQuestion = [...lines]
    .reverse()
    .findIndex((line) => /[?？]$/.test(line));
  const start = lastQuestion < 0 ? -1 : lines.length - lastQuestion - 1;
  if (start < 0) return undefined;
  const choices = lines.slice(start + 1);
  if (choices.length < 2 || choices.length > 8) return undefined;
  const options = choices.map((line, index) => {
    const match = line.match(/^(?:\*\*)?([1-8A-Ha-h])[.)](?:\*\*)?\s+(.+)$/);
    if (
      !match ||
      ![String(index + 1), String.fromCharCode(65 + index)].includes(
        match[1].toUpperCase(),
      )
    )
      return undefined;
    return {
      id: String(index + 1),
      label: match[2].replace(/^\*\*|\*\*$/g, ""),
    };
  });
  if (options.some((option) => !option)) return undefined;
  // Credential questions must use a dedicated secure input surface.
  if (/password|api.?key|secret|şifre|parola|anahtar/i.test(lines[start]))
    return undefined;
  return {
    requestId: TEXT_QUESTION_ID,
    questions: [
      {
        id: last.id,
        prompt: lines[start],
        options: options.filter((option) => !!option),
        multiSelect: false,
        allowCustom: true,
      },
    ],
  };
}

export function textQuestionAnswer(
  prompt: UserQuestionPrompt,
  reply: UserQuestionReply,
): string {
  if (reply.kind === "skipped")
    return "Bu soruyu atla; yanıt veya onay verdiğimi varsayma.";
  return prompt.questions
    .map((question) => {
      const custom = reply.custom?.[question.id]?.trim();
      const labels = (reply.answers[question.id] ?? []).flatMap(
        (id) =>
          question.options.find((option) => option.id === id)?.label ?? [],
      );
      return `${question.prompt}\n${custom || labels.join(", ")}`;
    })
    .join("\n\n");
}
