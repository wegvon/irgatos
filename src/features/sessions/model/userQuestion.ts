/** Shared clarifying-question model for every harness that can ask the user. */

export const CUSTOM_OPTION_ID = "__custom__";

export type UserQuestionOption = {
  id: string;
  label: string;
  /** Original wire label when `label` was translated for display. */
  wireLabel?: string;
  description?: string;
};

export type UserQuestion = {
  id: string;
  header?: string;
  prompt: string;
  /** Original wire prompt when `prompt` was translated for display. */
  wirePrompt?: string;
  multiSelect: boolean;
  allowCustom: boolean;
  options: UserQuestionOption[];
};

export type UserQuestionPrompt = {
  requestId: number;
  title?: string;
  questions: UserQuestion[];
  /** Deadline owned by the harness; interaction can disable automatic skipping. */
  autoResolveAt?: number;
};

export type UserQuestionReply =
  | {
      kind: "answered";
      answers: Record<string, string[]>;
      custom?: Record<string, string>;
    }
  | { kind: "skipped" };

export function questionsFromUnknown(value: unknown): UserQuestion[] {
  const rec = asRecord(value);
  const nested =
    asRecord(rec?.input) ?? asRecord(rec?.params) ?? asRecord(rec?.question);
  const raw = firstArray(
    rec?.questions,
    nested?.questions,
    Array.isArray(value) ? value : undefined,
  );
  const usedIds = new Set<string>();
  return raw.flatMap((item, index) => {
    const parsed = questionFromUnknown(item, index, usedIds);
    return parsed ? [parsed] : [];
  });
}

export function questionPromptTitle(questions: UserQuestion[]): string {
  const first = questions[0];
  return first?.header || first?.prompt || "Question";
}

export function questionIsComplete(
  question: UserQuestion,
  answers: Record<string, string[]>,
  custom: Record<string, string> = {},
): boolean {
  const selected = answers[question.id] ?? [];
  if (selected.length === 0) {
    return question.allowCustom && !!custom[question.id]?.trim();
  }
  if (!question.multiSelect && selected.length !== 1) return false;
  return selected.every((id) => {
    if (!isCustomSelection(question, id)) return true;
    return !!custom[question.id]?.trim();
  });
}

export function questionAnswersComplete(
  questions: UserQuestion[],
  answers: Record<string, string[]>,
  custom: Record<string, string> = {},
): boolean {
  if (questions.length === 0) return false;
  return questions.every((question) =>
    questionIsComplete(question, answers, custom),
  );
}

/** Skip every question → skipped. Any answered question → answered with those only. */
export function buildQuestionReply(
  questions: UserQuestion[],
  answers: Record<string, string[]>,
  custom: Record<string, string> = {},
): UserQuestionReply {
  const answered = questions.filter((question) =>
    questionIsComplete(question, answers, custom),
  );
  if (answered.length === 0) return { kind: "skipped" };
  const nextAnswers: Record<string, string[]> = {};
  const nextCustom: Record<string, string> = {};
  for (const question of answered) {
    const selected = answers[question.id];
    if (selected?.length) nextAnswers[question.id] = selected;
    const text = custom[question.id]?.trim();
    if (text) nextCustom[question.id] = text;
  }
  return {
    kind: "answered",
    answers: nextAnswers,
    ...(Object.keys(nextCustom).length > 0 ? { custom: nextCustom } : {}),
  };
}

export function selectedAnswerLabels(
  question: UserQuestion,
  reply: Extract<UserQuestionReply, { kind: "answered" }>,
): string[] {
  const custom = reply.custom?.[question.id]?.trim();
  const selected = reply.answers[question.id] ?? [];
  if (selected.length === 0 && custom && question.allowCustom) return [custom];
  return selected.flatMap((id) => {
    if (isCustomSelection(question, id)) return custom ? [custom] : [];
    const option = question.options.find((item) => item.id === id);
    const label = (option?.wireLabel ?? option?.label)?.trim() || id.trim();
    return label ? [label] : [];
  });
}

const PROXY_SESSION_INIT_TOOL_ID_RE =
  /^(?:toolu_(?:cc_)?session_init_|call_(?:codex|oc|wb|dsh)_session_init_)/;

const PROXY_BYPASS_WIRE_LABELS = new Set([
  "\u5426\uff0c\u672c\u6b21\u4e0d\u5173\u8054", // No, skip for this session
  "\u8df3\u8fc7\uff0c\u4e0d\u5173\u8054", // Skip without linking
  "\u4e0d\u9009\u62e9 Agent", // No Agent
  "\u4e0d\u5173\u8054 Task", // No Task
  "\u4e0d\u6253\u6807\u7b7e", // No tags
]);

const PROXY_HEADER_TRANSLATIONS: Record<string, string> = {
  "\u5173\u8054\u8d44\u4ea7": "Link Team Assets",
  "\u9009\u62e9\u56e2\u961f": "Select Team",
  "\u5173\u8054\u914d\u7f6e": "Asset Configuration",
  "\u9009\u62e9 Agent": "Select Agent",
  "\u9009\u62e9 Task": "Select Task",
  "\u5bf9\u8bdd\u6807\u7b7e": "Session Tags",
};

const PROXY_OPTION_LABEL_TRANSLATIONS: Record<string, string> = {
  "\u662f\uff0c\u5173\u8054\u8d44\u4ea7": "Yes, link assets",
  "\u662f\uff0c\u5173\u8054\u56e2\u961f\u8d44\u4ea7": "Yes, link assets",
  "\u5426\uff0c\u672c\u6b21\u4e0d\u5173\u8054": "No, skip for this session",
  "\u8df3\u8fc7\uff0c\u4e0d\u5173\u8054": "Skip without linking",
  "\u4e0d\u9009\u62e9 Agent": "No Agent",
  "\u4e0d\u5173\u8054 Task": "No Task",
  "\u4e0d\u6253\u6807\u7b7e": "No tags",
};

const PROXY_OPTION_DESCRIPTION_TRANSLATIONS: Record<string, string> = {
  "\u9009\u62e9 Team / Agent / Task\uff0c\u6ce8\u5165\u56e2\u961f\u4e0a\u4e0b\u6587":
    "Select Team / Agent / Task to inject team context",
  "\u4e0d\u6ce8\u5165\u4efb\u4f55\u5185\u5bb9\uff0c\u76f4\u63a5\u653e\u884c":
    "Continue without injecting any team context",
  "\u672c\u6b21\u4e0d\u6ce8\u5165\u4efb\u4f55\u5185\u5bb9\uff0c\u76f4\u63a5\u653e\u884c":
    "Continue without injecting any team context",
  "\u672c\u6b21\u4e0d\u6ce8\u5165\u56e2\u961f\u8d44\u4ea7\uff0c\u76f4\u63a5\u5f00\u59cb\u5bf9\u8bdd":
    "Start the session without injecting team assets",
  "\u4e0d\u6ce8\u5165 Agent Profile": "Do not inject an Agent Profile",
  "\u4e0d\u6ce8\u5165 Task \u4e0a\u4e0b\u6587": "Do not inject Task context",
  "\u8df3\u8fc7\u6807\u7b7e\u8bbe\u7f6e": "Skip tag selection",
};

function translateQuestionHeader(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return PROXY_HEADER_TRANSLATIONS[raw] ?? raw;
}

function translateQuestionPrompt(raw: string | undefined): {
  prompt?: string;
  wirePrompt?: string;
} {
  if (!raw) return {};
  const stripped = raw.replace(/^\[MemoryProxy\]\s*/i, "");
  let translated = raw;
  if (
    stripped.includes(
      "\u672c\u6b21\u5bf9\u8bdd\u662f\u5426\u8981\u5173\u8054\u56e2\u961f\u8d44\u4ea7\uff1f",
    )
  ) {
    translated =
      "Link team assets to this session? (Choose the best matching option; custom input is not supported. If skipped, no team assets will be injected into this session.)";
  } else if (
    stripped.includes(
      "\u8bf7\u9009\u62e9\u8981\u5173\u8054\u7684 Team\uff08\u56e2\u961f\uff09",
    )
  ) {
    translated =
      "Select the Team to link to this session (choose the best matching option; if skipped, no team assets will be injected).";
  } else if (
    stripped.includes(
      "\u8bf7\u9009\u62e9\u8981\u6ce8\u5165\u7684 Agent Profile",
    )
  ) {
    translated = "Select the Agent Profile to inject into this session.";
  } else if (
    stripped.includes(
      "\u8bf7\u9009\u62e9\u8981\u5173\u8054\u7684 Task\uff08\u53ef\u591a\u9009\uff09",
    )
  ) {
    translated =
      "Select the Tasks to link to this session (multiple selection allowed).";
  } else if (
    stripped.includes(
      "\u8bf7\u4e3a\u672c\u6b21\u5bf9\u8bdd\u9009\u62e9\u6807\u7b7e\uff08\u53ef\u591a\u9009",
    )
  ) {
    translated =
      "Select tags for this session (multiple selection allowed).";
  } else if (PROXY_HEADER_TRANSLATIONS[stripped]) {
    translated = PROXY_HEADER_TRANSLATIONS[stripped];
  }
  return translated !== raw
    ? { prompt: translated, wirePrompt: raw }
    : { prompt: raw };
}

function translateOptionLabel(raw: string): {
  label: string;
  wireLabel?: string;
} {
  const translated = PROXY_OPTION_LABEL_TRANSLATIONS[raw];
  return translated && translated !== raw
    ? { label: translated, wireLabel: raw }
    : { label: raw };
}

function translateOptionDescription(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const direct = PROXY_OPTION_DESCRIPTION_TRANSLATIONS[raw];
  if (direct) return direct;
  const countsMatch = raw.match(
    /^\u5305\u542b\s*(\d+)\s*\u4e2a\s*Agent[\u3001,\uff0c]\s*(\d+)\s*\u4e2a\s*Task$/,
  );
  if (countsMatch) {
    return `${countsMatch[1]} Agents, ${countsMatch[2]} Tasks`;
  }
  return raw;
}

/**
 * True when a tool call ID belongs to TencentDB-Agent-Memory (`MemoryProxy`)
 * synthetic session-initialization interception (`toolu_cc_session_init_*`, etc.).
 */
export function isProxySessionInitToolId(callId: string | undefined): boolean {
  return typeof callId === "string" && PROXY_SESSION_INIT_TOOL_ID_RE.test(callId.trim());
}

/**
 * True when a question batch comes from an upstream `MemoryProxy` session-init
 * interception rather than the model.
 */
export function isProxySessionInitQuestions(
  questions: readonly UserQuestion[],
  callId?: string,
): boolean {
  if (isProxySessionInitToolId(callId)) return true;
  if (questions.length === 0) return false;
  return questions.some(
    (question) =>
      question.wirePrompt !== undefined ||
      question.options.some((option) => option.wireLabel !== undefined),
  );
}

export function isProxySessionInitInput(
  input: unknown,
  callId?: string,
): boolean {
  if (isProxySessionInitToolId(callId)) return true;
  return isProxySessionInitQuestions(questionsFromUnknown(input), callId);
}

/**
 * Build an automatic decline/bypass reply for `MemoryProxy` session-init prompts
 * so proxy-intercepted turns (including cross-CLI handoffs) pass straight through
 * to the model without interrupting the user.
 */
export function buildProxySessionInitBypassReply(
  questions: readonly UserQuestion[],
): UserQuestionReply {
  const answers: Record<string, string[]> = {};
  for (const question of questions) {
    const bypassOption =
      question.options.find(
        (option) =>
          (option.wireLabel && PROXY_BYPASS_WIRE_LABELS.has(option.wireLabel)) ||
          /^(?:no\b|skip\b)/i.test(option.label.trim()),
      ) ?? question.options[question.options.length - 1];
    if (bypassOption) {
      answers[question.id] = [bypassOption.id];
    }
  }
  if (Object.keys(answers).length === 0) return { kind: "skipped" };
  return { kind: "answered", answers };
}

export function isCustomSelection(
  question: UserQuestion,
  optionId: string,
): boolean {
  if (optionId === CUSTOM_OPTION_ID) return true;
  const option = question.options.find((item) => item.id === optionId);
  return option ? isOtherOption(option) : false;
}

export function isOtherOption(option: UserQuestionOption): boolean {
  return option.id === CUSTOM_OPTION_ID || /^other$/i.test(option.label.trim());
}

function questionFromUnknown(
  value: unknown,
  index: number,
  usedIds: Set<string>,
): UserQuestion | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const rawPrompt =
    stringField(rec, "question") ??
    stringField(rec, "prompt") ??
    stringField(rec, "text") ??
    stringField(rec, "header");
  const { prompt, wirePrompt } = translateQuestionPrompt(rawPrompt);
  const options = optionsFromUnknown(rec.options);
  const allowCustom = customAllowed(rec, options);
  if (!prompt && options.length === 0 && !allowCustom) return null;
  const rawHeader = stringField(rec, "header") ?? stringField(rec, "title");
  const header = translateQuestionHeader(rawHeader);
  return {
    id: uniqueId(
      stringField(rec, "id") ?? prompt ?? header ?? `q${index + 1}`,
      usedIds,
    ),
    ...(header ? { header } : {}),
    prompt: prompt || header || `Question ${index + 1}`,
    ...(wirePrompt ? { wirePrompt } : {}),
    multiSelect:
      rec.multiSelect === true ||
      rec.allowMultiple === true ||
      rec.multiple === true,
    allowCustom,
    options,
  };
}

function optionsFromUnknown(value: unknown): UserQuestionOption[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      const { label, wireLabel } = translateOptionLabel(item.trim());
      return [
        {
          id: uniqueId(label, usedIds),
          label,
          ...(wireLabel ? { wireLabel } : {}),
        },
      ];
    }
    const rec = asRecord(item);
    if (!rec) return [];
    const rawLabel =
      stringField(rec, "label") ??
      stringField(rec, "value") ??
      stringField(rec, "text") ??
      stringField(rec, "id");
    if (!rawLabel) return [];
    const { label, wireLabel } = translateOptionLabel(rawLabel);
    const description = translateOptionDescription(
      stringField(rec, "description") ?? stringField(rec, "detail"),
    );
    return [
      {
        id: uniqueId(
          stringField(rec, "id") ??
            stringField(rec, "optionId") ??
            stringField(rec, "value") ??
            label,
          usedIds,
        ),
        label,
        ...(wireLabel ? { wireLabel } : {}),
        ...(description ? { description } : {}),
      },
    ];
  });
}

function customAllowed(
  rec: Record<string, unknown>,
  options: UserQuestionOption[],
): boolean {
  if (typeof rec.custom === "boolean") return rec.custom;
  if (typeof rec.allowCustom === "boolean") return rec.allowCustom;
  if (options.some(isOtherOption)) return true;
  // Cursor-style options carry stable ids; Claude/OpenCode/Grok add Other in the UI.
  if (stringField(rec, "prompt") && !stringField(rec, "question")) return false;
  return true;
}

function uniqueId(seed: string, used: Set<string>): string {
  const base = seed.trim() || "option";
  let next = base;
  let n = 2;
  while (used.has(next)) {
    next = `${base}:${n}`;
    n += 1;
  }
  used.add(next);
  return next;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringField(
  rec: Record<string, unknown> | null | undefined,
  key: string,
): string | undefined {
  if (!rec) return undefined;
  const value = rec[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
