import { isEditTool } from "../../../integrations/harness/core/preview";
import { visibleUserPrompt } from "../../orchestration/model/orchestration";
import { fuzzyMatch } from "../../../shared/lib/fuzzy";
import { displayPath, pathKey, projectName } from "../../../shared/lib/paths";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  type Block,
  type HarnessId,
} from "./session";

/**
 * Cross-session references: `@session/<slug>-<id8>` in the composer points at
 * another chat, optionally narrowed to messages with `#2,4-6`. The token stays
 * in the visible user message; the referenced content is appended to the
 * prompt the harness receives, like `@note/…`.
 */
export const SESSION_MENTION_PREFIX = "session/";
export const SESSION_PATH_PREFIX = "session:";

/** Characters of referenced content one turn may carry, across all references. */
export const SESSION_REFERENCE_TOTAL_CHARS = 48_000;
/** Characters one reference may carry before it is condensed or truncated. */
export const SESSION_REFERENCE_CHARS = 24_000;
const MIN_REFERENCE_CHARS = 2_000;
const GOAL_CHARS = 1_500;
const DIGEST_USER_CHARS = 160;
const DIGEST_REPLY_CHARS = 240;
const TAIL_SHARE = 0.6;
const MAX_FILES = 30;
const MAX_SLUG = 32;
const MAX_ORDINAL = 99_999;
const MAX_SELECTED = 500;

const TOKEN_RE =
  /(^|\s)@session\/([a-z0-9-]{1,80})(?:#(\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*))?(?=$|[\s.,;:!?)\]}'"])/g;
const ID_RE = /^[0-9a-z]{8}$/;

export type SessionReferenceToken = {
  start: number;
  end: number;
  /** Token text without the leading `@`. */
  label: string;
  /** First eight characters of the referenced session id. */
  idPrefix: string;
  /** 1-based message numbers, or null for the whole session. */
  selection: number[] | null;
};

export type SessionReferenceTextPart = {
  text: string;
  token?: SessionReferenceToken;
};

/** One readable message: a user prompt or a whole agent reply for a turn. */
export type SessionMessage = {
  ordinal: number;
  kind: "user" | "reply";
  /** First block of the message; the anchor used to jump to it. */
  blockId: string;
  blockIds: string[];
  text: string;
  /** Provider that wrote a reply. */
  harness?: HarnessId;
  at?: number;
  /** The reply is still streaming. */
  streaming?: boolean;
};

/** Everything a reference needs from the session it points at. */
export type SessionReferenceSource = {
  id: string;
  title: string;
  harness: HarnessId;
  cwd: string;
  worktreeCwd?: string;
  branch?: string;
  busy?: boolean;
  updatedAt?: number;
  blocks: Block[];
};

export type SessionReferenceTarget = {
  sessionId?: string;
  harness: HarnessId;
  /** Project identity of the chat the reference is sent from. */
  cwd: string;
  worktreeCwd?: string;
};

export type SessionReferenceStatus = "ok" | "missing" | "self" | "empty";

export type SessionReferencePlan = {
  token: SessionReferenceToken;
  status: SessionReferenceStatus;
  source?: SessionReferenceSource;
  /** Messages included word for word (possibly truncated, see `truncated`). */
  full: number;
  /** Messages shortened to one line. */
  shortened: number;
  /** Messages left out entirely. */
  omitted: number;
  /** Requested message numbers that do not exist in the source. */
  missingOrdinals: number[];
  /** Characters of the referenced messages before any budgeting. */
  sourceChars: number;
  /** Characters of the block appended to the prompt. */
  includedChars: number;
  condensed: boolean;
  truncated: boolean;
  running: boolean;
  otherProject: boolean;
  otherWorktree: boolean;
  otherAgent: boolean;
  /** Text appended to the harness prompt; empty for `self`. */
  body: string;
};

export function isSessionMentionPath(path: string): boolean {
  return path.startsWith(SESSION_PATH_PREFIX);
}

/** Stable short id for tokens, or null when the id cannot be referenced. */
export function sessionReferenceId(id: string): string | null {
  const prefix = id.slice(0, 8).toLowerCase();
  return ID_RE.test(prefix) ? prefix : null;
}

export function sessionReferenceSlug(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
}

/** `session/fix-login-3f2a9c1e#2-4,7` — label without the leading `@`. */
export function sessionReferenceLabel(
  session: { id: string; title: string },
  ordinals?: readonly number[] | null,
): string | null {
  const id = sessionReferenceId(session.id);
  if (!id) return null;
  const slug = sessionReferenceSlug(session.title);
  const selection = ordinals?.length ? `#${compactOrdinals(ordinals)}` : "";
  return `${SESSION_MENTION_PREFIX}${slug ? `${slug}-` : ""}${id}${selection}`;
}

export function compactOrdinals(ordinals: readonly number[]): string {
  const sorted = [...new Set(ordinals)]
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    let end = start;
    while (sorted[i + 1] === end + 1) end = sorted[++i]!;
    runs.push(end > start ? `${start}-${end}` : String(start));
  }
  return runs.join(",");
}

export function parseOrdinals(value: string): number[] | null {
  const out = new Set<number>();
  for (const part of value.split(",")) {
    const [a, b] = part.split("-");
    const start = Number(a);
    const end = b == null ? start : Number(b);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 1 || end < start || end > MAX_ORDINAL) return null;
    for (let n = start; n <= end; n++) {
      out.add(n);
      if (out.size > MAX_SELECTED) return null;
    }
  }
  return [...out].sort((x, y) => x - y);
}

export function sessionReferenceTokens(text: string): SessionReferenceToken[] {
  if (!text.includes("@session/")) return [];
  const tokens: SessionReferenceToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(text))) {
    const body = match[2]!;
    const dash = body.lastIndexOf("-");
    const idPrefix = dash < 0 ? body : body.slice(dash + 1);
    if (!ID_RE.test(idPrefix)) continue;
    const selection = match[3] ? parseOrdinals(match[3]) : null;
    if (match[3] && !selection) continue;
    const start = match.index + (match[1] ?? "").length;
    const end = match.index + match[0].length;
    tokens.push({
      start,
      end,
      label: text.slice(start + 1, end),
      idPrefix,
      selection,
    });
  }
  return tokens;
}

/** Split text so `@session/…` tokens can be drawn as references. */
export function sessionReferenceParts(
  text: string,
): SessionReferenceTextPart[] {
  const tokens = sessionReferenceTokens(text);
  if (tokens.length === 0) return text ? [{ text }] : [];
  const parts: SessionReferenceTextPart[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor)
      parts.push({ text: text.slice(cursor, token.start) });
    parts.push({ text: text.slice(token.start, token.end), token });
    cursor = token.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}

/** Drop one token and the space after it. */
export function removeSessionReferenceToken(
  text: string,
  token: Pick<SessionReferenceToken, "start" | "end">,
): string {
  const after = text.slice(token.end).replace(/^ /, "");
  return `${text.slice(0, token.start)}${after}`;
}

/** Append a reference on its own, separated from what is already drafted. */
export function appendSessionReference(draft: string, label: string): string {
  const token = `@${label}`;
  if (!draft.trim()) return `${token} `;
  const separator = /\s$/.test(draft) ? "" : " ";
  return `${draft}${separator}${token} `;
}

/** The readable thread: user prompts and agent replies, numbered from 1. */
export function sessionMessages(
  source: Pick<SessionReferenceSource, "blocks" | "harness">,
): SessionMessage[] {
  const messages: SessionMessage[] = [];
  let replyHarness: HarnessId = source.harness;
  let reply: Omit<SessionMessage, "ordinal"> | null = null;
  const flush = () => {
    if (reply && reply.text.trim()) {
      messages.push({ ...reply, ordinal: messages.length + 1 });
    }
    reply = null;
  };
  for (const block of source.blocks) {
    if (block.internal || block.irgatSessionCompletion) continue;
    if (block.role === "user") {
      flush();
      if (block.draft) continue;
      replyHarness = block.turnModel?.harness ?? replyHarness;
      const files = (block.attachments ?? [])
        .map((file) => file.name)
        .filter(Boolean);
      const prompt = visibleUserPrompt(block.text).trim();
      const text = [
        prompt,
        files.length ? `[attached: ${files.join(", ")}]` : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (!text) continue;
      messages.push({
        ordinal: messages.length + 1,
        kind: "user",
        blockId: block.id,
        blockIds: [block.id],
        text,
        ...((block.sentAt ?? block.startedAt)
          ? { at: block.sentAt ?? block.startedAt }
          : {}),
      });
      continue;
    }
    if (block.role === "handoff" && block.handoff) {
      flush();
      replyHarness = block.handoff.to;
      continue;
    }
    if (
      block.role !== "assistant" &&
      block.role !== "plan" &&
      block.role !== "tasks"
    ) {
      continue;
    }
    const text = block.text.replace(/\r\n?/g, "\n").trim();
    if (!text) continue;
    if (!reply) {
      reply = {
        kind: "reply",
        blockId: block.id,
        blockIds: [],
        text: "",
        harness: replyHarness,
      };
    }
    reply.blockIds.push(block.id);
    reply.text = reply.text ? `${reply.text}\n\n${text}` : text;
    if (block.streaming) reply.streaming = true;
  }
  flush();
  return messages;
}

/** Message that holds a transcript block, for "send this to another session". */
export function sessionMessageForBlock(
  messages: readonly SessionMessage[],
  blockId: string,
): SessionMessage | undefined {
  return messages.find((message) => message.blockIds.includes(blockId));
}

export function editedFiles(source: SessionReferenceSource): string[] {
  const files = new Map<string, string>();
  const base = source.worktreeCwd || source.cwd;
  for (const block of source.blocks) {
    if (block.role !== "tool" && block.role !== "approval") continue;
    if (
      !isEditTool(
        block.tool?.kind,
        block.text || block.tool?.title,
        block.tool?.preview,
      )
    ) {
      continue;
    }
    const paths = block.tool?.paths?.length
      ? block.tool.paths
      : block.tool?.preview?.path
        ? [block.tool.preview.path]
        : [];
    for (const path of paths) {
      const label = displayPath(path, base);
      files.set(label.toLowerCase(), label);
    }
  }
  return [...files.values()];
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** `~6.1k tokens` — always an estimate, so always marked as one. */
export function formatTokenEstimate(chars: number): string {
  const tokens = estimateTokens(chars);
  if (tokens < 1_000) return `~${tokens} tokens`;
  const k = tokens / 1_000;
  return `~${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k tokens`;
}

export function referenceBudget(count: number): number {
  if (count <= 0) return SESSION_REFERENCE_CHARS;
  return Math.max(
    MIN_REFERENCE_CHARS,
    Math.min(
      SESSION_REFERENCE_CHARS,
      Math.floor(SESSION_REFERENCE_TOTAL_CHARS / count),
    ),
  );
}

/**
 * Work out exactly what each token will add to the prompt. The composer shows
 * this plan before sending, and the send path appends the same bodies.
 */
export function planSessionReferences(
  tokens: readonly SessionReferenceToken[],
  lookup: (idPrefix: string) => SessionReferenceSource | undefined,
  target: SessionReferenceTarget,
): SessionReferencePlan[] {
  const seen = new Set<string>();
  const unique = tokens.filter((token) => {
    const key = `${token.idPrefix}#${token.selection?.join(",") ?? "*"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const targetId = target.sessionId
    ? sessionReferenceId(target.sessionId)
    : null;
  const counted = unique.filter((token) => token.idPrefix !== targetId).length;
  const budget = referenceBudget(counted);
  return unique.map((token) =>
    planOne(
      token,
      token.idPrefix === targetId ? "self" : lookup(token.idPrefix),
      target,
      budget,
    ),
  );
}

function emptyPlan(
  token: SessionReferenceToken,
  status: SessionReferenceStatus,
  body: string,
): SessionReferencePlan {
  return {
    token,
    status,
    full: 0,
    shortened: 0,
    omitted: 0,
    missingOrdinals: [],
    sourceChars: 0,
    includedChars: body.length,
    condensed: false,
    truncated: false,
    running: false,
    otherProject: false,
    otherWorktree: false,
    otherAgent: false,
    body,
  };
}

function planOne(
  token: SessionReferenceToken,
  source: SessionReferenceSource | "self" | undefined,
  target: SessionReferenceTarget,
  budget: number,
): SessionReferencePlan {
  if (source === "self") return emptyPlan(token, "self", "");
  if (!source) {
    return emptyPlan(
      token,
      "missing",
      `[The user referenced another session (@${token.label}), but it could not be found. Nothing from it is included.]`,
    );
  }
  const messages = sessionMessages(source);
  const wanted = token.selection
    ? messages.filter((message) => token.selection!.includes(message.ordinal))
    : messages;
  const missingOrdinals = token.selection
    ? token.selection.filter((n) => !messages.some((m) => m.ordinal === n))
    : [];
  const running = !!source.busy || messages.some((m) => m.streaming);
  const otherProject = pathKey(source.cwd) !== pathKey(target.cwd);
  const otherWorktree =
    !otherProject &&
    pathKey(source.worktreeCwd || source.cwd) !==
      pathKey(target.worktreeCwd || target.cwd);
  const otherAgent =
    source.harness !== target.harness ||
    wanted.some((m) => m.harness && m.harness !== target.harness);
  const sourceChars = wanted.reduce((sum, m) => sum + m.text.length, 0);

  const base = {
    token,
    source,
    missingOrdinals,
    sourceChars,
    running,
    otherProject,
    otherWorktree,
    otherAgent,
  };
  if (wanted.length === 0) {
    const body = `[The user referenced ${token.selection ? `messages ${compactOrdinals(token.selection)} of ` : ""}another session ("${source.title}"), but it has no readable messages${token.selection ? " at those numbers" : ""}. Nothing from it is included.]`;
    return {
      ...base,
      status: "empty",
      full: 0,
      shortened: 0,
      omitted: 0,
      includedChars: body.length,
      condensed: false,
      truncated: false,
      body,
    };
  }

  const layout = token.selection
    ? layoutSelection(wanted, budget)
    : layoutWholeSession(wanted, budget);
  const files = token.selection ? [] : editedFiles(source);
  const body = formatReferenceBody({
    source,
    token,
    target,
    lines: layout.lines,
    files,
    running,
    otherProject,
    otherWorktree,
    otherAgent,
    missingOrdinals,
    note: layout.note,
  });
  return {
    ...base,
    status: "ok",
    full: layout.full,
    shortened: layout.shortened,
    omitted: layout.omitted,
    includedChars: body.length,
    condensed: layout.shortened > 0 || layout.omitted > 0,
    truncated: layout.truncated,
    body,
  };
}

type Layout = {
  lines: string[];
  full: number;
  shortened: number;
  omitted: number;
  truncated: boolean;
  note: string;
};

function speaker(message: SessionMessage): string {
  if (message.kind === "user") return "User";
  return message.harness ? HARNESS_TITLE[message.harness] : "Agent";
}

function fullEntry(
  message: SessionMessage,
  maxChars = Infinity,
): {
  text: string;
  truncated: boolean;
} {
  const head = `[#${message.ordinal} · ${speaker(message)}${message.streaming ? " · still writing" : ""}]`;
  if (message.text.length <= maxChars) {
    return { text: `${head}\n${message.text}`, truncated: false };
  }
  const kept = Math.max(0, maxChars);
  return {
    text: `${head}\n${message.text.slice(0, kept).trimEnd()}\n[… ${message.text.length - kept} more characters of this message were cut]`,
    truncated: true,
  };
}

function digestEntry(message: SessionMessage): string {
  const limit =
    message.kind === "user" ? DIGEST_USER_CHARS : DIGEST_REPLY_CHARS;
  const flat = message.text.replace(/\s+/g, " ").trim();
  const short = flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
  return `[#${message.ordinal} · ${speaker(message)} · shortened] ${short}`;
}

/** Picked messages are wanted word for word; cut only what overflows. */
function layoutSelection(messages: SessionMessage[], budget: number): Layout {
  const lines: string[] = [];
  let used = 0;
  let full = 0;
  let omitted = 0;
  let truncated = false;
  for (const message of messages) {
    const remaining = budget - used;
    if (remaining < 200) {
      omitted += 1;
      continue;
    }
    const entry = fullEntry(message, remaining - 120);
    lines.push(entry.text);
    used += entry.text.length + 2;
    full += 1;
    if (entry.truncated) truncated = true;
  }
  const note =
    omitted > 0
      ? `${omitted} picked message${omitted === 1 ? "" : "s"} did not fit and ${omitted === 1 ? "was" : "were"} left out.`
      : "";
  return { lines, full, shortened: 0, omitted, truncated, note };
}

/**
 * A whole session keeps its opening request and its latest messages word for
 * word, shortens what fits in between to one line each, and drops the rest.
 */
function layoutWholeSession(
  messages: SessionMessage[],
  budget: number,
): Layout {
  const total = messages.reduce(
    (sum, m) => sum + fullEntry(m).text.length + 2,
    0,
  );
  if (total <= budget) {
    return {
      lines: messages.map((m) => fullEntry(m).text),
      full: messages.length,
      shortened: 0,
      omitted: 0,
      truncated: false,
      note: "",
    };
  }

  const first = messages[0]!;
  const goal = fullEntry(first, first.kind === "user" ? GOAL_CHARS : 400);
  let used = goal.text.length + 2;
  let truncated = goal.truncated;

  const tail: string[] = [];
  const tailBudget = Math.floor(budget * TAIL_SHARE);
  let tailUsed = 0;
  let tailStart = messages.length;
  for (let i = messages.length - 1; i >= 1; i--) {
    const entry = fullEntry(messages[i]!);
    if (tailUsed + entry.text.length + 2 > tailBudget) {
      if (tail.length === 0) {
        const cut = fullEntry(messages[i]!, Math.max(400, tailBudget - 200));
        tail.unshift(cut.text);
        tailUsed += cut.text.length + 2;
        truncated = truncated || cut.truncated;
        tailStart = i;
      }
      break;
    }
    tail.unshift(entry.text);
    tailUsed += entry.text.length + 2;
    tailStart = i;
  }
  used += tailUsed;

  const middle = messages.slice(1, tailStart);
  const digests: string[] = [];
  for (let i = middle.length - 1; i >= 0; i--) {
    const line = digestEntry(middle[i]!);
    if (used + line.length + 1 > budget - 160) break;
    digests.unshift(line);
    used += line.length + 1;
  }
  const omitted = middle.length - digests.length;
  const lines = [
    goal.text,
    ...(omitted > 0
      ? [
          `[… ${omitted} earlier message${omitted === 1 ? "" : "s"} left out to fit …]`,
        ]
      : []),
    ...(digests.length ? [digests.join("\n")] : []),
    ...tail,
  ];
  const full = 1 + tail.length;
  const parts = [
    `${full} of ${messages.length} messages word for word`,
    digests.length ? `${digests.length} shortened to one line` : "",
    omitted ? `${omitted} left out` : "",
  ].filter(Boolean);
  return {
    lines,
    full,
    shortened: digests.length,
    omitted,
    truncated,
    note: `Condensed to fit: ${parts.join(", ")}.`,
  };
}

function attr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ");
}

function formatReferenceBody(input: {
  source: SessionReferenceSource;
  token: SessionReferenceToken;
  target: SessionReferenceTarget;
  lines: string[];
  files: string[];
  running: boolean;
  otherProject: boolean;
  otherWorktree: boolean;
  otherAgent: boolean;
  missingOrdinals: number[];
  note: string;
}): string {
  const { source, token } = input;
  const agent = HARNESS_TITLE[source.harness];
  const workCwd = source.worktreeCwd || source.cwd;
  const scope = token.selection
    ? `messages ${compactOrdinals(token.selection)}`
    : "whole session";
  const attrs = [
    `ref="@${attr(token.label)}"`,
    `title="${attr(source.title)}"`,
    `agent="${attr(agent)}"`,
    `cwd="${attr(workCwd)}"`,
    ...(source.branch ? [`branch="${attr(source.branch)}"`] : []),
    `scope="${scope}"`,
    ...(input.running ? [`status="running"`] : []),
  ].join(" ");
  const notes = [
    "Context copied from a different Irgatos session at the user's request. It is not part of this conversation; use it as reference material.",
    input.otherAgent
      ? `That session was run by ${agent}, a different agent than you. Its tool results and claims describe its own run.`
      : "",
    input.otherProject
      ? `It ran in a different project: ${workCwd}. File paths in it are relative to that directory, not yours.`
      : input.otherWorktree
        ? `It ran in a different working copy of this project: ${workCwd}. Its uncommitted edits are not in your checkout.`
        : "",
    input.running
      ? "That session is still running, so its latest reply may be incomplete."
      : "",
    input.missingOrdinals.length
      ? `Message${input.missingOrdinals.length === 1 ? "" : "s"} ${compactOrdinals(input.missingOrdinals)} no longer exist${input.missingOrdinals.length === 1 ? "s" : ""} in that session.`
      : "",
    input.note,
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");
  const files = input.files.length
    ? `\n\nFiles edited in that session:\n${input.files
        .slice(0, MAX_FILES)
        .map((file) => `- ${file}`)
        .join(
          "\n",
        )}${input.files.length > MAX_FILES ? `\n- … ${input.files.length - MAX_FILES} more` : ""}`
    : "";
  return `<session_reference ${attrs}>\n${notes}${files}\n\n${input.lines.join("\n\n")}\n</session_reference>`;
}

/** Append every resolved reference after the user's own words. */
export function injectSessionReferences(
  text: string,
  plans: readonly SessionReferencePlan[],
): string {
  const bodies = plans.map((plan) => plan.body).filter(Boolean);
  if (bodies.length === 0) return text;
  return [text.trimEnd(), "", "---", bodies.join("\n\n")].join("\n");
}

/** One line for the composer: what this reference will add. */
export function describeSessionReferencePlan(
  plan: SessionReferencePlan,
): string {
  if (plan.status === "self") return "This session — nothing is added";
  if (plan.status === "missing") return "Session not found — nothing is added";
  if (plan.status === "empty") return "No readable messages — nothing is added";
  const scope = plan.token.selection
    ? `${plan.full} picked message${plan.full === 1 ? "" : "s"}`
    : plan.condensed
      ? `Condensed: ${plan.full} in full${plan.shortened ? `, ${plan.shortened} shortened` : ""}${plan.omitted ? `, ${plan.omitted} left out` : ""}`
      : `Whole session, ${plan.full} message${plan.full === 1 ? "" : "s"}`;
  const size =
    plan.condensed || plan.truncated
      ? `${formatTokenEstimate(plan.includedChars)} of ${formatTokenEstimate(plan.sourceChars)}`
      : formatTokenEstimate(plan.includedChars);
  return `${scope} · ${size}${plan.truncated ? " · cut to fit" : ""}`;
}

export type ReferenceCandidateLike = {
  id: string;
  title: string;
  harness: HarnessId;
  cwd: string;
  branch?: string;
  updatedAt: number;
};

export type RankedReferenceCandidate<T extends ReferenceCandidateLike> = {
  candidate: T;
  /** Matched characters in the display title. */
  positions: number[];
};

/** Recency without a query; fuzzy on title, then project, agent and branch. */
export function rankReferenceCandidates<T extends ReferenceCandidateLike>(
  candidates: readonly T[],
  query: string,
  limit = 50,
): RankedReferenceCandidate<T>[] {
  const needle = query.trim();
  if (!needle) {
    return candidates
      .slice(0, limit)
      .map((candidate) => ({ candidate, positions: [] }));
  }
  const scored: { candidate: T; score: number; positions: number[] }[] = [];
  for (const candidate of candidates) {
    const title = sessionDisplayTitle(candidate.title, candidate.harness);
    const titleHit = fuzzyMatch(needle, title);
    if (titleHit) {
      scored.push({
        candidate,
        score: titleHit.score + 400,
        positions: titleHit.positions,
      });
      continue;
    }
    const other = [
      projectName(candidate.cwd),
      HARNESS_TITLE[candidate.harness],
      candidate.branch ?? "",
    ]
      .map((text) => (text ? fuzzyMatch(needle, text) : null))
      .find(Boolean);
    if (other) scored.push({ candidate, score: other.score, positions: [] });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || b.candidate.updatedAt - a.candidate.updatedAt,
  );
  return scored
    .slice(0, limit)
    .map(({ candidate, positions }) => ({ candidate, positions }));
}

/** `now`, `5m ago`, `3h ago`, `2d ago`, then a short date. */
export function formatActivityAge(at: number, now = Date.now()): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
