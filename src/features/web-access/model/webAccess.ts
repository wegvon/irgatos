import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ApprovalDecision } from "../../../integrations/harness";
import { buildFleet, fleetRequests } from "../../fleet/model/fleet";
import { irgatForSession, irgatLook } from "../../irgats/model/irgat";
import {
  sessionDisplayTitle,
  sessionWorkCwd,
  type Block,
  type Session,
} from "../../sessions/model/session";
import { toolCallLabel } from "../../sessions/model/transcriptActivity";
import {
  buildQuestionReply,
  type UserQuestionReply,
} from "../../sessions/model/userQuestion";

/**
 * Browser access: the Rust side serves a small page to the user's other
 * devices and relays each API call here, so the browser always reads and
 * acts on this window's live sessions.
 */
export type WebAccessDeps = {
  sessions: () => readonly Session[];
  submit: (sessionId: string, text: string) => boolean;
  approve: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  answer: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ) => void;
  stop: (sessionId: string) => void;
};

export type WebAccessStatus = {
  enabled: boolean;
  running: boolean;
  port: number;
  token: string;
  error: string | null;
  urls: string[];
  tailscale: boolean;
};

/** Newest blocks a browser gets per session; older ones stay on the Mac. */
export const WEB_TRANSCRIPT_LIMIT = 80;
const TEXT_MAX = 20_000;

type Input = Record<string, unknown>;

function text(input: Input, key: string, max = 100_000): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  if (value.length > max) throw new Error(`${key} is too long`);
  return value;
}

function requestId(input: Input): number {
  const value = Number(input.requestId);
  if (!Number.isSafeInteger(value)) throw new Error("Missing requestId");
  return value;
}

function irgatName(sessionId: string): string | undefined {
  const irgat = irgatForSession(sessionId);
  return irgat ? irgatLook(irgat).name : undefined;
}

function findSession(deps: WebAccessDeps, input: Input): Session {
  const id = text(input, "sessionId" in input ? "sessionId" : "id", 200);
  const session = deps.sessions().find((entry) => entry.id === id);
  if (!session) throw new Error("This chat is not open in Irgatos.");
  return session;
}

function clip(value: string): string {
  return value.length > TEXT_MAX
    ? `${value.slice(0, TEXT_MAX)}\n\n… (open on the Mac for the rest)`
    : value;
}

function shownBlock(block: Block): boolean {
  return !block.internal && !block.draft && !block.irgatSessionCompletion;
}

export function webBlock(block: Block, cwd: string) {
  return {
    id: block.id,
    role: block.role,
    text: block.role === "tool" ? "" : clip(block.text ?? ""),
    ...(block.streaming ? { streaming: true } : {}),
    ...(block.tool
      ? {
          tool: {
            label: toolCallLabel(block, cwd),
            ...(block.tool.status ? { status: block.tool.status } : {}),
          },
        }
      : {}),
    ...(block.approval
      ? {
          approval: {
            requestId: block.approval.requestId,
            ...(block.approval.decided
              ? { decided: block.approval.decided }
              : {}),
          },
        }
      : {}),
    ...((block.sentAt ?? block.startedAt)
      ? { at: block.sentAt ?? block.startedAt }
      : {}),
  };
}

/** Answers one relayed call. Throws with a message the browser shows. */
export function handleWebAccess(
  deps: WebAccessDeps,
  action: string,
  input: Input,
): unknown {
  switch (action) {
    case "overview": {
      const fleet = buildFleet(deps.sessions(), { irgatName });
      return {
        needsYou: fleet.needsYou,
        running: fleet.running,
        review: fleet.review,
        interrupted: fleet.interrupted,
        idle: fleet.idle,
        at: Date.now(),
      };
    }
    case "session": {
      const session = findSession(deps, input);
      const cwd = sessionWorkCwd(session);
      const blocks = session.blocks.filter(shownBlock);
      return {
        id: session.id,
        title: sessionDisplayTitle(session.title, session.harness),
        harness: session.harness,
        irgat: irgatName(session.id),
        cwd: session.cwd,
        busy: !!session.busy,
        requests: fleetRequests(session),
        omitted: Math.max(0, blocks.length - WEB_TRANSCRIPT_LIMIT),
        blocks: blocks
          .slice(-WEB_TRANSCRIPT_LIMIT)
          .map((block) => webBlock(block, cwd)),
      };
    }
    case "send": {
      const session = findSession(deps, input);
      const message = text(input, "text").trim();
      if (!message) throw new Error("Write a message first.");
      if (!deps.submit(session.id, message))
        throw new Error("Irgatos could not send this message right now.");
      return { sent: true };
    }
    case "approval": {
      const session = findSession(deps, input);
      const id = requestId(input);
      const decision = input.decision;
      if (decision !== "allow" && decision !== "deny")
        throw new Error("Decision must be allow or deny");
      const open = fleetRequests(session).some(
        (request) => request.kind === "approval" && request.requestId === id,
      );
      if (!open) throw new Error("This request was already answered.");
      deps.approve(session.id, id, decision);
      return { decided: decision };
    }
    case "answer": {
      const session = findSession(deps, input);
      const prompt = session.pendingQuestion;
      if (!prompt || prompt.requestId !== requestId(input))
        throw new Error("This question was already answered.");
      const answers = stringLists(input.answers);
      const custom = strings(input.custom);
      const reply =
        input.skip === true
          ? ({ kind: "skipped" } as const)
          : buildQuestionReply(prompt.questions, answers, custom);
      deps.answer(session.id, prompt.requestId, reply);
      return { answered: reply.kind };
    }
    case "stop": {
      const session = findSession(deps, input);
      if (session.busy) deps.stop(session.id);
      return { stopped: !!session.busy };
    }
    default:
      throw new Error("Unknown action");
  }
}

function strings(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value))
    if (typeof entry === "string") out[key] = entry;
  return out;
}

function stringLists(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value))
    if (Array.isArray(entry))
      out[key] = entry.filter(
        (item): item is string => typeof item === "string",
      );
  return out;
}

/** Answers the page's calls while this is the main window. */
export function connectWebAccess(deps: () => WebAccessDeps): () => void {
  const window = getCurrentWebviewWindow();
  if (window.label !== "main") return () => {};
  const unlisten = window.listen<{
    id: string;
    action: string;
    input: Input;
  }>("web-access-request", ({ payload }) => {
    let response: unknown;
    try {
      response = {
        ok: true,
        result: handleWebAccess(deps(), payload.action, payload.input ?? {}),
      };
    } catch (error) {
      response = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    void invoke("web_access_reply", { id: payload.id, response }).catch(
      console.error,
    );
  });
  return () => void unlisten.then((stop) => stop());
}

export const webAccessStatus = () =>
  invoke<WebAccessStatus>("web_access_status");
export const setWebAccessEnabled = (enabled: boolean) =>
  invoke<WebAccessStatus>("web_access_set_enabled", { enabled });
export const rotateWebAccessToken = () =>
  invoke<WebAccessStatus>("web_access_rotate_token");
