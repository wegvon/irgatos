import {
  extractSessionArtifacts,
  type WorkspaceArtifact,
} from "../../artifacts/model/workspaceArtifacts";
import type { CompletionGateStatus } from "../../sessions/model/completionGate";
import { CONTINUE_PROMPT } from "../../sessions/model/inFlight";
import type { Block, Session } from "../../sessions/model/session";
import { parseLimitations, renderCriteriaMarkdown } from "./criteria";
import type { GoalView } from "./goals";

/**
 * What a goal delivered, put so the user can judge it without reading code:
 * the agent's own account, the checks that ran, what can be looked at, and
 * what it says it left out. The changed files stay one click away.
 */

export type GoalCheckRun = {
  label: string;
  /** The command, when it adds to the label. */
  command?: string;
  state: "passed" | "failed" | "running";
  /** The Completion Gate ran it, not the agent. */
  gate?: boolean;
};

export type GoalPreview = {
  key: string;
  title: string;
  kind: "artifact" | "url";
  artifact?: WorkspaceArtifact;
  url?: string;
};

export type GoalResult = {
  /** The chat whose delivery this is. */
  sessionId: string;
  workCwd: string;
  /** The agent's account of what it did, without the tagged lists. */
  summary?: string;
  checks: GoalCheckRun[];
  previews: GoalPreview[];
  limitations: string[];
  /** When the delivering turn started. */
  at: number;
};

const SUMMARY_MAX = 700;
const PREVIEW_MAX = 6;
const CHECK_MAX = 6;
const CHECK_COMMAND =
  /\b(?:test|tests|vitest|jest|pytest|mocha|playwright|cypress|tsc|typecheck|type-check|lint|eslint|clippy|cargo (?:test|check|build)|go (?:test|vet|build)|build|check|verify|swift test|xcodebuild)\b/i;
const LOCAL_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s)<>"'`\]]*)?/gi;
const PREVIEW_FORMATS = new Set(["html", "svg", "mermaid", "image"]);

/** Where the latest delivery starts: the last turn the user, not the app, sent. */
function deliveryStart(blocks: readonly Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role !== "user" || block.draft) continue;
    if (block.internal || block.text.trim() === CONTINUE_PROMPT) continue;
    return index;
  }
  return -1;
}

function finalReply(blocks: readonly Block[], start: number): Block | undefined {
  for (let index = blocks.length - 1; index > start; index--) {
    const block = blocks[index];
    if (block.role === "assistant" && !block.streaming && block.text.trim())
      return block;
  }
  return undefined;
}

/** The reply without its tagged lists, cut at a paragraph near the limit. */
export function deliverySummary(text: string): string | undefined {
  const plain = renderCriteriaMarkdown(
    text
      .replace(/<completion_criteria>[\s\S]*?<\/completion_criteria>/g, "")
      .replace(/<criteria_check>[\s\S]*?<\/criteria_check>/g, "")
      .replace(/<known_limitations>[\s\S]*?<\/known_limitations>/g, ""),
  ).trim();
  if (!plain) return undefined;
  if (plain.length <= SUMMARY_MAX) return plain;
  const cut = plain.lastIndexOf("\n\n", SUMMARY_MAX);
  return `${plain.slice(0, cut > SUMMARY_MAX / 3 ? cut : SUMMARY_MAX).trimEnd()}…`;
}

function shellCommand(block: Block): string | undefined {
  const preview = block.tool?.preview;
  if (preview?.kind === "shell") return preview.query || preview.title;
  const kind = (block.tool?.kind ?? "").toLowerCase();
  if (kind === "execute" || kind === "shell" || kind === "bash")
    return block.tool?.detail || block.tool?.title;
  return undefined;
}

function shortCommand(command: string): string {
  const line = command.split("\n")[0]!.trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** Test, build and lint runs in the delivery, newest result per command. */
export function deliveryChecks(blocks: readonly Block[], start: number): GoalCheckRun[] {
  const runs = new Map<string, GoalCheckRun>();
  for (let index = start + 1; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.role !== "tool" || block.approval?.decided === "deny") continue;
    const command = shellCommand(block);
    if (!command || !CHECK_COMMAND.test(command)) continue;
    const status = (block.tool?.status ?? "").toLowerCase();
    const state: GoalCheckRun["state"] =
      status === "completed" || status === "success"
        ? "passed"
        : status === "failed" || status === "error"
          ? "failed"
          : status === "cancelled" || status === "canceled"
            ? "failed"
            : "running";
    const key = shortCommand(command);
    runs.delete(key);
    runs.set(key, { label: key, state });
  }
  return [...runs.values()].slice(-CHECK_MAX);
}

function gateCheck(status: CompletionGateStatus | undefined): GoalCheckRun | undefined {
  if (!status) return undefined;
  const command = shortCommand(status.command);
  if (status.state === "verified")
    return { label: "Completion Gate", command, state: "passed", gate: true };
  if (status.state === "failed")
    return { label: "Completion Gate", command, state: "failed", gate: true };
  return { label: "Completion Gate", command, state: "running", gate: true };
}

function localUrls(text: string): string[] {
  return [...new Set(text.match(LOCAL_URL) ?? [])].map((url) =>
    url.replace(/[.,;:]+$/, ""),
  );
}

export type GoalResultOptions = {
  gateStatus?: (sessionId: string) => CompletionGateStatus | undefined;
};

/**
 * The newest delivery among the goal's chats that are open, or nothing while
 * none has finished one.
 */
export function goalResult(
  view: GoalView,
  sessionsById: ReadonlyMap<string, Session>,
  options: GoalResultOptions = {},
): GoalResult | undefined {
  let best: { session: Session; start: number; at: number } | undefined;
  for (const member of view.members) {
    if (!member.open || member.link.role === "worker") continue;
    const session = sessionsById.get(member.link.sessionId);
    if (!session || session.busy) continue;
    const start = deliveryStart(session.blocks);
    if (start < 0 || !finalReply(session.blocks, start)) continue;
    const turn = session.blocks[start];
    const at = turn.startedAt ?? turn.sentAt ?? 0;
    if (!best || at >= best.at) best = { session, start, at };
  }
  if (!best) return undefined;
  const { session, start, at } = best;
  const reply = finalReply(session.blocks, start)!;
  const checks = deliveryChecks(session.blocks, start);
  const gate = gateCheck(options.gateStatus?.(session.id));
  if (gate) checks.unshift(gate);
  // Workers report through their lead, so their checks count too.
  for (const member of view.members) {
    if (member.link.role !== "worker" || !member.open) continue;
    const worker = sessionsById.get(member.link.sessionId);
    if (!worker) continue;
    const workerStart = deliveryStart(worker.blocks);
    for (const run of deliveryChecks(worker.blocks, workerStart))
      if (!checks.some((check) => check.label === run.label)) checks.push(run);
  }
  const delivered = { ...session, blocks: session.blocks.slice(start) };
  const artifacts = view.members
    .filter((member) => member.open)
    .flatMap((member) => {
      const source =
        member.link.sessionId === session.id
          ? delivered
          : sessionsById.get(member.link.sessionId);
      return source ? extractSessionArtifacts(source) : [];
    })
    .filter((artifact) =>
      PREVIEW_FORMATS.has(artifact.format) ||
      artifact.origin === "document" ||
      artifact.origin === "irgat-document",
    );
  const previews: GoalPreview[] = [];
  const seen = new Set<string>();
  for (const url of localUrls(reply.text)) {
    previews.push({ key: `url:${url}`, title: url.replace(/^https?:\/\//, ""), kind: "url", url });
  }
  for (const artifact of artifacts) {
    const key = artifact.path ?? artifact.id;
    if (seen.has(key)) continue;
    seen.add(key);
    previews.push({ key: `artifact:${key}`, title: artifact.title, kind: "artifact", artifact });
  }
  const limitations = [
    ...(parseLimitations(reply.text) ?? []),
    ...(view.goal.criteria ?? [])
      .filter((criterion) => criterion.verdict === "unmet" || criterion.verdict === "unverified")
      .map((criterion) =>
        criterion.verdict === "unmet"
          ? `Not met: ${criterion.text}${criterion.evidence ? ` (${criterion.evidence})` : ""}`
          : `Not verified: ${criterion.text}${criterion.evidence ? ` (${criterion.evidence})` : ""}`,
      ),
  ];
  const summary = deliverySummary(reply.text);
  return {
    sessionId: session.id,
    workCwd: session.worktreeCwd || session.cwd,
    ...(summary ? { summary } : {}),
    checks,
    previews: previews.slice(0, PREVIEW_MAX),
    limitations,
    at,
  };
}
