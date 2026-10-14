import jsep from "jsep";
import {
  runCheckCommand,
  type CheckResult,
} from "../../sessions/model/completionGate";
import {
  afterRun,
  HABIT_APPROVAL_WAIT_MS,
  HABIT_SHELL_CONDITION_MAX,
  HABIT_TRIGGER_PAYLOAD_MAX,
  normalizeDelaySeconds,
  runHabitAnyway,
  type Habit,
  type HabitCondition,
  type HabitTrigger,
} from "./irgatHabits";

/**
 * Guards a habit's run passes through, in order: its delay, its condition,
 * then the user's approval. Each step that has to wait is saved on the habit,
 * so a pending delay or approval survives a restart.
 */
export type HabitGuardStage =
  | { stage: "run" }
  /** Still waiting on its delay or the user, until `until`. */
  | { stage: "wait"; reason: "delay" | "approval"; until: number }
  /** Nobody answered the approval in time; skip this run. */
  | { stage: "expired" }
  /** Start waiting out the delay. */
  | { stage: "delay"; until: number }
  | { stage: "check"; condition: HabitCondition }
  /** Ask the user before running. */
  | { stage: "ask" };

export function habitGuardStage(
  habit: Habit,
  now: number,
  conditionPassed = false,
): HabitGuardStage {
  const approval = habit.approval;
  if (approval?.state === "approved") return { stage: "run" };
  if (approval?.state === "pending") {
    const until = approval.requestedAt + HABIT_APPROVAL_WAIT_MS;
    return until > now
      ? { stage: "wait", reason: "approval", until }
      : { stage: "expired" };
  }
  const delayMs = normalizeDelaySeconds(habit.delaySeconds ?? 0) * 1000;
  if (delayMs > 0) {
    if (habit.delayedUntil == null)
      return { stage: "delay", until: now + delayMs };
    if (habit.delayedUntil > now)
      return { stage: "wait", reason: "delay", until: habit.delayedUntil };
  }
  if (habit.ifCondition && !conditionPassed)
    return { stage: "check", condition: habit.ifCondition };
  if (habit.requestApproval) return { stage: "ask" };
  return { stage: "run" };
}

/** Starts the delay; the habit stays requested so it runs when it ends. */
export function delayHabit(habit: Habit, until: number): Habit {
  return { ...habit, runRequested: true, delayedUntil: until };
}

export function askHabitApproval(habit: Habit, now: number): Habit {
  return {
    ...habit,
    runRequested: true,
    approval: { state: "pending", requestedAt: now },
  };
}

export function approveHabit(habit: Habit): Habit {
  if (habit.approval?.state !== "pending") return habit;
  return {
    ...habit,
    runRequested: true,
    approval: { ...habit.approval, state: "approved" },
  };
}

/** Drops the pending run without running it, and records why. */
export function skipHabit(habit: Habit, now: number, reason: string): Habit {
  return afterRun(habit, now, { kind: "skipped", reason, startedAt: now });
}

/**
 * Run now from the app: the user asking is the approval, so it runs at once,
 * past its delay, condition and approval.
 */
export function runHabitNow(habit: Habit, now: number): Habit {
  const { delayedUntil: _delay, ...rest } = runHabitAnyway(habit);
  return {
    ...rest,
    approval: { state: "approved", requestedAt: now },
    trigger: { source: "manual", at: now },
  };
}

/**
 * An outside trigger fired: request a run that passes through the guards.
 * A paused habit ignores it. One already waiting keeps its place and takes
 * the newer payload.
 */
export function triggerHabit(
  habit: Habit,
  trigger: HabitTrigger,
): Habit | undefined {
  if (!habit.enabled) return undefined;
  const payload = trigger.payload?.slice(0, HABIT_TRIGGER_PAYLOAD_MAX);
  return {
    ...habit,
    runRequested: true,
    trigger: {
      source: trigger.source,
      at: trigger.at,
      ...(payload ? { payload } : {}),
    },
  };
}

/** Pausing also drops a run that was waiting on its delay or approval. */
export function pauseHabit(habit: Habit): Habit {
  const {
    delayedUntil,
    approval,
    trigger: _trigger,
    runRequested,
    ...rest
  } = habit;
  const pending = delayedUntil != null || approval != null;
  return {
    ...rest,
    enabled: false,
    ...(runRequested && !pending ? { runRequested } : {}),
  };
}

export type HabitGuardSettings = {
  requestApproval: boolean;
  ifCondition: HabitCondition | null;
  delaySeconds: number;
};

/** Why a condition cannot be saved, or undefined when it can. */
export function habitConditionError(
  condition: HabitCondition,
): string | undefined {
  if (condition.kind === "shell") {
    const command = condition.command.trim();
    if (!command) return "Enter a command to check.";
    if (command.length > HABIT_SHELL_CONDITION_MAX)
      return `Keep the command under ${HABIT_SHELL_CONDITION_MAX} characters.`;
    return undefined;
  }
  try {
    parseHabitExpression(condition.expression);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The habit with new guards. Throws when the condition is not valid. */
export function setHabitGuards(
  habit: Habit,
  settings: HabitGuardSettings,
): Habit {
  const {
    requestApproval: _approval,
    ifCondition: _condition,
    delaySeconds: _delay,
    ...rest
  } = habit;
  let condition: HabitCondition | undefined;
  if (settings.ifCondition) {
    const error = habitConditionError(settings.ifCondition);
    if (error) throw new Error(error);
    condition =
      settings.ifCondition.kind === "shell"
        ? { kind: "shell", command: settings.ifCondition.command.trim() }
        : {
            kind: "expression",
            expression: settings.ifCondition.expression.trim(),
          };
  }
  const delaySeconds = normalizeDelaySeconds(settings.delaySeconds);
  return {
    ...rest,
    ...(settings.requestApproval ? { requestApproval: true } : {}),
    ...(condition ? { ifCondition: condition } : {}),
    ...(delaySeconds ? { delaySeconds } : {}),
  };
}

/** "30s", "5 min", "1 h 30 min" */
export function habitDelayLabel(seconds: number): string {
  const total = normalizeDelaySeconds(seconds);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return [
    hours ? `${hours} h` : "",
    minutes ? `${minutes} min` : "",
    rest ? `${rest}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// Trigger tokens ------------------------------------------------------------

/** 32 random bytes, URL-safe: the secret in a habit's trigger URL. */
export function newHabitTriggerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function habitTriggerUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/habits/${token}`;
}

/** A command that fires the habit; anything sent as the body reaches the run. */
export function habitTriggerCommand(port: number, token: string): string {
  return `curl -X POST ${habitTriggerUrl(port, token)} -d 'optional payload'`;
}

// Conditions ----------------------------------------------------------------

export const HABIT_CONDITION_TIMEOUT_MS = 60_000;
const CONDITION_OUTPUT_KEPT = 300;

export type HabitConditionResult =
  | { kind: "pass" }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; error: string };

function outputTail(output: string): string {
  const text = output.trim();
  if (!text) return "";
  return `\n${
    text.length > CONDITION_OUTPUT_KEPT
      ? `…${text.slice(-CONDITION_OUTPUT_KEPT)}`
      : text
  }`;
}

/**
 * Checks the habit's condition. False skips the run; a condition that cannot
 * be checked, or a shell check that hangs, fails it so the user hears of it.
 */
export async function checkHabitCondition(
  habit: Habit,
  condition: HabitCondition,
  cwd: string,
  now: number,
  run: (
    cwd: string,
    command: string,
    timeoutMs: number,
  ) => Promise<CheckResult> = runCheckCommand,
): Promise<HabitConditionResult> {
  if (condition.kind === "expression") {
    try {
      return evaluateHabitExpression(
        condition.expression,
        habitExpressionContext(habit, now),
      )
        ? { kind: "pass" }
        : {
            kind: "skip",
            reason: `Its condition was false: ${condition.expression}`,
          };
    } catch (error) {
      return {
        kind: "fail",
        error: `Its condition could not be checked: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  let result: CheckResult;
  try {
    result = await run(cwd, condition.command, HABIT_CONDITION_TIMEOUT_MS);
  } catch (error) {
    return {
      kind: "fail",
      error: `Its condition could not run: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  switch (result.status) {
    case "passed":
      return { kind: "pass" };
    case "failed":
      return {
        kind: "skip",
        reason: `\`${condition.command}\` exited with code ${
          result.exitCode ?? "?"
        }.${outputTail(result.output)}`,
      };
    case "timedOut":
      return {
        kind: "fail",
        error: `Its condition took longer than ${
          HABIT_CONDITION_TIMEOUT_MS / 1000
        } seconds and was stopped.`,
      };
    default:
      return {
        kind: "fail",
        error: `Its condition could not run.${outputTail(result.output)}`,
      };
  }
}

// Expressions ---------------------------------------------------------------

export const HABIT_EXPRESSION_MAX = 500;
const MAX_DEPTH = 32;

jsep.addBinaryOp("contains", 7);
jsep.addBinaryOp("startsWith", 7);
jsep.addBinaryOp("endsWith", 7);

const BINARY = new Set([
  "||",
  "&&",
  "==",
  "!=",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "contains",
  "startsWith",
  "endsWith",
]);
const UNARY = new Set(["!", "-"]);

export type HabitExpressionContext = {
  now: {
    hour: number;
    minute: number;
    /** 0 is Sunday. */
    weekday: number;
    /** Day of the month. */
    day: number;
    /** 1 is January. */
    month: number;
    year: number;
    /** "YYYY-MM-DD", local. */
    date: string;
  };
  trigger: {
    source: "schedule" | "webhook" | "manual";
    payload: string | null;
    /** The payload parsed, when it is a JSON object or array. */
    json: unknown;
  };
  last: { outcome: string | null; hoursAgo: number | null };
  runs: { count: number };
};

export const HABIT_EXPRESSION_NAMES: (keyof HabitExpressionContext)[] = [
  "now",
  "trigger",
  "last",
  "runs",
];

function payloadJson(payload: string | undefined): unknown {
  const text = payload?.trim();
  if (!text || (text[0] !== "{" && text[0] !== "[")) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function habitExpressionContext(
  habit: Habit,
  now: number,
): HabitExpressionContext {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastAt = habit.runs?.[0]?.at ?? habit.lastRunAt;
  return {
    now: {
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    },
    trigger: {
      source: habit.trigger?.source ?? "schedule",
      payload: habit.trigger?.payload ?? null,
      json: payloadJson(habit.trigger?.payload),
    },
    last: {
      outcome: habit.runs?.[0]?.outcome ?? habit.lastOutcome ?? null,
      hoursAgo:
        lastAt != null
          ? Math.round(((now - lastAt) / 3_600_000) * 100) / 100
          : null,
    },
    runs: { count: habit.runs?.length ?? 0 },
  };
}

export class HabitExpressionError extends Error {}

/**
 * Parses a guard expression and checks it uses only what guards allow:
 * comparisons, and/or/not, literals and paths into the context. There are no
 * calls, assignments or arithmetic, and nothing is ever evaluated as code.
 */
export function parseHabitExpression(text: string): jsep.Expression {
  const source = text.trim();
  if (!source) throw new HabitExpressionError("Enter a condition.");
  if (source.length > HABIT_EXPRESSION_MAX)
    throw new HabitExpressionError(
      `Keep the condition under ${HABIT_EXPRESSION_MAX} characters.`,
    );
  let tree: jsep.Expression;
  try {
    tree = jsep(source);
  } catch (error) {
    throw new HabitExpressionError(
      error instanceof Error ? error.message : String(error),
    );
  }
  validate(tree, 0);
  return tree;
}

function validate(node: jsep.Expression, depth: number): void {
  if (depth > MAX_DEPTH)
    throw new HabitExpressionError("The condition is nested too deeply.");
  switch (node.type) {
    case "Literal": {
      const value = (node as jsep.Literal).value;
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      )
        throw new HabitExpressionError("Unsupported value in the condition.");
      return;
    }
    case "Identifier": {
      const name = (node as jsep.Identifier).name;
      if (!(HABIT_EXPRESSION_NAMES as string[]).includes(name))
        throw new HabitExpressionError(
          `Unknown name "${name}". Use ${HABIT_EXPRESSION_NAMES.join(", ")}.`,
        );
      return;
    }
    case "MemberExpression": {
      const member = node as jsep.MemberExpression;
      validate(member.object, depth + 1);
      if (member.computed) {
        if (member.property.type !== "Literal")
          throw new HabitExpressionError(
            "Use a quoted name or number inside [ ].",
          );
        validate(member.property, depth + 1);
      } else if (member.property.type !== "Identifier") {
        throw new HabitExpressionError("Unsupported property in the condition.");
      }
      return;
    }
    case "UnaryExpression": {
      const unary = node as jsep.UnaryExpression;
      if (!UNARY.has(unary.operator))
        throw new HabitExpressionError(
          `"${unary.operator}" is not allowed in a condition.`,
        );
      validate(unary.argument, depth + 1);
      return;
    }
    case "BinaryExpression":
    case "LogicalExpression": {
      const binary = node as jsep.BinaryExpression;
      if (!BINARY.has(binary.operator))
        throw new HabitExpressionError(
          `"${binary.operator}" is not allowed in a condition.`,
        );
      validate(binary.left, depth + 1);
      validate(binary.right, depth + 1);
      return;
    }
    case "CallExpression":
      throw new HabitExpressionError("A condition cannot call functions.");
    case "Compound":
      throw new HabitExpressionError("Write the condition as one expression.");
    default:
      throw new HabitExpressionError(
        `${node.type} is not allowed in a condition.`,
      );
  }
}

/** Whether the expression holds in this context. Throws on invalid input. */
export function evaluateHabitExpression(
  text: string,
  context: HabitExpressionContext,
): boolean {
  return truthy(evaluate(parseHabitExpression(text), context));
}

function truthy(value: unknown): boolean {
  return (
    value !== null &&
    value !== undefined &&
    value !== false &&
    value !== 0 &&
    value !== "" &&
    !Number.isNaN(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Own data only: a path never reaches a prototype, method or getter. */
function property(target: unknown, key: unknown): unknown {
  if (typeof key !== "string" && typeof key !== "number") return null;
  if (typeof target === "string" || Array.isArray(target)) {
    if (key === "length") return target.length;
    const index = typeof key === "number" ? key : Number(key);
    if (!Number.isInteger(index) || index < 0) return null;
    return target[index] ?? null;
  }
  if (!isPlainObject(target)) return null;
  const name = String(key);
  return Object.prototype.hasOwnProperty.call(target, name)
    ? (target[name] ?? null)
    : null;
}

function compare(
  operator: string,
  left: unknown,
  right: unknown,
): boolean | null {
  if (
    !(
      (typeof left === "number" && typeof right === "number") ||
      (typeof left === "string" && typeof right === "string")
    )
  )
    return false;
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
  }
  return null;
}

function evaluate(node: jsep.Expression, context: HabitExpressionContext): unknown {
  switch (node.type) {
    case "Literal":
      return (node as jsep.Literal).value;
    case "Identifier":
      return context[(node as jsep.Identifier).name as keyof HabitExpressionContext];
    case "MemberExpression": {
      const member = node as jsep.MemberExpression;
      const target = evaluate(member.object, context);
      const key = member.computed
        ? (member.property as jsep.Literal).value
        : (member.property as jsep.Identifier).name;
      return property(target, key);
    }
    case "UnaryExpression": {
      const unary = node as jsep.UnaryExpression;
      const value = evaluate(unary.argument, context);
      if (unary.operator === "!") return !truthy(value);
      return typeof value === "number" ? -value : null;
    }
    case "BinaryExpression":
    case "LogicalExpression": {
      const binary = node as jsep.BinaryExpression;
      const left = evaluate(binary.left, context);
      if (binary.operator === "&&")
        return truthy(left) && truthy(evaluate(binary.right, context));
      if (binary.operator === "||")
        return truthy(left) || truthy(evaluate(binary.right, context));
      const right = evaluate(binary.right, context);
      switch (binary.operator) {
        case "==":
        case "===":
          return (left ?? null) === (right ?? null);
        case "!=":
        case "!==":
          return (left ?? null) !== (right ?? null);
        case "contains":
          if (typeof left === "string" && typeof right === "string")
            return left.includes(right);
          if (Array.isArray(left)) return left.some((item) => item === right);
          return false;
        case "startsWith":
          return (
            typeof left === "string" &&
            typeof right === "string" &&
            left.startsWith(right)
          );
        case "endsWith":
          return (
            typeof left === "string" &&
            typeof right === "string" &&
            left.endsWith(right)
          );
        default:
          return compare(binary.operator, left, right);
      }
    }
  }
  throw new HabitExpressionError(`${node.type} is not allowed in a condition.`);
}
