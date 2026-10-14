import { describe, expect, it } from "vitest";
import type { Session } from "./session";
import {
  cooperativeBridgeBrief,
  cooperativeBriefSignature,
  parseSessionMessageDirectives,
  resolveDirectiveTarget,
} from "./sessionMessageDirectives";

function session(id: string, title: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    harness: "codex",
    model: "gpt-5",
    modelSettings: {},
    runtimeMode: "default" as Session["runtimeMode"],
    title,
    cwd: "/repo/app",
    blocks: [],
    ...patch,
  };
}

describe("parseSessionMessageDirectives", () => {
  it("reads quoted, bracketed and bare targets", () => {
    expect(
      parseSessionMessageDirectives(
        [
          "Splitting this up.",
          '@send:"Frontend tests" Run the e2e suite.',
          "@ask:[API work] Which port does it use?",
          "@send:3f2a9c1e Rebase on main.",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "send", target: "Frontend tests", text: "Run the e2e suite." },
      { kind: "ask", target: "API work", text: "Which port does it use?" },
      { kind: "send", target: "3f2a9c1e", text: "Rebase on main." },
    ]);
  });

  it("runs a message on to the next blank line", () => {
    expect(
      parseSessionMessageDirectives(
        '@send:"Docs"\nUpdate the README\n- install steps\n\nThat is all from me.',
      ),
    ).toEqual([
      { kind: "send", target: "Docs", text: "Update the README\n- install steps" },
    ]);
  });

  it("ignores directives in code, mid-sentence, or without a message", () => {
    expect(
      parseSessionMessageDirectives(
        [
          "```",
          '@send:"Docs" not real',
          "```",
          'Use @send:"Docs" to hand off.',
          '@send:"Empty"',
          "",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("resolveDirectiveTarget", () => {
  const source = session("aaaaaaaa-0000", "Lead");
  const docs = session("3f2a9c1e-1111", "Docs");
  const tests = session("bbbbbbbb-2222", "Frontend tests");
  const elsewhere = session("cccccccc-3333", "Docs", { cwd: "/repo/other" });
  const all = [source, docs, tests, elsewhere];

  it("finds a session by id, title or slug", () => {
    expect(resolveDirectiveTarget("3f2a9c1e", source, all)).toEqual({
      ok: true,
      targets: [docs],
    });
    expect(resolveDirectiveTarget("frontend tests", source, all)).toEqual({
      ok: true,
      targets: [tests],
    });
    expect(resolveDirectiveTarget("frontend-tests", source, all)).toEqual({
      ok: true,
      targets: [tests],
    });
  });

  it("prefers the sibling when two projects share a title", () => {
    expect(resolveDirectiveTarget("Docs", source, all)).toEqual({
      ok: true,
      targets: [docs],
    });
  });

  it("broadcasts to siblings and never to the sender", () => {
    expect(resolveDirectiveTarget("siblings", source, all)).toEqual({
      ok: true,
      targets: [docs, tests],
    });
    expect(resolveDirectiveTarget("Lead", source, all)).toMatchObject({
      ok: false,
    });
  });

  it("explains a target it cannot pick", () => {
    expect(resolveDirectiveTarget("Nope", source, all)).toEqual({
      ok: false,
      error: 'No open session is called "Nope".',
    });
    const twin = session("dddddddd-4444", "Docs");
    expect(resolveDirectiveTarget("Docs", source, [...all, twin])).toMatchObject({
      ok: false,
      error: expect.stringContaining("matches 3 sessions"),
    });
  });
});

describe("cooperativeBridgeBrief", () => {
  it("lists sibling sessions with how to message them", () => {
    const brief = cooperativeBridgeBrief(session("a", "Lead"), [
      session("a", "Lead"),
      session("3f2a9c1e-x", "Docs", { busy: true }),
      session("c", "Elsewhere", { cwd: "/other" }),
    ]);
    expect(brief).toContain("@send:");
    expect(brief).toContain("@ask:");
    expect(brief).toContain('"Docs" (id 3f2a9c1e; Codex, gpt-5; running)');
    expect(brief).not.toContain("Elsewhere");
    expect(brief).not.toContain('"Lead"');
  });

  it("has nothing to say without siblings", () => {
    expect(cooperativeBridgeBrief(session("a", "Lead"), [])).toBeNull();
  });

  it("keeps the same signature while only activity changes", () => {
    const idle = cooperativeBridgeBrief(session("a", "Lead"), [
      session("b", "Docs"),
    ]);
    const busy = cooperativeBridgeBrief(session("a", "Lead"), [
      session("b", "Docs", { busy: true }),
    ]);
    const renamed = cooperativeBridgeBrief(session("a", "Lead"), [
      session("b", "Docs v2"),
    ]);
    expect(cooperativeBriefSignature(idle)).toBe(cooperativeBriefSignature(busy));
    expect(cooperativeBriefSignature(idle)).not.toBe(
      cooperativeBriefSignature(renamed),
    );
  });
});
