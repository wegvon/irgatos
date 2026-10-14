import { pathKey } from "../../../shared/lib/paths";
import { HARNESS_TITLE, sessionDisplayTitle, type Session } from "./session";
import { sessionReferenceId, sessionReferenceSlug } from "./sessionReferences";
import { SESSION_ACTIVITY_LABEL, sessionActivity } from "./sessionMessaging";

/**
 * An agent's request to message another session, written on its own line:
 *
 *     @send:"Session title" Run the e2e suite and report what fails.
 *     @ask:3f2a9c1e Which port does the API listen on?
 *
 * The message runs to the next blank line or directive. `@ask` also returns
 * the target's answer to the sender; `siblings` addresses every session open
 * in the sender's project.
 */
export type SessionMessageDirective = {
  kind: "send" | "ask";
  target: string;
  text: string;
};

export const BROADCAST_TARGETS = new Set(["siblings", "all", "*"]);

const DIRECTIVE_RE =
  /^\s{0,3}@(send|ask):(?:"([^"\n]+)"|\[([^\]\n]+)\]|(\S+))[ \t]*(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** Quick check before parsing a whole reply. */
export function mayContainSessionMessageDirective(text: string): boolean {
  return text.includes("@send:") || text.includes("@ask:");
}

export function parseSessionMessageDirectives(
  text: string,
): SessionMessageDirective[] {
  if (!mayContainSessionMessageDirective(text)) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: SessionMessageDirective[] = [];
  let fence: string | null = null;
  let current: { kind: "send" | "ask"; target: string; body: string[] } | null =
    null;
  const flush = () => {
    if (!current) return;
    const body = current.body.join("\n").trim();
    if (body && current.target.trim()) {
      out.push({ kind: current.kind, target: current.target.trim(), text: body });
    }
    current = null;
  };
  for (const line of lines) {
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence == null) {
        flush();
        fence = marker[0]!.repeat(3);
      } else if (marker.startsWith(fence)) {
        fence = null;
      }
      continue;
    }
    if (fence != null) continue;
    const match = DIRECTIVE_RE.exec(line);
    if (match) {
      flush();
      current = {
        kind: match[1] as "send" | "ask",
        target: match[2] ?? match[3] ?? match[4] ?? "",
        body: match[5] ? [match[5]] : [],
      };
      continue;
    }
    if (!current) continue;
    if (!line.trim()) {
      if (current.body.length) flush();
      continue;
    }
    current.body.push(line);
  }
  flush();
  return out;
}

export type DirectiveResolution =
  | { ok: true; targets: Session[] }
  | { ok: false; error: string };

/**
 * Sessions a directive addresses. An exact id prefix wins, then an exact
 * title, then a title slug; siblings in the sender's project win ties.
 */
export function resolveDirectiveTarget(
  target: string,
  source: Pick<Session, "id" | "cwd">,
  candidates: readonly Session[],
): DirectiveResolution {
  const others = candidates.filter((session) => session.id !== source.id);
  const project = pathKey(source.cwd);
  const siblings = others.filter((session) => pathKey(session.cwd) === project);
  const wanted = target.trim();
  if (BROADCAST_TARGETS.has(wanted.toLowerCase())) {
    return siblings.length
      ? { ok: true, targets: siblings }
      : { ok: false, error: "No other sessions are open in this project." };
  }
  const lower = wanted.toLowerCase();
  const byId = others.filter(
    (session) =>
      session.id.toLowerCase() === lower ||
      (lower.length >= 6 && session.id.toLowerCase().startsWith(lower)) ||
      sessionReferenceId(session.id) === lower,
  );
  const titleOf = (session: Session) =>
    sessionDisplayTitle(session.title, session.harness);
  const byTitle = others.filter(
    (session) => titleOf(session).trim().toLowerCase() === lower,
  );
  const slug = sessionReferenceSlug(wanted);
  const bySlug = slug
    ? others.filter((session) => sessionReferenceSlug(titleOf(session)) === slug)
    : [];
  for (const matches of [byId, byTitle, bySlug]) {
    if (!matches.length) continue;
    if (matches.length === 1) return { ok: true, targets: matches };
    const local = matches.filter((session) => siblings.includes(session));
    if (local.length === 1) return { ok: true, targets: local };
    return {
      ok: false,
      error: `"${wanted}" matches ${matches.length} sessions; use its id.`,
    };
  }
  return { ok: false, error: `No open session is called "${wanted}".` };
}

/** Prompt note that tells an agent which sessions it can message, and how. */
export function cooperativeBridgeBrief(
  source: Pick<Session, "id" | "cwd">,
  candidates: readonly Session[],
): string | null {
  const project = pathKey(source.cwd);
  const siblings = candidates.filter(
    (session) => session.id !== source.id && pathKey(session.cwd) === project,
  );
  if (!siblings.length) return null;
  const rows = siblings.map((session) => {
    const title = sessionDisplayTitle(session.title, session.harness);
    const id = sessionReferenceId(session.id) ?? session.id;
    const activity = SESSION_ACTIVITY_LABEL[sessionActivity(session)];
    return `- "${title}" (id ${id}; ${HARNESS_TITLE[session.harness]}, ${session.model || "default model"}; ${activity.toLowerCase()})`;
  });
  return [
    "<irgatos-session-bridge>",
    "Cooperative mode is on: you can message the other sessions open in this project.",
    "Write a directive on its own line, outside code blocks; the message runs to the next blank line:",
    '@send:"<session title or id>" <message>  - hand off a task; that session starts on it right away.',
    '@ask:"<session title or id>" <question>  - ask something; their answer is delivered back to you.',
    "Use @send:siblings to message all of them. Only message another session when it clearly helps.",
    "Open sessions:",
    ...rows,
    "</irgatos-session-bridge>",
  ].join("\n");
}

/** Changes whenever the brief an agent was given would read differently. */
export function cooperativeBriefSignature(brief: string | null): string {
  if (!brief) return "";
  // Activity changes every turn; only the set of sessions matters.
  return brief.replace(/; (running|needs input|queued|idle)\)$/gm, ")");
}
