import type { Block, Session } from "../../sessions/model/session";
import {
  findIrgat,
  irgatForSession,
  irgatThatStarted,
  updateIrgat,
  type Irgat,
} from "./irgat";

/**
 * What an Irgat may do when its agent asks before a step, per kind of step:
 * go ahead, go ahead only for what the user listed, ask (the default), or
 * leave it to the user. The app answers for the user, so a rule holds
 * whatever the agent's prompt says.
 */
export type IrgatRuleLevel = "allow" | "preapproved" | "ask" | "handoff";

export const RULE_LEVELS: readonly IrgatRuleLevel[] = [
  "allow",
  "preapproved",
  "ask",
  "handoff",
];

export const RULE_LEVEL_LABEL: Record<IrgatRuleLevel, string> = {
  allow: "Do it",
  preapproved: "Only if listed",
  ask: "Ask me",
  handoff: "Leave it to me",
};

export type IrgatRuleCategory = "execute" | "edit" | "read" | "other";

export const RULE_CATEGORIES: readonly {
  id: IrgatRuleCategory;
  label: string;
  description: string;
}[] = [
  { id: "execute", label: "Commands", description: "Running commands and scripts." },
  { id: "edit", label: "File changes", description: "Writing, editing and deleting files." },
  { id: "read", label: "Reading", description: "Reading and searching files." },
  { id: "other", label: "Everything else", description: "Web, tools from connections, and subagents." },
];

export type IrgatRules = Partial<Record<IrgatRuleCategory, IrgatRuleLevel>> & {
  /**
   * What "Only if listed" lets through: a command it starts with, or part of
   * a file path, one per entry.
   */
  preapproved?: string[];
};

/** Entries kept in the list, and the longest one. */
export const PREAPPROVED_MAX = 50;
const PREAPPROVED_ENTRY_MAX = 200;

const isLevel = (value: unknown): value is IrgatRuleLevel =>
  (RULE_LEVELS as readonly unknown[]).includes(value);

/** Rules as stored; anything unknown is left out, and "ask" is the default. */
export function parseIrgatRules(value: unknown): IrgatRules | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entry = value as Record<string, unknown>;
  const rules: IrgatRules = {};
  for (const { id } of RULE_CATEGORIES) {
    const level = entry[id];
    if (isLevel(level) && level !== "ask") rules[id] = level;
  }
  const list = normalizePreapproved(
    Array.isArray(entry.preapproved) ? entry.preapproved : [],
  );
  if (list.length) rules.preapproved = list;
  return Object.keys(rules).length ? rules : undefined;
}

/** Trimmed, lowercase, without blanks or repeats. */
export function normalizePreapproved(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const entry = value.trim().toLowerCase().slice(0, PREAPPROVED_ENTRY_MAX);
    if (entry) seen.add(entry);
  }
  return [...seen].slice(0, PREAPPROVED_MAX);
}

/** Which rule a step falls under, from the kind its agent gave it. */
export function ruleCategory(kind: string | undefined): IrgatRuleCategory {
  switch (kind) {
    case "execute":
      return "execute";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "read":
    case "search":
      return "read";
    default:
      return "other";
  }
}

/** Whether a step is one the user listed: a command's start, or a path. */
export function preapprovedStep(block: Block, list: readonly string[]): boolean {
  if (!list.length) return false;
  const title = (block.tool?.title || block.text).trim().toLowerCase();
  const path = (block.tool?.preview?.path ?? "").toLowerCase();
  return list.some(
    (entry) =>
      title === entry ||
      title.startsWith(`${entry} `) ||
      (!!path && path.includes(entry)),
  );
}

/**
 * The answer a rule gives to a step waiting on approval, or "ask" to leave
 * it with the user. "handoff" is a refusal the user sees as theirs to do.
 */
export function ruleDecision(
  rules: IrgatRules | undefined,
  block: Block,
): "allow" | "handoff" | "ask" {
  if (!rules) return "ask";
  const level = rules[ruleCategory(block.tool?.kind)] ?? "ask";
  if (level === "allow") return "allow";
  if (level === "handoff") return "handoff";
  if (level === "preapproved")
    return preapprovedStep(block, rules.preapproved ?? []) ? "allow" : "ask";
  return "ask";
}

/**
 * The Irgat whose rules cover a session: its own chats, and sessions it
 * started. Anything else follows the user's own approvals.
 */
export function irgatRulesFor(
  session: Pick<Session, "id">,
  irgats?: readonly Irgat[],
): IrgatRules | undefined {
  const irgat =
    irgatForSession(session.id) ?? irgatThatStarted(session.id, irgats);
  return irgat?.rules;
}

/**
 * The approvals in a session a rule answers, with the answer. Approvals the
 * app asks for itself (project access, a habit's relayed step) are the
 * user's alone.
 */
export function ruledApprovals(
  session: Session,
  rules: IrgatRules | undefined,
): { block: Block; decision: "allow" | "handoff" }[] {
  if (!rules) return [];
  const ruled: { block: Block; decision: "allow" | "handoff" }[] = [];
  for (const block of session.blocks) {
    if (!block.approval || block.approval.decided) continue;
    if (block.irgatProjectAccess || block.irgatHabit) continue;
    const decision = ruleDecision(rules, block);
    if (decision !== "ask") ruled.push({ block, decision });
  }
  return ruled;
}

export function saveIrgatRules(irgatId: string, rules: IrgatRules): void {
  const parsed = parseIrgatRules(rules);
  updateIrgat(irgatId, ({ rules: _, ...irgat }) =>
    parsed ? { ...irgat, rules: parsed } : irgat,
  );
}

export function loadIrgatRules(irgatId: string): IrgatRules {
  return findIrgat(irgatId)?.rules ?? {};
}
