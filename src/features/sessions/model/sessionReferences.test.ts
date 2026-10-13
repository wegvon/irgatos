import { describe, expect, it } from "vitest";
import type { Block } from "./session";
import {
  appendSessionReference,
  compactOrdinals,
  describeSessionReferencePlan,
  formatActivityAge,
  formatTokenEstimate,
  injectSessionReferences,
  parseOrdinals,
  planSessionReferences,
  rankReferenceCandidates,
  referenceBudget,
  removeSessionReferenceToken,
  sessionMessageForBlock,
  sessionMessages,
  sessionReferenceId,
  sessionReferenceLabel,
  sessionReferenceParts,
  sessionReferenceSlug,
  sessionReferenceTokens,
  SESSION_REFERENCE_CHARS,
  SESSION_REFERENCE_TOTAL_CHARS,
  type SessionReferenceSource,
  type SessionReferenceTarget,
} from "./sessionReferences";

const SOURCE_ID = "3f2a9c1e-1111-4222-8333-444455556666";
const TARGET_ID = "a1b2c3d4-1111-4222-8333-444455556666";

function source(
  blocks: Block[],
  extra: Partial<SessionReferenceSource> = {},
): SessionReferenceSource {
  return {
    id: SOURCE_ID,
    title: "claude · Fix login redirect",
    harness: "claude",
    cwd: "/Users/me/app",
    blocks,
    ...extra,
  };
}

const target: SessionReferenceTarget = {
  sessionId: TARGET_ID,
  harness: "claude",
  cwd: "/Users/me/app",
};

function conversation(turns: number, replyChars = 40): Block[] {
  const blocks: Block[] = [];
  for (let i = 1; i <= turns; i++) {
    blocks.push({ id: `u${i}`, role: "user", text: `Question ${i}` });
    blocks.push({ id: `t${i}`, role: "tool", text: "Read file" });
    blocks.push({
      id: `a${i}`,
      role: "assistant",
      text: `Answer ${i} `.padEnd(replyChars, "x"),
    });
  }
  return blocks;
}

describe("session reference tokens", () => {
  it("builds a readable label from the title and a short id", () => {
    expect(sessionReferenceId(SOURCE_ID)).toBe("3f2a9c1e");
    expect(sessionReferenceId("irgat-x")).toBeNull();
    expect(sessionReferenceSlug("claude · Fix the Login redirect!")).toBe(
      "claude-fix-the-login-redirect",
    );
    expect(sessionReferenceLabel({ id: SOURCE_ID, title: "Fix login" })).toBe(
      "session/fix-login-3f2a9c1e",
    );
    expect(
      sessionReferenceLabel(
        { id: SOURCE_ID, title: "Fix login" },
        [7, 2, 3, 4],
      ),
    ).toBe("session/fix-login-3f2a9c1e#2-4,7");
    expect(sessionReferenceLabel({ id: SOURCE_ID, title: "🙂" })).toBe(
      "session/3f2a9c1e",
    );
  });

  it("compacts and parses message selections", () => {
    expect(compactOrdinals([5, 1, 2, 3, 9, 10])).toBe("1-3,5,9-10");
    expect(parseOrdinals("1-3,5")).toEqual([1, 2, 3, 5]);
    expect(parseOrdinals("4-2")).toBeNull();
    expect(parseOrdinals("0")).toBeNull();
    expect(parseOrdinals("1-99999")).toBeNull();
  });

  it("finds tokens with and without a selection, peeling punctuation", () => {
    const text =
      "Compare @session/fix-login-3f2a9c1e#2,4-5, with @session/a1b2c3d4. Also @session/nope";
    const tokens = sessionReferenceTokens(text);
    expect(tokens.map((token) => token.label)).toEqual([
      "session/fix-login-3f2a9c1e#2,4-5",
      "session/a1b2c3d4",
    ]);
    expect(tokens[0]!.idPrefix).toBe("3f2a9c1e");
    expect(tokens[0]!.selection).toEqual([2, 4, 5]);
    expect(tokens[1]!.selection).toBeNull();
    expect(text.slice(tokens[0]!.start, tokens[0]!.end)).toBe(
      "@session/fix-login-3f2a9c1e#2,4-5",
    );
  });

  it("ignores tokens inside words and malformed ids", () => {
    expect(sessionReferenceTokens("me@session/fix-3f2a9c1e")).toEqual([]);
    expect(sessionReferenceTokens("@session/fix-3f2a9c1")).toEqual([]);
    expect(sessionReferenceTokens("@session/fix-3f2a9c1e#0")).toEqual([]);
  });

  it("splits text for highlighting and removes one token cleanly", () => {
    const text = "see @session/x-3f2a9c1e please";
    const parts = sessionReferenceParts(text);
    expect(parts.map((part) => [part.text, !!part.token])).toEqual([
      ["see ", false],
      ["@session/x-3f2a9c1e", true],
      [" please", false],
    ]);
    expect(removeSessionReferenceToken(text, parts[1]!.token!)).toBe(
      "see please",
    );
  });

  it("appends a reference to an existing draft", () => {
    expect(appendSessionReference("", "session/a-3f2a9c1e")).toBe(
      "@session/a-3f2a9c1e ",
    );
    expect(appendSessionReference("Look at", "session/a-3f2a9c1e")).toBe(
      "Look at @session/a-3f2a9c1e ",
    );
  });
});

describe("sessionMessages", () => {
  it("numbers user prompts and whole agent replies, skipping chrome", () => {
    const messages = sessionMessages(
      source([
        { id: "u1", role: "user", text: "Fix the redirect" },
        { id: "r1", role: "reasoning", text: "thinking" },
        { id: "a1", role: "assistant", text: "Looking." },
        { id: "t1", role: "tool", text: "Edit src/login.ts" },
        { id: "a2", role: "assistant", text: "Fixed it." },
        { id: "i1", role: "user", text: "internal", internal: true },
        { id: "d1", role: "user", text: "unsent", draft: true },
      ]),
    );
    expect(messages.map((m) => [m.ordinal, m.kind, m.text])).toEqual([
      [1, "user", "Fix the redirect"],
      [2, "reply", "Looking.\n\nFixed it."],
    ]);
    expect(messages[1]!.blockIds).toEqual(["a1", "a2"]);
    expect(sessionMessageForBlock(messages, "a2")?.ordinal).toBe(2);
  });

  it("attributes replies to the provider that wrote them after a handoff", () => {
    const messages = sessionMessages(
      source([
        { id: "u1", role: "user", text: "Start" },
        { id: "a1", role: "assistant", text: "Claude here" },
        {
          id: "h1",
          role: "handoff",
          text: "",
          handoff: { from: "claude", to: "codex", status: "ready" },
        },
        { id: "u2", role: "user", text: "Continue" },
        { id: "a2", role: "assistant", text: "Codex here", streaming: true },
      ]),
    );
    expect(messages.map((m) => m.harness ?? null)).toEqual([
      null,
      "claude",
      null,
      "codex",
    ]);
    expect(messages[3]!.streaming).toBe(true);
  });

  it("names attachments on user prompts", () => {
    const [message] = sessionMessages(
      source([
        {
          id: "u1",
          role: "user",
          text: "What is this?",
          attachments: [
            {
              id: "f",
              name: "shot.png",
              mimeType: "image/png",
              kind: "image",
              size: 1,
            },
          ],
        },
      ]),
    );
    expect(message!.text).toBe("What is this?\n[attached: shot.png]");
  });
});

describe("planSessionReferences", () => {
  const plan = (text: string, src?: SessionReferenceSource, to = target) =>
    planSessionReferences(sessionReferenceTokens(text), () => src, to);

  it("includes a small whole session word for word and labels the source", () => {
    const [result] = plan("@session/fix-3f2a9c1e", source(conversation(2)));
    expect(result!.status).toBe("ok");
    expect(result!.condensed).toBe(false);
    expect(result!.full).toBe(4);
    expect(result!.body).toContain(
      '<session_reference ref="@session/fix-3f2a9c1e"',
    );
    expect(result!.body).toContain('title="claude · Fix login redirect"');
    expect(result!.body).toContain('scope="whole session"');
    expect(result!.body).toContain("not part of this conversation");
    expect(result!.body).toContain("[#1 · User]\nQuestion 1");
    expect(result!.body).toContain("[#2 · Claude Code]\nAnswer 1");
    expect(result!.includedChars).toBe(result!.body.length);
  });

  it("includes only picked messages", () => {
    const [result] = plan("@session/fix-3f2a9c1e#2,3", source(conversation(3)));
    expect(result!.full).toBe(2);
    expect(result!.body).toContain('scope="messages 2-3"');
    expect(result!.body).toContain("[#2 · Claude Code]");
    expect(result!.body).toContain("[#3 · User]");
    expect(result!.body).not.toContain("[#1 · User]");
    expect(describeSessionReferencePlan(result!)).toMatch(
      /^2 picked messages · ~/,
    );
  });

  it("reports picked messages that no longer exist", () => {
    const [result] = plan(
      "@session/fix-3f2a9c1e#2,40",
      source(conversation(1)),
    );
    expect(result!.missingOrdinals).toEqual([40]);
    expect(result!.body).toContain("Message 40 no longer exists");
  });

  it("condenses a large session within its budget and says so", () => {
    const big = source(conversation(80, 2_000));
    const [result] = plan("@session/fix-3f2a9c1e", big);
    expect(result!.status).toBe("ok");
    expect(result!.condensed).toBe(true);
    expect(result!.includedChars).toBeLessThanOrEqual(
      SESSION_REFERENCE_CHARS + 1_000,
    );
    expect(result!.sourceChars).toBeGreaterThan(100_000);
    expect(result!.body).toContain("[#1 · User]\nQuestion 1");
    expect(result!.body).toContain("[#160 · Claude Code]");
    expect(result!.body).toContain("Condensed to fit:");
    expect(result!.body).toMatch(/earlier messages? left out to fit/);
    expect(result!.full + result!.shortened + result!.omitted).toBe(160);
    expect(describeSessionReferencePlan(result!)).toMatch(
      /^Condensed: \d+ in full.* · ~[\d.]+k tokens of ~[\d.]+k tokens$/,
    );
  });

  it("cuts one oversized picked message and marks it", () => {
    const blocks: Block[] = [
      { id: "u1", role: "user", text: "Dump it" },
      {
        id: "a1",
        role: "assistant",
        text: "y".repeat(SESSION_REFERENCE_CHARS * 3),
      },
    ];
    const [result] = plan("@session/fix-3f2a9c1e#2", source(blocks));
    expect(result!.truncated).toBe(true);
    expect(result!.includedChars).toBeLessThanOrEqual(
      SESSION_REFERENCE_CHARS + 1_000,
    );
    expect(result!.body).toMatch(/more characters of this message were cut/);
    expect(describeSessionReferencePlan(result!)).toContain("cut to fit");
  });

  it("shares the total budget across several references", () => {
    expect(referenceBudget(1)).toBe(SESSION_REFERENCE_CHARS);
    expect(referenceBudget(4)).toBe(SESSION_REFERENCE_TOTAL_CHARS / 4);
    const big = source(conversation(80, 2_000));
    const text = [1, 2, 3, 4]
      .map((n) => `@session/s${n}-3f2a9c1e#${n * 2}-${n * 2 + 40}`)
      .join(" ");
    const plans = planSessionReferences(
      sessionReferenceTokens(text),
      () => big,
      target,
    );
    const total = plans.reduce((sum, p) => sum + p.includedChars, 0);
    expect(total).toBeLessThanOrEqual(SESSION_REFERENCE_TOTAL_CHARS + 4_000);
  });

  it("warns about a running source, another project, and another agent", () => {
    const running = source(
      [
        { id: "u1", role: "user", text: "Go" },
        { id: "a1", role: "assistant", text: "Working on", streaming: true },
      ],
      {
        harness: "codex",
        cwd: "/Users/me/other",
        branch: "feat/x",
        busy: true,
      },
    );
    const [result] = plan("@session/x-3f2a9c1e", running);
    expect(result!.running).toBe(true);
    expect(result!.otherProject).toBe(true);
    expect(result!.otherAgent).toBe(true);
    expect(result!.body).toContain('status="running"');
    expect(result!.body).toContain('branch="feat/x"');
    expect(result!.body).toContain("run by Codex, a different agent than you");
    expect(result!.body).toContain("different project: /Users/me/other");
    expect(result!.body).toContain("still running");
    expect(result!.body).toContain("[#2 · Codex · still writing]");
  });

  it("distinguishes another worktree of the same project", () => {
    const [result] = plan(
      "@session/x-3f2a9c1e",
      source(conversation(1), { worktreeCwd: "/Users/me/app-wt" }),
    );
    expect(result!.otherProject).toBe(false);
    expect(result!.otherWorktree).toBe(true);
    expect(result!.body).toContain("different working copy of this project");
  });

  it("adds nothing for the current session and a note for a missing one", () => {
    const [self] = planSessionReferences(
      sessionReferenceTokens("@session/me-a1b2c3d4"),
      () => source(conversation(1)),
      target,
    );
    expect(self!.status).toBe("self");
    expect(self!.body).toBe("");
    const [missing] = plan("@session/gone-3f2a9c1e", undefined);
    expect(missing!.status).toBe("missing");
    expect(missing!.body).toContain("could not be found");
  });

  it("lists files the source session edited", () => {
    const [result] = plan(
      "@session/x-3f2a9c1e",
      source([
        { id: "u1", role: "user", text: "Edit" },
        {
          id: "t1",
          role: "tool",
          text: "Edit",
          tool: {
            kind: "edit",
            preview: { kind: "write", path: "/Users/me/app/src/login.ts" },
          },
        },
        { id: "a1", role: "assistant", text: "Done" },
      ]),
    );
    expect(result!.body).toContain(
      "Files edited in that session:\n- src/login.ts",
    );
  });

  it("deduplicates repeated tokens", () => {
    const plans = plan(
      "@session/x-3f2a9c1e and again @session/x-3f2a9c1e",
      source(conversation(1)),
    );
    expect(plans).toHaveLength(1);
  });
});

describe("injectSessionReferences", () => {
  it("appends reference bodies after the user's words", () => {
    const plans = planSessionReferences(
      sessionReferenceTokens("Use @session/x-3f2a9c1e"),
      () => source(conversation(1)),
      target,
    );
    const prompt = injectSessionReferences("Use @session/x-3f2a9c1e", plans);
    expect(
      prompt.startsWith("Use @session/x-3f2a9c1e\n\n---\n<session_reference"),
    ).toBe(true);
    expect(prompt.trimEnd().endsWith("</session_reference>")).toBe(true);
    expect(injectSessionReferences("plain", [])).toBe("plain");
  });
});

describe("rankReferenceCandidates", () => {
  const candidates = [
    {
      id: "1",
      title: "claude · Fix login redirect",
      harness: "claude" as const,
      cwd: "/a/web",
      updatedAt: 3,
    },
    {
      id: "2",
      title: "codex · Billing export",
      harness: "codex" as const,
      cwd: "/a/api",
      branch: "feat/csv",
      updatedAt: 2,
    },
    {
      id: "3",
      title: "cursor · Login copy tweaks",
      harness: "cursor" as const,
      cwd: "/a/web",
      updatedAt: 1,
    },
  ];

  it("keeps recency order without a query", () => {
    expect(
      rankReferenceCandidates(candidates, "").map((r) => r.candidate.id),
    ).toEqual(["1", "2", "3"]);
  });

  it("matches titles first, then project, agent and branch", () => {
    expect(
      rankReferenceCandidates(candidates, "login").map((r) => r.candidate.id),
    ).toEqual(["3", "1"]);
    expect(
      rankReferenceCandidates(candidates, "api").map((r) => r.candidate.id),
    ).toEqual(["2"]);
    expect(
      rankReferenceCandidates(candidates, "csv").map((r) => r.candidate.id),
    ).toEqual(["2"]);
  });
});

describe("formatting", () => {
  it("formats token estimates and activity ages", () => {
    expect(formatTokenEstimate(400)).toBe("~100 tokens");
    expect(formatTokenEstimate(24_000)).toBe("~6k tokens");
    expect(formatTokenEstimate(25_000)).toBe("~6.3k tokens");
    const now = 1_000_000_000;
    expect(formatActivityAge(now - 10_000, now)).toBe("now");
    expect(formatActivityAge(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatActivityAge(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatActivityAge(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
