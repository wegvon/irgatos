import { describe, expect, it } from "vitest";
import { CONTINUE_PROMPT, INTERRUPT_MESSAGE } from "./inFlight";
import { newSession, type Attachment, type Block, type Session } from "./session";
import {
  classifySessionError,
  dismissSessionInterruption,
  INTERRUPTION_TITLE,
  planSessionResume,
  resumeContext,
  sessionInterruption,
} from "./sessionInterruption";

const user = (id: string, text: string, patch: Partial<Block> = {}): Block => ({
  id,
  role: "user",
  text,
  ...patch,
});
const assistant = (id: string, text: string): Block => ({
  id,
  role: "assistant",
  text,
});
const errorNotice = (id: string, text: string): Block => ({
  id,
  role: "system",
  text,
  notice: "error",
});
const restartNotice = (id = "n1"): Block => ({
  id,
  role: "system",
  text: INTERRUPT_MESSAGE,
  notice: "interrupt",
});

function session(blocks: Block[], patch: Partial<Session> = {}): Session {
  return { ...newSession("claude", "/tmp/project"), blocks, ...patch };
}

describe("classifySessionError", () => {
  it.each([
    ["Claude Code exited", "exit"],
    ["Codex app-server exited with code 1", "exit"],
    ["process terminated unexpectedly (SIGKILL)", "exit"],
    ["agent stopped responding", "exit"],
    ["thread 'main' panicked at src/main.rs", "crash"],
    ["Segmentation fault (core dumped)", "crash"],
    ["FATAL ERROR: JavaScript heap out of memory", "crash"],
    ["Unhandled exception in agent", "crash"],
    ["read ECONNRESET", "disconnect"],
    ["WebSocket closed before the turn finished", "disconnect"],
    ["socket hang up", "disconnect"],
    ["Connection lost to the remote agent", "disconnect"],
    ["Unexpected end of JSON input", "disconnect"],
    ["TypeError: fetch failed", "disconnect"],
  ])("reads %s as %s", (message, kind) => {
    expect(classifySessionError(message)).toBe(kind);
  });

  it.each([
    "",
    "Invalid API key",
    "Context window exceeded",
    "Permission denied: cannot write to /etc/hosts",
    "You've hit your usage limit. Try again in 4h 42m.",
    "Claude AI usage limit reached|1760430000",
  ])("leaves %s to its own recovery", (message) => {
    expect(classifySessionError(message)).toBeUndefined();
  });

  it("titles every kind", () => {
    expect(Object.keys(INTERRUPTION_TITLE).sort()).toEqual([
      "crash",
      "disconnect",
      "exit",
      "restart",
    ]);
  });
});

describe("sessionInterruption", () => {
  it("finds an app restart mid-turn", () => {
    expect(
      sessionInterruption(
        session([user("u1", "Fix the build"), assistant("a1", "Looking…"), restartNotice()]),
      ),
    ).toEqual({ kind: "restart", blockId: "n1", message: INTERRUPT_MESSAGE });
  });

  it("finds a crash or exit reported as an error", () => {
    expect(
      sessionInterruption(
        session([user("u1", "Fix the build"), errorNotice("e1", "Claude Code exited")]),
      ),
    ).toMatchObject({ kind: "exit", blockId: "e1" });
    expect(
      sessionInterruption(
        session([user("u1", "Fix it"), errorNotice("e1", "connection reset by peer")]),
      ),
    ).toMatchObject({ kind: "disconnect" });
  });

  it("looks past plain status rows after the failure", () => {
    expect(
      sessionInterruption(
        session([
          user("u1", "Fix it"),
          errorNotice("e1", "Codex app-server exited"),
          { id: "s1", role: "system", text: "Model switched to gpt-5" },
        ]),
      ),
    ).toMatchObject({ kind: "exit", blockId: "e1" });
  });

  it("ignores ordinary errors and anything the user has moved past", () => {
    expect(
      sessionInterruption(session([user("u1", "Hi"), errorNotice("e1", "Invalid API key")])),
    ).toBeUndefined();
    expect(
      sessionInterruption(
        session([
          user("u1", "Hi"),
          errorNotice("e1", "Claude Code exited"),
          user("u2", "Try again"),
          assistant("a2", "Done."),
        ]),
      ),
    ).toBeUndefined();
    expect(
      sessionInterruption(
        session([
          user("u1", "Hi"),
          errorNotice("e1", "Claude Code exited"),
          errorNotice("e2", "Invalid API key"),
        ]),
      ),
    ).toBeUndefined();
  });

  it("stays out of the way while busy or blocked on something else", () => {
    const blocks = [user("u1", "Hi"), errorNotice("e1", "Claude Code exited")];
    expect(sessionInterruption(session(blocks, { busy: true }))).toBeUndefined();
    expect(sessionInterruption(session(blocks, { worktreeRemoved: true }))).toBeUndefined();
    expect(sessionInterruption(session(blocks, { usageLimit: {} }))).toBeUndefined();
  });

  it("needs a sent user turn to resume", () => {
    expect(sessionInterruption(session([restartNotice()]))).toBeUndefined();
    expect(
      sessionInterruption(
        session([user("u1", "Hi", { draft: true }), restartNotice()]),
      ),
    ).toBeUndefined();
  });

  it("hides a dismissed interruption but shows the next one", () => {
    const first = session([user("u1", "Hi"), errorNotice("e1", "Claude Code exited")]);
    const dismissed = dismissSessionInterruption(first);
    expect(dismissed.dismissedInterruptionId).toBe("e1");
    expect(sessionInterruption(dismissed)).toBeUndefined();
    const again = {
      ...dismissed,
      blocks: [
        ...dismissed.blocks,
        user("u2", "Again"),
        errorNotice("e2", "Claude Code exited"),
      ],
    };
    expect(sessionInterruption(again)).toMatchObject({ blockId: "e2" });
  });

  it("leaves a session without an interruption untouched on dismiss", () => {
    const quiet = session([user("u1", "Hi"), assistant("a1", "Hello")]);
    expect(dismissSessionInterruption(quiet)).toBe(quiet);
  });
});

describe("planSessionResume", () => {
  const image: Attachment = {
    id: "att1",
    name: "screen.png",
    mimeType: "image/png",
    kind: "image",
    size: 10,
    path: "/tmp/screen.png",
  };

  it("continues the provider's own thread when it can", () => {
    const plan = planSessionResume(
      session(
        [user("u1", "Fix the build"), assistant("a1", "Running tests"), errorNotice("e1", "Claude Code exited")],
        { providerSessionId: "thread-1" },
      ),
      true,
    );
    expect(plan).toEqual({
      prompt: CONTINUE_PROMPT,
      attachments: [],
      mode: "continue",
      releaseQueue: false,
    });
  });

  it("re-sends a prompt the agent never answered, with its attachments", () => {
    const plan = planSessionResume(
      session(
        [user("u1", "Look at this", { attachments: [image] }), restartNotice()],
        { providerSessionId: "thread-1" },
      ),
      true,
    );
    expect(plan).toEqual({
      prompt: "Look at this",
      attachments: [image],
      mode: "resend",
      releaseQueue: false,
    });
  });

  it("counts a tool call as an answer", () => {
    const plan = planSessionResume(
      session(
        [
          user("u1", "Run tests"),
          { id: "t1", role: "tool", text: "", tool: { title: "npm test" } },
          restartNotice(),
        ],
        { providerSessionId: "thread-1" },
      ),
      true,
    );
    expect(plan?.mode).toBe("continue");
  });

  it("re-hydrates the transcript when there is no thread to resume", () => {
    const plan = planSessionResume(
      session([
        user("u1", "Add a login page"),
        assistant("a1", "Added src/login.tsx with the form."),
        errorNotice("e1", "socket hang up"),
      ]),
      true,
    );
    expect(plan?.mode).toBe("continue");
    expect(plan?.context).toContain("<resumed_session>");
    expect(plan?.context).toContain("Add a login page");
    expect(plan?.context).toContain("</resumed_session>");
  });

  it("re-hydrates when the harness cannot resume natively", () => {
    const plan = planSessionResume(
      session(
        [user("u1", "Add a login page"), assistant("a1", "Working"), errorNotice("e1", "Claude Code exited")],
        { providerSessionId: "thread-1" },
      ),
      false,
    );
    expect(plan?.context).toContain("Add a login page");
  });

  it("recaps only the turns before a re-sent prompt", () => {
    const plan = planSessionResume(
      session([
        user("u1", "Set up the repo"),
        assistant("a1", "Repo ready."),
        user("u2", "Now add CI"),
        restartNotice(),
      ]),
      false,
    );
    expect(plan?.mode).toBe("resend");
    expect(plan?.prompt).toBe("Now add CI");
    expect(plan?.context).toContain("Set up the repo");
    expect(plan?.context).not.toContain("Now add CI");
  });

  it("sends a re-sent first prompt without a recap", () => {
    const plan = planSessionResume(
      session([user("u1", "Set up the repo"), restartNotice()]),
      false,
    );
    expect(plan).toEqual({
      prompt: "Set up the repo",
      attachments: [],
      mode: "resend",
      releaseQueue: false,
    });
  });

  it("releases queued follow-ups the failure paused", () => {
    const plan = planSessionResume(
      session(
        [user("u1", "Fix it"), assistant("a1", "On it"), errorNotice("e1", "Claude Code exited")],
        {
          providerSessionId: "thread-1",
          queueStatus: "paused",
          queuedMessages: [{ id: "q1", text: "Then run lint", attachments: [] }],
        },
      ),
      true,
    );
    expect(plan?.releaseQueue).toBe(true);
  });

  it("has nothing to plan without an interruption", () => {
    expect(
      planSessionResume(session([user("u1", "Hi"), assistant("a1", "Hello")]), true),
    ).toBeUndefined();
  });

  it("frames the recap as the same conversation", () => {
    expect(resumeContext("RECAP")).toMatch(
      /^<resumed_session>\n[\s\S]*same conversation[\s\S]*\n\nRECAP\n<\/resumed_session>$/,
    );
  });
});
